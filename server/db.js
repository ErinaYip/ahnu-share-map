import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { hashPassword } from "./auth.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export function openDatabase({ databasePath, adminUsername, adminPassword, adminEmail }) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec("pragma journal_mode = WAL");
  db.exec("pragma foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));
  ensureAdmin(db, { adminUsername, adminPassword, adminEmail });
  return db;
}

function ensureAdmin(db, { adminUsername, adminPassword, adminEmail }) {
  const existing = db.prepare("select id from admin_users limit 1").get();
  if (existing) return;
  db.prepare(
    "insert into admin_users(username, email, password_hash, created_at) values(?, ?, ?, ?)",
  ).run(
    adminUsername,
    adminEmail || null,
    hashPassword(adminPassword),
    new Date().toISOString(),
  );
}

export const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const toBool = (value) => Boolean(value);

export function rowToCategory(row) {
  return { ...row, is_active: toBool(row.is_active) };
}

export function rowToField(row) {
  return { ...row, is_active: toBool(row.is_active) };
}

export function rowToReaction(row) {
  return { ...row, is_active: toBool(row.is_active) };
}

export function rowToPlace(row) {
  if (!row) return null;
  return {
    ...row,
    image_urls: parseJson(row.image_urls, []),
    tags: parseJson(row.tags, []),
    highlights: parseJson(row.highlights, []),
    custom_details: parseJson(row.custom_details, {}),
  };
}

export function newQueryCode() {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}
