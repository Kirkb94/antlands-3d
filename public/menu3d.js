// Antlands 3D title screen: three rough drafts to pick from, each a Three.js scene behind the original title panel
// (species picker, perks, map, Start / Campaign / How to play all work as before).
//   A  Golden hour mound   a low camera circles a big anthill at sunset, a column of your ants marching out
//   B  Into the nest       a cut-away of the soil: carved tunnels, glowing chambers, eggs, the queen, ants at work
//   C  Species showcase    a studio turntable: a giant ant of the species you picked, with its soldier and major
// The corner switcher flips between them (remembered); ?menu=A|B|C picks one too. The ants are the game's 3D models
// (render3d.js antModel) in the selected species' build and colours, and change when you pick another species.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, UI = AL.UI, R3 = AL.R3D, C = AL.CASTE, TAU = Math.PI * 2;
const DRAFTS = [{ key: 'A', name: 'Golden hour mound' }, { key: 'B', name: 'Into the nest' }, { key: 'C', name: 'Species showcase' }];
const vn = (x, y, s) => R3.vnoise(x + 1000, y + 1000, s);
const $ = id => document.getElementById(id);
let draft = 0;
try { const q = (new URLSearchParams(location.search).get('menu') || localStorage.getItem('antlands.menuDraft') || 'A').toUpperCase(); draft = Math.max(0, 'ABC'.indexOf(q)); } catch (_) { draft = 0; }

let renderer = null, cv = null, sw = null, active = null, raf = 0, last = 0, mx = 0, my = 0;
const timeU = { value: 0 };

// ---- shared bits ---------------------------------------------------------------------------------------------
function specCols() {
  const key = UI.species || 'fire', sp = AL.SPECIES[key] || AL.SPECIES.fire;
  return { key, sp, cols: Object.assign({}, sp, { look: sp.look || key }) };
}
function lin(hex) { return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace); }
// gradient sky dome (colours written as given)
function sky(top, mid, bot) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { a: { value: lin(top) }, b: { value: lin(mid) }, c: { value: lin(bot) } },
    vertexShader: 'varying vec3 vP; void main() { vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 a, b, c; varying vec3 vP; void main() { float y = vP.y; vec3 col = y > 0.0 ? mix(b, a, pow(clamp(y * 1.6, 0.0, 1.0), 0.7)) : mix(b, c, clamp(-y * 4.0, 0.0, 1.0)); gl_FragColor = vec4(col, 1.0); }',
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), m); s.renderOrder = -10; s.frustumCulled = false;
  return s;
}
let dotTex = null;
function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (dotTex = new THREE.CanvasTexture(c));
}
// floating motes (dust, pollen, embers) in a box
function motes(n, box, color, size, opacity) {
  const pos = new Float32Array(n * 3), base = [];
  for (let i = 0; i < n; i++) {
    const x = box[0] + Math.random() * (box[3] - box[0]), y = box[1] + Math.random() * (box[4] - box[1]), z = box[2] + Math.random() * (box[5] - box[2]);
    pos.set([x, y, z], i * 3); base.push([x, y, z, Math.random() * TAU]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: softDot(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  p.userData.tick = t => {
    for (let i = 0; i < n; i++) {
      const b = base[i], h = box[4] - box[1];
      pos[i * 3] = b[0] + Math.sin(t * 0.3 + b[3]) * 6; pos[i * 3 + 2] = b[2] + Math.cos(t * 0.25 + b[3]) * 6;
      pos[i * 3 + 1] = box[1] + ((b[1] - box[1] + t * 2.2) % h);
    }
    g.attributes.position.needsUpdate = true;
  };
  return p;
}
// grass blades that sway (instanced cones)
function grass(n, place, tint) {
  const geo = new THREE.ConeGeometry(0.55, 1, 3, 1, true).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n  float sw = sin(uTime * 1.7 + instanceMatrix[3].x * 0.05 + instanceMatrix[3].z * 0.07) * 0.2 * position.y;\n  transformed.x += sw; transformed.z += sw * 0.5;\n#endif');
  };
  const m = new THREE.InstancedMesh(geo, mat, n), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), cA = new THREE.Color(tint[0]), cB = new THREE.Color(tint[1]), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = place(i);
    e.set((Math.random() - 0.5) * 0.4, Math.random() * TAU, (Math.random() - 0.5) * 0.4); q.setFromEuler(e);
    M.compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, p[3], 1)); m.setMatrixAt(i, M);
    m.setColorAt(i, c.copy(cA).lerp(cB, Math.random()));
  }
  m.receiveShadow = true;
  return m;
}
function rockGeo(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.82 + 0.3 * vn(x * 2.2, z * 2.2 + y * 1.7, seed); p.setXYZ(i, x * k, y * k, z * k); }
  g.computeVertexNormals();
  return g;
}
function paint(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i)); cols.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}
const FR = [0, 1, 0, 2];

// ---- A: golden hour mound ------------------------------------------------------------------------------------
function draftA() {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  scene.fog = new THREE.Fog(0xd99a62, 170, 760);
  scene.add(sky(0x2c4a7a, 0xe8a066, 0x6a4a2a));
  scene.add(new THREE.HemisphereLight(0xffe0b0, 0x3a2a14, 0.9));
  const sun = new THREE.DirectionalLight(0xffbf80, 3.4); sun.position.set(-260, 110, -140); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 900 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun);
  const MR = 50, MH = 30;
  const moundH = d => { if (d >= MR) return 0; const t = d / MR; let y = MH * Math.pow(1 - t * t, 1.4); if (d < 9) { const u = d / 9; y *= 0.82 + 0.18 * u * u; } return y; };
  const hT = (x, z) => { const d = Math.hypot(x, z), f = AL.clamp((d - 55) / 90, 0, 1), s = f * f * (3 - 2 * f); return s * (12 * vn(x / 210, z / 210, 3) + 4 * vn(x / 70, z / 70, 5) + 1.3 * vn(x / 20, z / 20, 9) - 6); };
  const surf = (x, z) => { const d = Math.hypot(x, z); return d < MR ? moundH(d) : hT(x, z); };
  // the yard
  const gG = new THREE.PlaneGeometry(1500, 1500, 230, 230).rotateX(-Math.PI / 2), gp = gG.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, hT(gp.getX(i), gp.getZ(i)));
  gG.computeVertexNormals();
  const grassA = new THREE.Color('#4c6a28'), grassB = new THREE.Color('#7f9a3c'), dirt = new THREE.Color('#7a5a36');
  paint(gG, (c, x, y, z) => { const d = Math.hypot(x, z); c.copy(grassA).lerp(grassB, vn(x / 40, z / 40, 11)); c.lerp(dirt, AL.clamp(1 - (d - 50) / 45, 0, 1) * 0.85 + vn(x / 25, z / 25, 13) * 0.15); });
  const ground = new THREE.Mesh(gG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); ground.receiveShadow = true; scene.add(ground);
  // the mound
  const prof = []; for (let i = 0; i <= 40; i++) { const r = i / 40 * MR; prof.push(new THREE.Vector2(Math.max(0.01, r), moundH(r))); }
  const mG = new THREE.LatheGeometry(prof, 96), mp = mG.attributes.position;
  for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), z = mp.getZ(i), d = Math.hypot(x, z); if (d > 9 && d < MR * 0.97) mp.setY(i, mp.getY(i) + (vn(x / 5, z / 5, 21) - 0.5) * 1.8); }
  mG.computeVertexNormals();
  const sl = new THREE.Color('#b8875a'), sd = new THREE.Color('#6a4a2c'), hole = new THREE.Color('#1a0e06');
  paint(mG, (c, x, y, z) => { const d = Math.hypot(x, z); c.copy(sd).lerp(sl, AL.clamp(y / MH, 0, 1) * 0.8 + vn(x / 3, z / 3, 23) * 0.2); if (d < 7) c.lerp(hole, 1 - d / 7); });
  const mound = new THREE.Mesh(mG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); mound.castShadow = mound.receiveShadow = true; scene.add(mound);
  // clods of dug-out soil, pebbles
  const clods = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#9a6e44', roughness: 1, flatShading: true }), 300), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 300; i++) { const a = Math.random() * TAU, d = 10 + Math.sqrt(Math.random()) * (MR + 8), x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.7 + Math.random() * 1.6; e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, surf(x, z) + s * 0.4, z), q, new THREE.Vector3(s, s * 0.7, s)); clods.setMatrixAt(i, M); }
  clods.castShadow = clods.receiveShadow = true; scene.add(clods);
  const peb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 380), pc = new THREE.Color();
  for (let i = 0; i < 380; i++) { const a = Math.random() * TAU, d = 60 + Math.random() * 520, x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.8 + Math.random() * 3.2; e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, hT(x, z) + s * 0.3, z), q, new THREE.Vector3(s, s * 0.6, s)); peb.setMatrixAt(i, M); peb.setColorAt(i, pc.setHSL(0.08, 0.08, 0.45 + Math.random() * 0.25)); }
  peb.castShadow = peb.receiveShadow = true; scene.add(peb);
  scene.add(grass(9000, () => { let x, z, d; do { const a = Math.random() * TAU; d = 52 + Math.pow(Math.random(), 0.7) * 560; x = Math.cos(a) * d; z = Math.sin(a) * d; } while (d < 80 && Math.random() < 0.6); return [x, hT(x, z), z, 5 + Math.random() * 11 + (d > 120 ? 4 : 0)]; }, ['#5d7e2c', '#a8b450']));
  // the ant column: out from the entrance over the yard, and back home with crumbs
  const curve = new THREE.CatmullRomCurve3([[0, 0], [16, 6], [44, 14], [90, 8], [140, 38], [200, 62], [262, 108], [340, 140], [420, 150]].map(p => new THREE.Vector3(p[0], 0, p[1])));
  let ants = [], antKey = '';
  const buildAnts = () => {
    for (const a of ants) scene.remove(a.m);
    ants = [];
    const { sp, cols, key } = specCols(); antKey = key;
    for (let i = 0; i < 36; i++) {
      const out = i % 2 === 0, caste = i % 7 === 3 ? C.SOLDIER : C.WORKER, m = R3.antModel(cols, caste);
      m.scale.setScalar(AL.CASTES[caste].size * Math.min(1.4, sp.size || 1));
      if (!out) { const cr = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), new THREE.MeshStandardMaterial({ color: i % 4 ? '#f2e2b0' : '#d0674a', roughness: 0.6 })); cr.position.set(7.4, 1.6, 0); cr.castShadow = true; m.add(cr); }
      scene.add(m); ants.push({ m, u: i / 36, out, lane: out ? -3.4 : 3.4, sp: 0.02 + Math.random() * 0.006, ph: Math.random() * 10 });
    }
  };
  buildAnts();
  const dust = motes(420, [-180, 3, -160, 300, 80, 220], 0xffd8a0, 2.4, 0.55); scene.add(dust);
  const tg = new THREE.Vector3(), tn = new THREE.Vector3();
  return {
    scene, cam, shift: -0.17,
    update(t, dt) {
      if (UI.species !== antKey) buildAnts();
      for (const a of ants) {
        a.u = (a.u + (a.out ? 1 : -1) * a.sp * dt + 1) % 1;
        curve.getPointAt(a.u, tg); curve.getTangentAt(a.u, tn);
        const x = tg.x - tn.z * a.lane, z = tg.z + tn.x * a.lane, dx = a.out ? tn.x : -tn.x, dz = a.out ? tn.z : -tn.z;
        a.m.position.set(x, surf(x, z), z); a.m.rotation.y = Math.atan2(-dz, dx);
        a.m.visible = a.u > 0.015; a.m.userData.frame(FR[((t * 11 + a.ph) | 0) & 3]);
      }
      dust.userData.tick(t);
      const ang = 0.95 + t * 0.03 + mx * 0.12, R = 178;
      cam.position.set(25 + Math.cos(ang) * R, 58 + my * 10, 15 + Math.sin(ang) * R); cam.lookAt(24, 12, 14);
    },
  };
}

// ---- B: into the nest (cut-away) -----------------------------------------------------------------------------
function draftB() {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, 1, 3000);
  scene.add(sky(0x070b1e, 0x2c2440, 0x140c08));
  scene.add(new THREE.HemisphereLight(0x8a98c8, 0x2a1a10, 0.45));
  const moon = new THREE.DirectionalLight(0xbac8ff, 1.3); moon.position.set(-120, 220, 240); moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048); Object.assign(moon.shadow.camera, { left: -260, right: 260, top: 200, bottom: -260, near: 10, far: 900 }); moon.shadow.normalBias = 0.6; scene.add(moon);
  // the soil face: tunnels and chambers carved into it (mask -> depth), strata, warm light in the chambers
  const X0 = -220, X1 = 220, Y0 = -205, Y1 = 40, MW = 560, MHp = 312;
  const TUN = [[[0, 40], [3, 22], [-6, 4], [-4, -18], [10, -38], [32, -58], [60, -78], [84, -90]], [[-4, -18], [-32, -32], [-80, -44], [-122, -50]],
    [[10, -38], [-10, -70], [-30, -100], [-50, -124], [-60, -132]], [[60, -78], [90, -110], [108, -140], [116, -162]], [[-80, -44], [-100, -70], [-110, -96]], [[84, -90], [140, -100], [170, -130]]];
  const CH = [{ x: -60, y: -132, rx: 36, ry: 15, k: 'queen' }, { x: 86, y: -90, rx: 42, ry: 14, k: 'nursery' }, { x: -124, y: -50, rx: 30, ry: 12, k: 'store' }, { x: 116, y: -164, rx: 28, ry: 11, k: 'deep' }, { x: -110, y: -98, rx: 20, ry: 9, k: 'midden' }, { x: 172, y: -132, rx: 22, ry: 10, k: 'store2' }];
  const px = (x, y) => [(x - X0) / (X1 - X0) * MW, (Y1 - y) / (Y1 - Y0) * MHp];
  const c0 = document.createElement('canvas'); c0.width = MW; c0.height = MHp; const x0 = c0.getContext('2d');
  x0.fillStyle = '#000'; x0.fillRect(0, 0, MW, MHp); x0.strokeStyle = x0.fillStyle = '#fff'; x0.lineCap = x0.lineJoin = 'round'; x0.lineWidth = 12;
  for (const t of TUN) { x0.beginPath(); t.forEach((p, i) => { const q = px(p[0], p[1]); i ? x0.lineTo(q[0], q[1]) : x0.moveTo(q[0], q[1]); }); x0.stroke(); }
  const sx = MW / (X1 - X0);
  for (const ch of CH) { const q = px(ch.x, ch.y); x0.beginPath(); x0.ellipse(q[0], q[1], ch.rx * sx, ch.ry * sx, 0, 0, TAU); x0.fill(); }
  const c1 = document.createElement('canvas'); c1.width = MW; c1.height = MHp; const x1 = c1.getContext('2d'); x1.filter = 'blur(3px)'; x1.drawImage(c0, 0, 0);
  const md = x1.getImageData(0, 0, MW, MHp).data, mask = (x, y) => { const q = px(x, y), i = (Math.min(MHp - 1, Math.max(0, q[1] | 0)) * MW + Math.min(MW - 1, Math.max(0, q[0] | 0))) * 4; return md[i] / 255; };
  const fG = new THREE.PlaneGeometry(X1 - X0, Y1 - Y0, 320, 180).translate(0, (Y0 + Y1) / 2, 0), fp = fG.attributes.position;
  for (let i = 0; i < fp.count; i++) { const x = fp.getX(i), y = fp.getY(i), m = mask(x, y), s = m * m * (3 - 2 * m); fp.setZ(i, -17 * s + (vn(x / 6, y / 6, 31) - 0.5) * 1.6 * (1 - s)); }
  fG.computeVertexNormals();
  const S1 = new THREE.Color('#3a2414'), S2 = new THREE.Color('#6e4628'), S3 = new THREE.Color('#8e5c34'), S4 = new THREE.Color('#5a4c3e'), grav = new THREE.Color('#b0a490'), warm = new THREE.Color('#ff9a40');
  paint(fG, (c, x, y) => {
    const yy = y + (vn(x / 30, 0, 41) - 0.5) * 22;
    if (yy > 25) c.copy(S1); else if (yy > -40) c.copy(S2).lerp(S1, AL.clamp((yy + 10) / 35, 0, 1) * 0.5); else if (yy > -125) c.copy(S3); else c.copy(S4);
    c.multiplyScalar(0.8 + vn(x / 4, y / 4, 43) * 0.4);
    if (AL.hash2(Math.round(x * 0.7), Math.round(y * 0.7), 7) > 0.994) c.lerp(grav, 0.35);
    const m = mask(x, y); c.multiplyScalar(1 - 0.5 * m);
    for (const ch of CH) { const d = Math.hypot((x - ch.x) / (ch.rx * 1.6), (y - ch.y) / (ch.ry * 2.4)); if (d < 1) c.lerp(warm, (1 - d) * 0.22); }
  });
  const face = new THREE.Mesh(fG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); face.receiveShadow = true; face.castShadow = true; scene.add(face);
  // the yard above: a strip of ground, the mound cut in half, grass
  const tG = new THREE.PlaneGeometry(X1 - X0, 160, 80, 30).rotateX(-Math.PI / 2).translate(0, Y1, -80), tp = tG.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, Y1 + (tp.getZ(i) < -2 ? vn(tp.getX(i) / 30, tp.getZ(i) / 30, 51) * 4 : 0));
  tG.computeVertexNormals();
  paint(tG, (c, x, y, z) => c.set('#4a6428').lerp(new THREE.Color('#7a8a3a'), vn(x / 20, z / 20, 53)));
  const top = new THREE.Mesh(tG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); top.receiveShadow = true; scene.add(top);
  const mdG = new THREE.SphereGeometry(34, 48, 16, Math.PI, Math.PI, 0, Math.PI / 2).scale(1, 0.42, 1);
  const mdl = new THREE.Mesh(mdG, new THREE.MeshStandardMaterial({ color: '#9a6e44', roughness: 1, side: THREE.DoubleSide })); mdl.position.set(0, Y1, 0); mdl.castShadow = mdl.receiveShadow = true; scene.add(mdl);
  scene.add(grass(2600, () => { let x, z; do { x = X0 + Math.random() * (X1 - X0); z = -4 - Math.random() * 150; } while (Math.hypot(x, z) < 38); return [x, Y1, z, 6 + Math.random() * 12]; }, ['#4e7028', '#93a848']));
  // chamber life: the queen, eggs and larvae, seeds and crumbs, warm lamps
  const { cols } = specCols();
  const lamp = (x, y, i) => { const l = new THREE.PointLight(0xffa04a, i, 120, 1.6); l.position.set(x, y, 10); scene.add(l); return l; };
  const lamps = [lamp(-60, -128, 900), lamp(86, -86, 800), lamp(-124, -46, 500), lamp(116, -160, 380)];
  const egg = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: '#f6eed8', roughness: 0.45 }), 46);
  let ei = 0; const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const put = (inst, x, y, z, s, rz) => { e.set(0, 0, rz || 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, y, z), q, s); inst.setMatrixAt(ei++, M); };
  for (let i = 0; i < 30; i++) put(egg, 86 + (Math.random() - 0.5) * 66, -101 + Math.random() * 4, -9 - Math.random() * 5, new THREE.Vector3(2.2, 1.5, 1.5), Math.random());
  for (let i = 0; i < 16; i++) put(egg, -60 + (i < 8 ? -22 : 22) + (Math.random() - 0.5) * 10, -144 + Math.random() * 2, -10 - Math.random() * 4, new THREE.Vector3(1.4, 1, 1), Math.random());
  egg.castShadow = true; scene.add(egg);
  const seed = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: '#8a6232', roughness: 0.7 }), 40); ei = 0;
  for (let i = 0; i < 26; i++) put(seed, -124 + (Math.random() - 0.5) * 48, -60 + Math.random() * 4, -10 - Math.random() * 5, new THREE.Vector3(2.4, 1.2, 1.4), Math.random() * 3);
  for (let i = 0; i < 14; i++) put(seed, 172 + (Math.random() - 0.5) * 30, -140 + Math.random() * 3, -10 - Math.random() * 4, new THREE.Vector3(1.8, 1.3, 1.5), Math.random() * 3);
  seed.castShadow = true; scene.add(seed);
  const queen = R3.antModel(cols, C.QUEEN); queen.scale.setScalar(1.25); queen.position.set(-64, -145.5, -10); scene.add(queen);
  // workers walking the tunnels
  const paths = TUN.map(t => new THREE.CatmullRomCurve3(t.map(p => new THREE.Vector3(p[0], p[1] - 4.2, -9))));
  const ants = [];
  paths.forEach((cu, k) => { const n = k === 0 ? 4 : 2; for (let i = 0; i < n; i++) { const m = R3.antModel(cols, i === 1 && k === 3 ? C.SOLDIER : C.WORKER); m.scale.setScalar(0.85); scene.add(m); ants.push({ m, cu, u: (i + 0.3) / n, dir: i & 1 ? -1 : 1, sp: 14 / cu.getLength() * (0.8 + Math.random() * 0.4), ph: Math.random() * 10 }); } });
  const nurses = [];
  for (let i = 0; i < 3; i++) { const m = R3.antModel(cols, C.NURSE); m.scale.setScalar(0.8); m.position.set(70 + i * 16, -102.5, -8); scene.add(m); nurses.push(m); }
  const stars = new THREE.Points((() => { const g = new THREE.BufferGeometry(), a = new Float32Array(600 * 3); for (let i = 0; i < 600; i++) { const th = Math.random() * TAU, ph = Math.random() * 0.45; a.set([Math.cos(th) * Math.sin(ph) * 1400, Math.cos(ph) * 1400, Math.sin(th) * Math.sin(ph) * 1400 - 300], i * 3); } g.setAttribute('position', new THREE.BufferAttribute(a, 3)); return g; })(), new THREE.PointsMaterial({ size: 3, color: 0xdde6ff, map: softDot(), transparent: true, depthWrite: false, fog: false }));
  scene.add(stars);
  const embers = motes(90, [-200, -200, -12, 200, 30, 4], 0xffb060, 1.4, 0.6); scene.add(embers);
  const tg = new THREE.Vector3(), tn = new THREE.Vector3();
  let key = specCols().key;
  return {
    scene, cam, shift: 0.15,
    update(t, dt) {
      if (UI.species !== key) { start(draft); return; }   // rebuild in the new species
      for (const a of ants) {
        a.u += a.dir * a.sp * dt; if (a.u > 1) { a.u = 1; a.dir = -1; } else if (a.u < 0) { a.u = 0; a.dir = 1; }
        a.cu.getPointAt(a.u, tg); a.cu.getTangentAt(a.u, tn);
        const tx = tn.x * a.dir, ty = tn.y * a.dir;
        a.m.position.copy(tg);
        if (tx >= 0) a.m.rotation.set(0, 0, Math.atan2(ty, tx)); else a.m.rotation.set(0, Math.PI, Math.atan2(ty, -tx));
        a.m.userData.frame(FR[((t * 10 + a.ph) | 0) & 3]);
      }
      queen.position.x = -64 + Math.sin(t * 0.4) * 3; queen.userData.frame(FR[((t * 3) | 0) & 3]);
      nurses.forEach((m, i) => { m.position.x = 70 + i * 16 + Math.sin(t * 0.7 + i * 2) * 6; m.rotation.y = Math.cos(t * 0.7 + i * 2) > 0 ? 0 : Math.PI; m.userData.frame(FR[((t * 8 + i) | 0) & 3]); });
      lamps.forEach((l, i) => { l.intensity = [900, 800, 500, 380][i] * (0.9 + 0.1 * Math.sin(t * 3 + i * 1.7)); });
      embers.userData.tick(t);
      cam.position.set(mx * 22, -48 + my * 12, 440); cam.lookAt(0, -80, -10);
    },
  };
}

// ---- C: species showcase ------------------------------------------------------------------------------------
function draftC() {
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(34, 1, 1, 3000);
  scene.add(sky(0x0f2018, 0x0a120d, 0x050806));
  scene.fog = new THREE.FogExp2(0x0a120d, 0.0032);
  scene.add(new THREE.HemisphereLight(0x9ac8a0, 0x10140c, 0.5));
  const key = new THREE.SpotLight(0xffe2b8, 5, 0, 0.42, 0.65, 0); key.position.set(90, 170, 130); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.normalBias = 0.5; scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x7fd4ff, 2.6); rim.position.set(-90, 70, -170); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffb070, 0.6); fill.position.set(-150, 40, 120); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(700, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#1c2a16', roughness: 1 })); floor.receiveShadow = true; scene.add(floor);
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const moss = new THREE.Color('#5c8a34'), stone = new THREE.Color('#7c776c'), dk = new THREE.Color('#4a463e');
  const rock = (seed, sx, sy, sz, x, z) => {
    const g = paint(rockGeo(seed, 4).scale(sx, sy, sz), (c, X, Y, Z, ny) => { c.copy(dk).lerp(stone, AL.clamp(Y / sy + 0.5, 0, 1)); c.multiplyScalar(0.85 + vn(X / 6, Z / 6 + Y / 6, seed) * 0.3); if (ny > 0.45 && vn(X / 9, Z / 9, seed + 3) > 0.42) c.lerp(moss, 0.75); });
    g.computeBoundingBox();
    const m = new THREE.Mesh(g, rockMat); m.position.set(x, sy * 0.25, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    return m.position.y + g.boundingBox.max.y;
  };
  const topH = rock(61, 42, 24, 36, 0, 0) - 1.2, topL = rock(67, 22, 12, 20, -78, -42) - 0.8, topR = rock(71, 22, 13, 20, 80, -46) - 0.8;
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 8).scale(52, 0.6, 18), new THREE.MeshStandardMaterial({ color: '#3e5a22', roughness: 0.7 })); leaf.position.set(-20, 0.8, 46); leaf.rotation.y = 0.5; leaf.receiveShadow = true; scene.add(leaf);
  const pollen = motes(260, [-180, 4, -120, 180, 140, 120], 0xfff0a0, 2, 0.5); scene.add(pollen);
  let hero = null, side = [], spKey = '', pop = 0;
  const build = () => {
    for (const m of [hero, ...side]) if (m) scene.remove(m);
    const { cols, sp, key: k } = specCols(); spKey = k;
    const big = Math.min(1.35, sp.size || 1);
    hero = R3.antModel(cols, sp.repletes ? C.HONEYPOT : C.WORKER); hero.userData.s = 4.6 / big; hero.position.set(0, topH, 0); scene.add(hero);
    const a = R3.antModel(cols, C.SOLDIER), b = R3.antModel(cols, C.MAJOR);
    a.userData.s = 2.3 / big; a.position.set(-78, topL, -42); b.userData.s = 2.1 / big; b.position.set(80, topR, -46);
    scene.add(a, b); side = [a, b]; pop = 0;
  };
  build();
  return {
    scene, cam, shift: 0.17,
    update(t, dt) {
      if (UI.species !== spKey) build();
      pop = Math.min(1, pop + dt * 2.2); const k = 1 - Math.pow(1 - pop, 3) * Math.cos(pop * 7) ;
      hero.scale.setScalar(hero.userData.s * k); hero.rotation.y = t * 0.35; hero.position.y = topH + Math.sin(t * 1.3) * 0.3;
      hero.userData.frame(FR[((t * 2.5) | 0) & 3]);
      side[0].scale.setScalar(side[0].userData.s * k); side[0].rotation.y = 0.6 - t * 0.22;
      side[1].scale.setScalar(side[1].userData.s * k); side[1].rotation.y = 2.4 + t * 0.2;
      key.target.position.set(0, topH, 0);
      pollen.userData.tick(t);
      cam.position.set(mx * 16, 74 + my * 10, 280); cam.lookAt(0, topH - 8, -10);
    },
  };
}

// ---- lifecycle -----------------------------------------------------------------------------------------------
function disposeScene(s) {
  s.traverse(o => {
    if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x.dispose());
  });
}
function ensure() {
  if (renderer) return true;
  try {
    cv = document.createElement('canvas'); cv.id = 'menu3d';
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2;display:none;pointer-events:none';
    document.body.appendChild(cv);
    renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  } catch (e) { console.error('[Antlands 3D menu]', e); renderer = null; return false; }
  addEventListener('resize', resize);
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth * 2 - 1; my = e.clientY / innerHeight * 2 - 1; });
  sw = document.createElement('div'); sw.id = 'menuSwitch'; sw.hidden = true;
  sw.innerHTML = '<span>Menu draft</span>' + DRAFTS.map((d, i) => '<button type="button" data-i="' + i + '"><b>' + d.key + '</b> ' + d.name + '</button>').join('');
  sw.onclick = e => { const b = e.target.closest('button'); if (b) start(+b.dataset.i); };
  document.body.appendChild(sw);
  const st = document.createElement('style');
  st.textContent = `
#menuSwitch{position:fixed;right:14px;bottom:14px;z-index:31;display:flex;gap:6px;align-items:center;background:rgba(20,13,7,.8);border:1px solid rgba(214,170,110,.35);border-radius:12px;padding:6px 8px;font:12px system-ui,sans-serif;color:#e9dcc0}
#menuSwitch span{opacity:.75;margin-right:2px}#menuSwitch button{padding:4px 10px;font-size:12px}#menuSwitch button.on{border-color:#f2c14e;background:#6a4a16}
body.m3d .ov.title{background:none}
body.mA .ov.title{background:linear-gradient(90deg,rgba(14,8,3,.66),rgba(14,8,3,0) 48%)}
body.mA .sheet.hero{background:rgba(26,16,8,.5);border-color:rgba(255,200,120,.28)}
body.mA .sheet.hero h1{color:#ffd27a;text-shadow:0 0 30px rgba(255,170,60,.6),0 3px 0 rgba(0,0,0,.4)}
body.mA .kicker{color:#ffb070}
body.mB .ov.title{justify-content:flex-end;padding-right:max(4vw,16px);background:linear-gradient(270deg,rgba(6,4,2,.72),rgba(6,4,2,0) 52%)}
body.mB .sheet.hero{background:linear-gradient(180deg,rgba(60,38,20,.93),rgba(30,18,10,.95));border:2px solid #7a5530;box-shadow:inset 0 2px 0 rgba(255,220,170,.12),0 18px 50px rgba(0,0,0,.7)}
body.mB .sheet.hero h1{color:#f0c890;text-transform:uppercase;letter-spacing:.05em;font-size:clamp(38px,5.6vw,60px);text-shadow:0 2px 0 #2a170a,0 -1px 0 rgba(255,230,190,.25)}
body.mC .ov.title{justify-content:flex-end;padding-right:max(3.5vw,16px);background:radial-gradient(ellipse at 28% 55%,rgba(0,0,0,0),rgba(0,0,0,.5))}
body.mC .sheet.hero{background:rgba(9,14,10,.6);border:1px solid rgba(150,220,160,.25);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
body.mC .sheet.hero h1{color:#eaf6dc;text-shadow:0 0 26px rgba(140,230,150,.4)}
body.mC .kicker{color:#9fe0a8}
body.mC .spc.on{border-color:#8fe0a0;box-shadow:0 0 0 1px #8fe0a0 inset}`;
  document.head.appendChild(st);
  return true;
}
function resize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false);
  if (active) { const c = active.cam, w = innerWidth, h = innerHeight; c.aspect = w / h; c.setViewOffset(w, h, w * (active.shift || 0), 0, w, h); c.updateProjectionMatrix(); }
}
function stop() {
  cancelAnimationFrame(raf); raf = 0;
  if (active) { disposeScene(active.scene); active = null; }
}
function hide() {
  stop();
  if (cv) cv.style.display = 'none';
  document.body.classList.remove('m3d', 'mA', 'mB', 'mC');
  if (sw) sw.hidden = true;
}
function start(i) {
  if (!ensure()) return;
  stop();
  draft = i;
  try { localStorage.setItem('antlands.menuDraft', DRAFTS[i].key); } catch (_) { /* private mode */ }
  try { active = [draftA, draftB, draftC][i](); } catch (e) { console.error('[Antlands 3D menu] draft ' + DRAFTS[i].key, e); hide(); return; }
  resize();
  cv.style.display = 'block'; sw.hidden = false;
  document.body.classList.remove('mA', 'mB', 'mC'); document.body.classList.add('m3d', 'm' + DRAFTS[i].key);
  for (const b of sw.querySelectorAll('button')) b.classList.toggle('on', +b.dataset.i === i);
  if (AL.Game) AL.Game.paused = true;   // the demo colony behind is covered: let it rest
  last = performance.now();
  raf = requestAnimationFrame(loop);
}
function loop(now) {
  raf = requestAnimationFrame(loop);
  const title = $('title');
  if (!active) return;
  if (!title || title.hidden) { hide(); return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000; timeU.value = t;
  try { active.update(t, dt); renderer.render(active.scene, active.cam); } catch (e) { console.error('[Antlands 3D menu]', e); hide(); }
}

const baseShowTitle = UI.showTitle;
UI.showTitle = function () {
  baseShowTitle.apply(this, arguments);
  start(draft);
};
AL.Menu3D = { start, hide, DRAFTS };
