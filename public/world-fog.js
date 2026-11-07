// Antlands World stage: fog of war with scent. The player's ants (and mound) see a few fog cells
// around them; beyond that, a wider ring where they can SMELL: rival ants, rival trails and
// spiders leave scent that drifts downwind, so the edge of the fog shows wisps before you see anything.
// world.fog = { visibleAt(x,y), seenAt(x,y), scentAt(x,y), visCell (per pheromone cell), hints[], nh, alert, version }
// If the core ships its own fog (M3, sets world.fog first), this module only adds world.scent on top.
// Sim only: no DOM.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); require('./world-time.js'); }

const FT = AL.FOG_TUNE = Object.assign({
  EVERY: 5,          // ticks between refreshes (6 Hz)
  SMELL: 3,          // fog cells beyond sight where ants smell
  HINT_MIN: 0.2,     // scent needed to show a wisp
  MAX_HINTS: 24,
  MOUND_SIGHT: 3,
}, AL.FOG_TUNE || {});

// disc offsets per radius (fog cells)
const DISC = [];
for (let r = 0; r <= 16; r++) {
  const a = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) a.push(dx, dy);
  DISC.push(Int8Array.from(a));
}

class Fog {
  constructor(S, col, ownVision) {
    const c = AL.TUNE.FOG_CELL || 32;
    this.cell = c; this.inv = 1 / c; this.w = Math.ceil(S.W / c); this.h = Math.ceil(S.H / c);
    const n = this.w * this.h; this.n = n;
    this.vis = new Uint8Array(n); this.seen = new Uint8Array(n); this.smell = new Uint8Array(n);
    this.stV = new Uint8Array(n); this.stS = new Uint8Array(n);
    this.scent = new Float32Array(n); this.tmp = new Float32Array(n); this.scentCol = new Uint8Array(n);
    this.visCell = new Uint8Array(S.gw * S.gh);
    this.mx = new Int32Array(S.gw); this.my = new Int32Array(S.gh);
    for (let gx = 0; gx < S.gw; gx++) this.mx[gx] = Math.min(this.w - 1, ((gx + 0.5) * S.cell * this.inv) | 0);
    for (let gy = 0; gy < S.gh; gy++) this.my[gy] = Math.min(this.h - 1, ((gy + 0.5) * S.cell * this.inv) | 0);
    this.col = col; this.own = ownVision; this.version = 0; this.refreshes = 0;
    this.hints = []; for (let k = 0; k < FT.MAX_HINTS; k++) this.hints.push({ x: 0, y: 0, s: 0, col: 0 });
    this.nh = 0; this.alert = 0; this.isWorldFog = true;
    this.candI = new Int32Array(256); this.candS = new Float32Array(256);
  }
  idx(x, y) { const cx = (x * this.inv) | 0, cy = (y * this.inv) | 0; return (x < 0 || y < 0 || cx >= this.w || cy >= this.h) ? -1 : cy * this.w + cx; }
  visibleAt(x, y) { const i = this.idx(x, y); return i >= 0 && this.vis[i] === 1; }
  seenAt(x, y) { const i = this.idx(x, y); return i >= 0 && this.seen[i] === 1; }
  scentAt(x, y) { const i = this.idx(x, y); return i < 0 ? 0 : this.scent[i]; }
  smellAt(x, y) { const i = this.idx(x, y); return i >= 0 && this.smell[i] === 1; }
  stamp(grid, cx, cy, r) {
    const d = DISC[Math.min(16, r)], w = this.w, h = this.h;
    for (let k = 0; k < d.length; k += 2) {
      const x = cx + d[k], y = cy + d[k + 1];
      if (x >= 0 && y >= 0 && x < w && y < h) grid[y * w + x] = 1;
    }
  }
  revealAll(on) { this.revealed = on !== false; if (this.revealed) { this.vis.fill(1); this.seen.fill(1); this.visCell.fill(1); } this.version++; }
}

// smell ring = vision grown by r cells (square), two sliding passes: O(cells), no per-ant work
function dilate(src, dst, tmp, w, h, r) {
  for (let y = 0; y < h; y++) {
    const row = y * w; let last = -1e9;
    for (let x = 0; x < w; x++) { if (src[row + x]) last = x; tmp[row + x] = x - last <= r ? 1 : 0; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[row + x]) last = x; if (last - x <= r) tmp[row + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; dst[y * w + x] = y - last <= r ? 1 : 0; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; if (last - y <= r) dst[y * w + x] = 1; }
  }
}

function refresh(world, F) {
  const A = world.ants, w = F.w, h = F.h, n = F.n, e = world.env;
  const own = F.own;
  if (own) { if (F.revealed) F.vis.fill(1); else { F.vis.fill(0); F.stV.fill(0); } }
  else { const core = world.fog; for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) F.vis[i] = core.visibleAt((x + 0.5) * F.cell, (y + 0.5) * F.cell) ? 1 : 0; }
  const col = world.colonies[F.col];
  const mod = e.mods && col ? e.mods[col.spKey] : null;
  const k = (mod ? mod.vis : 1) * (1 - 0.2 * (e.rain || 0) - 0.15 * (e.snow || 0));
  const inv = F.inv, CAS = AL.CASTES, X = A.x, Y = A.y, ST = A.state, LY = A.layer, CO = A.col, CA = A.caste;
  const sc = F.scent, stamping = own && !F.revealed;
  // fade old scent (rain washes it out faster)
  const decay = 0.72 - 0.25 * (e.rain || 0);
  for (let i = 0; i < n; i++) sc[i] *= decay;
  for (let i = 0; i < A.high; i++) {
    if (!ST[i] || LY[i] !== 0) continue;
    const cx = (X[i] * inv) | 0, cy = (Y[i] * inv) | 0;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const c = cy * w + cx;
    if (CO[i] === F.col) {
      if (!stamping) continue;
      const r = Math.max(1, Math.round(CAS[CA[i]].vis * k));
      if (F.stV[c] < r) { F.stamp(F.vis, cx, cy, r); F.stV[c] = r; }
    } else { sc[c] += 0.3; F.scentCol[c] = CO[i] + 1; }
  }
  // the mound sees around itself (and satellites, if the expansion stage added any)
  if (col && stamping) {
    const mr = Math.ceil((col.moundR || 30) * inv) + FT.MOUND_SIGHT;
    F.stamp(F.vis, (col.x * inv) | 0, (col.y * inv) | 0, mr);
    if (col.satellites) for (const s of col.satellites) F.stamp(F.vis, (s.x * inv) | 0, (s.y * inv) | 0, mr);
  }
  dilate(F.vis, F.smell, F.stS, w, h, FT.SMELL);
  // creatures smell too: spiders strongly (danger), prey faintly
  const L = world.surface.creatures || [];
  for (const cr of L) {
    if (!cr.alive || cr.hidden || cr.flying) continue;
    const c = F.idx(cr.x, cr.y); if (c < 0) continue;
    if (cr.hostile && cr.type !== 'termites') { sc[c] += 2.5; F.scentCol[c] = 200; }
    else if (cr.prey && cr.type !== 'termites') { sc[c] += 0.7; if (!F.scentCol[c] || F.scentCol[c] >= 200) F.scentCol[c] = 201; }
  }
  // rival food trails (every third refresh)
  if ((F.refreshes++ % 3) === 0) {
    const S = world.surface, gw = S.gw;
    for (let c = 0; c < world.pher.food.length; c++) {
      if (c === F.col) continue;
      const g = world.pher.food[c]; if (g.x1 < 0) continue;
      const d = g.data;
      for (let gy = g.y0; gy <= g.y1; gy += 2) for (let gx = g.x0; gx <= g.x1; gx += 2) {
        const v = d[gy * gw + gx]; if (v < 0.15) continue;
        const fc = F.my[gy] * w + F.mx[gx];
        sc[fc] += Math.min(0.25, v * 0.06); if (!F.scentCol[fc]) F.scentCol[fc] = c + 1;
      }
    }
  }
  // spread and drift downwind
  const t = F.tmp;
  for (let y = 0; y < h; y++) {
    const row = y * w, up = (y > 0 ? y - 1 : y) * w, dn = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      t[i] = sc[i] * 0.52 + 0.12 * (sc[x > 0 ? i - 1 : i] + sc[x < w - 1 ? i + 1 : i] + sc[up + x] + sc[dn + x]);
    }
  }
  const wx = e.windX || 0, wy = e.windY || 0, a = Math.min(0.4, 0.35 * (e.wind || 0));
  const ox = wx > 0.25 ? -1 : wx < -0.25 ? 1 : 0, oy = wy > 0.25 ? -1 : wy < -0.25 ? 1 : 0;
  if (a > 0.02 && (ox || oy)) {
    for (let y = 0; y < h; y++) { const yy = y + oy; for (let x = 0; x < w; x++) { const xx = x + ox, i = y * w + x; sc[i] = (xx < 0 || yy < 0 || xx >= w || yy >= h) ? t[i] : t[i] * (1 - a) + t[yy * w + xx] * a; } }
  } else sc.set(t);
  for (let i = 0; i < n; i++) if (sc[i] < 0.01) { sc[i] = 0; F.scentCol[i] = 0; } else if (sc[i] > 6) sc[i] = 6;
  // seen + per pheromone cell visibility for the trail renderer
  if (own) {
    for (let i = 0; i < n; i++) if (F.vis[i]) F.seen[i] = 1;
    const S = world.surface, gw = S.gw, vc = F.visCell;
    for (let gy = 0; gy < S.gh; gy++) { const fr = F.my[gy] * w, r = gy * gw; for (let gx = 0; gx < gw; gx++) vc[r + gx] = F.vis[fr + F.mx[gx]]; }
  }
  // scent hints: local maxima in the smell ring that the player can't see
  const vis = own ? F.vis : null, core = !own && world.fog;
  let nc = 0, alert = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, s = sc[i];
    if (s < FT.HINT_MIN || !F.smell[i]) continue;
    if (vis ? vis[i] : core && core.visibleAt((x + 0.5) * F.cell, (y + 0.5) * F.cell)) continue;
    alert++;
    if (s < sc[i - 1] || s < sc[i + 1] || s < sc[i - w] || s < sc[i + w] || s < sc[i - w - 1] || s < sc[i + w + 1]) continue;
    if (nc < F.candI.length) { F.candI[nc] = i; F.candS[nc] = s; nc++; }
  }
  // keep the strongest few
  let nh = 0;
  for (let m = 0; m < FT.MAX_HINTS && m < nc; m++) {
    let b = m; for (let q = m + 1; q < nc; q++) if (F.candS[q] > F.candS[b]) b = q;
    const ti = F.candI[m], ts = F.candS[m]; F.candI[m] = F.candI[b]; F.candS[m] = F.candS[b]; F.candI[b] = ti; F.candS[b] = ts;
    const i = F.candI[m], H = F.hints[nh++];
    H.x = (i % w + 0.5) * F.cell; H.y = (((i / w) | 0) + 0.5) * F.cell; H.s = F.candS[m]; H.col = F.scentCol[i];
  }
  F.nh = nh; F.alert = alert;
  F.version++;
}

AL.WorldFog = { Fog, refresh, FT };

AL.registerSystem({
  id: 'world-fog', order: 13,
  enabled(opts) { return opts.world !== false && opts.fog !== false && !opts.noFog; },
  init(world, opts) {
    const S = world.surface, col = world.player ? world.player.id : 0;
    // the core ships its own fog + scent (fog.js, M3): then this module stays out of the way,
    // unless opts.worldScent asks it to add its richer scent layer on top of the core fog
    if (world.fog && !world.fog.isWorldFog) { if (opts.worldScent) world.scent = new Fog(S, col, false); }
    else { world.fog = new Fog(S, col, true); world.scent = world.fog; }
    if (world.scent) refresh(world, world.scent);
  },
  post(world) { if (world.scent && (world.tick % FT.EVERY) === 0) refresh(world, world.scent); },
});

if (NODE) module.exports = AL.WorldFog;
})(typeof window !== 'undefined' ? window : globalThis);
