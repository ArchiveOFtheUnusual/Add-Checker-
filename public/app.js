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
  $('#sheet-note').hidden = true;
  fillInputs();
  refreshList();
}

function fillInputs() {
  $('#project-name').value = project.name;
  for (const el of document.querySelectorAll('[data-main]')) el.value = project.main[el.dataset.main];
  renderAll();
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
    if (data.sheets.length) {
      // The sheet's values win over anything typed but not yet saved (except the project name).
      clearTimeout(saveTimer);
      const name = pending.name;
      pending = name ? { name } : {};
      if (name) flush();
      else $('#save-state').textContent = 'Saved';
      project = { ...data, name: name ?? data.name };
      fillInputs();
      $('#sheet-note').hidden = false;
      $('#sheet-note').textContent = `Filled in from ${data.sheets.join(', ')}. Switch on the platforms you want in the tabs below.`;
    } else {
      applyFiles(data);
      renderAll();
    }
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

function thumbHtml(f) {
  if (f.kind === 'image') return `<img src="${fileUrl(f)}" loading="lazy" alt="">`;
  if (f.kind === 'video') return `<video src="${fileUrl(f)}#t=1" preload="metadata" muted></video>`;
  if (f.kind === 'sheet') return '<div class="doc">DETAILS SHEET</div>';
  return `<div class="doc">${esc(f.name.split('.').pop().toUpperCase())}</div>`;
}

function renderFiles() {
  $('#files').innerHTML = project.files.map((f) => {
    const thumb = thumbHtml(f);
    const dims = f.width ? ` · ${f.width}×${f.height}` : '';
    const dur = f.duration ? ` · ${fmtTime(f.duration)}` : '';
    return `<figure>
      ${thumb}
      <figcaption><span title="${esc(f.name)}">${esc(f.name)}</span>
      <small class="muted">${f.kind === 'sheet' ? 'fills in details' : f.kind} · ${fmtSize(f.size)}${dims}${dur}</small></figcaption>
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

// ---------- platforms (one tab each) ----------
const FIELD_LABEL = { title: 'Title', description: 'Description', tags: 'Tags (comma separated)', price: 'Price (USD)' };
const STATUS_TEXT = { ready: 'Ready', warn: 'Ready (with warnings)', error: 'Needs fixes', off: 'Off' };
let currentTab = 'youtube';

function tabStatus(key) {
  return project.platforms[key].enabled ? project.status[key]?.status || 'ready' : 'off';
}

function showTab(key) {
  if (!key) return;
  currentTab = key;
  renderPlatforms();
}

function renderTabs() {
  $('#platform-tabs').innerHTML = Object.entries(platforms).map(([k, p]) =>
    `<button role="tab" data-tab="${k}" aria-selected="${k === currentTab}" class="tab ${tabStatus(k)}">
      <span class="dot"></span>${esc(p.name)}</button>`
  ).join('');
}

function renderPlatforms() {
  renderTabs();
  const key = currentTab;
  const p = platforms[key];
  const cfg = project.platforms[key];
  const panel = $('#platform-panel');
  panel.innerHTML = '';
  const card = $('#card-tpl').content.firstElementChild.cloneNode(true);
  card.dataset.key = key;
  $('h3', card).textContent = p.name;
  $('.enable', card).checked = cfg.enabled;
  $('.enable-label', card).append(` Prepare for ${p.name}`);
  $('.body', card).hidden = !cfg.enabled;

  const usable = project.files.filter((f) => p.accepts.includes(f.kind));
  const excluded = new Set(cfg.excluded);
  $('.include', card).innerHTML = usable.length
    ? usable.map((f) => `<label class="pick">
        ${thumbHtml(f)}
        <span><input type="checkbox" data-file="${esc(f.name)}" ${excluded.has(f.name) ? '' : 'checked'}> ${esc(f.name)}</span>
      </label>`).join('')
    : `<span class="muted">No ${p.accepts.join(' / ')} files yet</span>`;

  $('.overrides', card).innerHTML = p.fields.map((f) => {
    const input = f === 'description'
      ? `<textarea data-field="${f}" rows="4">${esc(cfg[f] ?? '')}</textarea>`
      : `<input data-field="${f}" value="${esc(cfg[f] ?? '')}">`;
    return `<label class="${f === 'description' || f === 'tags' ? 'wide' : ''}">${FIELD_LABEL[f]}${input}</label>`;
  }).join('');
  $('.sources', card).innerHTML = 'Limits from: ' + p.sources.map((s) => `<a href="${s}" target="_blank" rel="noopener">${esc(new URL(s).hostname)}</a>`).join(', ');
  panel.append(card);
  renderPlaceholders();
  renderStatus();
}

function renderPlaceholders() {
  for (const el of document.querySelectorAll('[data-field]')) el.placeholder = project.main[el.dataset.field] || '';
}

function renderStatus() {
  renderTabs();
  const card = $('#platform-panel .card');
  if (!card) return;
  const st = tabStatus(card.dataset.key);
  const badge = $('.badge', card);
  badge.className = 'badge ' + st;
  badge.textContent = STATUS_TEXT[st];
  const s = project.status[card.dataset.key];
  if (!s) return;
  $('.issues', card).innerHTML = s.issues.map((i) => `<li class="${i.level}">${esc(i.msg)}</li>`).join('');
  $('.preview', card).innerHTML = Object.entries(s.fields).map(([k, v]) => `
    <div class="field"><div class="field-head"><strong>${esc(k)}</strong>
    <button class="copy" data-value="${esc(v)}">Copy</button></div>
    <pre>${esc(v) || '<span class="muted">(empty)</span>'}</pre></div>`).join('');
  $('.export', card).disabled = s.status === 'error';
}

$('#platform-tabs').onclick = (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) showTab(b.dataset.tab);
};

$('#platform-panel').onchange = (e) => {
  if (!e.target.classList.contains('enable')) return;
  const key = currentTab;
  project.platforms[key].enabled = e.target.checked;
  queueSave({ platforms: { [key]: { enabled: e.target.checked } } });
  renderPlatforms();
};

$('#platform-panel').oninput = (e) => {
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

$('#platform-panel').onclick = async (e) => {
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
