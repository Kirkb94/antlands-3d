// Antlands 3D: the yard's flat bits made solid. The patio's slabs stand up off the lawn, the stepping stones are
// real stones, the picnic blanket is a cloth with folds lying on the grass, and streams, ponds and puddles get a
// glossy water surface over their painted beds. Ants walk up onto all of them (render3d.js buildObstacles), and
// the 2D blanket stands down while the 3D surface draws (AL.R3D.active).
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL.R3D, KIT = R3 && R3.kit;
if (KIT) {
const { Builder, Pool, M, col, WHITE } = KIT;
const TAU = Math.PI * 2;
const BOX = new THREE.BoxGeometry(1, 1, 1), DISC = new THREE.CylinderGeometry(1, 1, 1, 22);
const SLAB_H = 3.5, STONE_H = 2.6;
const _c = new THREE.Color();
const CC = { slab: col('#b2aa9c'), slab2: col('#a49c8e'), slabSide: col('#7c766a'), stone: col('#bdb7a8'), stone2: col('#948e80'), stoneSide: col('#6e695e'),
  cream: col('#f4ede0'), red: col('#c8302a'), redL: col('#e0857a'), hem: col('#8a2a1e') };

// the 2D blanket stands down while the 3D one is drawn
const WA = AL.WorldArt;
if (WA && WA.drawBlanket) { const f = WA.drawBlanket; WA.drawBlanket = function () { if (R3.active) return; return f.apply(this, arguments); }; }

function patioGeo(r3, S) {
  const p = S.patio; if (!p) return null;
  const b = new Builder(), slab = 70, R = AL.rng(4401);
  for (let yy = 0; yy < p.h; yy += slab) for (let xx = 0; xx < p.w; xx += slab) {
    const w = Math.min(slab, p.w - xx) - 4, h = Math.min(slab, p.h - yy) - 4, cx = p.x + xx + 2 + w / 2, cz = p.y + yy + 2 + h / 2;
    const g = r3.T(cx, cz), v = 0.88 + R() * 0.14, tilt = (R() - 0.5) * 0.012;
    b.add(BOX, M(cx, g + SLAB_H / 2 - 0.4, cz, w, SLAB_H, h, tilt, 0, (R() - 0.5) * 0.012), null, (x, y, z, nx, ny) => {
      if (ny > 0.7) { const n = AL.hash2(Math.round(x * 0.5), Math.round(z * 0.5), 7); return _c.copy(CC.slab).lerp(CC.slab2, n * 0.6).multiplyScalar(v); }
      return _c.copy(CC.slabSide).multiplyScalar(v);
    });
  }
  return b.build();
}
function stonesGeo(r3, S) {
  if (!S.stones || !S.stones.length) return null;
  const b = new Builder();
  for (const st of S.stones) {
    const g0 = r3.T(st.x, st.y), seed = (st.seed | 0) + 3;
    const geo = DISC.clone(), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {   // a slightly lumpy, domed top
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), r = Math.hypot(x, z);
      const w = 1 + (AL.hash2(Math.round(a * 3), 1, seed) - 0.5) * 0.12;
      p.setXYZ(i, x * w, y > 0 ? y + 0.25 * (1 - r * r) : y, z * w);
    }
    geo.computeVertexNormals();
    b.add(geo, M(st.x, g0 + STONE_H / 2 - 0.5, st.y, st.rx, STONE_H, st.ry, 0, -(st.rot || 0), 0), null, (x, y, z, nx, ny) => {
      if (ny > 0.6) { const n = AL.hash2(Math.round(x * 0.4), Math.round(z * 0.4), seed); return _c.copy(CC.stone).lerp(CC.stone2, n * 0.7); }
      return CC.stoneSide;
    });
    geo.dispose();
  }
  return b.build();
}
// the picnic blanket: a gingham cloth with soft folds and a dropped hem, lying on the lawn
function blanketGeo(r3, bl) {
  const w = bl.w, h = bl.h, nx = 48, nz = 34, g = new THREE.PlaneGeometry(w, h, nx, nz).rotateX(-Math.PI / 2);
  const p = g.attributes.position, colr = new Float32Array(p.count * 3), c = 23;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), u = (x + w / 2) / w, v = (z + h / 2) / h;
    const edge = Math.min(u, 1 - u, v, 1 - v) * Math.min(w, h);   // distance in from the hem
    const fold = 0.9 * Math.sin(x * 0.045 + z * 0.02) + 0.6 * Math.sin(z * 0.09 - x * 0.03 + 1.3) + 1.6 * Math.exp(-Math.pow((x * 0.6 + z * 0.8 + w * 0.12) / 14, 2));
    const y = 0.6 + Math.max(0, fold) * 0.9 * AL.clamp(edge / 18, 0, 1) - (edge < 4 ? (4 - edge) * 0.12 : 0);
    p.setY(i, y);
    const ci = Math.floor((x + w / 2) / c), cj = Math.floor((z + h / 2) / c), stripe = ((x + w / 2) % c) / c;
    _c.copy(((ci + cj) & 1) ? CC.red : CC.cream);
    if (!((ci + cj) & 1) && stripe > 0.35 && stripe < 0.65) _c.lerp(CC.redL, 0.55);
    if (edge < 3) _c.copy(CC.hem);
    colr[i * 3] = _c.r; colr[i * 3 + 1] = _c.g; colr[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  g.computeVertexNormals();
  g.rotateY(-(bl.rot || 0)); g.translate(bl.x, 0, bl.y);
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + r3.T(p.getX(i), p.getZ(i)));   // draped over the rolling lawn
  g.computeVertexNormals();
  return g;
}
// water surfaces over the painted streams and ponds: one smooth sheet, see-through at the banks
function waterGeo(r3, S) {
  const T = AL.TERRAIN; if (!S.terrain || !T) return null;
  const gw = S.gw, gh = S.gh, cell = S.cell, ter = S.terrain, wet = i => ter[i] === T.STREAM;
  let any = false; for (let i = 0; i < ter.length && !any; i++) any = wet(i);
  if (!any) return null;
  // vertex (i, j) sits at the corner shared by cells (i-1..i, j-1..j): its wetness is how many of them are water
  const vw = gw + 1, vh = gh + 1, wv = new Float32Array(vw * vh);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    let n = 0, k = 0;
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const ci = i + di, cj = j + dj; if (ci < 0 || cj < 0 || ci >= gw || cj >= gh) continue; k++; if (wet(cj * gw + ci)) n++; }
    wv[j * vw + i] = k ? n / k : 0;
  }
  // how far each water cell is from the bank (chamfer distance, in cells): deep in the middle, shallow at the edges
  const dist = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) dist[i] = wet(i) ? 1e6 : 0;
  const relax = (i, j, di, dj, w) => { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= gw || b >= gh) return; const k = j * gw + i, v = dist[b * gw + a] + w; if (v < dist[k]) dist[k] = v; };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { relax(i, j, -1, 0, 1); relax(i, j, 0, -1, 1); relax(i, j, -1, -1, 1.414); relax(i, j, 1, -1, 1.414); }
  for (let j = gh - 1; j >= 0; j--) for (let i = gw - 1; i >= 0; i--) { relax(i, j, 1, 0, 1); relax(i, j, 0, 1, 1); relax(i, j, 1, 1, 1.414); relax(i, j, -1, 1, 1.414); }
  const pos = [], cols = [], idx = [], map = new Int32Array(vw * vh).fill(-1);
  const vert = (i, j) => {
    const o = j * vw + i; if (map[o] >= 0) return map[o];
    const x = i * cell, z = j * cell, a = wv[o];
    let dsum = 0, dn = 0;
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const ci = i + di, cj = j + dj; if (ci < 0 || cj < 0 || ci >= gw || cj >= gh) continue; dn++; if (wet(cj * gw + ci)) dsum += Math.min(dist[cj * gw + ci], 60) - 0.5; }
    const depth = dn ? Math.max(0, dsum / dn) * cell : 0;   // (world units from the bank)
    map[o] = pos.length / 3; pos.push(x, r3.T(x, z) + 0.9, z); cols.push(Math.min(1, depth / 255), 1, 1, Math.pow(a, 0.8));
    return map[o];
  };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (!(wv[j * vw + i] || wv[j * vw + i + 1] || wv[(j + 1) * vw + i] || wv[(j + 1) * vw + i + 1])) continue;
    const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// the water itself (shader-dev): sharp-crested waves summed in many directions, each octave dragged by the last so
// ripples bunch up; Schlick Fresnel against a sky colour; a sun glint; colour from shallow (the bed showing through,
// with caustics) to deep by the distance from the bank; broken foam along the banks; see-through at the very edge.
// Lit by hand to match the painted ground (not tone mapped).
const WATER_VS = `
varying vec3 vW; varying float vA; varying float vD;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
#ifdef PUDDLE
  float r = length(position.xz);
  vD = (1.0 - r) * 26.0; vA = smoothstep(1.0, 0.82, r);
#else
  vD = color.r * 255.0; vA = color.a;
#endif
  vec4 wp = modelMatrix * vec4(p, 1.0);
#ifdef USE_INSTANCING
  wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
#endif
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = `
uniform float uTime; uniform vec3 uL;
varying vec3 vW; varying float vA; varying float vD;
#include <fog_pars_fragment>
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y); }
void main() {
  vec2 p = vW.xz; float t = mod(uTime, 1000.0);
  // waves: exp(sin) crests, 9 octaves, position dragged by each octave's slope
  vec2 g = vec2(0.0), pp = p; float h = 0.0, ws = 0.0, a = 1.0, f = 0.11, sp = 1.5, ang = 0.0;
  for (int i = 0; i < 9; i++) {
    vec2 d = vec2(sin(ang), cos(ang));
    float x = dot(d, pp) * f + t * sp, w = exp(sin(x) - 1.0), dx = w * cos(x);
    pp -= d * dx * a * 0.38;
    h += w * a; g += d * dx * a * f; ws += a;
    a *= 0.8; f *= 1.18; sp *= 1.07; ang += 1.93;
  }
  h /= ws; g /= ws;
  vec3 V = normalize(cameraPosition - vW);
  float far = smoothstep(200.0, 1600.0, length(cameraPosition - vW));
  vec3 N = normalize(vec3(-g.x * 9.0 * (1.0 - far * 0.7), 1.0, -g.y * 9.0 * (1.0 - far * 0.7)));
  float ndv = max(dot(N, V), 0.0);
  float F = 0.03 + 0.97 * pow(1.0 - ndv, 5.0);
  float depth = 1.0 - exp(-vD / 22.0);
  vec3 shallow = lin(vec3(0.32, 0.45, 0.36)), deep = lin(vec3(0.08, 0.22, 0.28));
  vec3 body = mix(shallow, deep, depth);
  body *= 0.82 + 0.3 * h;                                            // crests a little brighter
  // caustics on the bed, fading with depth
  vec2 q = p * 0.16 + vec2(t * 0.25, -t * 0.18);
  float cn = vn(q + 2.0 * vec2(vn(q * 0.7 + t * 0.1), vn(q * 0.7 + 5.2)));
  float ca = pow(1.0 - abs(cn * 2.0 - 1.0), 7.0);
  body += lin(vec3(0.85, 0.95, 0.8)) * ca * 0.22 * (1.0 - depth);
  // sky reflection and the sun
  vec3 R = reflect(-V, N);
  vec3 sky = mix(lin(vec3(0.78, 0.86, 0.92)), lin(vec3(0.42, 0.62, 0.84)), clamp(R.y, 0.0, 1.0));
  vec3 c = mix(body, sky, clamp(F + 0.1, 0.0, 1.0));
  float sp2 = pow(max(dot(R, uL), 0.0), 320.0);
  c += lin(vec3(1.0, 0.96, 0.85)) * sp2 * 2.6;
  // foam: a broken band along the banks, drifting
  float shore = 1.0 - smoothstep(0.0, 5.0, vD);
  float fn = vn(p * 0.28 + vec2(t * 0.35, t * 0.12)) * 0.6 + vn(p * 0.8 - t * 0.25) * 0.4;
  float foam = smoothstep(0.55, 0.8, fn + shore * 0.55) * shore;
  c = mix(c, lin(vec3(0.86, 0.9, 0.86)), foam * 0.5);
  float al = mix(0.7, 0.94, depth) + F * 0.4 + sp2;
  al = max(al, foam * 0.7) * smoothstep(0.0, 0.55, vA);
  gl_FragColor = vec4(c, clamp(al, 0.0, 1.0));
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
function waterMat(puddle) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uL: { value: KIT.LIGHT_DIR }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 2000 }, fogDensity: { value: 0 } },
    vertexShader: WATER_VS, fragmentShader: WATER_FS, defines: puddle ? { PUDDLE: 1 } : {},
    transparent: true, depthWrite: false, vertexColors: !puddle, fog: true,
  });
}

const Y = {
  id: 'yard3d',
  init(r3) {
    this.r3 = r3; this.world = null; this.meshes = [];
    this.stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.waterMat = waterMat(false);
    this.puddleMat = waterMat(true);
    this.puddles = new Pool(r3, DISC, this.puddleMat, false);
  },
  build(r3, world) {
    for (const m of this.meshes) { r3.scene.remove(m); m.geometry.dispose(); }
    this.meshes = []; this.world = world;
    const S = world.surface, add = (g, mat, cast, recv) => { if (!g) return; const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = recv; m.frustumCulled = false; r3.scene.add(m); this.meshes.push(m); return m; };
    add(patioGeo(r3, S), this.stoneMat, true, true);
    add(stonesGeo(r3, S), this.stoneMat, true, true);
    const bl = world.poi && world.poi.blanket;
    if (bl) add(blanketGeo(r3, bl), this.clothMat, false, true);
    const wm = add(waterGeo(r3, S), this.waterMat, false, false);
    if (wm) wm.renderOrder = 2;
  },
  update(r3, world, v, t) {
    if (this.world !== world) this.build(r3, world);
    this.waterMat.uniforms.uTime.value = this.puddleMat.uniforms.uTime.value = t;
    // puddles: the painted bed stays; a shiny surface over it, shrinking as it dries
    const P = this.puddles; P.begin();
    const S = world.surface;
    for (const f of S.foods) {
      if (f.gone || f.visual !== 'water') continue;
      const p = f.poi || f, r = p.r || 0;
      if (!(r > 2) || !isFinite(r)) continue;   // (dried up)
      if (p.x + r < v.x0 || p.x - r > v.x1 || p.y + r < v.y0 || p.y - r > v.y1) continue;
      P.put(p.x, r3.T(p.x, p.y) + 0.5, p.y, 0, r * 0.98, 0.3, r * 0.8, WHITE);
    }
    P.end();
  },
};
R3.extras.push(Y);
AL.R3D.yard3d = { SLAB_H, STONE_H };
}
