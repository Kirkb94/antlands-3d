// Antlands 3D: a Three.js renderer for the surface (the backyard). The simulation, UI, tools, nest view and scenes
// are the original Antlands code; this module replaces how the surface's solid things are drawn.
//
// Frame, surface view (P.drawSurface below):
//   1. 2D canvas: painted ground, 'ground' layer, tree shade, pheromone trails, flat foods (puddles, seeds, clover,
//      corpses, aphid plants), army-ant bivouacs, 'underAnts' layer            (unchanged Antlands drawing)
//   2. Three.js, offscreen WebGL canvas with a transparent background: ants (walk-cycle legs, caste shapes from
//      art.js), mounds, rocks, logs, flowers, 3D food, carried crumbs, and their shadows on the ground
//   3. that canvas is composited onto the 2D frame
//   4. 2D on top: particles, creatures ('overAnts'), siege bars, canopy shade, weather, day/night grade, trail glow,
//      orders, fog of war, health bars, screen effects                       (unchanged Antlands drawing)
// The camera looks straight down with a perspective lens fitted so the ground plane lines up pixel for pixel with
// the 2D layers, so clicks, tools and overlays work exactly as before; tall things get real parallax and shading.
// F7 switches between 3D and the original 2D sprites.
import * as THREE from './vendor/three.module.js';

const AL = window.AL;
const Art = AL.Art, TAU = Math.PI * 2, K = AL.CARRY, C = AL.CASTE, P = AL.Renderer.prototype;
const FOV = 32, TAN = Math.tan(FOV * Math.PI / 360);
// tilted camera (Settings > Camera): the view leans back this far from straight down, a little more zoomed in
const TILT_FAR = 32 * Math.PI / 180, TILT_NEAR = 46 * Math.PI / 180;
const TILT_PX = 2.6e6, TILT_OVER = 0.5;   // pixel budget of each offscreen 2D layer canvas (ground under, overlays over)
const LIGHT_DIR = new THREE.Vector3(-0.5, 1, -0.62).normalize();   // sun from the upper left, as in the 2D art
const ANT_Y = 1.5;                                                  // body height above the ground (world units)

// caste shapes and species looks: the same numbers art.js draws the 2D sprites with
const SHAPES = [
  { head: 1.0,  mand: 1.0, gaster: 1.0, thorax: 1.0, leg: 1.0,  ant: 1.0 },
  { head: 0.95, mand: 0.9, gaster: 0.92, thorax: 0.95, leg: 1.25, ant: 1.15 },
  { head: 0.9,  mand: 0.8, gaster: 0.85, thorax: 0.9, leg: 1.2,  ant: 1.4 },
  { head: 1.55, mand: 1.8, gaster: 1.0, thorax: 1.05, leg: 1.0,  ant: 0.95 },
  { head: 1.9,  mand: 2.2, gaster: 1.05, thorax: 1.15, leg: 0.95, ant: 0.9 },
  { head: 0.95, mand: 0.8, gaster: 1.0, thorax: 0.9, leg: 0.9,  ant: 1.0, pale: 0.18 },
  { head: 0.9,  mand: 0.8, gaster: 2.6, thorax: 0.9, leg: 0.85, ant: 0.9, honey: true },
  { head: 1.15, mand: 1.0, gaster: 1.9, thorax: 1.5, leg: 0.95, ant: 1.0, queen: true },
  { head: 1.0,  mand: 0.9, gaster: 1.2, thorax: 1.3, leg: 0.95, ant: 1.1, wings: true },
  { head: 1.0,  mand: 1.0, gaster: 1.0, thorax: 1.0, leg: 1.0,  ant: 1.0, mark: true },
];
// 3D species builds: art.js's looks plus the 4 starting species, and extra parts (waist nodes, spines, hairs...)
const LOOKS = {
  fire:       { head: 0.92, gaster: 0.95, twoNode: true, sting: true },                                  // small heads, two-node waist, stinger
  carpenter:  { head: 1.16, thorax: 1.12, gaster: 1.06, leg: 1.1, arched: true, gloss: true },          // big heads, arched back, shiny
  leafcutter: { head: 1.12, leg: 1.22, twoNode: true, spines: true, matte: true },                       // spiny back and head, long legs
  army:       { head: 1.05, mand: 1.3, gaster: 0.86, leg: 1.32, twoNode: true, sickle: true, eye: 0.4 }, // long legs, sickle jaws, near blind
  honeypot:   { gaster: 1.12, leg: 1.12, amber: true },
  harvester:  { head: 1.18, mand: 1.1, beard: true, square: true, twoNode: true },
  slavemaker: { head: 0.95, mand: 1.15, sickle: true, gloss: true },
  bullet:     { head: 1.1, mand: 1.25, gaster: 1.1, thorax: 1.12, leg: 1.05, sting: true, hairy: true },
};

// ---- small geometry kit: parts merged into one non-indexed geometry with vertex colours --------------------------
const SPH = new THREE.SphereGeometry(1, 14, 10), SPH_LO = new THREE.SphereGeometry(1, 7, 5);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0);
function M(x, y, z, sx, sy, sz, rx, ry, rz) {
  _e.set(rx || 0, ry || 0, rz || 0);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(sx, sy, sz));
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const WHITE = new THREE.Color(1, 1, 1);
class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.info = []; this.tag = null; }
  add(geo, m, color, fn) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const p = g.attributes.position.array, n = g.attributes.normal.array, T = this.tag;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]); this.nor.push(n[i], n[i + 1], n[i + 2]);
      const c = fn ? fn(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2]) : color;
      this.col.push(c.r, c.g, c.b);
      if (T) this.info.push(T[0], T[1], T[2], T[3]);
    }
    g.dispose();
    return this;
  }
  // a round limb segment from a to b (with a small ball at the joint)
  seg(a, b, r, color) {
    const d = new THREE.Vector3().subVectors(b, a), L = d.length();
    if (L < 1e-4) return this;
    _q.setFromUnitVectors(_up, d.multiplyScalar(1 / L));
    this.add(CYL, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), _q, V(r, L, r)), color);
    return this.add(SPH_LO, M(b.x, b.y, b.z, r, r, r), color);
  }
  get empty() { return !this.pos.length; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    // legInfo (legs geometry only): xyz = the part's root, w = which part (0-5 legs, 6 head parts) for injuries
    if (this.info.length === this.pos.length / 3 * 4) g.setAttribute('legInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.computeBoundingSphere();
    return g;
  }
}
const hx3 = (x, y, z, seed) => AL.hash2(Math.round(x * 6) * 7 + Math.round(z * 6) * 131, Math.round(y * 6) * 17 + 3, seed | 0);

// ---- the ant model, per caste (and species look). Faces +x; world y (screen down) is +z here ---------------------
function antGeos(caste, look) {
  const lk = LOOKS[look], base = SHAPES[caste] || SHAPES[0];
  const sh = lk && caste !== C.QUEEN ? Object.assign({}, base, { head: base.head * (lk.head || 1), mand: base.mand * (lk.mand || 1), gaster: base.gaster * (base.honey ? 1 : (lk.gaster || 1)), thorax: base.thorax * (lk.thorax || 1), leg: base.leg * (lk.leg || 1) }) : base;
  const H = ANT_Y, DK = new THREE.Color(0.03, 0.025, 0.02), MID = new THREE.Color(0.62, 0.62, 0.62);
  const thx = 0.6, thR = 1.35 * sh.thorax, thL = 2.3 * sh.thorax;
  const hx = thx + thL * 0.5 + 1.25 * sh.head, hR = 1.35 * sh.head;
  const L2 = lk || {}, two = !!L2.twoNode;
  const gx = -1.2 - (two ? 0.5 : 0) - 2.3 * sh.gaster, gR = 2.0 * sh.gaster, gL = 2.6 * sh.gaster;
  // thorax + petiole (body colour)
  const body = new Builder()
    .add(SPH, M(thx, H + 0.15 + (L2.arched ? 0.3 : 0), 0, thL * 0.5 + 0.2, thR * (L2.arched ? 0.82 : 0.6), thR * 0.7), WHITE)
    .add(SPH, M(-0.75, H + 0.05, 0, 0.6, 0.58, 0.5), MID);
  if (two) body.add(SPH, M(-1.35, H + 0.1, 0, 0.55, 0.6, 0.52), MID);
  if (L2.spines) for (const s of [-1, 1]) {   // leafcutter: spines on the back
    body.seg(V(thx + 0.7, H + thR * 0.5, s * 0.35), V(thx + 1.1, H + thR * 0.5 + 1.1, s * 0.95), 0.12, WHITE);
    body.seg(V(thx - 0.3, H + thR * 0.45, s * 0.3), V(thx - 0.2, H + thR * 0.45 + 0.8, s * 0.7), 0.1, WHITE);
    body.seg(V(thx - 1, H + thR * 0.3, s * 0.3), V(thx - 1.5, H + thR * 0.3 + 1, s * 0.6), 0.11, WHITE);
  }
  if (sh.mark) body.add(SPH_LO, M(thx, H + 0.15 + thR * 0.55, 0, 0.75, 0.2, 0.6), new THREE.Color(3, 2.6, 1.9));
  if (sh.queen) for (const s of [-1, 1]) body.add(SPH_LO, M(thx - 0.6, H + 0.2 + thR * 0.4, s * thR * 0.6, 0.5, 0.2, 0.3), MID);
  // head (head colour) with black eyes
  const head = new Builder().add(SPH, M(hx, H + 0.25, 0, hR * (L2.square ? 0.98 : 1.05), hR * 0.78, hR * (L2.square ? 1.1 : 0.95)), WHITE);
  const ey = L2.eye || 1;
  for (const s of [-1, 1]) head.add(SPH_LO, M(hx + hR * 0.2, H + 0.25 + hR * 0.25, s * hR * 0.74, 0.38 * ey, 0.3 * ey, 0.28 * ey), DK);
  if (L2.spines) for (const s of [-1, 1]) head.seg(V(hx - hR * 0.5, H + 0.25 + hR * 0.5, s * hR * 0.55), V(hx - hR * 1.05, H + 0.25 + hR * 0.95, s * hR * 0.9), 0.12, WHITE);
  if (L2.beard) { const pale = new THREE.Color(2.4, 2.2, 1.7); for (let k = -2; k <= 2; k++) head.seg(V(hx + hR * 0.25, H - hR * 0.35, k * hR * 0.18), V(hx + hR * 0.1, H - hR * 0.35 - 0.9, k * hR * 0.22), 0.07, pale); }
  // gaster (gaster colour), its tip lifted a little; honeypots' swollen crop
  const gas = new Builder().add(SPH, M(gx, H + 0.45, 0, gL, gR * (sh.honey ? 0.9 : 0.78), gR, 0, 0, -0.1), WHITE);
  if (lk && lk.sting) gas.seg(V(gx - gL * 0.92, H + 0.25, 0), V(gx - gL - (caste === C.SOLDIER || caste === C.MAJOR || L2.hairy ? 1.1 : 0.6), H + 0.05, 0), 0.14, DK);
  if (L2.hairy) { const gold = new THREE.Color(2.2, 1.7, 1); for (let k = 0; k < 10; k++) { const ax = gx + gL * (0.7 - k * 0.15), sd = k & 1 ? 1 : -1; gas.seg(V(ax, H + 0.45 + gR * 0.6, sd * gR * 0.45), V(ax - 0.3, H + 0.45 + gR * 0.95, sd * gR * 0.7), 0.06, gold); } }
  // legs, antennae and mandibles (leg colour): one geometry per walk frame (swing 0, +1, -1)
  const legs = [0, 1, -1, 'dead'].map(swing => {
    const dead = swing === 'dead', sv = dead ? 0 : swing;   // (the 4th frame: a dead ant's legs curled up)
    const b = new Builder(), legBase = [0.95, 1.65, 2.35], legX = [thx + 0.8, thx, thx - 0.8];
    for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
      const tri = (k === 1) === (side === 1) ? 1 : -1;
      const ang = (legBase[k] + (dead ? 0.9 : sv * 0.3 * tri)) * side, len = (k === 2 ? 4.2 : 3.6) * sh.leg * (dead ? 0.55 : 1);
      const bx = legX[k], by = side * thR * 0.55;
      const kx = bx + Math.cos(ang - side * 0.35) * len * 0.45, ky = by + Math.sin(ang - side * 0.35) * len * 0.45;
      const fx = kx + Math.cos(ang + side * 0.25) * len * 0.62, fy = ky + Math.sin(ang + side * 0.25) * len * 0.62;
      const lift = !dead && sv * tri > 0 ? 0.35 : 0;   // the swinging tripod lifts its feet
      const hip = V(bx, H, by), knee = V(kx, H + 1.05 * sh.leg, ky), foot = V(fx, dead ? H + 0.6 : 0.08 + lift, fy);
      b.tag = [bx, H, by, (side < 0 ? 0 : 3) + k];   // injury.js bits: 0-2 left front/mid/hind, 3-5 right
      b.seg(hip, knee, 0.24, WHITE).seg(knee, foot, 0.18, WHITE);
    }
    b.tag = [hx, H + 0.25, 0, 6];   // antennae and jaws go with the head
    const aL = 2.4 * sh.ant;
    for (const s of [-1, 1]) {
      const sw = dead ? 0.6 * s : sv * 0.08 * s, bx = hx + hR * 0.7, by = s * hR * 0.45;
      const ex = bx + Math.cos(s * 0.55 + sw) * aL * 0.55, ey = by + Math.sin(s * 0.55 + sw) * aL * 0.55;
      const tx = ex + Math.cos(s * -0.25 + sw) * aL * 0.7, ty = ey + Math.sin(s * -0.25 + sw) * aL * 0.7;
      b.seg(V(bx, H + 0.55, by), V(ex, H + 1.45, ey), 0.13, WHITE).seg(V(ex, H + 1.45, ey), V(tx, H + 1.05, ty), 0.11, WHITE);
      const mL = 1.1 * sh.mand, mr = 0.2 * Math.max(1, sh.mand * 0.7);
      const m0 = V(hx + hR * 0.85, H + 0.1, s * hR * 0.35), m1 = V(hx + hR + mL * (lk && lk.sickle ? 1.1 : 0.85), H + 0.05, s * hR * (lk && lk.sickle ? 0.7 : 0.42)), m2 = V(hx + hR + mL * 0.8, H, -s * 0.05);
      b.seg(m0, m1, mr, MID).seg(m1, m2, mr * 0.8, MID);
    }
    return b.build();
  });
  let wings = null;
  if (sh.wings) {
    const w = new Builder();
    for (const s of [-1, 1]) w.add(SPH, M(thx - 3.6, H + 1.1, s * 1.9, 4.4, 0.05, 1.5, 0, -s * 0.22, 0), WHITE);
    wings = w.build();
  }
  return { body: body.build(), head: head.build(), gaster: gas.build(), legs, wings };
}

// ---- instanced meshes that grow as needed ---------------------------------------------------------------------
function mkInst(geo, mat, cap, scene, shadow) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false; m.castShadow = shadow !== false; m.receiveShadow = false; m.count = 0;
  scene.add(m);
  return m;
}
function growInst(old, cap, scene) {
  const m = mkInst(old.geometry, old.material, cap, scene, old.castShadow);
  m.instanceMatrix.array.set(old.instanceMatrix.array); m.instanceColor.array.set(old.instanceColor.array);
  scene.remove(old); old.dispose();
  return m;
}
// matrix: rotate about the vertical by world angle a (2D heading), scale (sx, sy, sz), translate (x, y, z)
function putM(mesh, i, x, y, z, ca, sa, sx, sy, sz) {
  const e = mesh.instanceMatrix.array, o = i * 16;
  e[o] = ca * sx; e[o + 1] = 0; e[o + 2] = sa * sx; e[o + 3] = 0;
  e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
  e[o + 8] = -sa * sz; e[o + 9] = 0; e[o + 10] = ca * sz; e[o + 11] = 0;
  e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
}
function putC(mesh, i, c) { const a = mesh.instanceColor.array, o = i * 3; a[o] = c.r; a[o + 1] = c.g; a[o + 2] = c.b; }
// upload only the instances in use (the buffers grow in doubling steps, so most of each is idle); hide empty meshes
// so the renderer skips them outright (no program / uniform setup, in the colour or the shadow pass)
function flush(mesh, n) {
  mesh.count = n; mesh.visible = n > 0;
  if (!n) return;
  const im = mesh.instanceMatrix, ic = mesh.instanceColor;
  im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
  ic.clearUpdateRanges(); ic.addUpdateRange(0, n * 3); ic.needsUpdate = true;
}

// one ant shape: 6 meshes (body, head, gaster, 3 leg frames) + wings
class AntGroup {
  constructor(r3, geos) {
    this.r3 = r3; this.cap = 64; this.n = 0; this.nl = [0, 0, 0, 0];
    const S = r3.scene, mat = geos.mat || r3.antMat, lm = r3.legMatOf(mat);
    this.body = mkInst(geos.body, mat, this.cap, S); this.head = mkInst(geos.head, mat, this.cap, S); this.gaster = mkInst(geos.gaster, mat, this.cap, S);
    this.legs = geos.legs.map(g => { const m = mkInst(g, lm.mat, this.cap, S); m.customDepthMaterial = lm.depth; return m; });
    this.wings = geos.wings ? mkInst(geos.wings, r3.wingMat, this.cap, S, false) : null;
    this.masks = this.legs.map(m => this.maskAttr(m, null));
  }
  // per-instance injury mask on the legs (bits 0-5 legs, 6 head; set = still there): the leg shader stumps the rest
  maskAttr(m, old) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    a.setUsage(THREE.DynamicDrawUsage); if (old) a.array.set(old.array.subarray(0, Math.min(old.array.length, this.cap)));
    m.geometry.setAttribute('legMask', a);
    return a;
  }
  grow() {
    const S = this.r3.scene, cap = this.cap * 2;
    this.body = growInst(this.body, cap, S); this.head = growInst(this.head, cap, S); this.gaster = growInst(this.gaster, cap, S);
    this.legs = this.legs.map(m => { const d = m.customDepthMaterial, g = growInst(m, cap, S); g.customDepthMaterial = d; return g; });
    if (this.wings) this.wings = growInst(this.wings, cap, S);
    this.cap = cap;
    this.masks = this.legs.map((m, k) => this.maskAttr(m, this.masks[k]));
  }
  begin() { this.n = 0; this.nl[0] = this.nl[1] = this.nl[2] = this.nl[3] = 0; }
  // inj: injury mask (injury.js legs bits | 64 if it still has its head); undefined = whole ant
  put(x, y, z, ca, sa, s, fr, pal, inj) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++, li = this.nl[fr]++, mk = inj === undefined ? 127 : inj, hs = mk & 64 ? s : 0;
    putM(this.body, i, x, y, z, ca, sa, s, s, s); putC(this.body, i, pal.body);
    putM(this.head, i, x, y, z, ca, sa, hs, hs, hs); putC(this.head, i, pal.head);
    putM(this.gaster, i, x, y, z, ca, sa, s, s, s); putC(this.gaster, i, pal.gaster);
    putM(this.legs[fr], li, x, y, z, ca, sa, s, s, s); putC(this.legs[fr], li, pal.leg); this.masks[fr].array[li] = mk;
    if (this.wings) { putM(this.wings, i, x, y, z, ca, sa, s, s, s); putC(this.wings, i, WHITE); }
  }
  end(shadow) {
    flush(this.body, this.n); flush(this.head, this.n); flush(this.gaster, this.n);
    for (let k = 0; k < 4; k++) {
      flush(this.legs[k], this.nl[k]);
      if (this.nl[k]) { const a = this.masks[k]; a.clearUpdateRanges(); a.addUpdateRange(0, this.nl[k]); a.needsUpdate = true; }
    }
    if (this.wings) flush(this.wings, this.n);
    this.body.castShadow = this.head.castShadow = this.gaster.castShadow = shadow;
    for (const m of this.legs) m.castShadow = shadow;
  }
}
// a pool of one primitive (food bits, carried crumbs)
class Pool {
  constructor(r3, geo, mat, shadow) { this.r3 = r3; this.cap = 128; this.n = 0; this.yOff = 0; this.mesh = mkInst(geo, mat, this.cap, r3.scene, shadow); }
  begin() { this.n = 0; }
  put(x, y, z, a, sx, sy, sz, c) {
    if (this.n >= this.cap) { this.cap *= 2; this.mesh = growInst(this.mesh, this.cap, this.r3.scene); }
    const i = this.n++; putM(this.mesh, i, x, y + this.yOff, z, Math.cos(a), Math.sin(a), sx, sy, sz); putC(this.mesh, i, c);
  }
  // any orientation (quaternion q): wings that flap, tilted parts
  putQ(x, y, z, q, sx, sy, sz, c) {
    if (this.n >= this.cap) { this.cap *= 2; this.mesh = growInst(this.mesh, this.cap, this.r3.scene); }
    _sm.compose(_smid.set(x, y + this.yOff, z), q, _ss.set(sx, sy, sz));
    const i = this.n++; _sm.toArray(this.mesh.instanceMatrix.array, i * 16); putC(this.mesh, i, c);
  }
  // a limb: a round segment from a to b (world space)
  seg(a, b, r, c) {
    _sd.subVectors(b, a); const L = _sd.length();
    if (L < 1e-4) return;
    _sq.setFromUnitVectors(_up, _sd.multiplyScalar(1 / L));
    _sm.compose(_smid.addVectors(a, b).multiplyScalar(0.5), _sq, _ss.set(r, L, r));
    if (this.n >= this.cap) { this.cap *= 2; this.mesh = growInst(this.mesh, this.cap, this.r3.scene); }
    const i = this.n++; _sm.toArray(this.mesh.instanceMatrix.array, i * 16); putC(this.mesh, i, c);
  }
  end() { flush(this.mesh, this.n); }
}
const _sd = new THREE.Vector3(), _sq = new THREE.Quaternion(), _sm = new THREE.Matrix4(), _smid = new THREE.Vector3(), _ss = new THREE.Vector3();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3();

// ---- colours ----------------------------------------------------------------------------------------------------
const col = hex => new THREE.Color(hex);
const PALE = col('#ffebc8');
const LOOK_OF = colours => (colours && colours.look) || '';
const palCache = new WeakMap();
function palOf(r3, colours, caste) {
  let arr = palCache.get(colours);
  if (!arr) { arr = []; palCache.set(colours, arr); }
  let p = arr[caste];
  if (p) return p;
  const look = LOOK_OF(colours), lk = LOOKS[look];
  const bodyH = colours.body || '#5a2a14', headH = colours.head || bodyH, gasH = colours.gaster || bodyH;
  const gaster = caste === C.HONEYPOT ? '#e9a93a' : lk && lk.amber ? Art.mix(gasH, '#e0a040', 0.35) : gasH;
  p = { body: col(bodyH), head: col(headH), gaster: col(gaster), leg: col(Art.shade(bodyH, -0.35)) };
  if (SHAPES[caste] && SHAPES[caste].pale) for (const k of ['body', 'head', 'gaster', 'leg']) p[k].lerp(PALE, SHAPES[caste].pale);
  p.group = r3.group(caste, look);
  arr[caste] = p;
  return p;
}
const CARRY_COL = [null, col('#f6e7b4'), col('#d0674a'), col('#8fd0f0'), col('#a07a42'), col('#6fbf4a'), col('#7a5534'), col('#888888'), col('#f3ead2'), col('#c8e68a')];
const FC = {
  stem: col('#4a3018'), leaf: col('#5a9a3a'), ham: col('#e38a8a'), grub: col('#efe2c2'), grubHead: col('#8a5a2a'),
  beetle: col('#2a3a40'), beetleHead: col('#1d2226'), bug: col('#6a5a3a'), choc: col('#4a2a14'),
  stem2: col('#4a7a2e'), leaf2: col('#3f7a2c'), aphid: col('#c8e68a'), honey: col('#ffd25a'), seed: col('#8a6a3a'), fluff: col('#f6f2e6'),
  clover: col('#5c9b3c'), clover2: col('#6eae4a'), grub2: col('#eadcbc'),
  cookie: [col('#d8a868'), col('#c99456'), col('#e2b97c')], sugar: [col('#f4ead2'), col('#e9d8a6')], meat: [col('#c86a4a'), col('#a8543a')],
};
const _c = new THREE.Color(), _c2 = new THREE.Color();
const F3D = new Set(['fruit', 'cookie', 'ham', 'grubs', 'beetle', 'bug']);
const Y3D = new Set(['honeydew', 'seeds', 'leaves', 'larvae', 'nectar']);   // were flat 2D, now modelled
const F2D = new Set(['water', 'seeds', 'leaves', 'honeydew', 'larvae', 'nectar']);
// carcasses drawn as 3D models even though the 2D art registered food drawers for them
const CARC = new Set(['corpse', 'spider', 'caterpillar', 'ladybug', 'centipede', 'antlion', 'assassin', 'mantis', 'moth', 'cocoon']);
const is3DFood = f => CARC.has(f.visual) || Y3D.has(f.visual) || (!Art.foodDrawers[f.visual] && (F3D.has(f.visual) || !F2D.has(f.visual)));
const angOf = f => f.heading != null ? f.heading + Math.PI : (f.a || 0);
// dead ants: the colony's colours, dulled
function deadPal(p) {
  if (p.dead) return p.dead;
  const g = col('#5a5048'), d = { group: p.group };
  for (const k of ['body', 'head', 'gaster', 'leg']) d[k] = p[k].clone().lerp(g, 0.35).multiplyScalar(0.7);
  return (p.dead = d);
}
// creature colours (the 2D art's)
const CC = {
  spider: col('#7a5a3a'), spiderCeph: col('#5a3e26'), spiderDark: col('#3a2616'), spiderLeg: col('#3a2a1c'), spiderStripe: col('#c8a878'),
  deadBody: col('#6a6058'), deadDark: col('#3a3632'), deadLeg: col('#5a5048'), eye: col('#0c0806'),
  beetleShell: col('#2e4448'), beetlePro: col('#1c2226'), beetleHead: col('#161a1c'), beetleLeg: col('#141210'),
  lbRed: col('#e0321e'), lbDead: col('#a8402e'), beetleDead: col('#26343a'), lbBlack: col('#140c0a'), lbWhite: col('#f2ece0'),
  catA: col('#6aae3c'), catB: col('#7cc04a'), catHead: col('#5a4220'), catDeadA: col('#8a9a6a'), catDeadB: col('#7a8a5c'), catDotY: col('#f2d24a'), catDotD: col('#2a3a1a'), catEye: col('#faf0dc'),
  cenBody: col('#a2522a'), cenDark: col('#4a2210'), cenLeg: col('#c98a4a'), cenDeadBody: col('#6e5a48'), cenDeadDark: col('#3c3028'), cenDeadLeg: col('#6a5a4a'),
  asBody: col('#5a3a26'), asRim: col('#d4502a'), asDark: col('#24160c'), asDeadBody: col('#6a5a4c'), asDeadRim: col('#8a6a52'), asDeadDark: col('#3a3028'),
  maBody: col('#7ab648'), maDark: col('#3e6a22'), maLight: col('#9ccc6a'), maEye: col('#d8e8a0'), maDeadBody: col('#7a8462'), maDeadDark: col('#4a5038'),
  alBody: col('#8a6a44'), alDark: col('#3e2c18'), alDeadBody: col('#7a6a58'), alDeadDark: col('#463c32'),
  egg: col('#efe8d6'), larva: col('#3c3c44'), larvaHead: col('#2a2a2e'), larvaSpot: col('#e8892e'),
  mothWing: col('#9a8262'), mothSpot: col('#4a3420'), mothBody: col('#5a4630'), cocoon: col('#d8c8a4'), cocoonTorn: col('#3c2814'),
};
const SP_LEGS = [0.55, 1.2, 1.95, 2.6];
const LB_SPOTS = [[-1, -2.6, 1.3], [-1, 2.6, 1.3], [-4, -1.6, 1.1], [-4, 1.6, 1.1], [1.6, -1.7, 0.9], [1.6, 1.7, 0.9], [-5.6, 0, 0.8]];
const SPEC_COLS = {};   // gallery: each species' colours + look
const SKIP_OVER = new Set(['world-fx', 'eco-hunters-art']);   // their 'overAnts' 2D creatures are drawn in 3D here

// mound profile: a low dome with a shallow crater at the entrance (also lifts ants walking over it)
function moundY(d, R) {
  const t = d / (R * 1.05);
  if (t >= 1) return 0;
  let h = R * 0.22 * Math.pow(1 - t * t, 1.6);
  const er = Math.min(10, 5 + R * 0.06) * 1.7;
  if (d < er) { const u = d / er, k = u * u * (3 - 2 * u); h = 0.3 + (h - 0.3) * k; }
  return h;
}

// ---- terrain relief: gentle hills and dips under the painted yard -----------------------------------------------
// A smooth height map (seeded per match): broad hills, smaller swells, fine bumps, banks around puddles. It is drawn
// as light and shade over the painted ground (slopes facing the sun brighter, the far sides and hollows darker) and
// catches the shadows; everything standing on the yard follows its height. Visual only: the sim stays flat.
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = AL.hash2(xi, yi, seed), b = AL.hash2(xi + 1, yi, seed), c = AL.hash2(xi, yi + 1, seed), d = AL.hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
class Terrain {
  constructor(S, seed) {
    const cell = this.cell = Math.max(8, Math.ceil(Math.max(S.W, S.H) / 700));
    const gw = this.gw = Math.ceil(S.W / cell) + 1, gh = this.gh = Math.ceil(S.H / cell) + 1, h = this.h = new Float32Array(gw * gh);
    const wet = S.foods.filter(f => f.visual === 'water').map(f => ({ x: f.poi ? f.poi.x : f.x, y: f.poi ? f.poi.y : f.y, r: ((f.poi && f.poi.r) || f.r || 20) * 1.7 }));
    let mn = 1e9;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const x = i * cell, y = j * cell;
      let v = 18 * vnoise(x / 560, y / 560, seed) + 7 * vnoise(x / 190, y / 190, seed + 7) + 3.2 * vnoise(x / 95, y / 95, seed + 29) + 1.6 * vnoise(x / 40, y / 40, seed + 13);
      for (const w of wet) { const d = Math.hypot(x - w.x, y - w.y); if (d < w.r) { const u = 1 - d / w.r; v -= 7 * u * u * (3 - 2 * u); } }
      h[j * gw + i] = v; if (v < mn) mn = v;
    }
    for (let k = 0; k < h.length; k++) h[k] -= mn;
  }
  at(x, y) {
    const c = this.cell, gw = this.gw, gh = this.gh, H = this.h;
    let fx = x / c, fy = y / c;
    fx = fx < 0 ? 0 : fx > gw - 1.001 ? gw - 1.001 : fx; fy = fy < 0 ? 0 : fy > gh - 1.001 ? gh - 1.001 : fy;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, o = j * gw + i;
    return (H[o] * (1 - u) + H[o + 1] * u) * (1 - v) + (H[o + gw] * (1 - u) + H[o + gw + 1] * u) * v;
  }
  geometry() {
    const H = this.h, gw = this.gw, gh = this.gh, c = this.cell, step = Math.max(1, Math.ceil(Math.max(gw, gh) / 380)), EX = 9;   // EX: normals exaggerated so the relief reads from above
    const nx = Math.floor((gw - 1) / step) + 1, ny = Math.floor((gh - 1) / step) + 1;
    const pos = new Float32Array(nx * ny * 3), nor = new Float32Array(nx * ny * 3), idx = new Uint32Array((nx - 1) * (ny - 1) * 6), uv = new Float32Array(nx * ny * 2);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const gi = i * step, gj = j * step, o = (j * nx + i) * 3;
      const hl = H[gj * gw + Math.max(0, gi - 1)], hr = H[gj * gw + Math.min(gw - 1, gi + 1)], hu = H[Math.max(0, gj - 1) * gw + gi], hd = H[Math.min(gh - 1, gj + 1) * gw + gi];
      const dx = (hr - hl) / (2 * c) * EX, dz = (hd - hu) / (2 * c) * EX, l = Math.sqrt(dx * dx + 1 + dz * dz);
      pos[o] = gi * c; pos[o + 1] = H[gj * gw + gi]; pos[o + 2] = gj * c;
      uv[(j * nx + i) * 2] = gi * c; uv[(j * nx + i) * 2 + 1] = gj * c;   // (world units: the tilted view's ground texture maps them)
      nor[o] = -dx / l; nor[o + 1] = 1 / l; nor[o + 2] = -dz / l;
    }
    let k = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx[k++] = a; idx[k++] = cc; idx[k++] = b; idx[k++] = b; idx[k++] = cc; idx[k++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
    return g;
  }
}

// ---- the renderer ---------------------------------------------------------------------------------------------
class R3D {
  constructor(r) {
    this.r = r;
    this.cv = document.createElement('canvas');
    const gl = this.gl = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    gl.setPixelRatio(1); gl.setClearColor(0x000000, 0);
    gl.shadowMap.enabled = true; gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05;
    const S = this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(FOV, 1, 1, 1000); this.cam.up.set(0, 0, -1);
    S.add(new THREE.HemisphereLight(0xfff6e4, 0x5a4a30, 1.25));
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.25; sun.shadow.radius = 2.5;
    S.add(sun, sun.target);
    // ground: an invisible depth plane (hides what's below ground) and a plane that only shows shadows
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.depth = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ colorWrite: false })); this.depth.renderOrder = -1; S.add(this.depth);
    this.shadowPlane = new THREE.Mesh(plane, new THREE.ShadowMaterial({ color: 0x1a1006, opacity: 0.42 }));
    this.shadowPlane.receiveShadow = true; this.shadowPlane.position.y = 0.01; S.add(this.shadowPlane);
    this.depth.frustumCulled = this.shadowPlane.frustumCulled = false;
    // terrain relief: black (shade) or warm white (sun) with alpha, over the painted ground; never hides anything
    this.reliefMat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, uniforms: { L: { value: LIGHT_DIR } },
      vertexShader: 'varying vec3 vN; varying float vH; void main() { vN = normal; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 L; varying vec3 vN; varying float vH; void main() { vec3 n = normalize(vN); float r = dot(n, L) / L.y;' +
        ' float d = clamp(1.0 - r, 0.0, 1.0) * 0.9 + clamp((5.0 - vH) / 5.0, 0.0, 1.0) * 0.12; float b = clamp(r - 1.0, 0.0, 1.0) * 0.8;' +
        ' if (d >= b) gl_FragColor = vec4(0.06, 0.04, 0.02, min(d, 0.6)); else gl_FragColor = vec4(1.0, 0.86, 0.6, min(b, 0.2)); }',
    });
    this.terrShadowMat = new THREE.ShadowMaterial({ color: 0x1a1006, opacity: 0.42, depthTest: false, depthWrite: false });
    this.terr = null;
    // tilted view: the 2D layers are painted to two offscreen canvases (ground under the models, overlays over them)
    // and laid on the ground as textures; uv = world units, mapped onto the canvas by the texture's offset / repeat
    this.tilt = null; this.tb = null;
    this.groundMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.overMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthTest: false, depthWrite: false });
    this.ground3d = null; this.over3d = null;
    // materials
    this.antMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.08 });
    this.antGlossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.12 });
    this.antMatteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.02 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0xe6f0ff, transparent: true, opacity: 0.38, roughness: 0.15, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
    this.woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
    this.plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    this.soilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.deadSoilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: 0x8a8a8a });
    this.blobMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.02 });
    this.chunkMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true });
    this.groups = new Map(); this.legMats = new Map();
    this.blobs = new Pool(this, new THREE.SphereGeometry(1, 12, 9), this.blobMat);
    this.chunks = new Pool(this, new THREE.IcosahedronGeometry(1, 0), this.chunkMat);
    this.carried = new Pool(this, new THREE.SphereGeometry(1, 8, 6), this.blobMat);
    // creatures: glossy shells (beetles, ladybugs, eyes), soft bodies, limbs, wings
    this.shellMat = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.12 });
    this.bugMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.02 });
    this.cShell = new Pool(this, new THREE.SphereGeometry(1, 16, 12), this.shellMat);
    this.cSoft = new Pool(this, new THREE.SphereGeometry(1, 12, 9), this.bugMat);
    this.cLimb = new Pool(this, new THREE.CylinderGeometry(1, 1, 1, 7, 1, true), this.bugMat);
    this.cWing = new Pool(this, new THREE.SphereGeometry(1, 14, 6), this.wingMat, false);
    this._c = { x: 0, y: 0, a: 0, ca: 1, sa: 0, s: 1, h0: 0 };
    this.mounds = new Map(); this.world = null; this.statics = []; this.flowerKey = -1; this.flowerMesh = null;
    this.ok = true;
  }
  // the ant material for legs: lost legs (injury.js) shrink to a stump at the hip, a lost head takes the antennae and
  // jaws with it; the same in the shadow pass
  legMatOf(base) {
    let e = this.legMats.get(base);
    if (e) return e;
    const patch = sh => {
      sh.vertexShader = 'attribute vec4 legInfo;\nattribute float legMask;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n  if (legInfo.w >= 0.0 && mod(floor((legMask + 0.5) / exp2(legInfo.w)), 2.0) < 0.5) transformed = mix(legInfo.xyz, transformed, legInfo.w > 5.5 ? 0.0 : 0.22);');
    };
    const mat = base.clone(); mat.onBeforeCompile = patch; mat.customProgramCacheKey = () => 'antLeg';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depth.onBeforeCompile = patch; depth.customProgramCacheKey = () => 'antLegDepth';
    e = { mat, depth }; this.legMats.set(base, e);
    return e;
  }
  group(caste, look) {
    const key = caste + '|' + look;
    let g = this.groups.get(key);
    if (!g) {
      const geos = antGeos(caste, look), lk = LOOKS[look];
      geos.mat = lk && lk.gloss ? this.antGlossMat : lk && lk.matte ? this.antMatteMat : this.antMat;
      g = new AntGroup(this, geos); this.groups.set(key, g);
    }
    return g;
  }
  resize() { const r = this.r; if (this.cv.width !== r.w || this.cv.height !== r.h) this.gl.setSize(r.w, r.h, false); }

  // a slow PC: if the game runs under ~45 fps for 4 s straight, step shadows down (high -> low -> off) for this
  // session, with a note; the Settings choice itself isn't changed. Never kicks in on a machine that keeps up.
  governor() {
    const P = AL.Game && AL.Game.perf, now = performance.now();
    if (!P || AL.Game.paused || AL.R3D.shadows === 'off') { this._slowSince = 0; return; }
    if (P.frameMs > 22) { if (!this._slowSince) this._slowSince = now; }
    else this._slowSince = 0;
    if (this._slowSince && now - this._slowSince > 4000) {
      this._slowSince = 0;
      AL.R3D.shadows = AL.R3D.shadows === 'high' ? 'low' : 'off';
      if (AL.UI && AL.UI.toast) AL.UI.toast('Running slow: 3D shadows set to ' + AL.R3D.shadows + ' (Settings to change)');
    }
  }
  // ---- static scenery, rebuilt when the world changes --------------------------------------------------------
  setWorld(world) {
    for (const m of this.statics) { this.scene.remove(m); m.geometry.dispose(); }
    this.statics = [];
    for (const m of this.mounds.values()) { this.scene.remove(m.mesh); m.mesh.geometry.dispose(); }
    this.mounds.clear();
    if (this.flowerMesh) { this.scene.remove(this.flowerMesh); this.flowerMesh.geometry.dispose(); this.flowerMesh = null; }
    this.flowerKey = -1; this.world = world;
    const S = world.surface;
    this.terr = null;
    if (AL.R3D.relief) try { this.terr = new Terrain(S, ((world.seed | 0) % 99991) + 17); } catch (e) { console.error('[Antlands 3D] terrain', e); }
    if (this.terr) {
      const g = this.terr.geometry(), rel = new THREE.Mesh(g, this.reliefMat), sh = new THREE.Mesh(g, this.terrShadowMat);
      rel.renderOrder = -3; sh.renderOrder = -2; sh.receiveShadow = true; rel.frustumCulled = sh.frustumCulled = false;
      this.scene.add(rel, sh); this.statics.push(rel, sh);
    }
    this.shadowPlane.visible = !this.terr;
    this.obs = this.buildObstacles(S, world);
    // the tilted view's ground and overlay sheets: the relief's surface, or a flat sheet over the yard
    {
      let g = this.terr ? this.terr.geometry() : null;
      if (!g) {
        g = new THREE.PlaneGeometry(S.W + 800, S.H + 800, 1, 1).rotateX(-Math.PI / 2).translate(S.W / 2, 0, S.H / 2);
        const p = g.attributes.position.array, uv = g.attributes.uv.array;
        for (let k = 0; k < p.length / 3; k++) { uv[k * 2] = p[k * 3]; uv[k * 2 + 1] = p[k * 3 + 2]; }
      }
      const gm = this.ground3d = new THREE.Mesh(g, this.groundMat), om = this.over3d = new THREE.Mesh(g, this.overMat);
      gm.renderOrder = -5; om.renderOrder = 1000; gm.frustumCulled = om.frustumCulled = false; gm.visible = om.visible = false;
      this.scene.add(gm, om); this.statics.push(gm, om);
    }
    this.addStatic(this.buildRocks(S), this.rockMat);
    this.addStatic(this.buildLogs(S), this.woodMat);
    this.warm(world);
  }
  // pay the one-off costs at load instead of mid-game: every colony's ant models for the castes it can raise
  // (building one is a few ms, felt as a hitch when your first soldier hatches), the flowers, and the shaders
  warm(world) {
    try {
      for (const c of world.colonies) if (c) for (let k = 0; k <= 6; k++) palOf(this, c.colours || c.sp, k);
      this.updateFlowers(world.surface);
      const hidden = [];
      this.scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && !o.visible) { o.visible = true; hidden.push(o); } });
      this.gl.compile(this.scene, this.cam);
      for (const o of hidden) o.visible = false;
    } catch (e) { console.error('[Antlands 3D] warm-up', e); }
  }
  addStatic(geo, mat) {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; this.scene.add(m); this.statics.push(m);
  }
  buildRocks(S) {
    if (!S.rocks || !S.rocks.length) return null;
    const b = new Builder(), base = new THREE.IcosahedronGeometry(1, 2);
    const light = col('#bdb7a8'), mid = col('#8f897c'), dark = col('#5d584e'), moss = col('#78965a');
    for (const r of S.rocks) {
      const g = base.clone(), p = g.attributes.position, seed = (r.seed | 0) + 11;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.8 + hx3(x, y, z, seed) * 0.32 + (y > 0.6 ? -0.12 : 0);
        p.setXYZ(i, x * k, y * k, z * k);
      }
      g.computeVertexNormals();
      const h = Math.min(r.rx, r.ry) * 0.62, g0 = this.T(r.x, r.y);
      b.add(g, M(r.x, h * 0.12 + g0, r.y, r.rx, h, r.ry, 0, -(r.rot || 0), 0), null, (x, y, z, nx, ny) => {
        const n = AL.hash2(Math.round(x * 0.4), Math.round(z * 0.4), seed);
        _c.copy(dark).lerp(mid, AL.clamp((y - g0) / h + 0.3, 0, 1)).lerp(light, AL.clamp((ny - 0.55) * 1.6, 0, 1) * 0.7);
        _c.multiplyScalar(0.88 + n * 0.24);
        if (ny > 0.35 && n > 0.78) _c.lerp(moss, 0.55);
        return _c;
      });
      g.dispose();
    }
    return b.build();
  }
  buildLogs(S) {
    if (!S.logs || !S.logs.length) return null;
    const b = new Builder(), cyl = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false).rotateZ(Math.PI / 2);
    const bark0 = col('#7a5a3a'), bark1 = col('#4a3420'), wood = col('#c49a68'), moss = col('#6e963c');
    for (const l of S.logs) {
      const seed = (l.seed | 0) + 5, ax = Math.cos(l.rot || 0), az = Math.sin(l.rot || 0);
      b.add(cyl, M(l.x, l.r * 0.72 + this.T(l.x, l.y), l.y, l.len, l.r, l.r, 0, -(l.rot || 0), 0), null, (x, y, z, nx, ny, nz) => {
        if (Math.abs(nx * ax + nz * az) > 0.85) return _c.copy(wood).multiplyScalar(0.9 + AL.hash2(Math.round(x), Math.round(z), seed) * 0.2);
        const n = AL.hash2(Math.round((x * az - z * ax) * 0.9), Math.round(y * 0.9), seed);
        _c.copy(bark1).lerp(bark0, n);
        if (ny > 0.55 && AL.hash2(Math.round(x * 0.08), Math.round(z * 0.08), seed + 1) > 0.6) _c.lerp(moss, 0.6);
        return _c;
      });
    }
    return b.build();
  }
  // every flower, cut or not, in one mesh; ranges[i*2..] = flower i's vertices (the mower collapses them, see below)
  buildFlowers(S) {
    const b = new Builder(), c1 = col('#5f9a3e'), c2 = col('#6aa646'), stem = col('#4f8a34');
    const daisy = col('#f4f1e6'), dand = col('#f2c531'), dCore = col('#e8b923'), yCore = col('#d99a1c');
    const L = S.flowers, R = this.flowerRanges = new Int32Array(L.length * 2);
    for (let fi = 0; fi < L.length; fi++) {
      const f = L[fi];
      R[fi * 2] = b.pos.length / 3;
      const s = f.s || 1, rot = f.rot || 0, g = this.T(f.x, f.y);
      if (f.kind === 'clover') {
        for (let k = 0; k < 3; k++) {
          const a = rot + (k + 1) * TAU / 3;
          b.add(SPH_LO, M(f.x + Math.cos(a) * 4 * s, g + 1.6 * s, f.y + Math.sin(a) * 4 * s, 4.2 * s, 0.45 * s, 3.4 * s, 0, -a, 0), k ? c1 : c2);
        }
        b.seg(V(f.x, g, f.y), V(f.x, g + 1.5 * s, f.y), 0.45 * s, stem);
      } else {
        const top = g + 4.2 * s, d = f.kind === 'daisy';
        b.seg(V(f.x, g, f.y), V(f.x, top, f.y), 0.55 * s, stem);
        for (let k = 0; k < 10; k++) {
          const a = rot + (k + 1) * TAU / 10;
          b.add(SPH_LO, M(f.x + Math.cos(a) * 4.2 * s, top + 0.2 * s, f.y + Math.sin(a) * 4.2 * s, 3.4 * s, 0.45 * s, 1.25 * s, 0, -a, 0.12), d ? daisy : dand);
        }
        b.add(SPH_LO, M(f.x, top + 0.5 * s, f.y, 2.2 * s, 1.1 * s, 2.2 * s), d ? dCore : yCore);
      }
      R[fi * 2 + 1] = b.pos.length / 3;
    }
    return b.empty ? null : b.build();
  }
  // built once per world; mowing / regrowing only rewrites that flower's vertices (collapsed to a point = gone) and
  // uploads just that slice: no rebuild, so the mower can't stutter the frame
  updateFlowers(S) {
    const L = S.flowers || [];
    if (this.flowerKey !== L.length) {
      this.flowerKey = L.length;
      if (this.flowerMesh) { this.scene.remove(this.flowerMesh); this.flowerMesh.geometry.dispose(); this.flowerMesh = null; }
      const g = L.length ? this.buildFlowers(S) : null;
      if (g) {
        const m = this.flowerMesh = new THREE.Mesh(g, this.plantMat); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
        g.attributes.position.setUsage(THREE.DynamicDrawUsage);
        this.flowerOrig = g.attributes.position.array.slice(); this.flowerCut = new Uint8Array(L.length);
      }
    }
    const m = this.flowerMesh;
    if (!m || this.r.frame % 10) return;
    const pa = m.geometry.attributes.position, Pa = pa.array, O = this.flowerOrig, R = this.flowerRanges, st = this.flowerCut;
    let lo = Infinity, hi = -1;
    for (let i = 0; i < L.length; i++) {
      const c = L[i].cut ? 1 : 0;
      if (c === st[i]) continue;
      st[i] = c;
      const a = R[i * 2] * 3, b = R[i * 2 + 1] * 3;
      if (a === b) continue;
      if (c) { const x = O[a], y = O[a + 1], z = O[a + 2]; for (let k = a; k < b; k += 3) { Pa[k] = x; Pa[k + 1] = y; Pa[k + 2] = z; } }
      else Pa.set(O.subarray(a, b), a);
      if (a < lo) lo = a; if (b > hi) hi = b;
    }
    if (hi > 0) { pa.clearUpdateRanges(); pa.addUpdateRange(lo, hi - lo); pa.needsUpdate = true; }
  }

  // ---- mounds: a soil dome per colony, rebuilt when it grows ---------------------------------------------------
  moundGeo(c, R) {
    const NR = 26, NA = 72, pos = [], cols = [], idx = [];
    const light = col('#b48a5a'), mid = col('#8d6a42'), dark = col('#5e442a'), hole = col('#140b05'), rim = col('#a07a4c');
    const er = Math.min(10, 5 + R * 0.06);
    pos.push(c.x, moundY(0, R) + this.T(c.x, c.y), c.y); cols.push(hole.r, hole.g, hole.b);
    for (let i = 1; i <= NR; i++) for (let j = 0; j < NA; j++) {
      const a = j / NA * TAU, t = i / NR, ws = j / NA * 12, w0 = Math.floor(ws), wf = ws - w0, wu = wf * wf * (3 - 2 * wf);
      const wob = 1 + ((AL.hash2(w0 % 12, 5, c.id + 3) * (1 - wu) + AL.hash2((w0 + 1) % 12, 5, c.id + 3) * wu) - 0.5) * 0.16 * t;
      const d = t * R * 1.05 * wob, n = AL.hash2(i * 3 + 1, j * 7 + 2, c.id * 13 + 1);
      let y = moundY(d / wob, R) + (n - 0.5) * 1.1 * t * (1 - t) * 4 * Math.min(1, R / 30);
      if (i === NR) y = 0;
      const px = c.x + Math.cos(a) * d, pz = c.y + Math.sin(a) * d;
      pos.push(px, Math.max(0, y) + this.T(px, pz), pz);
      const lit = (-Math.cos(a) - Math.sin(a)) * 0.5 * t;   // upper-left side catches the light
      _c.copy(light).lerp(mid, AL.clamp(t * 1.3 - 0.1, 0, 1)).lerp(dark, AL.clamp((t - 0.6) * 2.2, 0, 1));
      _c.multiplyScalar(0.85 + n * 0.3 + lit * 0.15);
      if (d < er * 0.8) _c.copy(hole); else if (d < er * 2) _c.lerp(_c2.copy(hole).lerp(rim, 0.35), 1 - (d - er * 0.8) / (er * 1.2));
      cols.push(_c.r, _c.g, _c.b);
    }
    for (let j = 0; j < NA; j++) idx.push(0, 1 + (j + 1) % NA, 1 + j);
    for (let i = 1; i < NR; i++) for (let j = 0; j < NA; j++) {
      const a = 1 + (i - 1) * NA + j, b = 1 + (i - 1) * NA + (j + 1) % NA, cc = a + NA, d = b + NA;
      idx.push(a, b, cc, b, d, cc);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  updateMounds(world) {
    const fog = world.fog, me = AL.me ? AL.me() : (world.me || 0), seen = new Set();
    this.moundList = [];
    for (const c of world.colonies) {
      if (!c || c.sp.nomad || !(c.moundR > 0)) continue;
      const visible = !(fog && c.id !== me && !fog.seenAt(c.x, c.y));
      const R = Math.round(c.moundR), key = R + ':' + c.x + ':' + c.y;
      let m = this.mounds.get(c);
      if (!m || m.key !== key) {
        if (m) { this.scene.remove(m.mesh); m.mesh.geometry.dispose(); }
        const mesh = new THREE.Mesh(this.moundGeo(c, R), this.soilMat); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
        this.scene.add(mesh); m = { mesh, key, R }; this.mounds.set(c, m);
      }
      m.mesh.visible = visible; m.mesh.material = c.alive ? this.soilMat : this.deadSoilMat;
      seen.add(c);
      this.moundList.push({ x: c.x, y: c.y, R });
    }
    for (const [c, m] of this.mounds) if (!seen.has(c)) { this.scene.remove(m.mesh); m.mesh.geometry.dispose(); this.mounds.delete(c); }
  }
  heightAt(x, y) {
    let h = 0;
    const L = this.moundList;
    for (let k = 0; k < L.length; k++) {
      const m = L[k], dx = x - m.x, dy = y - m.y, R = m.R * 1.05;
      if (dx * dx + dy * dy < R * R) { const v = moundY(Math.sqrt(dx * dx + dy * dy), m.R); if (v > h) h = v; }
    }
    const o = this.obsAt(x, y), g = h + this.T(x, y);
    return o > g ? o : g;   // (on top of a rock or log it's climbing)
  }
  T(x, y) { return this.terr ? this.terr.at(x, y) : 0; }   // terrain height
  // rocks and logs as heights (ants climb over them: behavior.js): their tops, on a 4-unit grid
  buildObstacles(S, world) {
    const c = 4, gw = Math.ceil(S.W / c) + 1, gh = Math.ceil(S.H / c) + 1, h = new Float32Array(gw * gh);
    const put = (x0, y0, x1, y1, f) => {
      const i0 = Math.max(0, Math.floor(x0 / c)), i1 = Math.min(gw - 1, Math.ceil(x1 / c)), j0 = Math.max(0, Math.floor(y0 / c)), j1 = Math.min(gh - 1, Math.ceil(y1 / c));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = f(i * c, j * c); if (v > h[j * gw + i]) h[j * gw + i] = v; }
    };
    for (const r of S.rocks || []) {
      const hh = Math.min(r.rx, r.ry) * 0.62, g0 = this.T(r.x, r.y), ca = Math.cos(r.rot || 0), sa = Math.sin(r.rot || 0), m = Math.max(r.rx, r.ry);
      put(r.x - m, r.y - m, r.x + m, r.y + m, (x, y) => {
        const dx = x - r.x, dy = y - r.y, u = (dx * ca + dy * sa) / r.rx, v = (-dx * sa + dy * ca) / r.ry, t = u * u + v * v;
        return t < 1 ? g0 + hh * 0.12 + hh * 0.92 * Math.sqrt(1 - t) : 0;
      });
    }
    for (const l of S.logs || []) {
      const g0 = this.T(l.x, l.y), ca = Math.cos(l.rot || 0), sa = Math.sin(l.rot || 0), m = l.len / 2 + l.r;
      put(l.x - m, l.y - m, l.x + m, l.y + m, (x, y) => {
        const dx = x - l.x, dy = y - l.y, al = dx * ca + dy * sa, pe = -dx * sa + dy * ca;
        if (Math.abs(al) > l.len / 2 || Math.abs(pe) >= l.r) return 0;
        return g0 + l.r * 0.72 + Math.sqrt(l.r * l.r - pe * pe);
      });
    }
    // the patio's slabs, stepping stones and the picnic blanket (yard3d.js models them): ants walk on top
    if (S.patio) { const p = S.patio; put(p.x, p.y, p.x + p.w, p.y + p.h, (x, y) => x >= p.x && y >= p.y && x <= p.x + p.w && y <= p.y + p.h ? this.T(x, y) + 3.1 : 0); }
    for (const st of S.stones || []) {
      const ca = Math.cos(st.rot || 0), sa = Math.sin(st.rot || 0), m = Math.max(st.rx, st.ry), g0 = this.T(st.x, st.y);
      put(st.x - m, st.y - m, st.x + m, st.y + m, (x, y) => { const dx = x - st.x, dy = y - st.y, u = (dx * ca + dy * sa) / st.rx, v = (-dx * sa + dy * ca) / st.ry; return u * u + v * v < 1 ? g0 + 2.1 : 0; });
    }
    const bl = world && world.poi && world.poi.blanket;
    if (bl) {
      const ca = Math.cos(bl.rot || 0), sa = Math.sin(bl.rot || 0), m = Math.hypot(bl.w, bl.h) / 2;
      put(bl.x - m, bl.y - m, bl.x + m, bl.y + m, (x, y) => { const dx = x - bl.x, dy = y - bl.y, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; return Math.abs(u) < bl.w / 2 && Math.abs(v) < bl.h / 2 ? this.T(x, y) + 1.2 : 0; });
    }
    return { c, gw, gh, h };
  }
  obsAt(x, y) {
    const o = this.obs; if (!o) return 0;
    let fx = x / o.c, fy = y / o.c;
    if (fx < 0 || fy < 0 || fx >= o.gw - 1 || fy >= o.gh - 1) return 0;
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, H = o.h, k = j * o.gw + i;
    const a = H[k], b = H[k + 1], cc = H[k + o.gw], d = H[k + o.gw + 1];
    if (!(a || b || cc || d)) return 0;
    return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
  }

  // ---- food that stands up off the ground -----------------------------------------------------------------
  updateFoods(world, v) {
    const S = world.surface, B = this.blobs, Ch = this.chunks;
    B.begin(); Ch.begin();
    for (const f of S.foods) {
      if (f.gone || (f.spring && f.amount < 1)) continue;
      const mg = (f.r || 8) + 40;
      if (f.x + mg < v.x0 || f.x - mg > v.x1 || f.y + mg < v.y0 || f.y - mg > v.y1) continue;
      if (!is3DFood(f)) continue;
      B.yOff = Ch.yOff = this.T(f.x, f.y);
      const frac = f.max ? AL.clamp(f.amount / f.max, 0, 1) : 1;
      switch (f.visual) {
        case 'fruit': {
          const r = f.r * (0.55 + 0.45 * Math.sqrt(frac)), rot = f.rot || 0;
          _c.set(Art.mix('#c8322a', '#6b4a22', AL.clamp(rot, 0, 1)));
          B.put(f.x, r * 0.8, f.y, 0, r, r * 0.88, r, _c);
          if (frac < 0.95) { _c.set(Art.mix('#f2e2b8', '#8a6a3a', AL.clamp(rot, 0, 1))); B.put(f.x + r * 0.62, r * 0.75, f.y + r * 0.22, 0.5, r * 0.42 * (1 - frac) + 3, r * 0.5, r * 0.5 * (1 - frac) + 3, _c); }
          Ch.put(f.x - 2, r * 1.62, f.y - r * 0.25, 0.4, 0.9, 3, 0.9, FC.stem);
          B.put(f.x - 8, r * 1.62, f.y - r * 0.6, -0.5, 7, 0.9, 3.2, FC.leaf);
          break;
        }
        case 'cookie': {
          const R = AL.rng(f.id * 31 + 7), n = Math.ceil(26 * frac + 2);
          for (let k = 0; k < n; k++) {
            const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, s = 2.5 + R() * 5, ra = R() * 3;
            Ch.put(x, s * 0.32, y, ra, s, s * 0.62, s * 0.8, FC.cookie[k % 3]);
            if (k % 4 === 0) Ch.put(x + 1, s * 0.66, y, ra, s * 0.32, s * 0.3, s * 0.32, FC.choc);
          }
          break;
        }
        case 'ham': {
          const r = f.r * (0.5 + 0.5 * frac);
          B.put(f.x, r * 0.32, f.y, 0.4, r * 1.2, r * 0.42, r * 0.8, FC.ham);
          break;
        }
        case 'grubs': {
          const n = Math.max(1, Math.round(2 + frac * 10)), seed = (f.id * 13) % 97;
          for (let k = 0; k < n; k++) {
            const a = AL.hash2(seed, k, 3) * TAU, d = Math.sqrt(AL.hash2(seed, k, 5)) * f.r * 0.75, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d * 0.8, rot = AL.hash2(seed, k, 7) * TAU;
            B.put(x, 1.7 + (k % 3) * 0.8, y, rot, 3.4, 1.8, 1.9, FC.grub);
            B.put(x + Math.cos(rot) * 3, 1.8 + (k % 3) * 0.8, y + Math.sin(rot) * 3, rot, 0.9, 0.9, 0.9, FC.grubHead);
          }
          break;
        }
        case 'beetle': this.frame(f.x, f.y, angOf(f), f.r * 0.85 * (0.7 + 0.3 * frac) / 10.5); this.beetle(0, true); break;
        case 'spider': this.frame(f.x, f.y, angOf(f), 0.75 + 0.25 * frac); this.spider(0, true); break;
        case 'caterpillar': this.frame(f.x, f.y, angOf(f), 0.7 + 0.3 * frac); this.caterpillar(0, false, true); break;
        case 'ladybug': this.frame(f.x, f.y, f.a || 0, 0.9); this.ladybug(0, true); break;
        case 'centipede': this.frame(f.x, f.y, angOf(f), 0.7 + 0.3 * frac); this.centipede(0, true); break;
        case 'assassin': this.frame(f.x, f.y, angOf(f), 0.7 + 0.3 * frac); this.assassin(0, true, true, false); break;
        case 'mantis': this.frame(f.x, f.y, angOf(f), 0.7 + 0.3 * frac); this.mantis(0, true, true, false, false); break;
        case 'antlion': this.frame(f.x, f.y, angOf(f), 0.7 + 0.3 * frac); this.antlion(true); break;
        case 'moth': this.frame(f.x, f.y, angOf(f), 0.6 + 0.4 * frac); this.moth(); break;
        case 'cocoon': this.frame(f.x, f.y, f.a || 0, 0.7 + 0.3 * frac); this.cocoon(true); break;
        case 'corpse': {
          const cc = world.colonies[f.col || 0];
          if (!cc) break;
          const p = deadPal(palOf(this, cc.colours || cc.sp, C.WORKER)), R = AL.rng(f.id * 3 + 1), n = Math.min(6, f.n || 1), s = (cc.sp.size || 1);
          for (let k = 0; k < n; k++) {
            const x = f.x + (k ? (R() - 0.5) * 10 : 0), y = f.y + (k ? (R() - 0.5) * 10 : 0), a = R() * TAU;
            p.group.put(x, -0.75 * s + this.heightAt(x, y), y, Math.cos(a), Math.sin(a), s, 3, p);
          }
          break;
        }
        case 'bug': B.put(f.x, 1.5, f.y, f.a || 0, 4.5, 1.7, 2.6, FC.bug); break;
        case 'honeydew': {   // an aphid plant: a leaf rosette round a stem, aphids on it, honeydew beads
          const p = f.poi || f, R = AL.rng(((p.seed || 1) * 1000) | 0), g = this.T(p.x, p.y);
          this.frame(p.x, p.y, 0, 1);
          this.limb(0, 0, 0, 0, 0, 9, 1.3, FC.stem2);
          for (let k = 0; k < 9; k++) {
            const a = k / 9 * TAU + R() * 0.3, L = (p.r || 30) * (0.75 + R() * 0.3), h = 2.5 + (k % 3) * 1.6;
            this.blob(Math.cos(a) * L * 0.5, Math.sin(a) * L * 0.5, h, L * 0.5, 0.5, L * 0.17, a, k & 1 ? FC.leaf : FC.leaf2);
          }
          this.blob(0, 0, 9.5, 2.4, 2, 2.4, 0, FC.leaf2);
          const n = Math.round(p.aphids || 0);
          for (let k = 0; k < n; k++) { const a = k * 2.39996, d = 8 + (k % 7) * 4.5; this.blob(Math.cos(a) * d, Math.sin(a) * d, 5.6 + (k % 3) * 1.2, 2.4, 1.5, 1.7, a, FC.aphid); }
          const drops = Math.round(frac * 10);
          for (let k = 0; k < drops; k++) { const a = k * 1.7 + 0.4, d = 12 + (k % 4) * 6; this.blob(Math.cos(a) * d, Math.sin(a) * d, 6.2 + (k % 3), 1.8, 1.6, 1.8, 0, FC.honey, true); }
          void g; break;
        }
        case 'seeds': {   // seeds with their white fluff
          const R = AL.rng(f.id * 13 + 1), n = Math.ceil(20 * frac + 1);
          for (let k = 0; k < n; k++) {
            const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, ang = R() * TAU;
            Ch.put(x, 0.9, y, ang, 2.6, 0.9, 1.1, FC.seed);
            B.put(x + Math.cos(ang) * 6.5, 2.6, y + Math.sin(ang) * 6.5, 0, 2.2, 1.6, 2.2, FC.fluff);
            this.frame(x, y, 0, 1); this.cLimb.seg(this.lw(_va, Math.cos(ang) * 2, Math.sin(ang) * 2, 1), this.lw(_vb, Math.cos(ang) * 6, Math.sin(ang) * 6, 2.4), 0.2, FC.fluff);
          }
          break;
        }
        case 'leaves': {   // clover: three round leaflets on a short stalk
          const R = AL.rng(f.id * 17 + 3), n = Math.ceil(16 * frac + 4);
          for (let k = 0; k < n; k++) {
            const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, r0 = R() * TAU, h = 2 + (k % 3) * 0.8;
            for (let j = 0; j < 3; j++) { const aj = r0 + j * TAU / 3; B.put(x + Math.cos(aj) * 4.6, h, y + Math.sin(aj) * 4.6, aj, 5, 0.6, 4, j ? FC.clover : FC.clover2); }
            Ch.put(x, h * 0.5, y, 0, 0.6, h * 0.5, 0.6, FC.stem2);
          }
          break;
        }
        case 'larvae': {   // a spill of white grubs
          const R = AL.rng(f.id * 19 + 3), n = Math.ceil(30 * frac + 2);
          for (let k = 0; k < n; k++) { const a = R() * TAU, d = Math.sqrt(R()) * f.r, r = R() * TAU; B.put(f.x + Math.cos(a) * d, 1.1, f.y + Math.sin(a) * d, r, 2.2, 1.1, 1.2, k % 3 ? FC.grub : FC.grub2); }
          break;
        }
        case 'nectar': {   // a gold bead in the flower's heart, bigger when full
          if (frac < 0.2 || (f.flower && f.flower.cut)) break;
          const fl = f.flower, s = (fl && fl.s) || 1, top = (fl ? 4.2 * s + 1.1 * s : 3) + 0.8, r = 0.8 + 1.5 * frac;
          this.frame(f.x, f.y, 0, 1); this.blob(0, 0, top, r, r * 0.8, r, 0, FC.honey, true);
          break;
        }
        default: {
          const R = AL.rng(f.id * 7 + 5), n = Math.ceil(5 * frac + 1), sug = f.kind === K.SUGAR;
          for (let k = 0; k < n; k++) {
            const x = f.x + (R() - 0.5) * f.r * 1.6, y = f.y + (R() - 0.5) * f.r * 1.6, s = 1.6 + R() * 2;
            Ch.put(x, s * 0.4, y, R() * 3, s, s * 0.7, s * 0.8, (sug ? FC.sugar : FC.meat)[k & 1]);
          }
        }
      }
    }
    B.yOff = Ch.yOff = 0; B.end(); Ch.end();
  }

  // ---- ants ----------------------------------------------------------------------------------------------------
  updateAnts(world, alpha, v, z, ox, oy) {
    const r = this.r, A = world.ants, n = A.high;
    const X = A.x, Y = A.y, PX = A.px, PY = A.py, ANG = A.a, ST = A.state, LY = A.layer, COL = A.col, CA = A.caste, AN = A.anim, CR = A.carry;
    const fog = world.fog, HOST = A.host, CAPT = C.CAPTIVE, ME = world.me || 0, HP = A.hp, MHP = A.maxhp, CS = AL.CASTES, SZ = A.size, LG = A.legs, HL = A.headless;
    const cols = world.colonies, x0 = v.x0 - 12, x1 = v.x1 + 12, y0 = v.y0 - 12, y1 = v.y1 + 12;
    const FR = [0, 1, 0, 2], CP = this.carried, hasMounds = this.moundList.length > 0;
    const SF = world.surface, BO = world.bridgesWhole > 0 || (world.bridges && world.bridges.length) ? SF.bridgeOwner : null, TSP = SF.tspeed, BI = SF.cell ? 1 / SF.cell : 0, BGW = SF.gw;   // (living bridges: their ants walk on top)
    let drawn = 0;
    // cosmetic hats (hats.js): x, y, z, heading, scale, hat, variant per wearer; hats3d.js draws the queue
    const HQ = AL.R3D.hatQ, HW = AL.Hats ? AL.Hats.WEAR : null; HQ.length = 0;
    for (let i = 0; i < n; i++) {   // (groups and the carried pool are begun / ended in render())
      if (!ST[i] || LY[i] !== 0) continue;
      const x = PX[i] + (X[i] - PX[i]) * alpha, y = PY[i] + (Y[i] - PY[i]) * alpha;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const c = COL[i];
      if (c !== ME && fog && !fog.visibleAt(x, y)) continue;
      const caste = CA[i], cc = cols[caste === CAPT && HOST ? HOST[i] : c] || cols[c];
      if (!cc) continue;
      const pal = palOf(this, cc.colours || cc.sp, caste);
      const s = CS[caste].size * (cc.sp.size || 1) * (SZ ? SZ[i] : 1) * (ANT_SCALE / 11);
      const a = ANG[i], ca = Math.cos(a), sa = Math.sin(a);
      let h = hasMounds || this.terr ? this.heightAt(x, y) : 0;
      if (BO) { const ci = ((y * BI) | 0) * BGW + ((x * BI) | 0); if (BO[ci] === c + 1 && TSP[ci] < 0.5) h += 3.4; }   // on its colony's living bridge
      pal.group.put(x, h, y, ca, sa, s, FR[(AN[i] | 0) & 3], pal, LG ? LG[i] | (HL[i] ? 0 : 64) : undefined);   // (injuries)
      if (HW && HW[caste] && cc.hat && !(HL && HL[i])) {
        const hd = AL.Hats.head(caste, LOOK_OF(cc.colours || cc.sp), LOOKS);
        HQ.push(x + ca * hd.x * s, h + (ANT_Y + 0.25 + hd.r * 0.62) * s, y + sa * hd.x * s, a, hd.r * s * 1.4, cc.hat.id, cc.hat.v | 0);
      }
      const k = CR[i];
      if (k) {
        const d = 6.5 * CS[caste].size * (SZ ? SZ[i] : 1), px = x + ca * d, py = y + sa * d, cy = h + 1.5 * s;
        const cr = CARRY_COL[k] || CARRY_COL[7];
        if (k === K.LEAF) CP.put(px, cy + 2.2, py, a + 0.6, 2.6, 0.35, 1.8, cr);
        else if (k === K.BROOD) CP.put(px, cy, py, a + 0.5, 1.7, 1.05, 1.05, cr);
        else CP.put(px, cy, py, a, 1.25, 1.1, 1.25, cr);
      }
      if (HP[i] < MHP[i]) r.barAnt(i, x * z + ox, y * z + oy, z < 0.8 ? Math.max(1.5, 2.6 * z) : 6.5 * z * (SZ ? SZ[i] : 1) * CS[caste].size);
      drawn++;
    }
    r.stats.drawn = drawn;
  }

  // ---- creatures: models built from primitives each frame, in the 2D art's local units -------------------------
  // frame() sets the creature's place; local (lx forward, ly to its side, h up) -> world
  frame(x, y, a, s) { const c = this._c; c.x = x; c.y = y; c.a = a; c.ca = Math.cos(a); c.sa = Math.sin(a); c.s = s; c.h0 = this.heightAt(x, y); }
  lw(out, lx, ly, h) { const c = this._c; return out.set(c.x + (lx * c.ca - ly * c.sa) * c.s, c.h0 + h * c.s, c.y + (lx * c.sa + ly * c.ca) * c.s); }
  blob(lx, ly, h, rx, ry, rz, rot, colr, shell) { const c = this._c, p = this.lw(_va, lx, ly, h); (shell ? this.cShell : this.cSoft).put(p.x, p.y, p.z, c.a + (rot || 0), rx * c.s, ry * c.s, rz * c.s, colr); }
  wing(lx, ly, h, rx, rz, rot) { const c = this._c, p = this.lw(_va, lx, ly, h); this.cWing.put(p.x, p.y, p.z, c.a + (rot || 0), rx * c.s, 0.05 * c.s, rz * c.s, WHITE); }
  limb(x1, y1, h1, x2, y2, h2, r, colr) {
    const s = this._c.s, a = this.lw(_va, x1, y1, h1), b = this.lw(_vb, x2, y2, h2);
    this.cLimb.seg(a, b, r * s, colr); this.cSoft.put(b.x, b.y, b.z, 0, r * s, r * s, r * s, colr);
  }
  cBegin() { this.cShell.begin(); this.cSoft.begin(); this.cLimb.begin(); this.cWing.begin(); }
  cEnd() { this.cShell.end(); this.cSoft.end(); this.cLimb.end(); this.cWing.end(); }
  spider(t, dead, lunge) {
    const body = dead ? CC.deadBody : CC.spider, ceph = dead ? CC.deadBody : CC.spiderCeph, dark = dead ? CC.deadDark : CC.spiderDark, leg = dead ? CC.deadLeg : CC.spiderLeg;
    const up = lunge ? 1.2 : 0;
    for (let k = 0; k < 4; k++) for (const side of [-1, 1]) {
      const ph = ((k + (side > 0 ? 1 : 0)) & 1) ? Math.PI : 0, sw = dead ? 0 : Math.sin(t * 9 + ph) * 0.22, lift = dead ? 0 : Math.max(0, Math.sin(t * 9 + ph)) * 1.4;
      const bx = 3.2 - k * 1.5, by = side * 1.9, ka = (SP_LEGS[k] + sw) * side, L1 = dead ? 5 : 9, L2 = dead ? 4 : 10.5;
      const kx = bx + Math.cos(ka) * L1, ky = by + Math.sin(ka) * L1, fa = ka + side * (dead ? 1.6 : (k < 2 ? -0.45 : 0.45));
      const fx = kx + Math.cos(fa) * L2, fy = ky + Math.sin(fa) * L2, kh = dead ? 5 : 8 + up;
      this.limb(bx, by, 3.8 + up, kx, ky, kh, 0.8, leg); this.limb(kx, ky, kh, fx, fy, dead ? 4 : 0.3 + lift, 0.55, leg);
    }
    this.blob(-7, 0, 4.6 + up * 0.5, 7.6, 4.4, 5.8, 0, body);
    if (!dead) { this.blob(-6.5, 0, 8.6 + up * 0.5, 4.8, 0.5, 0.9, 0, CC.spiderStripe); for (let k = 0; k < 4; k++) this.blob(-3.5 - k * 2.2, 0, 8.2 + up * 0.5 - k * 0.5, 0.8, 0.5, 3.4 - k * 0.5, 0, dark); }
    this.blob(2.2, 0, 4 + up, 4.8, 2.8, 3.9, 0, ceph);
    if (!dead) for (const s2 of [-1, 1]) { this.blob(5.4, s2 * 1.15, 6 + up, 0.95, 0.9, 0.95, 0, CC.eye, true); this.blob(4.6, s2 * 0.6, 6.4 + up, 0.5, 0.5, 0.5, 0, CC.eye, true); }
    for (const s2 of [-1, 1]) this.limb(6.2, s2 * 1.2, 4 + up, 8.6, s2 * 1.9, 2.4 + up, 0.55, dark);
  }
  beetle(t, dead) {
    const leg = dead ? CC.deadLeg : CC.beetleLeg;
    for (let k = -1; k <= 1; k++) for (const sd of [-1, 1]) {
      const ph = ((k + 1 + (sd > 0 ? 1 : 0)) & 1) ? Math.PI : 0, sw = dead ? 0 : Math.sin(t * 8 + ph) * 0.3, lift = dead ? 0 : Math.max(0, Math.sin(t * 8 + ph)) * 1.2;
      const bx = k * 3.6 + 1, by = sd * 4.5, ang = sd * (Math.PI / 2 + k * -0.5 + sw) + (dead ? -sd * 0.9 : 0);
      const kx = bx + Math.cos(ang) * (dead ? 4 : 6), ky = by + Math.sin(ang) * (dead ? 4 : 6), fa = ang - sd * k * 0.4 + sd * (dead ? 1.4 : 0.2);
      const fx = kx + Math.cos(fa) * (dead ? 3.5 : 5), fy = ky + Math.sin(fa) * (dead ? 3.5 : 5);
      this.limb(bx, by, 3, kx, ky, dead ? 5 : 5.5, 0.75, leg); this.limb(kx, ky, dead ? 5 : 5.5, fx, fy, dead ? 5.5 : 0.3 + lift, 0.55, leg);
    }
    for (const sd of [-1, 1]) { const w = dead ? 0.4 : Math.sin(t * 3 + sd) * 0.15; this.limb(11, sd * 1.6, 4, 15, sd * (3 + w * 10), 5.2, 0.35, leg); this.limb(15, sd * (3 + w * 10), 5.2, 18, sd * (5.5 + w * 8), 4.6, 0.3, leg); }
    this.blob(-2.5, 0, 4.4, 10.5, 4.6, 7.4, 0, dead ? CC.beetleDead : CC.beetleShell, true);
    this.blob(6.6, 0, 4, 3.6, 3, 5, 0, dead ? CC.deadDark : CC.beetlePro, true);
    this.blob(10, 0, 3.4, 2.6, 2.1, 2.8, 0, dead ? CC.deadDark : CC.beetleHead, true);
    for (const sd of [-1, 1]) this.limb(12, sd * 1, 3.2, 13.6, sd * 0.2, 2.8, 0.45, CC.eye);
  }
  ladybug(t, dead) {
    if (!dead) for (let k = -1; k <= 1; k++) for (const sd of [-1, 1]) { const sw = Math.sin(t * 10 + k + sd) * 0.3; this.limb(k * 2, sd * 3, 1.8, k * 2.6 + sw, sd * 5.4, 0.2, 0.4, CC.lbBlack); }
    this.blob(-1.5, 0, 2.6, 5.8, 3.6, 5, 0, dead ? CC.lbDead : CC.lbRed, true);
    for (const sp of LB_SPOTS) {
      const u = (sp[0] + 1.5) / 5.8, w = sp[1] / 5, h = 2.6 + 3.6 * Math.sqrt(Math.max(0, 1 - u * u - w * w));
      this.blob(sp[0], sp[1], h - 0.1, sp[2], 0.35, sp[2], 0, CC.lbBlack, true);
    }
    this.blob(4.6, 0, 2.2, 1.9, 1.7, 3.6, 0, CC.lbBlack, true);
    for (const sd of [-1, 1]) this.blob(4.8, sd * 2.2, 3.4, 0.8, 0.5, 0.9, 0, CC.lbWhite);
    this.blob(6.4, 0, 1.9, 1.2, 1, 1.7, 0, CC.lbBlack, true);
  }
  caterpillar(t, thrash, dead) {
    const N = 10, gap = 3.1, amp = thrash ? 3.2 : 1.1;
    for (let k = N - 1; k >= 0; k--) {
      const lx = -k * gap, ly = dead ? Math.sin(k * 0.6) * 1.5 : Math.sin(t * (thrash ? 8 : 2.2) - k * 0.75) * amp * (0.4 + k / N);
      const r = k === 0 ? 3.7 : 3.4 - (k > 6 ? (k - 6) * 0.3 : 0), hump = dead ? 0 : Math.max(0, Math.sin(t * 2.2 - k * 0.75)) * 0.8;
      if (k === 0) {
        this.blob(lx, ly, r * 0.85, r, r * 0.85, r, 0, dead ? CC.deadDark : CC.catHead);
        for (const sd of [-1, 1]) this.blob(lx + r * 0.55, ly + sd * r * 0.45, r * 1.2, 0.6, 0.5, 0.6, 0, CC.catEye);
        continue;
      }
      this.blob(lx, ly, r * 0.85 + hump, r, r * 0.88, r, 0, dead ? (k & 1 ? CC.catDeadA : CC.catDeadB) : (k & 1 ? CC.catA : CC.catB));
      if (!dead) this.blob(lx, ly, r * 1.68 + hump, 0.9, 0.35, 0.9, 0, k % 2 ? CC.catDotY : CC.catDotD);
    }
  }
  centipede(t, dead) {
    const CN = 15, body = dead ? CC.cenDeadBody : CC.cenBody, dark = dead ? CC.cenDeadDark : CC.cenDark, leg = dead ? CC.cenDeadLeg : CC.cenLeg, P = [];
    for (let k = 0; k < CN; k++) P.push([9 - k * 1.85, dead ? Math.sin(k * 0.7) * 1.2 : Math.sin(t * 6 - k * 0.55) * 1.6 * (k / CN + 0.3)]);
    for (let k = 1; k < CN; k++) for (const sd of [-1, 1]) {
      const [sx, sy] = P[k], sw = dead ? 0.6 : Math.sin(t * 14 + k * 0.9 + (sd > 0 ? Math.PI : 0)) * 0.5;
      this.limb(sx, sy + sd * 1.1, 1.3, sx - 0.5 + sw * 0.5, sy + sd * 3, 1.4, 0.26, leg); this.limb(sx - 0.5 + sw * 0.5, sy + sd * 3, 1.4, sx - 1 + sw, sy + sd * 4.2, dead ? 1 : 0.15, 0.22, leg);
    }
    const [tx, ty] = P[CN - 1];
    for (const sd of [-1, 1]) this.limb(tx, ty, 1.3, tx - 4, ty + sd * 2.4, 1, 0.22, leg);
    for (let k = CN - 1; k >= 0; k--) { const [sx, sy] = P[k], w = k === 0 ? 1.9 : 1.6 - k * 0.02; this.blob(sx, sy, 1.4, 1.2, 1, w, 0, k === 0 ? dark : body, true); }
    const [hx, hy] = P[0];
    for (const sd of [-1, 1]) {
      const wv = dead ? 0 : Math.sin(t * 4 + sd) * 0.4;
      this.limb(hx + 1, hy + sd * 0.8, 1.8, hx + 5, hy + sd * (2.5 + wv), 2.8, 0.24, dark); this.limb(hx + 5, hy + sd * (2.5 + wv), 2.8, hx + 8.5, hy + sd * (4 + wv), 2.2, 0.2, dark);
      this.limb(hx + 0.8, hy + sd * 1.1, 1.3, hx + 2.8, hy + sd * 1.8, 1.2, 0.35, dark); this.limb(hx + 2.8, hy + sd * 1.8, 1.2, hx + 3, hy + sd * 0.4, 1, 0.3, dark);
    }
  }
  assassin(t, dead, still, stab) {
    const body = dead ? CC.asDeadBody : CC.asBody, rim = dead ? CC.asDeadRim : CC.asRim, dark = dead ? CC.asDeadDark : CC.asDark;
    for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) {
      const sw = dead || still ? 0 : Math.sin(t * 7 + k * 2 + (sd > 0 ? Math.PI : 0)) * 0.25;
      const bx = 2 - k * 2.2, ang = sd * (Math.PI / 2 + (k - 1) * -0.7 + sw), L1 = dead ? 3.5 : 5.5, L2 = dead ? 3.5 : 6;
      const kx = bx + Math.cos(ang) * L1, ky = sd * 1.5 + Math.sin(ang) * L1, fx = kx + Math.cos(ang - sd * 0.5 * (k - 1)) * L2, fy = ky + Math.sin(ang - sd * 0.5 * (k - 1)) * L2;
      this.limb(bx, sd * 1.5, 3, kx, ky, dead ? 4 : 5.5, 0.4, dark); this.limb(kx, ky, dead ? 4 : 5.5, fx, fy, dead ? 4.5 : 0.2, 0.32, dark);
    }
    this.blob(-3, 0, 2.8, 5.4, 1.5, 3.3, 0, rim);
    this.blob(-3, 0, 3.4, 4.9, 1.5, 2.5, 0, body, true);
    this.blob(2.6, 0, 3.4, 2.4, 1.7, 2, 0, body, true);
    this.blob(5.6, 0, 3.8, 1.6, 0.9, 0.9, 0, dark, true);
    for (const sd of [-1, 1]) { this.limb(6.6, sd * 0.4, 4.2, 9, sd * 2.2, 5.6, 0.22, dark); this.limb(9, sd * 2.2, 5.6, 11.5, sd * 3.6, 5.2, 0.18, dark); }
    if (stab) this.limb(6.8, 0, 3.6, 10, 0, 2.6, 0.28, CC.eye); else this.limb(6.6, 0.3, 3.4, 5.4, 1.3, 2.4, 0.28, CC.eye);
  }
  mantis(t, dead, still, strike, wings) {
    const body = dead ? CC.maDeadBody : CC.maBody, dark = dead ? CC.maDeadDark : CC.maDark, light = dead ? CC.maDeadBody : CC.maLight;
    for (const [bx, sw0] of [[-1, 0], [-3, 1]]) for (const sd of [-1, 1]) {
      const sw = dead || still ? 0 : Math.sin(t * 6 + sw0 * 2 + (sd > 0 ? Math.PI : 0)) * 0.2, ang = sd * (Math.PI / 2 + 0.5 + sw0 * 0.4 + sw);
      const kx = bx + Math.cos(ang) * 6, ky = sd * 0.8 + Math.sin(ang) * 6, fx = kx + Math.cos(ang + sd * 0.5) * 6, fy = ky + Math.sin(ang + sd * 0.5) * 6;
      this.limb(bx, sd * 0.8, 4.4, kx, ky, dead ? 4 : 7.5, 0.4, dark); this.limb(kx, ky, dead ? 4 : 7.5, fx, fy, dead ? 3 : 0.2, 0.32, dark);
    }
    this.blob(-7.5, 0, 4.6, 6.6, 2, 2.4, 0, light);
    if (wings) for (const sd of [-1, 1]) this.wing(-5, sd * 5, 6.2, 8, 3.6, sd * 0.35);
    this.limb(-1.5, 0, 4.6, 6.6, 0, dead ? 5 : 8.4, 1.05, body);
    const reach = !dead && strike ? 7 + Math.abs(Math.sin(t * 12)) * 2 : 2.5;
    for (const sd of [-1, 1]) {
      const kx = 5 + reach * 0.6, ky = sd * (strike ? 2.8 : 2), fx = kx + (strike ? reach : 1.5), fy = sd * (strike ? 1.2 : 0.5);
      this.limb(6.2, sd * 0.6, 7.8, kx, ky, strike ? 8.8 : 9.6, 0.55, body); this.limb(kx, ky, strike ? 8.8 : 9.6, fx, fy, strike ? 6 : 7.2, 0.45, body);
    }
    this.blob(8.8, 0, dead ? 5.2 : 8.8, 1.8, 1.2, 2, 0, body);
    if (!dead) for (const sd of [-1, 1]) this.blob(8.3, sd * 1.8, 9.2, 0.85, 0.85, 0.85, 0, CC.maEye, true);
    for (const sd of [-1, 1]) { this.limb(10, sd * 0.4, dead ? 5.4 : 9.2, 13, sd * 2.5, dead ? 5 : 11, 0.18, dark); this.limb(13, sd * 2.5, dead ? 5 : 11, 15.5, sd * 4.5, dead ? 4.6 : 11.4, 0.15, dark); }
  }
  antlion(dead) {
    const body = dead ? CC.alDeadBody : CC.alBody, dark = dead ? CC.alDeadDark : CC.alDark;
    this.blob(-1.2, 0, 2.6, 4.4, 2.8, 3.6, 0, body);
    this.blob(3.2, 0, 1.8, 1.8, 1.3, 1.6, 0, dark);
    for (const sd of [-1, 1]) { this.limb(4.4, sd * 0.6, 1.8, 6.5, sd * 1.6, 1.8, 0.38, dark); this.limb(6.5, sd * 1.6, 1.8, 8.4, sd * 0.4, 1.6, 0.32, dark); }
  }
  moth() {
    for (const sd of [-1, 1]) { this.blob(-2.5, sd * 6.5, 1.1, 6.5, 0.3, 6, sd * 0.35, CC.mothWing); this.blob(-3, sd * 6, 1.5, 2, 0.2, 1.4, 0, CC.mothSpot); }
    this.blob(-1, 0, 1.6, 6, 1.5, 1.8, 0, CC.mothBody);
    for (const sd of [-1, 1]) this.limb(4, sd * 0.6, 1.8, 8, sd * 3, 2.6, 0.25, CC.mothBody);
  }
  cocoon(torn) {
    this.blob(0, 0, 3.6, 9, 4, 4.8, 0, CC.cocoon);
    if (torn) this.blob(3, 0, 6.6, 3.5, 1, 2.2, 0, CC.cocoonTorn);
  }
  eggsac() { this.blob(0, 0, 4, 4.6, 4.2, 4.6, 0, CC.egg); }
  lblarva(t) {
    const wig = Math.sin(t * 0.8) * 0.12;
    for (const sd of [-1, 1]) for (let j = 0; j < 3; j++) this.limb(2.2 - j * 0.9, sd * 0.9, 1, 2.6 - j * 1.1, sd * 2.1, 0.1, 0.18, CC.larvaHead);
    for (let k = 0; k < 5; k++) { const sw = 1.6 - Math.abs(k - 1.5) * 0.25; this.blob(2.6 - k * 1.5, Math.sin(k + wig * 8) * 0.25, 1.1, 1, 0.9, sw, 0, k === 0 ? CC.larvaHead : CC.larva); }
    for (const sd of [-1, 1]) this.blob(0.9, sd * 0.8, 1.9, 0.45, 0.25, 0.45, 0, CC.larvaSpot);
  }
  // the live creatures (2D: world-fx.js and eco-hunters-art.js 'overAnts', skipped in 3D)
  updateCreatures(world, v) {
    const L = world.surface.creatures || [], a = v.alpha || 0, fog = world.fog, t = performance.now() / 1000;
    const big = Math.min(2.2, Math.max(1, 1.15 / (v.z / (v.dpr || 1))));
    for (const cr of L) {
      if (!cr.alive || cr.hidden) continue;
      if (cr.flying && cr.type !== 'mantis') continue;   // flying ladybugs and butterflies stay in the 2D weather layer
      const x = cr.px != null ? cr.px + (cr.x - cr.px) * a : cr.x, y = cr.py != null ? cr.py + (cr.y - cr.py) * a : cr.y;
      if (x < v.x0 - 40 || x > v.x1 + 40 || y < v.y0 - 40 || y > v.y1 + 40) continue;
      if (fog && !fog.seenAt(x, y)) continue;
      const k = big * (cr.scale || 1), an = cr.anim || 0;
      switch (cr.type) {
        case 'spider': this.frame(x, y, cr.a, k); this.spider(an * 0.35, false, cr.state === 'stalk' || cr.state === 'hunt'); break;
        case 'beetle': this.frame(x, y, cr.a, big * 0.95); this.beetle(an * 0.5, false); break;
        case 'ladybug': this.frame(x, y, cr.a, Math.max(1, big * 0.9)); this.ladybug(t, false); break;
        case 'caterpillar': this.frame(x, y, cr.a, big * 0.95); this.caterpillar(an, cr.state === 'thrash', false); break;
        case 'lblarva': this.frame(x, y, cr.a, big); this.lblarva(an); break;
        case 'eggsac': this.frame(x, y, 0, 1); this.eggsac(); break;
        case 'centipede': this.frame(x, y, cr.a, k); this.centipede(an * 0.3, false); break;
        case 'assassin': this.frame(x, y, cr.a, k * 1.05); this.assassin(an * 0.4, false, cr.state === 'wait', cr.state === 'bite' || cr.state === 'feed'); break;
        case 'mantis': this.frame(x, y, cr.a, k * (cr.flying ? 1.1 : 1)); if (cr.flying) this._c.h0 += 14; this.mantis(t, false, cr.state === 'perch', cr.state === 'bite', !!cr.flying); break;
      }
    }
  }

  // F8: a gallery of every 3D model, laid out beside your mound (1 creatures, 2 carcasses, 3 ants), slowly turning
  gallery(world) {
    const pg = AL.R3D.gallery, r = this.r, p = world.player, t = performance.now() / 1000, spin = t * 0.5;
    const cx = p.x + 200, cy = p.y - 10, L = this.labels = [];
    r.cam.x = cx; r.cam.y = cy; r.cam.z = pg === 2 ? 4.4 : 2.9;
    const at = (i, cols, dx, dy, rows) => [cx + (i % cols - (cols - 1) / 2) * dx, cy + (((i / cols) | 0) - (rows - 1) / 2) * dy - 8];
    if (pg < 2) {
      const live = [
        ['Wolf spider', () => this.spider(t * 3, false, false)], ['Ground beetle', () => this.beetle(t * 2, false)], ['Ladybug', () => this.ladybug(t, false)],
        ['Caterpillar', () => this.caterpillar(t * 3, false, false)], ['Centipede', () => this.centipede(t * 2, false)], ['Assassin bug', () => this.assassin(t * 2, false, false, false)],
        ['Praying mantis', () => this.mantis(t, false, false, false, false)], ['Mantis, striking', () => this.mantis(t, false, false, true, false)], ['Ladybug larva', () => this.lblarva(t * 5)], ['Spider egg sac', () => this.eggsac()],
      ];
      const dead = [
        ['Dead spider', () => this.spider(0, true)], ['Dead beetle', () => this.beetle(0, true)], ['Dead caterpillar', () => this.caterpillar(0, false, true)], ['Dead ladybug', () => this.ladybug(0, true)], ['Dead centipede', () => this.centipede(0, true)],
        ['Dead assassin bug', () => this.assassin(0, true, true, false)], ['Dead mantis', () => this.mantis(0, true, true, false, false)], ['Dead antlion', () => this.antlion(true)], ['Dead moth', () => this.moth()], ['Torn cocoon', () => this.cocoon(true)],
      ];
      (pg === 0 ? live : dead).forEach(([name, fn], i) => { const [x, y] = at(i, 5, 52, 84, 2); this.frame(x, y, spin + i, 1.1); fn(); L.push({ x, y: y + 30, text: name }); });
      return;
    }
    if (pg === 5 && AL.R3D.bridgePreview) {   // ant bridges (render3d-yard.js), a stream off to the side of your mound
      const sx = p.x + 330, sy = p.y + 20;
      r.cam.x = sx; r.cam.y = sy; r.cam.z = 3.1;
      AL.R3D.bridgePreview(this, world, sx, sy, L, t);
      return;
    }
    if (pg === 4 && AL.R3D.showcase) {   // the yard models (render3d-yard.js), off to the side of your mound
      const sx = p.x + 360, sy = p.y;
      r.cam.x = sx; r.cam.y = sy; r.cam.z = 1.15;
      AL.R3D.showcase(this, world, sx, sy, L, t);
      return;
    }
    if (pg === 3) {   // every species: worker on top, soldier in the middle, major below
      const keys = Object.keys(AL.SPECIES || {}).filter(k => AL.SPECIES[k] && AL.SPECIES[k].body), FR4 = [0, 1, 0, 2];
      r.cam.z = 3.0;
      keys.forEach((key, i) => {
        const sp = AL.SPECIES[key], cols = SPEC_COLS[key] || (SPEC_COLS[key] = Object.assign({}, sp, { look: sp.look || key }));
        [C.WORKER, C.SOLDIER, C.MAJOR].forEach((ca, row) => {
          const x = cx + (i - (keys.length - 1) / 2) * 30, y = cy + (row - 1) * 46 - 10, pal = palOf(this, cols, ca), s = AL.CASTES[ca].size * (sp.size || 1), a = -Math.PI / 2 + Math.sin(spin + i) * 0.4;
          pal.group.put(x, this.heightAt(x, y), y, Math.cos(a), Math.sin(a), s, FR4[((t * 8) | 0) & 3], pal);
        });
        L.push({ x: cx + (i - (keys.length - 1) / 2) * 30, y: cy + 68, text: (sp.name || key).replace(/ ants$/, '') });
      });
      return;
    }
    const cc = world.colonies[world.me || 0], rv = world.colonies.find(c => c && c !== cc) || cc;
    const show = [[cc, 0], [cc, 1], [cc, 2], [cc, 3], [cc, 4], [cc, 5], [cc, 6], [cc, 7], [cc, 8], [cc, 9], [rv, 0], [rv, 3], [rv, 4], [rv, 7], [cc, -1]];
    const FR = [0, 1, 0, 2];
    show.forEach(([c, k], i) => {
      const [x, y] = at(i, 5, 34, 44, 3), dead = k < 0, ca = dead ? 0 : k, pal = palOf(this, c.colours || c.sp, ca);
      const s = AL.CASTES[ca].size * (c.sp.size || 1), a = spin + i;
      pal.group.put(x, dead ? -0.75 * s : 0, y, Math.cos(a), Math.sin(a), s, dead ? 3 : FR[((t * 8) | 0) & 3], dead ? deadPal(pal) : pal);
      L.push({ x, y: y + 17, text: dead ? 'Dead ant' : (c === rv ? 'Rival ' : '') + AL.CASTES[ca].name });
    });
    if (rv === cc) L.length = 10;
  }

  // ---- tilted view -------------------------------------------------------------------------------------------
  // the camera for a 2D camera (x, y, zoom): same scale as top-down at the screen's centre, leaning back; returns
  // the ground rect the screen can see (where its corners meet the ground)
  setTilt(cam) {
    const r = this.r, S = r.world.surface, z = cam.z * r.dpr, vh = r.h / z, D = (vh / 2) / TAN;
    const t = TILT_FAR + (TILT_NEAR - TILT_FAR) * AL.clamp((cam.z - 0.3) / 2.7, 0, 1);
    const h0 = this.moundList ? this.heightAt(cam.x, cam.y) : this.T(cam.x, cam.y), c3 = this.cam;
    c3.aspect = r.w / r.h; c3.near = Math.max(0.5, D * 0.12); c3.far = D * 7;
    c3.position.set(cam.x, h0 + D * Math.cos(t), cam.y + D * Math.sin(t)); c3.lookAt(cam.x, h0, cam.y);
    c3.updateProjectionMatrix(); c3.updateMatrixWorld();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1]]) {
      const p = this.rayGround(nx, ny, h0, D * 5);
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const m = 60;
    x0 = Math.max(-200, x0 - m); y0 = Math.max(-200, y0 - m); x1 = Math.min(S.W + 200, x1 + m); y1 = Math.min(S.H + 200, y1 + m);
    this.tilt = { x0, y0, x1, y1, D, t, h0 };
    return this.tilt;
  }
  // where a screen point (NDC) meets the ground at height h (at most far away)
  rayGround(nx, ny, h, far) {
    const c3 = this.cam, v = _tv.set(nx, ny, 0.5).unproject(c3).sub(c3.position).normalize();
    let d = v.y < -1e-3 ? (h - c3.position.y) / v.y : far;
    if (d > far || d < 0) d = far;
    return { x: c3.position.x + v.x * d, y: c3.position.z + v.z * d };
  }
  // a screen pixel -> world point on the (rolling) ground
  pick(px, py) {
    const r = this.r, nx = px / r.w * 2 - 1, ny = 1 - py / r.h * 2, far = (this.tilt ? this.tilt.D : 1000) * 8;
    let h = this.tilt ? this.tilt.h0 : 0, p = null;
    for (let k = 0; k < 3; k++) { p = this.rayGround(nx, ny, h, far); h = this.heightAt(p.x, p.y); }
    return p;
  }
  // world -> screen pixel (tilted view)
  project(x, y, h) { const v = _tv.set(x, h == null ? this.heightAt(x, y) : h, y).project(this.cam), r = this.r; return { x: (v.x + 1) / 2 * r.w, y: (1 - v.y) / 2 * r.h }; }
  // the two offscreen 2D canvases (sized to the screen, within the pixel budget)
  tiltBufs() {
    const r = this.r;
    let cw = Math.ceil(r.w * 1.5), ch = Math.ceil(r.h * 2.2);
    const f = Math.min(1, Math.sqrt(TILT_PX / (cw * ch))); cw = Math.max(64, Math.floor(cw * f)); ch = Math.max(64, Math.floor(ch * f));
    let B = this.tb;
    if (!B || B.cw !== cw || B.ch !== ch) {
      if (B) { B.ut.dispose(); B.ot.dispose(); }
      const u = document.createElement('canvas'), o = document.createElement('canvas'); u.width = cw; u.height = ch;
      o.width = Math.ceil(cw * TILT_OVER); o.height = Math.ceil(ch * TILT_OVER);   // (overlays: a lighter canvas)
      const tex = cv => { const t = new THREE.CanvasTexture(cv); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; return t; };
      B = this.tb = { cw, ch, u, o, uc: u.getContext('2d', { alpha: false }), oc: o.getContext('2d'), ut: tex(u), ot: tex(o) };
      this.groundMat.map = B.ut; this.overMat.map = B.ot; this.groundMat.needsUpdate = this.overMat.needsUpdate = true;
    }
    return B;
  }
  // the painted canvases go up; their textures map world units onto the part of the canvas that was drawn
  tiltUpload(R, k, under) {
    const B = this.tb;
    for (const t of under ? [B.ut, B.ot] : [B.ot]) { t.repeat.set(k / B.cw, k / B.ch); t.offset.set(-R.x0 * k / B.cw, -R.y0 * k / B.ch); t.needsUpdate = true; }
  }

  render(cam, view, alpha, defer) {
    const r = this.r, world = r.world, S = world.surface;
    if (this.world !== world) this.setWorld(world);
    const tilted = !!(defer && this.tilt);
    if (!tilted) this.resize();   // (tilted: sized by drawTilted, before the 2D passes borrow the renderer's size)
    if (!tilted) this.tilt = null;
    if (this.ground3d) this.ground3d.visible = this.over3d.visible = tilted;
    this.depth.visible = !tilted;
    this.governor();
    const shq = AL.R3D.shadows;   // settings: shadow quality
    if (shq !== this._shq) {
      this._shq = shq; const n = shq === 'low' ? 1536 : 4096;
      this.sun.castShadow = shq !== 'off'; this.sun.shadow.mapSize.set(n, n);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    const vw = view.x1 - view.x0, vh = view.y1 - view.y0, cx = tilted ? (view.x0 + view.x1) / 2 : cam.x, cy = tilted ? (view.y0 + view.y1) / 2 : cam.y;
    if (!tilted) {
      // camera straight down, lens fitted so the ground plane matches the 2D view rect exactly
      const D = (vh / 2) / TAN, c3 = this.cam;
      c3.aspect = r.w / r.h; c3.near = Math.max(0.5, D * 0.4); c3.far = D + 30;
      c3.position.set(cx, D, cy); c3.lookAt(cx, 0, cy); c3.updateProjectionMatrix();
    }
    this.depth.position.set(cx, 0, cy); this.depth.scale.set(vw * 1.2, 1, vh * 1.2);
    this.shadowPlane.position.set(cx, tilted ? 0.25 : 0.01, cy); this.shadowPlane.scale.set(vw * 1.2, 1, vh * 1.2);
    // sun and its shadow box follow the view
    const half = Math.max(vw, vh) * 0.62 + 60, sun = this.sun, sc = sun.shadow.camera;
    sun.target.position.set(cx, 0, cy); sun.position.set(cx + LIGHT_DIR.x * half * 2, LIGHT_DIR.y * half * 2, cy + LIGHT_DIR.z * half * 2);
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = half * 4 + 200; sc.updateProjectionMatrix();
    sun.shadow.radius = view.z > 2 ? 3 : 1.5;
    const t0 = performance.now();
    this.updateFlowers(S);
    this.updateMounds(world);
    for (const g of this.groups.values()) g.begin();
    this.carried.begin(); this.cBegin();
    this.updateAnts(world, alpha, view, view.z, view.ox, view.oy);
    this.updateFoods(world, view);
    this.updateCreatures(world, view);
    // add-on models (render3d-yard.js: mower, sprinklers, shoes, robin, flyers, termite mounds, bivouacs...)
    const tx = performance.now() / 1000;
    for (const x of AL.R3D.extras) {
      try { if (!this._xi) this._xi = new Set(); if (!this._xi.has(x)) { this._xi.add(x); x.init(this); } x.update(this, world, view, tx); }
      catch (e) { if (!x._warned) { x._warned = true; console.error('[Antlands 3D] ' + (x.id || 'extra'), e); } }
    }
    this.labels = null;
    if (AL.R3D.gallery != null) this.gallery(world);
    const shadow = (tilted ? cam.z * r.dpr : view.z) >= 1.1;
    for (const g of this.groups.values()) g.end(shadow);
    this.carried.end(); this.carried.mesh.castShadow = shadow; this.cEnd();
    const t1 = performance.now(), M = this.ms || (this.ms = { prep: 0, gl: 0, comp: 0, gpu: 0 });
    M.prep = M.prep * 0.9 + (t1 - t0) * 0.1; this._t0 = t0;
    if (defer) return;   // (tilted: the overlay canvas is painted first, then glRender)
    this.glRender();
  }
  glRender() {
    const t1 = performance.now(), t0 = this._t0 || t1, M = this.ms;
    this.gl.render(this.scene, this.cam);
    const t2 = performance.now();
    M.gl = M.gl * 0.9 + (t2 - t1) * 0.1;
    // the slowest 3D frame this second (spikes are what you feel as stutter)
    const tot = t2 - t0; if (tot > (M.maxNow || 0)) M.maxNow = tot;
    if (t2 - (M.since || 0) > 1000) { M.spike = M.maxNow || 0; M.maxNow = 0; M.since = t2; }
  }
}
const ANT_SCALE = 11;   // (the model is built at worker size; caste and species sizes scale it, as with the sprites)

// ---- hooks into the Antlands renderer -------------------------------------------------------------------------
function r3dOf(r) {
  if (r.r3d !== undefined) return r.r3d;
  r.r3d = null;
  if (!(AL.Game && AL.Game.renderer === r)) return null;
  try { r.r3d = new R3D(r); }
  catch (e) { console.error('[Antlands 3D] WebGL unavailable, using 2D', e); r.r3d = null; }
  return r.r3d;
}
// 2D foods drawn on the ground (everything that stays flat)
P.drawFoods2D = function (ctx, v) {
  const S = this.world.surface;
  for (const f of S.foods) {
    if (f.gone || (f.spring && f.amount < 1)) continue;
    if (is3DFood(f)) continue;
    const m = (f.r || 8) + 40;
    if (f.x + m < v.x0 || f.x - m > v.x1 || f.y + m < v.y0 || f.y - m > v.y1) continue;
    const frac = f.max ? AL.clamp(f.amount / f.max, 0, 1) : 1;
    const custom = Art.foodDrawers[f.visual];
    if (custom) { ctx.save(); try { custom(ctx, f, frac, this); } catch (e) { console.error(e); } ctx.restore(); continue; }
    switch (f.visual) {
      case 'honeydew': this.drawAphidPlant(ctx, f, frac); break;
      case 'water': this.drawPuddle(ctx, f); break;
      case 'seeds': this.drawSeeds(ctx, f, frac); break;
      case 'leaves': this.drawClover(ctx, f, frac); break;
      case 'corpse': this.drawCorpse(ctx, f); break;
      case 'spider': if (this.drawSpiderBody) this.drawSpiderBody(ctx, f, true); break;
    }
  }
};
// a render layer without some systems (whose drawing the 3D scene has taken over)
P.layerSkip = function (name, ctx, view, skip) {
  const sys = this.world.systems;
  for (let k = 0; k < sys.length; k++) {
    const r = sys[k].render; if (!r || !r[name] || skip.has(sys[k].id)) continue;
    ctx.save();
    try { r[name](ctx, view, this); } catch (e) { if (!this._warned) { console.error('[render ' + sys[k].id + '.' + name + ']', e); this._warned = true; } }
    ctx.restore();
    ctx.setTransform(view.z, 0, 0, view.z, view.ox, view.oy);
  }
};
// siege bars over mounds (the 2D mound drew these; the 3D mound can't)
P.drawSieges = function (ctx) {
  const world = this.world;
  for (const c of world.colonies) {
    if (!c || c.sp.nomad || !c.sieging || !c.siegeLog || !c.alive) continue;
    if (world.fog && c.id !== AL.me() && !world.fog.seenAt(c.x, c.y)) continue;
    const w = 90, x = c.x - w / 2, y = c.y - c.moundR - 30, a = c.siegeLog.att, d = c.siegeLog.def, tot = Math.max(1, a + d);
    ctx.fillStyle = 'rgba(20,12,6,0.75)'; ctx.fillRect(x - 3, y - 3, w + 6, 20);
    ctx.fillStyle = '#d9473a'; ctx.fillRect(x, y, w * d / tot, 6);
    ctx.fillStyle = '#e8b04a'; ctx.fillRect(x + w * d / tot, y, w * a / tot, 6);
    ctx.fillStyle = '#5a1a12'; ctx.fillRect(x, y + 9, w, 5);
    ctx.fillStyle = '#ff6a4a'; ctx.fillRect(x, y + 9, w * c.queen.hp / c.queen.maxHp, 5);
    ctx.font = '600 9px system-ui'; ctx.fillStyle = '#f4ead6'; ctx.textAlign = 'center';
    ctx.fillText('Siege: ' + Math.round(a) + ' of yours vs ' + Math.round(d) + ' defenders', c.x, y - 6);
  }
};
const _tv = new THREE.Vector3();
// a canvas context that draws nothing (the under sheet's skipped frames: layers still run their per-frame logic)
const nullCtx = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; return c.getContext('2d'); })();
// the tilted surface: every 2D layer is painted (as if top-down) onto two offscreen canvases covering the ground the
// leaning camera sees, which lie on the 3D ground as textures: 'under' below the models, 'over' (particles, fog,
// day/night, orders, health bars...) drawn over them. The screen layer still draws on the screen.
function drawTilted(ctx, cam, alpha, r3) {
  const world = this.world, S = world.surface;
  if (r3.world !== world) r3.setWorld(world);
  r3.resize();
  const R = r3.setTilt(cam), B = r3.tiltBufs();
  const k = Math.min(B.cw / (R.x1 - R.x0), B.ch / (R.y1 - R.y0), cam.z * this.dpr * 1.6);
  const W0 = this.w, H0 = this.h, D0 = this.dpr;
  const c2 = { x: R.x0 + B.cw / (2 * k), y: R.y0 + B.ch / (2 * k), z: k };
  const z = k, ox = -R.x0 * k, oy = -R.y0 * k;
  let view, redrawUnder = true;
  this.w = B.cw; this.h = B.ch; this.dpr = 1;
  try {
    const v = this.viewRect(c2, 0);
    world.view = this.viewRect(c2, 80);
    view = Object.assign(v, { z, ox, oy, w: B.cw, h: B.ch, dpr: 1, cam: c2, alpha, scene: 'surface', frame: this.frame });
    this.lastView = view;
    // 1. under the models (when the camera holds still, every other frame: the ground sheet is the big upload)
    const key = cam.x + ',' + cam.y + ',' + cam.z + ',' + B.cw + ',' + B.ch;
    redrawUnder = key !== r3._ukey || (this.frame & 1) === 0; r3._ukey = key;
    const u = redrawUnder ? B.uc : nullCtx; u.setTransform(1, 0, 0, 1, 0, 0); u.globalAlpha = 1; u.fillStyle = '#2a2414'; u.fillRect(0, 0, B.cw, B.ch);
    this.drawGround(u, c2, v, z, ox, oy);
    u.setTransform(z, 0, 0, z, ox, oy);
    this.layer('ground', u, view);
    this.drawTreeShade(u, 0.5);
    if (this.showTrails) this.drawTrails(u, S);
    this.drawFoods2D(u, v);
    for (const c of world.colonies) {
      if (!c || !c.sp.nomad || (world.fog && c.id !== AL.me() && !world.fog.seenAt(c.x, c.y))) continue;
      const n = Math.min(140, 30 + (c.pop[0] + c.pop[1]) * 0.5 | 0), rr = 18 + Math.sqrt(n) * 3.2;
      u.fillStyle = 'rgba(20,10,4,0.35)'; u.beginPath(); u.ellipse(c.x + 4, c.y + 6, rr * 1.05, rr * 0.95, 0, 0, TAU); u.fill();
    }
    this.layer('underAnts', u, view);
    // 2. the models (instances and health bars; drawn after the overlay is painted)
    const zo = z * TILT_OVER, vo = Object.assign({}, view, { z: zo, ox: ox * TILT_OVER, oy: oy * TILT_OVER, w: B.o.width, h: B.o.height });
    this.barBegin(cam.z * D0 < 0.8);
    AL.R3D.drawing = true;
    r3.render(cam, vo, alpha, true);   // (health bars land in the overlay canvas)
    // 3. over the models
    this.lastView = vo;
    const o = B.oc; o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1; o.clearRect(0, 0, B.o.width, B.o.height);
    o.setTransform(zo, 0, 0, zo, vo.ox, vo.oy);
    this.drawParticles(o, zo);
    this.layerSkip('overAnts', o, vo, SKIP_OVER);
    this.drawSieges(o);
    this.drawTreeShade(o, 1);
    if (this.showTrails) this.drawTrailGlow(o, S);
    this.drawOrders(o, vo);
    if (world.fog && AL.R3D.gallery !== 4 && AL.R3D.gallery !== 5) this.drawFog(o, vo);
    this.layer('fog', o, vo);
    o.setTransform(1, 0, 0, 1, 0, 0);
    if (this.drawBars) this.drawBars(o, vo);
  } finally { this.w = W0; this.h = H0; this.dpr = D0; }
  r3.tiltUpload(R, k, redrawUnder);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#17110a'; ctx.fillRect(0, 0, this.w, this.h);
  const tc = performance.now();
  r3.glRender();
  ctx.drawImage(r3.cv, 0, 0);
  r3.ms.comp = r3.ms.comp * 0.9 + (performance.now() - tc) * 0.1;
  // what screen-space code reads as the view: a flat stand-in that is right at the screen's centre
  const pc = r3.project(cam.x, cam.y, R.h0), pr = r3.project(cam.x + 10, cam.y, R.h0), zc = Math.max(0.01, (pr.x - pc.x) / 10);
  this.lastView = { x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1, z: zc, ox: pc.x - cam.x * zc, oy: pc.y - cam.y * zc, w: this.w, h: this.h, dpr: this.dpr, cam, alpha, scene: 'surface', frame: this.frame, tilted: true };
  world.view = { x0: R.x0 - 80, y0: R.y0 - 80, x1: R.x1 + 80, y1: R.y1 + 80 };
  // weather and the day/night grade work on the finished picture (blend modes), so they go on the screen
  const sv = this.lastView;
  ctx.setTransform(sv.z, 0, 0, sv.z, sv.ox, sv.oy);
  this.layer('weather', ctx, sv);
  this.layer('grade', ctx, sv);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  this.layer('screen', ctx, Object.assign({}, this.lastView, { z: 1, ox: 0, oy: 0 }));
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  AL.R3D.drawing = false;
}
// clicks in the tilted view: where the pointer meets the ground
const baseScreenToWorld = P.screenToWorld;
P.screenToWorld = function (sx, sy, cam) {
  const r3 = this.r3d;
  if (!r3 || !r3.tilt || !AL.R3D.enabled || !AL.R3D.tilt || this.view === 'nest' || (cam && cam !== this.cam)) return baseScreenToWorld.call(this, sx, sy, cam);
  return r3.pick(sx * this.dpr, sy * this.dpr);
};
const baseDrawSurface = P.drawSurface;
P.drawSurface = function (ctx, cam, alpha, opacity) {
  const r3 = AL.R3D.enabled ? r3dOf(this) : null;
  AL.R3D.drawing = false;
  AL.R3D.active = !!r3;   // (the whole 3D frame: 2D drawers of things modelled in 3D, e.g. the blanket, stand down)
  if (!r3) return baseDrawSurface.call(this, ctx, cam, alpha, opacity);
  if (AL.R3D.tilt && AL.R3D.gallery == null) {
    try { return drawTilted.call(this, ctx, cam, alpha, r3); }
    catch (e) { console.error('[Antlands 3D] tilted view', e); AL.R3D.tilt = false; r3.tilt = null; }
  }
  const world = this.world, S = world.surface, z = cam.z * this.dpr;
  const ox = this.w / 2 - cam.x * z, oy = this.h / 2 - cam.y * z;
  const v = this.viewRect(cam, 0);
  world.view = this.viewRect(cam, 80);
  const view = Object.assign(v, { z, ox, oy, w: this.w, h: this.h, dpr: this.dpr, cam, alpha, scene: 'surface', frame: this.frame });
  this.lastView = view;
  ctx.globalAlpha = opacity;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 1. flat things on the ground (2D)
  this.drawGround(ctx, cam, v, z, ox, oy);
  ctx.setTransform(z, 0, 0, z, ox, oy);
  this.layer('ground', ctx, view);
  this.drawTreeShade(ctx, 0.5);
  if (this.showTrails) this.drawTrails(ctx, S);
  this.drawFoods2D(ctx, v);
  // army ants: just the bivouac's shadow here; the heap of clinging ants is 3D (render3d-yard.js)
  for (const c of world.colonies) {
    if (!c || !c.sp.nomad || (world.fog && c.id !== AL.me() && !world.fog.seenAt(c.x, c.y))) continue;
    const n = Math.min(140, 30 + (c.pop[0] + c.pop[1]) * 0.5 | 0), r = 18 + Math.sqrt(n) * 3.2;
    ctx.fillStyle = 'rgba(20,10,4,0.35)'; ctx.beginPath(); ctx.ellipse(c.x + 4, c.y + 6, r * 1.05, r * 0.95, 0, 0, TAU); ctx.fill();
  }
  this.layer('underAnts', ctx, view);
  // 2-3. the 3D scene, composited over the ground (AL.R3D.drawing: 2D drawers whose thing is modelled stand down)
  this.barBegin(z < 0.8);
  AL.R3D.drawing = true;
  try {
    r3.render(cam, view, alpha);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const tc = performance.now();
    ctx.drawImage(r3.cv, 0, 0);
    r3.ms.comp = r3.ms.comp * 0.9 + (performance.now() - tc) * 0.1;
  } catch (e) {
    AL.reportError && AL.reportError(e, '3D draw', world);
    AL.R3D.enabled = false; AL.R3D.drawing = false;   // fall back to the 2D sprites rather than draw nothing
  }
  // 4. everything over the ants (2D)
  ctx.setTransform(z, 0, 0, z, ox, oy);
  this.drawParticles(ctx, z);
  this.layerSkip('overAnts', ctx, view, SKIP_OVER);
  this.drawSieges(ctx);
  if (r3.labels) {   // F8 gallery names
    ctx.font = '600 ' + (11 / z * this.dpr).toFixed(2) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
    for (const l of r3.labels) { ctx.fillStyle = 'rgba(15,10,5,0.7)'; ctx.fillText(l.text, l.x + 0.4 / z, l.y + 0.4 / z); ctx.fillStyle = '#f6ecd6'; ctx.fillText(l.text, l.x, l.y); }
  }
  this.drawTreeShade(ctx, 1);
  this.layer('weather', ctx, view);
  this.layer('grade', ctx, view);
  if (this.showTrails) this.drawTrailGlow(ctx, S);
  this.drawOrders(ctx, view);
  if (world.fog && AL.R3D.gallery !== 4 && AL.R3D.gallery !== 5) this.drawFog(ctx, view);   // (the yard showcase is in the clear)
  this.layer('fog', ctx, view);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (this.drawBars) this.drawBars(ctx, view);
  this.layer('screen', ctx, Object.assign({}, view, { z: 1, ox: 0, oy: 0 }));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  AL.R3D.drawing = false;
};

// a stand-alone ant (title screens): a THREE.Group with the species build and colours; .userData.frame(0|1|2) poses the legs
const MODEL_GEOS = new Map();
function antModel(colours, caste) {
  const look = LOOK_OF(colours), lk = LOOKS[look], key = caste + '|' + look;
  let geos = MODEL_GEOS.get(key);
  if (!geos) { geos = antGeos(caste, look); MODEL_GEOS.set(key, geos); }
  const bodyH = colours.body || '#5a2a14', headH = colours.head || bodyH, gasH = colours.gaster || bodyH;
  const gaster = caste === C.HONEYPOT ? '#e9a93a' : lk && lk.amber ? Art.mix(gasH, '#e0a040', 0.35) : gasH;
  const rough = lk && lk.gloss ? 0.14 : lk && lk.matte ? 0.62 : 0.3;
  const mat = c => new THREE.MeshStandardMaterial({ vertexColors: true, color: col(c), roughness: rough, metalness: 0.08 });
  const g = new THREE.Group(), add = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(geos.body, mat(bodyH)); add(geos.head, mat(headH)); add(geos.gaster, mat(gaster));
  const lm = mat(Art.shade(bodyH, -0.35)), legs = geos.legs.slice(0, 3).map(l => add(l, lm));
  legs.forEach((l, i) => { l.visible = i === 0; });
  if (geos.wings) add(geos.wings, new THREE.MeshStandardMaterial({ color: 0xe6f0ff, transparent: true, opacity: 0.4, roughness: 0.15, depthWrite: false, side: THREE.DoubleSide })).castShadow = false;
  g.userData.frame = f => legs.forEach((l, i) => { l.visible = i === f; });
  return g;
}
const pref = (k, d) => { try { return localStorage.getItem('antlands.' + k) || d; } catch (_) { return d; } };
AL.R3D = { enabled: pref('3d', 'on') !== 'off', tilt: pref('tilt', 'on') !== 'off', shadows: pref('shadows', 'high'), relief: pref('relief', 'on') !== 'off', THREE, gallery: null, antModel, vnoise, LOOKS };
// for add-on modules (render3d-yard.js): the geometry kit and an update hook run every 3D frame
AL.R3D.extras = [];
AL.R3D.hatQ = [];
AL.R3D.drawing = false;
AL.R3D.kit = { THREE, Builder, Pool, M, V, col, SPH, SPH_LO, CYL, WHITE, palOf, deadPal, antGeos, moundY, CARRY_COL, ANT_Y, LOOK_OF, LIGHT_DIR, TAN };
AL.R3D.of = r => r3dOf(r);   // (nest3d.js: the renderer's 3D side, made on first use)
// perf panel (F3): where the 3D frame goes
AL.R3D.stats = () => {
  const g = AL.Game && AL.Game.renderer && AL.Game.renderer.r3d; if (!g || !g.ms) return '3D idle';
  const i = g.gl.info.render, M = g.ms;
  return '3D prep ' + M.prep.toFixed(2) + ' gl ' + M.gl.toFixed(2) + ' copy ' + M.comp.toFixed(2) + ' ms  spike ' + (M.spike || 0).toFixed(1) + '  shadows ' + AL.R3D.shadows + '\ndraws ' + i.calls + ' tris ' + (i.triangles / 1000).toFixed(0) + 'k  ' + g.cv.width + 'x' + g.cv.height;
};
window.addEventListener('keydown', e => {
  if (e.key === 'F8' || e.key === '\\' || e.code === 'Backslash') {   // 3D model gallery: creatures -> carcasses -> ants -> off
    e.preventDefault();
    const g = AL.R3D.gallery;
    AL.R3D.gallery = g == null ? 0 : g < 5 ? g + 1 : null;
    if (AL.UI && AL.UI.toast) AL.UI.toast(AL.R3D.gallery == null ? '3D gallery off [F8]' : '3D gallery: ' + ['creatures', 'carcasses', 'ants', 'species', 'yard', 'ant bridges'][AL.R3D.gallery] + ' [F8]');
    return;
  }
  if (e.key !== 'F7') return;
  e.preventDefault();
  AL.R3D.enabled = !AL.R3D.enabled;
  try { localStorage.setItem('antlands.3d', AL.R3D.enabled ? 'on' : 'off'); } catch (_) { /* private mode */ }
  if (AL.UI && AL.UI.toast) AL.UI.toast(AL.R3D.enabled ? '3D models on [F7]' : 'Classic 2D sprites [F7]');
});
