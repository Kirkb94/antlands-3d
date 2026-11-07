// Antlands 3D: grass blades on the lawn (tilted view). One square patch of blades is drawn many times (instanced),
// tiled around where the camera looks; the vertex shader stands each blade on the rolling ground (a height texture),
// gives it the colour of the painted ground under its root (the same sheet the ground shows), sways it in the wind,
// and shrinks it to nothing off the grass (a mask: water, sand, rocks, patio, the blanket, puddles, mounds) and far
// from the camera, so it fades into the painted lawn instead of popping. Dense near, sparser further out.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL.R3D, KIT = R3 && R3.kit;
if (KIT) {
const TS = 40;            // patch size (world units)
const PER = 230;          // blades per patch
const SEG = 3;            // segments per blade
const HGT = 7;            // tallest blade (a worker is ~11 long)
const MC = 4;             // mask resolution (units per texel)
const NM = 8;             // mounds the shader knows about

function patchGeo() {
  const vpb = SEG * 2 + 1, n = PER * vpb, R = AL.rng(9127);
  const pos = new Float32Array(n * 3), root = new Float32Array(n * 4), shp = new Float32Array(n * 4), idx = [];
  const g = Math.ceil(Math.sqrt(PER)), cs = TS / g;
  // stratified: one blade per grid cell, jittered, then shuffled so a partial draw range is an even thinning
  const order = []; for (let k = 0; k < PER; k++) order.push(k);
  for (let k = PER - 1; k > 0; k--) { const j = (R() * (k + 1)) | 0; const t = order[k]; order[k] = order[j]; order[j] = t; }
  for (let b = 0; b < PER; b++) {
    const cell = order[b], gx = cell % g, gy = (cell / g) | 0;
    const x = (gx + R()) * cs, z = (gy + R()) * cs, hf = 0.5 + R() * 0.5, ph = R() * 6.283;
    const face = R() * Math.PI, lean = R() * 6.283, leanAmt = 0.25 + R() * 0.55, wid = 0.75 + R() * 0.6;
    for (let s = 0; s < vpb; s++) {
      const v = b * vpb + s, seg = s >> 1, t = s === vpb - 1 ? 1 : seg / SEG, side = s === vpb - 1 ? 0 : (s & 1 ? 1 : -1);
      const taper = Math.pow(1 - t, 0.75);
      pos[v * 3] = side * taper; pos[v * 3 + 1] = t; pos[v * 3 + 2] = 0;
      root.set([x, z, hf, ph], v * 4); shp.set([face, lean, leanAmt, wid], v * 4);
    }
    const o = b * vpb;
    for (let s = 0; s < SEG - 1; s++) { const a = o + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = o + (SEG - 1) * 2; idx.push(a, a + 1, a + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRoot', new THREE.BufferAttribute(root, 4));
  geo.setAttribute('aShape', new THREE.BufferAttribute(shp, 4));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  geo.userData.perBlade = (SEG - 1) * 6 + 3;
  return geo;
}

const VS = `
uniform sampler2D uH; uniform vec2 uHN; uniform float uHC;
uniform sampler2D uMask; uniform vec2 uMN;
uniform sampler2D uMap; uniform vec2 uRep; uniform vec2 uOff;
uniform vec4 uMounds[${NM}];
uniform float uTime; uniform float uHgt; uniform vec3 uFoc;
attribute vec4 aRoot; attribute vec4 aShape; attribute vec2 iOff;
varying vec3 vCol; varying float vT; varying vec3 vN; varying float vDry;
#include <fog_pars_vertex>
float hAt(vec2 p) {
  vec2 f = clamp(p / uHC, vec2(0.0), uHN - 1.001); ivec2 i = ivec2(f); vec2 u = f - vec2(i);
  float a = texelFetch(uH, i, 0).r, b = texelFetch(uH, i + ivec2(1, 0), 0).r, c = texelFetch(uH, i + ivec2(0, 1), 0).r, d = texelFetch(uH, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
void main() {
  vec2 root = iOff + aRoot.xy;
  float m = texture2D(uMask, (root / ${MC.toFixed(1)} + 0.5) / uMN).r;
  for (int k = 0; k < ${NM}; k++) { vec4 md = uMounds[k]; if (md.z > 0.0) m *= smoothstep(md.z * 0.92, md.z * 1.2, distance(root, md.xy)); }
  float dc = distance(root, uFoc.xy);
  float fade = 1.0 - smoothstep(uFoc.z * 0.55, uFoc.z, dc);
  float lush = vn(root * 0.018);                                    // lush and thin patches
  vDry = smoothstep(0.55, 0.95, vn(root * 0.006 + 17.0));
  float hgt = uHgt * aRoot.z * smoothstep(0.3, 0.8, m) * fade * (0.65 + 0.55 * lush);
  float on = step(0.12, hgt);
  float t = position.y;
  vec2 fdir = vec2(cos(aShape.x), sin(aShape.x));
  float tm = mod(uTime, 628.3);
  float gust = sin(tm * 0.9 + root.x * 0.011 - root.y * 0.017) * 0.6 + 0.4;
  float w = (sin(tm * 2.1 + root.x * 0.07 + root.y * 0.04 + aRoot.w) * 0.35 + 0.65) * gust;
  vec2 off = (vec2(cos(aShape.y), sin(aShape.y)) * aShape.z + vec2(0.75, 0.45) * w * 0.6) * t * t * hgt;
  float droop = 1.0 - 0.3 * t * length(off) / max(hgt, 0.01);
  vec3 p = vec3(root.x + fdir.x * position.x * aShape.w * on + off.x, hAt(root) + t * hgt * droop, root.y + fdir.y * position.x * aShape.w * on + off.y);
  vec3 g = texture2D(uMap, root * uRep + uOff).rgb;
  vCol = g; vT = t;
  vN = normalize(vec3(-fdir.y, 0.55, fdir.x));
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
uniform vec3 uL;
varying vec3 vCol; varying float vT; varying vec3 vN; varying float vDry;
#include <fog_pars_fragment>
void main() {
  vec3 c = vCol * mix(0.5, 1.22, vT);                                  // dark at the root, catching light at the tip
  c = mix(c, c * vec3(1.25, 1.12, 0.62), vT * vT * (0.25 + 0.5 * vDry)); // dry, yellowing tips
  float d = abs(dot(normalize(vN), uL));
  c *= 0.82 + 0.3 * d;
  c += vec3(0.05, 0.06, 0.0) * vT * vT;                                  // light through the tips
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const G = {
  id: 'grass3d',
  init(r3) {
    this.world = null; this.key = '';
    const one = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType); one.needsUpdate = true;
    this.U = {
      uH: { value: one }, uHN: { value: new THREE.Vector2(1, 1) }, uHC: { value: 1 },
      uMask: { value: null }, uMN: { value: new THREE.Vector2(1, 1) },
      uMap: { value: null }, uRep: { value: new THREE.Vector2(1, 1) }, uOff: { value: new THREE.Vector2() },
      uMounds: { value: Array.from({ length: NM }, () => new THREE.Vector4()) },
      uTime: { value: 0 }, uHgt: { value: HGT }, uFoc: { value: new THREE.Vector3() }, uL: { value: KIT.LIGHT_DIR },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogDensity: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, fog: true });
    const base = patchGeo();
    // near: every blade; far: a thinner set of the same patch
    this.parts = [0, 1].map(k => {
      const g = new THREE.InstancedBufferGeometry(); g.copy(base); g.boundingSphere = base.boundingSphere;
      const off = new THREE.InstancedBufferAttribute(new Float32Array(2400 * 2), 2); off.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iOff', off); g.instanceCount = 0;
      if (k) g.setDrawRange(0, Math.round(PER * 0.4) * base.userData.perBlade);
      const mesh = new THREE.Mesh(g, this.mat); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = -4;
      r3.scene.add(mesh);
      return { g, off, mesh };
    });
    this.perBlade = base.userData.perBlade;
  },
  build(r3, world) {
    this.world = world; this.key = '';
    const S = world.surface, U = this.U, T = AL.TERRAIN;
    // heights: the relief's own grid
    if (r3.terr) {
      const tr = r3.terr, tx = new THREE.DataTexture(tr.h, tr.gw, tr.gh, THREE.RedFormat, THREE.FloatType);
      tx.needsUpdate = true; if (U.uH.value) U.uH.value.dispose(); U.uH.value = tx; U.uHN.value.set(tr.gw, tr.gh); U.uHC.value = tr.cell;
    } else { U.uHN.value.set(1, 1); U.uHC.value = 1e6; }
    // where grass grows: lawn cells, off the water's banks, rocks, logs, slabs, stones, blanket and puddles
    const mw = Math.ceil(S.W / MC) + 1, mh = Math.ceil(S.H / MC) + 1, raw = new Uint8Array(mw * mh);
    const ter = S.terrain, gw = S.gw, gh = S.gh, cell = S.cell;
    const terAt = (x, y) => { if (!ter) return T.GRASS; const i = Math.min(gw - 1, Math.max(0, (x / cell) | 0)), j = Math.min(gh - 1, Math.max(0, (y / cell) | 0)); return ter[j * gw + i]; };
    const wets = S.foods.filter(f => f.visual === 'water').map(f => { const p = f.poi || f; return { x: p.x, y: p.y, r: (p.r || f.r || 20) * 1.15 + 6 }; });
    const bank = cell * 0.9;
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      const x = i * MC, y = j * MC;
      if (terAt(x, y) !== T.GRASS) continue;
      if (terAt(x - bank, y) === T.STREAM || terAt(x + bank, y) === T.STREAM || terAt(x, y - bank) === T.STREAM || terAt(x, y + bank) === T.STREAM) continue;
      if (r3.obsAt(x, y) > 0 || r3.obsAt(x + 3, y + 3) > 0) continue;
      let wet = false; for (const w of wets) if ((x - w.x) * (x - w.x) + (y - w.y) * (y - w.y) < w.r * w.r) { wet = true; break; }
      if (!wet) raw[j * mw + i] = 255;
    }
    const m = new Uint8Array(mw * mh);   // softened edges
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= mw || b >= mh) continue; s += raw[b * mw + a]; n++; }
      m[j * mw + i] = s / n;
    }
    if (U.uMask.value) U.uMask.value.dispose();
    const mt = new THREE.DataTexture(m, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
    mt.magFilter = mt.minFilter = THREE.LinearFilter; mt.needsUpdate = true;
    U.uMask.value = mt; U.uMN.value.set(mw, mh);
  },
  update(r3, world, v, t) {
    const P = this.parts, tl = r3.tilt, B = r3.tb;
    const on = !!(tl && r3.ground3d && r3.ground3d.visible && B && AL.R3D.grass !== false && AL.R3D.shadows !== 'off');
    const z = on ? (r3.r.h / tl.vh) / (r3.r.dpr || 1) : 0;   // (screen px per world unit, as cam.z)
    if (!on || z < 0.8) { for (const p of P) p.mesh.visible = false; return; }
    if (this.world !== world) this.build(r3, world);
    const U = this.U, S = world.surface;
    U.uMap.value = B.ut; U.uRep.value.copy(B.ut.repeat); U.uOff.value.copy(B.ut.offset);
    U.uTime.value = t; U.uHgt.value = HGT * AL.clamp((z - 0.8) / 0.4, 0, 1);
    const L = r3.moundList || [];
    for (let k = 0; k < NM; k++) { const md = L[k]; U.uMounds.value[k].set(md ? md.x : 0, md ? md.y : 0, md ? md.R * 1.05 : 0, 0); }
    const fog = r3.scene.fog; if (fog) { U.fogColor.value.copy(fog.color); U.fogNear.value = fog.near; U.fogFar.value = fog.far; }
    // the patches around the focus, out to a radius that shrinks as the view zooms in
    const Rr = Math.min(560, tl.vh * 0.95), fx = tl.fx, fy = tl.fy, near = Rr * 0.5;
    U.uFoc.value.set(fx, fy, Rr);
    const key = Math.round(fx / TS) + ':' + Math.round(fy / TS) + ':' + Math.round(Rr / TS) + ':' + (AL.R3D.shadows === 'low' ? 1 : 0);
    if (key !== this.key) {
      this.key = key;
      const i0 = Math.max(0, Math.floor((fx - Rr) / TS)), i1 = Math.min(Math.ceil(S.W / TS), Math.ceil((fx + Rr) / TS));
      const j0 = Math.max(0, Math.floor((fy - Rr) / TS)), j1 = Math.min(Math.ceil(S.H / TS), Math.ceil((fy + Rr) / TS));
      const n = [0, 0], A = [P[0].off.array, P[1].off.array], lowQ = AL.R3D.shadows === 'low';
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const x = i * TS, y = j * TS, cx = Math.max(x, Math.min(fx, x + TS)), cy = Math.max(y, Math.min(fy, y + TS));
        const d = Math.hypot(cx - fx, cy - fy); if (d > Rr) continue;
        const k = d < near && !lowQ ? 0 : 1; if (n[k] >= 2400) continue;
        A[k][n[k] * 2] = x; A[k][n[k] * 2 + 1] = y; n[k]++;
      }
      for (let k = 0; k < 2; k++) { P[k].g.instanceCount = n[k]; P[k].off.needsUpdate = true; }
    }
    for (const p of P) p.mesh.visible = p.g.instanceCount > 0;
  },
};
R3.extras.push(G);
AL.R3D.grass3d = G;
}
