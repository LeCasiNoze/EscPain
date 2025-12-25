import Database from "better-sqlite3";
import path from "node:path";

const DB_FILE = process.env.DB_FILE ?? path.join(process.cwd(), "dev.sqlite");

export const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");

export function tx<T>(fn: () => T): T {
  const t = db.transaction(fn);
  return t();
}
