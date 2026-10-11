import express from "express";
import multer from "multer";
import cookieParser from "cookie-parser";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createStore } from "./store.js";
import { verifyPassword, hashPassword, sha256 } from "./auth.js";
import { InputError, normalizePayload, stringValue } from "./validate.js";

const SESSION_COOKIE = "admin_session";
const VOTER_MIN = 16;
const VOTER_MAX = 200;
const IMAGE_PATH_PATTERN = /^\/uploads\/(pending|public)\/[0-9a-f-]{36}\.[a-z0-9]+$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function isAdminSession(store, req) {
  return store.admins.sessionAdmin(req.cookies?.[SESSION_COOKIE]);
}

function requireAdmin(store) {
  return (req, res, next) => {
    const admin = isAdminSession(store, req);
    if (!admin) return res.status(401).json({ error: "需要管理员登录" });
    req.admin = admin;
    next();
  };
}

function publicImagePathFromUrl(url) {
  if (typeof url !== "string") return null;
  return IMAGE_PATH_PATTERN.test(url) ? url : null;
}

export function createApp({ db, config }) {
  const store = createStore(db);
  const pendingDir = path.join(config.uploadDir, "pending");
  const publicDir = path.join(config.uploadDir, "public");
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });

  const upload = (destination) =>
    multer({
      storage: multer.diskStorage({
        destination,
        filename: (_req, file, callback) =>
          callback(
            null,
            `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || ".bin"}`,
          ),
      }),
      limits: { fileSize: config.maxUploadBytes, files: 12 },
      fileFilter: (_req, file, callback) =>
        callback(null, ALLOWED_IMAGE_TYPES.has(file.mimetype)),
    });

  const app = express();
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.use(express.json({ limit: config.maxBodyBytes }));
  app.use(express.urlencoded({ extended: false, limit: config.maxBodyBytes }));
  app.use(
    "/uploads",
    express.static(config.uploadDir, {
      maxAge: "7d",
      index: false,
      dotfiles: "deny",
    }),
  );

  // ------------------------------------------------------------------ public
  app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.get("/api/config", (_req, res) =>
    res.json({
      enablePublicSubmissions: config.enablePublicSubmissions,
      turnstileSiteKey: null,
    }),
  );

  app.get(
    "/api/catalog",
    asyncHandler((_req, res) => {
      const places = store.places.approved();
      const placeIds = places.map((place) => place.id);
      res.json({
        categories: store.catalog.activeCategories(),
        detailFields: store.catalog.activeFields(),
        places,
        reactions: store.catalog.activeReactions(),
        reactionSummaries: store.reactions.summaries(placeIds),
        sortSettings: store.catalog.sortSettings(),
      });
    }),
  );

  app.get(
    "/api/submissions/:code",
    asyncHandler((req, res) => {
      const row = store.places.byQueryCode(req.params.code);
      if (!row) return res.status(404).json({ error: "没有找到对应投稿" });
      res.json(row);
    }),
  );

  app.post(
    "/api/submissions",
    upload(pendingDir).array("images", 3),
    asyncHandler(async (req, res) => {
      const cleanup = () => (req.files || []).forEach((file) => fs.rm(file.path, { force: true }, () => {}));
      if (!config.enablePublicSubmissions) {
        cleanup();
        return res.status(403).json({ error: "投稿功能未开放" });
      }
      let payload;
      let fingerprint;
      try {
        payload = normalizePayload(JSON.parse(req.body.payload || "{}"));
        fingerprint = stringValue(req.body.fingerprint, "设备标识", 128, true);
      } catch (error) {
        cleanup();
        if (error instanceof InputError) return res.status(400).json({ error: error.message });
        return res.status(400).json({ error: "投稿数据格式错误" });
      }
      if (payload.category_id) {
        const category = store.catalog
          .activeCategories()
          .find((item) => item.id === payload.category_id);
        if (!category) {
          cleanup();
          return res.status(400).json({ error: "所选分类不存在或已停用" });
        }
      }
      const imagePaths = (req.files || []).map((file) => `/uploads/pending/${file.filename}`);
      payload.custom_details = { ...payload.custom_details, images: imagePaths };

      const rateKey = sha256(`${req.ip}:${fingerprint}`);
      if (!store.quota.consume(rateKey, config.maxSubmissionsPerDay)) {
        cleanup();
        return res.status(429).json({ error: "今天的投稿次数已用完" });
      }

      const duplicates = store.places.duplicateCandidates(payload);
      const place = store.places.insert(
        {
          ...payload,
          custom_details: { ...payload.custom_details, duplicate_candidates: duplicates },
        },
        "pending",
      );
      res.status(201).json({ queryCode: place.query_code, id: place.id });
    }),
  );

  app.get(
    "/api/places/:id/reactions",
    asyncHandler((req, res) => {
      const voterToken = String(req.query.voterToken || "");
      if (voterToken.length < VOTER_MIN || voterToken.length > VOTER_MAX)
        return res.status(400).json({ error: "设备标识无效" });
      if (!store.places.approvedById(req.params.id))
        return res.status(404).json({ error: "地点不可用" });
      res.json(store.reactions.forPlace(req.params.id, voterToken));
    }),
  );

  app.post(
    "/api/places/:id/reactions",
    asyncHandler((req, res) => {
      const voterToken = String(req.body?.voterToken || "");
      if (voterToken.length < VOTER_MIN || voterToken.length > VOTER_MAX)
        return res.status(400).json({ error: "设备标识无效" });
      const reaction = req.body?.reaction;
      const placeId = req.params.id;
      if (!store.places.approvedById(placeId))
        return res.status(404).json({ error: "地点不可用" });
      if (reaction !== null && reaction !== undefined) {
        if (!store.reactions.isAvailable(placeId, reaction))
          return res.status(400).json({ error: "表情不可用" });
      }
      res.json(store.reactions.set(placeId, reaction ?? null, voterToken));
    }),
  );

  // ------------------------------------------------------------------- admin
  app.post(
    "/api/admin/login",
    asyncHandler((req, res) => {
      const identifier = String(req.body?.username || req.body?.email || "").trim();
      const password = String(req.body?.password || "");
      const admin = store.admins.findByIdentifier(identifier);
      if (!admin || !verifyPassword(password, admin.password_hash))
        return res.status(401).json({ error: "账号或密码错误" });
      const token = store.admins.createSession(admin.id, config.sessionTtlHours);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: config.sessionTtlHours * 3600 * 1000,
      });
      res.json({ admin: { id: admin.id, username: admin.username, email: admin.email } });
    }),
  );

  app.post(
    "/api/admin/logout",
    asyncHandler((req, res) => {
      if (req.cookies?.[SESSION_COOKIE]) store.admins.destroySession(req.cookies[SESSION_COOKIE]);
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/session",
    asyncHandler((req, res) => {
      const admin = isAdminSession(store, req);
      if (!admin) return res.status(401).json({ error: "未登录" });
      res.json({ admin });
    }),
  );

  const admin = express.Router();
  admin.use(requireAdmin(store));

  admin.get(
    "/places",
    asyncHandler((req, res) => {
      const status = String(req.query.status || "pending");
      if (!["pending", "approved", "rejected"].includes(status))
        return res.status(400).json({ error: "状态无效" });
      res.json(store.places.byStatus(status));
    }),
  );

  admin.post(
    "/places",
    upload(publicDir).array("images", 12),
    asyncHandler((req, res) => {
      let payload;
      try {
        payload = normalizePayload(JSON.parse(req.body.payload || "{}"));
      } catch (error) {
        (req.files || []).forEach((file) => fs.rm(file.path, { force: true }, () => {}));
        if (error instanceof InputError) return res.status(400).json({ error: error.message });
        return res.status(400).json({ error: "数据格式错误" });
      }
      const imageUrls = (req.files || []).map((file) => `/uploads/public/${file.filename}`);
      const place = store.places.insert(
        {
          ...payload,
          cover_url: imageUrls[0] || null,
          image_urls: imageUrls,
        },
        "approved",
      );
      store.places.update(place.id, {
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.admin.id,
      });
      res.status(201).json({ queryCode: place.query_code, id: place.id });
    }),
  );

  admin.patch(
    "/places/:id",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      res.json(store.places.update(req.params.id, req.body || {}));
    }),
  );

  admin.post(
    "/places/:id/review",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const status = req.body?.status;
      if (!["approved", "rejected"].includes(status))
        return res.status(400).json({ error: "状态无效" });
      const changes = { ...(req.body?.changes || {}) };
      if (status === "rejected") changes.rejection_reason = req.body?.rejectionReason || null;

      if (status === "approved") {
        const pendingImages = place.custom_details?.images || [];
        const publicUrls = [];
        for (const imagePath of pendingImages) {
          if (!IMAGE_PATH_PATTERN.test(imagePath)) continue;
          const filename = path.basename(imagePath);
          const source = path.join(config.uploadDir, "pending", filename);
          const target = path.join(publicDir, filename);
          if (!fs.existsSync(source)) continue;
          fs.renameSync(source, target);
          publicUrls.push(`/uploads/public/${filename}`);
        }
        if (publicUrls.length) {
          changes.image_urls = publicUrls;
          changes.cover_url = publicUrls[0];
        }
        const nextCustom = { ...(place.custom_details || {}), ...(changes.custom_details || {}) };
        delete nextCustom.images;
        changes.custom_details = nextCustom;
      }
      const updated = store.places.update(req.params.id, {
        ...changes,
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: req.admin.id,
      });
      res.json(updated);
    }),
  );

  admin.delete(
    "/places/:id",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const paths = [
        ...(place.custom_details?.images || []),
        ...(place.image_urls || []),
        ...(place.cover_url ? [place.cover_url] : []),
      ];
      store.places.remove(req.params.id);
      for (const imagePath of new Set(paths)) {
        const valid = publicImagePathFromUrl(imagePath);
        if (!valid) continue;
        fs.rm(path.join(config.uploadDir, valid.replace("/uploads/", "")), { force: true }, () => {});
      }
      res.json({ ok: true });
    }),
  );

  admin.post(
    "/places/:id/images",
    upload(publicDir).array("images", 12),
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const current = place.image_urls?.length
        ? place.image_urls
        : place.cover_url
          ? [place.cover_url]
          : [];
      if (current.length + (req.files || []).length > 12)
        return res.status(400).json({ error: "每个地点最多保留12张图片" });
      const newUrls = (req.files || []).map((file) => `/uploads/public/${file.filename}`);
      const imageUrls = [...current, ...newUrls];
      res.json(
        store.places.update(place.id, {
          image_urls: imageUrls,
          cover_url: place.cover_url || imageUrls[0] || null,
        }),
      );
    }),
  );

  admin.post(
    "/places/:id/cover",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const url = req.body?.url;
      const current = place.image_urls?.length
        ? place.image_urls
        : place.cover_url
          ? [place.cover_url]
          : [];
      if (!current.includes(url)) return res.status(400).json({ error: "图片不存在" });
      res.json(
        store.places.update(place.id, {
          cover_url: url,
          image_urls: [url, ...current.filter((item) => item !== url)],
        }),
      );
    }),
  );

  admin.delete(
    "/places/:id/images",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const url = req.body?.url;
      const current = place.image_urls?.length
        ? place.image_urls
        : place.cover_url
          ? [place.cover_url]
          : [];
      if (!current.includes(url)) return res.status(400).json({ error: "图片不存在" });
      const imagePath = publicImagePathFromUrl(url);
      if (imagePath)
        fs.rm(path.join(config.uploadDir, imagePath.replace("/uploads/", "")), { force: true }, () => {});
      const imageUrls = current.filter((item) => item !== url);
      res.json(
        store.places.update(place.id, {
          image_urls: imageUrls,
          cover_url: place.cover_url === url ? imageUrls[0] || null : place.cover_url,
        }),
      );
    }),
  );

  admin.delete(
    "/places/:id/pending-images",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const imagePath = req.body?.path;
      const images = place.custom_details?.images || [];
      if (!images.includes(imagePath)) return res.status(400).json({ error: "待审核图片不存在" });
      const valid = publicImagePathFromUrl(imagePath);
      if (valid)
        fs.rm(path.join(config.uploadDir, valid.replace("/uploads/", "")), { force: true }, () => {});
      res.json(
        store.places.update(place.id, {
          custom_details: { ...place.custom_details, images: images.filter((item) => item !== imagePath) },
        }),
      );
    }),
  );

  admin.get("/catalog", (_req, res) =>
    res.json({
      categories: store.catalog.categories(),
      fields: store.catalog.fields(),
      reactions: store.catalog.reactions(),
      sortSettings: store.catalog.sortSettings(),
    }),
  );

  admin.post(
    "/reaction-summaries",
    asyncHandler((req, res) => {
      const placeIds = (req.body?.placeIds || []).filter((id) => typeof id === "string");
      res.json(store.reactions.summaries(placeIds));
    }),
  );

  admin.post(
    "/reaction-options",
    asyncHandler((req, res) => {
      const placeIds = (req.body?.placeIds || []).filter((id) => typeof id === "string");
      res.json(store.reactions.options(placeIds));
    }),
  );

  admin.post(
    "/places/:id/reaction-option",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      res.json(store.reactions.saveOption(req.params.id, req.body?.reactionValue, req.body?.isEnabled));
    }),
  );

  admin.post(
    "/places/:id/reaction-count",
    asyncHandler((req, res) => {
      const place = store.places.byId(req.params.id);
      if (!place) return res.status(404).json({ error: "地点不存在" });
      const count = Number(req.body?.count);
      if (!Number.isFinite(count) || count < 0)
        return res.status(400).json({ error: "响应数量无效" });
      res.json({ count: store.reactions.setCount(req.params.id, req.body?.reactionValue, Math.floor(count)) });
    }),
  );

  admin.post(
    "/categories",
    asyncHandler((req, res) => res.json(store.categories.save(req.body || {}))),
  );
  admin.delete(
    "/categories/:id",
    asyncHandler((req, res) => {
      if (store.categories.isReferenced(req.params.id))
        return res.status(400).json({ error: "该分类仍被地点使用，请先修改相关地点的分类" });
      store.categories.remove(req.params.id);
      res.json({ ok: true });
    }),
  );

  admin.post(
    "/fields",
    asyncHandler((req, res) => res.json(store.fields.save(req.body || {}))),
  );
  admin.delete(
    "/fields/:key",
    asyncHandler((req, res) => {
      store.fields.remove(req.params.key);
      res.json({ ok: true });
    }),
  );

  admin.post(
    "/reactions",
    asyncHandler((req, res) => res.json(store.reactionDefs.save(req.body || {}))),
  );
  admin.delete(
    "/reactions/:value",
    asyncHandler((req, res) => {
      if (store.reactionDefs.isReferenced(req.params.value))
        return res.status(400).json({ error: "该表情已有响应或地点设置，无法删除" });
      store.reactionDefs.remove(req.params.value);
      res.json({ ok: true });
    }),
  );

  admin.post(
    "/sort-settings",
    asyncHandler((req, res) => {
      const distance = Number(req.body?.distanceWeight);
      if (!Number.isInteger(distance) || distance < 0 || distance > 100)
        return res.status(400).json({ error: "距离权重必须是 0 到 100 的整数" });
      res.json(store.catalog.saveSortSettings(distance));
    }),
  );

  admin.post(
    "/password",
    asyncHandler((req, res) => {
      const adminRow = store.admins.findByIdentifier(req.admin.username);
      if (!adminRow || !verifyPassword(String(req.body?.currentPassword || ""), adminRow.password_hash))
        return res.status(400).json({ error: "当前密码错误" });
      const nextPassword = String(req.body?.newPassword || "");
      if (nextPassword.length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
      store.raw
        .prepare("update admin_users set password_hash = ? where id = ?")
        .run(hashPassword(nextPassword), adminRow.id);
      res.json({ ok: true });
    }),
  );

  app.use("/api/admin", admin);

  // ------------------------------------------------------------- SPA fallback
  if (fs.existsSync(config.distDir)) {
    app.use(express.static(config.distDir));
    app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) =>
      res.sendFile(path.join(config.distDir, "index.html")),
    );
  }

  // ------------------------------------------------------------- error handler
  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError)
      return res.status(400).json({ error: `上传失败：${error.message}` });
    if (error?.type === "entity.parse.failed")
      return res.status(400).json({ error: "请求数据格式错误" });
    if (error?.type === "entity.too.large")
      return res.status(413).json({ error: "请求数据过大" });
    if (error instanceof InputError) return res.status(400).json({ error: error.message });
    console.error("server error", error);
    res.status(500).json({ error: "服务暂时不可用" });
  });

  return app;
}

export default createApp;

// 便于脚本直接引用（例如测试）
export const serverFileUrl = import.meta.url;
export const serverDir = path.dirname(fileURLToPath(import.meta.url));
