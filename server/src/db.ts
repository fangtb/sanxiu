import './env.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const defaultDbPath = path.resolve(process.cwd(), 'data', 'app.db');
const dbPath = path.resolve(process.env.DB_PATH ?? defaultDbPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      daily_goal INTEGER NOT NULL DEFAULT 30 CHECK (daily_goal BETWEEN 1 AND 200),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS study_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('word', 'sentence')),
      text TEXT NOT NULL,
      meaning TEXT,
      example TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'learning', 'mastered')),
      review_stage INTEGER NOT NULL DEFAULT 0,
      next_review_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user_id, type, text)
    );

    CREATE INDEX IF NOT EXISTS idx_study_items_user_next_review
      ON study_items(user_id, next_review_at, status);

    CREATE TABLE IF NOT EXISTS daily_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      task_date TEXT NOT NULL,
      target_count INTEGER NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (user_id, task_date)
    );

    CREATE TABLE IF NOT EXISTS daily_task_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'remembered', 'forgotten')),
      attempts INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES study_items(id) ON DELETE CASCADE,
      UNIQUE (task_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_daily_task_items_task_state
      ON daily_task_items(task_id, state);

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      task_item_id INTEGER,
      result TEXT NOT NULL CHECK (result IN ('remembered', 'forgotten')),
      previous_stage INTEGER NOT NULL,
      next_stage INTEGER NOT NULL,
      next_review_at TEXT NOT NULL,
      reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES study_items(id) ON DELETE CASCADE,
      FOREIGN KEY (task_item_id) REFERENCES daily_task_items(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS semantic_related_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      source_item_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      meaning TEXT,
      context TEXT,
      difference TEXT,
      formality TEXT,
      tags TEXT,
      added_to_library_item_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_item_id) REFERENCES study_items(id) ON DELETE CASCADE,
      FOREIGN KEY (added_to_library_item_id) REFERENCES study_items(id) ON DELETE SET NULL,
      UNIQUE (source_item_id, text)
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_related_items_source
      ON semantic_related_items(user_id, source_item_id);

    CREATE TABLE IF NOT EXISTS conversation_demos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      source_item_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      scenario TEXT,
      dialogue TEXT NOT NULL,
      key_points TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_item_id) REFERENCES study_items(id) ON DELETE CASCADE,
      UNIQUE (source_item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_demos_source
      ON conversation_demos(user_id, source_item_id);
  `);
}

