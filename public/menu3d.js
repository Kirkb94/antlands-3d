// Antlands 3D title screen. The original title panel (species, perks, colony options, Start / Campaign / Multiplayer /
// How to play) over a Three.js scene: the golden-hour mound, a low camera circling a big anthill at sunset while a
// column of your ants marches out and back. On top of that:
//   - Play / Settings tabs (Settings: rivals, text size, 3D models, shadows, rolling ground, title ants, sound, keys)
//   - every species card shows its 3D ant turning (render3d.js antModel)
//   - live 3D ants crawl over the screen around the panel and scatter from the mouse
// Layout: the classic panel on the left, an ant column marching round its border and another trail along the bottom.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, UI = AL.UI, R3 = AL.R3D, C = AL.CASTE, TAU = Math.PI * 2;
const $ = id => document.getElementById(id);
const vn = (x, y, s) => R3.vnoise(x + 1000, y + 1000, s);
const load = (k, d) => { try { return localStorage.getItem('antlands.' + k) || d; } catch (_) { return d; } };
const save = (k, v) => { try { localStorage.setItem('antlands.' + k, v); } catch (_) { /* private mode */ } };
const SHIFT = [-0.17, 0];   // push the mound right of the panel
let antsOn = load('titleAnts', 'on') !== 'off';
const timeU = { value: 0 }, mouse = { x: -999, y: -999 };
addEventListener('pointermove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
const FR = [0, 1, 0, 2];

function specCols(key) {
  key = key || UI.species || 'fire';
  const sp = AL.SPECIES[key] || AL.SPECIES.fire;
  return { key, sp, cols: Object.assign({}, sp, { look: sp.look || key }) };
}
function lin(hex) { return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace); }
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
function motes(n, box, color, size, opacity) {
  const pos = new Float32Array(n * 3), base = [];
  for (let i = 0; i < n; i++) { const p = [box[0] + Math.random() * (box[3] - box[0]), box[1] + Math.random() * (box[4] - box[1]), box[2] + Math.random() * (box[5] - box[2])]; pos.set(p, i * 3); base.push([p[0], p[1], p[2], Math.random() * TAU]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: softDot(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  p.userData.tick = t => {
    const h = box[4] - box[1];
    for (let i = 0; i < n; i++) { const b = base[i]; pos[i * 3] = b[0] + Math.sin(t * 0.3 + b[3]) * 6; pos[i * 3 + 2] = b[2] + Math.cos(t * 0.25 + b[3]) * 6; pos[i * 3 + 1] = box[1] + ((b[1] - box[1] + t * 2.2) % h); }
    g.attributes.position.needsUpdate = true;
  };
  return p;
}
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
    M.compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, p[3], 1)); m.setMatrixAt(i, M); m.setColorAt(i, c.copy(cA).lerp(cB, Math.random()));
  }
  m.receiveShadow = true;
  return m;
}
function paint(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal, cols = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { fn(c, p.getX(i), p.getY(i), p.getZ(i), n.getY(i)); cols.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

// ---- the scene: golden hour mound ---------------------------------------------------------------------------
function moundScene() {
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
  const gG = new THREE.PlaneGeometry(1500, 1500, 230, 230).rotateX(-Math.PI / 2), gp = gG.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, hT(gp.getX(i), gp.getZ(i)));
  gG.computeVertexNormals();
  const grassA = new THREE.Color('#4c6a28'), grassB = new THREE.Color('#7f9a3c'), dirt = new THREE.Color('#7a5a36');
  paint(gG, (c, x, y, z) => { const d = Math.hypot(x, z); c.copy(grassA).lerp(grassB, vn(x / 40, z / 40, 11)); c.lerp(dirt, AL.clamp(1 - (d - 50) / 45, 0, 1) * 0.85 + vn(x / 25, z / 25, 13) * 0.15); });
  const ground = new THREE.Mesh(gG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); ground.receiveShadow = true; scene.add(ground);
  const prof = []; for (let i = 0; i <= 40; i++) { const r = i / 40 * MR; prof.push(new THREE.Vector2(Math.max(0.01, r), moundH(r))); }
  const mG = new THREE.LatheGeometry(prof, 96), mp = mG.attributes.position;
  for (let i = 0; i < mp.count; i++) { const x = mp.getX(i), z = mp.getZ(i), d = Math.hypot(x, z); if (d > 9 && d < MR * 0.97) mp.setY(i, mp.getY(i) + (vn(x / 5, z / 5, 21) - 0.5) * 1.8); }
  mG.computeVertexNormals();
  const sl = new THREE.Color('#b8875a'), sd = new THREE.Color('#6a4a2c'), hole = new THREE.Color('#1a0e06');
  paint(mG, (c, x, y, z) => { const d = Math.hypot(x, z); c.copy(sd).lerp(sl, AL.clamp(y / MH, 0, 1) * 0.8 + vn(x / 3, z / 3, 23) * 0.2); if (d < 7) c.lerp(hole, 1 - d / 7); });
  const mound = new THREE.Mesh(mG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); mound.castShadow = mound.receiveShadow = true; scene.add(mound);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const clods = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#9a6e44', roughness: 1, flatShading: true }), 300);
  for (let i = 0; i < 300; i++) { const a = Math.random() * TAU, d = 10 + Math.sqrt(Math.random()) * (MR + 8), x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.7 + Math.random() * 1.6; e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, surf(x, z) + s * 0.4, z), q, new THREE.Vector3(s, s * 0.7, s)); clods.setMatrixAt(i, M); }
  clods.castShadow = clods.receiveShadow = true; scene.add(clods);
  const peb = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), 380), pc = new THREE.Color();
  for (let i = 0; i < 380; i++) { const a = Math.random() * TAU, d = 60 + Math.random() * 520, x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.8 + Math.random() * 3.2; e.set(Math.random() * 3, Math.random() * 3, 0); q.setFromEuler(e); M.compose(new THREE.Vector3(x, hT(x, z) + s * 0.3, z), q, new THREE.Vector3(s, s * 0.6, s)); peb.setMatrixAt(i, M); peb.setColorAt(i, pc.setHSL(0.08, 0.08, 0.45 + Math.random() * 0.25)); }
  peb.castShadow = peb.receiveShadow = true; scene.add(peb);
  scene.add(grass(9000, () => { let x, z, d; do { const a = Math.random() * TAU; d = 52 + Math.pow(Math.random(), 0.7) * 560; x = Math.cos(a) * d; z = Math.sin(a) * d; } while (d < 80 && Math.random() < 0.6); return [x, hT(x, z), z, 5 + Math.random() * 11 + (d > 120 ? 4 : 0)]; }, ['#5d7e2c', '#a8b450']));
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
    scene, cam,
    update(t, dt) {
      if ((UI.species || 'fire') !== antKey) buildAnts();
      for (const a of ants) {
        a.u = (a.u + (a.out ? 1 : -1) * a.sp * dt + 1) % 1;
        curve.getPointAt(a.u, tg); curve.getTangentAt(a.u, tn);
        const x = tg.x - tn.z * a.lane, z = tg.z + tn.x * a.lane, dx = a.out ? tn.x : -tn.x, dz = a.out ? tn.z : -tn.z;
        a.m.position.set(x, surf(x, z), z); a.m.rotation.y = Math.atan2(-dz, dx);
        a.m.visible = a.u > 0.015; a.m.userData.frame(FR[((t * 11 + a.ph) | 0) & 3]);
      }
      dust.userData.tick(t);
      const ang = 0.95 + t * 0.03 + (mouse.x / innerWidth * 2 - 1) * 0.08, R = 178, my = mouse.y / innerHeight * 2 - 1;
      cam.position.set(25 + Math.cos(ang) * R, 58 + my * 8, 15 + Math.sin(ang) * R); cam.lookAt(24, 12, 14);
    },
  };
}

// ---- 3D species portraits on the species cards ------------------------------------------------------------------
const Port = {
  r: null, scene: null, cam: null, models: new Map(),
  init() {
    this.r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setClearColor(0x000000, 0); this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff2dc, 0x3a2a18, 1.5));
    const k = new THREE.DirectionalLight(0xfff0dd, 2.6); k.position.set(4, 10, 6); this.scene.add(k);
    const rim = new THREE.DirectionalLight(0xffa850, 2); rim.position.set(-6, 4, -8); this.scene.add(rim);
    this.cam = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  },
  model(key) {
    let m = this.models.get(key);
    if (!m) { const { sp, cols } = specCols(key); m = R3.antModel(cols, sp.repletes ? C.HONEYPOT : C.WORKER); m.scale.setScalar(0.9 + 0.12 * Math.min(1.4, sp.size || 1)); this.models.set(key, m); }
    return m;
  },
  draw(cv, m, dist, elev) {
    const w = cv.width, h = cv.height, r = this.r;
    if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.position.set(0, elev, dist); this.cam.lookAt(0, 1.6, 0); this.cam.updateProjectionMatrix();
    this.scene.add(m); r.render(this.scene, this.cam); this.scene.remove(m);
    const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); x.drawImage(r.domElement, 0, 0);
  },
  tick(t) {
    let i = 0;
    for (const b of document.querySelectorAll('#speciesPick .spc')) {
      const cv = b.querySelector('canvas'); if (!cv) continue;
      const m = this.model(b.dataset.sp), on = b.classList.contains('on');
      m.rotation.y = t * (on ? 1.1 : 0.45) + i * 0.8; m.userData.frame(on ? FR[((t * 9) | 0) & 3] : 0);
      this.draw(cv, m, 22, 12); i++;
    }
  },
};

// ---- Cosmetics tab: your colony's hat (hats.js), each card a turning soldier of your species wearing it ------------
const Cos = {
  models: new Map(), key: null,
  model(id) {
    const sk = UI.species || 'fire';
    if (this.key !== sk) { this.models.clear(); this.key = sk; }
    let g = this.models.get(id);
    if (g) return g;
    const { cols } = specCols(sk), ant = R3.antModel(cols, C.SOLDIER);
    g = new THREE.Group(); g.add(ant); g.userData.ant = ant;
    const hm = id !== 'none' && R3.hats ? R3.hats.mesh(id, 0) : null;
    if (hm) { const hd = AL.Hats.head(C.SOLDIER, cols.look, R3.LOOKS); hm.position.set(hd.x, 1.75 + hd.r * 0.62, 0); hm.scale.setScalar(hd.r * 1.4); g.add(hm); g.userData.hat = hm; }
    this.models.set(id, g);
    return g;
  },
  build() {
    const el = $('hatGrid'); if (!el || el.dataset.built) return;
    el.dataset.built = '1';
    const cards = [{ id: 'none', name: 'No hat' }].concat(AL.Hats ? AL.Hats.LIST : []);
    el.innerHTML = cards.map(h => '<button type="button" class="hatc" data-hat="' + h.id + '"><canvas width="120" height="104"></canvas><span>' + h.name + '</span></button>').join('');
    el.onclick = e => { const b = e.target.closest('.hatc'); if (!b || !AL.Hats) return; AL.Hats.save(b.dataset.hat); this.sync(); };
    this.sync();
  },
  sync() {
    const cur = AL.Hats ? AL.Hats.saved() : 'none';
    for (const b of document.querySelectorAll('#hatGrid .hatc')) b.classList.toggle('on', b.dataset.hat === cur);
    const n = $('hatNow'); if (n) n.textContent = AL.Hats ? AL.Hats.nameOf(cur) : '';
  },
  tick(t) {
    if (!$('tCos') || $('tCos').hidden || !Port.r) return;
    this.build();
    let i = 0;
    for (const b of document.querySelectorAll('#hatGrid .hatc')) {
      const cv = b.querySelector('canvas'), g = this.model(b.dataset.hat), on = b.classList.contains('on');
      g.rotation.y = t * (on ? 0.9 : 0.35) + i * 0.7; g.userData.ant.userData.frame(on ? FR[((t * 9) | 0) & 3] : 0);
      if (g.userData.hat) g.userData.hat.userData.spin(t);
      const w = cv.width, h = cv.height, r = Port.r, cam = Port.cam;
      if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
      cam.aspect = w / h; cam.position.set(0, 8, 18); cam.lookAt(0, 3.4, 0); cam.updateProjectionMatrix();
      Port.scene.add(g); r.render(Port.scene, cam); Port.scene.remove(g);
      const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h); x.drawImage(r.domElement, 0, 0);
      i++;
    }
  },
};

// ---- 3D ants crawling over the screen (top-down, pixel space), scattering from the cursor --------------------------
const Crawl = {
  r: null, scene: null, cam: null, cv: null, ants: [], shadowMat: null, built: false,
  init() {
    const cv = this.cv = document.createElement('canvas'); cv.id = 'titleAnts';
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:33;pointer-events:none;display:none';
    document.body.appendChild(cv);
    this.r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    this.r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); this.r.setClearColor(0x000000, 0); this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff0d8, 0x2a1a0e, 1.4));
    const sun = new THREE.DirectionalLight(0xffe2c0, 2.6); sun.position.set(-200, 400, -200); this.scene.add(sun);
    this.cam = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 1000); this.cam.up.set(0, 0, -1); this.cam.position.set(0, 500, 0); this.cam.lookAt(0, 0, 0);
    this.shadowMat = new THREE.MeshBasicMaterial({ map: softDot(), color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false });
    this.resize();
  },
  resize() {
    if (!this.r) return;
    this.r.setSize(innerWidth, innerHeight, false);
    Object.assign(this.cam, { left: 0, right: innerWidth, top: 0, bottom: -innerHeight }); this.cam.updateProjectionMatrix();
  },
  // paths: { len, at(s) -> [x, y] } over arc length, measured from the layout's DOM boxes each frame
  paths() {
    const W = innerWidth, H = innerHeight, sheet = document.querySelector('#title .sheet.hero');
    const rs = sheet ? sheet.getBoundingClientRect() : { left: 40, top: 40, right: 500, bottom: H - 40 };
    const loop = (x0, y0, x1, y1) => { const w = x1 - x0, h = y1 - y0, L = 2 * (w + h); return { len: L, loop: true, at(s) { s = ((s % L) + L) % L; if (s < w) return [x0 + s, y0]; s -= w; if (s < h) return [x1, y0 + s]; s -= h; if (s < w) return [x1 - s, y1]; s -= w; return [x0, y1 - s]; } }; };
    const wave = (x0, x1, y, amp, per) => { const L = x1 - x0; return { len: L, loop: true, at(s) { s = ((s % L) + L) % L; const x = x0 + s; return [x, y + Math.sin(x / per) * amp]; } }; };
    return [{ p: loop(rs.left - 16, rs.top - 16, rs.right + 16, rs.bottom + 16), n: 18, v: 44 }, { p: wave(-60, W + 60, H - 34, 10, 90), n: 6, v: 62 }];
  },
  build() {
    for (const a of this.ants) { this.scene.remove(a.m); this.scene.remove(a.sh); }
    this.ants = []; this.built = true; this.key = UI.species || 'fire';
    const { cols, sp } = specCols(), P = this.paths(), sq = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    P.forEach((path, pi) => {
      for (let i = 0; i < path.n; i++) {
        const caste = i % 6 === 2 ? C.SOLDIER : C.WORKER, m = R3.antModel(cols, caste), s = 2.4 * AL.CASTES[caste].size * Math.min(1.3, sp.size || 1);
        m.scale.setScalar(s); this.scene.add(m);
        const sh = new THREE.Mesh(sq, this.shadowMat); sh.scale.set(26 * s / 2.4, 1, 13 * s / 2.4); this.scene.add(sh);
        this.ants.push({ m, sh, pi, s0: i / path.n, v: path.v * (0.9 + Math.random() * 0.2), ox: 0, oy: 0, vx: 0, vy: 0, x: 0, y: 0, ph: Math.random() * 10, prev: null });
      }
    });
  },
  tick(t, dt) {
    if (!antsOn) { this.cv.style.display = 'none'; return; }
    this.cv.style.display = 'block';
    if (!this.built || this.key !== (UI.species || 'fire')) this.build();
    const P = this.paths();
    for (const a of this.ants) {
      const path = P[a.pi].p; a.s0 += a.v * dt / path.len;
      const [px, py] = path.at(a.s0 * path.len);
      // scatter from the cursor, then drift back to the trail
      const dx = px + a.ox - mouse.x, dy = py + a.oy - mouse.y, d = Math.hypot(dx, dy);
      if (d < 110 && d > 0.1) { const k = (1 - d / 110) * 2600 * dt; a.vx += dx / d * k; a.vy += dy / d * k; }
      a.vx *= Math.exp(-dt * 4); a.vy *= Math.exp(-dt * 4); a.ox += a.vx * dt; a.oy += a.vy * dt;
      a.ox *= Math.exp(-dt * 0.9); a.oy *= Math.exp(-dt * 0.9);
      const x = px + a.ox, y = py + a.oy;
      if (a.prev) { const mx = x - a.prev[0], my = y - a.prev[1]; if (mx * mx + my * my > 0.01) { const want = Math.atan2(-my, mx); let da = want - a.m.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); a.m.rotation.y += da * Math.min(1, dt * 12); } }
      a.prev = [x, y];
      a.m.position.set(x, 30, y); a.sh.position.set(x + 4, 1, y + 6);
      a.m.userData.frame(FR[((t * (12 + Math.hypot(a.vx, a.vy) * 0.05) + a.ph) | 0) & 3]);
    }
    this.r.render(this.scene, this.cam);
  },
};

// ---- the panel: Play / Settings tabs -------------------------------------------------------------------------
const segRow = (label, k, opts, note) => '<div class="tsrow"><span>' + label + (note ? ' <em>' + note + '</em>' : '') + '</span><span class="tseg" data-k="' + k + '">' + opts.map(([v, l]) => '<button type="button" data-v="' + v + '">' + l + '</button>').join('') + '</span></div>';
const curVal = k => k === 'r3d' ? (R3.enabled ? 'on' : 'off') : k === 'tilt' ? (R3.tilt ? 'on' : 'off') : k === 'shadows' ? R3.shadows : k === 'relief' ? (R3.relief ? 'on' : 'off') : k === 'tants' ? (antsOn ? 'on' : 'off') : k === 'sound' ? (AL.Audio && AL.Audio.on ? 'on' : 'off') : '';
function syncSettings() { for (const s of document.querySelectorAll('#tSettings .tseg')) for (const b of s.children) b.classList.toggle('on', b.dataset.v === curVal(s.dataset.k)); }
function showTab(t) {
  $('tPlay').hidden = t !== 'play'; $('tSettings').hidden = t !== 'set'; if ($('tCos')) $('tCos').hidden = t !== 'cos';
  if (t === 'cos') { Cos.build(); Cos.sync(); }
  for (const b of $('tTabs').children) b.classList.toggle('on', b.dataset.t === t);
  syncSettings();
}
function mountUI() {
  const sheet = document.querySelector('#title .sheet.hero'); if (!sheet) return;
  if (!$('tTabs')) {
    const h1 = sheet.querySelector('h1');
    const tabs = document.createElement('div'); tabs.id = 'tTabs';
    tabs.innerHTML = '<button type="button" data-t="play" class="on">Play</button><button type="button" data-t="cos">Cosmetics</button><button type="button" data-t="set">Settings</button>';
    const play = document.createElement('div'); play.id = 'tPlay';
    const set = document.createElement('div'); set.id = 'tSettings'; set.hidden = true;
    const cos = document.createElement('div'); cos.id = 'tCos'; cos.hidden = true;
    cos.innerHTML = '<h3>Colony hat</h3><p class="mute small" style="margin:2px 0 8px">Your queens, soldiers, majors and winged ants wear it. Rivals get their own hats; online, two colonies on the same hat get different colours of it. Now: <b id="hatNow"></b></p><div id="hatGrid"></div>';
    set.innerHTML = '<h3>Game</h3><div id="tsGame"></div>' +
      '<h3>Graphics</h3>' + segRow('3D models', 'r3d', [['on', 'On'], ['off', 'Classic 2D']]) + segRow('Camera', 'tilt', [['on', 'Tilted'], ['off', 'Top-down']]) + segRow('Shadows', 'shadows', [['high', 'High'], ['low', 'Low'], ['off', 'Off']]) +
      segRow('Rolling ground', 'relief', [['on', 'On'], ['off', 'Flat']], 'next game') + segRow('Ants on this screen', 'tants', [['on', 'On'], ['off', 'Off']]) +
      '<h3>Sound</h3>' + segRow('Sound', 'sound', [['on', 'On'], ['off', 'Off']]) +
      '<h3>Keys</h3><p class="mute small" style="margin-top:2px">Space pause · 1 2 3 speed · Tab nest view · H hide trails · M sound · Esc menu · F7 3D / 2D · F8 3D model gallery</p>';
    h1.after(tabs); tabs.after(play); play.after(cos); cos.after(set);
    tabs.onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.t); };
    set.addEventListener('click', e => {
      const b = e.target.closest('.tseg button'); if (!b) return;
      const k = b.parentElement.dataset.k, v = b.dataset.v;
      if (k === 'r3d') { R3.enabled = v === 'on'; save('3d', v); }
      else if (k === 'tilt') { R3.tilt = v === 'on'; save('tilt', v); }
      else if (k === 'shadows') { R3.shadows = v; save('shadows', v); }
      else if (k === 'relief') { R3.relief = v === 'on'; save('relief', v); }
      else if (k === 'tants') { antsOn = v === 'on'; save('titleAnts', v); }
      else if (k === 'sound') { if (AL.Audio && AL.Audio.on !== (v === 'on')) AL.Audio.toggle(); }
      syncSettings();
    });
  }
  // the game's name: big and bold across the top of the screen, out of the panel
  const ov = $('title');
  if (ov && !$('bigTitle')) { const bt = document.createElement('div'); bt.id = 'bigTitle'; ov.appendChild(bt); }
  const bt = $('bigTitle');
  if (bt) for (const el of [...sheet.children]) if (el.tagName === 'H1' || el.classList.contains('kicker')) bt.appendChild(el);
  // everything else in the panel lives on the Play tab (also bits other modules add later)
  const keep = new Set(['tTabs', 'tPlay', 'tSettings', 'tCos']), play = $('tPlay');
  for (const el of [...sheet.children]) if (!keep.has(el.id) && el.tagName !== 'H1' && !el.classList.contains('kicker')) play.appendChild(el);
  const g = $('setRow'); if (g && g.parentElement !== $('tsGame')) $('tsGame').appendChild(g);
  syncSettings();
}

// ---- lifecycle -----------------------------------------------------------------------------------------------
let renderer = null, cv = null, active = null, raf = 0, last = 0, tidy = 0;
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
    Port.init(); Crawl.init();
  } catch (e) { console.error('[Antlands 3D title]', e); renderer = null; return false; }
  addEventListener('resize', resize);
  const st = document.createElement('style');
  st.textContent = `
body.m3d .ov.title{background:linear-gradient(90deg,rgba(14,8,3,.6),rgba(14,8,3,0) 48%)}
body.m3d .sheet.hero{overflow-x:hidden;background:rgba(26,16,8,.58);border-color:rgba(255,200,120,.28)}
body.m3d .sheet.hero h1{color:#ffd27a;text-shadow:0 0 30px rgba(255,170,60,.6),0 3px 0 rgba(0,0,0,.4)}
body.m3d .kicker{color:#ffb070}
#bigTitle{display:none}
body.m3d .ov.title{padding-top:clamp(96px,17vh,190px)}
body.m3d .ov.title .sheet.hero{max-height:calc(100vh - clamp(96px,17vh,190px) - 14px)}
body.m3d #bigTitle{display:block;position:absolute;left:0;right:0;top:0;padding:clamp(8px,2vh,22px) 16px 0;text-align:center;pointer-events:none;z-index:3;background:linear-gradient(180deg,rgba(14,8,3,.55),rgba(14,8,3,0))}
body.m3d #bigTitle h1{margin:0;font:900 clamp(56px,11vw,160px)/0.95 Georgia,"Times New Roman",serif;letter-spacing:.04em;color:#ffd27a;-webkit-text-stroke:1.5px rgba(70,30,6,.55);text-shadow:0 0 40px rgba(255,160,50,.55),0 5px 0 rgba(60,24,4,.7),0 10px 26px rgba(0,0,0,.55)}
body.m3d #bigTitle .kicker{margin:0 0 2px;font-size:clamp(11px,1.3vw,16px);letter-spacing:.32em;font-weight:700;color:#ffc488;text-shadow:0 2px 6px rgba(0,0,0,.6)}
#tTabs{display:flex;gap:2px;margin:2px 0 14px;border-bottom:1px solid rgba(255,210,150,.18)}
#tTabs button{background:none;border:none;border-bottom:2px solid transparent;border-radius:0;padding:6px 16px;font-weight:650;color:#c9b48e;box-shadow:none}
#tTabs button.on{color:#ffd27a;border-bottom-color:#ffd27a}
#tSettings h3{margin:14px 0 6px;color:#ffd27a;font-size:12px;text-transform:uppercase;letter-spacing:.14em}
#tSettings .tsrow,#tSettings .setrow label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:7px 0}
#tSettings .setrow{display:block}
#tSettings .tsrow em{font-style:normal;color:var(--mute);font-size:11px;margin-left:4px}
#tSettings .tseg{display:inline-flex}#tSettings .tseg button{border-radius:0;padding:4px 12px;margin-left:-1px}
#tSettings .tseg button:first-child{border-radius:8px 0 0 8px}#tSettings .tseg button:last-child{border-radius:0 8px 8px 0}
#tSettings .tseg button.on{background:#6a4a16;border-color:#f2c14e;color:#fff}
.spc canvas{transition:transform .2s}.spc.on canvas{transform:scale(1.12)}
#hatGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}
#hatGrid .hatc{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px 8px;border-radius:12px;background:rgba(0,0,0,.18);border:1px solid rgba(255,210,150,.16);color:#e8d7b6;font-size:12px;font-weight:600}
#hatGrid .hatc canvas{width:100%;max-width:120px;height:auto;aspect-ratio:120/104}
#hatGrid .hatc:hover{border-color:rgba(255,210,150,.45)}
#hatGrid .hatc.on{background:rgba(106,74,22,.75);border-color:#f2c14e;color:#fff}
`;
  document.head.appendChild(st);
  return true;
}
function resize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight, false); Crawl.resize();
  if (active) { const c = active.cam, w = innerWidth, h = innerHeight; c.aspect = w / h; c.setViewOffset(w, h, w * SHIFT[0], h * SHIFT[1], w, h); c.updateProjectionMatrix(); }
}
function hide() {
  cancelAnimationFrame(raf); raf = 0;
  if (cv) cv.style.display = 'none';
  if (Crawl.cv) Crawl.cv.style.display = 'none';
  document.body.classList.remove('m3d');
}
function start() {
  if (!ensure()) return;
  mountUI(); showTab('play');
  if (!active) { try { active = moundScene(); } catch (e) { console.error('[Antlands 3D title] scene', e); return; } }
  cv.style.display = 'block';
  document.body.classList.add('m3d');
  resize();
  if (AL.Game) AL.Game.paused = true;   // the demo colony behind is covered: let it rest
  last = performance.now();
  cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
}
function loop(now) {
  raf = requestAnimationFrame(loop);
  const title = $('title');
  if (!title || title.hidden) { hide(); return; }
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const t = now / 1000; timeU.value = t;
  try {
    active.update(t, dt); renderer.render(active.scene, active.cam);
    Port.tick(t); Cos.tick(t); Crawl.tick(t, dt);
    if (++tidy % 60 === 0) mountUI();   // bits other modules added to the panel go on the Play tab
  } catch (e) { console.error('[Antlands 3D title]', e); hide(); }
}

const baseShowTitle = UI.showTitle;
UI.showTitle = function () { baseShowTitle.apply(this, arguments); start(); };
AL.Menu3D = { start, hide };
