let currentUser = null;
let artifacts = [];
let users = [];
let currentFilter = 'all';
let currentPage = 'artifacts';
let uploadedFile = null;
let assigningArtifactId = null;

// ========================
// INIT
// ========================
document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentUser();
  setupUI();
  await loadArtifacts();
  if (currentUser.role === 'admin') {
    await loadUsers();
  }
  setupLogout();
  setupFileDrop();
  setupModals();
});

async function loadCurrentUser() {
  const res = await fetch('/api/me');
  currentUser = await res.json();
  document.getElementById('userInfo').textContent = `${currentUser.display_name} (${currentUser.role})`;
}

// ========================
// UI SETUP
// ========================
function setupUI() {
  const nav = document.getElementById('sidebarNav');
  const isAdmin = currentUser.role === 'admin';

  if (isAdmin) {
    // Show admin controls
    document.getElementById('adminArtifactActions').style.display = 'block';
    document.getElementById('categoryFilter').style.display = 'block';
    document.getElementById('pageDesc').textContent = 'Tum calismalar — kullanicilara atama yapabilirsiniz';

    // Add categories nav item
    const catBtn = document.createElement('button');
    catBtn.className = 'sb-item';
    catBtn.dataset.page = 'categories';
    catBtn.innerHTML = '<span class="icon">&#128278;</span> Kategoriler <span class="cnt" id="countCategories">0</span>';
    nav.appendChild(catBtn);

    // Add users nav item
    const usersBtn = document.createElement('button');
    usersBtn.className = 'sb-item';
    usersBtn.dataset.page = 'users';
    usersBtn.innerHTML = '<span class="icon">&#128101;</span> Kullanicilar <span class="cnt" id="countUsers">0</span>';
    nav.appendChild(usersBtn);
  } else {
    document.getElementById('pageTitle').textContent = 'Calismalarim';
    document.getElementById('pageDesc').textContent = 'Size atanmis calismalar';
  }

  // Page navigation
  nav.querySelectorAll('.sb-item').forEach(btn => {
    btn.addEventListener('click', () => {
      nav.querySelectorAll('.sb-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      if (page) showPage(page);
    });
  });
}

function showPage(page) {
  currentPage = page;
  document.getElementById('page-artifacts').style.display = page === 'artifacts' ? 'block' : 'none';
  document.getElementById('page-users').style.display = page === 'users' ? 'block' : 'none';
  document.getElementById('page-categories').style.display = page === 'categories' ? 'block' : 'none';
  if (page === 'users') renderUsers();
  if (page === 'categories') renderCategories();
}

// ========================
// ARTIFACTS
// ========================
async function loadArtifacts() {
  const res = await fetch('/api/artifacts');
  artifacts = await res.json();
  document.getElementById('countAll').textContent = artifacts.length;
  renderArtifacts();
}

function buildCategoryFilters() {
  const container = document.getElementById('categoryFilter');
  if (!container || currentUser.role !== 'admin') return;

  const categories = [...new Set(artifacts.map(a => a.category).filter(Boolean))].sort();

  container.innerHTML = `<button class="btn btn-small ${currentFilter === 'all' ? 'btn-sand' : 'btn-outline'}" data-filter="all" style="margin-right:4px">Tumu</button>` +
    categories.map(c =>
      `<button class="btn btn-small ${currentFilter === c ? 'btn-sand' : 'btn-outline'}" data-filter="${esc(c)}" style="margin-right:4px">${esc(c)}</button>`
    ).join('');

  container.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      renderArtifacts();
    });
  });

  // Update category count in sidebar
  const countEl = document.getElementById('countCategories');
  if (countEl) countEl.textContent = categories.length;

  // Also update datalist for add form
  const datalist = document.getElementById('categoryList');
  if (datalist) {
    datalist.innerHTML = categories.map(c => `<option value="${esc(c)}">`).join('');
  }
}

function renderArtifacts() {
  buildCategoryFilters();
  const grid = document.getElementById('artifactsGrid');
  const empty = document.getElementById('emptyState');
  const isAdmin = currentUser.role === 'admin';

  let filtered = currentFilter === 'all'
    ? artifacts
    : artifacts.filter(a => a.category === currentFilter);

  if (filtered.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    document.getElementById('emptyDesc').textContent = isAdmin
      ? 'Bu kategoride calisma yok — yeni ekleyebilirsiniz'
      : 'Henuz size atanmis calisma bulunmuyor';
    return;
  }

  grid.style.display = 'grid';
  empty.style.display = 'none';

  grid.innerHTML = filtered.map(a => {
    const assignedHtml = isAdmin && a.assigned_users
      ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">
          ${a.assigned_users.map(u =>
            `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--sand-light);color:var(--sand);font-weight:600">${esc(u.display_name)}</span>`
          ).join('')}
          ${a.assigned_users.length === 0 ? '<span style="font-size:10px;color:var(--red)">Kimseye atanmadi</span>' : ''}
        </div>`
      : '';

    const assignBtn = isAdmin
      ? `<button class="btn btn-small btn-outline assign-btn" data-id="${a.id}" onclick="event.stopPropagation();openAssignModal(${a.id})" style="margin-top:8px">&#128101; Ata</button>`
      : '';

    const deleteBtn = isAdmin
      ? `<button class="btn btn-small btn-outline delete-btn" onclick="event.stopPropagation();deleteArtifact(${a.id},'${esc(a.title).replace(/'/g, "\\'")}')" style="margin-top:8px;color:var(--red,#c0392b);border-color:var(--red,#c0392b)">&#128465; Sil</button>`
      : '';

    return `
      <div class="artifact-card" data-id="${a.id}">
        <div class="artifact-preview" id="preview-${a.id}"></div>
        <div class="artifact-info">
          <div class="artifact-category">${esc(a.category)}</div>
          <div class="artifact-title">${esc(a.title)}</div>
          <div class="artifact-desc">${esc(a.description || '')}</div>
          ${assignedHtml}
          <div class="artifact-meta" style="margin-top:8px">
            <span>${formatDate(a.created_at)}</span>
            <div style="display:flex;gap:6px">${assignBtn}${deleteBtn}</div>
          </div>
        </div>
      </div>`;
  }).join('');

  // Click to view
  grid.querySelectorAll('.artifact-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.assign-btn') || e.target.closest('.delete-btn')) return;
      window.open(`/view/${card.dataset.id}`, '_blank');
    });
  });

  // Lazy load previews
  filtered.forEach(a => loadPreview(a.id));
}

async function loadPreview(id) {
  const container = document.getElementById(`preview-${id}`);
  if (!container) return;
  try {
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
  } catch (e) { /* silent fail */ }
}

// ========================
// ASSIGN MODAL
// ========================
function openAssignModal(artifactId) {
  assigningArtifactId = artifactId;
  const artifact = artifacts.find(a => a.id === artifactId);
  document.getElementById('assignModalTitle').textContent = `Ata: ${artifact ? artifact.title : ''}`;

  const chips = document.getElementById('assignChips');
  const assignedIds = (artifact.assigned_users || []).map(u => u.id);
  const nonAdminUsers = users.filter(u => u.role !== 'admin');

  chips.innerHTML = nonAdminUsers.map(u => `
    <div class="assign-chip ${assignedIds.includes(u.id) ? 'selected' : ''}" data-uid="${u.id}">
      ${esc(u.display_name)}
    </div>
  `).join('');

  if (nonAdminUsers.length === 0) {
    chips.innerHTML = '<span style="font-size:12px;color:var(--gray)">Henuz kullanici olusturulmadi</span>';
  }

  chips.querySelectorAll('.assign-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });

  openModal('assignModal');
}

async function saveAssignment() {
  const selected = [...document.querySelectorAll('#assignChips .assign-chip.selected')]
    .map(c => parseInt(c.dataset.uid));

  const res = await fetch(`/api/artifacts/${assigningArtifactId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: selected })
  });

  if (res.ok) {
    closeModal('assignModal');
    await loadArtifacts();
    showToast(`${selected.length} kullaniciya atandi`);
  }
}

// ========================
// USERS
// ========================
async function loadUsers() {
  const res = await fetch('/api/users');
  users = await res.json();
  const countEl = document.getElementById('countUsers');
  if (countEl) countEl.textContent = users.length;
}

function renderUsers() {
  const tbody = document.getElementById('usersTableBody');
  const stats = document.getElementById('userStats');
  const nonAdminUsers = users.filter(u => u.role !== 'admin');

  stats.innerHTML = `
    <div class="stat-card"><div class="stat-num">${users.length}</div><div class="stat-label">Toplam Kullanici</div></div>
    <div class="stat-card"><div class="stat-num">${nonAdminUsers.length}</div><div class="stat-label">Normal Kullanici</div></div>
    <div class="stat-card"><div class="stat-num">${artifacts.length}</div><div class="stat-label">Toplam Calisma</div></div>
  `;

  tbody.innerHTML = users.map(u => `
    <tr>
      <td><div class="user-avatar">${esc(u.display_name.charAt(0).toUpperCase())}</div></td>
      <td><strong>${esc(u.username)}</strong></td>
      <td>${esc(u.display_name)}</td>
      <td><span class="role-badge role-${u.role}">${u.role}</span></td>
      <td>${u.artifact_count || 0} calisma</td>
      <td>
        ${u.role !== 'admin' ? `<button class="btn btn-small btn-outline" onclick="deleteUser(${u.id},'${esc(u.display_name)}')">Sil</button>` : '<span style="font-size:11px;color:var(--gray)">—</span>'}
      </td>
    </tr>
  `).join('');
}

async function deleteUser(id, name) {
  if (!confirm(`"${name}" kullanicisini silmek istediginize emin misiniz?`)) return;
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await loadUsers();
    renderUsers();
    showToast('Kullanici silindi');
  }
}

async function saveNewUser() {
  const username = document.getElementById('newUsername').value.trim();
  const displayName = document.getElementById('newDisplayName').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;

  if (!username || !displayName || !password) {
    showToast('Tum alanlari doldurun');
    return;
  }

  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, display_name: displayName, password, role })
  });

  const data = await res.json();
  if (res.ok) {
    closeModal('addUserModal');
    document.getElementById('newUsername').value = '';
    document.getElementById('newDisplayName').value = '';
    document.getElementById('newPassword').value = '';
    await loadUsers();
    renderUsers();
    showToast('Kullanici olusturuldu');
  } else {
    showToast(data.error || 'Hata olustu');
  }
}

// ========================
// CATEGORIES
// ========================
function getCategories() {
  const cats = {};
  artifacts.forEach(a => {
    const c = a.category || 'Genel';
    cats[c] = (cats[c] || 0) + 1;
  });
  return Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0]));
}

function renderCategories() {
  const tbody = document.getElementById('categoriesTableBody');
  const cats = getCategories();

  const countEl = document.getElementById('countCategories');
  if (countEl) countEl.textContent = cats.length;

  tbody.innerHTML = cats.map(([name, count]) => `
    <tr>
      <td><strong>${esc(name)}</strong></td>
      <td>${count} calisma</td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-small btn-outline" onclick="renameCategory('${esc(name).replace(/'/g, "\\'")}')">Yeniden Adlandir</button>
        <button class="btn btn-small btn-outline" onclick="deleteCategory('${esc(name).replace(/'/g, "\\'")}')" style="color:var(--red,#c0392b);border-color:var(--red,#c0392b)">Sil</button>
      </td>
    </tr>
  `).join('');

  if (cats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--gray);padding:24px">Henuz kategori yok</td></tr>';
  }
}

async function renameCategory(oldName) {
  const newName = prompt(`"${oldName}" kategorisinin yeni adi:`, oldName);
  if (!newName || newName.trim() === '' || newName.trim() === oldName) return;

  const res = await fetch('/api/categories/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ old_name: oldName, new_name: newName.trim() })
  });
  if (res.ok) {
    await loadArtifacts();
    renderCategories();
    showToast(`"${oldName}" → "${newName.trim()}" olarak guncellendi`);
  } else {
    showToast('Hata olustu');
  }
}

async function deleteCategory(name) {
  if (!confirm(`"${name}" kategorisini silmek istediginize emin misiniz?\nBu kategorideki calismalar "Genel" kategorisine tasinacak.`)) return;

  const res = await fetch('/api/categories/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (res.ok) {
    if (currentFilter === name) currentFilter = 'all';
    await loadArtifacts();
    renderCategories();
    showToast(`"${name}" kategorisi silindi`);
  } else {
    showToast('Hata olustu');
  }
}

async function addCategory() {
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  if (!name) return showToast('Kategori adi gerekli');

  // Check if already exists
  if (artifacts.some(a => a.category === name)) {
    return showToast('Bu kategori zaten mevcut');
  }

  // Create a placeholder artifact to establish the category, then delete it
  // Actually, just create an empty artifact with this category
  const res = await fetch('/api/artifacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `${name} — Yeni Kategori`,
      description: `${name} kategorisi icin ornek calisma`,
      html_content: `<!DOCTYPE html><html><head><title>${name}</title></head><body><h1>${name}</h1><p>Bu kategori icin icerik ekleyin.</p></body></html>`,
      category: name
    })
  });
  if (res.ok) {
    input.value = '';
    await loadArtifacts();
    renderCategories();
    showToast(`"${name}" kategorisi eklendi`);
  } else {
    showToast('Hata olustu');
  }
}

// ========================
// DELETE ARTIFACT
// ========================
async function deleteArtifact(id, title) {
  if (!confirm(`"${title}" calismasini silmek istediginize emin misiniz?`)) return;
  const res = await fetch(`/api/artifacts/${id}`, { method: 'DELETE' });
  if (res.ok) {
    await loadArtifacts();
    showToast('Calisma silindi');
  } else {
    showToast('Silme islemi basarisiz');
  }
}

// ========================
// ADD ARTIFACT
// ========================
async function saveArtifact() {
  const title = document.getElementById('addTitle').value.trim();
  const desc = document.getElementById('addDesc').value.trim();
  const category = document.getElementById('addCategory').value;
  const htmlPaste = document.getElementById('addHtml').value.trim();

  // Get selected users
  const selectedUsers = [...document.querySelectorAll('#addAssignChips .assign-chip.selected')]
    .map(c => parseInt(c.dataset.uid));

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
    body.append('assign_users', JSON.stringify(selectedUsers));
  } else if (htmlPaste) {
    body = JSON.stringify({
      title: title || 'Untitled',
      description: desc,
      html_content: htmlPaste,
      category,
      assign_users: JSON.stringify(selectedUsers)
    });
    headers['Content-Type'] = 'application/json';
  } else {
    showToast('HTML dosyasi veya kod gerekli');
    return;
  }

  const res = await fetch('/api/artifacts', { method: 'POST', headers, body });
  if (res.ok) {
    const data = await res.json();
    // If we created with JSON and have users, assign separately
    if (selectedUsers.length > 0 && data.id) {
      await fetch(`/api/artifacts/${data.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: selectedUsers })
      });
    }
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
  document.getElementById('addCategory').value = '';
  uploadedFile = null;
  document.getElementById('fileDrop').querySelector('.text').innerHTML = '<strong>HTML dosyasi secin</strong> veya surukleyin';
}

function populateAssignChips(containerId) {
  const container = document.getElementById(containerId);
  const nonAdminUsers = users.filter(u => u.role !== 'admin');
  container.innerHTML = nonAdminUsers.map(u => `
    <div class="assign-chip" data-uid="${u.id}">${esc(u.display_name)}</div>
  `).join('');

  if (nonAdminUsers.length === 0) {
    container.innerHTML = '<span style="font-size:12px;color:var(--gray)">Henuz kullanici yok</span>';
  }

  container.querySelectorAll('.assign-chip').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });
}

// ========================
// FILE DROP
// ========================
function setupFileDrop() {
  const drop = document.getElementById('fileDrop');
  const input = document.getElementById('fileInput');
  if (!drop || !input) return;

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
}

function handleFile(file) {
  uploadedFile = file;
  document.getElementById('fileDrop').querySelector('.text').innerHTML = `<strong>${esc(file.name)}</strong> secildi`;
  if (!document.getElementById('addTitle').value) {
    document.getElementById('addTitle').value = file.name.replace(/\.html?$/i, '').replace(/[_-]/g, ' ');
  }
}

// ========================
// MODALS
// ========================
function setupModals() {
  document.getElementById('saveBtn')?.addEventListener('click', saveArtifact);
  document.getElementById('saveAssignBtn')?.addEventListener('click', saveAssignment);
  document.getElementById('saveUserBtn')?.addEventListener('click', saveNewUser);

  document.getElementById('addBtn')?.addEventListener('click', () => {
    populateAssignChips('addAssignChips');
    openModal('addModal');
  });

  document.getElementById('addUserBtn')?.addEventListener('click', () => openModal('addUserModal'));
  document.getElementById('addCategoryBtn')?.addEventListener('click', addCategory);
  document.getElementById('newCategoryInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCategory(); });

  // Close on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ========================
// LOGOUT
// ========================
function setupLogout() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

// ========================
// TOAST
// ========================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ========================
// UTILS
// ========================
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}
