import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DATA_DIR = process.env.AGENTPASS_DATA_DIR || path.join(process.cwd(), "data");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function read(name, fallback) {
  ensureDir();
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return structuredClone(fallback);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function write(name, data) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

const DEFAULT_DB = {
  companies: {},
  policies: {},
  ledgers: {},
  authorizations: {},
  receipts: {},
  agents: {},
  meta: { createdAt: null, version: 1 },
};

export function loadDb() {
  const db = read("db", DEFAULT_DB);
  if (!db.meta?.createdAt) {
    db.meta = { createdAt: new Date().toISOString(), version: 1 };
    write("db", db);
  }
  return db;
}

export function saveDb(db) {
  write("db", db);
}

export function id(prefix = "ap") {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function now() {
  return new Date().toISOString();
}
