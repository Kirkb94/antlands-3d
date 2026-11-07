// World snapshots: a whole running world as data, and back into a freshly made world, bit for bit.
// A PC that joins a multiplayer match late (or reloads) loads a snapshot from another PC instead of replaying the
// whole match from the start (net.js), so it is in the game in seconds instead of catching up for minutes.
//
//   AL.Snap.take(world)              -> { json, bins: [Uint8Array] }   (a graph of every object reachable from the world)
//   AL.Snap.restore(fresh, snap, me) -> fresh, made equal to the snapshot's world (fresh: AL.Sim.createWorld(same opts))
//   AL.Snap.pack(snap) / unpack(bytes)  one Uint8Array <-> snapshot
//
// The graph: objects, arrays, Maps, Sets, typed arrays, prototypes (class instances and Object.create homes), in the
// order the world's own keys are (so for-in order comes back the same). Functions stored in the world are named:
// random number streams by their state, entrance functions and their wrappers by name (_snap), per-object closures
// (creature death hooks, nest temperature) are rebuilt for their owner. A function it can't name is an error, so a
// new kind of closure in the world is noticed at once (test/snap.test.js), not as a desync later.
// Restore fills the fresh world object itself (closures that captured it stay valid) with new objects for everything
// else. The fresh world's own plumbing stays: its systems, handlers and queues, and this PC's perspective (me, player,
// nest view, fog, the colours it sees). Module constants the world points at go by name, not as copies.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
// world keys that are this PC's own (perspective, plumbing): never sent, kept as the fresh world has them
const KEEP = new Set(['systems', 'surfaceHandlers', 'nestHandlers', 'arrive', 'deliverBig', 'fxq', 'events', 'perf', 'view', 'opts', 'fog', 'me', 'player', 'nest']);
const TYPED = { Float32Array, Float64Array, Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray };
const isTyped = v => ArrayBuffer.isView(v) && !(v instanceof DataView);
const plainProto = p => p === Object.prototype || p === Array.prototype || p === Map.prototype || p === Set.prototype || p === null;

// ---- module constants the world points at (species, creature and site definitions, config) ----
// The same objects on every PC, so they go by name ('Victory.cfg.SOURCES.spill.0'), never as copies. Only these roots
// (pure data; a world-shaped object is never walked into): test/snap.test.js checks nothing else is shared.
const CONST_ROOTS = ['Expansion', 'Victory', 'CREATURE_TYPES', 'SITES', 'SPECIES', 'CASTES', 'TUNE', 'BIOMES', 'MAP_SIZES', 'WorldCreatures', 'Sites'];
let constOf = null, constAt = null;
function consts() {
  if (constOf) return constOf;
  constOf = new Map(); constAt = new Map();
  const walk = (v, p, d) => {
    if (!v || typeof v !== 'object' || constOf.has(v) || d > 8 || isTyped(v) || v instanceof Map || v instanceof Set) return;
    if ('ants' in v || 'colonies' in v || 'stock' in v) return;
    constOf.set(v, p); constAt.set(p, v);
    for (const k of Object.keys(v)) { const x = v[k]; if (x && typeof x === 'object') walk(x, p + '.' + k, d + 1); }
  };
  for (const r of CONST_ROOTS) if (AL[r] && typeof AL[r] === 'object' || typeof AL[r] === 'function') walk(AL[r], r, 0);
  return constOf;
}
const CLASSES = () => ({ AntStore: AL.AntStore, SpatialHash: AL.SpatialHash, PheromoneGrid: AL.PheromoneGrid });

// ---- functions by name ----
function baseFn(name) {
  const R = {
    'life.enterNest': () => AL.Life && AL.Life.enterNest,
    'ai.enterAbstract': () => AL.AI && AL.AI.enterAbstract,
    'ai.siegeIn': () => AL.AI && AL.AI.siegeIn,
    'sim.siegeIn': () => AL.Sim.siegeInHere,
    'founding.enterFounding': () => AL.FoundingRace && AL.FoundingRace.enterFounding,
  };
  const f = R[name] && R[name]();
  if (!f || f._snap !== name) throw new Error('snapshot: no function ' + name);
  return f;
}
function encFn(f, owner, key, path) {
  if (typeof f.state === 'function' && typeof f.int === 'function') return { $f: 'rng', s: f.state() };
  if (key === 'onDeath') return { $f: 'onDeath' };
  if (key === 'tempAt') return { $f: 'tempAt' };
  if (key === 'enter' || key === 'siegeIn') return { $f: 'chain', c: chain(f, path) };
  throw new Error('snapshot: a function the snapshot can\'t name at ' + path);
}
function chain(f, path) {
  const out = [];
  for (let g = f, n = 0; g && n < 8; g = g.orig, n++) {
    if (g._snap) { out.push(g._snap); return out; }
    if (g._rs) out.push('rs');
    else if (g._sp) out.push('sp');
    else throw new Error('snapshot: an unnamed entrance function at ' + path);
  }
  throw new Error('snapshot: entrance chain too long at ' + path);
}
function decFn(d, owner, key) {
  if (d.$f === 'rng') { const r = AL.rng(1); r.setState(d.s); return r; }
  if (d.$f === 'onDeath') { AL.WorldCreatures.bindDeath(owner); return owner.onDeath; }
  if (d.$f === 'tempAt') { owner.tempAt = null; AL.Nest.bindTemp(owner); return owner.tempAt; }
  if (d.$f === 'chain') {
    const c = d.c; let f = baseFn(c[c.length - 1]);
    for (let k = c.length - 2; k >= 0; k--) f = c[k] === 'rs' ? AL.Research.wrapEnter(f) : key === 'siegeIn' ? AL.Species.siegeWrap(f) : AL.Species.enterWrap(f);
    return f;
  }
  throw new Error('snapshot: unknown function ' + JSON.stringify(d));
}

// ---- take ----
function take(world) {
  const ids = new Map(), nodes = [], bins = [], bufs = new Map();
  const queue = [];
  const ref = (v, path) => { let id = ids.get(v); if (id == null) { id = nodes.length; ids.set(v, id); nodes.push(null); queue.push([v, id, path]); } return { $r: id }; };
  function enc(v, owner, key, path) {
    if (v === undefined) return { $u: 1 };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) && !Object.is(v, -0) ? v : { $n: Object.is(v, -0) ? '-0' : String(v) };
    if (typeof v === 'function') return encFn(v, owner, key, path);
    if (typeof v === 'object') { const c = consts().get(v); return c != null ? { $c: c } : ref(v, path); }
    throw new Error('snapshot: can\'t store a ' + typeof v + ' at ' + path);
  }
  ref(world, 'w');
  for (let q = 0; q < queue.length; q++) {
    const [v, id, path] = queue[q];
    if (isTyped(v)) {
      if (bufs.has(v.buffer)) throw new Error('snapshot: two typed arrays share a buffer at ' + path);
      bufs.set(v.buffer, true);
      bins.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
      nodes[id] = ['T', v.constructor.name, bins.length - 1, v.length];
      continue;
    }
    const pr = Object.getPrototypeOf(v);
    let proto = 0;
    if (!plainProto(pr)) {
      // a class instance (AntStore, PheromoneGrid...) by its class name; an Object.create(parent) home by its parent
      const cp = consts().get(pr);
      if (cp != null) proto = { k: cp };   // a view over a module constant (research.js: col.sp over AL.SPECIES[key])
      else if (pr.constructor && pr.constructor.prototype === pr && pr.constructor.name && pr.constructor !== Object) proto = { c: pr.constructor.name };
      else proto = { r: ref(pr, path + '^').$r };
    }
    if (v instanceof Map) { const e = []; for (const [k, x] of v) e.push([enc(k, v, '', path + '{}'), enc(x, v, '', path + '{' + k + '}')]); nodes[id] = ['M', proto, e]; continue; }
    if (v instanceof Set) { const e = []; for (const x of v) e.push(enc(x, v, '', path + '{}')); nodes[id] = ['S', proto, e]; continue; }
    if (Array.isArray(v)) { const e = new Array(v.length); for (let i = 0; i < v.length; i++) e[i] = enc(v[i], v, i, path + '[' + i + ']'); nodes[id] = ['A', proto, e]; continue; }
    const o = {};
    for (const k of Object.keys(v)) {
      if (id === 0 && KEEP.has(k)) continue;
      o[k] = enc(v[k], v, k, path + '.' + k);
    }
    // own non-enumerable properties (research.js col.sp._rsBase): kept with their flags
    let hid = 0;
    for (const k of Object.getOwnPropertyNames(v)) {
      if (Object.prototype.propertyIsEnumerable.call(v, k)) continue;
      const d = Object.getOwnPropertyDescriptor(v, k);
      if (d.get || d.set) throw new Error('snapshot: an accessor property at ' + path + '.' + k);
      (hid || (hid = {}))[k] = [enc(d.value, v, k, path + '.' + k), !!d.writable, !!d.configurable];
    }
    nodes[id] = hid ? ['O', proto, o, hid] : ['O', proto, o];
  }
  return { v: 1, json: JSON.stringify(nodes), bins };
}

// ---- restore ----
function restore(fresh, snap, me) {
  const nodes = typeof snap.json === 'string' ? JSON.parse(snap.json) : snap.json, bins = snap.bins;
  consts();
  const classes = CLASSES();
  // a new object for every node; the world itself is the fresh one (its plumbing and this PC's view stay)
  const tgt = new Array(nodes.length);
  for (let id = 0; id < nodes.length; id++) {
    const n = nodes[id];
    if (id === 0) { tgt[0] = fresh; continue; }
    if (n[0] === 'T') { const C = TYPED[n[1]]; if (!C) throw new Error('snapshot: typed array ' + n[1]); tgt[id] = new C(n[3]); continue; }
    tgt[id] = n[0] === 'M' ? new Map() : n[0] === 'S' ? new Set() : n[0] === 'A' ? [] : {};
  }
  const dec = (v, owner, key) => {
    if (v === null || typeof v !== 'object') return v;
    if (v.$r != null) return tgt[v.$r];
    if (v.$u) return undefined;
    if (v.$n != null) return v.$n === '-0' ? -0 : Number(v.$n);
    if (v.$f) return decFn(v, owner, key);
    if (v.$c != null) { const c = constAt.get(v.$c); if (!c) throw new Error('snapshot: no constant ' + v.$c); return c; }
    throw new Error('snapshot: bad value ' + JSON.stringify(v).slice(0, 60));
  };
  // prototypes first (Object.create homes), then the contents
  for (let id = 0; id < nodes.length; id++) {
    const n = nodes[id], o = tgt[id], pr = n[1];
    if (n[0] === 'T' || !pr) continue;
    const want = pr.r != null ? tgt[pr.r] : pr.k != null ? constAt.get(pr.k) : (classes[pr.c] && classes[pr.c].prototype);
    if (!want) throw new Error('snapshot: no class ' + JSON.stringify(pr));
    if (Object.getPrototypeOf(o) !== want) Object.setPrototypeOf(o, want);
  }
  const fns = [];
  for (let id = 0; id < nodes.length; id++) {
    const n = nodes[id], o = tgt[id], [t, , p] = n;
    if (t === 'T') { new Uint8Array(o.buffer, o.byteOffset, o.byteLength).set(bins[n[2]]); continue; }
    if (t === 'A') { o.length = p.length; for (let i = 0; i < p.length; i++) o[i] = dec(p[i], o, i); continue; }
    if (t === 'M') { o.clear(); for (const [k, x] of p) o.set(dec(k, o, ''), dec(x, o, '')); continue; }
    if (t === 'S') { o.clear(); for (const x of p) o.add(dec(x, o, '')); continue; }
    // objects: same keys in the same order as the source; functions after the data (they bind to their owner)
    for (const k of Object.keys(o)) if (!(id === 0 && KEEP.has(k))) delete o[k];
    for (const k in p) { const x = p[k]; if (x && typeof x === 'object' && x.$f) { o[k] = null; fns.push([o, k, x]); } else o[k] = dec(x, o, k); }
    if (n[3]) for (const k in n[3]) { const [x, w, c] = n[3][k]; Object.defineProperty(o, k, { value: dec(x, o, k), writable: w, configurable: c, enumerable: false }); }
  }
  for (const [o, k, x] of fns) o[k] = dec(x, o, k);
  // this PC's perspective on the restored world
  if (me != null) fresh.me = me;
  fresh.player = fresh.colonies[fresh.me || 0];
  if (fresh.player && fresh.player.nest) fresh.nest = fresh.player.nest;
  if (fresh.mp && AL.Colonies && AL.Colonies.rivalColours) for (let k = 0; k < (fresh.mp.humans | 0); k++) { const c = fresh.colonies[k]; if (c) c.colours = k === fresh.me ? c.sp : AL.Colonies.rivalColours(c.sp, k); }
  return fresh;
}

// ---- one byte string ----
function pack(s) {
  const enc = new TextEncoder(), j = enc.encode(s.json);
  let n = 8 + j.length; for (const b of s.bins) n += 4 + b.length;
  const out = new Uint8Array(n), dv = new DataView(out.buffer);
  dv.setUint32(0, j.length, true); dv.setUint32(4, s.bins.length, true); out.set(j, 8);
  let o = 8 + j.length;
  for (const b of s.bins) { dv.setUint32(o, b.length, true); out.set(b, o + 4); o += 4 + b.length; }
  return out;
}
function unpack(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), jl = dv.getUint32(0, true), nb = dv.getUint32(4, true);
  const json = new TextDecoder().decode(u8.subarray(8, 8 + jl)), bins = [];
  let o = 8 + jl;
  for (let k = 0; k < nb; k++) { const l = dv.getUint32(o, true); bins.push(u8.slice(o + 4, o + 4 + l)); o += 4 + l; }
  return { v: 1, json, bins };
}

AL.Snap = { take, restore, pack, unpack, KEEP, consts };
if (NODE) module.exports = AL.Snap;
})(typeof window !== 'undefined' ? window : globalThis);
