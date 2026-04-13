const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const dbPath = process.env.DB_PATH || './data/bonna.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    html_content TEXT NOT NULL,
    share_token TEXT UNIQUE,
    is_public INTEGER DEFAULT 0,
    category TEXT DEFAULT 'Genel',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

const queries = {
  getAllArtifacts: db.prepare(`
    SELECT id, title, description, category, is_public, share_token, created_at, updated_at
    FROM artifacts ORDER BY updated_at DESC
  `),

  getArtifactById: db.prepare(`SELECT * FROM artifacts WHERE id = ?`),

  getArtifactByToken: db.prepare(`
    SELECT * FROM artifacts WHERE share_token = ? AND is_public = 1
  `),

  createArtifact: db.prepare(`
    INSERT INTO artifacts (title, description, html_content, share_token, is_public, category)
    VALUES (?, ?, ?, ?, 0, ?)
  `),

  updateArtifact: db.prepare(`
    UPDATE artifacts SET title = ?, description = ?, html_content = ?, category = ?, updated_at = datetime('now')
    WHERE id = ?
  `),

  deleteArtifact: db.prepare(`DELETE FROM artifacts WHERE id = ?`),

  togglePublic: db.prepare(`
    UPDATE artifacts SET is_public = ?, share_token = ?, updated_at = datetime('now') WHERE id = ?
  `),
};

module.exports = {
  db,
  getAllArtifacts: () => queries.getAllArtifacts.all(),
  getArtifactById: (id) => queries.getArtifactById.get(id),
  getArtifactByToken: (token) => queries.getArtifactByToken.get(token),

  createArtifact: (title, description, htmlContent, category = 'Genel') => {
    const token = uuidv4();
    const result = queries.createArtifact.run(title, description, htmlContent, token, category);
    return { id: result.lastInsertRowid, share_token: token };
  },

  updateArtifact: (id, title, description, htmlContent, category) => {
    queries.updateArtifact.run(title, description, htmlContent, category, id);
  },

  deleteArtifact: (id) => {
    queries.deleteArtifact.run(id);
  },

  togglePublic: (id) => {
    const artifact = queries.getArtifactById.get(id);
    if (!artifact) return null;
    const newState = artifact.is_public ? 0 : 1;
    const token = artifact.share_token || uuidv4();
    queries.togglePublic.run(newState, token, id);
    return { is_public: newState, share_token: token };
  },
};
