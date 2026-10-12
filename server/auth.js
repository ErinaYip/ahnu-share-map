import crypto from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const expected = Buffer.from(digest, "hex");
  const candidate = crypto.scryptSync(String(password), salt, expected.length);
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export const newToken = () => crypto.randomBytes(32).toString("hex");

export const sha256 = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");
