// Antlands 3D: the rest of the yard as Three.js models (render3d.js runs this every 3D frame through AL.R3D.extras).
//   mower (deck, wheels, engine, handle, flying clippings) . sprinkler heads and their arcing jets . the shoe that
//   stomps down . the robin (flapping, fading in for the dive) . flying ladybugs and butterflies . queens and males
//   on their mating flights, and royals waiting on the mound . termite mounds with soldiers on the rim (cracked open
//   when breached) . army-ant bivouacs (a heap of clinging 3D ants) . aphid herds . antlions . cocoons
// While the 3D surface draws, the 2D drawers for these stand down (AL.R3D.drawing); ground marks (shoe and bird
// shadows, warning stripes, webs, pits, puddles, the blanket) stay painted on the ground.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL.R3D, KIT = R3 && R3.kit;
if (KIT) {
const { Builder, Pool, M, V, col, SPH, SPH_LO, palOf } = KIT;
const C = AL.CASTE, TAU = Math.PI * 2, PI = Math.PI, FR = [0, 1, 0, 2];

// 2D drawers that stand down while the 3D surface draws
const WA = AL.WorldArt;
if (WA) for (const k of ['drawMower', 'drawSprinkler', 'drawShoe', 'drawBird', 'drawTermiteMound', 'drawCocoon', 'drawButterfly', 'drawLadybug']) {
  const f = WA[k]; if (typeof f !== 'function') continue;
  WA[k] = function () { if (R3.drawing) return undefined; return f.apply(this, arguments); };
}

const CYL = new THREE.CylinderGeometry(1, 1, 1, 28), WHEEL = new THREE.CylinderGeometry(1, 1, 1, 18).rotateX(PI / 2);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const vmat = o => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.6, metalness: 0.05 }, o));
const mesh = (g, m, shadow) => { const x = new THREE.Mesh(g, m); x.castShadow = shadow !== false; x.receiveShadow = true; x.visible = false; return x; };
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color();
const K = {
  red: col('#c2301e'), red2: col('#e0503a'), blk: col('#1a1a1a'), tyre: col('#242424'), steel: col('#8e8e8e'), dark: col('#3a3a3a'),
  grey: col('#9aa0a6'), grey2: col('#5a6066'), yellow: col('#e8c040'), clip: col('#78b446'), clip2: col('#a8d264'), water: col('#c8e8ff'),
  sole: col('#3a4a62'), upper: col('#8fb4dc'), white: col('#f4f4f4'), upper2: col('#e0503a'),
  robin: col('#5a4030'), robinW: col('#6a4e36'), breast: col('#d8642a'), rhead: col('#2a201a'), beak: col('#e8b830'),
  lbRed: col('#e0321e'), bfly: col('#e8862a'), bfly2: col('#d0701e'), bbody: col('#1a1008'), wing: col('#e6f0ff'),
  term: col('#efe0c0'), termHead: col('#e2c890'), termSol: col('#c4642a'), aphid: col('#c8e68a'),
};

// ---- geometry, built once ------------------------------------------------------------------------------------
function mowerGeo() {
  const PT = AL.POI_TUNE, L = PT.MOWER_LEN, W = PT.MOWER_W, b = new Builder();
  b.add(CYL, M(0, 13, 0, L * 0.52, 18, W * 0.47), K.red);                     // the deck
  b.add(CYL, M(-L * 0.04, 23, 0, L * 0.46, 3, W * 0.42), K.red2);             // its raised top
  b.add(SPH, M(0, 30, 0, 30, 20, 30), K.steel);                                // engine
  b.add(CYL, M(0, 46, 0, 14, 8, 14), K.dark);                                  // engine cap
  b.add(CYL, M(10, 52, 0, 4, 6, 4), K.blk);                                    // filler
  for (const [x, z] of [[-L * 0.38, -W / 2], [L * 0.32, -W / 2], [-L * 0.38, W / 2], [L * 0.32, W / 2]]) {
    b.add(WHEEL, M(x, 13, z, 13, 11, 13), K.tyre); b.add(WHEEL, M(x, 13, z + Math.sign(z) * 5.6, 6, 0.6, 6), K.steel);
  }
  b.add(new THREE.BoxGeometry(1, 1, 1), M(-L * 0.25, 16, W * 0.5 + 10, 30, 14, 22), K.dark);   // side chute
  // handle, trailing behind and up
  const h0 = [V(-L * 0.35, 24, -W * 0.3), V(-L * 0.35, 24, W * 0.3)], h1 = [V(-L * 1.2, 92, -W * 0.22), V(-L * 1.2, 92, W * 0.22)];
  for (let k = 0; k < 2; k++) b.seg(h0[k], h1[k], 3, K.blk);
  b.seg(h1[0], h1[1], 3.4, K.blk); b.seg(V(-L * 1.15, 86, -W * 0.2), V(-L * 1.15, 86, W * 0.2), 2.4, K.dark);
  return b.build();
}
function sprinklerGeos() {
  const head = new Builder().add(CYL, M(0, 1.2, 0, 7.5, 2.4, 7.5), K.grey2).add(SPH, M(0, 2.4, 0, 6.5, 4.2, 6.5), K.grey).add(SPH_LO, M(0, 6.4, 0, 2, 1.2, 2), K.yellow);
  const arm = new Builder(); arm.seg(V(0, 6, 0), V(9.5, 6.8, 0), 1.2, K.dark); arm.add(SPH_LO, M(9.8, 6.9, 0, 1.6, 1.6, 1.6), K.grey2);
  return { head: head.build(), arm: arm.build() };
}
function shoeGeo() {
  const PT = AL.POI_TUNE, L = PT.SHOE_L, Wd = PT.SHOE_W, b = new Builder();
  b.add(SPH, M(L * 0.17, 3.2, 0, L * 0.34, 3.4, Wd / 2), K.sole).add(SPH, M(-L * 0.3, 3.6, 0, L * 0.21, 3.8, Wd / 2 * 0.86), K.sole);
  b.add(new THREE.BoxGeometry(1, 1, 1), M(-L * 0.08, 3.4, 0, L * 0.3, 5.6, Wd * 0.62), K.sole);
  b.add(SPH, M(L * 0.05, 7.5, 0, L * 0.49, 2.2, Wd * 0.56), K.white);        // white midsole
  b.add(SPH, M(L * 0.02, 13, 0, L * 0.46, 13, Wd * 0.5), K.upper);           // the shoe's upper
  b.add(SPH, M(L * 0.3, 10, 0, L * 0.2, 8, Wd * 0.45), K.white);           // toe cap
  b.add(SPH, M(-L * 0.36, 14, 0, L * 0.12, 10, Wd * 0.42), K.upper2);      // heel tab
  b.add(SPH, M(-L * 0.22, 24.5, 0, L * 0.16, 2.5, Wd * 0.3), K.sole);      // ankle opening (into the leg, out of view)
  for (let k = 0; k < 4; k++) b.seg(V(L * 0.02 + k * 7, 22 - k, -Wd * 0.22), V(L * 0.02 + k * 7 + 3, 22 - k, Wd * 0.22), 0.9, K.white);   // laces
  return b.build();
}
// American robin, facing +x: grey-brown back, brick-orange breast, white vent, black head with white eye-rings,
// yellow bill; wings in two jointed parts (arm with coverts and secondaries, hand with fanned primaries); tail fan
const RB = { back: col('#6a5a4c'), back2: col('#54473c'), breast: col('#c8552a'), belly: col('#efe8dc'), head: col('#211c19'),
  bill: col('#e0a82a'), eye: col('#0c0a08'), ring: col('#f2efe8'), cov: col('#76665a'), sec: col('#5c4e43'), prim: col('#3c332c'), tip: col('#8a7a6c'), tail: col('#2e2722') };
const SHOULDER = 5, WRIST = 15;
const sstep = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
// one smooth body: a sphere reshaped along its length (tail stub -> belly -> neck -> round head), plumage blended
// over the surface by position and facing, so there are no seams between parts
function robinBody() {
  const g = new THREE.SphereGeometry(1, 56, 36).rotateZ(-PI / 2), p = g.attributes.position, cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), u = (px + 1) / 2;   // u: 0 tail end .. 1 bill end
    const body = 9.4 * Math.pow(Math.max(0, Math.sin(PI * Math.min(1, u / 0.8))), 0.62), head = 6.4 * Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.855) / 0.135, 2)));
    const k = 0.9, R = Math.log(Math.exp(k * body) + Math.exp(k * head)) / k - Math.log(2) / k * Math.min(1, Math.min(body, head) / 3);
    const cy = 3.2 * sstep(0.55, 0.88, u) - 0.6 * sstep(0.2, 0.5, u) * (1 - sstep(0.6, 0.8, u));
    const x = -22 + u * 44, y = cy + py * R * (py > 0 ? 0.82 : 1), z = pz * R * 1.02;
    p.setXYZ(i, x, y, z);
    // plumage: black head and nape; grey-brown back (darker down the middle); brick-orange breast and flanks; white vent
    const top = py, headW = sstep(0.68, 0.76, u), vent = (1 - sstep(0.2, 0.36, u)) * sstep(0.1, -0.4, top);
    _c.copy(RB.breast).lerp(RB.back, sstep(-0.05, 0.4, top));
    _c.lerp(RB.back2, sstep(0.75, 0.98, top) * 0.8);
    _c.lerp(RB.belly, vent);
    _c.lerp(RB.head, headW);
    if (u > 0.82 && u < 0.95 && Math.abs(pz) > 0.55 && top > 0.05 && top < 0.55) _c.lerp(RB.ring, 0.35);   // pale eye-ring area
    cols.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
  return g;
}
// a flat feathered piece: an outline extruded thin, laid flat (span along +z for side 1, -z for side -1), coloured by
// where on the outline each point is
function slab(shape, side, depth, paint) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.45, bevelSize: 0.5, bevelSegments: 2, curveSegments: 12 });
  g.translate(0, 0, -depth / 2); g.rotateX(side > 0 ? PI / 2 : -PI / 2);
  const ng = g.index ? g.toNonIndexed() : g, p = ng.attributes.position, cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { paint(_c, p.getX(i), Math.abs(p.getZ(i)), p.getY(i)); cols.set([_c.r, _c.g, _c.b], i * 3); }
  ng.setAttribute('color', new THREE.BufferAttribute(cols, 3)); ng.clearGroups(); ng.computeVertexNormals();
  return ng;
}
function armShape() {   // inner wing: rounded leading edge, scalloped secondaries trailing
  const s = new THREE.Shape(); s.moveTo(3, 0); s.quadraticCurveTo(6, 7, 4, 15.5); s.lineTo(-2, 16);
  for (let k = 5; k >= 0; k--) { const y = k * 2.7 + 1.2; s.lineTo(-12.5 + k * 0.15, y + 1.1); s.lineTo(-10.6 + k * 0.15, y - 0.4); }
  s.lineTo(-8, 0); s.closePath(); return s;
}
function handShape() {   // outer wing: swept back to a point, the primaries spread like fingers
  const s = new THREE.Shape(); s.moveTo(4, 0); s.bezierCurveTo(6, 10, 3, 24, -7, 35);
  const tip = k => [-7.5 - k * 1.5, 34.5 - k * 4.6];
  for (let k = 0; k < 7; k++) {
    const [x, y] = tip(k); s.lineTo(x, y);
    if (k < 6) { const [x2, y2] = tip(k + 1); s.lineTo((x + x2) / 2 + 4.2, (y + y2) / 2 + 0.6); }
  }
  s.lineTo(-12, 3); s.lineTo(-10, 0); s.closePath(); return s;
}
function tailShape() {   // a fan, slightly notched at the end, wider than its base
  const s = new THREE.Shape(); s.moveTo(0, -3.2); s.lineTo(-17, -8.5); s.lineTo(-18.2, -4); s.lineTo(-16.6, 0); s.lineTo(-18.2, 4); s.lineTo(-17, 8.5); s.lineTo(0, 3.2); s.closePath(); return s;
}
// butterfly wing (fore + hind as one piece, hinge at the origin, span +z): orange with black borders and veins,
// white spots along the edge
function butterflyWing() {
  const s = new THREE.Shape(); s.moveTo(1, 0.6); s.bezierCurveTo(6, 4, 8, 11, 3.5, 15.5); s.bezierCurveTo(0.5, 15, -2, 12, -1.5, 9.5);
  s.bezierCurveTo(-5, 11.5, -9, 10, -8.5, 6.5); s.bezierCurveTo(-8, 3.5, -4, 1.2, -1, 0.4); s.closePath();
  const org = col('#ffa63a'), org2 = col('#f07e22'), blk = col('#17110b'), wht = col('#fbf8f0');
  return slab(s, 1, 0.25, (c, x, span) => {
    const rim = span > 12.6 || (x < -6.4 && span > 4) || (x > 4.6 && span > 7) || (x < -1 && span > 9.6 && x > -3.4);
    const vein = Math.abs(Math.atan2(span, x + 0.5) * 6 % 1 - 0.5) > 0.44 && span > 3;
    c.copy(org).lerp(org2, Math.min(1, span / 14));
    if (vein) c.copy(blk);
    if (rim) c.copy(AL.hash2(Math.round(x * 1.4) + 40, Math.round(span * 1.4), 9) > 0.72 ? wht : blk);
  });
}
function robinGeos() {
  const body = new Builder(), bg = robinBody();
  // body (sculpted), bill, eyes
  const out = { body: null };
  body.add(CONE, M(25.6, 4.6, 0, 1.55, 7.5, 1.35, 0, 0, -PI / 2), RB.bill);
  for (const s of [-1, 1]) body.add(SPH_LO, M(19.4, 6.3, s * 4.75, 0.95, 0.95, 0.6), RB.eye);
  const extra = body.build(), merged = new THREE.BufferGeometry(), A = [bg.toNonIndexed(), extra];
  for (const name of ['position', 'normal', 'color']) {
    const n = A.reduce((t, g) => t + g.attributes[name].array.length, 0), arr = new Float32Array(n); let o = 0;
    for (const g of A) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  merged.computeBoundingSphere(); out.body = merged;
  // tail: a dark fan with pale outer corners, tucked under the rump
  out.tail = slab(tailShape(), 1, 0.9, (c, x, span) => c.copy(RB.tail).lerp(RB.tip, sstep(5.5, 8, span) * sstep(-12, -17, x)));
  // wings: coverts grey-brown, flight feathers darker, pale edging toward the feather tips
  const armPaint = (c, x, span) => c.copy(RB.cov).lerp(RB.sec, sstep(-3, -7, x)).lerp(RB.tip, sstep(-10.5, -12.5, x) * 0.5).multiplyScalar(0.9 + 0.1 * Math.sin(span * 2.3));
  const handPaint = (c, x, span) => c.copy(RB.cov).lerp(RB.prim, sstep(0, -5, x + span * 0.12)).lerp(RB.tip, sstep(-9, -14, x) * 0.35).multiplyScalar(0.9 + 0.1 * Math.sin(span * 1.4));
  out.armL = slab(armShape(), -1, 1.1, armPaint); out.armR = slab(armShape(), 1, 1.1, armPaint);
  out.handL = slab(handShape(), -1, 0.8, handPaint); out.handR = slab(handShape(), 1, 0.8, handPaint);
  return out;
}
// termite mound: a lumpy clay cone, lighter toward the top, with chimney holes; cracked open when breached
function termiteGeo(cr, breached) {
  const r = cr.r || 30, H = r * 1.1, prof = [];
  for (let i = 0; i <= 14; i++) { const u = i / 14; prof.push(new THREE.Vector2(Math.max(0.01, r * (1 - Math.pow(u, 1.25)) * (1 - 0.12 * Math.sin(u * 9))), H * u)); }
  const g = new THREE.LatheGeometry(prof, 36), p = g.attributes.position, cols = new Float32Array(p.count * 3);
  const lo = col('#6a4222'), mid = col('#a8703e'), hi = col('#f0c48a'), hole = col('#2a1608');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = AL.hash2(Math.round(x * 0.6) + 50, Math.round(z * 0.6) + 50, cr.id | 0), w = 1 + (n - 0.5) * 0.22;
    x *= w; z *= w;
    if (breached && y > H * 0.55) y = H * 0.55 - (1 - Math.hypot(x, z) / r) * r * 0.25;
    p.setXYZ(i, x, y, z);
    const u = y / H;
    _c.copy(lo).lerp(mid, Math.min(1, u * 2)).lerp(hi, Math.max(0, u * 1.4 - 0.4)).multiplyScalar(0.85 + n * 0.3);
    if (!breached && n > 0.9 && u > 0.2) _c.copy(hole);
    if (breached && y > H * 0.4 && Math.hypot(x, z) < r * 0.45) _c.copy(hole);
    cols.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.computeVertexNormals();
  return g;
}

// a quaternion for heading a (2D, y down) with roll r about the body's long axis
const qOf = (a, roll) => { _e.set(roll, -a, 0, 'YXZ'); return _q.setFromEuler(_e); };
// a wing (flattened ellipsoid) hinged at the body's side: phi up from flat
function wing(pool, x, h, y, a, side, phi, len, wid, c, fwd) {
  const d = len * 0.5, lx = fwd || 0, ly = d * Math.sin(phi), lz = side * d * Math.cos(phi);
  const ca = Math.cos(a), sa = Math.sin(a);
  pool.putQ(x + lx * ca - lz * sa, h + ly, y + lx * sa + lz * ca, qOf(a, -side * phi), wid, 0.12, len * 0.5, c);
}

const Yard = {
  id: 'yard',
  // a wingbeat: the arm sweeps up and down, the hand trails it and folds a little on the upstroke
  flap(ph) {
    if (!this.wings) return;
    const up = Math.sin(ph), hand = Math.sin(ph - 0.7);
    for (const w of this.wings) {
      w.arm.rotation.x = -w.s * (0.1 + up * 0.55);
      w.hand.rotation.x = -w.s * (hand * 0.45 - 0.05);
      w.hand.rotation.y = w.s * (up > 0 ? up * 0.35 : 0);   // primaries tuck back on the way up
    }
  },
  init(r3) {
    const S = r3.scene;
    this.mat = vmat({ roughness: 0.5, metalness: 0.12 });
    this.clayMat = vmat({ roughness: 0.95, metalness: 0, flatShading: true });
    this.mower = mesh(mowerGeo(), this.mat); S.add(this.mower);
    this.spr = sprinklerGeos(); this.sprMeshes = new Map();
    const sg = shoeGeo(); this.shoes = [0, 1, 2, 3].map(() => { const m = mesh(sg, vmat({ roughness: 0.7 })); S.add(m); return m; });
    const rg = robinGeos(); this.robinMat = vmat({ roughness: 0.85, transparent: true, side: THREE.DoubleSide });
    this.robin = new THREE.Group(); this.robin.visible = false;
    this.robin.add(new THREE.Mesh(rg.body, this.robinMat));
    const tail = new THREE.Mesh(rg.tail, this.robinMat); tail.position.set(-19, 2.2, 0); this.robin.add(tail);
    this.wings = [-1, 1].map(s => {
      const armM = new THREE.Mesh(s < 0 ? rg.armL : rg.armR, this.robinMat), handM = new THREE.Mesh(s < 0 ? rg.handL : rg.handR, this.robinMat);
      armM.position.set(4, 5.5, s * SHOULDER); handM.position.set(0, 0.2, s * WRIST); armM.add(handM); this.robin.add(armM);
      return { s, arm: armM, hand: handM };
    });
    this.robin.traverse(m => { m.castShadow = false; });
    S.add(this.robin);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0, depthWrite: false });
    this.water = new Pool(r3, new THREE.SphereGeometry(1, 6, 4), this.waterMat, false);
    this.clips = new Pool(r3, new THREE.BoxGeometry(1, 1, 1), r3.chunkMat);
    this.bwing = new Pool(r3, butterflyWing(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide }));
    this.termites = new Map(); this.world = null;
  },
  update(r3, world, v, t) {
    if (this.world !== world) { for (const m of this.termites.values()) { r3.scene.remove(m.mesh); m.mesh.geometry.dispose(); } this.termites.clear(); for (const m of this.sprMeshes.values()) { r3.scene.remove(m.head, m.arm); } this.sprMeshes.clear(); this.world = world; }
    this.water.begin(); this.clips.begin(); this.bwing.begin();
    const S = world.surface, fog = world.fog, me = AL.me ? AL.me() : (world.me || 0), a = v.alpha || 0;
    const inV = (x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
    const seen = (x, y) => !fog || fog.seenAt(x, y), vis = (x, y) => !fog || fog.visibleAt(x, y);
    const P = world.poi, H = P && P.human, PT = AL.POI_TUNE;
    // -- the mower
    const Mw = H && H.mower;
    this.mower.visible = !!(Mw && Mw.state === 'mow' && inV(Mw.x, Mw.y, 300));
    if (this.mower.visible) {
      this.mower.position.set(Mw.x, r3.T(Mw.x, Mw.y), Mw.y); this.mower.rotation.y = Mw.dir > 0 ? 0 : -PI;
      const L = PT.MOWER_LEN, W = PT.MOWER_W, f20 = (t * 20) | 0;
      for (let k = 0; k < 40; k++) {   // clippings thrown from the side chute
        const h = AL.hash2(k, f20, 7), h2 = AL.hash2(k, 3, f20), lx = (-L * 0.2 - h * 120) * Mw.dir, lz = (W / 2 + h2 * 50 - 10) * Mw.dir;
        this.clips.put(Mw.x + lx, 4 + h * (1 - h) * 70, Mw.y + lz, h * 9, 2.5, 0.6, 1.4, k % 3 ? K.clip : K.clip2);
      }
    }
    // -- sprinklers: heads always, jets while the water's on
    if (P && P.sprinklers) for (const sp of P.sprinklers) {
      let m = this.sprMeshes.get(sp);
      if (!m) { m = { head: mesh(this.spr.head, this.mat), arm: mesh(this.spr.arm, this.mat) }; r3.scene.add(m.head, m.arm); this.sprMeshes.set(sp, m); }
      const on = inV(sp.x, sp.y, (sp.r || 0) + 20), g = r3.T(sp.x, sp.y);
      m.head.visible = m.arm.visible = on;
      if (!on) continue;
      m.head.position.set(sp.x, g, sp.y); m.arm.position.set(sp.x, g, sp.y); m.arm.rotation.y = -(sp.ang || 0);
      if (H && H.sprink && H.sprink.on) {
        const A = sp.ang || 0, R = sp.r || 100;
        for (let j = 0; j < 3; j++) {
          const aj = A + (j - 1) * 0.06, ca = Math.cos(aj), sa = Math.sin(aj);
          for (let k = 2; k < 34; k++) {
            const u = k / 34, d = u * R, wob = Math.sin(t * 20 + k * 1.7 + j) * (2 + d * 0.02), s = 1 + k / 30;
            this.water.put(sp.x + ca * d - sa * wob, g + 7 + u * (1 - u) * R * 0.55, sp.y + sa * d + ca * wob, 0, s, s, s, K.water);
          }
        }
      }
    }
    // -- shoes: stomping down out of the sky, lifting away after
    let si = 0;
    if (H && H.steps) for (const f of H.steps) {
      if (si >= this.shoes.length || !inV(f.x, f.y, 100)) continue;
      const k = f.t / PT.STEP_TELE, after = f.t - PT.STEP_TELE;
      let h = -1;
      if (!f.stomped && k > 0.72) h = Math.pow((1 - k) / 0.28, 2) * 110;
      else if (f.stomped && after < 0.6) h = Math.pow(after / 0.6, 2) * 140;
      if (h < 0) continue;
      const m = this.shoes[si++]; m.visible = true; m.position.set(f.x, r3.T(f.x, f.y) + h, f.y); m.rotation.y = -(f.a || 0);
    }
    for (; si < this.shoes.length; si++) this.shoes[si].visible = false;
    // -- the robin: in sight for the start of its dive and as it flies off
    const b = world.creatures && world.creatures.bird;
    this.robin.visible = false;
    if (b && b.alive && ((b.state === 'dive' && b.st < 0.7) || (b.state === 'leave' && b.st > 1.2))) {
      const kk = b.state === 'dive' ? 1 - b.st / 0.7 : (b.st - 1.2) / 1, sc = 0.85 + (b.alt || 0) * 0.5;
      if (kk > 0.02 && inV(b.x, b.y, 200)) {
        this.robin.visible = true; this.robinMat.opacity = Math.min(1, kk * 1.5);
        this.robin.position.set(b.x, r3.T(b.x, b.y) + 22 + (b.alt || 0) * 80, b.y); this.robin.rotation.y = -(b.a || 0); this.robin.scale.setScalar(sc);
        this.flap(t * 11);
      }
    }
    // -- creatures drawn here: flying ladybugs and butterflies, termite mounds, cocoons, aphid herds, antlions
    const seenT = new Set();
    for (const cr of S.creatures || []) {
      if (cr.type === 'termites') {
        if ((!cr.alive && cr.state !== 'breached') || cr.hidden) continue;
        const breached = cr.state === 'breached', key = breached ? 1 : 0;
        let m = this.termites.get(cr);
        if (!m || m.key !== key) { if (m) { r3.scene.remove(m.mesh); m.mesh.geometry.dispose(); } m = { key, mesh: mesh(termiteGeo(cr, breached), this.clayMat) }; r3.scene.add(m.mesh); this.termites.set(cr, m); }
        seenT.add(cr);
        m.mesh.visible = inV(cr.x, cr.y, (cr.r || 30) + 40) && seen(cr.x, cr.y);
        if (!m.mesh.visible) continue;
        m.mesh.position.set(cr.x, r3.T(cr.x, cr.y) - 0.5, cr.y);
        if (!breached) {   // soldiers patrol the rim; more pour out while it's attacked
          const n = Math.round(4 + 10 * cr.hp / cr.maxHp + Math.min(10, cr.attackers || 0));
          for (let k = 0; k < n; k++) {
            const dir = k & 1 ? 1 : -1, ang = k * 2.399 + t * 0.35 * dir, rr = cr.r + 1 + Math.sin(t * 2 + k) * 2.5, sol = k % 3 === 0;
            r3.frame(cr.x + Math.cos(ang) * rr, cr.y + Math.sin(ang) * rr, ang + dir * PI / 2, 1);
            r3.blob(-1.2, 0, 1, 2.2, 1.1, 1.2, 0, K.term); r3.blob(1.4, 0, 1.1, sol ? 1.4 : 1, sol ? 1.1 : 0.9, sol ? 1.1 : 0.9, 0, sol ? K.termSol : K.termHead);
          }
        }
        continue;
      }
      if (!cr.alive || cr.hidden) continue;
      const x = cr.px != null ? cr.px + (cr.x - cr.px) * a : cr.x, y = cr.py != null ? cr.py + (cr.y - cr.py) * a : cr.y;
      if (!inV(x, y, 60)) continue;
      if (cr.flying && cr.type === 'ladybug') {
        if (!seen(x, y)) continue;
        const alt = cr.alt || 1; r3.frame(x, y, cr.a, 1.1); r3._c.h0 += 10 + alt * 22;
        r3.ladybug(t, false);
        const fl = 0.5 + Math.abs(Math.sin(t * 40)) * 0.9, h0 = r3._c.h0 + 5;
        for (const sd of [-1, 1]) wing(r3.cWing, x, h0, y, cr.a, sd, fl, 9, 4, K.wing, -1);
      } else if (cr.flying && cr.type === 'butterfly') {
        if (!seen(x, y)) continue;
        const alt = cr.alt || 1, s = 1 + alt * 0.3, h0 = r3.heightAt(x, y) + 14 + alt * 26, ha = cr.a, fl = Math.abs(Math.cos(cr.anim || 0)), phi = 0.15 + (1 - fl) * 1.25;
        r3.frame(x, y, ha, s); r3._c.h0 = h0; r3.limb(-4, 0, 0, 4.5, 0, 0.2, 0.9, K.bbody);
        for (const sd of [-1, 1]) { r3.limb(4, sd * 0.4, 0.2, 8, sd * 3, 1.6, 0.18, K.bbody); this.bwing.putQ(x, h0, y, qOf(ha, sd > 0 ? -phi : PI + phi), s * 0.95, s, s * 0.95, K.white); }
      } else if (cr.type === 'cocoon') {
        if (!vis(x, y)) continue; r3.frame(x, y, cr.a || 0, 1); r3.cocoon(false);
      } else if (cr.type === 'antlion') {
        if (!vis(x, y)) continue; r3.frame(x, y, cr.a || 0, cr.scale || 1); r3._c.h0 -= 1.2; r3.antlion(false);
      } else if (cr.type === 'herd') {
        if (!vis(x, y)) continue;
        const n = Math.min(14, cr.count | 0);
        for (let k = 0; k < n; k++) {
          const ang = k * 2.4 + Math.sin(t * 3 + k) * 0.2, d = 3 + (k % 4) * 2.3, ax = cr.x + Math.cos(ang) * d, ay = cr.y + Math.sin(ang) * d;
          r3.frame(ax, ay, cr.a || 0, 1); r3.blob(0, 0, 1.4, 2.5, 1.5, 1.8, 0, K.aphid);
        }
      }
    }
    for (const [cr, m] of this.termites) if (!seenT.has(cr)) { r3.scene.remove(m.mesh); m.mesh.geometry.dispose(); this.termites.delete(cr); }
    // -- army-ant bivouacs: a living heap of the colony's own 3D ants
    for (const c of world.colonies) {
      if (!c || !c.sp.nomad || !c.alive || !inV(c.x, c.y, 120) || (fog && c.id !== me && !fog.seenAt(c.x, c.y))) continue;
      const n = Math.min(140, 30 + (c.pop[0] + c.pop[1]) * 0.5 | 0), r = 18 + Math.sqrt(n) * 3.2, R = AL.rng(c.id * 13 + 5);
      const pal = palOf(r3, c.colours || c.sp, C.WORKER), s = AL.CASTES[C.WORKER].size * (c.sp.size || 1), g0 = r3.T(c.x, c.y), fr = (r3.r.frame >> 3);
      for (let j = 0; j < n * 1.6; j++) {
        const ang = R() * TAU, d = Math.sqrt(R()) * r, u = d / r, x = c.x + Math.cos(ang) * d, y = c.y + Math.sin(ang) * d;
        const h = g0 + r * 0.5 * Math.sqrt(Math.max(0, 1 - u * u)) * (0.75 + R() * 0.35), hd = R() * TAU + Math.sin(r3.r.frame * 0.05 + j) * 0.2;
        pal.group.put(x, h, y, Math.cos(hd), Math.sin(hd), s, FR[(j + fr) & 3], pal);
      }
    }
    // -- mating flights (expansion.js): the queen with her escort of males, wings buzzing, high over the yard
    const X = world.exp;
    if (X && X.flights) for (const f of X.flights) {
      const x = f.px + (f.x - f.px) * a, y = f.py + (f.y - f.py) * a, alt = f.palt + (f.alt - f.palt) * a, tt = f.pt + (f.t - f.pt) * a;
      const c = world.colonies[f.col]; if (!c || !inV(x, y, 140) || (fog && f.col !== me && !fog.visibleAt(x, y))) continue;
      const boost = Math.max(1, 20 / (15 * v.z)), pal = palOf(r3, c.colours || c.sp, C.WINGED), s0 = AL.CASTES[C.WINGED].size * (c.sp.size || 1);
      const put = (px, py, ha, al, sc, buzz) => {
        const h = r3.heightAt(px, py) + 2 + al * 46, s = s0 * sc;
        pal.group.put(px, h, py, Math.cos(ha), Math.sin(ha), s, 0, pal);
        const phi = 0.2 + Math.abs(Math.sin(buzz * 34)) * 0.9;
        for (const sd of [-1, 1]) { wing(r3.cWing, px, h + 2.6 * s, py, ha, sd, phi, 10 * s, 3.4 * s, K.wing, 0.4 * s); wing(r3.cWing, px, h + 2.4 * s, py, ha, sd, phi * 0.8, 7.5 * s, 2.7 * s, K.wing, -0.8 * s); }
      };
      for (let k = 0; k < (f.males | 0); k++) {
        const ang = tt * 2.6 + k * PI, rr = (26 + 6 * Math.sin(tt * 2 + k)) * boost * (0.35 + alt * 0.65);
        put(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, ang + PI / 2, Math.max(0.15, alt), 0.72 * boost, tt + k);
      }
      put(x, y, f.a || 0, alt, boost, tt);
    }
    // -- winged royals waiting on the mound for their flight (expansion-art.js drawPerched)
    if (v.z >= 0.7) for (const c of world.colonies) {
      if (!c || !c.royal || !c.alive || !inV(c.x, c.y, 80) || (fog && c.id !== me && !fog.seenAt(c.x, c.y))) continue;
      const n = (c.royal.queens | 0) + (c.royal.males | 0); if (!n) continue;
      const pal = palOf(r3, c.colours || c.sp, C.WINGED), s0 = AL.CASTES[C.WINGED].size * (c.sp.size || 1), tt = (v.frame || 0) / 60;
      for (let k = 0; k < Math.min(6, n); k++) {
        const male = k >= c.royal.queens, ang = -2.2 + k * 0.85, d = c.moundR * 0.52, x = c.x + Math.cos(ang) * d, y = c.y + Math.sin(ang) * d, hd = ang + PI + Math.sin(tt * 1.3 + k) * 0.3;
        pal.group.put(x, r3.heightAt(x, y), y, Math.cos(hd), Math.sin(hd), s0 * (male ? 0.75 : 1), 0, pal);
      }
    }
    this.water.end(); this.clips.end(); this.bwing.end();
  },
};
// F8 gallery, page 5: every yard model laid out side by side (labels drawn by render3d.js)
const SC = { meshes: null };
R3.showcase = function (r3, world, cx, cy, L, t) {
  const Y = Yard, c = world.colonies[world.me || 0] || world.player, H0 = (x, y) => r3.T(x, y);
  if (!SC.meshes) {
    SC.meshes = { mound: mesh(termiteGeo({ id: 3, r: 28 }, false), Y.clayMat), broke: mesh(termiteGeo({ id: 5, r: 28 }, true), Y.clayMat), head: mesh(Y.spr.head, Y.mat), arm: mesh(Y.spr.arm, Y.mat) };
    for (const m of Object.values(SC.meshes)) r3.scene.add(m);
  }
  const S = SC.meshes, lab = (x, y, text) => L.push({ x, y, text });
  for (const m of Object.values(S)) m.visible = true;
  // row 1: mower, robin, shoe, sprinkler, termite mound
  let x = cx - 280, y = cy - 170;
  Y.mower.visible = true; Y.mower.position.set(x + 20, H0(x, y), y); Y.mower.rotation.y = 0; Y.mower.scale.setScalar(0.42);
  for (let k = 0; k < 40; k++) { const h = AL.hash2(k, (t * 20) | 0, 7), h2 = AL.hash2(k, 3, (t * 20) | 0); Y.clips.put(x + 20 + (-46 * 0.2 - h * 50), 3 + h * (1 - h) * 30, y + 52 + h2 * 22 - 4, h * 9, 1.8, 0.5, 1.1, k % 3 ? K.clip : K.clip2); }
  lab(x, y + 66, 'Lawn mower');
  x = cx - 140; Y.robin.visible = true; Y.robinMat.opacity = 1; Y.robin.position.set(x, H0(x, y) + 40, y); Y.robin.rotation.y = -t * 0.4; Y.robin.scale.setScalar(1.05);
  Y.flap(t * 5);
  lab(x, y + 58, 'Robin');
  x = cx; Y.shoes[0].visible = true; Y.shoes[0].position.set(x, H0(x, y), y); Y.shoes[0].rotation.y = -t * 0.3;
  lab(x, y + 42, 'Shoe');
  x = cx + 140; S.head.position.set(x, H0(x, y), y); S.arm.position.set(x, H0(x, y), y); const sa = t * 1.2; S.arm.rotation.y = -sa;
  for (let j = 0; j < 3; j++) { const aj = sa + (j - 1) * 0.06, ca = Math.cos(aj), sn = Math.sin(aj); for (let k = 2; k < 34; k++) { const u = k / 34, d = u * 60, wob = Math.sin(t * 20 + k * 1.7 + j) * (2 + d * 0.02), s = 1 + k / 40; Y.water.put(x + ca * d - sn * wob, H0(x, y) + 7 + u * (1 - u) * 40, y + sn * d + ca * wob, 0, s, s, s, K.water); } }
  lab(x, y + 42, 'Sprinkler');
  x = cx + 280; S.mound.position.set(x, H0(x, y), y); lab(x, y + 46, 'Termite mound');
  { const n = 12; for (let k = 0; k < n; k++) { const dir = k & 1 ? 1 : -1, ang = k * 2.399 + t * 0.35 * dir, rr = 29 + Math.sin(t * 2 + k) * 2.5, sol = k % 3 === 0; r3.frame(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, ang + dir * PI / 2, 1); r3.blob(-1.2, 0, 1, 2.2, 1.1, 1.2, 0, K.term); r3.blob(1.4, 0, 1.1, sol ? 1.4 : 1, sol ? 1.1 : 0.9, sol ? 1.1 : 0.9, 0, sol ? K.termSol : K.termHead); } }
  // row 2: bivouac, mating flight, butterfly, flying ladybug, antlion, cocoon, aphids, breached mound
  y = cy - 55; x = cx - 280;
  if (c) {
    const pal = palOf(r3, c.colours || c.sp, C.WORKER), R = AL.rng(77), r = 34, g0 = H0(x, y);
    for (let j = 0; j < 130; j++) { const ang = R() * TAU, d = Math.sqrt(R()) * r, u = d / r, hd = R() * TAU; pal.group.put(x + Math.cos(ang) * d, g0 + r * 0.5 * Math.sqrt(Math.max(0, 1 - u * u)) * (0.75 + R() * 0.35), y + Math.sin(ang) * d, Math.cos(hd), Math.sin(hd), 1, FR[(j + (r3.r.frame >> 3)) & 3], pal); }
    lab(x, y + 46, 'Army ant bivouac');
    x = cx - 140; const wp = palOf(r3, c.colours || c.sp, C.WINGED);
    const fly = (px, py, ha, al, sc, buzz) => { const h = H0(px, py) + 2 + al * 46; wp.group.put(px, h, py, Math.cos(ha), Math.sin(ha), sc, 0, wp); const phi = 0.2 + Math.abs(Math.sin(buzz * 34)) * 0.9; for (const sd of [-1, 1]) { wing(r3.cWing, px, h + 2.6 * sc, py, ha, sd, phi, 10 * sc, 3.4 * sc, K.wing, 0.4 * sc); wing(r3.cWing, px, h + 2.4 * sc, py, ha, sd, phi * 0.8, 7.5 * sc, 2.7 * sc, K.wing, -0.8 * sc); } };
    for (let k = 0; k < 2; k++) { const ang = t * 2.6 + k * PI; fly(x + Math.cos(ang) * 26, y + Math.sin(ang) * 26, ang + PI / 2, 0.5, 0.75, t + k); }
    fly(x, y, -0.4, 0.6, 1.1, t);
    lab(x, y + 46, 'Queen\'s mating flight');
  }
  x = cx; { const h0 = H0(x, y) + 30, fl = Math.abs(Math.cos(t * 2)), phi = 0.1 + (1 - fl) * 0.9, ha = -0.6; r3.frame(x, y, ha, 1.9); r3._c.h0 = h0; r3.limb(-4, 0, 0, 4.5, 0, 0.2, 0.9, K.bbody); for (const sd of [-1, 1]) { r3.limb(4, sd * 0.4, 0.2, 8, sd * 3, 1.6, 0.18, K.bbody); Y.bwing.putQ(x, h0, y, qOf(ha, sd > 0 ? -phi : PI + phi), 1.9, 1.9, 1.9, K.white); } }
  lab(x, y + 45, 'Butterfly');
  x = cx + 140; r3.frame(x, y, 0.5, 1.4); r3._c.h0 += 28; r3.ladybug(t, false); { const h0 = r3._c.h0 + 6, fl = 0.5 + Math.abs(Math.sin(t * 20)) * 0.9; for (const sd of [-1, 1]) wing(r3.cWing, x, h0, y, 0.5, sd, fl, 12, 5, K.wing, -1.4); }
  lab(x, y + 45, 'Flying ladybug');
  const yb = y; x = cx + 280; S.broke.position.set(x, H0(x, yb), yb); lab(x, yb + 46, 'Breached termite mound');
  y = cy + 60; x = cx - 280; r3.frame(x, y, t * 0.4, 1.6); r3._c.h0 -= 1; r3.antlion(false); lab(x, y + 40, 'Antlion');
  x = cx - 140; r3.frame(x, y, 0.3, 1.4); r3.cocoon(false); lab(x, y + 40, 'Cocoon');
  x = cx; for (let k = 0; k < 14; k++) { const ang = k * 2.4 + Math.sin(t * 3 + k) * 0.2, d = 3 + (k % 4) * 2.3; r3.frame(x + Math.cos(ang) * d * 1.6, y + Math.sin(ang) * d * 1.6, ang, 1.3); r3.blob(0, 0, 1.4, 2.5, 1.5, 1.8, 0, K.aphid); }
  lab(x, y + 40, 'Aphid herd');
  // the foods that used to be flat
  const y4 = cy + 170;
  const foods = [
    { id: 14, x: cx + 140, y, r: 18, amount: 100, max: 100, visual: 'larvae', kind: 2 },
    { id: 11, x: cx - 200, y: y4, r: 30, amount: 70, max: 100, visual: 'honeydew', kind: 1, poi: { x: cx - 200, y: y4, r: 32, seed: 0.37, aphids: 12 } },
    { id: 12, x: cx - 30, y: y4, r: 22, amount: 100, max: 100, visual: 'seeds', kind: 4 },
    { id: 13, x: cx + 130, y: y4, r: 24, amount: 100, max: 100, visual: 'leaves', kind: 5 },
  ];
  r3.updateFoods({ surface: { foods }, colonies: world.colonies }, { x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9 });
  lab(cx + 140, y + 40, 'Larvae'); lab(cx - 200, y4 + 48, 'Aphid plant (honeydew)'); lab(cx - 30, y4 + 40, 'Seeds'); lab(cx + 130, y4 + 40, 'Clover');
  Y.water.end(); Y.clips.end(); Y.bwing.end();
};
// out of the gallery: the showcase pieces go away and the mower is full size again
const baseUpdate = Yard.update;
Yard.update = function (r3, world, v, t) {
  if (SC.meshes && R3.gallery !== 4) for (const m of Object.values(SC.meshes)) m.visible = false;
  this.mower.scale.setScalar(1);
  if (R3.gallery === 4) { this.water.begin(); this.clips.begin(); this.bwing.begin(); for (const s of this.shoes) s.visible = false; this.robin.visible = false; this.mower.visible = false; return; }
  return baseUpdate.call(this, r3, world, v, t);
};
R3.extras.push(Yard);
}
