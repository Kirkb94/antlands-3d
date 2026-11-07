// Army ants' side view: the bivouac (nest.js shapeBivouac). Not a burrow: a cluster of living ants hanging
// under a fallen log, the queen and brood inside, the walls made of workers hooked together by their claws.
// render-nest.js calls these when nest.bivouac is set:
//   paintBivouacBack(nest) -> canvas    the forest floor under the log (static)
//   paintBivouac(nest)                  the cluster's living walls and inside, on the cavity canvas (re-painted as it grows)
//   drawBivouacScene(ctx, W, H, light)  the log and the shade round it, every frame (cheap)
//   drawBivouacCrawl(ctx, nest, col)    ants shifting about on the outside of the cluster and hanging in festoons
(function (root) {
'use strict';
const AL = root.AL, Art = AL.Art, N = AL.Nest, TAU = Math.PI * 2, TILE = N.TILE;
const P = AL.Renderer.prototype;
const RES = 2;
const LOG_TOP = -96;   // the log's top edge (nest units; ground level of the surface view is 0)

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 'rgb(' + Math.round(Math.min(255, r * f)) + ',' + Math.round(Math.min(255, g * f)) + ',' + Math.round(Math.min(255, b * f)) + ')';
};
// one ant of the wall: gaster, petiole, thorax, head, a hint of legs (x, y in nest units)
function wallAnt(x, px, py, a, s, sp, light) {
  x.save(); x.translate(px, py); x.rotate(a); x.scale(s, s);
  x.strokeStyle = shade(sp.head || '#4a2410', 0.6 * light); x.lineWidth = 0.35;
  x.beginPath();
  for (const k of [-1, 1]) { x.moveTo(0.2, 0); x.lineTo(0.9, k * 2.1); x.moveTo(-0.3, 0); x.lineTo(-1.6, k * 2); x.moveTo(0.7, 0); x.lineTo(2.2, k * 1.8); }
  x.stroke();
  x.fillStyle = shade(sp.gaster || '#2a160c', 1.1 * light); x.beginPath(); x.ellipse(-2, 0, 1.7, 1.2, 0, 0, TAU); x.fill();
  x.fillStyle = shade(sp.body || '#6a3a1c', light); x.beginPath(); x.ellipse(0.3, 0, 1.3, 0.75, 0, 0, TAU); x.fill();
  x.fillStyle = shade(sp.head || '#4a2410', light); x.beginPath(); x.ellipse(2.1, 0, 0.95, 0.85, 0, 0, TAU); x.fill();
  x.fillStyle = 'rgba(255,230,190,' + 0.18 * light + ')'; x.beginPath(); x.ellipse(-2.3, -0.5, 0.7, 0.35, 0, 0, TAU); x.fill();
  x.restore();
}

// ---- the forest floor under the log (static) --------------------------------------------------------------
P.paintBivouacBack = function (nest) {
  const W = nest.cols * nest.tile, H = nest.rows * nest.tile;
  const cv = Art.canvas(W * RES, H * RES), x = cv.getContext('2d');
  const R = AL.rng(77);
  x.scale(RES, RES);
  // shade under the log: dim green-brown light, darker lower down
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#2a2a1a'); g.addColorStop(0.55, '#1f2015'); g.addColorStop(1, '#17150d');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // far stems and fern fronds in silhouette
  for (let k = 0; k < 26; k++) {
    const sx = R() * W, h = H * (0.25 + R() * 0.6), lean = (R() - 0.5) * 40;
    x.strokeStyle = 'rgba(52,62,34,' + (0.25 + R() * 0.25) + ')'; x.lineWidth = 1.5 + R() * 3;
    x.beginPath(); x.moveTo(sx, H); x.quadraticCurveTo(sx + lean * 0.4, H - h * 0.6, sx + lean, H - h); x.stroke();
    if (R() < 0.6) for (let j = 0; j < 7; j++) {
      const t = 0.35 + j * 0.09, fx = sx + lean * t * t, fy = H - h * t, side = j % 2 ? 1 : -1;
      x.beginPath(); x.ellipse(fx + side * 9, fy, 10, 2.6, side * 0.5, 0, TAU); x.fillStyle = 'rgba(48,66,30,0.28)'; x.fill();
    }
  }
  // the leaf litter at the bottom
  for (let k = 0; k < 260; k++) {
    const lx = R() * W, ly = H - R() * 46 - 4, s = 4 + R() * 9;
    x.fillStyle = ['#4a3a20', '#5a4424', '#3a2e1a', '#6a5028', '#43391f'][k % 5];
    x.globalAlpha = 0.55 + R() * 0.4;
    x.beginPath(); x.ellipse(lx, ly, s, s * 0.42, (R() - 0.5) * 1.2, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(20,14,6,0.4)'; x.lineWidth = 0.5; x.beginPath(); x.moveTo(lx - s, ly); x.lineTo(lx + s, ly); x.stroke();
  }
  x.globalAlpha = 1;
  // drifting specks of light through the canopy
  for (let k = 0; k < 900; k++) { x.fillStyle = 'rgba(200,210,150,' + (0.03 + R() * 0.05) + ')'; x.fillRect(R() * W, R() * H, 0.8, 0.8); }
  return cv;
};

// ---- the cluster: re-painted on the cavity canvas when it grows or forms again ------------------------------
P.paintBivouac = function (nest) {
  const cv = this.cavCv, x = cv.getContext('2d'), T = nest.tile, cols = nest.cols;
  const sp = nest.colony.sp, R = AL.rng(3 + nest.layoutVersion);
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, cv.width, cv.height);
  x.setTransform(RES, 0, 0, RES, 0, 0);
  const kindAt = (c, r) => (c < 0 || r < 0 || c >= cols || r >= nest.rows) ? TILE.AIR : nest.kind[r * cols + c];
  const live = i => nest.kind[i] === TILE.LIVE, open = i => nest.kind[i] === TILE.OPEN;
  // the cluster's mass: a soft dark body behind the ants, with a shadow on the litter behind it
  const mass = (grow, style) => {
    x.fillStyle = style; x.beginPath();
    for (let i = 0; i < nest.n; i++) {
      if (!live(i) && !open(i)) continue;
      const c = i % cols, r = (i / cols) | 0, cx = (c + 0.5) * T, cy = (r + 0.5) * T;
      x.moveTo(cx + T * grow, cy); x.arc(cx, cy, T * grow, 0, TAU);
    }
    x.fill();
  };
  x.save(); x.translate(5, 7); mass(0.95, 'rgba(0,0,0,0.35)'); x.restore();
  mass(0.85, shade(sp.gaster || '#2a160c', 0.55));
  // the inside: a warm, close space; its floor and walls are ants too, drawn dim so the ants at work show
  x.fillStyle = 'rgba(52,26,14,0.92)'; x.beginPath();
  for (let i = 0; i < nest.n; i++) {
    if (!open(i)) continue;
    const c = i % cols, cx = (c + 0.5) * T, cy = (((i / cols) | 0) + 0.5) * T;
    x.moveTo(cx + T * 0.72, cy); x.arc(cx, cy, T * 0.72, 0, TAU);
  }
  x.fill();
  for (let i = 0; i < nest.n; i++) {
    if (!open(i) || R() < 0.55) continue;
    const c = i % cols, r = (i / cols) | 0;
    wallAnt(x, (c + R()) * T, (r + R()) * T, R() * TAU, 0.75, sp, 0.32);
  }
  // the walls: workers packed shoulder to shoulder, the outermost layer brightest
  for (let i = 0; i < nest.n; i++) {
    if (!live(i)) continue;
    const c = i % cols, r = (i / cols) | 0;
    const edge = kindAt(c - 1, r) === TILE.AIR || kindAt(c + 1, r) === TILE.AIR || kindAt(c, r + 1) === TILE.AIR || kindAt(c, r - 1) === TILE.AIR;
    const lit = edge ? 1 : 0.72, n = edge ? 4 : 3;
    for (let k = 0; k < n; k++) {
      // ants hang head-up near the log and point every which way lower down
      const down = r / Math.max(1, nest.bivouac.hh), a = down < 0.25 ? -Math.PI / 2 + (R() - 0.5) * 1.4 : R() * TAU;
      wallAnt(x, (c + R()) * T, (r + R()) * T, a, 0.82 + R() * 0.2, sp, lit * (0.85 + R() * 0.25));
    }
  }
  // the warm glow of the brood mass round the queen
  const b = nest.bivouac, qx = (nest.entrance.c + 0.5) * T, qy = b.hh * 0.5 * T;
  const gl = x.createRadialGradient(qx, qy, 4, qx, qy, b.hw * T * 0.8);
  gl.addColorStop(0, 'rgba(255,190,110,0.14)'); gl.addColorStop(1, 'rgba(255,190,110,0)');
  x.fillStyle = gl; x.fillRect(qx - b.hw * T, 0, b.hw * T * 2, b.hh * T);
  // where the outside surface meets the air: tiles for the crawlers (drawBivouacCrawl)
  const rim = [];
  for (let i = 0; i < nest.n; i++) {
    if (!live(i)) continue;
    const c = i % cols, r = (i / cols) | 0;
    if (kindAt(c - 1, r) === TILE.AIR || kindAt(c + 1, r) === TILE.AIR || kindAt(c, r + 1) === TILE.AIR) rim.push(i);
  }
  this.bivRim = rim;
  this.cavVer = nest.version;
};

// ---- every frame: the log above, its shade -----------------------------------------------------------------
P.drawBivouacScene = function (ctx, W, H, light) {
  // canopy light above the log
  const sky = ctx.createLinearGradient(0, -400, 0, LOG_TOP);
  sky.addColorStop(0, Art.mix('#0b1410', '#4f7a40', light)); sky.addColorStop(1, Art.mix('#101a12', '#7da35a', light));
  ctx.fillStyle = sky; ctx.fillRect(-600, -800, W + 1200, 800 + LOG_TOP + 4);
  // the forest beyond the painted strip
  ctx.fillStyle = '#1b1b11'; ctx.fillRect(-600, 0, 600, H + 300); ctx.fillRect(W, 0, 600, H + 300); ctx.fillRect(-600, H, W + 1200, 300);
  // the fallen log, end to end across the view: bark, furrows, moss, and its underside in shadow
  const lg = ctx.createLinearGradient(0, LOG_TOP, 0, 8);
  lg.addColorStop(0, Art.mix('#2a1c10', '#7a5a3a', light)); lg.addColorStop(0.55, Art.mix('#20150c', '#5c4228', light)); lg.addColorStop(1, '#1a110a');
  ctx.fillStyle = lg; ctx.beginPath();
  ctx.moveTo(-600, LOG_TOP + 6);
  for (let xx = -600; xx <= W + 600; xx += 24) ctx.lineTo(xx, LOG_TOP + Math.sin(xx * 0.013) * 5 + AL.hash2(xx, 3, 1) * 3);
  ctx.lineTo(W + 600, 6); ctx.lineTo(-600, 6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(15,9,4,0.55)'; ctx.lineWidth = 1.6;
  for (let k = 0; k < 9; k++) {
    const y0 = LOG_TOP + 14 + k * 9.5;
    ctx.beginPath(); for (let xx = -600; xx <= W + 600; xx += 30) ctx.lineTo(xx, y0 + Math.sin(xx * 0.02 + k * 1.7) * 2.5 + (AL.hash2(xx, k, 6) - 0.5) * 2); ctx.stroke();
  }
  ctx.fillStyle = Art.mix('#1e2a12', '#6f8f3a', light * 0.9);
  for (let k = 0; k < 40; k++) { const mx = (AL.hash2(k, 1, 8) * (W + 1000)) - 500, mw = 14 + AL.hash2(k, 2, 8) * 40; ctx.beginPath(); ctx.ellipse(mx, LOG_TOP + 3, mw, 4 + AL.hash2(k, 3, 8) * 4, 0, 0, TAU); ctx.fill(); }
  const ug = ctx.createLinearGradient(0, -6, 0, 14);
  ug.addColorStop(0, 'rgba(0,0,0,0)'); ug.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = ug; ctx.fillRect(-600, -6, W + 1200, 20);
};

// ---- every frame: ants shifting on the outside and festoons hanging from the tip ------------------------------
P.drawBivouacCrawl = function (ctx, nest, col) {
  const rim = this.bivRim; if (!rim || !rim.length || !this.atlas) return;
  const at = this.atlas[col.id], sp = at && at.hi[AL.CASTE.WORKER]; if (!sp) return;
  const T = nest.tile, f = this.frame, n = Math.min(90, rim.length);
  const k0 = 0.75 / sp.scale, cs = sp.cs;
  for (let k = 0; k < n; k++) {
    const i = rim[(k * 2654435761 >>> 0) % rim.length], c = i % nest.cols, r = (i / nest.cols) | 0;
    const ph = f * 0.012 + k * 1.7, wob = Math.sin(ph) * 3.2;
    const x = (c + 0.5) * T + wob, y = (r + 0.5) * T + Math.cos(ph * 0.8) * 2.4, a = Math.atan2(Math.cos(ph) * 0.8, -Math.sin(ph * 0.8) * 0.6) + k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(k0, k0);
    ctx.drawImage(sp.img, (((f / 6 + k) | 0) & 3) * cs, 0, cs, cs, -cs / 2, -cs / 2, cs, cs);
    ctx.restore();
  }
  // festoons: chains of ants hanging from the tip, swaying
  const b = nest.bivouac, tipX = (nest.entrance.c + 0.5) * T, tipY = b.hh * T - 4;
  const chains = Math.min(5, 1 + Math.floor(b.hw / 8));
  for (let j = 0; j < chains; j++) {
    const ox = (j - (chains - 1) / 2) * 11, len = 3 + ((j * 7) % 4), sway = Math.sin(f * 0.02 + j) * 0.12;
    for (let s = 0; s < len; s++) {
      const x = tipX + ox * (1 - s * 0.08) + Math.sin(sway * (s + 1)) * s * 6, y = tipY - Math.abs(ox) * 0.5 + s * 7;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2 + sway * s); ctx.scale(k0, k0);
      ctx.drawImage(sp.img, (((f / 9 + s + j) | 0) & 3) * cs, 0, cs, cs, -cs / 2, -cs / 2, cs, cs);
      ctx.restore();
    }
  }
};
})(window);
