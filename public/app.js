const $ = (s, el = document) => el.querySelector(s);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtSize = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB');
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const fileUrl = (f) => `/api/projects/${project.id}/files/${encodeURIComponent(f.name)}`;

let platforms = {};
let projects = [];
let project = null;

async function init() {
  platforms = await api('/api/platforms');
  await refreshList();
  const last = location.hash.slice(1);
  if (projects.some((p) => p.id === last)) open(last);
}

async function refreshList() {
  projects = await api('/api/projects');
  $('#projects').innerHTML = projects.map((p) => {
    const chips = Object.entries(p.status)
      .map(([k, s]) => `<span class="chip ${s.status}" title="${esc(platforms[k].name)}: ${s.status}">${esc(platforms[k].name)}</span>`)
      .join('');
    return `<li data-id="${p.id}" class="${project?.id === p.id ? 'active' : ''}">
      <strong>${esc(p.name)}</strong>
      <span class="muted">${p.files.length} file${p.files.length === 1 ? '' : 's'}</span>
      <div class="chips">${chips || '<span class="muted">no platforms picked</span>'}</div>
    </li>`;
  }).join('');
}

$('#projects').onclick = (e) => {
  const li = e.target.closest('li');
  if (li) open(li.dataset.id);
};

$('#new-project').onsubmit = async (e) => {
  e.preventDefault();
  const p = await api('/api/projects', { method: 'POST', body: { name: e.target.name.value } });
  e.target.reset();
  await open(p.id);
};

async function open(id) {
  project = await api(`/api/projects/${id}`);
  location.hash = id;
  $('#empty').hidden = true;
  $('#editor').hidden = false;
  $('#project-name').value = project.name;
  for (const el of document.querySelectorAll('[data-main]')) el.value = project.main[el.dataset.main];
  renderAll();
  refreshList();
}

function renderAll() {
  renderFiles();
  renderPlatforms();
}

// ---------- saving ----------
let saveTimer;
let pending = {};
function queueSave(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'platforms') {
      pending.platforms ??= {};
      for (const [pk, pv] of Object.entries(v)) pending.platforms[pk] = { ...pending.platforms[pk], ...pv };
    } else if (k === 'main') pending.main = { ...pending.main, ...v };
    else pending[k] = v;
  }
  $('#save-state').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}
async function flush() {
  const body = pending;
  pending = {};
  try {
    const updated = await api(`/api/projects/${project.id}`, { method: 'PUT', body });
    project.status = updated.status;
    project.name = updated.name;
    $('#save-state').textContent = 'Saved';
    renderStatus();
    refreshList();
  } catch (e) {
    $('#save-state').textContent = 'Save failed: ' + e.message;
  }
}

$('#project-name').oninput = (e) => queueSave({ name: e.target.value });
for (const el of document.querySelectorAll('[data-main]')) {
  el.oninput = () => {
    project.main[el.dataset.main] = el.value;
    queueSave({ main: { [el.dataset.main]: el.value } });
    renderPlaceholders();
  };
}

$('#delete-project').onclick = async () => {
  if (!confirm(`Delete "${project.name}" and all its files?`)) return;
  await api(`/api/projects/${project.id}`, { method: 'DELETE' });
  project = null;
  location.hash = '';
  $('#editor').hidden = true;
  $('#empty').hidden = false;
  refreshList();
};

// ---------- files ----------
const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(e.dataTransfer.files); };
$('#file-input').onchange = (e) => { uploadFiles(e.target.files); e.target.value = ''; };

function uploadFiles(list) {
  if (!list.length) return;
  const form = new FormData();
  for (const f of list) form.append('files', f);
  const before = new Set(project.files.map((f) => f.name));
  const xhr = new XMLHttpRequest();
  const prog = $('#progress');
  prog.hidden = false;
  xhr.upload.onprogress = (e) => {
    const pct = e.lengthComputable ? (e.loaded / e.total) * 100 : 0;
    $('.bar > div', prog).style.width = pct + '%';
    $('span', prog).textContent = `Uploading ${list.length} file(s): ${fmtSize(e.loaded)} / ${fmtSize(e.total)}`;
  };
  xhr.onload = async () => {
    prog.hidden = true;
    const data = JSON.parse(xhr.responseText);
    if (xhr.status !== 200) return alert('Upload failed: ' + data.error);
    applyFiles(data);
    renderAll();
    refreshList();
    for (const f of project.files) if (!before.has(f.name)) measure(f);
  };
  xhr.onerror = () => { prog.hidden = true; alert('Upload failed (connection lost)'); };
  xhr.open('POST', `/api/projects/${project.id}/files`);
  xhr.send(form);
}

// Take only file data from the server so unsaved typing isn't overwritten.
function applyFiles(data) {
  project.files = data.files;
  project.status = data.status;
}

// Read dimensions/duration in the browser, then store them on the server for validation.
function measure(f) {
  if (f.kind === 'other') return;
  const done = async (meta) => {
    if (!meta.width) return;
    applyFiles(await api(`${fileUrl(f)}/meta`, { method: 'PUT', body: meta }));
    renderAll();
    refreshList();
  };
  if (f.kind === 'image') {
    const img = new Image();
    img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
    img.src = fileUrl(f);
  } else {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.src = fileUrl(f);
  }
}

function renderFiles() {
  $('#files').innerHTML = project.files.map((f) => {
    const thumb = f.kind === 'image' ? `<img src="${fileUrl(f)}" loading="lazy" alt="">`
      : f.kind === 'video' ? `<video src="${fileUrl(f)}#t=1" preload="metadata" muted></video>`
      : `<div class="doc">${esc(f.name.split('.').pop().toUpperCase())}</div>`;
    const dims = f.width ? ` · ${f.width}×${f.height}` : '';
    const dur = f.duration ? ` · ${fmtTime(f.duration)}` : '';
    return `<figure>
      ${thumb}
      <figcaption><span title="${esc(f.name)}">${esc(f.name)}</span>
      <small class="muted">${f.kind} · ${fmtSize(f.size)}${dims}${dur}</small></figcaption>
      <button class="remove" data-name="${esc(f.name)}" title="Remove">×</button>
    </figure>`;
  }).join('');
}

$('#files').onclick = async (e) => {
  const b = e.target.closest('.remove');
  if (!b || !confirm(`Remove ${b.dataset.name}?`)) return;
  applyFiles(await api(`/api/projects/${project.id}/files/${encodeURIComponent(b.dataset.name)}`, { method: 'DELETE' }));
  renderAll();
  refreshList();
};

// ---------- platforms ----------
const FIELD_LABEL = { title: 'Title', description: 'Description', tags: 'Tags (comma separated)', price: 'Price (USD)' };

function renderPlatforms() {
  $('#platform-toggles').innerHTML = Object.entries(platforms).map(([k, p]) =>
    `<label class="toggle"><input type="checkbox" data-toggle="${k}" ${project.platforms[k].enabled ? 'checked' : ''}> ${esc(p.name)}</label>`
  ).join('');

  const cards = $('#platform-cards');
  cards.innerHTML = '';
  for (const [key, p] of Object.entries(platforms)) {
    const cfg = project.platforms[key];
    if (!cfg.enabled) continue;
    const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
    card.dataset.key = key;
    $('h3', card).textContent = p.name;
    $('.overrides', card).innerHTML = p.fields.map((f) => {
      const input = f === 'description'
        ? `<textarea data-field="${f}" rows="4">${esc(cfg[f] ?? '')}</textarea>`
        : `<input data-field="${f}" value="${esc(cfg[f] ?? '')}">`;
      return `<label class="${f === 'description' || f === 'tags' ? 'wide' : ''}">${FIELD_LABEL[f]}${input}</label>`;
    }).join('');
    const excluded = new Set(cfg.excluded);
    const usable = project.files.filter((f) => p.accepts.includes(f.kind));
    $('.include', card).innerHTML = usable.length
      ? usable.map((f) => `<label><input type="checkbox" data-file="${esc(f.name)}" ${excluded.has(f.name) ? '' : 'checked'}> ${esc(f.name)}</label>`).join('')
      : `<span class="muted">No ${p.accepts.join('/')} files yet</span>`;
    $('.sources', card).innerHTML = 'Limits from: ' + p.sources.map((s) => `<a href="${s}" target="_blank" rel="noopener">${esc(new URL(s).hostname)}</a>`).join(', ');
    cards.append(card);
  }
  renderPlaceholders();
  renderStatus();
}

function renderPlaceholders() {
  for (const el of document.querySelectorAll('[data-field]')) el.placeholder = project.main[el.dataset.field] || '';
}

function renderStatus() {
  for (const card of document.querySelectorAll('.card')) {
    const s = project.status[card.dataset.key];
    if (!s) continue;
    const badge = $('.badge', card);
    badge.className = 'badge ' + s.status;
    badge.textContent = { ready: 'Ready', warn: 'Ready (with warnings)', error: 'Needs fixes' }[s.status];
    $('.issues', card).innerHTML = s.issues.map((i) => `<li class="${i.level}">${esc(i.msg)}</li>`).join('');
    $('.preview', card).innerHTML = Object.entries(s.fields).map(([k, v]) => `
      <div class="field"><div class="field-head"><strong>${esc(k)}</strong>
      <button class="copy" data-value="${esc(v)}">Copy</button></div>
      <pre>${esc(v) || '<span class="muted">(empty)</span>'}</pre></div>`).join('');
    $('.export', card).disabled = s.status === 'error';
  }
}

$('#platform-toggles').onchange = (e) => {
  const key = e.target.dataset.toggle;
  project.platforms[key].enabled = e.target.checked;
  queueSave({ platforms: { [key]: { enabled: e.target.checked } } });
  renderPlatforms();
};

$('#platform-cards').oninput = (e) => {
  const card = e.target.closest('.card');
  const key = card.dataset.key;
  const cfg = project.platforms[key];
  if (e.target.dataset.field) {
    cfg[e.target.dataset.field] = e.target.value;
    queueSave({ platforms: { [key]: { [e.target.dataset.field]: e.target.value } } });
  } else if (e.target.dataset.file !== undefined) {
    cfg.excluded = [...card.querySelectorAll('[data-file]')].filter((c) => !c.checked).map((c) => c.dataset.file);
    queueSave({ platforms: { [key]: { excluded: cfg.excluded } } });
  }
};

$('#platform-cards').onclick = async (e) => {
  if (e.target.classList.contains('copy')) {
    await navigator.clipboard.writeText(e.target.dataset.value);
    e.target.textContent = 'Copied';
    setTimeout(() => (e.target.textContent = 'Copy'), 1200);
  }
  if (e.target.classList.contains('export')) {
    const card = e.target.closest('.card');
    const out = $('.export-result', card);
    clearTimeout(saveTimer);
    if (Object.keys(pending).length) await flush();
    try {
      out.textContent = 'Exporting…';
      const r = await api(`/api/projects/${project.id}/export/${card.dataset.key}`, { method: 'POST' });
      out.innerHTML = `Saved to <code>${esc(r.dir)}</code> <button class="open-folder" data-dir="${esc(r.dir)}">Open folder</button>`;
    } catch (err) {
      out.textContent = err.message;
    }
  }
  if (e.target.classList.contains('open-folder')) {
    api('/api/open-folder', { method: 'POST', body: { dir: e.target.dataset.dir } }).catch((err) => alert(err.message));
  }
};

init();
