'use strict';
// One-time import: copies the original Antlands game (sibling folder ../antlands in the console's games dir) into
// this repo, then vendors three.js from node_modules into public/vendor. Safe to run again: it only copies the game
// when public/index.html is missing, and only copies three.js when public/vendor is missing it.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '..', 'antlands');
const SKIP = new Set(['.git', 'node_modules', 'package.json', 'package-lock.json', 'tools']);
function copyDir(src, dst, top) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && SKIP.has(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, false); else fs.copyFileSync(s, d);
  }
}
if (!fs.existsSync(path.join(ROOT, 'public', 'index.html'))) {
  if (!fs.existsSync(SRC)) { console.error('[import] original Antlands not found at ' + SRC); process.exit(1); }
  copyDir(SRC, ROOT, true);
  // the original's tools folder (balance harnesses) without overwriting this importer
  const st = path.join(SRC, 'tools'); if (fs.existsSync(st)) for (const f of fs.readdirSync(st)) { const d = path.join(ROOT, 'tools', f); if (!fs.existsSync(d)) fs.copyFileSync(path.join(st, f), d); }
  console.log('[import] copied Antlands from ' + SRC);
}
const V = path.join(ROOT, 'public', 'vendor'), B = path.join(ROOT, 'node_modules', 'three', 'build');
if (!fs.existsSync(path.join(V, 'three.module.min.js'))) {
  if (!fs.existsSync(B)) { console.error('[import] three.js missing: run npm install'); process.exit(1); }
  fs.mkdirSync(V, { recursive: true });
  for (const f of fs.readdirSync(B)) if (/^three\.(module|core)(\.min)?\.js$/.test(f)) fs.copyFileSync(path.join(B, f), path.join(V, f));
  console.log('[import] vendored three.js into public/vendor');
}
