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
const LOOKS = {
  honeypot:   { gaster: 1.12, leg: 1.12, amber: true },
  harvester:  { head: 1.18, mand: 1.1, beard: true },
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
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(geo, m, color, fn) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]); this.nor.push(n[i], n[i + 1], n[i + 2]);
      const c = fn ? fn(p[i], p[i + 1], p[i + 2], n[i], n[i + 1], n[i + 2]) : color;
      this.col.push(c.r, c.g, c.b);
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
  const gx = -1.2 - 2.3 * sh.gaster, gR = 2.0 * sh.gaster, gL = 2.6 * sh.gaster;
  // thorax + petiole (body colour)
  const body = new Builder()
    .add(SPH, M(thx, H + 0.15, 0, thL * 0.5 + 0.2, thR * 0.6, thR * 0.7), WHITE)
    .add(SPH, M(-0.75, H + 0.05, 0, 0.6, 0.58, 0.5), MID);
  if (sh.mark) body.add(SPH_LO, M(thx, H + 0.15 + thR * 0.55, 0, 0.75, 0.2, 0.6), new THREE.Color(3, 2.6, 1.9));
  if (sh.queen) for (const s of [-1, 1]) body.add(SPH_LO, M(thx - 0.6, H + 0.2 + thR * 0.4, s * thR * 0.6, 0.5, 0.2, 0.3), MID);
  // head (head colour) with black eyes
  const head = new Builder().add(SPH, M(hx, H + 0.25, 0, hR * 1.05, hR * 0.78, hR * 0.95), WHITE);
  for (const s of [-1, 1]) head.add(SPH_LO, M(hx + hR * 0.2, H + 0.25 + hR * 0.25, s * hR * 0.74, 0.38, 0.3, 0.28), DK);
  // gaster (gaster colour), its tip lifted a little; honeypots' swollen crop
  const gas = new Builder().add(SPH, M(gx, H + 0.45, 0, gL, gR * (sh.honey ? 0.9 : 0.78), gR, 0, 0, -0.1), WHITE);
  if (lk && lk.sting) gas.seg(V(gx - gL * 0.92, H + 0.25, 0), V(gx - gL - 1.1, H + 0.05, 0), 0.14, DK);
  // legs, antennae and mandibles (leg colour): one geometry per walk frame (swing 0, +1, -1)
  const legs = [0, 1, -1].map(swing => {
    const b = new Builder(), legBase = [0.95, 1.65, 2.35], legX = [thx + 0.8, thx, thx - 0.8];
    for (let k = 0; k < 3; k++) for (const side of [-1, 1]) {
      const tri = (k === 1) === (side === 1) ? 1 : -1;
      const ang = (legBase[k] + swing * 0.3 * tri) * side, len = (k === 2 ? 4.2 : 3.6) * sh.leg;
      const bx = legX[k], by = side * thR * 0.55;
      const kx = bx + Math.cos(ang - side * 0.35) * len * 0.45, ky = by + Math.sin(ang - side * 0.35) * len * 0.45;
      const fx = kx + Math.cos(ang + side * 0.25) * len * 0.62, fy = ky + Math.sin(ang + side * 0.25) * len * 0.62;
      const lift = swing * tri > 0 ? 0.35 : 0;   // the swinging tripod lifts its feet
      const hip = V(bx, H, by), knee = V(kx, H + 1.05 * sh.leg, ky), foot = V(fx, 0.08 + lift, fy);
      b.seg(hip, knee, 0.24, WHITE).seg(knee, foot, 0.18, WHITE);
    }
    const aL = 2.4 * sh.ant;
    for (const s of [-1, 1]) {
      const sw = swing * 0.08 * s, bx = hx + hR * 0.7, by = s * hR * 0.45;
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
function flush(mesh, n) {
  mesh.count = n;
  if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
}

// one ant shape: 6 meshes (body, head, gaster, 3 leg frames) + wings
class AntGroup {
  constructor(r3, geos) {
    this.r3 = r3; this.cap = 64; this.n = 0; this.nl = [0, 0, 0];
    const S = r3.scene, mat = r3.antMat;
    this.body = mkInst(geos.body, mat, this.cap, S); this.head = mkInst(geos.head, mat, this.cap, S); this.gaster = mkInst(geos.gaster, mat, this.cap, S);
    this.legs = geos.legs.map(g => mkInst(g, mat, this.cap, S));
    this.wings = geos.wings ? mkInst(geos.wings, r3.wingMat, this.cap, S, false) : null;
  }
  grow() {
    const S = this.r3.scene, cap = this.cap * 2;
    this.body = growInst(this.body, cap, S); this.head = growInst(this.head, cap, S); this.gaster = growInst(this.gaster, cap, S);
    this.legs = this.legs.map(m => growInst(m, cap, S));
    if (this.wings) this.wings = growInst(this.wings, cap, S);
    this.cap = cap;
  }
  begin() { this.n = 0; this.nl[0] = this.nl[1] = this.nl[2] = 0; }
  put(x, y, z, ca, sa, s, fr, pal) {
    if (this.n >= this.cap) this.grow();
    const i = this.n++, li = this.nl[fr]++;
    putM(this.body, i, x, y, z, ca, sa, s, s, s); putC(this.body, i, pal.body);
    putM(this.head, i, x, y, z, ca, sa, s, s, s); putC(this.head, i, pal.head);
    putM(this.gaster, i, x, y, z, ca, sa, s, s, s); putC(this.gaster, i, pal.gaster);
    putM(this.legs[fr], li, x, y, z, ca, sa, s, s, s); putC(this.legs[fr], li, pal.leg);
    if (this.wings) { putM(this.wings, i, x, y, z, ca, sa, s, s, s); putC(this.wings, i, WHITE); }
  }
  end(shadow) {
    flush(this.body, this.n); flush(this.head, this.n); flush(this.gaster, this.n);
    for (let k = 0; k < 3; k++) flush(this.legs[k], this.nl[k]);
    if (this.wings) flush(this.wings, this.n);
    this.body.castShadow = this.head.castShadow = this.gaster.castShadow = shadow;
    for (const m of this.legs) m.castShadow = shadow;
  }
}
// a pool of one primitive (food bits, carried crumbs)
class Pool {
  constructor(r3, geo, mat, shadow) { this.r3 = r3; this.cap = 128; this.n = 0; this.mesh = mkInst(geo, mat, this.cap, r3.scene, shadow); }
  begin() { this.n = 0; }
  put(x, y, z, a, sx, sy, sz, c) {
    if (this.n >= this.cap) { this.cap *= 2; this.mesh = growInst(this.mesh, this.cap, this.r3.scene); }
    const i = this.n++; putM(this.mesh, i, x, y, z, Math.cos(a), Math.sin(a), sx, sy, sz); putC(this.mesh, i, c);
  }
  end() { flush(this.mesh, this.n); }
}

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
  cookie: [col('#d8a868'), col('#c99456'), col('#e2b97c')], sugar: [col('#f4ead2'), col('#e9d8a6')], meat: [col('#c86a4a'), col('#a8543a')],
};
const _c = new THREE.Color(), _c2 = new THREE.Color();
const F3D = new Set(['fruit', 'cookie', 'ham', 'grubs', 'beetle', 'bug']);
const F2D = new Set(['water', 'seeds', 'leaves', 'corpse', 'honeydew', 'spider']);
const is3DFood = f => !Art.foodDrawers[f.visual] && (F3D.has(f.visual) || !F2D.has(f.visual));

// mound profile: a low dome with a shallow crater at the entrance (also lifts ants walking over it)
function moundY(d, R) {
  const t = d / (R * 1.05);
  if (t >= 1) return 0;
  let h = R * 0.22 * Math.pow(1 - t * t, 1.6);
  const er = Math.min(10, 5 + R * 0.06) * 1.7;
  if (d < er) { const u = d / er, k = u * u * (3 - 2 * u); h = 0.3 + (h - 0.3) * k; }
  return h;
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
    // materials
    this.antMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.08 });
    this.wingMat = new THREE.MeshStandardMaterial({ color: 0xe6f0ff, transparent: true, opacity: 0.38, roughness: 0.15, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
    this.woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
    this.plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    this.soilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.deadSoilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, color: 0x8a8a8a });
    this.blobMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.02 });
    this.chunkMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true });
    this.groups = new Map();
    this.blobs = new Pool(this, new THREE.SphereGeometry(1, 12, 9), this.blobMat);
    this.chunks = new Pool(this, new THREE.IcosahedronGeometry(1, 0), this.chunkMat);
    this.carried = new Pool(this, new THREE.SphereGeometry(1, 8, 6), this.blobMat);
    this.mounds = new Map(); this.world = null; this.statics = []; this.flowerKey = -1; this.flowerMesh = null;
    this.ok = true;
  }
  group(caste, look) {
    const key = caste + '|' + look;
    let g = this.groups.get(key);
    if (!g) { g = new AntGroup(this, antGeos(caste, look)); this.groups.set(key, g); }
    return g;
  }
  resize() { const r = this.r; if (this.cv.width !== r.w || this.cv.height !== r.h) this.gl.setSize(r.w, r.h, false); }

  // ---- static scenery, rebuilt when the world changes --------------------------------------------------------
  setWorld(world) {
    for (const m of this.statics) { this.scene.remove(m); m.geometry.dispose(); }
    this.statics = [];
    for (const m of this.mounds.values()) { this.scene.remove(m.mesh); m.mesh.geometry.dispose(); }
    this.mounds.clear();
    if (this.flowerMesh) { this.scene.remove(this.flowerMesh); this.flowerMesh.geometry.dispose(); this.flowerMesh = null; }
    this.flowerKey = -1; this.world = world;
    const S = world.surface;
    this.addStatic(this.buildRocks(S), this.rockMat);
    this.addStatic(this.buildLogs(S), this.woodMat);
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
      const h = Math.min(r.rx, r.ry) * 0.62;
      b.add(g, M(r.x, h * 0.12, r.y, r.rx, h, r.ry, 0, -(r.rot || 0), 0), null, (x, y, z, nx, ny) => {
        const n = AL.hash2(Math.round(x * 0.4), Math.round(z * 0.4), seed);
        _c.copy(dark).lerp(mid, AL.clamp(y / h + 0.3, 0, 1)).lerp(light, AL.clamp((ny - 0.55) * 1.6, 0, 1) * 0.7);
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
      b.add(cyl, M(l.x, l.r * 0.72, l.y, l.len, l.r, l.r, 0, -(l.rot || 0), 0), null, (x, y, z, nx, ny, nz) => {
        if (Math.abs(nx * ax + nz * az) > 0.85) return _c.copy(wood).multiplyScalar(0.9 + AL.hash2(Math.round(x), Math.round(z), seed) * 0.2);
        const n = AL.hash2(Math.round((x * az - z * ax) * 0.9), Math.round(y * 0.9), seed);
        _c.copy(bark1).lerp(bark0, n);
        if (ny > 0.55 && AL.hash2(Math.round(x * 0.08), Math.round(z * 0.08), seed + 1) > 0.6) _c.lerp(moss, 0.6);
        return _c;
      });
    }
    return b.build();
  }
  buildFlowers(S) {
    const b = new Builder(), c1 = col('#5f9a3e'), c2 = col('#6aa646'), stem = col('#4f8a34');
    const daisy = col('#f4f1e6'), dand = col('#f2c531'), dCore = col('#e8b923'), yCore = col('#d99a1c');
    for (const f of S.flowers) {
      if (f.cut) continue;
      const s = f.s || 1, rot = f.rot || 0;
      if (f.kind === 'clover') {
        for (let k = 0; k < 3; k++) {
          const a = rot + (k + 1) * TAU / 3;
          b.add(SPH_LO, M(f.x + Math.cos(a) * 4 * s, 1.6 * s, f.y + Math.sin(a) * 4 * s, 4.2 * s, 0.45 * s, 3.4 * s, 0, -a, 0), k ? c1 : c2);
        }
        b.seg(V(f.x, 0, f.y), V(f.x, 1.5 * s, f.y), 0.45 * s, stem);
      } else {
        const top = 4.2 * s, d = f.kind === 'daisy';
        b.seg(V(f.x, 0, f.y), V(f.x, top, f.y), 0.55 * s, stem);
        for (let k = 0; k < 10; k++) {
          const a = rot + (k + 1) * TAU / 10;
          b.add(SPH_LO, M(f.x + Math.cos(a) * 4.2 * s, top + 0.2 * s, f.y + Math.sin(a) * 4.2 * s, 3.4 * s, 0.45 * s, 1.25 * s, 0, -a, 0.12), d ? daisy : dand);
        }
        b.add(SPH_LO, M(f.x, top + 0.5 * s, f.y, 2.2 * s, 1.1 * s, 2.2 * s), d ? dCore : yCore);
      }
    }
    return b.empty ? null : b.build();
  }
  updateFlowers(S) {
    if (this.r.frame % 30 && this.flowerKey >= 0) return;
    let cut = 0; for (const f of S.flowers) if (f.cut) cut++;
    if (cut === this.flowerKey) return;
    this.flowerKey = cut;
    if (this.flowerMesh) { this.scene.remove(this.flowerMesh); this.flowerMesh.geometry.dispose(); this.flowerMesh = null; }
    const g = this.buildFlowers(S);
    if (g) { const m = this.flowerMesh = new THREE.Mesh(g, this.plantMat); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
  }

  // ---- mounds: a soil dome per colony, rebuilt when it grows ---------------------------------------------------
  moundGeo(c, R) {
    const NR = 26, NA = 72, pos = [], cols = [], idx = [];
    const light = col('#b48a5a'), mid = col('#8d6a42'), dark = col('#5e442a'), hole = col('#140b05'), rim = col('#a07a4c');
    const er = Math.min(10, 5 + R * 0.06);
    pos.push(c.x, moundY(0, R), c.y); cols.push(hole.r, hole.g, hole.b);
    for (let i = 1; i <= NR; i++) for (let j = 0; j < NA; j++) {
      const a = j / NA * TAU, t = i / NR, ws = j / NA * 12, w0 = Math.floor(ws), wf = ws - w0, wu = wf * wf * (3 - 2 * wf);
      const wob = 1 + ((AL.hash2(w0 % 12, 5, c.id + 3) * (1 - wu) + AL.hash2((w0 + 1) % 12, 5, c.id + 3) * wu) - 0.5) * 0.16 * t;
      const d = t * R * 1.05 * wob, n = AL.hash2(i * 3 + 1, j * 7 + 2, c.id * 13 + 1);
      let y = moundY(d / wob, R) + (n - 0.5) * 1.1 * t * (1 - t) * 4 * Math.min(1, R / 30);
      if (i === NR) y = 0;
      pos.push(c.x + Math.cos(a) * d, Math.max(0, y), c.y + Math.sin(a) * d);
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
    return h;
  }

  // ---- food that stands up off the ground -----------------------------------------------------------------
  updateFoods(S, v) {
    const B = this.blobs, Ch = this.chunks;
    B.begin(); Ch.begin();
    for (const f of S.foods) {
      if (f.gone || (f.spring && f.amount < 1)) continue;
      const mg = (f.r || 8) + 40;
      if (f.x + mg < v.x0 || f.x - mg > v.x1 || f.y + mg < v.y0 || f.y - mg > v.y1) continue;
      if (!is3DFood(f)) continue;
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
        case 'beetle': {
          const r = f.r, a = f.heading != null ? f.heading + Math.PI : (f.a || 0), ca = Math.cos(a), sa = Math.sin(a);
          B.put(f.x - ca * r * 0.15, r * 0.42, f.y - sa * r * 0.15, a, r * 0.85 * (0.7 + 0.3 * frac), r * 0.48, r * 0.62, FC.beetle);
          B.put(f.x + ca * r * 0.75, r * 0.3, f.y + sa * r * 0.75, a, r * 0.32, r * 0.28, r * 0.36, FC.beetleHead);
          break;
        }
        case 'bug': B.put(f.x, 1.5, f.y, f.a || 0, 4.5, 1.7, 2.6, FC.bug); break;
        default: {
          const R = AL.rng(f.id * 7 + 5), n = Math.ceil(5 * frac + 1), sug = f.kind === K.SUGAR;
          for (let k = 0; k < n; k++) {
            const x = f.x + (R() - 0.5) * f.r * 1.6, y = f.y + (R() - 0.5) * f.r * 1.6, s = 1.6 + R() * 2;
            Ch.put(x, s * 0.4, y, R() * 3, s, s * 0.7, s * 0.8, (sug ? FC.sugar : FC.meat)[k & 1]);
          }
        }
      }
    }
    B.end(); Ch.end();
  }

  // ---- ants ----------------------------------------------------------------------------------------------------
  updateAnts(world, alpha, v, z, ox, oy) {
    const r = this.r, A = world.ants, n = A.high;
    const X = A.x, Y = A.y, PX = A.px, PY = A.py, ANG = A.a, ST = A.state, LY = A.layer, COL = A.col, CA = A.caste, AN = A.anim, CR = A.carry;
    const fog = world.fog, HOST = A.host, CAPT = C.CAPTIVE, ME = world.me || 0, HP = A.hp, MHP = A.maxhp, CS = AL.CASTES, SZ = A.size;
    const cols = world.colonies, x0 = v.x0 - 12, x1 = v.x1 + 12, y0 = v.y0 - 12, y1 = v.y1 + 12;
    const FR = [0, 1, 0, 2], CP = this.carried, hasMounds = this.moundList.length > 0;
    for (const g of this.groups.values()) g.begin();
    CP.begin();
    let drawn = 0;
    for (let i = 0; i < n; i++) {
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
      const h = hasMounds ? this.heightAt(x, y) : 0;
      pal.group.put(x, h, y, ca, sa, s, FR[(AN[i] | 0) & 3], pal);
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
    const shadow = z >= 1.1;
    for (const g of this.groups.values()) g.end(shadow);
    CP.end(); CP.mesh.castShadow = shadow;
    r.stats.drawn = drawn;
  }

  render(cam, view, alpha) {
    const r = this.r, world = r.world, S = world.surface;
    if (this.world !== world) this.setWorld(world);
    this.resize();
    const vw = view.x1 - view.x0, vh = view.y1 - view.y0, cx = cam.x, cy = cam.y;
    // camera straight down, lens fitted so the ground plane matches the 2D view rect exactly
    const D = (vh / 2) / TAN, c3 = this.cam;
    c3.aspect = r.w / r.h; c3.near = Math.max(0.5, D * 0.4); c3.far = D + 30;
    c3.position.set(cx, D, cy); c3.lookAt(cx, 0, cy); c3.updateProjectionMatrix();
    this.depth.position.set(cx, 0, cy); this.depth.scale.set(vw * 1.2, 1, vh * 1.2);
    this.shadowPlane.position.set(cx, 0.01, cy); this.shadowPlane.scale.set(vw * 1.2, 1, vh * 1.2);
    // sun and its shadow box follow the view
    const half = Math.max(vw, vh) * 0.62 + 60, sun = this.sun, sc = sun.shadow.camera;
    sun.target.position.set(cx, 0, cy); sun.position.set(cx + LIGHT_DIR.x * half * 2, LIGHT_DIR.y * half * 2, cy + LIGHT_DIR.z * half * 2);
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = half * 4 + 200; sc.updateProjectionMatrix();
    sun.shadow.radius = view.z > 2 ? 3 : 1.5;
    this.updateFlowers(S);
    this.updateMounds(world);
    this.updateFoods(S, view);
    this.updateAnts(world, alpha, view, view.z, view.ox, view.oy);
    this.gl.render(this.scene, c3);
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
const baseDrawSurface = P.drawSurface;
P.drawSurface = function (ctx, cam, alpha, opacity) {
  const r3 = AL.R3D.enabled ? r3dOf(this) : null;
  if (!r3) return baseDrawSurface.call(this, ctx, cam, alpha, opacity);
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
  for (const c of world.colonies) if (c && c.sp.nomad) this.drawMound(ctx, c, z);
  this.layer('underAnts', ctx, view);
  // 2-3. the 3D scene, composited over the ground
  this.barBegin(z < 0.8);
  try {
    r3.render(cam, view, alpha);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(r3.cv, 0, 0);
  } catch (e) {
    AL.reportError && AL.reportError(e, '3D draw', world);
    AL.R3D.enabled = false;   // fall back to the 2D sprites rather than draw nothing
  }
  // 4. everything over the ants (2D)
  ctx.setTransform(z, 0, 0, z, ox, oy);
  this.drawParticles(ctx, z);
  this.layer('overAnts', ctx, view);
  this.drawSieges(ctx);
  this.drawTreeShade(ctx, 1);
  this.layer('weather', ctx, view);
  this.layer('grade', ctx, view);
  if (this.showTrails) this.drawTrailGlow(ctx, S);
  this.drawOrders(ctx, view);
  if (world.fog) this.drawFog(ctx, view);
  this.layer('fog', ctx, view);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (this.drawBars) this.drawBars(ctx, view);
  this.layer('screen', ctx, Object.assign({}, view, { z: 1, ox: 0, oy: 0 }));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
};

AL.R3D = { enabled: true, THREE };
window.addEventListener('keydown', e => {
  if (e.key !== 'F7') return;
  e.preventDefault();
  AL.R3D.enabled = !AL.R3D.enabled;
  if (AL.UI && AL.UI.toast) AL.UI.toast(AL.R3D.enabled ? '3D models on [F7]' : 'Classic 2D sprites [F7]');
});
