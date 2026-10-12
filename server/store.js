import crypto from "node:crypto";
import {
  parseJson,
  rowToCategory,
  rowToField,
  rowToPlace,
  rowToReaction,
  newQueryCode,
} from "./db.js";
import { sha256, newToken } from "./auth.js";

const nowIso = () => new Date().toISOString();

export const PUBLIC_PLACE_COLUMNS =
  "id,name,recommendation,category_id,latitude,longitude,address,hours,price,best_for,rating,cover_url,image_urls,tags,highlights,custom_details";

export function createStore(db) {
  const placeholders = (count) => Array.from({ length: count }, () => "?").join(",");

  // ---------------------------------------------------------------- catalog
  const catalog = {
    categories: () =>
      db
        .prepare("select * from categories order by sort_order, id")
        .all()
        .map(rowToCategory),
    activeCategories: () =>
      db
        .prepare("select * from categories where is_active = 1 order by sort_order, id")
        .all()
        .map(rowToCategory),
    fields: () =>
      db
        .prepare("select * from detail_fields order by sort_order, key")
        .all()
        .map(rowToField),
    activeFields: () =>
      db
        .prepare("select * from detail_fields where is_active = 1 order by sort_order, key")
        .all()
        .map(rowToField),
    reactions: () =>
      db
        .prepare("select * from reaction_definitions order by sort_order, value")
        .all()
        .map(rowToReaction),
    activeReactions: () =>
      db
        .prepare("select * from reaction_definitions where is_active = 1 order by sort_order, value")
        .all()
        .map(rowToReaction),
    sortSettings: () => {
      const row = db.prepare("select * from recommendation_sort_settings where id = 1").get();
      return row
        ? { distance_weight: row.distance_weight, response_weight: row.response_weight }
        : { distance_weight: 50, response_weight: 50 };
    },
    saveSortSettings(distanceWeight) {
      const distance = Math.max(0, Math.min(100, Math.round(Number(distanceWeight))));
      db.prepare(
        `insert into recommendation_sort_settings(id, distance_weight, response_weight, updated_at)
         values(1, ?, ?, ?)
         on conflict(id) do update set distance_weight = excluded.distance_weight,
           response_weight = excluded.response_weight, updated_at = excluded.updated_at`,
      ).run(distance, 100 - distance, nowIso());
      return catalog.sortSettings();
    },
  };

  // ---------------------------------------------------------------- places
  const places = {
    byStatus: (status) =>
      db
        .prepare("select * from places where status = ? order by submitted_at desc")
        .all(status)
        .map(rowToPlace),
    approved: () =>
      db
        .prepare(`select ${PUBLIC_PLACE_COLUMNS} from places where status = 'approved' order by submitted_at desc`)
        .all()
        .map(rowToPlace),
    approvedById: (id) => {
      const row = db
        .prepare(`select ${PUBLIC_PLACE_COLUMNS} from places where id = ? and status = 'approved'`)
        .get(id);
      return row ? rowToPlace(row) : null;
    },
    byId: (id) => {
      const row = db.prepare("select * from places where id = ?").get(id);
      return row ? rowToPlace(row) : null;
    },
    byQueryCode: (code) => {
      const row = db
        .prepare(
          "select id,status,rejection_reason,submitted_at,reviewed_at from places where upper(query_code) = upper(?)",
        )
        .get(String(code || "").trim());
      return row || null;
    },
    duplicateCandidates: ({ name, latitude, longitude }) => {
      const nearby = db
        .prepare(
          `select id,name from places
           where latitude between ? and ? and longitude between ? and ?
           limit 5`,
        )
        .all(latitude - 0.0015, latitude + 0.0015, longitude - 0.0015, longitude + 0.0015);
      return nearby
        .filter((place) => place.name.includes(name) || name.includes(place.name))
        .map((place) => ({ id: place.id, name: place.name }));
    },
    insert: (payload, status) => {
      const id = crypto.randomUUID();
      const queryCode = newQueryCode();
      db.prepare(
        `insert into places(
           id,name,recommendation,category_id,latitude,longitude,address,hours,price,best_for,
           rating,cover_url,image_urls,tags,highlights,custom_details,status,query_code,submitted_at
         ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        payload.name,
        payload.recommendation,
        payload.category_id || null,
        payload.latitude,
        payload.longitude,
        payload.address || null,
        payload.hours || null,
        payload.price || null,
        payload.best_for || null,
        payload.rating ?? null,
        payload.cover_url || null,
        JSON.stringify(payload.image_urls || []),
        JSON.stringify(payload.tags || []),
        JSON.stringify(payload.highlights || []),
        JSON.stringify(payload.custom_details || {}),
        status,
        queryCode,
        nowIso(),
      );
      return places.byId(id);
    },
    update: (id, changes) => {
      const allowed = [
        "name",
        "recommendation",
        "category_id",
        "latitude",
        "longitude",
        "address",
        "hours",
        "price",
        "best_for",
        "rating",
        "cover_url",
        "status",
        "rejection_reason",
      ];
      const jsonColumns = ["image_urls", "tags", "highlights", "custom_details"];
      const assignments = [];
      const values = [];
      for (const key of allowed) {
        if (changes[key] === undefined) continue;
        assignments.push(`${key} = ?`);
        values.push(changes[key]);
      }
      for (const key of jsonColumns) {
        if (changes[key] === undefined) continue;
        assignments.push(`${key} = ?`);
        values.push(JSON.stringify(changes[key]));
      }
      if (changes.reviewed_by !== undefined) {
        assignments.push("reviewed_by = ?");
        values.push(changes.reviewed_by);
      }
      if (changes.reviewed_at !== undefined) {
        assignments.push("reviewed_at = ?");
        values.push(changes.reviewed_at);
      }
      if (!assignments.length) return places.byId(id);
      values.push(id);
      db.prepare(`update places set ${assignments.join(", ")} where id = ?`).run(...values);
      return places.byId(id);
    },
    remove: (id) => db.prepare("delete from places where id = ?").run(id),
  };

  // ---------------------------------------------------------------- quota
  const quota = {
    consume: (rateKey, maxCount) => {
      const day = new Date().toISOString().slice(0, 10);
      const result = db
        .prepare(
          `insert into submission_rate_limits(rate_key, day, count) values(?, ?, 1)
           on conflict(rate_key, day) do update set count = count + 1 where count < ?`,
        )
        .run(rateKey, day, maxCount);
      return result.changes > 0;
    },
  };

  // ------------------------------------------------------------ reactions
  function reactionRows(placeIds, voterToken) {
    if (!placeIds.length) return [];
    const tokenHash = voterToken ? sha256(voterToken) : null;
    const rows = db
      .prepare(
        `select p.id as place_id, rd.value as reaction_value, rd.emoji as reaction_emoji,
                rd.label as reaction_label, rd.sort_order as reaction_sort,
                coalesce(cnt.total, 0) + coalesce(adj.adjustment, 0) as raw_count
         from places p
         cross join reaction_definitions rd
         left join place_reaction_options pro
           on pro.place_id = p.id and pro.reaction_value = rd.value
         left join (
           select place_id, reaction, count(*) as total
           from place_reactions group by place_id, reaction
         ) cnt on cnt.place_id = p.id and cnt.reaction = rd.value
         left join place_reaction_adjustments adj
           on adj.place_id = p.id and adj.reaction_value = rd.value
         where p.status = 'approved' and rd.is_active = 1
           and coalesce(pro.is_enabled, 1) = 1
           and p.id in (${placeholders(placeIds.length)})
         order by p.id, rd.sort_order, rd.value`,
      )
      .all(...placeIds);
    return rows.map((row) => {
      const selected =
        tokenHash &&
        Boolean(
          db
            .prepare(
              "select 1 from place_reactions where place_id = ? and voter_hash = ? and reaction = ?",
            )
            .get(row.place_id, tokenHash, row.reaction_value),
        );
      return {
        place_id: row.place_id,
        reaction_value: row.reaction_value,
        reaction_emoji: row.reaction_emoji,
        reaction_label: row.reaction_label,
        reaction_count: Math.max(0, Number(row.raw_count) || 0),
        selected: Boolean(selected),
      };
    });
  }

  const reactions = {
    summaries: (placeIds) =>
      reactionRows(placeIds, null).map(({ selected, ...rest }) => rest),
    forPlace: (placeId, voterToken) => reactionRows([placeId], voterToken),
    set(placeId, reaction, voterToken) {
      const tokenHash = sha256(voterToken);
      if (!reaction) {
        db.prepare("delete from place_reactions where place_id = ? and voter_hash = ?").run(
          placeId,
          tokenHash,
        );
      } else {
        db.prepare(
          `insert into place_reactions(place_id, voter_hash, reaction, created_at, updated_at)
           values(?, ?, ?, ?, ?)
           on conflict(place_id, voter_hash) do update
             set reaction = excluded.reaction, updated_at = excluded.updated_at`,
        ).run(placeId, tokenHash, reaction, nowIso(), nowIso());
      }
      return reactions.forPlace(placeId, voterToken);
    },
    isAvailable: (placeId, reaction) =>
      Boolean(
        db
          .prepare(
            `select 1 from reaction_definitions rd
             left join place_reaction_options pro
               on pro.place_id = ? and pro.reaction_value = rd.value
             where rd.value = ? and rd.is_active = 1 and coalesce(pro.is_enabled, 1) = 1`,
          )
          .get(placeId, reaction),
      ),
    options: (placeIds) => {
      if (!placeIds.length) return [];
      return db
        .prepare(
          `select place_id, reaction_value, is_enabled from place_reaction_options
           where place_id in (${placeholders(placeIds.length)})`,
        )
        .all(...placeIds)
        .map((row) => ({ ...row, is_enabled: Boolean(row.is_enabled) }));
    },
    saveOption: (placeId, reactionValue, isEnabled) => {
      db.prepare(
        `insert into place_reaction_options(place_id, reaction_value, is_enabled)
         values(?, ?, ?)
         on conflict(place_id, reaction_value) do update set is_enabled = excluded.is_enabled`,
      ).run(placeId, reactionValue, isEnabled ? 1 : 0);
      return { place_id: placeId, reaction_value: reactionValue, is_enabled: Boolean(isEnabled) };
    },
    setCount: (placeId, reactionValue, targetCount) => {
      const current = db
        .prepare("select count(*) as total from place_reactions where place_id = ? and reaction = ?")
        .get(placeId, reactionValue).total;
      const adjustment = Number(targetCount) - Number(current);
      if (adjustment === 0) {
        db.prepare(
          "delete from place_reaction_adjustments where place_id = ? and reaction_value = ?",
        ).run(placeId, reactionValue);
      } else {
        db.prepare(
          `insert into place_reaction_adjustments(place_id, reaction_value, adjustment)
           values(?, ?, ?)
           on conflict(place_id, reaction_value) do update set adjustment = excluded.adjustment`,
        ).run(placeId, reactionValue, adjustment);
      }
      return targetCount;
    },
  };

  // ------------------------------------------------------------- admin auth
  const admins = {
    findByIdentifier: (identifier) =>
      db
        .prepare("select * from admin_users where username = ? or email = ? limit 1")
        .get(identifier, identifier) || null,
    createSession(adminId, ttlHours) {
      const token = newToken();
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + ttlHours * 3600 * 1000);
      db.prepare(
        "insert into sessions(token, admin_id, created_at, expires_at) values(?, ?, ?, ?)",
      ).run(token, adminId, createdAt.toISOString(), expiresAt.toISOString());
      return token;
    },
    sessionAdmin(token) {
      if (!token) return null;
      const row = db
        .prepare(
          `select a.id, a.username, a.email, s.expires_at
           from sessions s join admin_users a on a.id = s.admin_id
           where s.token = ?`,
        )
        .get(token);
      if (!row) return null;
      if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare("delete from sessions where token = ?").run(token);
        return null;
      }
      return { id: row.id, username: row.username, email: row.email };
    },
    destroySession: (token) => db.prepare("delete from sessions where token = ?").run(token),
    all: () => db.prepare("select id, username, email from admin_users order by id").all(),
  };

  // ------------------------------------------------------- categories/fields
  const categories = {
    save: (category) => {
      db.prepare(
        `insert into categories(id, label, color, sort_order, is_active) values(?, ?, ?, ?, ?)
         on conflict(id) do update set label = excluded.label, color = excluded.color,
           sort_order = excluded.sort_order, is_active = excluded.is_active`,
      ).run(
        category.id,
        category.label,
        category.color || "#5e8c73",
        Number(category.sort_order) || 0,
        category.is_active === false ? 0 : 1,
      );
      return catalog.categories().find((item) => item.id === category.id);
    },
    remove: (id) => db.prepare("delete from categories where id = ?").run(id),
    isReferenced: (id) =>
      Boolean(db.prepare("select 1 from places where category_id = ? limit 1").get(id)),
  };

  const fields = {
    save: (field) => {
      db.prepare(
        `insert into detail_fields(key, label, default_value, sort_order, is_active)
         values(?, ?, ?, ?, ?)
         on conflict(key) do update set label = excluded.label, default_value = excluded.default_value,
           sort_order = excluded.sort_order, is_active = excluded.is_active`,
      ).run(
        field.key,
        field.label,
        field.default_value || null,
        Number(field.sort_order) || 0,
        field.is_active === false ? 0 : 1,
      );
      return catalog.fields().find((item) => item.key === field.key);
    },
    remove: (key) => db.prepare("delete from detail_fields where key = ?").run(key),
  };

  const reactionDefs = {
    save: (reaction) => {
      db.prepare(
        `insert into reaction_definitions(value, emoji, label, sort_order, is_active)
         values(?, ?, ?, ?, ?)
         on conflict(value) do update set emoji = excluded.emoji, label = excluded.label,
           sort_order = excluded.sort_order, is_active = excluded.is_active`,
      ).run(
        reaction.value,
        reaction.emoji,
        reaction.label,
        Number(reaction.sort_order) || 0,
        reaction.is_active === false ? 0 : 1,
      );
      return catalog.reactions().find((item) => item.value === reaction.value);
    },
    remove: (value) =>
      db.prepare("delete from reaction_definitions where value = ?").run(value),
    isReferenced: (value) =>
      Boolean(
        db.prepare("select 1 from place_reactions where reaction = ? limit 1").get(value) ||
          db.prepare("select 1 from place_reaction_options where reaction_value = ? limit 1").get(value),
      ),
  };

  return {
    raw: db,
    catalog,
    places,
    quota,
    reactions,
    admins,
    categories,
    fields,
    reactionDefs,
    json: parseJson,
  };
}

export default createStore;
