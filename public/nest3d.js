// Antlands 3D: the nest (underground) view in Three.js.
// The nest's painted cutaway (soil, tunnels, chambers, brood, stores, labels: render-nest.js, unchanged) is drawn
// to an offscreen canvas and draped over a 3D block of soil: the soil stands up as walls, the tunnels and chambers
// are cut down into it, and the ants walk the tunnel floors as the same 3D models as on the surface, under a camera
// tilted like the surface one. The nest lives far off to one side of the 3D scene (NX0), so the yard's models never
// show in it. Bivouacs (army ants) and Classic 2D keep the flat view.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL.R3D, KIT = R3 && R3.kit, P = AL.Renderer.prototype;
if (KIT && R3.of && AL.Nest) {
const N = AL.Nest, TILE = N.TILE, C = AL.CASTE, TAU = Math.PI * 2;
const { palOf, CARRY_COL, LOOK_OF, LIGHT_DIR, TAN, WHITE } = KIT;
const NX0 = -200000;               // where the nest sits in the 3D scene
const WALL = 9;                    // height of the soil walls between tunnels (nest units; a tile is 10)
const STEP = 2.5;                  // height-field resolution (nest units)
const TILT = 34 * Math.PI / 180;   // camera lean
const PAD_X = 120, PAD_TOP = 260, PAD_BOT = 120;
const FR = [0, 1, 0, 2];
const _v = new THREE.Vector3();

// ---- the soil block: a height field from the open tiles (cavity blobs and the tubes between them, as painted) --
class NestBlock {
  constructor() { this.ver = -1; this.at = 0; this.nest = null; this.mesh = null; this.shadow = null; this.h = null; }
  height(x, y) {   // ground height at a nest point (bilinear on the field)
    const g = this.g; if (!g) return 0;
    let fx = (x - g.x0) / STEP, fy = (y - g.y0) / STEP;
    fx = fx < 0 ? 0 : fx > g.nx - 1.001 ? g.nx - 1.001 : fx; fy = fy < 0 ? 0 : fy > g.ny - 1.001 ? g.ny - 1.001 : fy;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, H = g.h, o = j * g.nx + i;
    return (H[o] * (1 - u) + H[o + 1] * u) * (1 - v) + (H[o + g.nx] * (1 - u) + H[o + g.nx + 1] * u) * v;
  }
  build(r3, nest, mat, shMat) {
    const T = nest.tile, cols = nest.cols, rows = nest.rows, W = cols * T, Hh = rows * T;
    const x0 = -PAD_X, y0 = -PAD_TOP, nx = Math.ceil((W + PAD_X * 2) / STEP) + 1, ny = Math.ceil((Hh + PAD_TOP + PAD_BOT) / STEP) + 1;
    const open = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && nest.kind[r * cols + c] === TILE.OPEN;
    const rr = T * 0.66;
    // depth below the wall top at a point: distance into the cavity shape (0 = wall top)
    const cut = (x, y) => {
      if (y < 0) return 0;   // above ground: the yard's level
      const c = Math.floor(x / T), r = Math.floor(y / T);
      let best = 1e9;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, r2 = r + dr; if (!open(cc, r2)) continue;
        const cx = (cc + 0.5) * T, cy = (r2 + 0.5) * T;
        best = Math.min(best, Math.hypot(x - cx, y - cy) - rr);
        if (open(cc + 1, r2) && x >= cx && x <= cx + T) best = Math.min(best, Math.abs(y - cy) - rr);   // tube to the right
        if (open(cc, r2 + 1) && y >= cy && y <= cy + T) best = Math.min(best, Math.abs(x - cx) - rr);   // tube down
      }
      return best;   // < 0 inside the cavity
    };
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP, y = y0 + j * STEP;
      if (y < -4) { h[j * nx + i] = 0; continue; }   // the sky / yard behind: low
      const d = cut(x, y);
      // walls: a steep rounded lip from the floor (0) up to the wall top
      const k = AL.clamp((d + 1.5) / 4.5, 0, 1);
      h[j * nx + i] = WALL * k * k * (3 - 2 * k);
    }
    this.g = { x0, y0, nx, ny, h };
    // geometry: positions (NX0 + x, h, y), uv = nest units (the painted canvas maps them), vertex shade from the light
    const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), colr = new Float32Array(nx * ny * 3), idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    const L = LIGHT_DIR;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const o = j * nx + i, x = x0 + i * STEP, y = y0 + j * STEP;
      pos[o * 3] = NX0 + x; pos[o * 3 + 1] = h[o]; pos[o * 3 + 2] = y; uv[o * 2] = x; uv[o * 2 + 1] = y;
      const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)], hu = h[Math.max(0, j - 1) * nx + i], hd = h[Math.min(ny - 1, j + 1) * nx + i];
      const dx = (hr - hl) / (2 * STEP), dz = (hd - hu) / (2 * STEP), l = Math.sqrt(dx * dx + 1 + dz * dz);
      const nX = -dx / l, nY = 1 / l, nZ = -dz / l, lit = nX * L.x + nY * L.y + nZ * L.z;
      // flat floors and wall tops keep the painted colours; slopes facing the light a touch brighter, the rest darker
      const s = AL.clamp(0.62 + 0.38 * lit / L.y, 0.42, 1.12), lip = AL.clamp(h[o] / WALL, 0, 1);
      const sh = s * (1 - 0.18 * (1 - lip) * (1 - nY));   // (the bottom of a wall in a little shade)
      colr[o * 3] = colr[o * 3 + 1] = colr[o * 3 + 2] = sh;
    }
    let k = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    if (this.mesh) { r3.scene.remove(this.mesh, this.shadow); this.mesh.geometry.dispose(); }
    this.mesh = new THREE.Mesh(geo, mat); this.shadow = new THREE.Mesh(geo, shMat);
    this.mesh.renderOrder = -5; this.shadow.renderOrder = -4; this.shadow.receiveShadow = true;
    this.mesh.frustumCulled = this.shadow.frustumCulled = false;
    r3.scene.add(this.mesh, this.shadow);
    this.ver = nest.version; this.nest = nest; this.at = performance.now();
  }
}

const S = { block: new NestBlock(), mat: null, shMat: null, cam: null, R: null, on: false, r3: null };
function mats(r3) {
  if (S.mat) return;
  S.mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  S.shMat = new THREE.ShadowMaterial({ color: 0x120a04, opacity: 0.38, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
}
// the nest camera: as the surface's, leaning back; returns the nest rect the screen sees (at floor height)
function setCam(r3, r, cam) {
  const c3 = r3.cam, z = cam.z * r.dpr, vh = r.h / z, D = (vh / 2) / TAN, h0 = WALL * 0.5;
  c3.aspect = r.w / r.h; c3.near = Math.max(0.5, D * 0.12); c3.far = D * 7;
  c3.position.set(NX0 + cam.x, h0 + D * Math.cos(TILT), cam.y + D * Math.sin(TILT)); c3.lookAt(NX0 + cam.x, h0, cam.y);
  c3.updateProjectionMatrix(); c3.updateMatrixWorld();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = r3.rayGround(nx, ny, 0, D * 5);
    x0 = Math.min(x0, p.x - NX0); x1 = Math.max(x1, p.x - NX0); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const m = 40;
  return (S.R = { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m, D, h0 });
}
// screen pixel -> nest point (the soil block's surface)
function pick(r3, r, px, py) {
  const nx = px / r.w * 2 - 1, ny = 1 - py / r.h * 2, far = (S.R ? S.R.D : 1000) * 8;
  let h = 0, p = null;
  for (let k = 0; k < 3; k++) { p = r3.rayGround(nx, ny, h, far); h = S.block.height(p.x - NX0, p.y); }
  return { x: p.x - NX0, y: p.y };
}

// the nest's ants as 3D models (and their hats, carried loads); health bars still go on the painted sheet
function putAnts(r3, r, alpha, ox, oy, z) {
  const world = r.world, A = world.ants, n = A.high, cols = world.colonies, CS = AL.CASTES, owner = r.nestOwner();
  const ME = owner.hid != null ? owner.hid : owner.id, HOST = A.host, CAPT = C.CAPTIVE, SZ = A.size, LG = A.legs, HL = A.headless;
  const v = S.R, CP = r3.carried, HQ = R3.hatQ, HW = AL.Hats ? AL.Hats.WEAR : null;
  for (const g of r3.groups.values()) g.begin();
  CP.begin(); r3.cBegin(); HQ.length = 0;
  for (let i = 0; i < n; i++) {
    if (!A.state[i] || A.layer[i] !== AL.LAYER.NEST || A.nest[i] !== ME || A.state[i] === AL.ST.N_TRANSIT) continue;
    const x = A.px[i] + (A.x[i] - A.px[i]) * alpha, y = A.py[i] + (A.y[i] - A.py[i]) * alpha;
    if (x < v.x0 - 20 || x > v.x1 + 20 || y < v.y0 - 20 || y > v.y1 + 20) continue;
    const c = A.col[i], caste = A.caste[i], cc = cols[caste === CAPT && HOST ? HOST[i] : c] || cols[c];
    if (!cc) continue;
    const pal = palOf(r3, cc.colours || cc.sp, caste);
    const s = CS[caste].size * (cc.sp.size || 1) * (SZ ? SZ[i] : 1) * 0.8;
    const mill = A.state[i] === AL.ST.N_MILL, a = A.a[i] + (mill ? Math.sin(r.frame * 0.35 + i) * 0.12 : 0), ca = Math.cos(a), sa = Math.sin(a);
    const h = S.block.height(x, y);
    pal.group.put(NX0 + x, h, y, ca, sa, s, FR[(A.anim[i] | 0) & 3], pal, LG ? LG[i] | (HL[i] ? 0 : 64) : undefined);
    const k = A.carry[i];
    if (k) {
      const d = 5.2 * CS[caste].size * 0.8, px = x + ca * d, py = y + sa * d, cy = h + 1.5 * s, cr = CARRY_COL[k] || CARRY_COL[7];
      CP.put(NX0 + px, cy, py, a, 1.2, 1.05, 1.2, cr);
    }
    if (HW && HW[caste] && cc.hat && !(HL && HL[i])) {
      const hd = AL.Hats.head(caste, LOOK_OF(cc.colours || cc.sp), R3.LOOKS);
      HQ.push(NX0 + x + ca * hd.x * s, h + (KIT.ANT_Y + 0.25 + hd.r * 0.62) * s, y + sa * hd.x * s, a, hd.r * s * 1.4, cc.hat.id, cc.hat.v | 0);
    }
    if (A.hp[i] < A.maxhp[i]) r.barAnt(i, x * z + ox, y * z + oy, 5.2 * z * (SZ ? SZ[i] : 1) * CS[caste].size);
  }
  for (const g of r3.groups.values()) g.end(true);
  CP.end(); r3.cEnd();
  const hats = R3.extras.find(e => e.id === 'hats');
  if (hats) { try { hats.update(r3, world, v, performance.now() / 1000); } catch (e) { /* drawn next frame */ } }
}

const baseDrawNest = P.drawNest;
function drawNest3D(ctx, cam, alpha, opacity) {
  const r3 = R3.of(this), nest = this.nest;
  if (!r3 || !nest || nest.bivouac) return false;
  mats(r3); S.r3 = r3;
  if (r3.world !== this.world) r3.setWorld(this.world);
  r3.resize();
  // the soil block follows the digging (rebuilt at most every 150 ms)
  if (S.block.nest !== nest || (nest.version !== S.block.ver && performance.now() - S.block.at > 150)) S.block.build(r3, nest, S.mat, S.shMat);
  const R = setCam(r3, this, cam), B = r3.tiltBufs();
  const k = Math.min(B.cw / (R.x1 - R.x0), B.ch / (R.y1 - R.y0), cam.z * this.dpr * 1.6);
  const c2 = { x: R.x0 + B.cw / (2 * k), y: R.y0 + B.ch / (2 * k), z: k };
  const W0 = this.w, H0 = this.h, D0 = this.dpr, ants = this.drawNestAnts, layer = this.layer, labels = this.drawChamberLabels;
  const me = this;
  // 1. the painted nest, as before, on the sheet (ants: only their health bars; the screen layer waits)
  this.w = B.cw; this.h = B.ch; this.dpr = 1;
  let lv = null;
  try {
    this.drawNestAnts = function (c, al, v, z, ox, oy) { me.barBegin(false); S.ants = { al, z, ox, oy }; };
    this.drawChamberLabels = function () {};   // (drawn upright on the screen afterwards: walls would cut them)
    this.layer = function (name, c, view) { if (name === 'nestScreen') { lv = view; return; } return layer.call(this, name, c, view); };
    B.uc.globalAlpha = 1;
    baseDrawNest.call(this, B.uc, c2, alpha, 1);
  } finally { this.w = W0; this.h = H0; this.dpr = D0; this.drawNestAnts = ants; this.layer = layer; this.drawChamberLabels = labels; }
  // 2. the 3D: hide the yard's sheets, light the nest, put the ants, render
  if (r3.ground3d) r3.ground3d.visible = r3.over3d.visible = false;
  r3.depth.visible = false; r3.shadowPlane.visible = false;
  S.block.mesh.visible = S.block.shadow.visible = true;
  S.mat.map = B.ut; S.mat.needsUpdate = S.mat.map !== S._map; S._map = B.ut;
  r3.tiltUpload(R, k, true);
  const sun = r3.sun, sc = sun.shadow.camera, cx = NX0 + (R.x0 + R.x1) / 2, cz = (R.y0 + R.y1) / 2, half = Math.max(R.x1 - R.x0, R.y1 - R.y0) * 0.62 + 60;
  sun.target.position.set(cx, 0, cz); sun.position.set(cx + LIGHT_DIR.x * half * 2, LIGHT_DIR.y * half * 2, cz + LIGHT_DIR.z * half * 2);
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = half * 4 + 200; sc.updateProjectionMatrix();
  const A0 = S.ants || { z: k, ox: -c2.x * k + B.cw / 2, oy: -c2.y * k + B.ch / 2 };
  putAnts(r3, this, alpha, A0.ox, A0.oy, A0.z);
  // (the bars were collected after the sheet was painted: draw them on it now)
  if (this.drawBars) { B.uc.setTransform(1, 0, 0, 1, 0, 0); this.drawBars(B.uc, null); }
  B.ut.needsUpdate = true;
  r3.tilt = null;   // (the surface's raycast belongs to the surface)
  r3.glRender();
  S.block.mesh.visible = S.block.shadow.visible = false;
  r3.depth.visible = true;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const ga = ctx.globalAlpha;
  if (opacity >= 1) { ctx.fillStyle = '#120b06'; ctx.fillRect(0, 0, this.w, this.h); }
  ctx.drawImage(r3.cv, 0, 0);
  ctx.globalAlpha = ga;
  S.on = true; S.cam = cam;
  // the screen-space bits on top
  const pc = r3.project(NX0 + cam.x, cam.y, R.h0), pr = r3.project(NX0 + cam.x + 10, cam.y, R.h0), zc = Math.max(0.01, (pr.x - pc.x) / 10);
  this.lastNestView = { x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, z: zc, ox: pc.x - cam.x * zc, oy: pc.y - cam.y * zc, w: this.w, h: this.h, dpr: this.dpr, cam, alpha, scene: 'nest', frame: this.frame, tilted: true };
  // chamber names: the same labels, placed where their chamber tops are on the screen, at a steady size
  if (cam.z * D0 >= 0.9 * D0) {
    const proj = (x, y) => r3.project(NX0 + x, y, WALL), D = D0;
    const lab = {
      set font(v) { ctx.font = v.replace(/([\d.]+)px/, (m, n) => (n * D) + 'px'); }, set fillStyle(v) { ctx.fillStyle = v; },
      set textAlign(v) { ctx.textAlign = v; }, set textBaseline(v) { ctx.textBaseline = v; },
      measureText(t) { return { width: ctx.measureText(t).width / D }; },
      fillRect(x, y, w, h) { const p = proj(x + w / 2, y + h / 2); ctx.fillRect(p.x - w * D / 2, p.y - h * D / 2, w * D, h * D); },
      fillText(t, x, y) { const p = proj(x, y); ctx.fillText(t, p.x, p.y); },
    };
    try { labels.call(this, lab, nest, D0); } catch (e) { /* labels are a nicety */ }
  }
  if (lv) this.layer('nestScreen', ctx, Object.assign({}, this.lastNestView, { z: 1, ox: 0, oy: 0 }));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return true;
}
P.drawNest = function (ctx, cam, alpha, opacity) {
  S.on = false;
  if (AL.R3D.enabled && AL.R3D.tilt && !S.broken) {
    try { if (drawNest3D.call(this, ctx, cam, alpha, opacity)) return; }
    catch (e) { console.error('[Antlands 3D] nest', e); S.broken = true; }
  }
  return baseDrawNest.call(this, ctx, cam, alpha, opacity);
};
// clicks in the 3D nest land where the pointer meets the soil block
const baseS2W = P.screenToWorld;
P.screenToWorld = function (sx, sy, cam) {
  if (S.on && S.r3 && cam && cam === this.ncam && this.view === 'nest') return pick(S.r3, this, sx * this.dpr, sy * this.dpr);
  return baseS2W.call(this, sx, sy, cam);
};
// (the nest's 3D block is hidden whenever the surface draws)
const baseDrawSurface = P.drawSurface;
P.drawSurface = function () { if (S.block.mesh) S.block.mesh.visible = S.block.shadow.visible = false; return baseDrawSurface.apply(this, arguments); };
AL.R3D.nest3d = true;
}
