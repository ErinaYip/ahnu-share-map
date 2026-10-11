import path from "node:path";
import fs from "node:fs";

// 本地开发时读取 .env；Docker / 平台通常直接注入环境变量（会覆盖同名键）。
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // .env 损坏时忽略，继续使用真实环境变量。
  }
}

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
};

const root = process.cwd();
const resolvePath = (value, fallback) => path.resolve(root, value || fallback);

export const config = {
  port: number(process.env.PORT, 3000),
  host: process.env.HOST || "0.0.0.0",
  databasePath: resolvePath(process.env.DATABASE_PATH, "data/app.db"),
  uploadDir: resolvePath(process.env.UPLOAD_DIR, "data/uploads"),
  distDir: resolvePath(process.env.DIST_DIR, "dist"),
  maxUploadBytes: number(process.env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
  maxBodyBytes: number(process.env.MAX_BODY_BYTES, 64 * 1024),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  adminEmail: process.env.ADMIN_EMAIL || "",
  sessionTtlHours: number(process.env.SESSION_TTL_HOURS, 12),
  maxSubmissionsPerDay: number(process.env.MAX_SUBMISSIONS_PER_DAY, 5),
  enablePublicSubmissions: bool(process.env.ENABLE_PUBLIC_SUBMISSIONS, true),
  seedDemoPlaces: bool(process.env.SEED_DEMO_PLACES, false),
};

export default config;
