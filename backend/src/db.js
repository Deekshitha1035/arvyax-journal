const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/journal.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ambience TEXT NOT NULL CHECK(ambience IN ('forest','ocean','mountain','desert','meadow')),
      text TEXT NOT NULL,
      emotion TEXT,
      keywords TEXT,
      summary TEXT,
      analyzed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_id ON journal_entries(user_id);
    CREATE INDEX IF NOT EXISTS idx_created_at ON journal_entries(created_at);

    CREATE TABLE IF NOT EXISTS analysis_cache (
      text_hash TEXT PRIMARY KEY,
      emotion TEXT NOT NULL,
      keywords TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log('✅ Database initialized');
}

module.exports = { getDb, initDb };
