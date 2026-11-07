// Antlands World stage art: creatures, carcasses, termite mound, picnic blanket, sprinkler, shoe,
// lawnmower and the robin. Canvas paths only, in world units, lit from the upper left with soft
// drop shadows to the lower right (same look as art.js). Browser only.
(function (root) {
'use strict';
const AL = root.AL, TAU = Math.PI * 2, PI = Math.PI;
const Art = AL.Art;
const sh = (hex, f) => Art.shade(hex, f);

function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
function softShadow(ctx, x, y, rx, ry, a) { ctx.fillStyle = 'rgba(15,10,5,' + (a == null ? 0.3 : a) + ')'; ell(ctx, x, y, rx, ry); ctx.fill(); }

// ---- spider (wolf spider: brown, striped, eight jointed legs) ---------------------------------------
const SP_LEGS = [0.55, 1.2, 1.95, 2.6];
function drawSpider(ctx, x, y, a, s, t, o) {
  o = o || {};
  const dead = !!o.dead, g = 'rgba(15,10,5,0.3)';
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  // shadow (offset down-right in world space)
  ctx.save(); ctx.rotate(-a); ctx.fillStyle = g; ell(ctx, 3, 4, 13, 10); ctx.fill(); ctx.restore();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const legC = dead ? '#5a5048' : '#3a2a1c';
  for (let k = 0; k < 4; k++) for (const side of [-1, 1]) {
    const phase = ((k + (side > 0 ? 1 : 0)) & 1) ? PI : 0;
    const sw = dead ? 0 : Math.sin(t * 9 + phase) * 0.22;
    const bx = 3.2 - k * 1.5, by = side * 1.9;
    const ka = (SP_LEGS[k] + sw) * side, L1 = dead ? 5 : 9, L2 = dead ? 4 : 10.5;
    const kx = bx + Math.cos(ka) * L1, ky = by + Math.sin(ka) * L1;
    const fa = ka + side * (dead ? 1.6 : (k < 2 ? -0.45 : 0.45)) * 1;
    const fx = kx + Math.cos(fa) * L2, fy = ky + Math.sin(fa) * L2;
    ctx.strokeStyle = legC; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = 1.05; ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.fillStyle = sh(legC, 0.25); ctx.beginPath(); ctx.arc(kx, ky, 0.8, 0, TAU); ctx.fill();
  }
  const body = dead ? '#6a6058' : '#7a5a3a', dark = dead ? '#3a3632' : '#3a2616';
  // abdomen
  let gr = ctx.createRadialGradient(-6, -2.5, 1, -7, 0, 8.5);
  gr.addColorStop(0, sh(body, 0.3)); gr.addColorStop(0.6, body); gr.addColorStop(1, dark);
  ctx.fillStyle = gr; ell(ctx, -7, 0, 7.6, 5.8); ctx.fill();
  ctx.fillStyle = 'rgba(30,18,8,0.55)';
  for (let k = 0; k < 4; k++) { const cx = -3.5 - k * 2.2; ctx.beginPath(); ctx.moveTo(cx, -3.6 + k * 0.5); ctx.lineTo(cx - 1.6, 0); ctx.lineTo(cx, 3.6 - k * 0.5); ctx.lineTo(cx - 0.6, 0); ctx.closePath(); ctx.fill(); }
  ctx.fillStyle = 'rgba(225,195,140,0.45)'; ell(ctx, -6.5, 0, 4.8, 0.9); ctx.fill();
  // cephalothorax
  gr = ctx.createRadialGradient(2.2, -1.6, 0.5, 2, 0, 5);
  gr.addColorStop(0, sh(body, 0.35)); gr.addColorStop(1, dark);
  ctx.fillStyle = gr; ell(ctx, 2.2, 0, 4.8, 3.9); ctx.fill();
  ctx.strokeStyle = 'rgba(230,200,150,0.4)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(-1.5, 0); ctx.lineTo(5.5, 0); ctx.stroke();
  // palps + fangs
  ctx.strokeStyle = dark; ctx.lineWidth = 1.1;
  for (const s2 of [-1, 1]) { ctx.beginPath(); ctx.moveTo(6.2, s2 * 1.2); ctx.lineTo(8.6, s2 * 1.9); ctx.stroke(); }
  // eyes
  if (!dead) for (const s2 of [-1, 1]) {
    ctx.fillStyle = '#0c0806'; ctx.beginPath(); ctx.arc(5.4, s2 * 1.15, 0.95, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(5.15, s2 * 1.15 - 0.35, 0.32, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,240,220,0.35)'; ell(ctx, -8, -2.6, 3, 1); ctx.fill();
  ctx.restore();
}

// ---- ground beetle (living; the core draws the dead one) ----------------------------------------
function drawBeetle(ctx, x, y, a, s, t, o) {
  o = o || {};
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  ctx.save(); ctx.rotate(-a); softShadow(ctx, 3, 4, 14, 10, 0.32); ctx.restore();
  ctx.strokeStyle = '#141210'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  for (let k = -1; k <= 1; k++) for (const sd of [-1, 1]) {
    const ph = ((k + 1 + (sd > 0 ? 1 : 0)) & 1) ? PI : 0, sw = Math.sin(t * 8 + ph) * 0.3;
    const bx = k * 3.6 + 1, by = sd * 4.5, ang = sd * (PI / 2 + k * -0.5 + sw);
    const kx = bx + Math.cos(ang) * 6, ky = by + Math.sin(ang) * 6, fx = kx + Math.cos(ang - sd * k * 0.4 + sd * 0.2) * 5, fy = ky + Math.sin(ang - sd * k * 0.4 + sd * 0.2) * 5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  }
  // antennae
  ctx.lineWidth = 0.8;
  for (const sd of [-1, 1]) { const w = Math.sin(t * 3 + sd) * 0.15; ctx.beginPath(); ctx.moveTo(11, sd * 1.6); ctx.quadraticCurveTo(15, sd * (3 + w * 10), 18, sd * (5.5 + w * 8)); ctx.stroke(); }
  // elytra
  const gr = ctx.createRadialGradient(-3, -3.5, 1, -2, 0, 12);
  gr.addColorStop(0, '#6a8a7a'); gr.addColorStop(0.35, '#2e4448'); gr.addColorStop(1, '#0e1216');
  ctx.fillStyle = gr; ell(ctx, -2.5, 0, 10.5, 7.4); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-12.5, 0); ctx.lineTo(5, 0); ctx.stroke();
  ctx.strokeStyle = 'rgba(160,220,200,0.18)'; ctx.lineWidth = 0.5;
  for (const sd of [-1, 1]) for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(-2.5, 0, 9.5 - k * 2, 7 - k * 2.2, 0, sd > 0 ? 0.3 : PI + 0.3, sd > 0 ? PI - 0.3 : TAU - 0.3); ctx.stroke(); }
  // pronotum + head
  ctx.fillStyle = '#1c2226'; ell(ctx, 6.6, 0, 3.6, 5); ctx.fill();
  ctx.fillStyle = '#161a1c'; ell(ctx, 10, 0, 2.6, 2.8); ctx.fill();
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 0.9; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(12, sd * 1); ctx.lineTo(13.6, sd * 0.2); ctx.stroke(); }
  ctx.fillStyle = 'rgba(190,240,220,0.4)'; ell(ctx, -4, -3.8, 4.5, 1.3, -0.1); ctx.fill();
  if (o.angry) { ctx.strokeStyle = 'rgba(255,120,80,0.6)'; ctx.lineWidth = 0.8; ell(ctx, -1, 0, 14, 10); ctx.stroke(); }
  ctx.restore();
}

// ---- ladybug ---------------------------------------------------------------------------------------
const LB_SPOTS = [[-1, -2.6, 1.3], [-1, 2.6, 1.3], [-4, -1.6, 1.1], [-4, 1.6, 1.1], [1.6, -1.7, 0.9], [1.6, 1.7, 0.9], [-5.6, 0, 0.8]];
function drawLadybug(ctx, x, y, a, s, t, alt, o) {
  o = o || {};
  alt = alt || 0;
  ctx.save();
  // shadow drops away as it flies higher
  softShadow(ctx, x + 2 + alt * 12, y + 3 + alt * 18, 7 * s * (1 - alt * 0.3), 5.5 * s * (1 - alt * 0.3), 0.3 * (1 - alt * 0.6));
  ctx.translate(x, y); ctx.rotate(a); ctx.scale(s * (1 + alt * 0.25), s * (1 + alt * 0.25));
  if (alt > 0.05) {
    // wings out: blurred membranes and open wing cases
    const fl = Math.abs(Math.sin(t * 40));
    ctx.fillStyle = 'rgba(235,240,250,' + (0.25 + 0.2 * fl) + ')';
    for (const sd of [-1, 1]) { ell(ctx, -3, sd * (5 + fl * 3), 6.5, 3.4 + fl * 1.5, sd * 0.4); ctx.fill(); }
  } else {
    ctx.strokeStyle = '#120c0a'; ctx.lineWidth = 0.7;
    for (let k = -1; k <= 1; k++) for (const sd of [-1, 1]) { const sw = Math.sin(t * 10 + k + sd) * 0.3; ctx.beginPath(); ctx.moveTo(k * 2, sd * 3); ctx.lineTo(k * 2.6 + sw, sd * 5.4); ctx.stroke(); }
  }
  const open = alt > 0.05 ? 0.55 : 0;
  for (const sd of [-1, 1]) {
    ctx.save(); ctx.translate(1.5, 0); ctx.rotate(sd * open); ctx.translate(-1.5, 0);
    const gr = ctx.createRadialGradient(-1.5, sd * 1.5 - 1.2, 0.5, -1.5, sd * 1.2, 6.5);
    gr.addColorStop(0, '#ff7a5c'); gr.addColorStop(0.55, '#e0321e'); gr.addColorStop(1, '#8e140a');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(-1.5, 0, 5.8, 5, 0, sd > 0 ? 0 : PI, sd > 0 ? PI : TAU); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#140c0a';
    for (const sp of LB_SPOTS) if (Math.sign(sp[1]) === sd || sp[1] === 0) { ctx.beginPath(); ctx.arc(sp[0], sp[1] === 0 ? 0 : sp[1], sp[2], 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  if (!open) { ctx.strokeStyle = '#1a0e0a'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(-7.2, 0); ctx.lineTo(4, 0); ctx.stroke(); }
  ctx.fillStyle = '#141010'; ell(ctx, 4.6, 0, 1.9, 3.6); ctx.fill();
  ctx.fillStyle = '#f2ece0'; for (const sd of [-1, 1]) { ell(ctx, 4.6, sd * 2.2, 0.8, 0.9); ctx.fill(); }
  ctx.fillStyle = '#100a08'; ell(ctx, 6.4, 0, 1.2, 1.7); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ell(ctx, -2.5, -2.4, 2, 0.8, -0.3); ctx.fill();
  ctx.restore();
}

const CPX = new Float64Array(12), CPY = new Float64Array(12);
// ---- caterpillar ------------------------------------------------------------------------------------
function drawCaterpillar(ctx, x, y, a, s, t, o) {
  o = o || {};
  const N = 10, gap = 3.1, amp = o.thrash ? 3.2 : 1.1, dead = !!o.dead;
  const ca = Math.cos(a), sa = Math.sin(a);
  const px = CPX, py = CPY;
  for (let k = 0; k < N; k++) {
    const lx = -k * gap, ly = dead ? Math.sin(k * 0.6) * 1.5 : Math.sin(t * (o.thrash ? 8 : 2.2) - k * 0.75) * amp * (0.4 + k / N);
    px[k] = x + (lx * ca - ly * sa) * s; py[k] = y + (lx * sa + ly * ca) * s;
  }
  ctx.save();
  ctx.fillStyle = 'rgba(15,10,5,0.25)';
  for (let k = 0; k < N; k++) { ctx.beginPath(); ctx.arc(px[k] + 2.2, py[k] + 3, 3.6 * s, 0, TAU); ctx.fill(); }
  for (let k = N - 1; k >= 0; k--) {
    const r = (k === 0 ? 3.7 : 3.4 - (k > 6 ? (k - 6) * 0.3 : 0)) * s;
    const base = dead ? (k & 1 ? '#8a9a6a' : '#7a8a5c') : (k & 1 ? '#6aae3c' : '#7cc04a');
    if (k === 0) {
      const gr = ctx.createRadialGradient(px[k] - r * 0.3, py[k] - r * 0.4, 0.3, px[k], py[k], r);
      gr.addColorStop(0, '#8a6a3a'); gr.addColorStop(1, '#3a2a12');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px[k], py[k], r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(250,240,220,0.8)'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(px[k] + ca * r * 0.4 - sa * sd * r * 0.45, py[k] + sa * r * 0.4 + ca * sd * r * 0.45, 0.6 * s, 0, TAU); ctx.fill(); }
      continue;
    }
    const gr = ctx.createRadialGradient(px[k] - r * 0.35, py[k] - r * 0.4, 0.3, px[k], py[k], r);
    gr.addColorStop(0, sh(base, 0.35)); gr.addColorStop(0.7, base); gr.addColorStop(1, sh(base, -0.35));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px[k], py[k], r, 0, TAU); ctx.fill();
    if (!dead) { ctx.fillStyle = k % 2 ? '#f2d24a' : '#2a3a1a'; ctx.beginPath(); ctx.arc(px[k], py[k], 0.9 * s, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
function drawCocoon(ctx, x, y, a, s, o) {
  o = o || {};
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  ctx.save(); ctx.rotate(-a); softShadow(ctx, 2, 3, 9, 6, 0.3); ctx.restore();
  const gr = ctx.createLinearGradient(0, -5, 0, 5); gr.addColorStop(0, '#f2e8d0'); gr.addColorStop(1, '#a8906a');
  ctx.fillStyle = gr; ell(ctx, 0, 0, 9, 4.8); ctx.fill();
  ctx.strokeStyle = 'rgba(120,100,70,0.45)'; ctx.lineWidth = 0.4;
  for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(-8 + Math.abs(k), k * 1.2); ctx.quadraticCurveTo(0, k * 1.6 + 1, 8 - Math.abs(k), k * 1.2); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.3; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(12 + k, -3 + k * 1.5); ctx.stroke(); }
  if (o.torn) { ctx.fillStyle = 'rgba(60,40,20,0.7)'; ell(ctx, 3, 0, 3.5, 2.2); ctx.fill(); }
  ctx.restore();
}
function drawButterfly(ctx, x, y, a, t, alt) {
  const fl = Math.abs(Math.cos(t)), s = 1 + alt * 0.3;
  softShadow(ctx, x + 20 * alt + 4, y + 30 * alt + 5, 9 * fl + 2, 6, 0.18);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  for (const sd of [-1, 1]) {
    ctx.save(); ctx.scale(1, sd * (0.25 + 0.75 * fl));
    ctx.fillStyle = '#e8862a'; ctx.beginPath(); ctx.moveTo(2, 0); ctx.bezierCurveTo(8, -4, 9, -13, 2, -12); ctx.bezierCurveTo(-1, -11, 0, -4, 0, 0); ctx.fill();
    ctx.fillStyle = '#d0701e'; ctx.beginPath(); ctx.moveTo(-1, 0); ctx.bezierCurveTo(-3, -4, -9, -9, -6, -11); ctx.bezierCurveTo(-3, -12, 0, -6, 0, 0); ctx.fill();
    ctx.strokeStyle = '#1a1008'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(2, -12); ctx.bezierCurveTo(9, -13, 8, -4, 2, 0); ctx.stroke();
    ctx.fillStyle = '#fff'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(4 + k * 1.4, -11 + k * 0.6, 0.45, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  ctx.fillStyle = '#1a1008'; ell(ctx, 0, 0, 4, 0.9); ctx.fill();
  ctx.restore();
}

// ---- termite mound ---------------------------------------------------------------------------------------
const moundCache = new Map();
function moundCanvas(cr) {
  let m = moundCache.get(cr.id);
  if (m) return m;
  const r = cr.r, res = 3, size = Math.ceil((r * 2 + 30) * res), cv = Art.canvas(size, size), x = cv.getContext('2d');
  x.scale(res, res); x.translate(r + 15, r + 15);
  const R = AL.rng(cr.id * 977 + 13);
  let g = x.createRadialGradient(7, 9, r * 0.3, 7, 9, r * 1.25);
  g.addColorStop(0, 'rgba(20,12,5,0.5)'); g.addColorStop(1, 'rgba(20,12,5,0)');
  x.fillStyle = g; x.beginPath(); x.arc(7, 9, r * 1.25, 0, TAU); x.fill();
  // lumpy clay rings, lighter toward the top
  for (let ring = 0; ring < 4; ring++) {
    const rr = r * (1 - ring * 0.22), lit = ring / 4;
    g = x.createRadialGradient(-rr * 0.4, -rr * 0.45, rr * 0.1, 0, 0, rr);
    g.addColorStop(0, Art.mix('#d8a46a', '#f0c48a', lit)); g.addColorStop(0.6, Art.mix('#a8703e', '#c88a50', lit)); g.addColorStop(1, Art.mix('#6a4222', '#8a5a30', lit));
    x.fillStyle = g; x.beginPath();
    for (let i = 0; i <= 26; i++) { const a = i / 26 * TAU, w = 1 + (AL.hash2(i % 26, ring, cr.id) - 0.5) * 0.22; x.lineTo(Math.cos(a) * rr * w - ring * 1.5, Math.sin(a) * rr * w - ring * 2); }
    x.fill();
  }
  // texture and chimney holes
  for (let k = 0; k < r * 7; k++) { const a = R() * TAU, d = Math.sqrt(R()) * r, gx = Math.cos(a) * d, gy = Math.sin(a) * d; x.fillStyle = (-gx - gy) > 0 ? 'rgba(250,220,170,0.35)' : 'rgba(70,40,20,0.35)'; x.beginPath(); x.arc(gx, gy, 0.5 + R() * 0.9, 0, TAU); x.fill(); }
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1 + 0.4, d = r * (0.25 + (k % 3) * 0.2), hx = Math.cos(a) * d - 3, hy = Math.sin(a) * d - 4;
    x.fillStyle = '#2a1608'; x.beginPath(); x.ellipse(hx, hy, 2.2, 1.6, a, 0, TAU); x.fill();
    x.strokeStyle = 'rgba(255,220,170,0.4)'; x.lineWidth = 0.5; x.beginPath(); x.ellipse(hx, hy, 2.6, 2, a, 3.4, 5.4); x.stroke();
  }
  m = { cv, size: size / res, off: r + 15 };
  moundCache.set(cr.id, m);
  return m;
}
function drawTermite(ctx, x, y, a, soldier) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = '#efe0c0'; ell(ctx, -1.2, 0, 2.2, 1.2); ctx.fill();
  ctx.fillStyle = soldier ? '#c4642a' : '#e2c890'; ell(ctx, 1.4, 0, soldier ? 1.4 : 1, soldier ? 1.1 : 0.9); ctx.fill();
  if (soldier) { ctx.strokeStyle = '#3a1a08'; ctx.lineWidth = 0.35; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(2.4, s * 0.4); ctx.lineTo(3.6, s * 0.1); ctx.stroke(); } }
  ctx.restore();
}
function drawTermiteMound(ctx, cr, t) {
  const m = moundCanvas(cr);
  ctx.drawImage(m.cv, cr.x - m.off, cr.y - m.off, m.size, m.size);
  if (cr.state === 'breached') {
    // cracked open: dark cavity, spilling larvae
    ctx.strokeStyle = 'rgba(40,20,8,0.8)'; ctx.lineWidth = 1.4;
    for (let k = 0; k < 5; k++) { const a = k * 1.3; ctx.beginPath(); ctx.moveTo(cr.x - 4, cr.y - 5); ctx.lineTo(cr.x - 4 + Math.cos(a) * cr.r * 0.8, cr.y - 5 + Math.sin(a) * cr.r * 0.8); ctx.stroke(); }
    ctx.fillStyle = '#1e0e04'; ell(ctx, cr.x - 4, cr.y - 5, cr.r * 0.38, cr.r * 0.3); ctx.fill();
    return;
  }
  // soldiers patrol the rim; more pour out while it's attacked
  const n = Math.round(4 + 10 * cr.hp / cr.maxHp + Math.min(10, cr.attackers || 0));
  for (let k = 0; k < n; k++) {
    const dir = k & 1 ? 1 : -1, a = k * 2.399 + t * 0.35 * dir, rr = cr.r + 1 + Math.sin(t * 2 + k) * 2.5;
    drawTermite(ctx, cr.x + Math.cos(a) * rr, cr.y + Math.sin(a) * rr, a + dir * PI / 2, k % 3 === 0);
  }
}

// ---- picnic blanket, sprinkler, shoe, mower --------------------------------------------------------------
function drawBlanket(ctx, b) {
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.rot || 0);
  const w = b.w, h = b.h;
  ctx.fillStyle = 'rgba(20,15,5,0.3)'; ctx.beginPath(); ctx.roundRect(-w / 2 + 6, -h / 2 + 8, w, h, 6); ctx.fill();
  ctx.fillStyle = '#f4ede0'; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 5); ctx.fill();
  const c = 23;
  ctx.fillStyle = 'rgba(200,48,40,0.82)';
  for (let yy = -h / 2, j = 0; yy < h / 2; yy += c, j++) for (let xx = -w / 2, i = 0; xx < w / 2; xx += c, i++) if ((i + j) & 1) ctx.fillRect(xx, yy, Math.min(c, w / 2 - xx), Math.min(c, h / 2 - yy));
  ctx.fillStyle = 'rgba(200,48,40,0.35)';
  for (let xx = -w / 2; xx < w / 2; xx += c) ctx.fillRect(xx + c * 0.35, -h / 2, c * 0.3, h);
  ctx.strokeStyle = 'rgba(120,30,20,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
  // wrinkles catch the light
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-w * 0.4, -h * 0.1); ctx.quadraticCurveTo(-w * 0.1, -h * 0.2, w * 0.2, -h * 0.05); ctx.stroke();
  ctx.restore();
}
function drawSprinkler(ctx, sp, on, t) {
  ctx.save(); ctx.translate(sp.x, sp.y);
  softShadow(ctx, 2, 3, 8, 6, 0.3);
  const g = ctx.createRadialGradient(-2, -2, 0.5, 0, 0, 7); g.addColorStop(0, '#d0d4d8'); g.addColorStop(1, '#5a6066');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#3a3e42'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, TAU); ctx.stroke();
  const a = sp.ang || 0;
  ctx.strokeStyle = '#2e3236'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.stroke();
  ctx.fillStyle = '#e8c040'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill();
  if (on) {
    // the jet sweeps round: droplets along the stream, falling into a mist
    for (let j = 0; j < 3; j++) {
      const aj = a + (j - 1) * 0.06;
      for (let k = 2; k < 34; k++) {
        const d = k / 34 * sp.r, wob = Math.sin(t * 20 + k * 1.7 + j) * (2 + d * 0.02);
        const x = Math.cos(aj) * d - Math.sin(aj) * wob, y = Math.sin(aj) * d + Math.cos(aj) * wob;
        ctx.fillStyle = 'rgba(200,232,255,' + (0.75 - k / 50) + ')';
        ctx.beginPath(); ctx.arc(x, y, 1 + k / 30, 0, TAU); ctx.fill();
      }
    }
    const mg = ctx.createRadialGradient(Math.cos(a) * sp.r * 0.85, Math.sin(a) * sp.r * 0.85, 0, Math.cos(a) * sp.r * 0.85, Math.sin(a) * sp.r * 0.85, 40);
    mg.addColorStop(0, 'rgba(220,240,255,0.35)'); mg.addColorStop(1, 'rgba(220,240,255,0)');
    ctx.fillStyle = mg; ctx.fillRect(Math.cos(a) * sp.r * 0.85 - 40, Math.sin(a) * sp.r * 0.85 - 40, 80, 80);
  }
  ctx.restore();
}
function solePath(ctx, L, Wd) {
  ctx.beginPath();
  ctx.ellipse(L * 0.17, 0, L * 0.33, Wd / 2, 0, 0, TAU);
  ctx.moveTo(-L * 0.11 + L * 0.2, 0);
  ctx.ellipse(-L * 0.31, 0, L * 0.2, Wd / 2 * 0.85, 0, 0, TAU);
  ctx.moveTo(-L * 0.3, -Wd * 0.3); ctx.rect(-L * 0.32, -Wd * 0.3, L * 0.4, Wd * 0.6);
}
// k: 0 (just appeared, high up) .. 1 (landing)
function drawShoeShadow(ctx, st, k) {
  const PT = AL.POI_TUNE, sc = 1.45 - 0.45 * k;
  ctx.save(); ctx.translate(st.x + (1 - k) * 18, st.y + (1 - k) * 26); ctx.rotate(st.a); ctx.scale(sc, sc);
  ctx.fillStyle = 'rgba(12,8,6,' + (0.08 + 0.42 * k * k) + ')';
  solePath(ctx, PT.SHOE_L, PT.SHOE_W); ctx.fill();
  ctx.restore();
}
function drawShoe(ctx, st) {
  const PT = AL.POI_TUNE, L = PT.SHOE_L, Wd = PT.SHOE_W;
  ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.a);
  ctx.fillStyle = 'rgba(10,6,4,0.4)'; ctx.save(); ctx.translate(5, 7); solePath(ctx, L, Wd); ctx.fill(); ctx.restore();
  const g = ctx.createLinearGradient(-L / 2, -Wd / 2, L / 2, Wd / 2); g.addColorStop(0, '#6a8aa8'); g.addColorStop(1, '#2a3a52');
  ctx.fillStyle = g; solePath(ctx, L, Wd); ctx.fill();
  ctx.strokeStyle = 'rgba(240,240,240,0.7)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.ellipse(L * 0.05, 0, L * 0.47, Wd * 0.55, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-L * 0.05 + k * 7, -Wd * 0.28); ctx.lineTo(-L * 0.05 + k * 7 + 4, Wd * 0.28); ctx.stroke(); }
  ctx.restore();
}
function drawImprint(ctx, st, fade) {
  const PT = AL.POI_TUNE;
  ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.a);
  ctx.fillStyle = 'rgba(40,52,22,' + (0.28 * fade) + ')'; solePath(ctx, PT.SHOE_L, PT.SHOE_W); ctx.fill();
  ctx.strokeStyle = 'rgba(20,28,10,' + (0.25 * fade) + ')'; ctx.lineWidth = 1.6;
  for (let k = -3; k <= 3; k++) { ctx.beginPath(); ctx.moveTo(k * 8 + 6, -PT.SHOE_W * 0.35); ctx.lineTo(k * 8 + 10, PT.SHOE_W * 0.35); ctx.stroke(); }
  ctx.restore();
}
function drawMower(ctx, M, t) {
  const PT = AL.POI_TUNE, L = PT.MOWER_LEN, Wd = PT.MOWER_W;
  ctx.save(); ctx.translate(M.x, M.y); if (M.dir < 0) ctx.scale(-1, 1);
  // clippings spray from the side chute
  for (let k = 0; k < 40; k++) {
    const h = AL.hash2(k, (t * 20) | 0, 7), h2 = AL.hash2(k, 3, (t * 20) | 0);
    ctx.fillStyle = k % 3 ? 'rgba(120,180,70,0.8)' : 'rgba(170,210,100,0.8)';
    ctx.fillRect(-L * 0.2 - h * 120, Wd / 2 + h2 * 50 - 10, 2.5, 1.4);
  }
  ctx.fillStyle = 'rgba(10,8,6,0.4)'; ctx.beginPath(); ctx.roundRect(-L / 2 + 10, -Wd / 2 + 14, L, Wd, 18); ctx.fill();
  // handle trailing behind
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-L * 0.35, -Wd * 0.3); ctx.lineTo(-L * 1.25, -Wd * 0.22); ctx.moveTo(-L * 0.35, Wd * 0.3); ctx.lineTo(-L * 1.25, Wd * 0.22); ctx.moveTo(-L * 1.25, -Wd * 0.26); ctx.lineTo(-L * 1.25, Wd * 0.26); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  for (const [x, y] of [[-L * 0.38, -Wd / 2], [L * 0.32, -Wd / 2], [-L * 0.38, Wd / 2], [L * 0.32, Wd / 2]]) { ctx.beginPath(); ctx.roundRect(x - 13, y - 7, 26, 14, 5); ctx.fill(); }
  const g = ctx.createLinearGradient(-L / 2, -Wd / 2, L / 2, Wd / 2); g.addColorStop(0, '#e85a44'); g.addColorStop(0.6, '#c2301e'); g.addColorStop(1, '#7a1a10');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-L / 2, -Wd / 2 + 4, L, Wd - 8, 20); ctx.fill();
  const g2 = ctx.createRadialGradient(-8, -10, 2, 0, 0, 34); g2.addColorStop(0, '#9a9a9a'); g2.addColorStop(1, '#3a3a3a');
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; for (let k = 0; k < 8; k++) { const a = k * PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); ctx.lineTo(Math.cos(a) * 28, Math.sin(a) * 28); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.beginPath(); ctx.ellipse(-L * 0.2, -Wd * 0.3, L * 0.25, 6, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---- robin: crisp sprite + blurred shadow, built once ---------------------------------------------------
let birdSpr = null;
function birdPath(x) {
  // top-down, facing +x, wings spread (world units ~ 130 wingspan)
  x.beginPath();
  x.moveTo(34, 0); x.quadraticCurveTo(28, -7, 16, -8);
  x.bezierCurveTo(10, -30, -2, -56, -14, -66); x.lineTo(-18, -58); x.lineTo(-24, -60); x.lineTo(-26, -50); x.lineTo(-32, -48);
  x.bezierCurveTo(-22, -30, -16, -16, -14, -8); x.lineTo(-30, -14); x.lineTo(-44, -6); x.lineTo(-46, 0); x.lineTo(-44, 6); x.lineTo(-30, 14); x.lineTo(-14, 8);
  x.bezierCurveTo(-16, 16, -22, 30, -32, 48); x.lineTo(-26, 50); x.lineTo(-24, 60); x.lineTo(-18, 58); x.lineTo(-14, 66);
  x.bezierCurveTo(-2, 56, 10, 30, 16, 8); x.quadraticCurveTo(28, 7, 34, 0); x.closePath();
}
function birdSprites() {
  if (birdSpr) return birdSpr;
  const S = 2, size = 150 * S, mk = () => { const c = Art.canvas(size, size), x = c.getContext('2d'); x.translate(size / 2, size / 2); x.scale(S, S); return [c, x]; };
  const [c1, x1] = mk();
  birdPath(x1);
  const g = x1.createLinearGradient(-40, -60, 30, 60); g.addColorStop(0, '#8a6a4a'); g.addColorStop(1, '#4a3424');
  x1.fillStyle = g; x1.fill();
  x1.strokeStyle = 'rgba(30,20,12,0.5)'; x1.lineWidth = 1;
  for (const sd of [-1, 1]) for (let k = 0; k < 5; k++) { x1.beginPath(); x1.moveTo(-4 - k * 3, sd * (14 + k * 4)); x1.lineTo(-16 - k * 3, sd * (40 + k * 4)); x1.stroke(); }
  x1.fillStyle = '#5a4030'; x1.beginPath(); x1.ellipse(2, 0, 20, 9, 0, 0, TAU); x1.fill();
  x1.fillStyle = '#d8642a'; x1.beginPath(); x1.ellipse(8, 0, 10, 6, 0, 0, TAU); x1.fill();
  x1.fillStyle = '#2a201a'; x1.beginPath(); x1.ellipse(24, 0, 7, 6, 0, 0, TAU); x1.fill();
  x1.fillStyle = '#e8b830'; x1.beginPath(); x1.moveTo(30, -2); x1.lineTo(37, 0); x1.lineTo(30, 2); x1.fill();
  x1.fillStyle = '#fff'; for (const sd of [-1, 1]) { x1.beginPath(); x1.arc(26, sd * 3.6, 1, 0, TAU); x1.fill(); }
  const [c2, x2] = mk();
  x2.filter = 'blur(5px)'; birdPath(x2); x2.fillStyle = 'rgba(8,8,16,1)'; x2.fill();
  birdSpr = { bird: c1, shadow: c2, size: 150 };
  return birdSpr;
}
function drawBirdShadow(ctx, x, y, a, scale, alpha) {
  const B = birdSprites();
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(a); ctx.scale(scale, scale);
  ctx.drawImage(B.shadow, -B.size / 2, -B.size / 2, B.size, B.size); ctx.restore();
}
function drawBird(ctx, x, y, a, scale, flap) {
  const B = birdSprites();
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(scale, scale * (0.75 + 0.25 * Math.abs(Math.cos(flap || 0))));
  ctx.drawImage(B.bird, -B.size / 2, -B.size / 2, B.size, B.size); ctx.restore();
}

// ---- carcasses (food visuals) ---------------------------------------------------------------------------
const FD = Art.foodDrawers;
const angOf = f => f.heading != null ? f.heading + PI : (f.a || 0);
FD.spider = (ctx, f, frac) => drawSpider(ctx, f.x, f.y, angOf(f), 0.75 + 0.25 * frac, 0, { dead: true });
FD.caterpillar = (ctx, f, frac) => drawCaterpillar(ctx, f.x, f.y, angOf(f), 0.7 + 0.3 * frac, 0, { dead: true });
FD.ladybug = (ctx, f) => { ctx.globalAlpha *= 0.9; drawLadybug(ctx, f.x, f.y, f.a || 0, 0.9, 0, 0); };
FD.cocoon = (ctx, f, frac) => drawCocoon(ctx, f.x, f.y, f.a || 0, 0.7 + 0.3 * frac, { torn: true });
FD.moth = (ctx, f, frac) => {
  const s = 0.6 + 0.4 * frac;
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(angOf(f)); ctx.scale(s, s);
  ctx.fillStyle = 'rgba(15,10,5,0.28)'; ell(ctx, 3, 4, 13, 9); ctx.fill();
  for (const sd of [-1, 1]) {
    const g = ctx.createLinearGradient(0, 0, -6, sd * 13); g.addColorStop(0, '#a89070'); g.addColorStop(1, '#6a5640');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(3, 0); ctx.quadraticCurveTo(2, sd * 12, -8, sd * 13); ctx.quadraticCurveTo(-9, sd * 5, -6, 0); ctx.fill();
    ctx.fillStyle = 'rgba(60,40,24,0.6)'; ell(ctx, -3, sd * 6, 2, 1.4); ctx.fill();
  }
  ctx.fillStyle = '#5a4630'; ell(ctx, -1, 0, 6, 1.8); ctx.fill();
  ctx.strokeStyle = '#4a3a28'; ctx.lineWidth = 0.6; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(4, sd * 0.6); ctx.quadraticCurveTo(8, sd * 3, 9, sd * 5); ctx.stroke(); }
  ctx.restore();
};
FD.larvae = (ctx, f, frac) => {
  const R = AL.rng(f.id * 19 + 3), n = Math.ceil(30 * frac + 2);
  for (let k = 0; k < n; k++) {
    const a = R() * TAU, d = Math.sqrt(R()) * f.r, x = f.x + Math.cos(a) * d, y = f.y + Math.sin(a) * d, r = R() * TAU;
    ctx.fillStyle = 'rgba(20,12,5,0.25)'; ell(ctx, x + 0.6, y + 0.9, 2.2, 1.2, r); ctx.fill();
    ctx.fillStyle = k % 3 ? '#f6f0e2' : '#eadcbc'; ell(ctx, x, y, 2.1, 1.1, r); ctx.fill();
  }
};

AL.WorldArt = { drawSpider, drawBeetle, drawLadybug, drawCaterpillar, drawCocoon, drawButterfly, drawTermiteMound, drawTermite,
  drawBlanket, drawSprinkler, drawShoeShadow, drawShoe, drawImprint, drawMower, drawBirdShadow, drawBird, birdSprites, softShadow };
})(window);
