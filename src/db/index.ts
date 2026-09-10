import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from './migrate.js';

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
