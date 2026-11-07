// Pheromone grid: one Float32Array per pheromone kind over the surface.
// Ants deposit into it, it evaporates (half-life) and diffuses a little each update,
// and ants walking an existing trail reinforce it, so busy trails last and unused ones fade.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;

class PheromoneGrid {
  // w,h in cells; cell = world units per cell
  constructor(w, h, cell, opts) {
    opts = opts || {};
    this.w = w; this.h = h; this.cell = cell; this.inv = 1 / cell;
    this.data = new Float32Array(w * h);
    this.tmp = new Float32Array(w * h);
    this.halfLife = opts.halfLife || 30;  // seconds until a cell halves with no traffic
    this.diffuse = opts.diffuse == null ? 0.5 : opts.diffuse; // fraction per second that blends with neighbours
    this.max = opts.max || 8;
    this.floor = opts.floor || 0.004;     // below this a cell snaps to zero
    // linear fade per second on top of the half-life: weak scent dies off much sooner than strong scent,
    // so a faint stray trail goes away fast while a busy highway lasts (stronger = disproportionately longer)
    this.fade = opts.fade || 0;
    // bounding box of non-zero cells, so the update only touches live trails
    this.x0 = w; this.y0 = h; this.x1 = -1; this.y1 = -1;
    this.version = 0;                     // bumps when the data changes (renderer cache key)
  }
  index(x, y) {
    const cx = (x * this.inv) | 0, cy = (y * this.inv) | 0;
    if (x < 0 || y < 0 || cx >= this.w || cy >= this.h) return -1;
    return cy * this.w + cx;
  }
  _grow(cx, cy) {
    if (cx < this.x0) this.x0 = cx; if (cx > this.x1) this.x1 = cx;
    if (cy < this.y0) this.y0 = cy; if (cy > this.y1) this.y1 = cy;
  }
  deposit(x, y, amt) {
    const cx = (x * this.inv) | 0, cy = (y * this.inv) | 0;
    if (x < 0 || y < 0 || cx >= this.w || cy >= this.h) return;
    const i = cy * this.w + cx, v = this.data[i] + amt;
    this.data[i] = v > this.max ? this.max : v;
    if (cx < this.x0 || cx > this.x1 || cy < this.y0 || cy > this.y1) this._grow(cx, cy);
  }
  // sub-cell deposit: splits the amount over the 4 nearest cell centres (bilinear), so a trail sits where
  // the ant actually walked instead of snapping to the cell grid. Used by ants laying food trails.
  depositLin(x, y, amt) {
    const fx = x * this.inv - 0.5, fy = y * this.inv - 0.5;
    const cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    if (cx < 0 || cy < 0 || cx + 1 >= this.w || cy + 1 >= this.h) { this.deposit(x, y, amt); return; }
    const d = this.data, max = this.max, i = cy * this.w + cx, j = i + this.w;
    let v;
    v = d[i] + amt * (1 - tx) * (1 - ty); d[i] = v > max ? max : v;
    v = d[i + 1] + amt * tx * (1 - ty); d[i + 1] = v > max ? max : v;
    v = d[j] + amt * (1 - tx) * ty; d[j] = v > max ? max : v;
    v = d[j + 1] + amt * tx * ty; d[j + 1] = v > max ? max : v;
    if (cx < this.x0 || cx + 1 > this.x1 || cy < this.y0 || cy + 1 > this.y1) { this._grow(cx, cy); this._grow(cx + 1, cy + 1); }
  }
  // smooth (bilinear) reading between cell centres: gives the ant sensors a real gradient across a thin trail
  sampleLin(x, y) {
    const fx = x * this.inv - 0.5, fy = y * this.inv - 0.5;
    const cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
    if (cx < 0 || cy < 0 || cx + 1 >= this.w || cy + 1 >= this.h) return this.sample(x, y);
    const d = this.data, i = cy * this.w + cx, j = i + this.w;
    return (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[j] * (1 - tx) + d[j + 1] * tx) * ty;
  }
  // soft round brush, used when the player paints a trail. cap (optional): this brush never raises a cell
  // above cap (it never lowers a stronger cell either), so painted trails stay weaker than ant highways.
  depositDisc(x, y, r, amt, cap) {
    const top = cap ? Math.min(cap, this.max) : this.max;
    const c = this.cell, rc = Math.ceil(r / c);
    const cx0 = (x / c) | 0, cy0 = (y / c) | 0;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const cx = cx0 + dx, cy = cy0 + dy;
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) continue;
      const wx = (cx + 0.5) * c - x, wy = (cy + 0.5) * c - y, d = Math.sqrt(wx * wx + wy * wy);
      if (d > r) continue;
      const i = cy * this.w + cx, old = this.data[i];
      if (old >= top) continue;
      const v = old + amt * (1 - d / (r + 1e-6) * 0.6);
      this.data[i] = v > top ? top : v;
      this._grow(cx, cy);
    }
  }
  sample(x, y) {
    const cx = (x * this.inv) | 0, cy = (y * this.inv) | 0;
    if (x < 0 || y < 0 || cx >= this.w || cy >= this.h) return 0;
    return this.data[cy * this.w + cx];
  }
  // traffic reinforcement: walking an existing trail strengthens it (proportionally, capped)
  reinforce(x, y, amt, min) {
    const i = this.index(x, y);
    if (i < 0) return 0;
    const v = this.data[i];
    if (v < (min || 0.05)) return v;
    const nv = v + amt * (1 + v * 0.25);
    this.data[i] = nv > this.max ? this.max : nv;
    return nv;
  }
  // erase around a point (player eraser tool)
  erase(x, y, r) {
    const c = this.cell, rc = Math.ceil(r / c), cx0 = (x / c) | 0, cy0 = (y / c) | 0;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const cx = cx0 + dx, cy = cy0 + dy;
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) continue;
      const wx = (cx + 0.5) * c - x, wy = (cy + 0.5) * c - y;
      if (wx * wx + wy * wy <= r * r) this.data[cy * this.w + cx] = 0;
    }
  }
  // weaken scent around a point (multiply by f): an ant that follows a trail to a dead end marks it,
  // so trails to food that's gone shrink back from the far end instead of luring ants for minutes
  fadeDisc(x, y, r, f) {
    const c = this.cell, rc = Math.ceil(r / c), cx0 = (x / c) | 0, cy0 = (y / c) | 0;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      const cx = cx0 + dx, cy = cy0 + dy;
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) continue;
      const wx = (cx + 0.5) * c - x, wy = (cy + 0.5) * c - y;
      if (wx * wx + wy * wy <= r * r) this.data[cy * this.w + cx] *= f;
    }
  }
  // multiply everything (rain washing trails away)
  scale(f) {
    const d = this.data;
    for (let y = this.y0; y <= this.y1; y++) { const row = y * this.w; for (let x = this.x0; x <= this.x1; x++) d[row + x] *= f; }
  }
  clear() { this.data.fill(0); this.x0 = this.w; this.y0 = this.h; this.x1 = this.y1 = -1; this.version++; }
  total() { let s = 0; for (let i = 0; i < this.data.length; i++) s += this.data[i]; return s; }
  // evaporation + diffusion, restricted to the live bounding box (+1 cell for spread)
  update(dt) {
    if (this.x1 < 0) return;
    const w = this.w, h = this.h, d = this.data, t = this.tmp;
    const evap = AL.pow(0.5, dt / this.halfLife);
    const k = Math.min(0.45, this.diffuse * dt);
    const x0 = Math.max(0, this.x0 - 1), x1 = Math.min(w - 1, this.x1 + 1);
    const y0 = Math.max(0, this.y0 - 1), y1 = Math.min(h - 1, this.y1 + 1);
    let nx0 = w, ny0 = h, nx1 = -1, ny1 = -1;
    const floor = this.floor, fade = this.fade * dt;
    for (let y = y0; y <= y1; y++) {
      const row = y * w, up = (y > 0 ? y - 1 : y) * w, dn = (y < h - 1 ? y + 1 : y) * w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x, l = x > 0 ? i - 1 : i, r = x < w - 1 ? i + 1 : i;
        const v = d[i];
        const avg = (d[l] + d[r] + d[up + x] + d[dn + x]) * 0.25;
        let nv = (v + (avg - v) * k) * evap - fade;
        if (nv < floor) nv = 0;
        else { if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y; }
        t[i] = nv;
      }
    }
    // copy back only the region we touched (the rest is untouched zeros or stale tmp)
    for (let y = y0; y <= y1; y++) { const row = y * w; d.set(t.subarray(row + x0, row + x1 + 1), row + x0); }
    this.x0 = nx0; this.y0 = ny0; this.x1 = nx1; this.y1 = ny1;
    this.version++;
  }
}

AL.PheromoneGrid = PheromoneGrid;
if (NODE) module.exports = PheromoneGrid;
})(typeof window !== 'undefined' ? window : globalThis);
