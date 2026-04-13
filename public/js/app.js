let artifacts = [];
let currentFilter = 'all';
let uploadedFile = null;

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  loadArtifacts();
  setupSidebar();
  setupAddModal();
  setupLogout();
  setupFileDrop();
});

// --- Load Artifacts ---
async function loadArtifacts() {
  const res = await fetch('/api/artifacts');
  artifacts = await res.json();
  document.getElementById('countAll').textContent = artifacts.length;
  renderArtifacts();
}

// --- Render ---
function renderArtifacts() {
  const grid = document.getElementById('artifactsGrid');
  const empty = document.getElementById('emptyState');
  const filtered = currentFilter === 'all'
    ? artifacts
    : artifacts.filter(a => a.category === currentFilter);

  if (filtered.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  empty.style.display = 'none';

  grid.innerHTML = filtered.map(a => `
    <div class="artifact-card" data-id="${a.id}">
      <div class="artifact-preview" id="preview-${a.id}"></div>
      <div class="artifact-info">
        <div class="artifact-category">${esc(a.category)}</div>
        <div class="artifact-title">${esc(a.title)}</div>
        <div class="artifact-desc">${esc(a.description || '')}</div>
        <div class="artifact-meta">
          <span>${formatDate(a.created_at)}</span>
          <span class="artifact-status ${a.is_public ? 'status-public' : 'status-private'}">
            ${a.is_public ? '&#127760; Public' : '&#128274; Private'}
          </span>
        </div>
      </div>
    </div>
  `).join('');

  // Click handlers
  grid.querySelectorAll('.artifact-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.artifact-actions')) return;
      window.location.href = `/view/${card.dataset.id}`;
    });
  });

  // Load previews (lazy)
  filtered.forEach(a => {
    loadPreview(a.id);
  });
}

async function loadPreview(id) {
  const container = document.getElementById(`preview-${id}`);
  if (!container) return;
  const res = await fetch(`/api/artifacts/${id}`);
  if (!res.ok) return;
  const data = await res.json();
  const blob = new Blob([data.html_content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'width:200%;height:200%;border:none;transform:scale(0.5);transform-origin:top left;pointer-events:none';
  container.appendChild(iframe);
}

// --- Sidebar ---
function setupSidebar() {
  document.querySelectorAll('.sb-item[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      const titles = {
        all: 'Tum Calismalar',
        ERP: 'ERP Calismalari',
        SEO: 'SEO Calismalari',
        Analiz: 'Analizler',
        Strateji: 'Strateji Calismalari',
        Genel: 'Genel Calismalar'
      };
      document.getElementById('pageTitle').textContent = titles[currentFilter] || 'Calismalar';
      renderArtifacts();
    });
  });
}

// --- Add Modal ---
function setupAddModal() {
  document.getElementById('addBtn').addEventListener('click', () => {
    openModal('addModal');
  });

  document.getElementById('saveBtn').addEventListener('click', saveArtifact);
}

async function saveArtifact() {
  const title = document.getElementById('addTitle').value.trim();
  const desc = document.getElementById('addDesc').value.trim();
  const category = document.getElementById('addCategory').value;
  const htmlPaste = document.getElementById('addHtml').value.trim();

  if (!title && !uploadedFile) {
    showToast('Baslik gerekli');
    return;
  }

  let body;
  let headers = {};

  if (uploadedFile) {
    body = new FormData();
    body.append('file', uploadedFile);
    body.append('title', title);
    body.append('description', desc);
    body.append('category', category);
  } else if (htmlPaste) {
    body = JSON.stringify({
      title: title || 'Untitled',
      description: desc,
      html_content: htmlPaste,
      category
    });
    headers['Content-Type'] = 'application/json';
  } else {
    showToast('HTML dosyasi veya kod gerekli');
    return;
  }

  const res = await fetch('/api/artifacts', { method: 'POST', headers, body });
  if (res.ok) {
    closeModal('addModal');
    resetAddForm();
    await loadArtifacts();
    showToast('Calisma eklendi');
  } else {
    showToast('Hata olustu');
  }
}

function resetAddForm() {
  document.getElementById('addTitle').value = '';
  document.getElementById('addDesc').value = '';
  document.getElementById('addHtml').value = '';
  document.getElementById('addCategory').value = 'Genel';
  uploadedFile = null;
  document.getElementById('fileDrop').querySelector('.text').innerHTML = '<strong>HTML dosyasi secin</strong> veya surukleyin';
}

// --- File Drop ---
function setupFileDrop() {
  const drop = document.getElementById('fileDrop');
  const input = document.getElementById('fileInput');

  drop.addEventListener('click', () => input.click());

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });

  drop.addEventListener('dragleave', () => {
    drop.classList.remove('dragover');
  });

  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleFile(input.files[0]);
  });
}

function handleFile(file) {
  uploadedFile = file;
  document.getElementById('fileDrop').querySelector('.text').innerHTML = `<strong>${esc(file.name)}</strong> secildi`;
  if (!document.getElementById('addTitle').value) {
    document.getElementById('addTitle').value = file.name.replace(/\.html?$/i, '').replace(/[_-]/g, ' ');
  }
}

// --- Logout ---
function setupLogout() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

// --- Modal Utils ---
function openModal(id) {
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});

// --- Toast ---
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// --- Utils ---
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}
