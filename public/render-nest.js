// Nest view (side view under the mound) and the smooth zoom between the surface and the nest.
(function (root) {
'use strict';
const AL = root.AL, Art = AL.Art, N = AL.Nest, TAU = Math.PI * 2, K = AL.CARRY, CH = N.CH, TILE = N.TILE;
const P = AL.Renderer.prototype;
const RES = 2;            // px per nest unit in the cached soil canvases
const SKY = 170;          // nest units of sky shown above ground
const TRANS_T = 1.25;     // seconds for the zoom transition

const baseSetWorld = P.setWorld;
P.setWorld = function (world) {
  baseSetWorld.call(this, world);
  this.view = 'surface';
  this.transition = { active: false, t: 0, dir: 1 };
  this.nest = world.nest || null; this.nestCol = null; this._nc = {};
  if (this.nest) {
    this.ncam = { x: this.nest.cols * this.nest.tile / 2, y: 230, z: 1.3 };
    this.soilCv = this.paintSoil(this.nest);
    this.cavCv = Art.canvas(this.nest.cols * this.nest.tile * RES, this.nest.rows * this.nest.tile * RES);
    this.cavVer = -1; this.cavAt = 0;
    this.fitNest();
  }
};
// whose nest the nest view shows: your own, or (sim opts.rivalNests) a rival's with real tunnels. Each nest keeps its
// own painted soil and cavity canvases.
P.nestOwner = function () { return this.nestCol || this.world.player; };
P.setNestCol = function (col) {
  const me = this.world.player;
  if (!col || col === me || !col.nest) col = null;
  if ((col || me) === this.nestOwner() && this.nest) return;
  const cur = this.nestOwner(), key = o => (o.hid != null ? o.hid : o.id);   // (cached per nest: colonies' and satellites')
  this._nc[key(cur)] = { soilCv: this.soilCv, cavCv: this.cavCv, cavVer: this.cavVer };
  const next = col || me, nest = next.nest, c = this._nc[key(next)];
  this.nestCol = col; this.nest = nest;
  if (c) { this.soilCv = c.soilCv; this.cavCv = c.cavCv; this.cavVer = c.cavVer; }
  else { this.soilCv = this.paintSoil(nest); this.cavCv = Art.canvas(nest.cols * nest.tile * RES, nest.rows * nest.tile * RES); this.cavVer = -1; }
  this.cavAt = 0;
};
// a nest you may look into: yours, or a rival's whose mound you can see (or where your ants are fighting)
P.canViewNest = function (col) {
  const w = this.world;
  if (!col || !col.nest || col.out || col.gone) return false;
  if (col === w.player || col.id === (w.me || 0)) return true;   // yours (and your satellites')
  if (!w.fog || !w.fog.visibleAt || w.fog.visibleAt(col.x, col.y)) return true;
  const A = w.ants, me = w.me || 0;
  const nid = col.hid != null ? col.hid : col.id;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === AL.LAYER.NEST && A.nest[i] === nid && A.col[i] === me) return true;
  return false;
};
P.fitNest = function () {
  if (!this.nest) return;
  const W = this.nest.cols * this.nest.tile;
  this.ncam.z = Math.max(0.5, (this.w / this.dpr) / (W + 80));
  this.ncam.x = W / 2; this.ncam.y = Math.min(260, this.nest.rows * this.nest.tile / 2 - 20);
  const b = this.nest.bivouac;
  if (b) {   // army ants: frame the hanging cluster and the log it hangs from
    const ch = b.hh * this.nest.tile + 150;
    this.ncam.z = AL.clamp((this.h / this.dpr) * 0.82 / ch, this.ncam.z, 3.2);
    this.ncam.y = b.hh * this.nest.tile / 2 - 45;
  }
  this.clampNest(this.ncam);
};

// ---- camera plumbing used by input.js ----
P.activeCam = function () { return this.view === 'nest' ? this.ncam : this.cam; };
P.screenToWorldActive = function (sx, sy) {
  return this.screenToWorld(sx, sy, this.activeCam());
};
P.clampActive = function (cam) { if (this.view === 'nest') this.clampNest(cam); else this.clampCam(cam); };
P.clampNest = function (cam) {
  const nest = this.nest, W = nest.cols * nest.tile, H = nest.rows * nest.tile, z = cam.z * this.dpr;
  const hw = this.w / 2 / z, hh = this.h / 2 / z;
  cam.x = hw * 2 >= W + 80 ? W / 2 : AL.clamp(cam.x, hw - 40, W + 40 - hw);
  cam.y = hh * 2 >= H + SKY ? (H - SKY) / 2 : AL.clamp(cam.y, -SKY + hh, H + 20 - hh);
};
P.zoomLimits = function () {
  if (this.view === 'nest') { const W = this.nest.cols * this.nest.tile; return { min: Math.max(0.35, (this.w / this.dpr) / (W + 80)), max: 5 }; }
  const S = this.world.surface;
  return { min: Math.max(0.2, Math.max((this.w / this.dpr) / S.W, (this.h / this.dpr) / S.H)), max: 6 };
};
// wheel past the zoom limit: in over your own mound -> nest; out of the nest -> surface
P.zoomBeyond = function (dir, pt) {
  if (!this.nest || this.transition.active) return false;
  if (this.view === 'surface' && dir > 0) {
    for (const c of (this.world.homes || this.world.colonies)) {   // colonies' mounds and satellites' with a nest
      if (!c || !c.nest || !this.canViewNest(c)) continue;
      const d = Math.hypot(pt.x - c.x, pt.y - c.y);
      if (d < c.moundR * 3 + 40) { this.goNest(c); return true; }
    }
  } else if (this.view === 'nest' && dir < 0) { this.goSurface(); return true; }
  return false;
};
P.goNest = function (col) {
  if (!this.nest || this.view === 'nest' || this.transition.active) return;
  if (!col && AL.UI && AL.UI.picked) col = AL.UI.picked(this.world);   // Tab: the nest picked in the nest tabs
  this.setNestCol(col && this.canViewNest(col) ? col : null);
  const c = this.nestOwner();
  this.transition = { active: true, t: 0, dir: 1, from: { x: this.cam.x, y: this.cam.y, z: this.cam.z }, to: c };
  if (AL.UI && AL.UI.onView) AL.UI.onView('nest');
};
P.goSurface = function () {
  if (!this.nest || this.view === 'surface' || this.transition.active) return;
  const c = this.nestOwner();
  this.transition = { active: true, t: 0, dir: -1, from: { x: this.ncam.x, y: this.ncam.y, z: this.ncam.z }, to: c };
  if (AL.UI && AL.UI.onView) AL.UI.onView('surface');
};
P.toggleView = function () { if (this.view === 'nest') this.goSurface(); else this.goNest(); };

// ---- frame ----
P.draw = function (alpha, real) {
  const t0 = performance.now();
  this.frame++;
  const ctx = this.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const tr = this.transition;
  if (tr && tr.active) {
    tr.t = Math.min(1, tr.t + (real || 1 / 60) / TRANS_T);
    const p = tr.dir > 0 ? tr.t : 1 - tr.t;          // p: 0 = surface, 1 = nest
    const c = this.nestOwner(), ent = this.nestEntrance();
    // surface camera dives into the mound
    const ps = AL.easeInOut(Math.min(1, p / 0.6));
    const from = tr.dir > 0 ? tr.from : { x: c.x + 60, y: c.y - 30, z: 2.2 };
    const sc = { x: AL.lerp(from.x, c.x, ps), y: AL.lerp(from.y, c.y, ps), z: from.z * Math.pow(16 / from.z, ps) };
    // nest camera pulls back from the entrance
    const pn = AL.easeInOut(AL.clamp((p - 0.4) / 0.6, 0, 1));
    const nfit = this.nestFitCam(), nto = tr.dir > 0 ? nfit : tr.from;
    const nc = { x: AL.lerp(ent.x, nto.x, pn), y: AL.lerp(ent.y - 20, nto.y, pn), z: nto.z * Math.pow(9, 1 - pn) };
    const mixA = AL.smooth(AL.clamp((p - 0.38) / 0.28, 0, 1));
    if (mixA < 1) this.drawSurface(ctx, sc, alpha, 1);
    if (mixA > 0) { ctx.globalAlpha = mixA; this.drawNest(ctx, nc, alpha, mixA); ctx.globalAlpha = 1; }
    // a soft dark iris at the hand-over hides the seam
    const iris = Math.max(0, 1 - Math.abs(p - 0.5) / 0.18);
    if (iris > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); const g = ctx.createRadialGradient(this.w / 2, this.h / 2, 0, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7); g.addColorStop(0, 'rgba(20,12,6,' + iris * 0.15 + ')'); g.addColorStop(1, 'rgba(20,12,6,' + iris * 0.85 + ')'); ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h); }
    if (tr.t >= 1) {
      tr.active = false;
      this.view = tr.dir > 0 ? 'nest' : 'surface';
      if (this.view === 'nest') Object.assign(this.ncam, nfit);
      else { this.cam.x = c.x + 60; this.cam.y = c.y - 30; this.cam.z = 2.2; this.clampCam(this.cam); }
    }
  } else if (this.view === 'nest' && this.nest) this.drawNest(ctx, this.ncam, alpha, 1);
  else this.drawSurface(ctx, this.cam, alpha, 1);
  this.stats.ms = performance.now() - t0;
};
P.nestEntrance = function () { const n = this.nest; return { x: (n.entrance.c + 0.5) * n.tile, y: 0 }; };
P.nestFitCam = function () { const c = { x: 0, y: 0, z: 1 }; const keep = Object.assign({}, this.ncam); this.fitNest(); Object.assign(c, this.ncam); Object.assign(this.ncam, keep); return c; };

// ---- painted soil (static: layers, rocks, roots) ------------------------------------------
P.paintSoil = function (nest) {
  if (nest.bivouac && this.paintBivouacBack) return this.paintBivouacBack(nest);   // army ants (render-bivouac.js)
  const W = nest.cols * nest.tile, H = nest.rows * nest.tile;
  const cv = Art.canvas(W * RES, H * RES), x = cv.getContext('2d');
  const R = AL.rng(91);
  // 1) layer colours at tile resolution, upscaled smoothly so strata blend
  const small = Art.canvas(nest.cols, nest.rows), sx = small.getContext('2d'), img = sx.createImageData(nest.cols, nest.rows);
  const COLS = { 1: [118, 84, 52], 2: [146, 92, 58], 3: [122, 108, 92], 4: [110, 100, 90], 5: [118, 84, 52], 6: [138, 104, 66] };
  for (let i = 0; i < nest.n; i++) {
    const r = (i / nest.cols) | 0, c = i % nest.cols;
    let k = nest.base[i]; if (k === TILE.ROCK || k === TILE.ROOT) k = r < 8 ? 1 : nest.base[Math.max(0, i - 1)] === TILE.GRAVEL ? 3 : 2;
    const col = COLS[k] || COLS[1], depth = r / nest.rows, n = AL.fbm(c / 6, r / 6, 5, 2) * 0.25 + 0.88;
    const dk = (1 - depth * 0.38) * n;
    img.data[i * 4] = col[0] * dk; img.data[i * 4 + 1] = col[1] * dk; img.data[i * 4 + 2] = col[2] * dk; img.data[i * 4 + 3] = 255;
  }
  sx.putImageData(img, 0, 0);
  x.imageSmoothingEnabled = true; x.drawImage(small, 0, 0, W * RES, H * RES);
  x.scale(RES, RES);
  // 2) strata lines and grain speckle
  for (let k = 0; k < 26; k++) {
    const y0 = 20 + R() * (H - 30);
    x.strokeStyle = 'rgba(40,24,12,' + (0.08 + R() * 0.08) + ')'; x.lineWidth = 1 + R() * 2;
    x.beginPath(); for (let xx = 0; xx <= W; xx += 20) x.lineTo(xx, y0 + Math.sin(xx / 70 + k) * 4 + (AL.noise2(xx / 50, k, 3) - 0.5) * 8); x.stroke();
  }
  for (let k = 0; k < 16000; k++) {
    const px = R() * W, py = R() * H, lit = R() < 0.5;
    x.fillStyle = lit ? 'rgba(230,200,160,' + (0.06 + R() * 0.08) + ')' : 'rgba(30,18,8,' + (0.08 + R() * 0.1) + ')';
    x.fillRect(px, py, 0.6 + R() * 1.2, 0.6 + R() * 1.2);
  }
  // pebbles in the gravel
  for (let i = 0; i < nest.n; i++) if (nest.base[i] === TILE.GRAVEL && R() < 0.3) {
    const [cx, cy] = N.centre(nest, i);
    for (let k = 0; k < 3; k++) {
      const px = cx + (R() - 0.5) * 10, py = cy + (R() - 0.5) * 10, r = 0.8 + R() * 1.8;
      x.fillStyle = 'rgba(30,20,10,0.35)'; x.beginPath(); x.ellipse(px + 0.5, py + 0.7, r, r * 0.8, 0, 0, TAU); x.fill();
      x.fillStyle = ['#a59a8a', '#8f8576', '#b8ad9c'][k]; x.beginPath(); x.ellipse(px, py, r, r * 0.8, R() * 3, 0, TAU); x.fill();
    }
  }
  // 3) rocks: one merged blob per rock, shaded once (no grape clusters)
  const rockPath = (off, rad) => {
    x.beginPath();
    for (let i = 0; i < nest.n; i++) { if (nest.base[i] !== TILE.ROCK) continue; const [cx, cy] = N.centre(nest, i); const rr = rad + AL.hash2(i, 3, 9) * 1.2; x.moveTo(cx + off + rr, cy + off); x.arc(cx + off, cy + off, rr, 0, TAU); }
  };
  x.fillStyle = 'rgba(20,12,6,0.55)'; rockPath(2.5, 9.4); x.fill();
  x.save(); rockPath(0, 9); x.clip();
  const rg = x.createLinearGradient(0, 0, 0, H); rg.addColorStop(0, '#8d867a'); rg.addColorStop(1, '#5d574e');
  x.fillStyle = rg; x.fillRect(0, 0, W, H);
  // broad facets: big soft light and dark patches give each boulder some volume
  for (let i = 0; i < nest.n; i++) if (nest.base[i] === TILE.ROCK && AL.hash2(i, 4, 2) < 0.22) {
    const [cx, cy] = N.centre(nest, i), lit = AL.hash2(i, 6, 2) < 0.6;
    const g = x.createRadialGradient(cx - 5, cy - 7, 1, cx, cy, 24);
    g.addColorStop(0, lit ? 'rgba(214,206,190,0.5)' : 'rgba(40,34,28,0.35)'); g.addColorStop(1, 'rgba(128,120,108,0)');
    x.fillStyle = g; x.fillRect(cx - 24, cy - 24, 48, 48);
  }
  x.restore();
  // 4) roots: tapered woody strokes along their paths
  x.lineCap = 'round'; x.lineJoin = 'round';
  for (const path of nest.roots || []) {
    for (const [extra, col] of [[2.5, 'rgba(30,18,8,0.45)'], [0, '#7a5634'], [-2.6, 'rgba(210,170,120,0.35)']]) {
      for (let k = 1; k < path.length; k++) {
        const [ax, ay, aw] = path[k - 1], [bx, by] = path[k];
        x.strokeStyle = col; x.lineWidth = Math.max(0.6, 2 + aw * 5 + extra);
        x.beginPath(); x.moveTo(ax - (extra < 0 ? 0.8 : 0), ay); x.lineTo(bx - (extra < 0 ? 0.8 : 0), by); x.stroke();
      }
    }
  }
  // 5) buried wood (carpenter stump): grain rings
  for (let i = 0; i < nest.n; i++) if (nest.base[i] === TILE.WOOD) {
    const [cx, cy] = N.centre(nest, i);
    x.fillStyle = 'rgba(160,120,70,0.5)'; x.fillRect(cx - 5, cy - 5, 10, 10);
    x.strokeStyle = 'rgba(90,60,30,0.4)'; x.lineWidth = 0.7; x.beginPath(); x.moveTo(cx - 5, cy + Math.sin(cx) * 2); x.lineTo(cx + 5, cy + Math.sin(cx + 5) * 2); x.stroke();
  }
  return cv;
};

// ---- cavities: tunnels and chambers (re-painted when the layout changes) -------------------
P.paintCavities = function (nest) {
  if (nest.bivouac && this.paintBivouac) return this.paintBivouac(nest);
  const cv = this.cavCv, x = cv.getContext('2d'), T = nest.tile, cols = nest.cols;
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
  x.setTransform(RES, 0, 0, RES, 0, 0);
  const open = i => i >= 0 && i < nest.n && nest.kind[i] === TILE.OPEN;
  const blob = (r, style) => {
    x.fillStyle = style; x.beginPath();
    for (let i = 0; i < nest.n; i++) {
      if (!open(i)) continue;
      const c = i % cols, cx = (c + 0.5) * T, cy = (((i / cols) | 0) + 0.5) * T;
      x.moveTo(cx + r, cy); x.arc(cx, cy, r, 0, TAU);
      // bridge to the right and down so tunnels are continuous tubes
      if (c < cols - 1 && open(i + 1)) x.rect(cx, cy - r, T, r * 2);
      if (open(i + cols)) x.rect(cx - r, cy, r * 2, T);
    }
    x.fill();
  };
  blob(T * 0.8, 'rgba(196,150,100,0.55)');   // lit rim of packed soil
  blob(T * 0.66, '#2b1a0e');                   // the cavity
  // floor light: tiles with soil beneath get a warm floor strip, ceilings get shadow
  for (let i = 0; i < nest.n; i++) {
    if (!open(i)) continue;
    const c = i % cols, r = (i / cols) | 0, cx = (c + 0.5) * T, cy = (r + 0.5) * T;
    if (!open(i + cols)) { const g = x.createLinearGradient(0, cy, 0, cy + T * 0.66); g.addColorStop(0, 'rgba(120,80,45,0)'); g.addColorStop(1, 'rgba(150,105,60,0.55)'); x.fillStyle = g; x.fillRect(cx - T * 0.6, cy, T * 1.2, T * 0.66); }
    const ch = nest.chamber[i];
    if (ch) { x.fillStyle = N.CH_INFO[ch].col; x.globalAlpha = 0.1; x.fillRect(cx - T / 2, cy - T / 2, T, T); x.globalAlpha = 1; }
  }
  this.cavVer = nest.version;
};

// ---- drawing the nest view ------------------------------------------------------------------
P.drawNest = function (ctx, cam, alpha, opacity) {
  const nest = this.nest, world = this.world, col = this.nestOwner();
  if (nest.version !== this.cavVer && performance.now() - this.cavAt > 120) { this.paintCavities(nest); this.cavAt = performance.now(); }
  const z = cam.z * this.dpr, ox = this.w / 2 - cam.x * z, oy = this.h / 2 - cam.y * z;
  const W = nest.cols * nest.tile, H = nest.rows * nest.tile, T = nest.tile;
  const v = { x0: cam.x - this.w / 2 / z, y0: cam.y - this.h / 2 / z, x1: cam.x + this.w / 2 / z, y1: cam.y + this.h / 2 / z };
  const view = Object.assign(v, { z, ox, oy, w: this.w, h: this.h, dpr: this.dpr, cam, alpha, scene: 'nest', frame: this.frame });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1a100a'; ctx.fillRect(0, 0, this.w, this.h);
  ctx.setTransform(z, 0, 0, z, ox, oy);
  const env = world.env, light = env.light == null ? 1 : env.light;
  const biv = nest.bivouac && this.drawBivouacScene;
  if (biv) this.drawBivouacScene(ctx, W, H, light);   // army ants: a log in the forest shade, no soil (render-bivouac.js)
  else {
  // sky and the yard edge
  const sky = ctx.createLinearGradient(0, -SKY - 400, 0, 0);
  sky.addColorStop(0, Art.mix('#0d1530', '#8fc2e8', light)); sky.addColorStop(1, Art.mix('#1c2440', '#d9ecf2', light));
  ctx.fillStyle = sky; ctx.fillRect(-600, -SKY - 600, W + 1200, SKY + 600);
  // distant grass silhouettes
  ctx.fillStyle = Art.mix('#1a2a1a', '#6f9f45', light * 0.8 + 0.1);
  ctx.beginPath(); ctx.moveTo(-600, 0);
  for (let xx = -600; xx <= W + 600; xx += 6) ctx.lineTo(xx, -10 - Math.abs(Math.sin(xx * 0.37) * 18) - AL.hash2(xx, 1, 4) * 22);
  ctx.lineTo(W + 600, 0); ctx.closePath(); ctx.fill();
  // soil beyond the dug grid edges
  ctx.fillStyle = '#4a321e'; ctx.fillRect(-600, 0, 600, H + 200); ctx.fillRect(W, 0, 600, H + 200); ctx.fillRect(-600, H, W + 1200, 300);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(this.soilCv, 0, 0, W, H);
  ctx.drawImage(this.cavCv, 0, 0, W, H);
  if (biv) this.drawBivouacCrawl(ctx, nest, col); else this.drawMoundProfile(ctx, col, nest);
  // flood water
  for (let i = 0; i < nest.n; i++) {
    const wv = nest.water[i]; if (wv < 0.05) continue;
    const c = i % nest.cols, r = (i / nest.cols) | 0;
    ctx.fillStyle = 'rgba(70,130,190,' + (0.45 + 0.2 * wv) + ')';
    ctx.fillRect(c * T + 1, r * T + T * (1 - wv), T - 2, T * wv);
    if (nest.water[i - nest.cols] < 0.05 && nest.kind[i - nest.cols] === TILE.OPEN) { ctx.fillStyle = 'rgba(210,235,255,0.55)'; ctx.fillRect(c * T + 1, r * T + T * (1 - wv) + Math.sin(this.frame * 0.08 + c) * 0.6, T - 2, 1); }
  }
  // the water reservoir: filled from the bottom up to the colony's stored water (render-nest's own gravity)
  this.drawReservoir(ctx, nest, col);
  // dig markers: hatched, filling up as workers dig
  const pulse = 0.55 + 0.25 * Math.sin(this.frame * 0.1);
  for (let i = 0; i < nest.n; i++) {
    if (!nest.mark[i]) continue;
    const c = i % nest.cols, r = (i / nest.cols) | 0, x = c * T, y = r * T;
    if (x > v.x1 || x + T < v.x0 || y > v.y1 || y + T < v.y0) continue;
    ctx.fillStyle = 'rgba(255,170,60,' + (0.14 + 0.1 * pulse) + ')'; ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
    ctx.strokeStyle = 'rgba(255,190,90,' + pulse + ')'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x + 1, y + T - 1); ctx.lineTo(x + T - 1, y + 1); ctx.moveTo(x + 1, y + T / 2); ctx.lineTo(x + T / 2, y + 1); ctx.moveTo(x + T / 2, y + T - 1); ctx.lineTo(x + T - 1, y + T / 2); ctx.stroke();
    if (nest.prog[i] > 0) { ctx.fillStyle = 'rgba(40,24,12,0.75)'; const ph = (T - 2) * nest.prog[i]; ctx.fillRect(x + 1, y + 1, T - 2, ph); }
  }
  // tool preview under the cursor
  const tool = AL.Input && AL.Input.tool, m = AL.Input && AL.Input.mouse;
  if (tool && tool.layer === 'nest' && m && m.inside) {
    const w = this.screenToWorld(m.x, m.y, cam), rr = tool.tiles || 0, c0 = (w.x / T) | 0, r0 = (w.y / T) | 0;
    ctx.strokeStyle = (tool.colorOf ? tool.colorOf() : tool.color) || 'rgba(255,220,140,0.9)'; ctx.lineWidth = 1.2 / z * this.dpr;
    for (let dr = -rr; dr <= rr; dr++) for (let dc = -rr; dc <= rr; dc++) { if (Math.abs(dr) + Math.abs(dc) > rr + (rr > 1 ? 1 : 0)) continue; const c = c0 + dc, r = r0 + dr; if (c < 0 || r < 0 || c >= nest.cols || r >= nest.rows) continue; ctx.strokeRect(c * T + 0.5, r * T + 0.5, T - 1, T - 1); }
  }
  this.drawNestContents(ctx, nest, col, v);
  this.layer('nestUnder', ctx, view);
  this.drawNestAnts(ctx, alpha, v, z, ox, oy);
  ctx.setTransform(z, 0, 0, z, ox, oy);
  this.drawParticles(ctx, z, 1);
  this.layer('nestOver', ctx, view);
  // depth darkening and a warm glow around the queen
  const dg = ctx.createLinearGradient(0, 0, 0, H);
  dg.addColorStop(0, 'rgba(10,5,2,0)'); dg.addColorStop(1, 'rgba(10,5,2,0.45)');
  ctx.fillStyle = dg; ctx.fillRect(-600, 0, W + 1200, H + 300);
  const q = col.queen;
  if (q && q.alive && q.i >= 0) {
    const A = world.ants, qx = A.x[q.i], qy = A.y[q.i];
    const g = ctx.createRadialGradient(qx, qy, 2, qx, qy, 70);
    g.addColorStop(0, 'rgba(255,200,120,0.16)'); g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = g; ctx.fillRect(qx - 70, qy - 70, 140, 140);
  }
  if (light < 1) { ctx.fillStyle = 'rgba(10,20,50,' + (1 - light) * 0.35 + ')'; ctx.fillRect(-600, -SKY - 600, W + 1200, SKY + 600); }
  this.drawChamberLabels(ctx, nest, z);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (this.drawBars) this.drawBars(ctx, null);   // health bars over hurt ants in the nest
  this.layer('nestScreen', ctx, Object.assign({}, view, { z: 1, ox: 0, oy: 0 }));
  this.lastNestView = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

// Reservoir tiles fill row by row from the lowest: the share filled is the colony's water over what it can hold.
// The surface wobbles a little; drops from ants landing in it ripple (spawnFx).
P.drawReservoir = function (ctx, nest, col) {
  const tl = nest.tiles[CH.WATER]; if (!tl.length) { this.resInfo = null; return; }
  const T = nest.tile, cols = nest.cols, cap = Math.max(1, col.cap.water), f = AL.clamp(col.stock.water / cap, 0, 1);
  this.resInfo = { have: col.stock.water, cap, f };
  if (f <= 0.002) return;
  // the water line: fill the tiles row by row from the lowest, so the level sits where that much water would
  const rows = new Map(); for (const i of tl) { const r = (i / cols) | 0; rows.set(r, (rows.get(r) || 0) + 1); }
  const order = [...rows.keys()].sort((a, b) => b - a);
  let left = f * tl.length, level = (order[0] + 1) * T;
  for (const r of order) { const n = rows.get(r), share = Math.min(1, left / n); level = (r + 1 - share) * T; left -= share * n; if (left <= 1e-6) break; }
  // one body of water inside the reservoir's own cavity outline
  const open = i => i >= 0 && i < nest.n && nest.kind[i] === TILE.OPEN && nest.chamber[i] === CH.WATER, rr = T * 0.66;
  ctx.save(); ctx.beginPath();
  let x0 = 1e9, x1 = -1e9, yB = 0;
  for (const i of tl) {
    const c = i % cols, cx = (c + 0.5) * T, cy = (((i / cols) | 0) + 0.5) * T;
    ctx.moveTo(cx + rr, cy); ctx.arc(cx, cy, rr, 0, TAU);
    if (open(i + 1)) ctx.rect(cx, cy - rr, T, rr * 2);
    if (open(i + cols)) ctx.rect(cx - rr, cy, rr * 2, T);
    x0 = Math.min(x0, cx - rr); x1 = Math.max(x1, cx + rr); yB = Math.max(yB, cy + rr);
  }
  ctx.clip();
  const g = ctx.createLinearGradient(0, level, 0, yB);
  g.addColorStop(0, 'rgba(110,182,228,0.88)'); g.addColorStop(1, 'rgba(32,80,140,0.94)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x0, yB);
  for (let x = x0; x <= x1 + 2; x += 2) ctx.lineTo(x, level + Math.sin(this.frame * 0.05 + x * 0.25) * 0.6);
  ctx.lineTo(x1 + 2, yB); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(230,246,255,0.75)'; ctx.lineWidth = 0.8;
  ctx.beginPath(); for (let x = x0; x <= x1 + 2; x += 2) { const y = level + Math.sin(this.frame * 0.05 + x * 0.25) * 0.6; if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke();
  ctx.restore();
};
P.drawMoundProfile = function (ctx, col, nest) {
  const ex = (nest.entrance.c + 0.5) * nest.tile, hw = col.moundR * 1.7, hh = col.moundR * 0.6;
  const g = ctx.createLinearGradient(0, -hh, 0, 4);
  g.addColorStop(0, '#b08656'); g.addColorStop(0.6, '#8a6440'); g.addColorStop(1, '#6a4a2c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ex - hw, 2);
  for (let k = 0; k <= 40; k++) { const t = k / 40, xx = ex - hw + t * hw * 2, s = Math.sin(t * Math.PI); ctx.lineTo(xx, 2 - hh * Math.pow(s, 1.4) - AL.hash2(k, 2, col.id) * 2.5 * s); }
  ctx.closePath(); ctx.fill();
  const R = AL.rng(41 + Math.round(col.moundR));
  for (let k = 0; k < hw * 3; k++) {
    const t = R(), xx = ex - hw + t * hw * 2, top = 2 - hh * Math.pow(Math.sin(t * Math.PI), 1.4), yy = top + R() * (2 - top);
    ctx.fillStyle = R() < 0.5 ? 'rgba(230,200,150,0.35)' : 'rgba(50,30,15,0.35)'; ctx.fillRect(xx, yy, 1.2, 1.2);
  }
  // the entrance: a dark mouth at the crater on top
  ctx.fillStyle = '#1a0f07'; ctx.beginPath(); ctx.ellipse(ex, 2 - hh + 3, 5.5, 3.4, 0, 0, TAU); ctx.fill();
  ctx.fillRect(ex - 3.4, 2 - hh + 3, 6.8, hh);
};

P.drawNestContents = function (ctx, nest, col, v) {
  const T = nest.tile, R = AL.rng(5);
  // food piles in the stores: golden sugar drops and red protein bits, filling the floor as stock rises
  const ft = nest.tiles[CH.FOOD];
  if (ft.length) {
    const s = col.stock, total = s.sugar + s.protein + s.seeds, fill = Math.min(1, total / Math.max(1, col.cap.food));
    const items = Math.round(ft.length * 5 * fill), sFrac = total > 0 ? s.sugar / total : 0, pFrac = total > 0 ? s.protein / total : 0;
    for (let k = 0; k < items; k++) {
      const t = ft[(k * 7) % ft.length], [cx, cy] = N.centre(nest, t);
      const px = cx + (AL.hash2(k, 1, 3) - 0.5) * 8, py = cy + 2.5 - AL.hash2(k, 2, 3) * 4, u = AL.hash2(k, 3, 3);
      if (u < sFrac) { ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px - 0.8, py - 0.9, 0.7, 0.7); }
      else if (u < sFrac + pFrac) { ctx.fillStyle = '#c4553e'; ctx.fillRect(px - 1.3, py - 1, 2.6, 2); }
      else { ctx.fillStyle = '#a07a42'; ctx.beginPath(); ctx.ellipse(px, py, 1.6, 0.8, u * 6, 0, TAU); ctx.fill(); }
    }
  }
  // brood in the nursery
  const t = this.frame * 0.03;
  for (let k = 0; k < col.brood.length; k++) {
    const b = col.brood[k]; if (b.slot < 0) continue;
    const [cx, cy] = N.centre(nest, b.slot), sub = b.sub || 0;
    const px = cx + ((sub % 3) - 1) * 3.2, py = cy + 2 - ((sub / 3) | 0) * 2.6;
    ctx.save(); ctx.translate(px, py);
    if (b.stage === 0) { ctx.fillStyle = '#fbf6ea'; ctx.beginPath(); ctx.ellipse(0, 0, 1.2, 0.8, 0.3, 0, TAU); ctx.fill(); }
    else if (b.stage === 1) {
      const s = 0.7 + b.t * 0.6, wig = Math.sin(t * 3 + k) * 0.15;
      ctx.rotate(wig); ctx.fillStyle = b.starve > 20 ? '#d8c8a0' : '#f3e6c4';
      ctx.beginPath(); ctx.ellipse(0, 0, 2.2 * s, 1.4 * s, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(160,130,90,0.6)'; ctx.lineWidth = 0.25;
      for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.moveTo(j * 0.8 * s, -1.2 * s); ctx.lineTo(j * 0.8 * s, 1.2 * s); ctx.stroke(); }
      ctx.fillStyle = '#c9a16a'; ctx.beginPath(); ctx.arc(1.9 * s, -0.3 * s, 0.5 * s, 0, TAU); ctx.fill();
    } else { const g = ctx.createLinearGradient(0, -1.5, 0, 1.5); g.addColorStop(0, '#e9d2a2'); g.addColorStop(1, '#b8945c'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.4, 0, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  // bodies lying in the tunnels, and midden debris
  const dead = this.atlas[0].dead;
  for (const k of nest.corpses) {
    ctx.save(); ctx.translate(k.x, k.y + 2); ctx.rotate(k.a); ctx.scale(0.8 / dead.scale, 0.8 / dead.scale);
    ctx.drawImage(dead.img, -dead.cs / 2, -dead.cs / 2); ctx.restore();
  }
  const mt = nest.tiles[CH.MIDDEN];
  if (mt.length) {
    const n = Math.min(mt.length * 6, Math.round(nest.middenFill));
    for (let k = 0; k < n; k++) { const tt = mt[k % mt.length], [cx, cy] = N.centre(nest, tt); ctx.fillStyle = k % 3 ? 'rgba(60,50,30,0.8)' : 'rgba(110,100,60,0.8)'; ctx.fillRect(cx + (AL.hash2(k, 5, 1) - 0.5) * 8, cy + 3 - AL.hash2(k, 6, 1) * 2.5, 1.6, 1.2); }
  }
};
P.drawChamberLabels = function (ctx, nest, z) {
  if (z < 0.9 * this.dpr) return;
  const fs = Math.max(6, 11 / z * this.dpr);
  ctx.font = '600 ' + fs + 'px system-ui, Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let ch = 1; ch < N.CH_INFO.length; ch++) {
    const tl = nest.tiles[ch]; if (!tl || !tl.length) continue;
    // label each connected group once, at its top centre (with its room level, and a nursery's or dryer's temperature: nestclimate.js)
    const seen = new Set();
    for (const s of tl) {
      if (seen.has(s)) continue;
      const stack = [s], grp = []; seen.add(s);
      while (stack.length) { const i = stack.pop(); grp.push(i); for (const j of [i - 1, i + 1, i - nest.cols, i + nest.cols]) if (j >= 0 && j < nest.n && !seen.has(j) && nest.chamber[j] === ch && nest.kind[j] === TILE.OPEN) { seen.add(j); stack.push(j); } }
      if (grp.length < 3) continue;
      let sx = 0, minR = 999; for (const i of grp) { sx += i % nest.cols; minR = Math.min(minR, (i / nest.cols) | 0); }
      const x = (sx / grp.length + 0.5) * nest.tile, y = minR * nest.tile - fs * 0.2;
      const info = N.CH_INFO[ch], ri = ch === CH.WATER && this.resInfo, rm = nest.rooms && nest.roomOf && !nest.bivouac ? nest.rooms[nest.roomOf[s]] : null;
      const name = (ri ? info.name + ' ' + Math.round(ri.have) + ' / ' + Math.round(ri.cap) : info.name) + (rm ? ' · Lv ' + rm.level + (rm.warm ? ' · ' + Math.round(rm.temp) + '°' : '') : '');
      ctx.fillStyle = 'rgba(20,12,6,0.6)'; const w = ctx.measureText(name).width + fs;
      ctx.fillRect(x - w / 2, y - fs * 0.65, w, fs * 1.3);
      ctx.fillStyle = info.col; ctx.fillText(name, x, y);
    }
  }
};
P.drawNestAnts = function (ctx, alpha, v, z, ox, oy) {
  const A = this.world.ants, n = A.high, ME = this.nestOwner().hid != null ? this.nestOwner().hid : this.nestOwner().id;   // the nest id on view
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  this.barBegin(false);   // health bars (render-bars.js)
  for (let i = 0; i < n; i++) {
    if (!A.state[i] || A.layer[i] !== AL.LAYER.NEST || A.nest[i] !== ME || A.state[i] === AL.ST.N_TRANSIT) continue;   // only ants inside the nest on view (not the ones away in a nest tunnel)
    const x = A.px[i] + (A.x[i] - A.px[i]) * alpha, y = A.py[i] + (A.y[i] - A.py[i]) * alpha;
    if (x < v.x0 - 20 || x > v.x1 + 20 || y < v.y0 - 20 || y > v.y1 + 20) continue;
    const c = A.col[i], caste = A.caste[i], at = this.atlas[caste === AL.CASTE.CAPTIVE && A.host ? A.host[i] : c];   // captives: host colours
    const sp = A.legs[i] !== 63 || A.headless[i] ? Art.hurtSprite(at, caste, A.legs[i], A.headless[i]) : at.hi[caste];   // maimed (injury.js)
    const mill = A.state[i] === AL.ST.N_MILL;
    const k = z * 0.8 * A.size[i] / sp.scale, cs = sp.cs, a = A.a[i] + (mill ? Math.sin(this.frame * 0.35 + i) * 0.12 : 0);   // millers rock their heads as they grind
    const co = Math.cos(a) * k, si = Math.sin(a) * k;
    ctx.setTransform(co, si, -si, co, x * z + ox, y * z + oy);
    ctx.drawImage(sp.img, ((A.anim[i] | 0) & 3) * cs, 0, cs, cs, -cs / 2, -cs / 2, cs, cs);
    if (mill) this.drawMilling(ctx, i, x * z + ox, y * z + oy, a, z * A.size[i]);
    if (A.hp[i] < A.maxhp[i]) this.barAnt(i, x * z + ox, y * z + oy, 5.2 * z * A.size[i] * AL.CASTES[caste].size);
    if (A.carry[i]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const d = 5.2 * z * AL.CASTES[caste].size;
      if (A.carry[i] === K.CORPSE) { ctx.fillStyle = 'rgba(70,60,50,0.9)'; ctx.beginPath(); ctx.ellipse(x * z + ox + Math.cos(a) * d, y * z + oy + Math.sin(a) * d, 2.6 * z, 1.4 * z, a, 0, TAU); ctx.fill(); }
      else this.drawCarried(ctx, A.carry[i], x * z + ox + Math.cos(a) * d, y * z + oy + Math.sin(a) * d, z * 0.8);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
};

// a harvester major grinding a seed: the seed in its jaws gets cracked open and worn down (one seed per ~4 s), husk
// flakes and meal drop at its feet, and a little pile of 'ant bread' builds up in the store (screen coordinates)
P.drawMilling = function (ctx, i, sx, sy, a, z) {
  const A = this.world.ants, ph = ((this.frame / 60 + i * 0.37) % 4) / 4, d = 7.5 * z;
  const hx = sx + Math.cos(a) * d, hy = sy + Math.sin(a) * d, r = (1 - ph * 0.75) * 1.5 * z;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(a + Math.sin(this.frame * 0.7 + i) * 0.25);
  ctx.fillStyle = '#c99a52'; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.3, r, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(80,50,20,0.8)'; ctx.lineWidth = Math.max(0.6, 0.35 * z);
  if (ph > 0.25) { ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r * 0.4, -r * 0.3); ctx.lineTo(r, r * 0.2); ctx.stroke(); }   // the crack
  ctx.restore();
  // meal and husk at its feet
  const R = AL.rng(i * 13 + 7);
  for (let k = 0; k < 6; k++) {
    const u = R(), px = hx + (R() - 0.5) * 5 * z, py = hy + (2 + R() * 2) * z;
    ctx.fillStyle = u < 0.5 ? 'rgba(236,222,186,0.9)' : 'rgba(150,105,55,0.85)';
    ctx.fillRect(px, py, Math.max(1, 0.7 * z), Math.max(1, 0.5 * z));
  }
  if (Math.random() < 0.08 && this.lastNestView && this.particles && this.particles.length < 1500) {
    const wx = (hx - this.lastNestView.ox) / this.lastNestView.z, wy = (hy - this.lastNestView.oy) / this.lastNestView.z;
    this.particles.push({ t: 10, x: wx, y: wy, vx: (Math.random() - 0.5) * 10, vy: -4 - Math.random() * 6, life: 0.5 + Math.random() * 0.3, age: 0, e: AL.CARRY.SEED, layer: 1 });
  }
};
// soil crumbs in the nest view fall a little
const baseFx = P.spawnFx;
P.spawnFx = function (world) {
  const q = world.fxq.a;
  for (let k = 0; k < q.length; k += 4) {
    if (q[k] !== 10 || this.particles.length > 1500) continue;
    for (let j = 0; j < 3; j++) this.particles.push({ t: 10, x: q[k + 1] + (Math.random() - 0.5) * 6, y: q[k + 2] + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 10, life: 0.5 + Math.random() * 0.4, age: 0, e: K.SOIL, layer: 1 });
  }
  for (let k = q.length - 4; k >= 0; k -= 4) if (q[k] === 10) q.splice(k, 4);
  baseFx.call(this, world);
};
// an ant drops its water into the reservoir: a few droplets splash up (only seen in your own nest view)
AL.on('waterDropped', (w, d) => {
  const r = AL.Game && AL.Game.renderer; if (!r || r.world !== w || d.col !== (w.me || 0) || r.view !== 'nest' || !r.particles || r.particles.length > 1500) return;
  for (let j = 0; j < 5; j++) r.particles.push({ t: 10, x: d.x + (Math.random() - 0.5) * 4, y: d.y, vx: (Math.random() - 0.5) * 22, vy: -8 - Math.random() * 16, life: 0.45 + Math.random() * 0.3, age: 0, e: K.WATER, layer: 1 });
});
})(window);
