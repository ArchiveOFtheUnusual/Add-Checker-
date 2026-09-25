const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { PLATFORMS, kindOf, effectiveMeta, platformFiles, check } = require('./platforms');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'projects');
const EXPORTS = path.join(ROOT, 'exports');
const PORT = Number(process.env.PORT) || 3000;
fs.mkdirSync(DATA, { recursive: true });

const projectDir = (id) => {
  if (!/^[a-f0-9]{12}$/.test(id)) throw httpError(400, 'Bad project id');
  return path.join(DATA, id);
};
const safeName = (name) => path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'file';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'project';

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function load(id) {
  const file = path.join(projectDir(id), 'project.json');
  if (!fs.existsSync(file)) throw httpError(404, 'Project not found');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(p) {
  p.updatedAt = new Date().toISOString();
  const file = path.join(projectDir(p.id), 'project.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(p, null, 2));
  fs.renameSync(file + '.tmp', file);
  return p;
}

function withStatus(p) {
  const status = {};
  for (const key of Object.keys(PLATFORMS)) {
    if (p.platforms[key]?.enabled) status[key] = { ...check(p, key), fields: PLATFORMS[key].format(effectiveMeta(p, key)) };
  }
  return { ...p, status };
}

function newProject(name) {
  const platforms = {};
  for (const key of Object.keys(PLATFORMS)) platforms[key] = { enabled: false, excluded: [] };
  return {
    id: crypto.randomBytes(6).toString('hex'),
    name,
    createdAt: new Date().toISOString(),
    main: { title: '', description: '', tags: '', price: '' },
    platforms,
    files: [],
  };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

app.get('/api/platforms', (req, res) => {
  const out = {};
  for (const [k, p] of Object.entries(PLATFORMS)) out[k] = { name: p.name, fields: p.fields, accepts: p.accepts, sources: p.sources };
  res.json(out);
});

app.get('/api/projects', wrap((req, res) => {
  fs.mkdirSync(DATA, { recursive: true });
  const list = fs.readdirSync(DATA)
    .filter((id) => fs.existsSync(path.join(DATA, id, 'project.json')))
    .map((id) => withStatus(load(id)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(list);
}));

app.post('/api/projects', wrap((req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  const p = newProject(name);
  fs.mkdirSync(path.join(projectDir(p.id), 'files'), { recursive: true });
  res.json(withStatus(save(p)));
}));

app.get('/api/projects/:id', wrap((req, res) => res.json(withStatus(load(req.params.id)))));

app.put('/api/projects/:id', wrap((req, res) => {
  const p = load(req.params.id);
  const { name, main, platforms } = req.body;
  if (typeof name === 'string' && name.trim()) p.name = name.trim();
  if (main) for (const f of ['title', 'description', 'tags', 'price']) if (f in main) p.main[f] = String(main[f]);
  if (platforms) {
    for (const [key, v] of Object.entries(platforms)) {
      if (!PLATFORMS[key]) continue;
      const cur = p.platforms[key];
      if ('enabled' in v) cur.enabled = !!v.enabled;
      if (Array.isArray(v.excluded)) cur.excluded = v.excluded.map(String);
      for (const f of ['title', 'description', 'tags', 'price']) if (f in v) cur[f] = String(v[f]);
    }
  }
  res.json(withStatus(save(p)));
}));

app.delete('/api/projects/:id', wrap((req, res) => {
  load(req.params.id);
  fs.rmSync(projectDir(req.params.id), { recursive: true, force: true });
  res.json({ ok: true });
}));

// Files stream straight to disk: no size limit beyond free disk space.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(projectDir(req.params.id), 'files')),
    filename: (req, file, cb) => {
      const dir = path.join(projectDir(req.params.id), 'files');
      const name = safeName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
      const { name: base, ext } = path.parse(name);
      let candidate = name;
      for (let i = 2; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
      cb(null, candidate);
    },
  }),
});

app.post('/api/projects/:id/files', wrap(async (req, res) => {
  load(req.params.id);
  await new Promise((ok, fail) => upload.array('files')(req, res, (e) => (e ? fail(e) : ok())));
  const p = load(req.params.id); // re-read after the (possibly long) upload
  for (const f of req.files) {
    p.files.push({ name: f.filename, size: f.size, mime: f.mimetype, kind: kindOf(f.filename, f.mimetype) });
  }
  res.json(withStatus(save(p)));
}));

// Browser measures width/height/duration and reports them here.
app.put('/api/projects/:id/files/:name/meta', wrap((req, res) => {
  const p = load(req.params.id);
  const f = p.files.find((x) => x.name === req.params.name);
  if (!f) throw httpError(404, 'File not found');
  for (const k of ['width', 'height', 'duration']) {
    const n = Number(req.body[k]);
    if (Number.isFinite(n) && n > 0) f[k] = n;
  }
  res.json(withStatus(save(p)));
}));

app.get('/api/projects/:id/files/:name', wrap((req, res) => {
  const p = load(req.params.id);
  if (!p.files.some((f) => f.name === req.params.name)) throw httpError(404, 'File not found');
  res.sendFile(path.join(projectDir(p.id), 'files', req.params.name));
}));

app.delete('/api/projects/:id/files/:name', wrap((req, res) => {
  const p = load(req.params.id);
  const i = p.files.findIndex((f) => f.name === req.params.name);
  if (i < 0) throw httpError(404, 'File not found');
  fs.rmSync(path.join(projectDir(p.id), 'files', p.files[i].name), { force: true });
  p.files.splice(i, 1);
  res.json(withStatus(save(p)));
}));

// Writes exports/<project>/<platform>/ with the files plus a copy-paste details sheet.
app.post('/api/projects/:id/export/:platform', wrap((req, res) => {
  const p = load(req.params.id);
  const key = req.params.platform;
  const plat = PLATFORMS[key];
  if (!plat) throw httpError(404, 'Unknown platform');
  const result = check(p, key);
  if (result.status === 'error' && !req.query.force) throw httpError(409, 'Fix the errors before exporting');

  const dir = path.join(EXPORTS, `${slug(p.name)}-${p.id}`, key);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of platformFiles(p, key)) {
    const src = path.join(projectDir(p.id), 'files', f.name);
    const dest = path.join(dir, f.name);
    try {
      fs.linkSync(src, dest); // instant for huge files when on the same drive
    } catch {
      fs.copyFileSync(src, dest);
    }
  }
  const fields = plat.format(effectiveMeta(p, key));
  const sheet = Object.entries(fields).map(([k, v]) => `===== ${k} =====\n${v}\n`).join('\n');
  fs.writeFileSync(path.join(dir, 'DETAILS.txt'), `${plat.name} upload for "${p.name}"\n\n${sheet}`);
  res.json({ dir, fields });
}));

app.post('/api/open-folder', wrap((req, res) => {
  const dir = path.resolve(String(req.body.dir || ''));
  if (!dir.startsWith(EXPORTS + path.sep) || !fs.existsSync(dir)) throw httpError(400, 'Not an export folder');
  openWith(process.platform === 'win32' ? 'explorer' : null, dir);
  res.json({ ok: true });
}));

function openWith(winCmd, target) {
  const cmd = process.platform === 'win32' ? winCmd : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' && winCmd === 'cmd' ? ['/c', 'start', '', target] : [target];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

app.use((e, req, res, next) => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.message });
});

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Upload Prep running at ${url}  (close this window to stop)`);
  if (process.argv.includes('--open')) openWith('cmd', url);
});
