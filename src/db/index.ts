import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { SqlBackend } from './backend.js';
import { migrate } from './migrate.js';
import { SqliteBackend } from './sqliteBackend.js';

export type DB = Database.Database;

export function openDatabase(path: string): DB {
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { recursive: true });

  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);

  return db;
}

/** Opens (and migrates) the local dev/test corpus, wrapped as a `SqlBackend`. */
export function openLocalBackend(path: string): { db: DB; backend: SqlBackend } {
  const db = openDatabase(path);
  return { db, backend: new SqliteBackend(db) };
}
