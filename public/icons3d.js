// Antlands 3D: the HUD's ant icons (egg queue buttons, the queue itself, anywhere ui.js casteIcon is used) drawn from
// the same Three.js ant models as the game, in your colony's colours, instead of the 2D sprites. One small offscreen
// renderer; each caste is rendered once per colony look and size and cached, so the HUD costs nothing per frame.
// With 3D models off (F7 / Settings) the icons go back to the 2D sprites.
import * as THREE from './vendor/three.module.js';

const AL = window.AL, R3 = AL.R3D, C = AL.CASTE;
const Icon = {
  r: null, scene: null, cam: null, cache: new Map(), models: new Map(), box: new THREE.Box3(), v: new THREE.Vector3(), c: new THREE.Vector3(),
  init() {
    this.r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(1); this.r.setClearColor(0x000000, 0); this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 1.4;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff2dc, 0x3a2a18, 1.6));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.8); key.position.set(-4, 10, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffc890, 1.6); rim.position.set(6, 3, -8); this.scene.add(rim);
    this.cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  },
  colours() {
    const w = AL.Game && AL.Game.world, c = w && (w.player || w.colonies[w.me || 0]);
    const sp = c ? c.sp : AL.SPECIES[(AL.UI && AL.UI.species) || 'fire'] || AL.SPECIES.fire;
    const cols = (c && c.colours) || sp;
    return Object.assign({}, cols, { look: cols.look || sp.look || (sp.key || 'fire') });
  },
  // an ant model sized to fit a unit box, nose pointing up the icon (like the 2D icons)
  model(cols, caste) {
    const key = caste + '|' + cols.look + '|' + cols.body + '|' + cols.head + '|' + cols.gaster;
    let m = this.models.get(key);
    if (m) return m;
    const ant = R3.antModel(cols, caste); ant.userData.frame(1);
    const g = new THREE.Group(); g.add(ant);
    ant.rotation.y = Math.PI / 4;   // walking diagonally up the icon, legs spread out to the sides
    g.updateMatrixWorld(true);
    this.box.setFromObject(g); this.box.getSize(this.v); this.box.getCenter(this.c);
    const s = 2 / Math.max(this.v.x, this.v.z, 0.001);
    ant.position.set(-this.c.x * s, -this.box.min.y * s, -this.c.z * s); ant.scale.multiplyScalar(s);
    this.models.set(key, g);
    return g;
  },
  draw(cv, caste) {
    if (!R3 || !R3.enabled) return false;
    try {
      if (!this.r) this.init();
      const cols = this.colours(), w = cv.width, h = cv.height, key = caste + '|' + w + '|' + cols.look + '|' + cols.body + '|' + cols.head + '|' + cols.gaster;
      let img = this.cache.get(key);
      if (!img) {
        const r = this.r, m = this.model(cols, caste), RW = 192, RH = 192;
        if (r.domElement.width !== RW || r.domElement.height !== RH) r.setSize(RW, RH, false);
        // big castes fill the icon, small ones a bit less (the 2D icons did the same)
        const big = caste === C.QUEEN || caste === C.MAJOR || caste === C.HONEYPOT || caste === C.WINGED, d = big ? 5.2 : 5.9;
        this.cam.aspect = 1; this.cam.position.set(0, d * 0.96, d * 0.3); this.cam.lookAt(0, 0.25, 0.05); this.cam.updateProjectionMatrix();
        this.scene.add(m); r.render(this.scene, this.cam); this.scene.remove(m);
        // crop to the ant and fit it to the icon (whatever its build: a long gaster, wings, a big head)
        const tmp = document.createElement('canvas'); tmp.width = RW; tmp.height = RH; const tx = tmp.getContext('2d'); tx.drawImage(r.domElement, 0, 0);
        const px = tx.getImageData(0, 0, RW, RH).data; let x0 = RW, y0 = RH, x1 = -1, y1 = -1;
        for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) if (px[(y * RW + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        img = document.createElement('canvas'); img.width = w; img.height = h;
        if (x1 >= x0) {
          const bw = x1 - x0 + 1, bh = y1 - y0 + 1, fill = big ? 0.98 : 0.9, k = Math.min(w * fill / bw, h * fill / bh);
          img.getContext('2d').drawImage(tmp, x0, y0, bw, bh, (w - bw * k) / 2, (h - bh * k) / 2, bw * k, bh * k);
        }
        this.cache.set(key, img);
      }
      const x = cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height); x.drawImage(img, 0, 0);
      return true;
    } catch (e) {
      if (!this.warned) { this.warned = true; console.error('[Antlands 3D] icons', e); }
      return false;
    }
  },
};
AL.UI.icon3d = (cv, caste) => Icon.draw(cv, caste);
R3.icons = Icon;
// icons already on screen (built before this module loaded) switch to 3D now; and again when 3D is toggled
const redraw = () => { for (const cv of document.querySelectorAll('canvas.icon')) if (cv._draw) cv._draw(); };
redraw();
addEventListener('keydown', e => { if (e.key === 'F7') setTimeout(redraw, 0); });
