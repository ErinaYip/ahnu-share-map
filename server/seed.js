import crypto from "node:crypto";
import { rowToPlace } from "./db.js";
import { newQueryCode } from "./db.js";

// 可选的演示数据；默认关闭，需要时用 SEED_DEMO_PLACES=1 打开。
const DEMO_PLACES = [
  {
    name: "校门口麻辣烫",
    recommendation: "人均二十块吃到扶墙出，老板手不抖，汤底每天现熬。",
    category_id: "food",
    latitude: 29.9138,
    longitude: 121.6077,
    address: "风华校区东门外 50 米",
    hours: "10:30 - 22:30",
    price: "20 元",
    best_for: "深夜续命",
    tags: ["麻辣烫", "夜宵"],
    highlights: ["分量足", "价格实惠"],
  },
  {
    name: "静园咖啡",
    recommendation: "自习圣地，插座管够，拿铁做得比连锁店还稳。",
    category_id: "study",
    latitude: 29.9152,
    longitude: 121.6091,
    address: "图书馆西侧一楼",
    hours: "08:00 - 21:00",
    price: "25 元",
    best_for: "赶论文",
    tags: ["咖啡", "自习"],
    highlights: ["安静", "有插座"],
  },
];

export function seedDemoPlaces(db, config) {
  if (!config.seedDemoPlaces) return;
  const existing = db.prepare("select count(*) as total from places").get().total;
  if (existing > 0) return;
  const insert = db.prepare(
    `insert into places(
       id,name,recommendation,category_id,latitude,longitude,address,hours,price,best_for,
       cover_url,image_urls,tags,highlights,custom_details,status,query_code,submitted_at,reviewed_at
     ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const now = new Date().toISOString();
  for (const place of DEMO_PLACES) {
    insert.run(
      crypto.randomUUID(),
      place.name,
      place.recommendation,
      place.category_id,
      place.latitude,
      place.longitude,
      place.address,
      place.hours,
      place.price,
      place.best_for,
      null,
      "[]",
      JSON.stringify(place.tags || []),
      JSON.stringify(place.highlights || []),
      "{}",
      "approved",
      newQueryCode(),
      now,
      now,
    );
  }
  console.log(`[ahnu-share-map] seeded ${DEMO_PLACES.length} demo places`);
}

export { rowToPlace };
