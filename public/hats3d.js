// Antlands 3D: the cosmetic hats (hats.js picks who wears what) as Three.js models.
//  - in game: render3d.js queues one entry per wearer (AL.R3D.hatQ); this draws them as instanced meshes,
//    one pool per hat and colour variant (propeller blades spin)
//  - 2D (Classic sprites and the nest view): a small sprite of the same model, drawn on the ant's head
//  - title screen: AL.R3D.hats.mesh(id, v) for the Cosmetics tab's previews
// Hat models sit on the head: origin at the top of the head, +x forward, +y up, 1 unit = the head's radius.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL.R3D, KIT = R3 && R3.kit, TAU = Math.PI * 2;
if (KIT && AL.Hats) {
const { Builder, Pool, M, V, SPH, SPH_LO, WHITE } = KIT;
const CY = new THREE.CylinderGeometry(1, 1, 1, 24);
const DOME = new THREE.SphereGeometry(1, 22, 9, 0, TAU, 0, Math.PI / 2);
const CONE = new THREE.ConeGeometry(1, 1, 22);
const RING = new THREE.TorusGeometry(1, 0.09, 6, 30).rotateX(Math.PI / 2);

// colour variants (two teams on one hat online): hue turned round; greys / black / white get a tint instead
const TINT = [0.62, 0.0, 0.36, 0.8, 0.1, 0.5, 0.95];
function tone(hex, v) {
  const c = new THREE.Color(hex); if (!v) return c;
  const h = {}; c.getHSL(h);
  if (h.s < 0.18) c.setHSL(TINT[(v - 1) % TINT.length], 0.7, Math.min(0.55, Math.max(0.05, h.l)));
  else c.setHSL((h.h + 0.31 * v) % 1, h.s, h.l);
  return c;
}
// each hat: (b = main Builder, c = hex -> variant colour, sp = spinning-part Builder)
const DEFS = {
  tophat(b, c) {
    b.add(CY, M(0, 0.03, 0, 1.0, 0.07, 1.0), c('#1c1b22'));
    b.add(CY, M(0, 0.68, 0, 0.6, 1.25, 0.6), c('#1c1b22'));
    b.add(CY, M(0, 0.24, 0, 0.62, 0.24, 0.62), c('#b3203c'));
    b.add(CY, M(0, 1.31, 0, 0.6, 0.02, 0.6), c('#2a2932'));
  },
  crown(b, c) {
    const gold = c('#f3c33e');
    b.add(DOME, M(0, 0.0, 0, 0.6, 0.42, 0.6), c('#8c1434'));
    b.add(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true), M(0, 0.2, 0, 0.66, 0.42, 0.66), gold);
    b.add(CY, M(0, 0.02, 0, 0.7, 0.08, 0.7), gold);
    for (let k = 0; k < 6; k++) {
      const a = k * TAU / 6, x = Math.cos(a) * 0.62, z = Math.sin(a) * 0.62;
      b.add(CONE, M(x, 0.55, z, 0.15, 0.36, 0.15), gold);
      b.add(SPH_LO, M(x, 0.76, z, 0.07, 0.07, 0.07), gold);
      const g = a + TAU / 12;
      b.add(SPH_LO, M(Math.cos(g) * 0.67, 0.2, Math.sin(g) * 0.67, 0.09, 0.1, 0.09), c(k & 1 ? '#2f6dff' : '#e0204a'));
    }
    b.add(SPH_LO, M(0, 0.48, 0, 0.1, 0.1, 0.1), gold);
  },
  propeller(b, c, sp) {
    const Q = [c('#e8333a'), c('#f6c21c'), c('#2f7de0'), c('#35b45a')];
    b.add(DOME, M(0, -0.05, 0, 0.78, 0.62, 0.78), null, (x, y, z) => Q[((Math.atan2(z, x) / TAU + 1.125) * 4 | 0) & 3]);
    b.add(CY, M(0.62, -0.02, 0, 0.42, 0.05, 0.5), c('#f6c21c'));
    b.add(CY, M(0, 0.68, 0, 0.05, 0.28, 0.05), c('#9aa0a6'));
    sp.add(SPH_LO, M(0, 0.84, 0, 0.1, 0.07, 0.1), c('#e8333a'));
    for (const s of [-1, 1]) sp.add(SPH, M(s * 0.5, 0.84, 0, 0.48, 0.03, 0.12, 0.25 * s, 0, 0), c(s > 0 ? '#e8333a' : '#2f7de0'));
  },
  hardhat(b, c) {
    const y = c('#f7c51e');
    b.add(DOME, M(0, -0.05, 0, 0.8, 0.66, 0.8), y);
    b.add(CY, M(0.14, -0.04, 0, 0.98, 0.06, 0.86), y);
    b.add(SPH, M(0, 0.58, 0, 0.62, 0.11, 0.12), c('#e8b000'));
    b.add(SPH_LO, M(0.72, 0.18, 0, 0.12, 0.16, 0.2), c('#f4f4ec'));
  },
  cowboy(b, c) {
    const br = c('#8b5a2b');
    b.add(CY, M(0, 0.04, 0, 1.12, 0.05, 0.92), br);
    b.add(RING, M(0, 0.12, 0, 1.12, 1.0, 0.92), c('#7a4c22'));
    b.add(SPH, M(0, 0.38, 0, 0.56, 0.5, 0.5), br);
    b.add(SPH_LO, M(0, 0.74, 0, 0.4, 0.1, 0.12), c('#6a4019'));
    b.add(CY, M(0, 0.2, 0, 0.58, 0.13, 0.52), c('#3a2414'));
  },
  wizard(b, c) {
    const pu = c('#4b2a9e'), st = c('#ffd84a');
    b.add(CY, M(0, 0.03, 0, 1.0, 0.05, 1.0), pu);
    b.add(CONE, M(-0.14, 0.96, 0, 0.62, 1.9, 0.62, 0, 0, 0.16), pu);
    b.add(CY, M(0, 0.17, 0, 0.62, 0.1, 0.62), st);
    for (const [x, y, z] of [[0.5, 0.5, 0.18], [-0.12, 0.95, -0.4], [0.1, 1.35, 0.2], [0.3, 0.75, -0.3]]) b.add(SPH_LO, M(x, y, z, 0.08, 0.08, 0.08), st);
  },
  party(b, c) {
    const P = c('#ff4fa0'), Cy = c('#38d6e8');
    b.add(CONE, M(0, 0.72, 0, 0.5, 1.44, 0.5), null, (x, y) => ((y * 4.2) | 0) & 1 ? P : Cy);
    b.add(SPH, M(0, 1.48, 0, 0.17, 0.17, 0.17), c('#ffd84a'));
    b.add(RING, M(0, 0.05, 0, 0.5, 0.8, 0.5), c('#ffd84a'));
  },
  viking(b, c) {
    const steel = c('#9aa3ad'), bronze = c('#b07a3a'), horn = c('#efe4c6');
    b.add(DOME, M(0, -0.08, 0, 0.8, 0.72, 0.8), steel);
    b.add(CY, M(0, 0.02, 0, 0.83, 0.17, 0.83), bronze);
    b.add(SPH, M(0, 0.6, 0, 0.62, 0.08, 0.1), bronze);
    b.add(CY, M(0.6, 0.0, 0, 0.12, 0.5, 0.08), bronze);
    for (const s of [-1, 1]) {
      let p = V(0.05, 0.28, s * 0.68);
      for (let k = 1; k <= 5; k++) {
        const t = k / 5, q = V(0.05 + 0.18 * t, 0.28 + 0.3 * t + 0.75 * t * t, s * (0.68 + 0.42 * t - 0.12 * t * t));
        b.seg(p, q, 0.17 * (1 - t * 0.78), horn); p = q;
      }
    }
  },
  chef(b, c) {
    const w = c('#f7f6f0');
    b.add(CY, M(0, 0.24, 0, 0.58, 0.48, 0.58), w);
    b.add(SPH, M(0, 0.74, 0, 0.72, 0.42, 0.72), w);
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; b.add(SPH, M(Math.cos(a) * 0.45, 0.72, Math.sin(a) * 0.45, 0.36, 0.34, 0.36), w); }
    b.add(CY, M(0, 0.05, 0, 0.6, 0.08, 0.6), c('#e4e2da'));
  },
  beanie(b, c) {
    const R = c('#d2363a'), W = c('#f2efe6');
    b.add(DOME, M(0, -0.06, 0, 0.8, 0.76, 0.8), null, (x, y) => (((y + 0.06) * 6.5) | 0) & 1 ? W : R);
    b.add(CY, M(0, 0.04, 0, 0.84, 0.24, 0.84), c('#a82428'));
    b.add(SPH, M(0, 0.76, 0, 0.23, 0.23, 0.23), W);
  },
};
const GEOS = new Map();
function geo(id, v) {
  const key = id + '|' + v; let g = GEOS.get(key);
  if (g) return g;
  const def = DEFS[id]; if (!def) return null;
  const b = new Builder(), sp = new Builder(), c = hex => tone(hex, v);
  def(b, c, sp);
  g = { main: b.build(), spin: sp.empty ? null : sp.build(), metal: id === 'crown' };
  GEOS.set(key, g);
  return g;
}
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 });
const GOLD = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.45, emissive: 0x2a1a00 });
const matOf = g => g.metal ? GOLD : MAT;

// a stand-alone hat (title screen previews): a Group, .userData.spin(t) turns the propeller
function mesh(id, v) {
  const g = geo(id, v | 0); if (!g) return null;
  const grp = new THREE.Group(), m = new THREE.Mesh(g.main, matOf(g)); m.castShadow = true; grp.add(m);
  let s = null; if (g.spin) { s = new THREE.Mesh(g.spin, MAT); s.castShadow = true; grp.add(s); }
  grp.userData.spin = t => { if (s) s.rotation.y = t * 9; };
  return grp;
}

// ---- in game: instanced pools fed from render3d.js's queue ----------------------------------------------------
const POOLS = new WeakMap();
const Hats3D = {
  id: 'hats',
  init(r3) { POOLS.set(r3, new Map()); },
  update(r3, world, view, t) {
    const Q = AL.R3D.hatQ, P = POOLS.get(r3);
    for (const p of P.values()) { p.main.begin(); if (p.spin) p.spin.begin(); }
    for (let k = 0; k + 6 < Q.length; k += 7) {
      const id = Q[k + 5], v = Q[k + 6], key = id + '|' + v;
      let p = P.get(key);
      if (!p) { const g = geo(id, v); if (!g) continue; p = { main: new Pool(r3, g.main, matOf(g)), spin: g.spin ? new Pool(r3, g.spin, MAT) : null }; P.set(key, p); p.main.begin(); if (p.spin) p.spin.begin(); }
      const x = Q[k], y = Q[k + 1], z = Q[k + 2], a = Q[k + 3], s = Q[k + 4];
      p.main.put(x, y, z, a, s, s, s, WHITE);
      if (p.spin) p.spin.put(x, y, z, t * 9 + k, s, s, s, WHITE);
    }
    for (const p of P.values()) { p.main.end(); if (p.spin) p.spin.end(); }
  },
};
R3.extras.push(Hats3D);

// ---- 2D: a sprite of each hat seen from above (a little from the front), drawn on the head --------------------
const SPR = new Map(), SPR_PX = 64, SPR_R = 1.7;   // (sprite half-width in hat units)
let SR = null;
function sprite(id, v) {
  const key = id + '|' + v; let c = SPR.get(key);
  if (c !== undefined) return c;
  c = null;
  try {
    if (!SR) {
      const r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.setSize(SPR_PX, SPR_PX, false); r.setClearColor(0, 0); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.25;
      const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xfff2dc, 0x3a2a18, 1.6));
      const k = new THREE.DirectionalLight(0xfff0dd, 2.4); k.position.set(-3, 10, -4); sc.add(k);
      const cam = new THREE.OrthographicCamera(-SPR_R, SPR_R, SPR_R, -SPR_R, 0.1, 50); cam.up.set(0, 0, -1); cam.position.set(4.5, 9, 0); cam.lookAt(0, 0.4, 0);
      SR = { r, sc, cam };
    }
    const m = mesh(id, v); if (!m) { SPR.set(key, null); return null; }
    SR.sc.add(m); SR.r.render(SR.sc, SR.cam); SR.sc.remove(m);
    c = document.createElement('canvas'); c.width = c.height = SPR_PX; c.getContext('2d').drawImage(SR.r.domElement, 0, 0);
  } catch (e) { console.error('[Antlands hats]', e); c = null; }
  SPR.set(key, c);
  return c;
}
function drawHats(ctx, view, r, layer) {
  const w = r.world, A = w.ants, WEAR = AL.Hats.WEAR, cols = w.colonies, CS = AL.CASTES, SZ = A.size, HL = A.headless;
  const al = view.alpha == null ? 1 : view.alpha, me = w.me || 0, fog = w.fog, H = AL.Hats.head;
  const on = layer ? (r.nestOwner ? (r.nestOwner().hid != null ? r.nestOwner().hid : r.nestOwner().id) : me) : 0;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== layer || !WEAR[A.caste[i]]) continue;
    if (layer && ((A.nest && A.nest[i] !== on) || A.state[i] === AL.ST.N_TRANSIT)) continue;
    const c = cols[A.col[i]]; if (!c || !c.hat || (HL && HL[i])) continue;
    const x = A.px[i] + (A.x[i] - A.px[i]) * al, y = A.py[i] + (A.y[i] - A.py[i]) * al;
    if (x < view.x0 - 10 || x > view.x1 + 10 || y < view.y0 - 10 || y > view.y1 + 10) continue;
    if (!layer && A.col[i] !== me && fog && !fog.visibleAt(x, y)) continue;
    const spr = sprite(c.hat.id, c.hat.v | 0); if (!spr) continue;
    const caste = A.caste[i], s = CS[caste].size * (c.sp.size || 1) * (SZ ? SZ[i] : 1) * (layer ? 0.8 : 1), hd = H(caste, c.colours && c.colours.look);
    const R = SPR_R * hd.r * 1.4 * s, a = A.a[i];
    ctx.setTransform(view.z * Math.cos(a), view.z * Math.sin(a), -view.z * Math.sin(a), view.z * Math.cos(a), (x + Math.cos(a) * hd.x * s) * view.z + view.ox, (y + Math.sin(a) * hd.x * s) * view.z + view.oy);
    ctx.drawImage(spr, -R, -R, R * 2, R * 2);
  }
}
AL.registerSystem({ id: 'hats-ui', order: 92, render: {
  overAnts(ctx, view, r) { if (!AL.R3D.drawing) drawHats(ctx, view, r, 0); },
  nestOver(ctx, view, r) { drawHats(ctx, view, r, 1); },
} });

R3.hats = { geo, mesh, sprite };
}
