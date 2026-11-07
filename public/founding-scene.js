// Antlands founding vignette: a close-up, side-view cut through the soil at the founding site.
// The queen lands, sheds her wings, digs and seals a chamber and raises her first brood.
// Browser only. Registers the 'founding' scene (order 20) with AL.registerScene when it exists,
// and exposes AL.FoundingScene for harnesses: new AL.FoundingScene.View(fs).draw(ctx, w, h, dt).
(function (root) {
'use strict';
const AL = root.AL, Fd = AL.Founding, FR = AL.FoundingRace, T = AL.Sites.TILE, TI = AL.Sites.TILE_INFO, TAU = Math.PI * 2;
const PX = 48;        // texture pixels per nest tile
const SKY = 8;        // tiles of sky painted above the ground line
const HALF = 20;      // painted window: entrance column +- HALF tiles
const DEPTH = 22;     // painted window: rows below ground

const shade = (hex, f) => AL.Art && AL.Art.shade ? AL.Art.shade(hex, f) : hex;
const mix = (a, b, t) => AL.Art && AL.Art.mix ? AL.Art.mix(a, b, t) : a;
function cnv(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
// a union of grid tiles drawn as one smooth shape: each tile is a rect whose outer corners are
// rounded where both neighbours on that corner are empty (convex corners), grown by `grow` px
function tilePath(x, list, isIn, tx, ty, rad, grow) {
  x.beginPath();
  for (const [c, r] of list) {
    const X = tx(c) - grow, Y = ty(r) - grow, S = PX + grow * 2;
    const n = !isIn(c, r - 1), so = !isIn(c, r + 1), w = !isIn(c - 1, r), e = !isIn(c + 1, r);
    const R = rad + grow;
    x.roundRect(X, Y, S, S, [n && w ? R : 0, n && e ? R : 0, so && e ? R : 0, so && w ? R : 0]);
  }
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

// =============================================================================================
// side-view ant (facing +x, feet on y = 0, L = body length in px)
// o: { face, walk (phase), wings 0..1, wingLift 0..1, queen, alpha, scars, digging, pale }
function drawSideAnt(ctx, x, y, L, pal, o) {
  o = o || {};
  const q = !!o.queen;
  ctx.save(); ctx.translate(x, y); ctx.scale((o.face < 0 ? -1 : 1) * L / 20, L / 20);
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // callows (fresh workers) are paler for a while
  const pale = o.pale > 0 ? o.pale : 0;
  const body = pale ? mix(pal.body, '#f0d8b0', pale) : pal.body, head = pale ? mix(pal.head, '#f0d8b0', pale) : pal.head, gas = pale ? mix(pal.gaster, '#d8b890', pale) : pal.gaster;
  const legC = shade(body, -0.35), legFar = shade(body, -0.6);
  const wk = o.walk || 0, dig = o.digging ? Math.sin(wk * 2.2) : 0;
  const hips = [[4.0, -3.5], [2.8, -3.3], [1.6, -3.4]];
  const feet = [6.6, 2.6, -2.6];
  const knees = [1.0, 0.1, -1.0];
  const leg = (k, far) => {
    const ph = wk + k * 2.09 + (far ? Math.PI : 0);
    const sw = Math.sin(ph) * (o.walk != null ? 1.3 : 0), lift = Math.max(0, Math.cos(ph)) * (o.walk != null ? 0.9 : 0);
    let fx = feet[k] + sw + (far ? -0.5 : 0), fy = -lift;
    if (k === 0 && o.digging) { fx = 8.6 + dig * 1.2; fy = -1.4 - Math.abs(dig) * 1.6; }   // front legs scrape at the face
    const [hx, hy] = hips[k];
    const kx = (hx + fx) / 2 + knees[k] + (far ? -0.3 : 0), ky = hy - 1.5;
    ctx.strokeStyle = far ? legFar : legC;
    ctx.lineWidth = q ? 0.5 : 0.55; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = q ? 0.36 : 0.4; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.lineTo(fx + (k === 2 ? -0.8 : 0.8), fy + 0.1); ctx.stroke();
  };
  for (let k = 0; k < 3; k++) leg(k, true);
  // wings behind the far side of the body
  const wing = (lenX, h, yOff, a) => {
    ctx.save(); ctx.translate(2.6, -6.0 + yOff); ctx.rotate(-0.08 - (o.wingLift || 0) * 0.9);
    ctx.globalAlpha *= a;
    const g = ctx.createLinearGradient(0, -h, -lenX, h);
    g.addColorStop(0, 'rgba(235,240,255,0.55)'); g.addColorStop(0.5, 'rgba(210,230,255,0.32)'); g.addColorStop(0.8, 'rgba(255,220,240,0.3)'); g.addColorStop(1, 'rgba(220,255,235,0.25)');
    ctx.fillStyle = g; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.18;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-lenX * 0.3, -h * 1.1, -lenX * 0.85, -h * 0.9, -lenX, -h * 0.1); ctx.bezierCurveTo(-lenX * 0.8, h * 0.6, -lenX * 0.3, h * 0.5, 0, 0); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.3, -0.2); ctx.lineTo(-lenX * 0.55, -h * 0.55); ctx.lineTo(-lenX * 0.9, -h * 0.25);
    ctx.moveTo(-lenX * 0.25, -h * 0.25); ctx.lineTo(-lenX * 0.5, h * 0.1); ctx.lineTo(-lenX * 0.75, h * 0.05); ctx.stroke();
    ctx.fillStyle = 'rgba(90,60,40,0.6)'; ctx.beginPath(); ctx.ellipse(-lenX * 0.55, -h * 0.55, 0.5, 0.22, 0, 0, TAU); ctx.fill();
    ctx.restore();
  };
  if (o.wings > 0) { wing(17, 2.9, -0.3, o.wings * 0.95); }
  // gaster
  const gx = q ? -6.4 : -5.0, gy = q ? -4.2 : -3.7, grx = q ? 5.8 : 4.0, gry = q ? 4.0 : 2.9;
  let g = ctx.createRadialGradient(gx + grx * 0.25, gy - gry * 0.45, gry * 0.2, gx, gy, grx * 1.1);
  g.addColorStop(0, shade(gas, 0.35)); g.addColorStop(0.55, gas); g.addColorStop(1, shade(gas, -0.45));
  ctx.fillStyle = g; ctx.save(); ctx.translate(gx, gy); ctx.rotate(-0.22); ctx.beginPath(); ctx.ellipse(0, 0, grx, gry, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = shade(gas, -0.4); ctx.lineWidth = 0.22;
  for (let k = 0; k < 3; k++) { const sx = grx * (0.45 - k * 0.38); ctx.beginPath(); ctx.ellipse(sx, 0, 0.5, gry * (0.95 - k * 0.1), 0, -1.45, 1.45); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,240,220,0.42)'; ctx.beginPath(); ctx.ellipse(grx * 0.15, -gry * 0.55, grx * 0.45, gry * 0.16, -0.1, 0, TAU); ctx.fill();
  ctx.restore();
  // petiole nodes
  ctx.fillStyle = shade(body, -0.12);
  ctx.beginPath(); ctx.ellipse(-0.6, -4.0, 0.75, 0.8, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0.5, -4.25, 0.7, 0.78, 0, 0, TAU); ctx.fill();
  // mesosoma (thorax): a queen's is deep and humped from the old flight muscles
  g = ctx.createLinearGradient(0, -7, 0, -2.5);
  g.addColorStop(0, shade(body, 0.32)); g.addColorStop(0.5, body); g.addColorStop(1, shade(body, -0.35));
  ctx.fillStyle = g; ctx.beginPath();
  if (q) { ctx.moveTo(1.0, -4.0); ctx.bezierCurveTo(0.8, -6.6, 3.6, -7.2, 5.4, -5.8); ctx.bezierCurveTo(6.2, -5.2, 6.0, -3.6, 5.0, -3.3); ctx.bezierCurveTo(3.6, -2.9, 1.6, -3.0, 1.0, -4.0); }
  else { ctx.moveTo(1.2, -4.0); ctx.bezierCurveTo(1.4, -5.6, 3.4, -5.9, 5.4, -5.2); ctx.bezierCurveTo(6.0, -4.9, 5.9, -3.7, 5.0, -3.5); ctx.bezierCurveTo(3.6, -3.2, 1.8, -3.2, 1.2, -4.0); }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,220,0.38)'; ctx.beginPath(); ctx.ellipse(3.6, q ? -6.4 : -5.2, 1.5, 0.35, -0.2, 0, TAU); ctx.fill();
  if (o.scars) { ctx.fillStyle = shade(body, -0.55); ctx.beginPath(); ctx.ellipse(2.8, -6.3, 0.55, 0.3, -0.3, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.ellipse(1.9, -5.7, 0.4, 0.25, -0.3, 0, TAU); ctx.fill(); }
  // near-side wing on top
  if (o.wings > 0) wing(16, 2.7, 0.2, o.wings);
  // head (bobs while digging)
  const hx = 7.5 + dig * 0.3, hy = -4.9 + dig * 0.25, hr = q ? 1.8 : 1.85;
  g = ctx.createRadialGradient(hx - 0.2, hy - 0.8, 0.2, hx, hy, hr * 1.25);
  g.addColorStop(0, shade(head, 0.35)); g.addColorStop(0.6, head); g.addColorStop(1, shade(head, -0.45));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(hx, hy, hr * 1.08, hr * 0.92, 0.25, 0, TAU); ctx.fill();
  // mandibles
  ctx.strokeStyle = shade(gas, -0.5); ctx.lineWidth = 0.42;
  const mo = o.digging ? Math.abs(dig) * 0.5 : 0;
  ctx.beginPath(); ctx.moveTo(hx + 1.4, hy + 0.7); ctx.quadraticCurveTo(hx + 2.6, hy + 1.0 + mo, hx + 2.9, hy + 1.8 + mo); ctx.stroke();
  // eye with a catchlight
  ctx.fillStyle = 'rgba(14,8,5,0.92)'; ctx.beginPath(); ctx.ellipse(hx + 0.5, hy - 0.45, 0.62, 0.5, 0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,240,210,0.75)'; ctx.beginPath(); ctx.arc(hx + 0.35, hy - 0.62, 0.17, 0, TAU); ctx.fill();
  // elbowed antennae
  const sway = Math.sin((o.t || 0) * 2.3 + (o.seed || 0)) * 0.35;
  ctx.strokeStyle = legC; ctx.lineWidth = 0.36;
  const bx = hx + 0.9, by = hy - 1.2, ex = bx + 1.0, ey = by - 2.4 + sway * 0.4, tx = ex + 2.8, ty = ey + 0.9 + sway;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.quadraticCurveTo(ex + 1.6, ey - 0.2 + sway * 0.5, tx, ty); ctx.stroke();
  ctx.lineWidth = 0.62; ctx.beginPath(); ctx.moveTo(tx - 0.7, ty - 0.25); ctx.lineTo(tx, ty); ctx.stroke();
  for (let k = 0; k < 3; k++) leg(k, false);
  ctx.restore();
}

// ---- brood ----------------------------------------------------------------------------------
function drawEgg(ctx, x, y, s, glow, t) {
  if (glow) {
    const gg = ctx.createRadialGradient(x, y, 0, x, y, s * 4.5);
    gg.addColorStop(0, 'rgba(255,236,190,' + (0.32 * glow) + ')'); gg.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, s * 4.5, 0, TAU); ctx.fill();
  }
  const g = ctx.createRadialGradient(x - s * 0.35, y - s * 0.4, s * 0.1, x, y, s * 1.3);
  g.addColorStop(0, '#fffdf4'); g.addColorStop(0.55, '#f4ead2'); g.addColorStop(1, '#cdbf9e');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.72, 0.5, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(x - s * 0.35, y - s * 0.3, s * 0.28, s * 0.14, 0.5, 0, TAU); ctx.fill();
}
function drawLarva(ctx, x, y, s, k, hungry, t) {
  // a curled grub: beads along a C, fat in the middle
  const n = 9, col = hungry ? '#d6c9a6' : '#f6edd6', dark = hungry ? '#a89a78' : '#d9c8a2';
  const wig = Math.sin(t * 3 + k) * 0.08;
  ctx.save(); ctx.translate(x, y - s * 0.75); ctx.rotate(k * 0.9 + wig);
  for (let i = n - 1; i >= 0; i--) {
    const a = -0.4 + i / (n - 1) * 3.6, r = s * (0.33 + 0.3 * Math.sin(i / (n - 1) * Math.PI)) * (hungry ? 0.85 : 1);
    const px = Math.cos(a) * s * 0.75, py = Math.sin(a) * s * 0.75;
    const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.4, r * 0.1, px, py, r * 1.1);
    g.addColorStop(0, '#fffaf0'); g.addColorStop(0.6, col); g.addColorStop(1, dark);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
  }
  // head
  const ha = -0.4, hx = Math.cos(ha) * s * 0.75, hy = Math.sin(ha) * s * 0.75;
  ctx.fillStyle = '#c99a4a'; ctx.beginPath(); ctx.arc(hx + s * 0.12, hy - s * 0.05, s * 0.2, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawPupa(ctx, x, y, s, age, k) {
  // naked pupa lying on its side: a pale ant with folded legs that darkens as it matures
  const col = mix('#f3e8cf', '#b07a46', AL.clamp((age - 0.35) / 0.65, 0, 1) * 0.85);
  ctx.save(); ctx.translate(x, y - s * 0.45); ctx.rotate((k % 2 ? 1 : -1) * 0.12);
  const part = (px, py, rx, ry) => {
    const g = ctx.createRadialGradient(px - rx * 0.3, py - ry * 0.4, 0.5, px, py, Math.max(rx, ry) * 1.2);
    g.addColorStop(0, '#fffaf0'); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.3));
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(px, py, rx, ry, 0, 0, TAU); ctx.fill();
  };
  part(-s * 0.55, 0, s * 0.62, s * 0.45); part(s * 0.15, -s * 0.05, s * 0.4, s * 0.3); part(s * 0.7, 0.02 * s, s * 0.3, s * 0.3);
  ctx.strokeStyle = shade(col, -0.25); ctx.lineWidth = Math.max(0.6, s * 0.06);
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(s * (0.0 + i * 0.15), s * 0.2); ctx.quadraticCurveTo(s * (0.1 + i * 0.15), s * 0.42, s * (0.35 + i * 0.12), s * 0.36); ctx.stroke(); }
  if (age > 0.6) { ctx.fillStyle = 'rgba(30,18,10,' + ((age - 0.6) * 2) + ')'; ctx.beginPath(); ctx.arc(s * 0.82, -s * 0.06, s * 0.09, 0, TAU); ctx.fill(); }
  ctx.restore();
}

// =============================================================================================
class View {
  constructor(fs, opts) {
    this.fs = fs; this.opts = opts || {};
    this.t = 0; this.cam = null; this.parts = []; this.lostWings = []; this.lastFx = 0;
    const sp = AL.SPECIES && AL.SPECIES[fs.spKey];
    this.pal = sp ? { body: sp.body, head: sp.head, gaster: sp.gaster } : { body: '#9a3b1e', head: '#7e2c14', gaster: '#3a1a10' };
    this.rival = AL.RIVAL_COLOURS || { body: '#c4291b', head: '#a51d12', gaster: '#46120c' };
    this.c0 = Math.max(0, fs.entrance.c - HALF); this.c1 = Math.min(fs.cols, fs.entrance.c + HALF + 1);
    this.r1 = Math.min(fs.rows, DEPTH);
    this.paintTexture();
    this.caveKey = ''; this.cave = null;
    this.workers = new Map();
    this.fxSeen = new WeakSet();
    this.intruder = null;
    this.flash = 0;
  }
  // tile -> texture pixel
  tx(c) { return (c - this.c0) * PX; }
  ty(r) { return (r + SKY) * PX; }

  // ---- the painted soil cross-section (once) ----
  paintTexture() {
    const fs = this.fs, g = fs.grid, cols = this.c1 - this.c0, rows = this.r1;
    const W = cols * PX, H = (rows + SKY) * PX;
    const tex = cnv(W, H), x = tex.getContext('2d');
    const R = AL.rng(fs.seed ^ 0xabc);
    const at = (c, r) => AL.Sites.tileAt(g, c, r);
    // 1) sky: warm afternoon daylight
    const sky = x.createLinearGradient(0, 0, 0, SKY * PX);
    sky.addColorStop(0, '#8fc0d6'); sky.addColorStop(0.55, '#d7e3c8'); sky.addColorStop(1, '#f4dca6');
    x.fillStyle = sky; x.fillRect(0, 0, W, SKY * PX);
    // sun haze upper left
    let hg = x.createRadialGradient(W * 0.18, SKY * PX * 0.15, 4, W * 0.18, SKY * PX * 0.15, W * 0.5);
    hg.addColorStop(0, 'rgba(255,246,214,0.85)'); hg.addColorStop(1, 'rgba(255,246,214,0)');
    x.fillStyle = hg; x.fillRect(0, 0, W, SKY * PX);
    // distant soft hedge/grass silhouettes
    for (let layer = 0; layer < 2; layer++) {
      x.fillStyle = layer ? 'rgba(96,140,70,0.75)' : 'rgba(140,172,112,0.55)';
      x.beginPath(); x.moveTo(0, SKY * PX);
      for (let px = 0; px <= W; px += 24) x.lineTo(px, SKY * PX - PX * (layer ? 1.2 : 2.4) - AL.fbm(px / 160, layer * 9, fs.seed, 3) * PX * (layer ? 1.6 : 2.6));
      x.lineTo(W, SKY * PX); x.fill();
    }
    // 2) soft colour map (1 px per tile, smoothed up) for the loose materials
    const cm = cnv(cols, rows), cx = cm.getContext('2d'), id = cx.createImageData(cols, rows);
    const looseOf = (c, r) => {
      let v = at(c, r);
      if (v === T.ROCK || v === T.ROOT || v === T.SLAB || v === T.WOOD || v === T.GALLERY || v === T.AIR) v = r < 6 ? T.TOPSOIL : T.CLAY;
      if (fs.grid.kind === 'sand' && (v === T.TOPSOIL || v === T.CLAY) && r < g.waterRow - 3) v = T.SAND;
      return v;
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = looseOf(c + this.c0, r), [cr, cg, cb] = hexRgb(TI[v].col);
      const n = (AL.fbm((c + this.c0) / 6, r / 5, fs.seed, 3) - 0.5) * 0.28, d = 1 - Math.min(0.35, r / 70);
      const k = (r * cols + c) * 4;
      id.data[k] = AL.clamp(cr * (1 + n) * d, 0, 255); id.data[k + 1] = AL.clamp(cg * (1 + n) * d, 0, 255); id.data[k + 2] = AL.clamp(cb * (1 + n) * d, 0, 255); id.data[k + 3] = 255;
    }
    cx.putImageData(id, 0, 0);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.save(); x.beginPath(); x.rect(0, SKY * PX, W, rows * PX); x.clip();
    x.drawImage(cm, 0, 0, cols, rows, -PX * 0.5, SKY * PX - PX * 0.5, W + PX, rows * PX + PX);
    x.restore();
    // 3) mottling and grain, per material
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const gc = c + this.c0, v = at(gc, r), X = c * PX, Y = (r + SKY) * PX;
      const n = v === T.SAND ? 26 : v === T.GRAVEL ? 9 : v === T.MULCH ? 14 : v === T.HUMUS ? 16 : 18;
      for (let k = 0; k < n; k++) {
        const px = X + R() * PX, py = Y + R() * PX;
        if (v === T.GRAVEL) {
          const rr = 3 + R() * 6;
          x.fillStyle = 'rgba(30,22,14,0.35)'; x.beginPath(); x.ellipse(px + 1.5, py + 2, rr, rr * 0.75, 0, 0, TAU); x.fill();
          x.fillStyle = ['#8f877a', '#a39a8a', '#7a7266', '#b2a894'][k % 4]; x.beginPath(); x.ellipse(px, py, rr, rr * 0.75, R() * 3, 0, TAU); x.fill();
          x.fillStyle = 'rgba(255,255,255,0.22)'; x.beginPath(); x.ellipse(px - rr * 0.3, py - rr * 0.3, rr * 0.35, rr * 0.2, 0, 0, TAU); x.fill();
        } else if (v === T.SAND) {
          x.fillStyle = ['rgba(250,230,190,0.55)', 'rgba(150,115,70,0.45)', 'rgba(220,190,140,0.5)'][k % 3]; x.fillRect(px, py, 1.6, 1.6);
        } else if (v === T.MULCH) {
          x.save(); x.translate(px, py); x.rotate(R() * 3); x.fillStyle = ['#6b4a2c', '#7c5a36', '#2a1a0c', '#5a3c22'][k % 4]; x.fillRect(-5, -1.6, 10, 3.2); x.restore();
        } else if (v === T.CLAY) {
          x.fillStyle = k % 3 ? 'rgba(150,96,62,0.25)' : 'rgba(60,36,20,0.2)'; x.beginPath(); x.ellipse(px, py, 2 + R() * 4, 1 + R() * 1.5, 0, 0, TAU); x.fill();
        } else if (v === T.WATER) {
          // drawn below
        } else {
          x.fillStyle = k % 4 === 0 ? 'rgba(200,170,130,0.35)' : k % 4 === 1 ? 'rgba(25,15,8,0.3)' : 'rgba(120,85,55,0.3)';
          const rr = 0.8 + R() * 2.2; x.beginPath(); x.arc(px, py, rr, 0, TAU); x.fill();
        }
      }
      if ((v === T.TOPSOIL || v === T.HUMUS) && R() < 0.12) { // a buried twig or a pale root hair
        x.strokeStyle = 'rgba(190,160,120,0.35)'; x.lineWidth = 1.2; x.beginPath(); const px = X + R() * PX, py = Y + R() * PX; x.moveTo(px, py); x.quadraticCurveTo(px + 8, py + 5, px + 16 + R() * 10, py + R() * 10); x.stroke();
      }
    }
    // 4) water table
    const wy = this.ty(g.waterRow);
    if (g.waterRow < rows) {
      const wg = x.createLinearGradient(0, wy - PX, 0, wy + PX * 3);
      wg.addColorStop(0, 'rgba(47,95,116,0)'); wg.addColorStop(0.3, 'rgba(47,95,116,0.65)'); wg.addColorStop(1, 'rgba(30,62,80,0.9)');
      x.fillStyle = wg; x.fillRect(0, wy - PX, W, H - wy + PX);
    }
    // 5) hard features: wood, rock, roots, slab
    this.paintHard(x, R);
    // 6) the ground line: a lip of turf (or the site's surface) along r = 0
    this.paintSurface(x, R);
    this.tex = tex;
  }
  paintHard(x, R) {
    const fs = this.fs, g = fs.grid, at = (c, r) => AL.Sites.tileAt(g, c, r), feat = g.feature || {};
    const cols = this.c1 - this.c0;
    // wood (log/stump core): one shape per connected band with grain lines
    for (let r = 0; r < this.r1; r++) for (let c = this.c0; c < this.c1; c++) {
      const v = at(c, r); if (v !== T.WOOD && v !== T.GALLERY) continue;
      const X = this.tx(c), Y = this.ty(r);
      const wg = x.createLinearGradient(X, Y, X, Y + PX);
      wg.addColorStop(0, '#8a6440'); wg.addColorStop(1, '#6e4e30');
      x.fillStyle = wg; x.fillRect(X - 0.5, Y - 0.5, PX + 1, PX + 1);
      x.strokeStyle = 'rgba(60,38,20,0.45)'; x.lineWidth = 1.3;
      const vert = feat.kind === 'stump';
      for (let k = 0; k < 4; k++) {
        x.beginPath();
        if (vert) { const px = X + (k + 0.5) * PX / 4 + Math.sin(r * 1.3 + k) * 2; x.moveTo(px, Y); x.quadraticCurveTo(px + Math.sin(c + k) * 4, Y + PX / 2, px, Y + PX); }
        else { const py = Y + (k + 0.5) * PX / 4 + Math.sin(c * 1.1 + k) * 2; x.moveTo(X, py); x.quadraticCurveTo(X + PX / 2, py + Math.sin(r + k) * 4, X + PX, py); }
        x.stroke();
      }
      if (R() < 0.08) { x.fillStyle = 'rgba(40,24,12,0.6)'; x.beginPath(); x.ellipse(X + PX / 2, Y + PX / 2, 6, 4, 0, 0, TAU); x.fill(); x.strokeStyle = 'rgba(180,140,90,0.4)'; x.lineWidth = 1; x.beginPath(); x.ellipse(X + PX / 2, Y + PX / 2, 9, 6, 0, 0, TAU); x.stroke(); }
      if (fs.grid.kind === 'log' && R() < 0.12) { x.fillStyle = 'rgba(238,230,205,0.5)'; x.beginPath(); x.arc(X + R() * PX, Y + R() * PX, 2 + R() * 2, 0, TAU); x.fill(); } // fungus flecks in rotten wood
    }
    // wood outline (bark edge) where wood meets soil
    x.strokeStyle = '#3e2a18'; x.lineWidth = 5;
    for (let r = 0; r < this.r1; r++) for (let c = this.c0; c < this.c1; c++) {
      const v = at(c, r); if (v !== T.WOOD && v !== T.GALLERY) continue;
      const X = this.tx(c), Y = this.ty(r), isW = (cc, rr) => { const u = at(cc, rr); return u === T.WOOD || u === T.GALLERY || u === T.AIR; };
      x.beginPath();
      if (!isW(c - 1, r)) { x.moveTo(X, Y); x.lineTo(X, Y + PX); }
      if (!isW(c + 1, r)) { x.moveTo(X + PX, Y); x.lineTo(X + PX, Y + PX); }
      if (r + 1 < this.r1 && !isW(c, r + 1)) { x.moveTo(X, Y + PX); x.lineTo(X + PX, Y + PX); }
      x.stroke();
    }
    // stones: union of blobs per rock tile, shaded
    const rockTiles = [];
    for (let r = 0; r < this.r1; r++) for (let c = this.c0; c < this.c1; c++) if (at(c, r) === T.ROCK) rockTiles.push([c, r]);
    const isRock = (c, r) => at(c, r) === T.ROCK;
    const blobPath = (list, grow) => tilePath(x, list, isRock, c => this.tx(c), r => this.ty(r), PX * 0.48, grow);
    x.fillStyle = 'rgba(20,14,8,0.4)'; x.save(); x.translate(4, 6); blobPath(rockTiles, 2); x.fill(); x.restore();
    blobPath(rockTiles, 0); x.save(); x.clip();
    const sg = x.createLinearGradient(0, this.ty(0), 0, this.ty(this.r1));
    sg.addColorStop(0, '#aaa395'); sg.addColorStop(1, '#6e695e');
    x.fillStyle = sg; x.fillRect(0, 0, cols * PX, this.ty(this.r1));
    for (const [c, r] of rockTiles) { const X = this.tx(c), Y = this.ty(r); for (let k = 0; k < 6; k++) { x.fillStyle = k % 2 ? 'rgba(255,255,255,0.1)' : 'rgba(40,36,30,0.14)'; x.beginPath(); x.arc(X + R() * PX, Y + R() * PX, 2 + R() * 5, 0, TAU); x.fill(); } }
    // darker underside of each stone
    for (const [c, r] of rockTiles) if (!isRock(c, r + 1)) { const g2 = x.createLinearGradient(0, this.ty(r) + PX * 0.4, 0, this.ty(r + 1)); g2.addColorStop(0, 'rgba(30,26,20,0)'); g2.addColorStop(1, 'rgba(30,26,20,0.45)'); x.fillStyle = g2; x.fillRect(this.tx(c), this.ty(r), PX, PX); }
    // top light on each stone
    x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = 3;
    for (const [c, r] of rockTiles) if (at(c, r - 1) !== T.ROCK) { const X = this.tx(c), Y = this.ty(r); x.beginPath(); x.moveTo(X + 6, Y + 8); x.lineTo(X + PX - 6, Y + 6); x.stroke(); }
    x.restore();
    // roots: smooth tapered strokes along the generator's root paths
    x.lineCap = 'round'; x.lineJoin = 'round';
    const paths = (g.rootPaths || []).filter(p => p.pts.length > 1);
    for (let pass = 0; pass < 3; pass++) for (const p of paths) {
      const n = p.pts.length, base = PX * (0.3 + p.w * 0.5);
      for (let i = 1; i < n; i++) {
        const k = 1 - i / n, w = base * (0.35 + 0.65 * k);
        const [c0, r0] = p.pts[i - 1], [c1, r1] = p.pts[i];
        const X0 = (c0 - this.c0) * PX, Y0 = (r0 + SKY) * PX, X1 = (c1 - this.c0) * PX, Y1 = (r1 + SKY) * PX;
        x.strokeStyle = pass === 0 ? 'rgba(25,16,8,0.4)' : pass === 1 ? (p.w > 0.3 ? '#6b4a2e' : '#7a5a3a') : 'rgba(215,180,130,0.32)';
        x.lineWidth = pass === 0 ? w + 4 : pass === 1 ? w : w * 0.22;
        const oy = pass === 0 ? 3 : pass === 2 ? -w * 0.22 : 0;
        x.beginPath(); x.moveTo(X0, Y0 + oy); x.lineTo(X1, Y1 + oy); x.stroke();
      }
      if (pass === 2) for (let i = 2; i < n; i += 3) { const [c, r] = p.pts[i]; const X = (c - this.c0) * PX, Y = (r + SKY) * PX; x.strokeStyle = 'rgba(200,170,130,0.28)'; x.lineWidth = 1; x.beginPath(); x.moveTo(X, Y); x.lineTo(X + (R() - 0.5) * PX * 0.8, Y + R() * PX * 0.5); x.stroke(); }
    }
    // concrete slab (pavement crack)
    for (let r = 0; r < 2; r++) for (let c = this.c0; c < this.c1; c++) {
      if (at(c, r) !== T.SLAB) continue;
      const X = this.tx(c), Y = this.ty(r);
      x.fillStyle = r === 0 ? '#b9b3a6' : '#a39d90'; x.fillRect(X - 0.5, Y, PX + 1, PX);
      for (let k = 0; k < 8; k++) { x.fillStyle = ['#8e887c', '#cfc9bb', '#7c766b'][k % 3]; x.beginPath(); x.arc(X + R() * PX, Y + R() * PX, 1 + R() * 2.5, 0, TAU); x.fill(); }
    }
    if (feat.kind === 'crack') {
      // joints every few tiles and a dark crack at the entrance
      x.fillStyle = 'rgba(40,34,26,0.8)';
      for (let c = this.c0; c < this.c1; c++) if ((c - fs.entrance.c) % (feat.joint || 7) === 0 && c !== fs.entrance.c) x.fillRect(this.tx(c) - 1.5, this.ty(0), 3, PX * 2);
      x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, this.ty(0), (this.c1 - this.c0) * PX, 3);
    }
  }
  paintSurface(x, R) {
    const fs = this.fs, feat = fs.grid.feature || {}, gy = this.ty(0), W = (this.c1 - this.c0) * PX;
    const kind = fs.grid.kind;
    const E = this.tx(fs.entrance.c) + PX / 2;
    // props standing on the ground, behind the turf lip
    if (kind === 'rock') {
      const X0 = this.tx(feat.c0), X1 = this.tx(feat.c0 + feat.w), top = gy - PX * 2.1;
      x.fillStyle = 'rgba(20,15,10,0.25)'; x.beginPath(); x.ellipse((X0 + X1) / 2 + 10, gy + 4, (X1 - X0) / 2, PX * 0.4, 0, 0, TAU); x.fill();
      const g = x.createLinearGradient(0, top, 0, gy);
      g.addColorStop(0, '#cfc9ba'); g.addColorStop(0.6, '#9a9486'); g.addColorStop(1, '#7a7468');
      x.fillStyle = g; x.beginPath(); x.moveTo(X0 - PX * 0.3, gy + PX * 0.2);
      x.bezierCurveTo(X0, top + PX * 0.3, X0 + PX * 2, top, (X0 + X1) / 2, top); x.bezierCurveTo(X1 - PX * 2, top, X1 + PX * 0.2, top + PX * 0.6, X1 + PX * 0.3, gy + PX * 0.3); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.35)'; x.lineWidth = 4; x.beginPath(); x.moveTo(X0 + PX * 1.2, top + PX * 0.5); x.quadraticCurveTo((X0 + X1) / 2, top + PX * 0.05, X1 - PX * 2.5, top + PX * 0.3); x.stroke();
      x.fillStyle = 'rgba(120,150,70,0.55)'; x.beginPath(); x.ellipse(X0 + PX * 2.5, top + PX * 0.5, PX * 1.2, PX * 0.3, -0.1, 0, TAU); x.fill();
    } else if (kind === 'log') {
      const X0 = this.tx(feat.c0), X1 = this.tx(feat.c0 + feat.w), h = PX * 3.2;
      const g = x.createLinearGradient(0, gy - h, 0, gy);
      g.addColorStop(0, '#a5825a'); g.addColorStop(0.5, '#7a5a3a'); g.addColorStop(1, '#4e3620');
      x.fillStyle = g; x.beginPath(); x.moveTo(X0, gy); x.quadraticCurveTo(X0, gy - h, X0 + PX * 2, gy - h); x.lineTo(X1 - PX * 2, gy - h); x.quadraticCurveTo(X1, gy - h, X1, gy); x.fill();
      x.strokeStyle = 'rgba(50,32,18,0.55)'; x.lineWidth = 2.2;
      for (let k = 0; k < 18; k++) { const px = X0 + PX * 2 + R() * (X1 - X0 - PX * 4), py = gy - h + PX * 0.4 + R() * (h - PX * 0.8); x.beginPath(); x.moveTo(px, py); x.lineTo(px + 30 + R() * 50, py + (R() - 0.5) * 6); x.stroke(); }
      x.fillStyle = 'rgba(110,150,60,0.6)';
      for (let k = 0; k < 8; k++) { x.beginPath(); x.ellipse(X0 + PX * 2 + R() * (X1 - X0 - PX * 4), gy - h + 6, 14 + R() * 18, 6, 0, 0, TAU); x.fill(); }
      // shelf fungus
      for (let k = 0; k < 3; k++) { const px = X0 + PX * (4 + k * 9 + R() * 3), py = gy - h * (0.35 + R() * 0.3); x.fillStyle = '#d9b77a'; x.beginPath(); x.ellipse(px, py, 16, 6, 0, Math.PI, TAU); x.fill(); x.fillStyle = 'rgba(120,80,40,0.5)'; x.fillRect(px - 16, py - 1, 32, 2); }
    } else if (kind === 'stump') {
      const X0 = this.tx(feat.c0), X1 = this.tx(feat.c0 + feat.w), h = PX * 4.2;
      const g = x.createLinearGradient(X0, 0, X1, 0);
      g.addColorStop(0, '#5a3e24'); g.addColorStop(0.35, '#8a6844'); g.addColorStop(1, '#4a321c');
      x.fillStyle = g; x.beginPath(); x.moveTo(X0 - PX * 0.05, gy); x.quadraticCurveTo(X0 + PX * 0.1, gy - PX * 0.4, X0 + PX * 0.2, gy - h); x.lineTo(X1 - PX * 0.2, gy - h + PX * 0.5); x.quadraticCurveTo(X1, gy - PX * 0.4, X1 + PX * 1.4, gy); x.fill();
      x.strokeStyle = 'rgba(40,26,14,0.55)'; x.lineWidth = 2.4;
      for (let k = 0; k < 10; k++) { const px = X0 + PX * 0.6 + k * (X1 - X0 - PX * 1.2) / 9; x.beginPath(); x.moveTo(px, gy - h + PX * 0.6); x.quadraticCurveTo(px + Math.sin(k) * 6, gy - h / 2, px + Math.sin(k * 2) * 4, gy - 4); x.stroke(); }
      // cut top
      x.fillStyle = '#c9a671'; x.beginPath(); x.moveTo(X0 + PX * 0.2, gy - h); x.lineTo(X1 - PX * 0.2, gy - h + PX * 0.5); x.lineTo(X1 - PX * 0.4, gy - h + PX * 0.75); x.lineTo(X0 + PX * 0.2, gy - h + PX * 0.3); x.fill();
      // beetle holes
      x.fillStyle = 'rgba(20,12,6,0.85)';
      for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(X0 + PX + R() * (X1 - X0 - PX * 2), gy - PX * 0.6 - R() * (h - PX * 1.4), 3, 0, TAU); x.fill(); }
    } else if (kind === 'roots') {
      const TX = this.tx(feat.trunkC || fs.entrance.c - 9);
      const g = x.createLinearGradient(TX - PX * 3, 0, TX + PX * 3, 0);
      g.addColorStop(0, '#4a321c'); g.addColorStop(0.4, '#7a5a38'); g.addColorStop(1, '#3e2a18');
      x.fillStyle = g; x.beginPath(); x.moveTo(TX - PX * 6, gy + 2); x.quadraticCurveTo(TX - PX * 2.2, gy - PX * 0.6, TX - PX * 2.2, 0); x.lineTo(TX + PX * 2.2, 0); x.quadraticCurveTo(TX + PX * 2.2, gy - PX * 0.6, TX + PX * 7, gy + 2); x.fill();
      x.strokeStyle = 'rgba(30,18,8,0.45)'; x.lineWidth = 3;
      for (let k = 0; k < 7; k++) { const px = TX - PX * 1.8 + k * PX * 0.6; x.beginPath(); x.moveTo(px, 0); x.lineTo(px + Math.sin(k) * 6, gy - PX * 0.5); x.stroke(); }
      // fallen apple
      const ax = TX + PX * 9, ay = gy - PX * 0.7, ar = PX * 0.75;
      const ag = x.createRadialGradient(ax - ar * 0.35, ay - ar * 0.4, 2, ax, ay, ar); ag.addColorStop(0, '#f07a5a'); ag.addColorStop(0.6, '#c8322a'); ag.addColorStop(1, '#7a1e18');
      x.fillStyle = ag; x.beginPath(); x.arc(ax, ay, ar, 0, TAU); x.fill();
    } else if (kind === 'garden') {
      for (let k = 0; k < 5; k++) {
        const px = E + (k - 2) * PX * 3.4 + (R() - 0.5) * PX, h = PX * (2 + R() * 2.2);
        x.strokeStyle = '#4a7a2e'; x.lineWidth = 4; x.beginPath(); x.moveTo(px, gy); x.quadraticCurveTo(px + 6, gy - h * 0.5, px, gy - h); x.stroke();
        for (let j = 0; j < 4; j++) { const ly = gy - h * (0.25 + j * 0.2), s = j % 2 ? 1 : -1; x.fillStyle = j % 2 ? '#6aa646' : '#5a9a3e'; x.beginPath(); x.ellipse(px + s * PX * 0.45, ly, PX * 0.5, PX * 0.18, s * -0.5, 0, TAU); x.fill(); }
        if (k % 2 === 0) { x.fillStyle = ['#e85a7a', '#f2c531', '#b47ae8'][k % 3]; for (let j = 0; j < 6; j++) { const a = j / 6 * TAU; x.beginPath(); x.ellipse(px + Math.cos(a) * 7, gy - h + Math.sin(a) * 7, 7, 4, a, 0, TAU); x.fill(); } x.fillStyle = '#f6e7a0'; x.beginPath(); x.arc(px, gy - h, 4, 0, TAU); x.fill(); }
        // aphids on the stem
        for (let j = 0; j < 4; j++) { x.fillStyle = '#c8e68a'; x.beginPath(); x.ellipse(px + 4, gy - h * (0.4 + j * 0.08), 3, 2, 0.5, 0, TAU); x.fill(); }
      }
    } else if (kind === 'sand') {
      // a puddle at the foot of the bank
      const px = E + PX * 9, pw = PX * 6;
      const wg = x.createLinearGradient(0, gy - 4, 0, gy + PX * 0.8);
      wg.addColorStop(0, '#9fd0e6'); wg.addColorStop(1, '#3e6f8a');
      x.fillStyle = wg; x.beginPath(); x.ellipse(px, gy + 2, pw, PX * 0.7, 0, 0, Math.PI); x.fill();
      x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 2; x.beginPath(); x.moveTo(px - pw * 0.8, gy + 1); x.lineTo(px + pw * 0.8, gy + 1); x.stroke();
    }
    // the turf lip (the slab gets no grass, the sand only a few tufts)
    if (kind !== 'crack') {
      const thin = kind === 'sand' ? 0.25 : kind === 'garden' ? 0.4 : 1;
      x.fillStyle = kind === 'sand' ? '#d8b47a' : kind === 'garden' ? '#3f2a1a' : '#4f7f33';
      x.beginPath(); x.moveTo(0, gy + 6); for (let px = 0; px <= W; px += 12) x.lineTo(px, gy - 2 + Math.sin(px * 0.05) * 2); x.lineTo(W, gy + 6); x.fill();
      const GR = ['#4f7f33', '#5a8b3a', '#64963f', '#6f9f45', '#7aa84c', '#577f36'];
      for (let k = 0; k < W / 3 * thin; k++) {
        const px = R() * W;
        if (kind === 'rock' && px > this.tx(feat.c0) && px < this.tx(feat.c0 + feat.w)) continue;
        if ((kind === 'log' || kind === 'stump') && px > this.tx(feat.c0) + PX && px < this.tx(feat.c0 + feat.w) - PX) continue;
        if (Math.abs(px - E) < PX * 0.6) continue;     // the entrance itself is bare
        const h = PX * (0.25 + R() * 0.65) * (kind === 'meadow' ? 1.6 : 1);
        x.strokeStyle = GR[k % GR.length]; x.lineWidth = 1.5 + R() * 1.5;
        x.beginPath(); x.moveTo(px, gy + 3); x.quadraticCurveTo(px + (R() - 0.5) * 10, gy - h * 0.5, px + (R() - 0.5) * 14, gy - h); x.stroke();
      }
      if (kind === 'meadow') for (let k = 0; k < 4; k++) { const px = R() * W, h = PX * (1.6 + R()); x.strokeStyle = '#6f9f45'; x.lineWidth = 2; x.beginPath(); x.moveTo(px, gy); x.lineTo(px + 4, gy - h); x.stroke(); x.fillStyle = 'rgba(255,255,255,0.85)'; x.beginPath(); x.arc(px + 4, gy - h, 8, 0, TAU); x.fill(); }
    } else {
      // weeds poking out of the crack
      for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + (k - 2.5) * 0.35; x.strokeStyle = k % 2 ? '#6f9f45' : '#5a8b3a'; x.lineWidth = 3; x.beginPath(); x.moveTo(E, gy + 2); x.quadraticCurveTo(E + Math.cos(a) * PX * 0.5, gy + Math.sin(a) * PX * 0.4, E + Math.cos(a) * PX * 0.9, gy + Math.sin(a) * PX * 0.9); x.stroke(); }
    }
    // soft shadow just under the ground line
    const sh = x.createLinearGradient(0, gy, 0, gy + PX * 0.8);
    sh.addColorStop(0, 'rgba(20,12,6,0.35)'); sh.addColorStop(1, 'rgba(20,12,6,0)');
    x.fillStyle = sh; x.fillRect(0, gy, W, PX * 0.8);
  }

  // ---- dug cavities, rebuilt when the grid changes ----
  buildCave() {
    const fs = this.fs, g = fs.grid, W = this.tex.width, H = this.tex.height;
    if (!this.cave) { this.cave = cnv(W, H); this.rim = cnv(W, H); this.mask = cnv(W, H); }
    const open = [];
    for (let r = 0; r < this.r1; r++) for (let c = this.c0; c < this.c1; c++) { const v = AL.Sites.tileAt(g, c, r); if (v === T.AIR || v === T.GALLERY) open.push([c, r, v]); }
    const isOpen = (c, r) => { const v = AL.Sites.tileAt(g, c, r); return v === T.AIR || v === T.GALLERY || (r < 0 && !fs.sealed && c === fs.entrance.c && fs.dug > 0); };
    const shape = (x, grow) => {
      tilePath(x, open, isOpen, c => this.tx(c), r => this.ty(r), PX * 0.45, grow);
      // the shaft opens to the sky until it is sealed
      if (!fs.sealed && fs.dug > 0 && fs.prof.mode !== 'bivouac') { const X = this.tx(fs.entrance.c); x.rect(X + PX * 0.08 - grow, this.ty(0) - PX * 0.3, PX * 0.84 + grow * 2, PX * 0.6); }
    };
    // rim: lit, slightly bigger outline of every tunnel (packed, smoothed walls)
    let x = this.rim.getContext('2d'); x.clearRect(0, 0, W, H);
    x.fillStyle = 'rgba(164,124,84,0.75)'; shape(x, PX * 0.09); x.fill();
    // interior: dark, with an inner shadow along the top
    x = this.cave.getContext('2d'); x.clearRect(0, 0, W, H);
    x.fillStyle = '#26180e'; shape(x, 0); x.fill();
    x.save(); x.globalCompositeOperation = 'source-atop';
    x.filter = 'blur(' + (PX * 0.22) + 'px)';
    x.fillStyle = 'rgba(70,46,28,0.9)'; x.save(); x.translate(0, PX * 0.32); shape(x, -PX * 0.12); x.fill(); x.restore();
    x.filter = 'none';
    x.restore();
    // a packed-earth floor line
    x.save(); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(120,84,52,0.35)';
    for (const [c, r] of open) { const below = AL.Sites.tileAt(g, c, r + 1); if (below !== T.AIR && below !== T.GALLERY) x.fillRect(this.tx(c) - 2, this.ty(r + 1) - PX * 0.2, PX + 4, PX * 0.2); }
    x.restore();
    this.openCount = open.length;
  }

  // ---- camera ----
  camTarget(W, H) {
    const fs = this.fs, q = fs.queen, b = fs.chamberBox;
    const ph = fs.phase;
    if (ph === 'land' || ph === 'shed' || ph === 'choose') return { c: fs.entrance.c + 0.5, r: 0.2, ts: Math.min(W / 12, H / 7.5) };
    if (ph === 'dig' || ph === 'seal') return { c: q.c, r: Math.max(0.8, q.r), ts: Math.min(W / 13, H / 8.5) };
    if (b && b.bivouac) return { c: b.c0 + b.w / 2, r: -0.9, ts: Math.min(W / 11, H / 6.5) };
    // rival scouts at the entrance: pull back so the surface and the chamber are both in view
    if (b && this.pendingRaid() && (ph === 'brood' || ph === 'open')) return { c: (b.c0 + b.w / 2 + fs.entrance.c + 0.5) / 2, r: (b.r0 + b.h) * 0.45 - 0.6, ts: Math.min(W / 15, H * 0.62 / (b.r0 + b.h + 2.5)) };
    if (b) return { c: b.c0 + b.w / 2, r: b.r0 + b.h * 0.55, ts: Math.min(W * 0.62 / (b.w + 1.6), H * 0.5 / (b.h + 1.2)) };
    return { c: q.c, r: q.r, ts: H / 8 };
  }

  pendingRaid() { const race = this.opts.race; return race && race.pending.length ? race.pending[0] : null; }
  rivalPal(spKey) {
    const sp = AL.SPECIES && AL.SPECIES[spKey];
    if (!sp) return this.rival;
    return { body: mix(sp.body, '#c4291b', 0.45), head: mix(sp.head, '#a51d12', 0.45), gaster: mix(sp.gaster, '#46120c', 0.35) };
  }
  // ---- frame ----
  draw(ctx, W, H, dt) {
    const fs = this.fs, q = fs.queen;
    this.t += dt;
    const key = fs.dug + ':' + fs.sealed + ':' + fs.stats.caveIns;
    if (key !== this.caveKey) { this.caveKey = key; this.buildCave(); }
    // camera ease
    const tg = this.camTarget(W, H);
    if (!this.cam) this.cam = Object.assign({}, tg);
    const k = 1 - Math.exp(-dt * 2.2);
    this.cam.c += (tg.c - this.cam.c) * k; this.cam.r += (tg.r - this.cam.r) * k; this.cam.ts += (tg.ts - this.cam.ts) * k;
    const cam = this.cam, ts = cam.ts, s = ts / PX;
    const ox = W / 2 - (cam.c - this.c0) * ts, oy = H * 0.44 - (cam.r + SKY) * ts;
    this.screen = { ox, oy, ts, s };
    const sx = c => ox + (c - this.c0) * ts, sy = r => oy + (r + SKY) * ts;
    // background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#120d08'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(s, 0, 0, s, ox, oy);
    ctx.drawImage(this.tex, 0, 0);
    ctx.drawImage(this.rim, 0, 0);
    ctx.drawImage(this.cave, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // the seal plug: a lump of fresh soil in the shaft top
    if (fs.sealed && fs.prof.mode !== 'bivouac') {
      const X = sx(fs.entrance.c + 0.5), Y = sy(0.35);
      ctx.fillStyle = '#6a4a2e'; ctx.beginPath(); ctx.ellipse(X, Y, ts * 0.46, ts * 0.32, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(160,120,80,0.6)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(X + (AL.hash2(i, 1, 4) - 0.5) * ts * 0.6, Y + (AL.hash2(i, 2, 4) - 0.5) * ts * 0.35, ts * 0.06, 0, TAU); ctx.fill(); }
    }
    this.drawLife(ctx, sx, sy, ts, dt);
    this.drawLight(ctx, W, H, sx, sy, ts);
    this.drawParticles(ctx, sx, sy, ts, dt);
    // vignette: a soft round close-up frame
    const vg = ctx.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.32, W / 2, H * 0.46, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(10,6,3,0)'); vg.addColorStop(1, 'rgba(10,6,3,0.8)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    if (this.flash > 0) { ctx.fillStyle = 'rgba(255,90,60,' + (this.flash * 0.25) + ')'; ctx.fillRect(0, 0, W, H); this.flash = Math.max(0, this.flash - dt * 1.5); }
  }

  drawLife(ctx, sx, sy, ts, dt) {
    const fs = this.fs, q = fs.queen, t = this.t, b = fs.chamberBox;
    // army ants: a living bivouac of escorts behind the brood
    if (b && b.bivouac) this.drawBivouac(ctx, sx, sy, ts, false);
    // dropped wings lie where she tore them off
    for (const w of this.lostWings) {
      ctx.save(); ctx.translate(sx(w.c), sy(w.r)); ctx.rotate(w.a); ctx.globalAlpha = 0.85;
      ctx.fillStyle = 'rgba(225,235,250,0.55)'; ctx.strokeStyle = 'rgba(120,96,70,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, ts * 0.62, ts * 0.11, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,96,70,0.4)'; ctx.beginPath(); ctx.moveTo(-ts * 0.5, 0); ctx.lineTo(ts * 0.45, -ts * 0.03); ctx.stroke();
      ctx.restore();
      if (w.vy != null) { w.vy += dt * 1.2; w.r += w.vy * dt; w.c += w.vx * dt; w.a = -0.3 + Math.sin(w.r * 6) * 0.5; if (w.r >= w.floor) { w.r = w.floor; w.vy = null; w.a = 0.06; } }
    }
    // brood
    const eggS = ts * 0.07, larvaS = ts * 0.15, pupaS = ts * 0.2;
    const glow = fs.sealed || fs.opened ? 1 : 0.4;
    for (const p of fs.pupae) drawPupa(ctx, sx(p.c), sy(p.r), pupaS, p.age / Fd.F.PUPA_D, p.id);
    for (const l of fs.larvae) drawLarva(ctx, sx(l.c), sy(l.r), larvaS * (0.6 + 0.55 * Math.min(1, l.age / Fd.F.LARVA_D)), l.id, l.rationed || l.hunger > 0.8, t);
    for (const e of fs.eggs) drawEgg(ctx, sx(e.c), sy(e.r), eggS * (0.85 + Math.min(0.3, e.age / Fd.F.EGG_D * 0.3)), glow * (0.7 + 0.3 * Math.sin(t * 2 + e.id)), t);
    // nanitic workers: wander along the floor tending brood (one walks up the shaft once it's open)
    const wl = ts * 0.75 * (fs.prof.mode === 'bivouac' ? 1.35 : fs.prof.nanitic / 0.72);
    fs.workers.forEach((w, k) => {
      let st = this.workers.get(w.id);
      if (!st && b) { st = { c: w.c, tc: w.c, face: 1, walk: 0, pause: 0 }; this.workers.set(w.id, st); }
      if (!st) return;
      const floor = b.bivouac ? -0.02 : b.r0 + b.h - 0.05;
      if (st.pause > 0) st.pause -= dt; else {
        const d = st.tc - st.c;
        if (Math.abs(d) < 0.05) { st.tc = b.c0 + 0.5 + ((AL.hash2(w.id, (t * 0.3) | 0, 9)) * (b.w - 1)); st.pause = 0.5 + AL.hash2(w.id, (t | 0), 3) * 1.5; }
        else { st.c += Math.sign(d) * Math.min(Math.abs(d), dt * 0.9); st.face = Math.sign(d); st.walk += dt * 9; }
      }
      drawSideAnt(ctx, sx(st.c), sy(floor), wl, this.pal, { face: st.face, walk: st.pause > 0 ? null : st.walk, t, seed: w.id, pale: Math.max(0, 0.35 - (fs.day - (fs.marks.worker || 0)) * 0.1) });
    });
    // the queen: about 1.7 tiles long; she turns head-down in the shaft and climbs back up to seal
    const ql = ts * 1.7;
    const inChamber = b && !b.bivouac && (fs.phase === 'brood' || fs.phase === 'open' || fs.phase === 'done' || fs.phase === 'dead');
    let qc = q.c, qr = q.r;
    if (inChamber) { qr = b.r0 + b.h - 0.38; }
    if (b && b.bivouac) qr = -0.38;
    if (fs.phase === 'land' || fs.phase === 'shed' || fs.phase === 'choose') qr = -0.38;
    let qy = sy(qr), qx = sx(qc);
    if (fs.phase === 'land') qy -= Math.max(0, 0.5 - fs.phaseT) * ts * 3;     // she flutters down
    const digging = fs.phase === 'dig';
    const moving = digging || fs.phase === 'seal';
    // heading: toward the face she digs, or up the shaft while sealing
    let face = this.qface || 1, ang = 0;
    if (digging && fs.digQ.length) { const p = fs.digQ[0], dc = p.c + 0.5 - q.c, dr = p.r + 0.5 - q.r; if (Math.abs(dc) > 0.05) face = dc > 0 ? 1 : -1; ang = Math.abs(dc) + Math.abs(dr) > 0.05 ? Math.atan2(dr, Math.abs(dc)) : this.qang || 0; }
    else if (fs.phase === 'seal') { const top = fs.path[1] || fs.entrance; const dr = top.r + 0.5 - q.r; ang = Math.abs(dr) > 0.3 ? -1.3 : 0; }
    else if (inChamber) face = -1;
    ang = AL.clamp(ang, -1.35, 1.35);
    if (digging) { const back = 0.62; qc -= Math.cos(this.qang || 0) * face * back; qr -= Math.sin(this.qang || 0) * back; qx = sx(qc); qy = sy(qr); }
    this.qface = face; this.qang = (this.qang || 0) + (ang - (this.qang || 0)) * Math.min(1, dt * 6);
    if (!this.qwalk) this.qwalk = 0;
    if (moving) this.qwalk += dt * 7;
    let wingLift = 0;
    if (fs.phase === 'shed') wingLift = Math.sin(Math.min(1, fs.phaseT / Fd.F.SHED_T) * Math.PI) * 0.9;
    const dead = fs.phase === 'dead';
    ctx.save(); ctx.translate(qx, qy);
    if (dead) { ctx.rotate(Math.PI * 0.92); ctx.globalAlpha = 0.75; }
    else ctx.rotate(face * this.qang);
    // a soft shadow under her
    if (Math.abs(this.qang) < 0.4) { ctx.fillStyle = 'rgba(10,6,3,0.35)'; ctx.beginPath(); ctx.ellipse(0, ql * 0.2, ql * 0.45, ts * 0.06, 0, 0, TAU); ctx.fill(); }
    drawSideAnt(ctx, 0, ql * 0.2, ql, this.pal, {
      queen: true, face, walk: moving ? this.qwalk : (q.act === 'lay' || q.act === 'eat' ? t * 3 : null), digging,
      wings: q.wings, wingLift, scars: q.wings < 0.5, t, seed: 1,
    });
    ctx.restore();
    // a rival intruder during a raid
    if (this.intruder) {
      const it = this.intruder; it.t += dt;
      const from = { c: fs.entrance.c + 0.5, r: 0.5 }, to = { c: q.c + (it.repelled ? 2.2 : 1.6), r: (b ? b.r0 + b.h - 0.05 : q.r) };
      const k2 = it.repelled ? (it.t < 0.9 ? it.t / 0.9 : Math.max(0, 1 - (it.t - 0.9) / 0.9)) : Math.min(1, it.t / 0.9);
      const ic = AL.lerp(from.c, to.c, k2), ir = AL.lerp(from.r, to.r, k2);
      drawSideAnt(ctx, sx(ic), sy(ir), ts * 0.95, this.rivalPal(fs.lastAttacker), { face: k2 > 0 && it.t < 0.9 ? -1 : 1, walk: it.t * 10, t, seed: 5 });
      if (it.t > 2.2) this.intruder = null;
    }
    if (b && b.bivouac) this.drawBivouac(ctx, sx, sy, ts, true);
    // telegraphed raid: rival scouts sniffing around on the surface above the nest
    const pr = this.pendingRaid(), race = this.opts.race;
    if (pr && race && fs.phase !== 'dead' && fs.phase !== 'done') {
      const a = race.rivals.find(r => r.col === pr.col), pal = this.rivalPal(a && a.species);
      const k = AL.clamp((race.day - pr.found) / Math.max(0.1, pr.at - pr.found), 0, 1);
      const n = k > 0.45 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const side = j ? -1 : 1, far = (5.5 - 4.2 * k) * side, wob = Math.sin(t * (1.3 + j * 0.4) + j * 2) * 0.9;
        const c = fs.entrance.c + 0.5 + far + wob, face = Math.cos(t * (1.3 + j * 0.4) + j * 2) * side > 0 ? -side : side;
        drawSideAnt(ctx, sx(c), sy(-0.02), ts * 0.9, pal, { face: face || -side, walk: t * 8 + j, t, seed: 7 + j });
      }
    }
  }
  drawBivouac(ctx, sx, sy, ts, front) {
    // a dome of linked army ants around the queen and brood (back half first, then a lattice in front)
    const fs = this.fs, b = fs.chamberBox, n = Math.min(70, 26 + fs.escort * 3);
    const cx = sx(b.c0 + b.w / 2), cy = sy(0), rx = ts * (b.w * 0.62), ry = ts * 1.8;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI, ring = (i % 3) * 0.12;
      const back = i % 2 === 0;
      if (back === front) continue;
      const x = cx + Math.cos(a) * rx * (1 - ring), y = cy + Math.sin(a) * ry * (1 - ring);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2 + Math.sin(this.t * 1.5 + i) * 0.1);
      drawSideAnt(ctx, 0, 0, ts * 0.8, front ? this.pal : { body: shade(this.pal.body, -0.3), head: shade(this.pal.head, -0.3), gaster: shade(this.pal.gaster, -0.3) }, { face: i % 2 ? 1 : -1, t: this.t, seed: i, alpha: front ? 0.78 : 1 });
      ctx.restore();
    }
  }

  drawLight(ctx, W, H, sx, sy, ts) {
    const fs = this.fs, q = fs.queen, b = fs.chamberBox;
    if (b && b.bivouac) return;
    // darkness that deepens below the ground line, with warm pools of light cut out of it
    if (!this.lc || this.lc.width !== Math.ceil(W / 3) || this.lc.height !== Math.ceil(H / 3)) { this.lc = cnv(W / 3, H / 3); }
    const lc = this.lc, x = lc.getContext('2d'), k = 1 / 3;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, lc.width, lc.height);
    const gy = sy(0) * k;
    const dark = fs.sealed ? 0.8 : 0.66;
    const dg = x.createLinearGradient(0, gy, 0, gy + ts * k * 3.5);
    dg.addColorStop(0, 'rgba(12,7,3,0)'); dg.addColorStop(1, 'rgba(12,7,3,' + dark + ')');
    x.fillStyle = dg; x.fillRect(0, Math.max(0, gy), lc.width, lc.height);
    x.globalCompositeOperation = 'destination-out';
    const hole = (cx, cy, r, a) => { const g = x.createRadialGradient(cx * k, cy * k, 0, cx * k, cy * k, r * k); g.addColorStop(0, 'rgba(0,0,0,' + a + ')'); g.addColorStop(0.55, 'rgba(0,0,0,' + a * 0.55 + ')'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect((cx - r) * k, (cy - r) * k, r * 2 * k, r * 2 * k); };
    const flick = 1 + Math.sin(this.t * 7.3) * 0.02 + Math.sin(this.t * 3.1) * 0.03;
    const qy = b && (fs.phase === 'brood' || fs.phase === 'open' || fs.phase === 'done') ? sy(b.r0 + b.h * 0.5) : sy(q.r);
    hole(sx(q.c), qy, ts * 3.4 * flick, 0.95);
    // daylight down the open shaft
    if (!fs.sealed && fs.dug > 0) {
      const X = sx(fs.entrance.c + 0.5);
      for (let r = 0; r < 12; r++) hole(X, sy(r + 0.3), ts * (1.4 - r * 0.07), Math.max(0, 0.85 - r * 0.09));
    }
    if (fs.eggs.length && b) hole(sx(b.c0 + b.w / 2), sy(b.r0 + b.h - 0.2), ts * 1.4, 0.5);
    if (b && fs.marks.sealed != null) hole(sx(b.c0 + b.w / 2), sy(b.r0 + b.h * 0.6), ts * b.w * 0.62, 0.6);   // the whole chamber in a soft glow
    x.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(lc, 0, 0, lc.width, lc.height, 0, 0, W, H);
    // warm colour on top: a lamp-like glow over the queen and her brood
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx(q.c), qy, 0, sx(q.c), qy, ts * 2.4 * flick);
    g.addColorStop(0, 'rgba(255,170,80,' + (fs.sealed ? 0.2 : 0.1) + ')'); g.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = g; ctx.fillRect(sx(q.c) - ts * 3, qy - ts * 3, ts * 6, ts * 6);
    if (!fs.sealed && fs.dug > 0) {
      const X = sx(fs.entrance.c + 0.5), sg = ctx.createLinearGradient(0, sy(0), 0, sy(6));
      sg.addColorStop(0, 'rgba(255,236,190,0.18)'); sg.addColorStop(1, 'rgba(255,236,190,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(X - ts * 0.4, sy(0)); ctx.lineTo(X + ts * 0.4, sy(0)); ctx.lineTo(X + ts * 1.1, sy(6)); ctx.lineTo(X - ts * 1.1, sy(6)); ctx.fill();
    }
    ctx.restore();
  }

  // particles from the founding fx queue (dig crumbs, cave-ins, wings, hatching, fights, floods)
  drawParticles(ctx, sx, sy, ts, dt) {
    const fs = this.fs;
    for (const f of fs.fx) {
      if (this.fxSeen.has(f)) continue;
      this.fxSeen.add(f);
      if (f.day != null && fs.day - f.day > 0.6 && f.kind !== 'wings') continue;   // stale (fast-forwarded)
      const n = { dig: 7, cave: 22, lay: 5, hatch: 14, fight: 12, flood: 30, seal: 10, open: 10, eat: 6, wings: 0 }[f.kind] || 4;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, sp = 0.6 + Math.random() * 1.6;
        const p = { kind: f.kind, c: f.c + 0.5 + (Math.random() - 0.5) * 0.6, r: f.r + 0.5 + (Math.random() - 0.5) * 0.4, vc: Math.cos(a) * sp, vr: Math.sin(a) * sp - 1, life: 0.6 + Math.random() * 0.8, t: 0 };
        if (f.kind === 'lay' || f.kind === 'eat') { p.c = f.c; p.r = f.r; p.vc *= 0.3; p.vr = -0.4 - Math.random() * 0.5; }
        if (f.kind === 'hatch') { p.c = f.c; p.r = f.r; p.vr = -Math.random() * 1.2; }
        if (f.kind === 'flood') { p.c = f.c + (Math.random() - 0.5) * 4; p.r = f.r - 1; p.vc = 0; p.vr = 1 + Math.random(); }
        if (f.kind === 'fight') { this.flash = 1; if (!this.intruder) this.intruder = { t: 0, repelled: !!(fs.events.length && fs.events[fs.events.length - 1].good) }; }
        this.parts.push(p);
      }
      if (f.kind === 'wings') {
        for (let k = 0; k < 2; k++) this.lostWings.push({ c: f.c - 0.5 - k * 0.45, r: f.r - 0.35, vx: -0.35 - k * 0.25, vy: -0.5, va: 1.5 + k, a: -0.3, floor: f.r + 0.42 + k * 0.03 });
      }
    }
    if (this.parts.length > 400) this.parts.splice(0, this.parts.length - 400);
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.t += dt;
      if (p.t >= p.life) { this.parts.splice(i, 1); continue; }
      p.c += p.vc * dt; p.r += p.vr * dt; p.vr += dt * 3.2;
      const a = 1 - p.t / p.life, X = sx(p.c), Y = sy(p.r);
      if (p.kind === 'lay' || p.kind === 'hatch' || p.kind === 'eat' || p.kind === 'open' || p.kind === 'seal') {
        p.vr -= dt * 3.4;
        ctx.fillStyle = p.kind === 'eat' ? 'rgba(255,200,120,' + a + ')' : 'rgba(255,240,200,' + a * 0.9 + ')';
        ctx.beginPath(); ctx.arc(X, Y, ts * 0.025 * (1 + a), 0, TAU); ctx.fill();
      } else if (p.kind === 'fight') {
        ctx.strokeStyle = 'rgba(255,120,80,' + a + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vc * ts * 0.06, Y - p.vr * ts * 0.06); ctx.stroke();
      } else if (p.kind === 'flood') {
        ctx.fillStyle = 'rgba(140,200,230,' + a * 0.8 + ')'; ctx.beginPath(); ctx.ellipse(X, Y, ts * 0.025, ts * 0.05, 0, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = p.kind === 'cave' ? 'rgba(150,120,85,' + a * 0.8 + ')' : 'rgba(120,88,56,' + a + ')';
        ctx.beginPath(); ctx.arc(X, Y, ts * (p.kind === 'cave' ? 0.05 : 0.035), 0, TAU); ctx.fill();
      }
    }
  }
}

// =============================================================================================
// DOM HUD: site card, timeline, reserve bars, brood row, choices, toasts, end card
const CSS = `
.fd-root{position:fixed;inset:0;pointer-events:none;font:14px/1.35 system-ui,"Segoe UI",sans-serif;color:#f3e9d2;z-index:60}
.fd-root *{box-sizing:border-box}
.fd-panel,.fd-site,.fd-tl,.fd-speed,.fd-card{background:rgba(24,17,11,.86);border:1px solid rgba(214,170,110,.28);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:auto}
.fd-top{position:absolute;left:16px;right:16px;top:14px;display:flex;gap:12px;align-items:flex-start}
.fd-site{display:flex;gap:10px;align-items:center;padding:8px 12px 8px 8px;min-width:0}
.fd-site canvas{width:38px;height:38px;flex:none}
.fd-site b{display:block;font-size:15px}.fd-site small{color:#bfae8f}
.fd-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.fd-chip{font-size:11.5px;padding:1px 7px;border-radius:9px;background:rgba(214,170,110,.12);color:#e9dcc0;white-space:nowrap}
.fd-chip.good{background:rgba(120,190,90,.18);color:#cfe9b8}.fd-chip.bad{background:rgba(230,100,70,.18);color:#f3c3b2}
.fd-tl{flex:1;padding:8px 14px 9px;min-width:220px}
.fd-tl-head{display:flex;justify-content:space-between;font-size:12.5px;color:#bfae8f;margin-bottom:6px}
.fd-tl-head b{color:#f3e9d2;font-weight:600}
.fd-tl-bar{position:relative;height:10px;border-radius:5px;background:rgba(255,255,255,.07)}
.fd-tl-fill{position:absolute;left:0;top:0;bottom:0;border-radius:5px;background:linear-gradient(90deg,#7a5a3a,#f2c14e)}
.fd-tl-m{position:absolute;top:-3px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:#2a1d12;border:2px solid #f2c14e;font-size:9px;line-height:12px;text-align:center;color:#f2c14e;font-weight:700}
.fd-tl-m.future{border-style:dashed;opacity:.7;border-color:#bfae8f;color:#bfae8f}
.fd-tl-now{position:absolute;top:-5px;bottom:-5px;width:2px;background:#fff;border-radius:1px;box-shadow:0 0 6px #fff}
.fd-speed{display:flex;gap:4px;padding:6px}
.fd-btn{font:600 13px system-ui,"Segoe UI",sans-serif;color:#f3e9d2;background:rgba(255,255,255,.06);border:1px solid rgba(214,170,110,.3);border-radius:9px;padding:7px 12px;cursor:pointer;transition:background .15s,border-color .15s,transform .05s}
.fd-btn:hover{background:rgba(242,193,78,.16);border-color:#f2c14e}.fd-btn:active{transform:translateY(1px)}
.fd-btn.on{background:#f2c14e;color:#24180e;border-color:#f2c14e}
.fd-btn.primary{background:linear-gradient(#f5ca5e,#e0a83a);color:#24180e;border-color:#f2c14e}
.fd-btn:disabled{opacity:.4;cursor:default}
.fd-btn small{display:block;font-weight:400;font-size:11.5px;opacity:.8}
.fd-speed .fd-btn{padding:6px 9px;min-width:38px}
.fd-panel{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);width:min(980px,calc(100% - 32px));display:grid;grid-template-columns:minmax(180px,1fr) 258px minmax(260px,1.3fr);gap:16px;padding:12px 16px;align-items:center}
.fd-res .row{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12.5px}
.fd-res .lab{width:54px;color:#bfae8f}
.fd-res .bar{flex:1;height:10px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden;position:relative}
.fd-res .bar i{position:absolute;left:0;top:0;bottom:0;border-radius:5px;transition:width .25s}
.fd-res .num{width:44px;text-align:right;font-variant-numeric:tabular-nums}
.fd-res .fat i{background:linear-gradient(90deg,#c98a2a,#f2c14e)}.fd-res .prot i{background:linear-gradient(90deg,#a8443a,#e6826a)}.fd-res .hp i{background:linear-gradient(90deg,#5d8a3a,#9cc96a)}
.fd-res .bar.locked i{opacity:.35}
.fd-brood{display:flex;gap:6px}
.fd-b{display:flex;flex-direction:column;align-items:center;width:60px;flex:none;padding:4px 6px;border-radius:9px;background:rgba(255,255,255,.04)}
.fd-b canvas{width:30px;height:22px}.fd-b b{font-size:16px;font-variant-numeric:tabular-nums}.fd-b span{font-size:11px;color:#bfae8f}
.fd-b.warn{background:rgba(230,100,70,.16)}
.fd-act .q{font-size:12.5px;color:#bfae8f;margin-bottom:6px}.fd-act .q b{color:#f3e9d2}
.fd-act .btns{display:flex;flex-wrap:wrap;gap:6px}
.fd-toasts{position:absolute;left:50%;top:92px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;width:min(560px,calc(100% - 32px))}
.fd-toast{background:rgba(24,17,11,.9);border:1px solid rgba(214,170,110,.28);border-left:3px solid #f2c14e;border-radius:9px;padding:7px 12px;font-size:13px;animation:fdIn .3s ease-out;transition:opacity .6s}
.fd-toast.bad{border-left-color:#e0503a}
@keyframes fdIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.fd-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100% - 32px));padding:20px 22px;text-align:left}
.fd-card h2{margin:0 0 4px;font-size:21px}.fd-card p{margin:6px 0;color:#d9cbb0}
.fd-card .stats{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin:12px 0 16px;font-size:13.5px}
.fd-card .stats span{color:#bfae8f}
.fd-exp{display:inline-flex;align-items:center;gap:5px}
.fd-exp i{width:8px;height:8px;border-radius:50%;background:#9cc96a;box-shadow:0 0 6px #9cc96a}
.fd-exp.seen i{background:#e0503a;box-shadow:0 0 6px #e0503a}
/* founding race panel */
.fd-race{position:absolute;right:16px;top:86px;width:256px;padding:9px 11px 10px;max-height:calc(100% - 260px);overflow:auto;background:rgba(24,17,11,.86);border:1px solid rgba(214,170,110,.28);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);pointer-events:auto}
.fd-race-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;cursor:pointer;font-size:12px;color:#bfae8f;user-select:none}
.fd-race-h b{color:#f3e9d2;font-size:13.5px;font-weight:600}
.fd-race-h .tg{font-size:10px;opacity:.7}
.fd-map{display:block;width:100%;height:auto;margin:7px 0 5px;border-radius:8px}
.fd-rr{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:3px 7px;align-items:center;padding:4px 5px;border-radius:7px;font-size:12px}
.fd-rr.me{background:rgba(242,193,78,.11)}
.fd-rr .dot{width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 1.5px rgba(0,0,0,.35)}
.fd-rr .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fd-rr .nm small{color:#bfae8f}
.fd-rr .ph{font-size:11px;color:#bfae8f;text-align:right;white-space:nowrap}
.fd-rr .ph.out{color:#f3c3b2}.fd-rr .ph.ready{color:#cfe9b8}.fd-rr .ph.hid{color:#9cc96a}
.fd-rr .pb{grid-column:2/4;height:5px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}
.fd-rr .pb i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#7a5a3a,#f2c14e);transition:width .25s}
.fd-rr.out .pb i{background:linear-gradient(90deg,#8a3a2e,#e0503a)}
.fd-rr.ready .pb i{background:linear-gradient(90deg,#5d8a3a,#9cc96a)}
.fd-raid{margin-top:7px;padding:6px 8px;border-radius:8px;background:rgba(230,100,70,.16);border:1px solid rgba(230,100,70,.45);font-size:12px;color:#f3c3b2;animation:fdPulse 1.6s ease-in-out infinite}
.fd-raid b{color:#ffd9cc}
@keyframes fdPulse{50%{border-color:rgba(255,140,110,.9)}}
.fd-race.min .fd-map,.fd-race.min .fd-rr:not(.me),.fd-race.min .fd-legend{display:none}
.fd-legend{font-size:10.5px;color:#9d8f76;margin-top:5px;line-height:1.3}
.fd-btn.warn{border-color:#e0503a;background:rgba(230,100,70,.18)}
@media (max-width:1100px){.fd-toasts{left:16px;transform:none;width:min(480px,calc(100% - 300px))}}
@media (max-width:760px){.fd-panel{grid-template-columns:1fr;gap:10px}.fd-top{flex-wrap:wrap}.fd-tl{order:3;flex-basis:100%}.fd-toasts{top:150px;width:calc(100% - 32px)}.fd-race{top:150px;width:210px;max-height:40%}}
`;
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
const fmt = n => (n >= 10 ? n.toFixed(0) : n.toFixed(1));
const ordinal = n => (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';

class HUD {
  constructor(fs, parent, cb, race, map) {
    this.fs = fs; this.cb = cb || {}; this.race = race || null; this.map = map || {};
    if (!document.getElementById('fd-css')) { const st = el('style'); st.id = 'fd-css'; st.textContent = CSS; document.head.appendChild(st); }
    const r = this.root = el('div', 'fd-root');
    const site = AL.SITES[fs.siteId], sp = AL.SPECIES && AL.SPECIES[fs.spKey];
    const top = el('div', 'fd-top');
    const card = el('div', 'fd-site');
    const bc = el('canvas'); bc.width = 76; bc.height = 76;
    const bx = bc.getContext('2d'); bx.fillStyle = 'rgba(28,20,12,1)'; bx.beginPath(); bx.arc(38, 38, 34, 0, TAU); bx.fill(); bx.strokeStyle = site.colour; bx.lineWidth = 4; bx.stroke();
    AL.Sites.drawBadge(bx, fs.siteId, 38, 38, 22, site.colour);
    card.appendChild(bc);
    const m = fs.mods, chips = [];
    const chip = (txt, v, goodHigh) => chips.push('<span class="fd-chip ' + (v === 1 ? '' : (v > 1) === goodHigh ? 'good' : 'bad') + '">' + txt + '</span>');
    chip('Dig ' + m.dig.toFixed(1) + 'x', m.dig, true);
    chip('Brood ' + (m.warmth * fs.prof.dev).toFixed(2) + 'x', m.warmth * fs.prof.dev, true);
    chip(m.visibility < 0.8 ? 'Well hidden' : m.visibility > 1.2 ? 'Exposed' : 'Some cover', m.visibility < 0.8 ? 2 : m.visibility > 1.2 ? 0 : 1, true);
    if (m.flood > 0.5) chip('Floods', 0, true);
    if (m.caveIn > 0.05) chip('Cave-ins', 0, true);
    if (site.residents) chip('Beetles', 0, true);
    const info = el('div', '', '<b>' + site.name + '</b><small>' + (sp ? sp.name : fs.spKey) + (fs.prof.mode === 'bivouac' ? ' · bivouac' : ' · claustral founding') + '</small><div class="fd-chips">' + chips.join('') + '</div>');
    card.appendChild(info);
    top.appendChild(card);
    const tl = this.tl = el('div', 'fd-tl', '<div class="fd-tl-head"><span class="d"></span><span class="f"></span></div><div class="fd-tl-bar"><div class="fd-tl-fill"></div></div>');
    top.appendChild(tl);
    const spd = el('div', 'fd-speed');
    this.speedBtns = [];
    const mk = (label, fn, title) => { const b = el('button', 'fd-btn', label); b.title = title || ''; b.onclick = fn; spd.appendChild(b); return b; };
    this.pauseBtn = mk('Pause', () => { fs.paused = !fs.paused; this.refresh(true); }, 'Space');
    for (const v of [1, 2, 4]) this.speedBtns.push([v, mk(v + 'x', () => { fs.speed = v; fs.paused = false; this.refresh(true); }, 'Key ' + (v === 4 ? 3 : v))]);
    top.appendChild(spd);
    r.appendChild(top);
    this.toasts = el('div', 'fd-toasts'); r.appendChild(this.toasts);
    const p = this.panel = el('div', 'fd-panel');
    this.res = el('div', 'fd-res', ['fat|Fat', 'prot|Protein', 'hp|Queen'].map(s => { const [k, l] = s.split('|'); return '<div class="row"><span class="lab">' + l + '</span><span class="bar ' + k + '"><i></i></span><span class="num ' + k + 'n"></span></div>'; }).join(''));
    p.appendChild(this.res);
    this.brood = el('div', 'fd-brood');
    this.bcount = {};
    for (const [k, l] of [['egg', 'Eggs'], ['larva', 'Larvae'], ['pupa', 'Pupae'], ['worker', fs.prof.mode === 'bivouac' ? 'Workers' : 'Nanitics']]) {
      const b = el('div', 'fd-b'); const c = el('canvas'); c.width = 60; c.height = 44; this.icon(c.getContext('2d'), k); b.appendChild(c);
      const n = el('b', '', '0'); b.appendChild(n); b.appendChild(el('span', '', l)); this.brood.appendChild(b); this.bcount[k] = { n, b };
    }
    p.appendChild(this.brood);
    this.act = el('div', 'fd-act'); p.appendChild(this.act);
    r.appendChild(p);
    this.card = el('div', 'fd-card'); this.card.hidden = true; r.appendChild(this.card);
    if (this.race && this.race.rivals.length) this.buildRace(r);
    (parent || document.body).appendChild(r);
    this.seenN = 0; this.seenRace = 0; this.actKey = ''; this.t = 0;
    this.refresh(true);
  }
  icon(x, kind) {
    x.save(); x.translate(30, 26);
    const pal = AL.SPECIES && AL.SPECIES[this.fs.spKey] || { body: '#9a3b1e', head: '#7e2c14', gaster: '#3a1a10' };
    if (kind === 'egg') { drawEgg(x, -7, 0, 6, 1, 0); drawEgg(x, 6, 3, 6, 0.6, 0); }
    else if (kind === 'larva') drawLarva(x, 0, 12, 13, 0.3, false, 0);
    else if (kind === 'pupa') drawPupa(x, 0, 10, 15, 0.4, 0);
    else drawSideAnt(x, 0, 12, 34, pal, { face: 1, t: 0 });
    x.restore();
  }
  destroy() { if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root); }
  // ---- the founding race: every rival queen's progress, and a small map of who can be seen ----
  buildRace(root) {
    const p = this.racePanel = el('div', 'fd-race');
    let small = false; try { small = window.innerWidth < 760 || localStorage.getItem('al-fd-race-min') === '1'; } catch (_) { small = window.innerWidth < 760; }
    if (small) p.classList.add('min');
    p.innerHTML = '<div class="fd-race-h" title="Click to fold"><b>Founding race</b><span class="rk"></span><span class="tg">' + (small ? '+' : '–') + '</span></div>';
    p.firstChild.onclick = () => { const m = p.classList.toggle('min'); p.querySelector('.tg').textContent = m ? '+' : '–'; try { localStorage.setItem('al-fd-race-min', m ? '1' : '0'); } catch (_) {} };
    const cv = this.mapCv = el('canvas', 'fd-map'); cv.width = 468; cv.height = 300; p.appendChild(cv);
    this.raceRows = el('div'); p.appendChild(this.raceRows);
    this.raidBox = el('div'); p.appendChild(this.raidBox);
    p.appendChild(el('div', 'fd-legend', 'Markers show queens you could spot: digging, open or out. Sealed nests stay hidden. Queens that are out send scouts to raid nests still founding.'));
    root.appendChild(p);
  }
  refreshRace() {
    const race = this.race; if (!race || !this.racePanel) return;
    const rows = FR.rows(race), rk = FR.rank(race), fs = this.fs;
    this.racePanel.querySelector('.rk').textContent = fs.phase === 'done' ? rk.still + ' still founding' : 'You: ' + rk.place + ordinal(rk.place) + ' of ' + rk.of;
    let h = '';
    for (const r of rows) {
      const ready = r.phase === 'colony', cls = r.out ? 'out' : ready ? 'ready' : '';
      const ph = r.out ? 'out · day ' + Math.floor(r.outDay) : r.label;
      h += '<div class="fd-rr ' + (r.me ? 'me ' : '') + cls + '" title="' + r.spName + ': ' + r.pace + '"><i class="dot" style="background:' + r.team + '"></i>' +
        '<span class="nm">' + (r.me ? '<b>You</b> · ' : '') + r.spName + ' <small>' + r.siteName + '</small></span>' +
        '<span class="ph ' + (r.out ? 'out' : ready ? 'ready' : !r.exposed ? 'hid' : '') + '">' + ph + '</span>' +
        '<span class="pb"><i style="width:' + (r.progress * 100).toFixed(1) + '%"></i></span></div>';
    }
    if (h !== this._rowsHtml) { this._rowsHtml = h; this.raceRows.innerHTML = h; }
    const pr = race.pending[0];
    const rh = pr && fs.phase !== 'done' && fs.phase !== 'dead' ? '<div class="fd-raid"><b>Raid coming</b> from ' + FR.label(race.rivals.find(z => z.col === pr.col)) + ' in ' + Math.max(0, pr.at - race.day).toFixed(1) + ' days. ' + (fs.prof.mode === 'bivouac' ? 'The escort will meet them.' : fs.opened ? 'Plug the entrance (P) or start the colony.' : 'The seal may hold them off.') + '</div>' : '';
    if (rh !== this._raidHtml) { this._raidHtml = rh; this.raidBox.innerHTML = rh; }
    if (!this.racePanel.classList.contains('min')) this.drawMap(rows);
  }
  drawMap(rows) {
    const cv = this.mapCv, x = cv.getContext('2d'), W = cv.width, H = cv.height, race = this.race, t = performance.now() / 1000;
    const MW = this.map.W || (AL.Surface && AL.Surface.W) || 4000, MH = this.map.H || (AL.Surface && AL.Surface.H) || 3000, k = Math.min(W / MW, H / MH);
    const px = v => v * k + (W - MW * k) / 2, py = v => v * k + (H - MH * k) / 2;
    const g = x.createRadialGradient(W * 0.3, H * 0.25, 10, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#5f7f3e'); g.addColorStop(1, '#3a4f26');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // the founding sites (known from the flight)
    for (const s of this.map.sites || []) { const ty = s.type || s.id, def = AL.SITES[ty]; if (!def) continue; const e = s.decor ? AL.Sites.entranceOf(s) : s; x.globalAlpha = 0.55; AL.Sites.drawBadge(x, ty, px(e.x), py(e.y), 11, def.colour); x.globalAlpha = 1; }
    const pos = new Map(rows.map(r => [r.col, r]));
    // raids: the telegraphed one on you, recent ones between rivals
    const line = (a, b, col, dash) => { x.save(); x.strokeStyle = col; x.lineWidth = 3; x.setLineDash(dash || []); x.lineDashOffset = -t * 30; x.beginPath(); x.moveTo(px(a.x), py(a.y)); x.lineTo(px(b.x), py(b.y)); x.stroke(); x.restore(); };
    for (const p of race.pending) { const a = pos.get(p.col), me = pos.get(0); if (a && me) line(a, me, 'rgba(240,90,60,0.9)', [10, 8]); }
    for (const rd of race.raids) if (race.day - rd.day < 1.2) { const a = pos.get(rd.from), b = pos.get(rd.to); if (a && b) line(a, b, 'rgba(240,120,80,' + (1 - (race.day - rd.day) / 1.2) * 0.8 + ')'); }
    for (const r of rows) {
      const X = px(r.x), Y = py(r.y);
      if (!r.me && !r.exposed) continue;         // a sealed queen can't be seen
      if (r.out) { const ph = (t * 0.7 + r.col * 0.3) % 1; x.strokeStyle = r.team; x.globalAlpha = 1 - ph; x.lineWidth = 2.5; x.beginPath(); x.arc(X, Y, 8 + ph * 26, 0, TAU); x.stroke(); x.globalAlpha = 1; }
      x.fillStyle = 'rgba(0,0,0,0.45)'; x.beginPath(); x.arc(X + 2, Y + 3, r.me ? 10 : 8, 0, TAU); x.fill();
      x.fillStyle = r.team; x.beginPath(); x.arc(X, Y, r.me ? 10 : 7.5, 0, TAU); x.fill();
      x.strokeStyle = r.me ? '#fff' : 'rgba(20,12,6,0.8)'; x.lineWidth = r.me ? 3 : 2; x.stroke();
      if (r.me) { x.font = '600 20px system-ui,sans-serif'; x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText('You', X, Y - 16); }
    }
  }
  toast(text, bad) {
    const t = el('div', 'fd-toast' + (bad ? ' bad' : ''), text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.removeChild(this.toasts.firstChild);
    setTimeout(() => { t.style.opacity = '0'; }, 4200); setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 4900);
  }
  frame(dt) { this.t += dt; if (this.t >= 0.1) { this.t = 0; this.refresh(false); } }
  stillFounding() { return this.race ? this.race.rivals.filter(r => !r.out).length : 0; }
  refresh(force) {
    const fs = this.fs, q = fs.queen;
    // toasts for new events
    for (const e of fs.events) if (e.n > this.seenN) { this.seenN = e.n; if (e.kind !== 'dead' && !(e.kind === 'colony' && this.race && this.race.rivals.length)) this.toast(e.text, !e.good); }
    if (this.race) for (const e of this.race.events) if (e.n > this.seenRace) { this.seenRace = e.n; if (fs.phase !== 'done' && fs.phase !== 'dead') this.toast(e.text, !e.good); }
    this.refreshRace();
    // speed buttons
    this.pauseBtn.classList.toggle('on', fs.paused);
    for (const [v, b] of this.speedBtns) b.classList.toggle('on', !fs.paused && fs.speed === v);
    // timeline
    const end = Math.max(28, (fs.forecast || 0) + 4, fs.day + 2);
    const fill = this.tl.querySelector('.fd-tl-fill'), bar = this.tl.querySelector('.fd-tl-bar');
    fill.style.width = (fs.day / end * 100).toFixed(2) + '%';
    const exp = Fd.exposure(fs);
    this.tl.querySelector('.d').innerHTML = '<b>Day ' + Math.floor(fs.day) + '</b> &nbsp;' + (fs.prof.mode === 'bivouac' ? '<span class="fd-exp seen"><i></i>Bivouac: in the open</span>' : fs.sealed ? '<span class="fd-exp"><i></i>Sealed: hidden</span>' : '<span class="fd-exp seen"><i></i>' + (fs.opened ? 'Open: rivals can see it' : fs.phase === 'dig' || fs.phase === 'seal' ? 'Digging: exposed' : 'On the surface: exposed') + '</span>');
    this.tl.querySelector('.f').textContent = fs.marks.worker != null ? 'First workers on day ' + Math.floor(fs.marks.worker) : 'First workers in ~' + Math.max(0, Math.ceil(fs.forecast - fs.day)) + ' days';
    const marks = [['shed', 'W', 'Wings shed'], ['sealed', 'S', 'Sealed'], ['egg', 'E', 'First egg'], ['larva', 'L', 'First larva'], ['pupa', 'P', 'First pupa'], ['worker', 'N', 'First worker'], ['opened', 'O', 'Opened']];
    let html = '<div class="fd-tl-fill" style="width:' + fill.style.width + '"></div>';
    for (const [k, g, title] of marks) if (fs.marks[k] != null) html += '<div class="fd-tl-m" title="' + title + ' (day ' + fs.marks[k].toFixed(1) + ')" style="left:' + (fs.marks[k] / end * 100).toFixed(2) + '%">' + g + '</div>';
    if (fs.marks.worker == null && fs.forecast) html += '<div class="fd-tl-m future" title="Projected first worker" style="left:' + Math.min(100, fs.forecast / end * 100).toFixed(2) + '%">N</div>';
    html += '<div class="fd-tl-now" style="left:' + (fs.day / end * 100).toFixed(2) + '%"></div>';
    bar.innerHTML = html;
    // reserves
    const setBar = (k, v, max, locked) => { const b = this.res.querySelector('.' + k); b.firstChild.style.width = AL.clamp(v / max * 100, 0, 100).toFixed(1) + '%'; b.classList.toggle('locked', !!locked); this.res.querySelector('.' + k + 'n').textContent = locked ? 'wings' : fmt(Math.max(0, v)); };
    setBar('fat', q.fat, q.fatMax);
    setBar('prot', q.wings > 0 ? q.protMax : q.prot, q.protMax, q.wings > 0);
    setBar('hp', q.hp, q.maxHp);
    // brood
    const hungry = fs.larvae.some(l => l.rationed || l.hunger > 0.8);
    const set = (k, n, warn) => { this.bcount[k].n.textContent = n; this.bcount[k].b.classList.toggle('warn', !!warn); };
    set('egg', fs.eggs.length); set('larva', fs.larvae.length, hungry); set('pupa', fs.pupae.length); set('worker', fs.workers.length + (fs.escort ? '+' + fs.escort : ''));
    // actions (rebuilt only when the situation changes)
    const key = [fs.phase, fs.depth, fs.clutch, fs.laid >= fs.clutch, fs.eggs.length > 0, fs.workers.length > 0, fs.opened, fs.prof.mode, Fd.colonyReady(fs), fs.plugged, this.stillFounding(), !!(this.race && this.race.pending.length)].join('|');
    if (force || key !== this.actKey) { this.actKey = key; this.buildActions(); }
    if (fs.phase === 'done' || fs.phase === 'dead') this.showCard();
  }
  buildActions() {
    const fs = this.fs, a = this.act, cb = this.cb;
    a.innerHTML = '';
    const q = (html) => a.appendChild(el('div', 'q', html));
    const row = el('div', 'btns');
    const btn = (label, sub, fn, cls, dis) => { const b = el('button', 'fd-btn ' + (cls || ''), label + (sub ? '<small>' + sub + '</small>' : '')); b.onclick = () => { fn(); this.refresh(true); }; if (dis) b.disabled = true; row.appendChild(b); return b; };
    switch (fs.phase) {
      case 'land': case 'shed':
        q('<b>She has landed.</b> A queen never flies again: her wing muscles become food for her first brood.');
        btn('Shed her wings', 'Enter', () => Fd.shedWings(fs), 'primary', fs.phase === 'shed');
        break;
      case 'choose':
        q('<b>Where to dig the chamber?</b> Deeper is safer from floods, hazards and raids, but costs time and fat.');
        btn('Shallow', 'quick, cheap', () => Fd.chooseDepth(fs, 'shallow'));
        btn('Deep', 'safer, slower', () => Fd.chooseDepth(fs, 'deep'));
        break;
      case 'dig': case 'seal':
        q('<b>' + (fs.phase === 'dig' ? 'Digging' : 'Sealing the entrance') + '</b> (' + (fs.depth === 'deep' ? 'deep' : 'shallow') + ' chamber). The open shaft can be spotted until it is sealed.');
        break;
      case 'brood': case 'open':
      {
        const ready = Fd.colonyReady(fs), still = this.stillFounding(), biv = fs.prof.mode === 'bivouac', raid = this.race && this.race.pending.length;
        const need = fs.prof.colonyAt + (biv ? ' callow workers' : ' nanitics');
        if (ready) q('<b>Colony stage.</b> ' + (still ? still + ' rival' + (still > 1 ? 's are' : ' is') + ' still founding: start now and ' + (still > 1 ? 'they begin' : 'it begins') + ' colony play small and exposed, easy to raid.' : 'Every rival is already out.') + ' Waiting fills the larder (' + Math.round(fs.larder.sugar + fs.larder.protein) + ' food) and brings more brood along.');
        else if (fs.laid < fs.clutch || fs.laid === 0) {
          q('<b>How many eggs?</b> Each egg costs fat, each larva needs protein. Fewer eggs grow faster. Laid ' + fs.laid + ' of ' + fs.clutch + '.');
          for (const n of Fd.F.CLUTCHES.concat(biv ? [24] : [])) btn(n + ' eggs', n <= 6 ? 'safe' : n <= 10 ? 'balanced' : 'risky', () => Fd.setClutch(fs, n), fs.clutch === n ? 'on' : '', n < fs.laid);
        } else if (!fs.workers.length) q('<b>Raising the brood.</b> Colony stage needs ' + need + ' and an open nest. Eat eggs to stretch her protein if it runs short.');
        else if (!fs.opened) q('<b>The first nanitic is here.</b> ' + (fs.plugged ? 'The entrance is plugged: hidden, but no food comes in.' : 'Open the nest to fetch food and reach colony stage. Opening also lets rivals see you.'));
        else q('<b>The nest is open.</b> Nanitics bring in food. Colony stage at ' + need + ' (' + fs.workers.length + ' now).');
        btn('Eat an egg', '+' + Fd.F.EAT_PROT + ' protein (E)', () => Fd.eatEgg(fs), '', !fs.eggs.length);
        if (fs.workers.length && !fs.opened && !biv) btn('Open the entrance', 'O', () => Fd.openEntrance(fs), ready ? '' : 'primary');
        if (fs.opened && !biv) btn('Plug the entrance', raid ? 'raid coming! (P)' : 'hide (P)', () => Fd.plugEntrance(fs), raid ? 'warn' : '');
        if (ready) btn('Start the colony now', still ? still + ' rival' + (still > 1 ? 's' : '') + ' still founding (Enter)' : 'Enter', () => Fd.finish(fs), 'primary');
        else if (fs.workers.length) btn('Start the colony', 'at ' + need, () => {}, '', true);
      }
        break;
    }
    a.appendChild(row);
  }
  showCard() {
    if (this.cardShown) return; this.cardShown = true;
    const fs = this.fs, c = this.card, h = Fd.handoff(fs);
    this.panel.style.display = 'none';
    if (fs.phase === 'dead') {
      c.innerHTML = '<h2>The queen is dead</h2><p>' + (fs.deathReason || '') + '</p><p>Try a smaller clutch, eat eggs earlier, or pick a safer site.</p>';
      const row = el('div', 'btns'); row.style.display = 'flex'; row.style.gap = '8px';
      const b = el('button', 'fd-btn primary', 'Try again'); b.onclick = () => this.cb.retry && this.cb.retry(); row.appendChild(b);
      c.appendChild(row);
    } else {
      const site = AL.SITES[fs.siteId];
      const still = this.stillFounding(), rk = this.race ? FR.rank(this.race) : null;
      c.innerHTML = '<h2>A colony is born</h2><p>' + site.name + ', day ' + Math.floor(fs.day) + '. ' + (h.nanitics ? 'The first nanitics are small and weak until full-size workers hatch.' : 'The bivouac is ready to march.') + '</p>' +
        (rk && rk.of > 1 ? '<p>' + (still ? '<b>' + still + ' rival' + (still > 1 ? 's are' : ' is') + ' still founding.</b> Their nests start small and exposed: find them and raid them before they reach colony stage.' : 'Every rival finished founding before you: expect their scouts early.') + '</p>' : '') +
        '<div class="stats"><span>Workers</span><b>' + (h.nanitics ? h.nanitics + ' nanitics' : h.workers) + '</b><span>Brood coming</span><b>' + (h.brood.eggs.length + h.brood.larvae.length + h.brood.pupae.length) + '</b>' +
        '<span>Sugar store</span><b>' + h.stock.sugar + '</b><span>Protein store</span><b>' + h.stock.protein + '</b>' +
        '<span>Queen</span><b>' + Math.round(h.queen.hpFrac * 100) + '%</b><span>Eggs eaten</span><b>' + fs.stats.eaten + '</b>' +
        (rk && rk.of > 1 ? '<span>Race</span><b>' + rk.place + ordinal(rk.place) + ' of ' + rk.of + '</b><span>Raids survived</span><b>' + fs.stats.repelled + ' of ' + fs.stats.attacks + '</b>' : '') + '</div>';
      const b = el('button', 'fd-btn primary', 'Begin colony play'); b.onclick = () => this.cb.done && this.cb.done(h); c.appendChild(b);
    }
    c.hidden = false;
  }
}

// =============================================================================================
// the match's map size (terrain.js AL.MAP_SIZES; the flight and founding play on it too)
const mapSize = opts => (AL.MAP_SIZES && opts && AL.MAP_SIZES[opts.mapSize]) || { W: 4000, H: 3000 };
// the scene: reads the flight result from ctx.opts, runs the vignette, hands a patch to createWorld
function siteFromOpts(opts) {
  const land = (opts.landings || []).find(l => l.colonyId === 0) || null;
  let type = opts.foundingSite || null, x = null, y = null;
  if (land && land.siteType) type = land.siteType;
  else if (land && opts.flight && opts.flight.sites) { const s = opts.flight.sites.find(z => z.id === land.siteId); if (s) { type = s.type; x = s.x; y = s.y; } }
  if (opts.layout && opts.layout.nests && opts.layout.nests[0]) { x = opts.layout.nests[0].x; y = opts.layout.nests[0].y; }
  if (opts.playerSite) { x = opts.playerSite.x; y = opts.playerSite.y; }
  if (!AL.SITES[type]) type = 'meadow';
  // no flight position: use where this site sits on the default backyard layout
  if (x == null && AL.Sites.placeDefault && AL.Surface && AL.Surface.generate) {
    try { const s = AL.Sites.placeDefault(opts.seed || 1, { map: opts }).find(z => z.id === type); if (s) { const e = AL.Sites.entranceOf(s); x = e.x; y = e.y; } } catch (_) {}
  }
  const Z = mapSize(opts);
  return { id: type, type, x: x == null ? Math.round(760 * Z.W / 4000) : x, y: y == null ? Math.round(2240 * Z.H / 3000) : y, def: AL.SITES[type], land };
}
// headless founding for every rival queen from the flight (their own sites and choices)
function rivalFoundings(opts, seed) {
  const out = [];
  for (const l of opts.landings || []) {
    if (l.colonyId === 0) continue;
    const s = opts.flight && opts.flight.sites ? opts.flight.sites.find(z => z.id === l.siteId) : null;
    const ty = l.siteType || (s && s.type), id = AL.SITES[ty] ? ty : 'meadow';
    const ho = Fd.simulate({ site: { id, def: AL.SITES[id], x: s ? s.x : 0, y: s ? s.y : 0 }, species: l.species || 'fire', seed: (seed + l.colonyId * 977) >>> 0, col: l.colonyId, reserveBonus: l.bonus ? l.bonus.reserves : 0 });
    delete ho.nest.tiles;
    out.push(ho);
  }
  return out;
}
// the createWorld patch for colony play (see READY.md)
function toPatch(ho, opts, rivals, race) {
  const brood = [];
  ho.brood.eggs.forEach(t => brood.push({ caste: 0, stage: 0, t }));
  ho.brood.larvae.forEach(t => brood.push({ caste: 0, stage: 1, t }));
  ho.brood.pupae.forEach(t => brood.push({ caste: 0, stage: 2, t }));
  const patch = {
    phase: 'colony',
    playerSite: { x: ho.x, y: ho.y },
    nestPreset: Fd.nestPreset(ho),
    // the flight's reserve bonus is already inside the founding's leftover reserves: don't apply it twice
    queenTraits: Object.assign({}, opts && opts.queenTraits, { reserveBonus: 0, foundingReserveBonus: (opts && opts.queenTraits && opts.queenTraits.reserveBonus) || 0, foundingSite: ho.siteId }),
    start: { workers: ho.nanitics + ho.workers, nanitics: ho.nanitics, brood, stock: ho.stock },
    siteTraits: Object.assign({ site: ho.siteId }, ho.mods, { nanitics: ho.nanitics, naniticStats: ho.naniticStats }),
    founding: ho,
  };
  if (rivals && rivals.length) patch.rivalFoundings = rivals;
  if (race) { const rk = FR.rank(race); patch.foundingRace = { day: Math.round(race.day * 10) / 10, place: rk.place, of: rk.of, stillFounding: rk.still }; }
  // keep the flight's rival nests (setting playerSite makes createWorld rebuild layout.nests)
  if (opts && !opts.rivalSites && opts.layout && opts.layout.nests && opts.layout.nests.length > 1) patch.rivalSites = opts.layout.nests.slice(1).map(n => ({ x: n.x, y: n.y }));
  return patch;
}

const Scene = {
  id: 'founding', order: 20,
  enabled(opts) { return !opts.skipFounding; },
  start(game, ctx) {
    this.game = game; this.ctx = ctx;
    const opts = ctx.opts || {};
    const site = siteFromOpts(opts);
    const seed = ((opts.seed >>> 0) || 12345) ^ 0x7a11;
    const land = site.land;
    const neighbours = opts.flight && land ? ((opts.flight.queens || []).find(q => q.colonyId === 0) || {}).neighbours || [] : [];
    this.mk = (sd) => {
      const rb = land && land.bonus ? land.bonus.reserves : (opts.queenTraits && opts.queenTraits.reserveBonus) || 0;
      const fs = Fd.create({ site, species: opts.species || 'fire', seed: sd, reserveBonus: rb });
      fs.threatMul = 1 + neighbours.length * 0.6;            // (only used when there is no race)
      return fs;
    };
    // the founding race: every rival queen founds alongside the player
    this.rivalSpecs = FR ? FR.rivalSpecs(opts, (opts.seed >>> 0) || 1, site.type) : [];
    this.mapSites = opts.flight && opts.flight.sites ? opts.flight.sites : (() => { try { return AL.Sites.placeDefault((opts.seed >>> 0) || 1, { map: opts }); } catch (_) { return []; } })();
    this.mapZ = mapSize(opts);
    this.boot(seed);
    this.onKey = e => this.key(e);
    window.addEventListener('keydown', this.onKey);
    const hud = document.getElementById('hud'); if (hud && !hud.hidden) { hud.hidden = true; this.hidHud = hud; }
  },
  boot(seed) {
    if (this.hud) this.hud.destroy();
    this.fs = this.mk(seed);
    const site = this.fs.site;
    this.race = FR ? FR.create({ player: this.fs, rivals: this.rivalSpecs, seed, x: site.x, y: site.y }) : null;
    this.view = new View(this.fs, { race: this.race });
    this.hud = new HUD(this.fs, document.body, {
      done: ho => {
        const rivals = this.race ? FR.rivalPatch(this.race) : rivalFoundings(this.ctx.opts || {}, seed);
        this.ctx.done(toPatch(ho, this.ctx.opts, rivals, this.race));
      },
      retry: () => this.boot((seed * 1103515245 + 12345) >>> 0),
    }, this.race, { sites: this.mapSites, W: this.mapZ.W, H: this.mapZ.H });
  },
  update(game, dt) { if (!this.fs) return; if (this.race) FR.update(this.race, dt); else Fd.update(this.fs, dt); this.hud.frame(dt); this.lastDt = dt; },
  render(c, game) {
    const r = game.renderer, W = r.w || c.canvas.width, H = r.h || c.canvas.height;
    this.view.draw(c, W, H, this.lastDt || 1 / 60);
  },
  key(e) {
    const fs = this.fs; if (!fs || (e.target && e.target.tagName === 'INPUT')) return;
    if (e.code === 'Space') { fs.paused = !fs.paused; e.preventDefault(); }
    else if (e.code === 'Digit1') fs.speed = 1; else if (e.code === 'Digit2') fs.speed = 2; else if (e.code === 'Digit3') fs.speed = 4;
    else if (e.code === 'KeyE') Fd.eatEgg(fs);
    else if (e.code === 'KeyO') Fd.openEntrance(fs);
    else if (e.code === 'KeyP') Fd.plugEntrance(fs);
    else if (e.code === 'Enter') { if (fs.phase === 'land') Fd.shedWings(fs); else if (fs.phase === 'done' && this.hud) this.hud.cb.done(Fd.handoff(fs)); else if (Fd.colonyReady(fs)) Fd.finish(fs); }
    else return;
    if (this.hud) this.hud.refresh(true);   // a key after the scene's HUD is gone
  },
  end() {
    if (this.onKey) window.removeEventListener('keydown', this.onKey);
    if (this.hidHud) { this.hidHud.hidden = false; this.hidHud = null; }
    if (this.hud) this.hud.destroy();
    this.hud = null; this.view = null; this.fs = null; this.race = null;
  },
};
if (AL.registerScene) AL.registerScene(Scene);

AL.FoundingScene = { View, HUD, Scene, drawSideAnt, drawEgg, drawLarva, drawPupa, siteFromOpts, toPatch, rivalFoundings };
})(window);
