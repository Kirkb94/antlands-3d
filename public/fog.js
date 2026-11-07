// Fog of war plus scent: you see what your ants see; just past the edge of sight you can smell
// enemies (and creatures) before you see them, shown as drifting scent wisps at the fog edge.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');
const L = AL.LAYER;

function create(world) {
  const S = world.surface, cell = AL.TUNE.FOG_CELL, w = Math.ceil(S.W / cell), h = Math.ceil(S.H / cell), n = w * h;
  const fog = {
    cell, w, h, n, inv: 1 / cell,
    vis: new Uint8Array(n), seen: new Uint8Array(n), smell: new Uint8Array(n), tmp: new Uint8Array(n),
    scent: new Float32Array(n), version: 0, discs: {},
    visibleAt(x, y) { const cx = (x * this.inv) | 0, cy = (y * this.inv) | 0; return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h && this.vis[cy * this.w + cx] === 1; },
    seenAt(x, y) { const cx = (x * this.inv) | 0, cy = (y * this.inv) | 0; return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h && this.seen[cy * this.w + cx] === 1; },
    reveal(x, y, r) { stamp(this, x, y, r / cell, true); },
  };
  return fog;
}
function disc(fog, r) {
  const k = Math.round(r * 2);
  if (fog.discs[k]) return fog.discs[k];
  const rr = k / 2, out = [];
  for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++) for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) if (dx * dx + dy * dy <= rr * rr + 0.5) out.push(dx, dy);
  return (fog.discs[k] = out);
}
function stamp(fog, x, y, r, seenToo) {
  const cx = (x * fog.inv) | 0, cy = (y * fog.inv) | 0, d = disc(fog, r), w = fog.w, h = fog.h;
  for (let k = 0; k < d.length; k += 2) {
    const xx = cx + d[k], yy = cy + d[k + 1];
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const i = yy * w + xx; fog.vis[i] = 1; if (seenToo) fog.seen[i] = 1;
  }
}
function update(world) {
  const fog = world.fog, A = world.ants, w = fog.w, h = fog.h;
  fog.vis.fill(0);
  const me = world.player, mid = me.id;   // fog is this PC's view only (multiplayer: each PC its own colony)
  stamp(fog, me.x, me.y, 7 + me.moundR / fog.cell);
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== mid || A.layer[i] !== L.SURFACE) continue;
    stamp(fog, A.x[i], A.y[i], AL.CASTES[A.caste[i]].vis);
  }
  if (fog.extra) for (const e of fog.extra) stamp(fog, e.x, e.y, e.r / fog.cell);
  for (let i = 0; i < fog.n; i++) if (fog.vis[i]) fog.seen[i] = 1;
  // smell reaches 4 cells past sight: separable max-dilate of vis
  const t = fog.tmp, s = fog.smell, R = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let k = -R; k <= R && !m; k++) { const xx = x + k; if (xx >= 0 && xx < w && fog.vis[y * w + xx]) m = 1; } t[y * w + x] = m;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0; for (let k = -R; k <= R && !m; k++) { const yy = y + k; if (yy >= 0 && yy < h && t[yy * w + x]) m = 1; } s[y * w + x] = m;
  }
  // scent of enemies just out of sight
  const sc = fog.scent;
  for (let i = 0; i < fog.n; i++) sc[i] *= 0.82;
  const smellAt = (x, y, amt) => {
    const cx = (x * fog.inv) | 0, cy = (y * fog.inv) | 0; if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
    const i = cy * w + cx; if (!fog.vis[i] && s[i]) sc[i] = Math.min(1, sc[i] + amt);
  };
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] !== mid && A.layer[i] === L.SURFACE) smellAt(A.x[i], A.y[i], 0.25);
  for (const c of world.surface.creatures) if (c.alive) smellAt(c.x, c.y, 0.6);
  for (const c of world.colonies) if (c !== me && c.alive) smellAt(c.x, c.y, 0.5);
  fog.version++;
}

AL.registerSystem({
  id: 'fog', order: 8,
  enabled: opts => !opts.noFog && !opts.benchOnly,
  init(world) { world.fog = create(world); update(world); },
  tick(world) { if (world.tick % 8 === 0) update(world); },
});
AL.Fog = { create, update, stamp };
if (NODE) module.exports = AL.Fog;
})(typeof window !== 'undefined' ? window : globalThis);
