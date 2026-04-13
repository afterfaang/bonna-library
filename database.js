const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// --- Schema ---
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      html_content TEXT NOT NULL,
      category TEXT DEFAULT 'Genel',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_artifacts (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      artifact_id INTEGER NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      assigned_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, artifact_id)
    );
  `);

  // Seed admin user
  const { rows } = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
  if (rows.length === 0) {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'bonna2026';
    const hash = bcrypt.hashSync(adminPass, 10);
    await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, 'admin')`,
      [adminUser, hash, 'Admin']
    );
    console.log(`Seeded admin user: ${adminUser}`);
  }
}

module.exports = {
  initDB,
  pool,

  // --- Auth ---
  authenticate: async (username, password) => {
    const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
    const user = rows[0];
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
  },

  // --- Users ---
  getAllUsers: async () => {
    const { rows } = await pool.query(`SELECT id, username, display_name, role, created_at FROM users ORDER BY role DESC, display_name`);
    return rows;
  },
  getUserById: async (id) => {
    const { rows } = await pool.query(`SELECT id, username, display_name, role, created_at FROM users WHERE id = $1`, [id]);
    return rows[0];
  },
  createUser: async (username, password, displayName, role = 'user') => {
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [username, hash, displayName, role]
    );
    return { id: rows[0].id };
  },
  updateUser: async (id, displayName, role) => {
    await pool.query(`UPDATE users SET display_name = $1, role = $2 WHERE id = $3`, [displayName, role, id]);
  },
  updateUserPassword: async (id, password) => {
    const hash = bcrypt.hashSync(password, 10);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, id]);
  },
  deleteUser: async (id) => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
  },

  // --- Artifacts ---
  getAllArtifacts: async () => {
    const { rows } = await pool.query(`SELECT id, title, description, category, created_at, updated_at FROM artifacts ORDER BY updated_at DESC`);
    return rows;
  },
  getArtifactById: async (id) => {
    const { rows } = await pool.query(`SELECT * FROM artifacts WHERE id = $1`, [id]);
    return rows[0];
  },
  createArtifact: async (title, description, htmlContent, category = 'Genel') => {
    const { rows } = await pool.query(
      `INSERT INTO artifacts (title, description, html_content, category) VALUES ($1, $2, $3, $4) RETURNING id`,
      [title, description, htmlContent, category]
    );
    return { id: rows[0].id };
  },
  updateArtifact: async (id, title, description, htmlContent, category) => {
    await pool.query(
      `UPDATE artifacts SET title = $1, description = $2, html_content = $3, category = $4, updated_at = NOW() WHERE id = $5`,
      [title, description, htmlContent, category, id]
    );
  },
  deleteArtifact: async (id) => {
    await pool.query(`DELETE FROM artifacts WHERE id = $1`, [id]);
  },

  // --- Assignments ---
  setArtifactUsers: async (artifactId, userIds) => {
    await pool.query(`DELETE FROM user_artifacts WHERE artifact_id = $1`, [artifactId]);
    for (const uid of userIds) {
      await pool.query(
        `INSERT INTO user_artifacts (user_id, artifact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [uid, artifactId]
      );
    }
  },
  getArtifactsForUser: async (userId) => {
    const { rows } = await pool.query(`
      SELECT a.id, a.title, a.description, a.category, a.created_at, a.updated_at
      FROM artifacts a
      INNER JOIN user_artifacts ua ON ua.artifact_id = a.id
      WHERE ua.user_id = $1
      ORDER BY a.updated_at DESC
    `, [userId]);
    return rows;
  },
  getUsersForArtifact: async (artifactId) => {
    const { rows } = await pool.query(`
      SELECT u.id, u.username, u.display_name, u.role
      FROM users u
      INNER JOIN user_artifacts ua ON ua.user_id = u.id
      WHERE ua.artifact_id = $1
    `, [artifactId]);
    return rows;
  },
  canUserAccessArtifact: async (userId, artifactId) => {
    const { rows } = await pool.query(`SELECT 1 FROM user_artifacts WHERE user_id = $1 AND artifact_id = $2`, [userId, artifactId]);
    return rows.length > 0;
  },
};
