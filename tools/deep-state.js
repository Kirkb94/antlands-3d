// Deep world-state fingerprint (node and browser): finds where two worlds that should be identical differ.
// Used by test/snap.test.js; for hunting desyncs paste it into a page or require it in a script.
// deepHash(world) -> Map(path -> 32-bit hash) for every object/array/typed array reachable from the world, keyed by
// the first path it is reached by (keys walked in sorted order, so key insertion order doesn't matter).
// diff(a, b) -> the paths whose hashes differ (deepest first), and detail for the first ones.
(function (root) {
'use strict';
const SKIP = new Set(['fxq', 'events', 'perf', 'view', 'opts', 'systems', 'surfaceHandlers', 'handlerSpeed', 'R']);
function h32(h, v) { return Math.imul(h ^ v, 16777619) >>> 0; }
function hashStr(h, s) { for (let i = 0; i < s.length; i++) h = h32(h, s.charCodeAt(i)); return h; }
const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
function hashNum(h, v) { f64[0] = v; return h32(h32(h, u32[0]), u32[1]); }
function isTyped(v) { return ArrayBuffer.isView(v) && !(v instanceof DataView); }
function deepHash(world, opts) {
  opts = opts || {};
  const skip = opts.skip || SKIP, out = new Map(), seen = new Map();
  function walk(v, path, depth) {
    if (v === null || v === undefined) return 7;
    const t = typeof v;
    if (t === 'number') return hashNum(11, v);
    if (t === 'boolean') return v ? 13 : 17;
    if (t === 'string') return hashStr(19, v);
    if (t === 'function') return 23;
    if (t !== 'object') return 29;
    if (seen.has(v)) return hashStr(31, seen.get(v));   // a reference: by where it was first seen
    seen.set(v, path);
    let h = 2166136261;
    if (isTyped(v)) {
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i < b.length; i++) h = h32(h, b[i]);
    } else if (v instanceof Map) {
      for (const [k, x] of v) { h = hashStr(h, String(k)); h = h32(h, walk(x, path + '{' + k + '}', depth + 1)); }
    } else if (v instanceof Set) {
      for (const x of v) h = h32(h, walk(x, path + '{}', depth + 1));
    } else if (Array.isArray(v)) {
      h = h32(h, v.length);
      for (let i = 0; i < v.length; i++) h = h32(h, walk(v[i], path + '[' + i + ']', depth + 1));
    } else {
      if (typeof HTMLElement !== 'undefined' && v instanceof HTMLElement) return 37;
      if (typeof CanvasRenderingContext2D !== 'undefined' && (v instanceof CanvasRenderingContext2D || (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement))) return 41;
      const keys = Object.keys(v).sort();
      for (const k of keys) {
        if (skip.has(k) && depth <= 1) continue;
        if (opts.skipKey && opts.skipKey(k, path)) continue;
        h = hashStr(h, k); h = h32(h, walk(v[k], path + '.' + k, depth + 1));
      }
    }
    out.set(path, h >>> 0);
    return h >>> 0;
  }
  const top = walk(world, 'w', 0);
  if (world && world.R && world.R.state) out.set('w.R', world.R.state() >>> 0);
  out.set('', top);
  return out;
}
// the differing paths, the most specific first (a path is dropped if a longer differing path starts with it)
function diff(a, b, max) {
  const d = [];
  for (const [p, h] of a) if (p && b.has(p) && b.get(p) !== h) d.push(p);
  for (const p of a.keys()) if (p && !b.has(p)) d.push(p + ' (only in a)');
  for (const p of b.keys()) if (p && !a.has(p)) d.push(p + ' (only in b)');
  const leaf = d.filter(p => !d.some(q => q !== p && q.startsWith(p) && (q[p.length] === '.' || q[p.length] === '[' || q[p.length] === '{')));
  return leaf.slice(0, max || 30);
}
// a value at a path like w.colonies[0].stock.sugar (for reports)
function at(world, path) {
  const parts = path.replace(/^w/, '').match(/\.[^.[{]+|\[\d+\]|\{[^}]*\}/g) || [];
  let v = world;
  for (const p of parts) { if (v == null) return undefined; if (p[0] === '.') v = v[p.slice(1)]; else if (p[0] === '[') v = v[+p.slice(1, -1)]; else { const k = p.slice(1, -1); v = v instanceof Map ? (v.has(k) ? v.get(k) : v.get(+k)) : undefined; } }
  return v;
}
function show(v) {
  if (isTyped(v)) return v.constructor.name + '(' + v.length + ')';
  if (Array.isArray(v)) return 'Array(' + v.length + ')';
  if (v && typeof v === 'object') return '{' + Object.keys(v).slice(0, 12).join(',') + '}';
  return JSON.stringify(v);
}
// first differing index of two typed arrays at the same path
function typedDiff(x, y) {
  if (!isTyped(x) || !isTyped(y)) return null;
  const n = Math.min(x.length, y.length), out = [];
  for (let i = 0; i < n && out.length < 6; i++) if (x[i] !== y[i] && !(x[i] !== x[i] && y[i] !== y[i])) out.push(i + ':' + x[i] + '/' + y[i]);
  return out.join(' ');
}
function report(wa, wb, max) {
  const A = deepHash(wa), B = deepHash(wb);
  if (A.get('') === B.get('')) return null;
  const paths = diff(A, B, max || 20);
  return paths.map(p => { const q = p.replace(/ \(only in [ab]\)$/, ''), x = at(wa, q), y = at(wb, q); const td = typedDiff(x, y); return p + '  a=' + (td != null ? td : show(x)) + (td != null ? '' : '  b=' + show(y)); });
}
const API = { deepHash, diff, at, report, SKIP };
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.MPHunt = API;
})(typeof window !== 'undefined' ? window : globalThis);
