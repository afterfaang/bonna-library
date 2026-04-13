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

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await database.authenticate(username, password);
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

app.get('/api/artifacts', requireAuth, async (req, res) => {
  const user = req.session.user;
  if (user.role === 'admin') {
    const artifacts = await database.getAllArtifacts();
    const result = [];
    for (const a of artifacts) {
      result.push({ ...a, assigned_users: await database.getUsersForArtifact(a.id) });
    }
    return res.json(result);
  }
  res.json(await database.getArtifactsForUser(user.id));
});

app.get('/api/artifacts/:id', requireAuth, async (req, res) => {
  const user = req.session.user;
  const artifact = await database.getArtifactById(req.params.id);
  if (!artifact) return res.status(404).json({ error: 'Not found' });

  if (user.role !== 'admin' && !(await database.canUserAccessArtifact(user.id, artifact.id))) {
    return res.status(403).json({ error: 'Access denied' });
  }
  res.json(artifact);
});

app.post('/api/artifacts', requireAdmin, upload.single('file'), async (req, res) => {
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

  const result = await database.createArtifact(title, description, htmlContent, category);

  if (req.body.assign_users) {
    try {
      const userIds = JSON.parse(req.body.assign_users);
      await database.setArtifactUsers(result.id, userIds);
    } catch (e) { /* ignore parse errors */ }
  }

  res.json({ success: true, ...result });
});

app.put('/api/artifacts/:id', requireAdmin, async (req, res) => {
  const { title, description, html_content, category } = req.body;
  const existing = await database.getArtifactById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  await database.updateArtifact(
    req.params.id,
    title || existing.title,
    description !== undefined ? description : existing.description,
    html_content || existing.html_content,
    category || existing.category
  );
  res.json({ success: true });
});

app.delete('/api/artifacts/:id', requireAdmin, async (req, res) => {
  await database.deleteArtifact(req.params.id);
  res.json({ success: true });
});

// ========================
// API: CATEGORIES
// ========================

app.post('/api/categories/rename', requireAdmin, async (req, res) => {
  const { old_name, new_name } = req.body;
  if (!old_name || !new_name) return res.status(400).json({ error: 'old_name and new_name required' });
  await database.pool.query(
    `UPDATE artifacts SET category = $1, updated_at = NOW() WHERE category = $2`,
    [new_name.trim(), old_name]
  );
  res.json({ success: true });
});

app.post('/api/categories/delete', requireAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  await database.pool.query(
    `UPDATE artifacts SET category = 'Genel', updated_at = NOW() WHERE category = $1`,
    [name]
  );
  res.json({ success: true });
});

// ========================
// API: ARTIFACT ASSIGNMENTS
// ========================

app.post('/api/artifacts/:id/assign', requireAdmin, async (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids must be array' });
  await database.setArtifactUsers(req.params.id, user_ids);
  res.json({ success: true, assigned_users: await database.getUsersForArtifact(req.params.id) });
});

app.get('/api/artifacts/:id/users', requireAdmin, async (req, res) => {
  res.json(await database.getUsersForArtifact(req.params.id));
});

// ========================
// API: USERS (admin only)
// ========================

app.get('/api/users', requireAdmin, async (req, res) => {
  const users = await database.getAllUsers();
  const result = [];
  for (const u of users) {
    const arts = await database.getArtifactsForUser(u.id);
    result.push({ ...u, artifact_count: arts.length });
  }
  res.json(result);
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name) {
    return res.status(400).json({ error: 'username, password, display_name required' });
  }
  try {
    const result = await database.createUser(username, password, display_name, role || 'user');
    res.json({ success: true, ...result });
  } catch (e) {
    if (e.message.includes('unique') || e.message.includes('duplicate')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/users/:id', requireAdmin, async (req, res) => {
  const { display_name, role, password } = req.body;
  const user = await database.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (display_name || role) {
    await database.updateUser(req.params.id, display_name || user.display_name, role || user.role);
  }
  if (password) {
    await database.updateUserPassword(req.params.id, password);
  }
  res.json({ success: true });
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const user = await database.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Cannot delete admin' });
  await database.deleteUser(req.params.id);
  res.json({ success: true });
});

// ========================
// SEED & START
// ========================
async function seedIfEmpty() {
  const artifacts = await database.getAllArtifacts();
  if (artifacts.length === 0) {
    const seedData = [
      { file: 'Bonna_ERP_Projeksiyon_2026.html', title: 'ERP Alan Projeksiyon Raporu 2026', description: 'bonna.com.tr SEO/GEO uyumlu ERP dönüşüm projeksiyon raporu', category: 'ERP' },
      { file: 'bonna-cati-iletisim-stratejisi.html', title: 'Çatı İletişim Stratejisi', description: 'Bonna markası için bütünleşik çatı iletişim stratejisi', category: 'İletişim' },
      { file: 'bonna-iletisim-stratejileri.html', title: 'İletişim Stratejileri', description: 'Bonna iletişim kanalları ve mesaj stratejileri', category: 'İletişim' },
      { file: 'bonna-fikir-havuzu.html', title: 'Fikir Havuzu', description: 'Pazarlama ve iletişim fikir havuzu', category: 'Strateji' },
      { file: 'Bonna_AI_Content_Mimarisi_2026.html', title: 'AI İçerik Mimarisi 2026', description: 'AI destekli içerik üretim ve yönetim mimarisi', category: 'AI' },
      { file: 'Bonna_Mikro_Hedefleme_2026_v4.html', title: 'Mikro Hedefleme 2026', description: 'Segmentasyon bazlı mikro hedefleme stratejisi', category: 'Pazarlama' },
      { file: 'Bonna_Pazarlama_Plani_2026_v4.html', title: 'Pazarlama Planı 2026', description: '2026 yılı kapsamlı pazarlama planı', category: 'Pazarlama' },
      { file: 'Bonna_Pazarlama_Plani_Yapisi_2026.html', title: 'Pazarlama Planı Yapısı 2026', description: 'Pazarlama planı çerçeve yapısı ve organizasyonu', category: 'Pazarlama' },
      { file: 'Bonna_SEO_GEO_Strateji_2026.html', title: 'SEO/GEO Strateji 2026', description: 'Arama motoru ve coğrafi optimizasyon stratejisi', category: 'SEO' },
      { file: 'pazarlama-yol-haritasi-2026.html', title: 'Pazarlama Yol Haritası 2026-2027', description: 'HubSpot metrikleri ve mailing performans dashboard', category: 'Performans' }
    ];

    let seeded = 0;
    for (const item of seedData) {
      const seedPath = path.join(__dirname, 'artifacts', item.file);
      if (fs.existsSync(seedPath)) {
        const html = fs.readFileSync(seedPath, 'utf-8');
        await database.createArtifact(item.title, item.description, html, item.category);
        seeded++;
      }
    }
    console.log(`Seeded ${seeded} artifacts`);
  }
}

async function start() {
  await database.initDB();
  await seedIfEmpty();
  app.listen(PORT, () => {
    console.log(`Bonna Library running on http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
