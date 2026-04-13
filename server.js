require('dotenv').config();
const express = require('express');
const session = require('express-session');
const compression = require('compression');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('./middleware/auth');
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
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax'
  },
  ...(process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT ? { proxy: true } : {})
}));

if (process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT) {
  app.set('trust proxy', 1);
}

app.use(express.static(path.join(__dirname, 'public')));

// Upload config
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// --- Auth Routes ---
app.get('/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'bonna2026';

  if (username === adminUser && password === adminPass) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ success: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Public Route (no auth) ---
app.get('/public/:token', (req, res) => {
  const artifact = database.getArtifactByToken(req.params.token);
  if (!artifact) return res.status(404).sendFile(path.join(__dirname, 'views', 'not-found.html'));
  res.sendFile(path.join(__dirname, 'views', 'public-viewer.html'));
});

app.get('/api/public/:token', (req, res) => {
  const artifact = database.getArtifactByToken(req.params.token);
  if (!artifact) return res.status(404).json({ error: 'Not found' });
  res.json({
    title: artifact.title,
    description: artifact.description,
    html_content: artifact.html_content,
    category: artifact.category,
    created_at: artifact.created_at
  });
});

// --- Protected Routes ---
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'library.html'));
});

app.get('/view/:id', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'viewer.html'));
});

// --- API: Artifacts ---
app.get('/api/artifacts', requireAuth, (req, res) => {
  res.json(database.getAllArtifacts());
});

app.get('/api/artifacts/:id', requireAuth, (req, res) => {
  const artifact = database.getArtifactById(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Not found' });
  res.json(artifact);
});

app.post('/api/artifacts', requireAuth, upload.single('file'), (req, res) => {
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
  res.json({ success: true, ...result });
});

app.put('/api/artifacts/:id', requireAuth, (req, res) => {
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

app.delete('/api/artifacts/:id', requireAuth, (req, res) => {
  database.deleteArtifact(req.params.id);
  res.json({ success: true });
});

app.post('/api/artifacts/:id/share', requireAuth, (req, res) => {
  const result = database.togglePublic(req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

// --- Seed Initial Artifact ---
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
