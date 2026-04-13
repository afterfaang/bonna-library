require('dotenv').config();
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const database = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bonna-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT ? true : false,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  },
  ...(process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT ? { proxy: true } : {})
}));

if (process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT) {
  app.set('trust proxy', 1);
}

app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ========================
// AUTH ROUTES
// ========================
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = database.authenticate(username, password);
  if (user) {
    req.session.user = user;
    return res.json({ success: true, user });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.session.user);
});

// ========================
// PAGES
// ========================
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'library.html'));
});

app.get('/view/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'viewer.html'));
});

// ========================
// API: ARTIFACTS
// ========================

// List artifacts (admin sees all, user sees only assigned)
app.get('/api/artifacts', requireAuth, (req, res) => {
  const user = req.session.user;
  if (user.role === 'admin') {
    const artifacts = database.getAllArtifacts();
    // Augment with assigned users
    const result = artifacts.map(a => ({
      ...a,
      assigned_users: database.getUsersForArtifact(a.id)
    }));
    return res.json(result);
  }
  // Regular user: only assigned artifacts
  res.json(database.getArtifactsForUser(user.id));
});

// Get single artifact (admin always, user only if assigned)
app.get('/api/artifacts/:id', requireAuth, (req, res) => {
  const user = req.session.user;
  const artifact = database.getArtifactById(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Not found' });

  if (user.role !== 'admin' && !database.canUserAccessArtifact(user.id, artifact.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(artifact);
});

// Create artifact (admin only)
app.post('/api/artifacts', requireAdmin, upload.single('file'), (req, res) => {
  let htmlContent = '';
  let title = req.body.title || 'Untitled';
  const description = req.body.description || '';
  const category = req.body.category || 'Genel';

  if (req.file) {
    htmlContent = req.file.buffer.toString('utf-8');
    if (!title || title === 'Untitled') {
      title = path.basename(req.file.originalname, '.html').replace(/[_-]/g, ' ');
    }
  } else if (req.body.html_content) {
    htmlContent = req.body.html_content;
  } else {
    return res.status(400).json({ error: 'No content provided' });
  }

  const result = database.createArtifact(title, description, htmlContent, category);

  // Auto-assign to specified users if provided
  if (req.body.assign_users) {
    try {
      const userIds = JSON.parse(req.body.assign_users);
      database.setArtifactUsers(result.id, userIds);
    } catch (e) { /* ignore parse errors */ }
  }

  res.json({ success: true, ...result });
});

// Update artifact (admin only)
app.put('/api/artifacts/:id', requireAdmin, (req, res) => {
  const { title, description, html_content, category } = req.body;
  const existing = database.getArtifactById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  database.updateArtifact(
    req.params.id,
    title || existing.title,
    description !== undefined ? description : existing.description,
    html_content || existing.html_content,
    category || existing.category
  );
  res.json({ success: true });
});

// Delete artifact (admin only)
app.delete('/api/artifacts/:id', requireAdmin, (req, res) => {
  database.deleteArtifact(req.params.id);
  res.json({ success: true });
});

// ========================
// API: ARTIFACT ASSIGNMENTS
// ========================

// Set users for an artifact (admin only)
app.post('/api/artifacts/:id/assign', requireAdmin, (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids must be array' });
  database.setArtifactUsers(req.params.id, user_ids);
  res.json({ success: true, assigned_users: database.getUsersForArtifact(req.params.id) });
});

// Get users assigned to an artifact
app.get('/api/artifacts/:id/users', requireAdmin, (req, res) => {
  res.json(database.getUsersForArtifact(req.params.id));
});

// ========================
// API: USERS (admin only)
// ========================

app.get('/api/users', requireAdmin, (req, res) => {
  const users = database.getAllUsers();
  // Augment with artifact count
  const result = users.map(u => ({
    ...u,
    artifact_count: database.getArtifactsForUser(u.id).length
  }));
  res.json(result);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name) {
    return res.status(400).json({ error: 'username, password, display_name required' });
  }
  try {
    const result = database.createUser(username, password, display_name, role || 'user');
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  const { display_name, role, password } = req.body;
  const user = database.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (display_name || role) {
    database.updateUser(req.params.id, display_name || user.display_name, role || user.role);
  }
  if (password) {
    database.updateUserPassword(req.params.id, password);
  }
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const user = database.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });
  database.deleteUser(req.params.id);
  res.json({ success: true });
});

// ========================
// SEED
// ========================
function seedIfEmpty() {
  const artifacts = database.getAllArtifacts();
  if (artifacts.length === 0) {
    const seedPath = path.join(__dirname, 'artifacts', 'erp-projeksiyon-2026.html');
    if (fs.existsSync(seedPath)) {
      const html = fs.readFileSync(seedPath, 'utf-8');
      database.createArtifact(
        'ERP Alan Projeksiyon Raporu 2026',
        'bonna.com.tr SEO/GEO uyumlu ERP donusum projeksiyon raporu',
        html,
        'ERP'
      );
      console.log('Seeded initial artifact: ERP Projeksiyon 2026');
    }
  }
}

seedIfEmpty();

app.listen(PORT, () => {
  console.log(`Bonna Library running on http://localhost:${PORT}`);
});
