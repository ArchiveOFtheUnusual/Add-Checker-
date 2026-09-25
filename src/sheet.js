// Reads a "details sheet" (.txt, .md, .docx, .pdf) and turns it into upload fields.
//
//   Title: My Video
//   Price: 9.99
//   Tags: haunted, ghosts
//   Description:
//   Any number of lines...
//
//   [YouTube]
//   Title: Different title just for YouTube
//
// Keys are case-insensitive. A value runs until the next key or [Section].

const fs = require('fs');
const path = require('path');
const { PLATFORMS } = require('./platforms');

const KEYS = {
  title: 'title', name: 'title', 'product name': 'title', 'video title': 'title',
  description: 'description', desc: 'description', caption: 'description',
  tags: 'tags', hashtags: 'tags', keywords: 'tags',
  price: 'price',
  platforms: 'ignored', // older sheets had this; platforms are switched on by hand now
};
const SHEET_EXTS = ['txt', 'md', 'docx', 'pdf'];

// Accept "YouTube", "you tube", "IG", etc. as section names.
function platformKey(name) {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  const alias = { ig: 'instagram', insta: 'instagram', yt: 'youtube', tt: 'tiktok' };
  if (alias[n]) return alias[n];
  return Object.keys(PLATFORMS).find((k) => k === n || PLATFORMS[k].name.toLowerCase() === n) || null;
}

async function extractText(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (ext === 'txt' || ext === 'md') return fs.readFileSync(file, 'utf8');
  if (ext === 'docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ path: file })).value;
  }
  if (ext === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 });
    const doc = await task.promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      for (const item of content.items) text += item.str + (item.hasEOL ? '\n' : '');
      text += '\n';
    }
    await task.destroy();
    return text;
  }
  return null;
}

function parse(text) {
  const main = {};
  const platforms = {};
  let target = main;
  let key = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  for (const raw of lines) {
    const line = raw.replace(/^[#*\s]+|\*+$/g, '').trim(); // allow Markdown "## Title:" / "**Title:**"
    const section = line.match(/^\[(.+)\]$|^=+\s*(.+?)\s*=+$/);
    const sectionKey = section && platformKey(section[1] || section[2]);
    if (sectionKey) {
      target = platforms[sectionKey] ??= {};
      key = null;
      continue;
    }
    const kv = line.match(/^([A-Za-z ]{2,20}?)\s*\**:\**\s*(.*)$/);
    const field = kv && KEYS[kv[1].toLowerCase().trim()];
    if (field) {
      key = field;
      target[key] = kv[2].trim();
      continue;
    }
    if (key) target[key] += (target[key] ? '\n' : '') + raw.trimEnd();
  }

  const clean = (obj) => {
    for (const k of Object.keys(obj)) {
      obj[k] = obj[k].replace(/\n{3,}/g, '\n\n').trim(); // Word/PDF add extra blank lines
      if (k === 'tags') obj[k] = obj[k].split(/[,\n]|\s(?=#)/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean).join(', ');
      if (k === 'price') obj[k] = obj[k].replace(/[^0-9.]/g, '');
    }
    return obj;
  };
  clean(main);
  for (const p of Object.values(platforms)) clean(p);
  for (const o of [main, ...Object.values(platforms)]) delete o.ignored;

  const found = Object.keys(main).length + Object.values(platforms).reduce((n, p) => n + Object.keys(p).length, 0);
  return { main, platforms, found };
}

// Returns parsed fields, or null if the file isn't a details sheet.
async function readSheet(file) {
  if (!SHEET_EXTS.includes(path.extname(file).slice(1).toLowerCase())) return null;
  let text;
  try {
    text = await extractText(file);
  } catch {
    return null; // unreadable/corrupt doc: treat as a normal product file
  }
  if (!text) return null;
  const result = parse(text);
  // Need at least two fields so a product PDF that happens to contain "Title:" isn't mistaken for a sheet.
  return result.found >= 2 ? result : null;
}

module.exports = { readSheet, parse };
