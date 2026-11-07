// The player's nest: a side-view soil grid under the mound.
// Layers (topsoil, clay, gravel), undiggable rocks and roots, a water table, dig markers that
// workers excavate tile by tile, chambers painted on dug space, flow fields for ant navigation,
// flooding, cave-ins and nest temperature.
// Army ants dig nothing: their 'nest' is a bivouac, a cluster of living ants hanging under a log (Eciton).
// Its walls are ants (TILE.LIVE), the space round it is open air (TILE.AIR), it grows with the colony
// (shapeBivouac, called by bivouac.js) and re-forms at every new site. No flooding; the ants keep the brood warm.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');

const TILE = { OPEN: 0, TOPSOIL: 1, CLAY: 2, GRAVEL: 3, ROCK: 4, ROOT: 5, WOOD: 6, LIVE: 7, AIR: 8 };
const HARD = [0, 1.0, 1.7, 1.3, Infinity, Infinity, 2.4, Infinity, Infinity];   // (a bivouac's living walls and the air round it can't be dug)   // dig effort per tile kind (x base seconds)
const DIG_BASE = 2.6;                                          // seconds for one worker to dig a topsoil tile
const CH = { NONE: 0, QUEEN: 1, NURSERY: 2, FOOD: 3, BARRACKS: 4, MIDDEN: 5, WATER: 6, FUNGUS: 7, APHID: 8, DRYER: 9 };
const CH_INFO = [
  null,
  { key: 'queen',    name: 'Queen chamber', col: '#e8c46a', tip: 'Where the queen lives and lays. Keep it deep and warm.' },
  { key: 'nursery',  name: 'Nursery',       col: '#f0e6c8', tip: 'Brood is raised here, fastest near 27°C. Shallow rooms warm up by day and cool at night; deep ones stay steady. Dig one shallow and one deep: the nurses carry the brood to whichever is better.' },
  { key: 'food',     name: 'Food store',    col: '#f2a64e', tip: 'Holds sugar and protein. More tiles, more capacity. Honeypots hang here.' },
  { key: 'barracks', name: 'Barracks',      col: '#d9604a', tip: 'Soldiers rest here and rally faster from it.' },
  { key: 'midden',   name: 'Midden',        col: '#8a8f5a', tip: 'Waste and the dead. Without one, corpses rot in the tunnels and disease spreads.' },
  { key: 'water',    name: 'Water reservoir', col: '#6cb4d9', tip: 'Stores water. Rain runs down the tunnels and pools in the lowest ones first: dig the reservoir low and it catches the flood. Ants carrying water from puddles drop it in too.' },
  { key: 'fungus',   name: 'Fungus garden', col: '#c9d6a0', tip: 'Leafcutters grow fungus on cut leaves here.' },
  { key: 'aphid',    name: 'Root-aphid chamber', col: '#9cc96a', tip: 'Aphids farmed on the roots: foragers bring live aphids from the wild plants, they breed here and their honeydew goes into the store (needs Aphid farming).' },
  { key: 'dryer',    name: 'Pupa dryer',    col: '#e3b27a', tip: 'A warm, dry room for cocoons: the nurses carry pupae here and they hatch faster. Best just under the surface (top 8 rows).' },
];
// navigation fields (multi-source BFS distance maps)
// (BROOD_FROM / BROOD_TO / LINE: brood the nurses move and walls left to line: nestclimate.js)
const F = { ENTRANCE: 0, QUEEN: 1, NURSERY: 2, FOOD: 3, BARRACKS: 4, MIDDEN: 5, WATER: 6, FUNGUS: 7, DIG: 8, CORPSE: 9, APHID: 10, BROOD_FROM: 11, BROOD_TO: 12, LINE: 13 };
const NF = 14, FAR = 32767;
const LINED_WATER = 0.65;   // the most water a lined tile holds: ants wade it (they drown over 0.8); brood still soaks (over 0.5)

function createNest(world, colony, opts) {
  opts = opts || {};
  const cols = 90, rows = 60, tile = 10, n = cols * rows;
  const R = AL.rng((world.seed ^ 0x2f6b) >>> 0);
  const nest = {
    cols, rows, tile, n, colony,
    kind: new Uint8Array(n), chamber: new Uint8Array(n), mark: new Uint8Array(n),
    prog: new Float32Array(n), water: new Float32Array(n), base: new Uint8Array(n), lined: new Uint8Array(n),   // lined: walls smoothed with spit (nestclimate.js)
    fields: [], fieldDirty: true, version: 1, layoutVersion: 1,
    entrance: { c: 45, r: 0 },
    waterTable: 50, flood: 0, corpses: [], middenFill: 0,
    caps: { queen: 0, nursery: 0, food: 0, barracks: 0, midden: 0, water: 0, fungus: 0, aphid: 0, dryer: 0 },
    tiles: [[], [], [], [], [], [], [], [], [], []], // open tiles per chamber type (indices)
    digCount: 0, frontier: 0, temp: 22, nurseryTemp: 24, R,
  };
  for (let k = 0; k < NF; k++) nest.fields.push(new Int16Array(n));
  if (colony.sp.nomad) { nest.kind.fill(TILE.AIR); nest.roots = []; nest.waterTable = rows + 10; nest.base.set(nest.kind); shapeBivouac(nest, colony.sp.start || 40, true); return nest; }
  // ---- layers ----
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, nz = AL.fbm(c / 14, r / 9, world.seed + 11, 3);
    const top = 6 + nz * 5, clayEnd = 34 + nz * 8;
    let k = r < top ? TILE.TOPSOIL : r < clayEnd ? TILE.CLAY : TILE.GRAVEL;
    // gravel lenses inside the clay
    if (k === TILE.CLAY && AL.fbm(c / 7, r / 4, world.seed + 23, 2) > 0.66) k = TILE.GRAVEL;
    nest.kind[i] = k;
  }
  nest.waterTable = 48 + Math.round(R() * 4);
  // rocks: blobs (not near the entrance shaft)
  for (let k = 0; k < 14; k++) {
    const rc = 4 + R() * (cols - 8), rr = 8 + R() * (rows - 12), rad = 1.4 + R() * 2.6, sq = 0.6 + R() * 0.6;
    if (Math.abs(rc - 45) < 9 && rr < 22) continue;
    for (let r = Math.floor(rr - rad - 1); r <= rr + rad + 1; r++) for (let c = Math.floor(rc - rad * 1.6 - 1); c <= rc + rad * 1.6 + 1; c++) {
      if (r < 1 || c < 0 || r >= rows || c >= cols) continue;
      const dx = (c - rc) / (rad * 1.5), dy = (r - rr) / (rad * sq + 0.6);
      if (dx * dx + dy * dy < 1 + (AL.hash2(c, r, 7) - 0.5) * 0.3) nest.kind[r * cols + c] = TILE.ROCK;
    }
  }
  // roots: wandering lines down from the surface (kept as paths for drawing)
  nest.roots = [];
  for (let k = 0; k < 7; k++) {
    let c = 4 + R() * (cols - 8), dir = (R() - 0.5) * 0.6;
    if (Math.abs(c - 45) < 7) c += 12;
    const len = 10 + R() * 22, path = [];
    for (let r = 0; r < len; r++) {
      dir = AL.clamp(dir + (R() - 0.5) * 0.35, -0.8, 0.8); c += dir;
      const ci = Math.round(c); if (ci < 0 || ci >= cols) break;
      nest.kind[r * cols + ci] = TILE.ROOT;
      path.push([(c + 0.5) * tile, (r + 0.5) * tile, 1 - r / len]);
      if (r > 3 && R() < 0.12) { // side rootlet
        let c2 = ci, d2 = R() < 0.5 ? -1 : 1; const sub = [[(ci + 0.5) * tile, (r + 0.5) * tile, 0.5]];
        for (let j = 0; j < 3 + R() * 5; j++) { c2 += d2; const rr2 = r + (j >> 1); if (c2 < 0 || c2 >= cols || rr2 >= rows) break; nest.kind[rr2 * cols + c2] = TILE.ROOT; sub.push([(c2 + 0.5) * tile, (rr2 + 0.5) * tile, 0.4 - j * 0.05]); }
        nest.roots.push(sub);
      }
    }
    nest.roots.push(path);
  }
  // carpenter ants get a buried stump (wood tiles they tunnel fast)
  if (colony.sp.wood) {
    for (let r = 1; r < 22; r++) for (let c = 52; c < 70; c++) {
      const dx = (c - 61) / 9, dy = (r - 9) / 12;
      if (dx * dx + dy * dy < 1) nest.kind[r * cols + c] = TILE.WOOD;
    }
  }
  nest.base.set(nest.kind);
  // ---- starter nest ----
  const preset = opts.nestPreset || 'starter';
  if (typeof preset === 'function') preset(nest, R);
  else if (preset === 'founding') carveFounding(nest);
  else carveStarter(nest);
  rebuild(nest);
  return nest;
}

function carve(nest, c0, r0, c1, r1, ch) {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (r < 0 || c < 0 || r >= nest.rows || c >= nest.cols) continue;
    const i = r * nest.cols + c;
    nest.kind[i] = TILE.OPEN; nest.mark[i] = 0;
    if (ch != null) nest.chamber[i] = ch;
  }
}
// rounded chamber (ellipse of tiles)
function carveRoom(nest, cc, rc, hw, hh, ch) {
  for (let r = Math.floor(rc - hh); r <= Math.ceil(rc + hh); r++) for (let c = Math.floor(cc - hw); c <= Math.ceil(cc + hw); c++) {
    const dx = (c - cc) / (hw + 0.5), dy = (r - rc) / (hh + 0.5);
    if (dx * dx + dy * dy <= 1) carve(nest, c, r, c, r, ch);
  }
}
function carveStarter(nest) {
  const e = nest.entrance.c;
  carve(nest, e, 0, e, 7);                 // entrance shaft
  carve(nest, e - 9, 7, e + 1, 7);         // gallery left
  carve(nest, e, 8, e, 14);                // shaft down to the queen
  carveRoom(nest, e - 10, 9, 3, 1.4, AL.Nest.CH.FOOD);
  carveRoom(nest, e + 1, 16, 4, 1.6, AL.Nest.CH.QUEEN);
  carve(nest, e + 5, 16, e + 9, 16);
  carveRoom(nest, e + 12, 15, 3.2, 1.5, AL.Nest.CH.NURSERY);
  const sp = nest.colony.sp;
  // leafcutters start with a small fungus garden
  if (sp.fungus) { carve(nest, e - 4, 16, e - 3, 16); carveRoom(nest, e - 8, 17, 3, 1.4, AL.Nest.CH.FUNGUS); }
  // the first dig job is already marked so the player sees digging immediately
  for (let c = e - 12; c >= e - 18; c--) mark(nest, c, 9);
}
function carveFounding(nest) {
  const e = nest.entrance.c;
  carve(nest, e, 0, e, 9);
  carveRoom(nest, e, 11, 1.6, 1, AL.Nest.CH.QUEEN);
}

// ---- army ants: the bivouac ------------------------------------------------------------------
// A hanging cluster under the log at the top of the view, sized for n ants: a shell of living ants round an
// open inside where the queen sits in the middle, the brood all round her, food up by the way in and refuse
// dropping out of the bottom. grow-only (fresh = false) never closes an open tile, so nobody gets walled in;
// the chambers are always laid out again by position.
// fresh (a new site, or the start) lays the whole cluster out again for n. Returns true if anything changed.
const BIV = AL.BIV_SHAPE = Object.assign({ W0: 5, WK: 0.75, WMAX: 40, H0: 6, HK: 1.05, HMAX: 56, SHELL: 2.2 }, AL.BIV_SHAPE || {});
function bivouacGeom(nest, n) {
  const s = Math.sqrt(Math.max(1, n));
  const hw = Math.min(BIV.WMAX, BIV.W0 + s * BIV.WK), hh = Math.min(BIV.HMAX, BIV.H0 + s * BIV.HK, nest.rows - 2);
  return { hw, hh, sh: BIV.SHELL + hw * 0.05, e: nest.entrance.c };
}
// where a tile sits in the cluster: < 1 inside the outline, `inset` tiles in from it. The outline is a teardrop
// hanging from the log: widest a third of the way down, tapering to a tip.
function bivAt(g, c, r, inset, seed) {
  const ry = r + 0.5;
  if (ry < inset * 0.6 || ry > g.hh - inset) return 9;
  const y = ry / g.hh, prof = y < 0.33 ? 0.62 + 0.38 * AL.sin(y / 0.33 * Math.PI / 2) : 0.08 + 0.92 * AL.cos((y - 0.33) / 0.67 * Math.PI / 2);
  const w = g.hw * prof - inset;
  if (w <= 0.4) return 9;
  return Math.abs(c - g.e) / w + (AL.hash2(c, r, seed) - 0.5) * 0.12;
}
function bivChamber(g, c, r) {
  const u = (c - g.e) / Math.max(1, g.hw - g.sh), v = r / Math.max(1, g.hh - g.sh);   // u -1..1 across, v 0..1 down
  if (Math.abs(u) < 0.2 && v > 0.4 && v < 0.58) return CH.QUEEN;
  if (g.hh - g.sh - (r + 0.5) < Math.max(1.6, 0.1 * (g.hh - g.sh))) return CH.MIDDEN;   // refuse drops out of the tip
  if (u < -0.3 && v < 0.24) return CH.FOOD;                   // army ants eat their prey fresh: a small larder
  if (Math.abs(u) < 0.1 && v < 0.38) return 0;                // the way in, down from the log
  return CH.NURSERY;
}
function shapeBivouac(nest, n, fresh) {
  const g = bivouacGeom(nest, n), b = nest.bivouac || (nest.bivouac = { n: 0, hw: 0, hh: 0 });
  if (!fresh && g.hw <= b.hw + 0.25 && g.hh <= b.hh + 0.25) return false;
  const seed = 17 + (nest.colony.id | 0);
  let changed = false;
  for (let r = 0; r < nest.rows; r++) for (let c = 0; c < nest.cols; c++) {
    const i = r * nest.cols + c, out = bivAt(g, c, r, 0, seed) < 1, inn = bivAt(g, c, r, g.sh, seed) < 1;
    const was = nest.kind[i];
    let k = inn ? TILE.OPEN : out ? TILE.LIVE : TILE.AIR;
    if (!fresh && was === TILE.OPEN) k = TILE.OPEN;          // growing never closes a way
    if (c === g.e && r <= 2) k = TILE.OPEN;                  // where the column comes down off the log
    if (k !== was) { nest.kind[i] = k; changed = true; }
    // the ants lay the inside out themselves (no chamber tool for army ants): every open tile by where it sits
    if (k === TILE.OPEN) { const ch = c === g.e && r <= 2 ? 0 : bivChamber(g, c, r); if (nest.chamber[i] !== ch) { nest.chamber[i] = ch; changed = true; } }
    else if (nest.chamber[i]) { nest.chamber[i] = 0; changed = true; }
    nest.mark[i] = 0; nest.prog[i] = 0;
  }
  b.hw = g.hw; b.hh = g.hh; b.sh = g.sh; b.n = n;
  if (changed || fresh) {
    nest.digCount = 0; nest.base.set(nest.kind); nest.version++; nest.layoutVersion++; nest.fieldDirty = true; rebuild(nest);
  }
  return changed;
}

const idx = (nest, c, r) => (c < 0 || r < 0 || c >= nest.cols || r >= nest.rows) ? -1 : r * nest.cols + c;
const isOpen = (nest, c, r) => { const i = idx(nest, c, r); return i >= 0 && nest.kind[i] === TILE.OPEN; };
function diggable(nest, i) { const k = nest.kind[i]; return k !== TILE.OPEN && HARD[k] !== Infinity; }
function mark(nest, c, r) {
  const i = idx(nest, c, r);
  if (i < 0 || !diggable(nest, i) || nest.mark[i]) return false;
  nest.mark[i] = 1; nest.digCount++; nest.fieldDirty = true; nest.version++;
  return true;
}
function unmark(nest, c, r) {
  const i = idx(nest, c, r);
  if (i < 0 || !nest.mark[i]) return false;
  nest.mark[i] = 0; nest.prog[i] = 0; nest.digCount--; nest.fieldDirty = true; nest.version++;
  return true;
}
// designate a chamber on open (or marked) tiles; ch = 0 clears
function designate(nest, c, r, ch) {
  const i = idx(nest, c, r);
  if (i < 0) return false;
  if (!ch) { if (!nest.chamber[i]) return false; nest.chamber[i] = 0; nest.fieldDirty = true; nest.version++; nest.layoutVersion++; return true; }
  if (nest.kind[i] !== TILE.OPEN && !nest.mark[i]) { if (!mark(nest, c, r)) return false; }
  if (nest.chamber[i] === ch) return false;
  // the entrance shaft stays a corridor
  if (c === nest.entrance.c && r < 3) return false;
  nest.chamber[i] = ch; nest.fieldDirty = true; nest.version++; nest.layoutVersion++;
  return true;
}
// a worker finished excavating a tile
function excavate(nest, i, world) {
  nest.kind[i] = TILE.OPEN; nest.mark[i] = 0; nest.prog[i] = 0; nest.lined[i] = 0; nest.digCount--;
  nest.fieldDirty = true; nest.version++; nest.layoutVersion++;
  if (world && AL.NestPlan) AL.NestPlan.dug(world, nest, i);   // something buried there? (nestplan.js)
  const c = i % nest.cols, r = (i / nest.cols) | 0;
  // below the water table the tunnel seeps full of water
  if (r >= nest.waterTable) nest.water[i] = 1;
  // gravel is unstable: sometimes a neighbouring tunnel caves in
  const st = nest.colony.siteTraits;
  if (world && ((nest.base[i] === TILE.GRAVEL && world.R() < 0.07) || (st && st.caveIn && world.R() < st.caveIn * 2))) {
    const cand = [[c, r - 1], [c - 1, r], [c + 1, r]].map(([a, b]) => idx(nest, a, b)).filter(j => j >= 0 && nest.kind[j] === TILE.OPEN && !nest.chamber[j] && !nest.lined[j] && !(j % nest.cols === nest.entrance.c && j < nest.cols * 3));   // (lined walls hold)
    if (cand.length) {
      const j = cand[(world.R() * cand.length) | 0];
      nest.kind[j] = TILE.GRAVEL; nest.fieldDirty = true; nest.version++; nest.layoutVersion++;
      AL.emit(world, 'caveIn', { col: nest.colony.id, c: j % nest.cols, r: (j / nest.cols) | 0 });
    }
  }
  if (world) AL.emit(world, 'tunnelDug', { col: nest.colony.id, c, r });
}

// ---- flow fields ----------------------------------------------------------------------
const queue = new Int32Array(90 * 60 + 8);
function bfs(nest, field, isSource) {
  const { cols, rows, kind } = nest;
  field.fill(FAR);
  let qh = 0, qt = 0;
  for (let i = 0; i < nest.n; i++) if (kind[i] === TILE.OPEN && isSource(i)) { field[i] = 0; queue[qt++] = i; }
  while (qh < qt) {
    const i = queue[qh++], d = field[i] + 1, c = i % cols;
    if (c > 0 && kind[i - 1] === 0 && field[i - 1] > d) { field[i - 1] = d; queue[qt++] = i - 1; }
    if (c < cols - 1 && kind[i + 1] === 0 && field[i + 1] > d) { field[i + 1] = d; queue[qt++] = i + 1; }
    if (i >= cols && kind[i - cols] === 0 && field[i - cols] > d) { field[i - cols] = d; queue[qt++] = i - cols; }
    if (i < (rows - 1) * cols && kind[i + cols] === 0 && field[i + cols] > d) { field[i + cols] = d; queue[qt++] = i + cols; }
  }
}
function rebuild(nest) {
  const { cols, kind, chamber, mark: mk } = nest;
  nest._roomV = -1;   // (rooms worked out again: nestclimate.js)
  // chamber tile lists + capacities (only open tiles count)
  for (const l of nest.tiles) l.length = 0;
  for (let i = 0; i < nest.n; i++) if (kind[i] === TILE.OPEN && chamber[i]) nest.tiles[chamber[i]].push(i);
  if (nest.bivouac) {   // a bivouac's brood lies from the queen outwards (placeBrood fills the nursery list in order)
    const qc = nest.entrance.c + 0.5, qr = nest.bivouac.hh * 0.5, d = i => { const dc = i % cols + 0.5 - qc, dr = ((i / cols) | 0) + 0.5 - qr; return dc * dc + dr * dr * 1.6; };
    nest.tiles[CH.NURSERY].sort((a, b) => d(a) - d(b) || a - b);
  }
  const T = AL.TUNE, t = nest.tiles;
  const NC = AL.NestClimate, lv = ch => (NC ? NC.capMul(nest, ch) : t[ch].length);   // room levels: bigger rooms hold more (nestclimate.js)
  nest.caps = {
    queen: t[CH.QUEEN].length, nursery: (lv(CH.NURSERY) + lv(CH.DRYER)) * T.NURSERY_PER_TILE, food: lv(CH.FOOD) * T.STORE_PER_TILE,
    barracks: lv(CH.BARRACKS) * 4, midden: lv(CH.MIDDEN) * T.MIDDEN_PER_TILE, water: lv(CH.WATER) * T.WATER_PER_TILE,
    fungus: lv(CH.FUNGUS) * 10, aphid: lv(CH.APHID) * (T.APHID_PER_TILE || 3), dryer: t[CH.DRYER].length * T.NURSERY_PER_TILE,
  };
  const ent = nest.entrance.r * cols + nest.entrance.c;
  bfs(nest, nest.fields[F.ENTRANCE], i => i === ent);
  for (let ch = 1; ch <= 7; ch++) bfs(nest, nest.fields[ch], i => chamber[i] === ch);
  bfs(nest, nest.fields[F.APHID], i => chamber[i] === CH.APHID);   // (its field sits after DIG and CORPSE)
  // dig frontier: open tiles touching a marked tile
  let fr = 0;
  bfs(nest, nest.fields[F.DIG], i => {
    const c = i % cols;
    const t = (c > 0 && mk[i - 1]) || (c < cols - 1 && mk[i + 1]) || (i >= cols && mk[i - cols]) || (i + cols < nest.n && mk[i + cols]);
    if (t) fr++;
    return !!t;
  });
  nest.frontier = fr;
  rebuildCorpseField(nest);
  if (AL.NestClimate) AL.NestClimate.rebuilt(nest);   // rooms, levels, the brood-moving and lining fields
  nest.fieldDirty = false;
}
function rebuildCorpseField(nest) {
  const set = new Set();
  for (const k of nest.corpses) if (!k.taken) set.add(k.i);
  bfs(nest, nest.fields[F.CORPSE], i => set.has(i));
  nest.corpseDirty = false;
}
// next tile to walk to from tile i following field f (lowest value neighbour; random tie-break)
function nextTile(nest, f, i, R) {
  const field = nest.fields[f], cols = nest.cols, kind = nest.kind;
  const v = field[i];
  if (v === 0 || v === FAR) return -1;
  let best = -1, bv = v, ties = 0;
  const c = i % cols;
  const nb = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols];
  for (const j of nb) {
    if (j < 0 || j >= nest.n || kind[j] !== 0) continue;
    const fv = field[j];
    if (fv < bv) { bv = fv; best = j; ties = 1; } else if (fv === bv && best >= 0 && R() < 1 / (++ties)) best = j;
  }
  return best;
}
// a random open neighbour, preferring the same chamber (idle milling)
function wanderTile(nest, i, R) {
  const cols = nest.cols, c = i % cols, ch = nest.chamber[i];
  const nb = [c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1, i - cols, i + cols];
  let best = -1, n = 0;
  for (const j of nb) {
    if (j < 0 || j >= nest.n || nest.kind[j] !== 0) continue;
    const w = nest.chamber[j] === ch ? 3 : 1;
    for (let k = 0; k < w; k++) if (R() < 1 / (++n)) best = j;
  }
  return best;
}
// a marked tile next to open tile i, or -1
function adjacentMark(nest, i) {
  const cols = nest.cols, c = i % cols, mk = nest.mark;
  // dig sideways and downward before upward (looks more natural)
  if (i + cols < nest.n && mk[i + cols]) return i + cols;
  if (c > 0 && mk[i - 1]) return i - 1;
  if (c < cols - 1 && mk[i + 1]) return i + 1;
  if (i >= cols && mk[i - cols]) return i - cols;
  return -1;
}
const tileOf = (nest, x, y) => {
  const c = AL.clamp((x / nest.tile) | 0, 0, nest.cols - 1), r = AL.clamp((y / nest.tile) | 0, 0, nest.rows - 1);
  return r * nest.cols + c;
};
const centre = (nest, i) => [(i % nest.cols + 0.5) * nest.tile, (((i / nest.cols) | 0) + 0.5) * nest.tile];

// ---- slow updates: flooding and temperature (once per second) --------------------------
// the temperature at nest row r: surface swings, deep soil is steady, the mound keeps shallow rooms warm (data on the
// nest, not a closure, so a world snapshot carries it: snap.js)
function tempAtOf(nest, r) {
  if (nest.bivouac) return nest.temp;
  const surf = nest.tSurf == null ? 22 : nest.tSurf, sun = nest.tSun || 0, col = nest.colony;
  return AL.lerp(surf, 20, Math.min(1, r / 34)) + Math.max(0, Math.min(10, col.moundR * 0.11)) * Math.max(0, 1 - r / 32) + sun * Math.max(0, 1 - r / 14);
}
function bindTemp(nest) { if (!nest.tempAt || !nest.tempAt._of) { nest.tempAt = r => tempAtOf(nest, r); nest.tempAt._of = true; } return nest; }
function second(nest, world) {
  const env = world.env, col = nest.colony;
  if (nest.bivouac) {
    // a bivouac hangs in the air: no flood; the ants open and close the cluster to keep the brood near 28 C
    nest.flood = 0; nest.water.fill(0);
    const surf = env.temp == null ? 22 : env.temp, keep = AL.clamp((nest.bivouac.n || 0) / 80, 0.25, 1);
    nest.nurseryTemp = AL.lerp(surf, 28, keep); nest.temp = AL.lerp(surf, 26, keep);
    bindTemp(nest);
    return;
  }
  // flood water pours in through the entrance during rain and pools in the lowest tunnels
  const stf = col.siteTraits && col.siteTraits.flood != null ? col.siteTraits.flood / 0.25 : 1;   // founding site: low ground floods more
  const rainIn = AL.World && AL.World.floodInflow && world.flood && world.flood.lastExtra ? AL.World.floodInflow(world, col.id) : env.rain * 3.2;   // World stage: sprinklers, soaked soil, snowmelt
  const inflow = rainIn * (AL.World ? 0.45 : 1) * (1 / (1 + col.moundR / 80)) * stf * (col.floodMul || 1);    // a big mound sheds rain; mud and wet biomes flood more (terrain.js)
  nest.flood = Math.max(0, nest.flood + inflow - 0.6);
  // water pools in the low tunnels but never fills more than about a fifth of the nest
  let openN = 0; for (let i = 0; i < nest.n; i++) if (nest.kind[i] === TILE.OPEN) openN++;
  nest.flood = Math.min(nest.flood, openN * 0.22);   // (balance runs: a third drowned the queen's chamber and nursery)
  // Gravity: rain that runs in through the entrance flows down and pools in the lowest open tiles first. A water
  // reservoir catches what pools on it: that water is stored (col.stock.water) instead of flooding the nest. Dug
  // below the other tunnels it catches it all; dug high up it only fills once everything under it is flooded.
  let vol = nest.flood, room = Math.max(0, (col.cap ? col.cap.water : 20) - col.stock.water), caught = 0;
  const per = AL.TUNE.WATER_PER_TILE * 0.5;   // stock water from one tile's worth of flood water
  nest.water.fill(0);
  const open = [];
  for (let i = 0; i < nest.n; i++) if (nest.kind[i] === TILE.OPEN) {
    if (((i / nest.cols) | 0) >= nest.waterTable) nest.water[i] = 1; else open.push(i);
  }
  if (vol > 0.01) {
    open.sort((a, b) => b - a); // deepest rows first
    for (const i of open) {
      if (vol <= 0) break;
      let f = Math.min(nest.lined[i] ? LINED_WATER : 1, vol);   // water never stands deep in a lined tunnel: it spreads on
      if (nest.chamber[i] === CH.WATER && room > 0) { const take = Math.min(f, room / per); room -= take * per; caught += take; vol -= take; f -= take; }
      nest.water[i] = f; vol -= f;
      if (((i / nest.cols) | 0) < 3) break;
    }
  }
  // ground water: a reservoir dug down to the water table fills from below too
  for (const i of nest.tiles[CH.WATER]) if (((i / nest.cols) | 0) >= nest.waterTable - 1 && room > 0) { const take = Math.min(room / per, 0.05); room -= take * per; caught += take; }
  if (caught > 0) { col.stock.water += caught * per; nest.flood = Math.max(0, nest.flood - caught); col._waterIn = (col._waterIn || 0) + caught * per; AL.emit(world, 'reservoirFill', { col: col.id, amt: caught * per }); }
  // temperature: surface swings, deep soil is steady; the mound keeps shallow chambers warm
  nest.tSurf = env.temp == null ? 22 : env.temp;
  // shallow rooms also warm in the sun by day and lose it at night (light 0..1); deep ones never notice
  nest.tSun = 6 * ((env.light == null ? 1 : env.light) - 0.5);
  const tAt = bindTemp(nest).tempAt;
  const nt = nest.tiles[CH.NURSERY];
  let avg = 0; for (const i of nt) avg += (i / nest.cols) | 0;
  const nr = nt.length ? avg / nt.length : 16;
  nest.nurseryTemp = tAt(nr);
  nest.temp = tAt(14);
  nest.tempAt = tAt;
  if (AL.NestClimate) AL.NestClimate.temps(nest);   // each nursery and dryer its own temperature
}

AL.Nest = { bindTemp, tempAtOf, TILE, HARD, DIG_BASE, CH, CH_INFO, F, NF, FAR, LINED_WATER, bfs, createNest, rebuild, rebuildCorpseField, nextTile, wanderTile, adjacentMark, mark, unmark, designate, excavate, isOpen, idx, tileOf, centre, second, diggable, carve, carveRoom, shapeBivouac, bivouacGeom };
if (NODE) module.exports = AL.Nest;
})(typeof window !== 'undefined' ? window : globalThis);
