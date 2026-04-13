const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || './data/bonna.db';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    html_content TEXT NOT NULL,
    category TEXT DEFAULT 'Genel',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_artifacts (
    user_id INTEGER NOT NULL,
    artifact_id INTEGER NOT NULL,
    assigned_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, artifact_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
  );
`);

// --- Seed admin user ---
const adminExists = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
if (!adminExists) {
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'bonna2026';
  const hash = bcrypt.hashSync(adminPass, 10);
  db.prepare(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, 'admin')`)
    .run(adminUser, hash, 'Admin');
  console.log(`Seeded admin user: ${adminUser}`);
}

// --- Queries ---
const q = {
  // Users
  getUserByUsername: db.prepare(`SELECT * FROM users WHERE username = ?`),
  getUserById: db.prepare(`SELECT id, username, display_name, role, created_at FROM users WHERE id = ?`),
  getAllUsers: db.prepare(`SELECT id, username, display_name, role, created_at FROM users ORDER BY role DESC, display_name`),
  createUser: db.prepare(`INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)`),
  updateUser: db.prepare(`UPDATE users SET display_name = ?, role = ? WHERE id = ?`),
  updateUserPassword: db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`),
  deleteUser: db.prepare(`DELETE FROM users WHERE id = ?`),

  // Artifacts
  getAllArtifacts: db.prepare(`
    SELECT id, title, description, category, created_at, updated_at
    FROM artifacts ORDER BY updated_at DESC
  `),
  getArtifactById: db.prepare(`SELECT * FROM artifacts WHERE id = ?`),
  getArtifactMeta: db.prepare(`SELECT id, title, description, category, created_at, updated_at FROM artifacts WHERE id = ?`),
  createArtifact: db.prepare(`INSERT INTO artifacts (title, description, html_content, category) VALUES (?, ?, ?, ?)`),
  updateArtifact: db.prepare(`UPDATE artifacts SET title = ?, description = ?, html_content = ?, category = ?, updated_at = datetime('now') WHERE id = ?`),
  deleteArtifact: db.prepare(`DELETE FROM artifacts WHERE id = ?`),

  // User-Artifact assignments
  assignArtifact: db.prepare(`INSERT OR IGNORE INTO user_artifacts (user_id, artifact_id) VALUES (?, ?)`),
  unassignArtifact: db.prepare(`DELETE FROM user_artifacts WHERE user_id = ? AND artifact_id = ?`),
  unassignAllForArtifact: db.prepare(`DELETE FROM user_artifacts WHERE artifact_id = ?`),
  getArtifactsForUser: db.prepare(`
    SELECT a.id, a.title, a.description, a.category, a.created_at, a.updated_at
    FROM artifacts a
    INNER JOIN user_artifacts ua ON ua.artifact_id = a.id
    WHERE ua.user_id = ?
    ORDER BY a.updated_at DESC
  `),
  getUsersForArtifact: db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role
    FROM users u
    INNER JOIN user_artifacts ua ON ua.user_id = u.id
    WHERE ua.artifact_id = ?
  `),
  isArtifactAssignedToUser: db.prepare(`SELECT 1 FROM user_artifacts WHERE user_id = ? AND artifact_id = ?`),
};

module.exports = {
  db,

  // --- Auth ---
  authenticate: (username, password) => {
    const user = q.getUserByUsername.get(username);
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
  },

  // --- Users ---
  getAllUsers: () => q.getAllUsers.all(),
  getUserById: (id) => q.getUserById.get(id),
  createUser: (username, password, displayName, role = 'user') => {
    const hash = bcrypt.hashSync(password, 10);
    const result = q.createUser.run(username, hash, displayName, role);
    return { id: result.lastInsertRowid };
  },
  updateUser: (id, displayName, role) => {
    q.updateUser.run(displayName, role, id);
  },
  updateUserPassword: (id, password) => {
    const hash = bcrypt.hashSync(password, 10);
    q.updateUserPassword.run(hash, id);
  },
  deleteUser: (id) => {
    q.deleteUser.run(id);
  },

  // --- Artifacts ---
  getAllArtifacts: () => q.getAllArtifacts.all(),
  getArtifactById: (id) => q.getArtifactById.get(id),
  getArtifactMeta: (id) => q.getArtifactMeta.get(id),
  createArtifact: (title, description, htmlContent, category = 'Genel') => {
    const result = q.createArtifact.run(title, description, htmlContent, category);
    return { id: result.lastInsertRowid };
  },
  updateArtifact: (id, title, description, htmlContent, category) => {
    q.updateArtifact.run(title, description, htmlContent, category, id);
  },
  deleteArtifact: (id) => {
    q.deleteArtifact.run(id);
  },

  // --- Assignments ---
  assignArtifact: (userId, artifactId) => q.assignArtifact.run(userId, artifactId),
  unassignArtifact: (userId, artifactId) => q.unassignArtifact.run(userId, artifactId),
  setArtifactUsers: (artifactId, userIds) => {
    const del = db.prepare(`DELETE FROM user_artifacts WHERE artifact_id = ?`);
    const ins = db.prepare(`INSERT OR IGNORE INTO user_artifacts (user_id, artifact_id) VALUES (?, ?)`);
    const tx = db.transaction((aId, uIds) => {
      del.run(aId);
      for (const uid of uIds) ins.run(uid, aId);
    });
    tx(artifactId, userIds);
  },
  getArtifactsForUser: (userId) => q.getArtifactsForUser.all(userId),
  getUsersForArtifact: (artifactId) => q.getUsersForArtifact.all(artifactId),
  canUserAccessArtifact: (userId, artifactId) => !!q.isArtifactAssignedToUser.get(userId, artifactId),
};
