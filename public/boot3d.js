// Antlands 3D: the loading screen's scene (index.html #boot holds the title, the progress bar and the tips, and
// decides when to leave). A low, golden-hour close-up of a foraging trail: a column of your species' workers carries
// crumbs, seeds, a berry and a scrap of leaf home along a worn dirt path through the grass, with four of them
// hauling one big cookie crumb together, into the mouth of their mound. The camera drifts alongside the big crumb.
// Started as soon as render3d.js has made the ant models; torn down (renderer and GPU memory freed) when the
// loading screen goes.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL && AL.R3D, B = window.BOOT;
const TAU = Math.PI * 2, FR = [0, 1, 0, 2];
const calm = matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const vn = (x, y, s) => R3.vnoise(x + 500, y + 500, s);

function sky() {
  const lin = h => new THREE.Color().setHex(h, THREE.LinearSRGBColorSpace);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { a: { value: lin(0x35507a) }, b: { value: lin(0xf0a868) }, c: { value: lin(0x7a5230) } },
    vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 a, b, c; varying vec3 vP; void main() { float y = vP.y; vec3 col = y > 0.0 ? mix(b, a, pow(clamp(y * 1.8, 0.0, 1.0), 0.6)) : mix(b, c, clamp(-y * 5.0, 0.0, 1.0)); gl_FragColor = vec4(col, 1.0); }',
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), m); s.frustumCulled = false; s.renderOrder = -10;
  return s;
}
let dot = null;
function softDot() {
  if (dot) return dot;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (dot = new THREE.CanvasTexture(c));
}

function build() {
  const cv = document.getElementById('bootCv');
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.08;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(34, 1, 1, 3000);
  scene.fog = new THREE.Fog(0xd9955c, 120, 620);
  scene.add(sky());
  scene.add(new THREE.HemisphereLight(0xffe2b8, 0x3a2812, 0.95));
  const sun = new THREE.DirectionalLight(0xffc488, 3.6); sun.position.set(-220, 120, -160); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -240, right: 240, top: 240, bottom: -240, near: 10, far: 800 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0xffa060, 1.2); rim.position.set(200, 60, 220); scene.add(rim);

  // the trail: from the right, winding left to the mound's mouth
  const path = new THREE.CatmullRomCurve3([[330, -40], [250, -10], [170, 22], [90, 8], [20, -18], [-60, -6], [-130, 20], [-200, 14], [-262, 0]].map(p => new THREE.Vector3(p[0], 0, p[1])));
  const pts = path.getSpacedPoints(160), MOUND = { x: -282, z: 0, r: 46, h: 26 };
  const toPath = (x, z) => { let d = 1e9; for (const p of pts) { const dd = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (dd < d) d = dd; } return Math.sqrt(d); };
  const moundH = (x, z) => { const d = Math.hypot(x - MOUND.x, z - MOUND.z); if (d >= MOUND.r) return 0; const t = d / MOUND.r; let y = MOUND.h * Math.pow(1 - t * t, 1.5); if (d < 7) y *= 0.7 + 0.3 * (d / 7); return y; };
  const ground = (x, z) => 7 * vn(x / 160, z / 160, 3) + 2.4 * vn(x / 50, z / 50, 5) + 0.7 * vn(x / 14, z / 14, 9) - 0.9 * Math.max(0, 1 - toPath(x, z) / 9);
  const H = (x, z) => ground(x, z) + moundH(x, z);

  const gG = new THREE.PlaneGeometry(1100, 900, 220, 180).rotateX(-Math.PI / 2), gp = gG.attributes.position;
  const gc = new Float32Array(gp.count * 3), c = new THREE.Color();
  const grassA = new THREE.Color('#4a6626'), grassB = new THREE.Color('#86a03e'), dirt = new THREE.Color('#7c5a36'), dirt2 = new THREE.Color('#5e4228'), soil = new THREE.Color('#8f6a42');
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i); gp.setY(i, H(x, z));
    const dp = toPath(x, z), dm = Math.hypot(x - MOUND.x, z - MOUND.z);
    c.copy(grassA).lerp(grassB, vn(x / 45, z / 45, 11));
    c.lerp(dirt, Math.max(0, 1 - dp / 14) * (0.85 + 0.15 * vn(x / 6, z / 6, 13)));
    if (dp < 5) c.lerp(dirt2, 0.35);
    if (dm < MOUND.r * 1.15) c.lerp(soil, Math.min(1, (MOUND.r * 1.15 - dm) / 14)).multiplyScalar(dm < 6 ? 0.25 + dm / 8 : 1);
    gc.set([c.r, c.g, c.b], i * 3);
  }
  gG.setAttribute('color', new THREE.BufferAttribute(gc, 3)); gG.computeVertexNormals();
  const gm = new THREE.Mesh(gG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); gm.receiveShadow = true; scene.add(gm);

  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s3 = new THREE.Vector3();
  // grass: instanced blades swaying in the wind (kept off the trail and the mound)
  const timeU = { value: 0 };
  const bladeG = new THREE.ConeGeometry(0.5, 1, 3, 1, true).translate(0, 0.5, 0);
  const bladeM = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  bladeM.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n  float sw = (sin(uTime * 1.6 + instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07) * 0.6 + sin(uTime * 0.7 + instanceMatrix[3].x * 0.013) * 0.4) * 0.22 * position.y * position.y;\n  transformed.x += sw; transformed.z += sw * 0.4;\n#endif');
  };
  const NB = calm ? 3500 : 7000, blades = new THREE.InstancedMesh(bladeG, bladeM, NB), gA = new THREE.Color('#58782a'), gB = new THREE.Color('#b0b852');
  let nb = 0;
  for (let k = 0; nb < NB && k < NB * 4; k++) {
    const x = (Math.random() - 0.5) * 900, z = -220 + Math.random() * 520;
    if (toPath(x, z) < 11 || Math.hypot(x - MOUND.x, z - MOUND.z) < MOUND.r * 1.2) continue;
    const near = Math.abs(z) < 120, hgt = (near ? 6 : 9) + Math.random() * (near ? 10 : 16);
    e.set((Math.random() - 0.5) * 0.5, Math.random() * TAU, (Math.random() - 0.5) * 0.5); q.setFromEuler(e);
    M.compose(v.set(x, H(x, z), z), q, s3.set(1, hgt, 1)); blades.setMatrixAt(nb, M); blades.setColorAt(nb, c.copy(gA).lerp(gB, Math.random() * 0.8)); nb++;
  }
  blades.count = nb; blades.receiveShadow = true; blades.castShadow = true; scene.add(blades);
  // pebbles and clods
  const peb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 260);
  for (let i = 0; i < 260; i++) {
    let x, z, k = 0; do { x = (Math.random() - 0.5) * 700; z = -160 + Math.random() * 380; k++; } while (toPath(x, z) < 6 && k < 8);
    const s = 0.8 + Math.random() * (toPath(x, z) < 20 ? 1.6 : 4); e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e);
    M.compose(v.set(x, H(x, z) + s * 0.25, z), q, s3.set(s, s * 0.6, s)); peb.setMatrixAt(i, M); peb.setColorAt(i, c.setHSL(0.07, 0.1, 0.42 + Math.random() * 0.25));
  }
  peb.castShadow = peb.receiveShadow = true; scene.add(peb);
  // the mound at the end of the trail: a soil heap with crumbs of earth on it
  { const prof = []; for (let i = 0; i <= 30; i++) { const rr = i / 30 * MOUND.r; prof.push(new THREE.Vector2(Math.max(0.01, rr), moundH(MOUND.x + rr, MOUND.z) + ground(MOUND.x + rr, MOUND.z))); }
    const mG = new THREE.LatheGeometry(prof, 80), mp = mG.attributes.position, mc = new Float32Array(mp.count * 3), sl = new THREE.Color('#a77c50'), sd = new THREE.Color('#5c412a'), hole = new THREE.Color('#140a04');
    for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), z = mp.getZ(i), d = Math.hypot(x, z); if (d > 8 && d < MOUND.r * 0.95) mp.setY(i, mp.getY(i) + (vn(x / 4, z / 4, 21) - 0.5) * 1.6); c.copy(sd).lerp(sl, Math.min(1, mp.getY(i) / MOUND.h) * 0.8 + vn(x / 2.5, z / 2.5, 23) * 0.25); if (d < 7) c.lerp(hole, 1 - d / 7); mc.set([c.r, c.g, c.b], i * 3); }
    mG.setAttribute('color', new THREE.BufferAttribute(mc, 3)); mG.computeVertexNormals(); mG.translate(MOUND.x, 0, MOUND.z);
    const mm = new THREE.Mesh(mG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); mm.castShadow = mm.receiveShadow = true; scene.add(mm);
    const cl = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#8e6640', roughness: 1, flatShading: true }), 140);
    for (let i = 0; i < 140; i++) { const a = Math.random() * TAU, d = 8 + Math.sqrt(Math.random()) * MOUND.r, x = MOUND.x + Math.cos(a) * d, z = MOUND.z + Math.sin(a) * d, s = 0.5 + Math.random() * 1.2; e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e); M.compose(v.set(x, H(x, z) + s * 0.3, z), q, s3.set(s, s * 0.7, s)); cl.setMatrixAt(i, M); }
    cl.castShadow = cl.receiveShadow = true; scene.add(cl); }
  // a fallen leaf and a twig beside the trail
  const leaf = (x, z, sx, sz, rot, col) => {
    const g = new THREE.PlaneGeometry(1, 1, 14, 6).rotateX(-Math.PI / 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i), w = p.getZ(i), edge = 1 - Math.pow(Math.abs(u * 2), 2.2); p.setX(i, u * sx); p.setZ(i, w * sz * Math.max(0.05, edge)); p.setY(i, Math.abs(w) * 3 + Math.sin(u * 5) * 0.8); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, side: THREE.DoubleSide }));
    m.position.set(x, H(x, z) + 0.6, z); m.rotation.y = rot; m.castShadow = m.receiveShadow = true; scene.add(m);
  };
  leaf(60, 52, 70, 34, 0.5, '#b8862c'); leaf(-150, -46, 54, 26, 2.2, '#7d8a2e'); leaf(210, 60, 46, 22, -0.8, '#a4542a');
  { const tw = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2, 120, 7).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6a4a2c', roughness: 1, flatShading: true })); tw.position.set(-40, H(-40, -52) + 1.6, -52); tw.rotation.y = 0.35; tw.castShadow = tw.receiveShadow = true; scene.add(tw); }

  // the ants: your species' workers, each carrying something home
  const key = (AL.UI && AL.UI.species) || (function () { try { return localStorage.getItem('antlands.species'); } catch (_) { return null; } })() || 'fire';
  const sp = (AL.SPECIES && (AL.SPECIES[key] || AL.SPECIES.fire)) || {};
  const cols = Object.assign({}, sp, { look: sp.look || key }), W = AL.CASTE.WORKER, sz = (AL.CASTES[W].size || 1) * Math.min(1.4, sp.size || 1);
  const std = (col, rough) => new THREE.MeshStandardMaterial({ color: col, roughness: rough == null ? 0.6 : rough });
  const LOADS = [
    () => new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), std('#e9d29a', 0.8)),                  // a crumb
    () => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(2.1, 1.1, 1.3), std('#c69a52', 0.5)),   // a seed
    () => new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), std('#b8322e', 0.25)),                    // a berry
    () => new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), std('#f6f2ea', 0.35)),                     // sugar
    () => { const g = new THREE.PlaneGeometry(4.4, 3, 4, 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i)) * 0.5); g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#6f9a2e', roughness: 0.6, side: THREE.DoubleSide })); m.rotation.set(-0.9, 0.3, 0); return m; },   // a scrap of leaf
  ];
  const L = path.getLength(), ants = [];
  const addAnt = (u, load) => {
    const m = R3.antModel(cols, W); m.scale.setScalar(sz);
    if (load) { const it = LOADS[load % LOADS.length](); it.position.set(7.4, 1.8, 0); it.castShadow = true; m.add(it); }
    scene.add(m); return m;
  };
  for (let i = 0; i < 16; i++) ants.push({ m: addAnt(0, i + 1), u: i / 16, lane: (Math.random() - 0.5) * 5, sp: 9 + Math.random() * 2.5, ph: Math.random() * 10 });
  // four of them with one big crumb of cookie between them
  const big = new THREE.Mesh(new THREE.DodecahedronGeometry(6.5, 1), std('#c48a4a', 0.85));
  { const p = big.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.85 + vn(p.getX(i) * 0.4, p.getZ(i) * 0.4 + p.getY(i) * 0.3, 41) * 0.3; p.setXYZ(i, p.getX(i) * k * 1.2, p.getY(i) * k * 0.75, p.getZ(i) * k); } big.geometry.computeVertexNormals(); }
  big.castShadow = true; scene.add(big);
  const chips = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), std('#3a2414', 0.4), 9);
  for (let i = 0; i < 9; i++) { const a = Math.random() * TAU, h = Math.random() * 0.8 - 0.1; M.compose(v.set(Math.cos(a) * 6.4 * Math.sqrt(1 - h * h), h * 4.2 + 1.4, Math.sin(a) * 5.4 * Math.sqrt(1 - h * h)), q.identity(), s3.setScalar(0.45 + Math.random() * 0.35)); chips.setMatrixAt(i, M); }
  big.add(chips);
  const crew = [[-7, 7, 0.4], [-7, -7, -0.4], [6, 7.5, 0.3], [6, -7.5, -0.3]].map(o => ({ m: addAnt(0, 0), dx: o[0], dz: o[1], a: o[2], ph: Math.random() * 10 }));
  const bigU = { u: 0.18 };

  // dust in the low sun
  const N = calm ? 120 : 360, mp = new Float32Array(N * 3), base = [];
  for (let i = 0; i < N; i++) { const p = [(Math.random() - 0.5) * 520, 2 + Math.random() * 90, -140 + Math.random() * 280, Math.random() * TAU]; mp.set(p.slice(0, 3), i * 3); base.push(p); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ size: 2.2, map: softDot(), color: 0xffd8a0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(motes);

  const tg = new THREE.Vector3(), tn = new THREE.Vector3(), look = new THREE.Vector3(), camP = new THREE.Vector3();
  const place = (o, u, lane, back) => {
    path.getPointAt(u, tg); path.getTangentAt(u, tn);
    const x = tg.x - tn.z * lane, z = tg.z + tn.x * lane;
    o.position.set(x, H(x, z), z); o.rotation.y = Math.atan2(tn.z, -tn.x) + (back || 0);   // (walking toward the mound: down the path)
    return o;
  };
  const resize = () => { const w = innerWidth, h = innerHeight; r.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  resize(); addEventListener('resize', resize);

  let t0 = performance.now(), last = t0, raf = 0, first = true;
  const frame = now => {
    if (B.done && B.gone) { stop(); return; }
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)), t = Math.max(0, (now - t0) / 1000); last = now;
    timeU.value = t;
    for (const a of ants) {
      a.u = (((a.u - a.sp * dt / L) % 1) + 1) % 1;
      place(a.m, a.u, a.lane);
      a.m.position.y += Math.abs(Math.sin(t * 11 + a.ph)) * 0.25;
      a.m.visible = a.u > 0.02;   // (into the mound's mouth)
      a.m.userData.frame(FR[((t * 10 + a.ph) | 0) & 3]);
    }
    // the big crumb: slower, a little wobble as the four of them heave it along
    bigU.u -= 6.5 * dt / L; if (!(bigU.u >= 0.03 && bigU.u <= 1)) bigU.u = 0.97;
    place(big, bigU.u, 0); big.position.y += 4.2 + Math.sin(t * 5) * 0.35; big.rotation.z = Math.sin(t * 3.1) * 0.05; big.rotation.x = Math.sin(t * 2.3) * 0.04;
    const ca = Math.cos(big.rotation.y), sa = Math.sin(big.rotation.y);
    for (const w of crew) {
      const x = big.position.x + w.dx * ca + w.dz * sa, z = big.position.z - w.dx * sa + w.dz * ca;
      w.m.position.set(x, H(x, z), z); w.m.rotation.y = big.rotation.y + w.a; w.m.userData.frame(FR[((t * 7 + w.ph) | 0) & 3]);
    }
    for (let i = 0; i < N; i++) { const b = base[i]; mp[i * 3] = b[0] + Math.sin(t * 0.3 + b[3]) * 5; mp[i * 3 + 2] = b[2] + Math.cos(t * 0.25 + b[3]) * 5; mp[i * 3 + 1] = 2 + ((b[1] + t * 2) % 90); }
    mg.attributes.position.needsUpdate = true;
    // camera: low beside the big crumb, drifting slowly round it (still for reduced motion)
    look.copy(big.position); look.y = H(look.x, look.z) + 5;
    const ang = calm ? 0.9 : 0.75 + Math.sin(t * 0.16) * 0.35, R = calm ? 92 : 86 + Math.sin(t * 0.11) * 10;
    camP.set(look.x + Math.cos(ang) * R * 0.55, look.y + 15 + (calm ? 0 : Math.sin(t * 0.21) * 3), look.z + Math.sin(ang) * R);
    if (first) cam.position.copy(camP); else cam.position.lerp(camP, Math.min(1, dt * 2));
    cam.lookAt(look.x - 18, look.y, look.z);
    sun.target.position.copy(look); sun.position.set(look.x - 220, 120, look.z - 160);
    r.render(scene, cam);
    if (first) { first = false; document.getElementById('boot').classList.add('live'); }
    raf = requestAnimationFrame(frame);
  };
  let stopped = false;
  const stop = () => {
    if (stopped) return; stopped = true;
    cancelAnimationFrame(raf); removeEventListener('resize', resize);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); } } });
    r.dispose(); r.forceContextLoss();
  };
  B.stop3d = stop; B.frame3d = frame;   // (frame3d: for driving it by hand in a test)
  raf = requestAnimationFrame(frame);
}

if (B && !B.done && R3 && R3.antModel && document.getElementById('bootCv')) {
  try { build(); } catch (err) { console.warn('[Antlands] loading screen 3D', err); }
}
