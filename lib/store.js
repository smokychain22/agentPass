import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.REPODIET_DATA_DIR || path.join(process.cwd(), "data");
const REPOS_DIR = process.env.REPODIET_REPOS_DIR || path.join(process.cwd(), "repos");

export function reposDir() {
  if (!fs.existsSync(REPOS_DIR)) fs.mkdirSync(REPOS_DIR, { recursive: true });
  return REPOS_DIR;
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function dbPath() {
  return path.join(DATA_DIR, "db.json");
}

const DEFAULT = { scans: {}, artifacts: {} };

export function loadDb() {
  ensureData();
  const fp = dbPath();
  if (!fs.existsSync(fp)) return structuredClone(DEFAULT);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return structuredClone(DEFAULT);
  }
}

export function saveDb(db) {
  ensureData();
  fs.writeFileSync(dbPath(), JSON.stringify(db, null, 2));
}

export function id(prefix = "scan") {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
}

export function now() {
  return new Date().toISOString();
}
