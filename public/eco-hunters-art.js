// Art for the ant hunters (eco-hunters.js): centipede, antlion (and its pit), assassin bug and praying mantis, alive
// and as carcasses. Canvas paths in world units, lit from the upper left with a soft shadow to the lower right, like
// world-art.js. Drawn on the core render layers: the antlion's pit under the ants, the hunters over them. Render only:
// reads the sim, never writes it. Browser only.
(function (root) {
'use strict';
const AL = root.AL, TAU = Math.PI * 2, PI = Math.PI, Art = AL.Art;
const sh = (hex, f) => Art.shade(hex, f);
function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU); }
function shadow(ctx, a, rx, ry) { ctx.save(); ctx.rotate(-a); ctx.fillStyle = 'rgba(15,10,5,0.28)'; ell(ctx, 2.5, 3.5, rx, ry); ctx.fill(); ctx.restore(); }

// ---- centipede: a long run of orange-brown segments, a pair of legs on each, venom claws at the front ----------------
const CN = 15;
function drawCentipede(ctx, x, y, a, s, t, o) {
  o = o || {};
  const dead = !!o.dead, body = dead ? '#6e5a48' : '#a2522a', dark = dead ? '#3c3028' : '#4a2210', leg = dead ? '#6a5a4a' : '#c98a4a';
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  shadow(ctx, a, 16, 5);
  ctx.lineCap = 'round';
  // the body snakes: each segment follows a travelling wave
  const P = [];
  for (let k = 0; k < CN; k++) { const sx = 9 - k * 1.85, sy = dead ? Math.sin(k * 0.7) * 1.2 : Math.sin(t * 6 - k * 0.55) * 1.6 * (k / CN + 0.3); P.push([sx, sy]); }
  ctx.strokeStyle = leg; ctx.lineWidth = 0.55;
  for (let k = 1; k < CN; k++) for (const sd of [-1, 1]) {
    const [sx, sy] = P[k], sw = dead ? 0.6 : Math.sin(t * 14 + k * 0.9 + (sd > 0 ? PI : 0)) * 0.5;
    ctx.beginPath(); ctx.moveTo(sx, sy + sd * 1.2); ctx.lineTo(sx - 1 + sw, sy + sd * 4.2); ctx.stroke();
  }
  // tail feelers
  ctx.beginPath(); ctx.moveTo(P[CN - 1][0], P[CN - 1][1]); ctx.lineTo(P[CN - 1][0] - 4, P[CN - 1][1] - 2.4); ctx.moveTo(P[CN - 1][0], P[CN - 1][1]); ctx.lineTo(P[CN - 1][0] - 4, P[CN - 1][1] + 2.4); ctx.stroke();
  for (let k = CN - 1; k >= 0; k--) {
    const [sx, sy] = P[k], w = k === 0 ? 1.9 : 1.6 - k * 0.02;
    const g = ctx.createLinearGradient(sx, sy - w, sx, sy + w); g.addColorStop(0, sh(body, 0.3)); g.addColorStop(0.5, body); g.addColorStop(1, dark);
    ctx.fillStyle = g; ell(ctx, sx, sy, 1.15, w); ctx.fill();
    ctx.strokeStyle = 'rgba(30,12,4,0.5)'; ctx.lineWidth = 0.3; ell(ctx, sx, sy, 1.15, w); ctx.stroke();
  }
  // head: antennae and the venom claws
  const [hx, hy] = P[0];
  ctx.strokeStyle = dark; ctx.lineWidth = 0.6;
  for (const sd of [-1, 1]) {
    const wv = dead ? 0 : Math.sin(t * 4 + sd) * 0.4;
    ctx.beginPath(); ctx.moveTo(hx + 1, hy + sd * 0.8); ctx.quadraticCurveTo(hx + 5, hy + sd * (2.5 + wv), hx + 8.5, hy + sd * (4 + wv)); ctx.stroke();
    ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(hx + 0.8, hy + sd * 1.1); ctx.quadraticCurveTo(hx + 2.8, hy + sd * 1.8, hx + 3, hy + sd * 0.4); ctx.stroke(); ctx.lineWidth = 0.6;
  }
  if (o.angry) { ctx.strokeStyle = 'rgba(255,120,80,0.55)'; ctx.lineWidth = 0.7; ell(ctx, -3, 0, 17, 7); ctx.stroke(); }
  ctx.restore();
}

// ---- antlion: the pit (sand cone, darker towards the middle) and the fat, big-jawed larva at the bottom -------------
function drawPit(ctx, x, y, r, t, hungry) {
  if (r < 2) return;
  const g = ctx.createRadialGradient(x - r * 0.15, y - r * 0.2, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(70,52,30,0.75)'); g.addColorStop(0.45, 'rgba(150,120,80,0.55)'); g.addColorStop(0.85, 'rgba(214,190,140,0.35)'); g.addColorStop(1, 'rgba(214,190,140,0)');
  ctx.fillStyle = g; ell(ctx, x, y, r, r * 0.92); ctx.fill();
  // ridges of sliding sand
  ctx.strokeStyle = 'rgba(60,42,22,0.28)'; ctx.lineWidth = 0.5;
  for (let q = 1; q <= 3; q++) { const rr = r * q / 4; ell(ctx, x, y + q * 0.4, rr, rr * 0.9); ctx.stroke(); }
  // a hungry antlion flicks sand up the slope
  if (hungry) {
    ctx.fillStyle = 'rgba(232,212,160,0.8)';
    for (let k = 0; k < 5; k++) { const ph = (t * 1.3 + k * 0.37) % 1, a = k * 1.9 + Math.floor(t * 1.3 + k * 0.37) * 2.3, d = r * 0.15 + ph * r * 0.7; ctx.globalAlpha = 1 - ph; ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d - ph * 3, 0.6, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
}
function drawAntlion(ctx, x, y, a, s, t, o) {
  o = o || {};
  const dead = !!o.dead, body = dead ? '#7a6a58' : '#8a6a44', dark = dead ? '#463c32' : '#3e2c18';
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  if (dead) shadow(ctx, a, 6, 4);
  const g = ctx.createRadialGradient(-1.5, -1.2, 0.4, -1, 0, 5);
  g.addColorStop(0, sh(body, 0.3)); g.addColorStop(1, dark);
  ctx.fillStyle = g; ell(ctx, -1.2, 0, 4.4, 3.6); ctx.fill();   // round, bristly abdomen
  ctx.strokeStyle = 'rgba(40,26,12,0.6)'; ctx.lineWidth = 0.35;
  for (let k = 0; k < 8; k++) { const b = k / 8 * TAU; ctx.beginPath(); ctx.moveTo(-1.2 + Math.cos(b) * 4.2, Math.sin(b) * 3.4); ctx.lineTo(-1.2 + Math.cos(b) * 5, Math.sin(b) * 4.1); ctx.stroke(); }
  ctx.fillStyle = dark; ell(ctx, 3.2, 0, 1.8, 1.6); ctx.fill();   // head
  // the sickle jaws, open wide (snapping when it bites)
  const open = dead ? 0.3 : o.bite ? 0.15 + Math.abs(Math.sin(t * 10)) * 0.5 : 0.75;
  ctx.strokeStyle = dead ? '#5a4a3a' : '#2a1a0c'; ctx.lineWidth = 0.75; ctx.lineCap = 'round';
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(4.4, sd * 0.6); ctx.quadraticCurveTo(6.5, sd * (0.8 + open * 2.6), 8.4, sd * (0.1 + open * 0.9)); ctx.stroke(); }
  ctx.restore();
}

// ---- assassin bug: slim, long-legged, brown with red-orange flanks and a curved stabbing beak ----------------------
function drawAssassin(ctx, x, y, a, s, t, o) {
  o = o || {};
  const dead = !!o.dead, body = dead ? '#6a5a4c' : '#5a3a26', rim = dead ? '#8a6a52' : '#d4502a', dark = dead ? '#3a3028' : '#24160c';
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  shadow(ctx, a, 9, 6);
  ctx.strokeStyle = dark; ctx.lineCap = 'round'; ctx.lineWidth = 0.7;
  for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) {
    const sw = dead || o.still ? 0 : Math.sin(t * 7 + k * 2 + (sd > 0 ? PI : 0)) * 0.25;
    const bx = 2 - k * 2.2, ang = sd * (PI / 2 + (k - 1) * -0.7 + sw), L1 = 5.5, L2 = 6;
    const kx = bx + Math.cos(ang) * L1, ky = sd * 1.5 + Math.sin(ang) * L1, fx = kx + Math.cos(ang - sd * 0.5 * (k - 1)) * L2, fy = ky + Math.sin(ang - sd * 0.5 * (k - 1)) * L2;
    ctx.beginPath(); ctx.moveTo(bx, sd * 1.5); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  }
  // abdomen with the orange connexivum showing at the edges
  ctx.fillStyle = rim; ell(ctx, -3, 0, 5.4, 3.3); ctx.fill();
  const g = ctx.createRadialGradient(-3.5, -1.2, 0.5, -3, 0, 5); g.addColorStop(0, sh(body, 0.35)); g.addColorStop(1, dark);
  ctx.fillStyle = g; ell(ctx, -3, 0, 4.9, 2.5); ctx.fill();
  ctx.fillStyle = body; ell(ctx, 2.6, 0, 2.4, 2); ctx.fill();   // thorax
  ctx.fillStyle = dark; ell(ctx, 5.6, 0, 1.6, 0.9); ctx.fill();   // long narrow head
  // antennae and the beak, folded under or out to stab
  ctx.lineWidth = 0.5;
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(6.6, sd * 0.4); ctx.quadraticCurveTo(9, sd * 2.2, 11.5, sd * 3.6); ctx.stroke(); }
  ctx.strokeStyle = '#120a04'; ctx.lineWidth = 0.6; ctx.beginPath();
  if (o.stab) { ctx.moveTo(6.8, 0); ctx.quadraticCurveTo(8.4, 0.4, 10, 0); } else { ctx.moveTo(6.6, 0.3); ctx.quadraticCurveTo(7.2, 1.2, 5.4, 1.3); }
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,230,200,0.3)'; ell(ctx, -4, -1.4, 2.6, 0.7); ctx.fill();
  ctx.restore();
}

// ---- praying mantis: green, long thorax, raptorial forelegs held up (shot out when it strikes), triangle head --------
function drawMantis(ctx, x, y, a, s, t, o) {
  o = o || {};
  const dead = !!o.dead, body = dead ? '#7a8462' : '#7ab648', dark = dead ? '#4a5038' : '#3e6a22', light = sh(body, 0.35);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(s, s);
  shadow(ctx, a, 14, 6);
  ctx.strokeStyle = dark; ctx.lineCap = 'round'; ctx.lineWidth = 0.75;
  // four walking legs
  for (const [bx, sw0] of [[-1, 0], [-3, 1]]) for (const sd of [-1, 1]) {
    const sw = dead || o.still ? 0 : Math.sin(t * 6 + sw0 * 2 + (sd > 0 ? PI : 0)) * 0.2, ang = sd * (PI / 2 + 0.5 + sw0 * 0.4 + sw);
    const kx = bx + Math.cos(ang) * 6, ky = sd * 0.8 + Math.sin(ang) * 6, fx = kx + Math.cos(ang + sd * 0.5) * 6, fy = ky + Math.sin(ang + sd * 0.5) * 6;
    ctx.beginPath(); ctx.moveTo(bx, sd * 0.8); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  }
  // abdomen (with folded wings) and the long prothorax
  let g = ctx.createLinearGradient(-12, -2, -12, 2); g.addColorStop(0, light); g.addColorStop(1, dark);
  ctx.fillStyle = g; ell(ctx, -7.5, 0, 6.6, 2.4); ctx.fill();
  ctx.strokeStyle = 'rgba(30,60,10,0.45)'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(-13.5, 0); ctx.lineTo(-2, 0); ctx.stroke();
  ctx.fillStyle = body; ell(ctx, 2.8, 0, 4.6, 1.05); ctx.fill();
  // raptorial forelegs: folded "praying", or snapped out in a strike
  const strike = !dead && o.strike, reach = strike ? 7 + Math.abs(Math.sin(t * 12)) * 2 : 2.5;
  ctx.strokeStyle = sh(body, -0.1); ctx.lineWidth = 1.1;
  for (const sd of [-1, 1]) {
    const kx = 5 + reach * 0.6, ky = sd * (strike ? 2.8 : 2), fx = kx + (strike ? reach : 1.5), fy = sd * (strike ? 1.2 : 0.5);
    ctx.beginPath(); ctx.moveTo(6.2, sd * 0.6); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  }
  // triangular head with big eyes
  ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(10.6, 0); ctx.lineTo(7.8, -2.1); ctx.lineTo(7.8, 2.1); ctx.closePath(); ctx.fill();
  if (!dead) for (const sd of [-1, 1]) { ctx.fillStyle = '#d8e8a0'; ctx.beginPath(); ctx.arc(8.1, sd * 1.8, 0.8, 0, TAU); ctx.fill(); ctx.fillStyle = '#20300c'; ctx.beginPath(); ctx.arc(8.3, sd * 1.8, 0.35, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = dark; ctx.lineWidth = 0.4;
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(10, sd * 0.4); ctx.quadraticCurveTo(13, sd * 2.5, 15.5, sd * 4.5); ctx.stroke(); }
  if (o.wings) { ctx.fillStyle = 'rgba(220,240,200,0.35)'; for (const sd of [-1, 1]) { ell(ctx, -5, sd * 5, 8, 3.6, sd * 0.35); ctx.fill(); } }
  ctx.restore();
}

// ---- carcasses (core food drawing: AL.Art.foodDrawers) --------------------------------------------------------------
const FD = Art.foodDrawers;
const angOf = f => f.heading != null ? f.heading + PI : (f.a || 0);
FD.centipede = (ctx, f, frac) => drawCentipede(ctx, f.x, f.y, angOf(f), 0.7 + 0.3 * frac, 0, { dead: true });
FD.antlion = (ctx, f, frac) => drawAntlion(ctx, f.x, f.y, angOf(f), 0.7 + 0.3 * frac, 0, { dead: true });
FD.assassin = (ctx, f, frac) => drawAssassin(ctx, f.x, f.y, angOf(f), 0.7 + 0.3 * frac, 0, { dead: true });
FD.mantis = (ctx, f, frac) => drawMantis(ctx, f.x, f.y, angOf(f), 0.7 + 0.3 * frac, 0, { dead: true });

// ---- render layers ----------------------------------------------------------------------------------------------
const inView = (v, x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
const canSee = (w, x, y) => !w.fog || w.fog.seenAt(x, y);
const zoomOf = v => v.z / (v.dpr || 1);
let clock = 0, lastNow = 0;
function tickClock() { const now = performance.now(); clock += lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0; lastNow = now; return clock; }
function underAnts(ctx, v, r) {
  const w = r.world, L = w.surface.creatures || [], t = tickClock(), H = AL.EcoHunters;
  if (!H) return;
  for (const cr of L) {
    if (cr.type !== 'antlion' || !cr.alive || !inView(v, cr.x, cr.y, 50) || !canSee(w, cr.x, cr.y)) continue;
    drawPit(ctx, cr.x, cr.y, H.pitOf(cr), t, !cr.hidden && cr.state === 'wait' && H.huntsAnts(w, cr));
    if (!cr.hidden) drawAntlion(ctx, cr.x, cr.y, cr.a, cr.scale || 1, t, { bite: cr.state === 'bite' });
  }
}
function overAnts(ctx, v, r) {
  const w = r.world, L = w.surface.creatures || [], a = v.alpha || 0, t = clock;
  const big = Math.min(2.2, Math.max(1, 1.15 / zoomOf(v)));   // as world-fx.js: readable from far away
  for (const cr of L) {
    if (!cr.alive || cr.hidden) continue;
    if (cr.type !== 'centipede' && cr.type !== 'assassin' && cr.type !== 'mantis') continue;
    const x = cr.px + (cr.x - cr.px) * a, y = cr.py + (cr.y - cr.py) * a;
    if (!inView(v, x, y, 40) || !canSee(w, x, y)) continue;
    const k = big * (cr.scale || 1);
    if (cr.type === 'centipede') drawCentipede(ctx, x, y, cr.a, k, cr.anim * 0.3, { angry: cr.attackers > 0 });
    else if (cr.type === 'assassin') drawAssassin(ctx, x, y, cr.a, k * 1.05, cr.anim * 0.4, { still: cr.state === 'wait', stab: cr.state === 'bite' || cr.state === 'feed' });
    else drawMantis(ctx, x, y, cr.a, k * (cr.flying ? 1.1 : 1), t, { still: cr.state === 'perch', strike: cr.state === 'bite', wings: cr.flying });
  }
}
AL.registerSystem({
  id: 'eco-hunters-art', order: 14.1,
  enabled(opts) { return opts.world !== false; },
  render: { underAnts, overAnts },
});
// a toast the first time each hunter turns up in a match
const NEWS = { centipede: 'A centipede has moved into the yard. It hunts ants in the open at night.', antlion: 'An antlion has dug a pit in the sand. Ants that step in slide down to it.',
  assassin: 'An assassin bug is lurking by an ant trail. It stabs ants that walk past.', mantis: 'A praying mantis has settled on a plant. It snatches ants that come close.' };
let told = new WeakMap();
AL.on('ecoArrive', (w, d) => {
  if (!NEWS[d.kind] || !AL.Game || w !== AL.Game.world || AL.Game.demo || !AL.UI || !AL.UI.toast) return;
  let t = told.get(w); if (!t) { t = {}; told.set(w, t); }
  if (t[d.kind]) return; t[d.kind] = 1;
  AL.UI.toast(NEWS[d.kind]);
});
AL.HunterArt = { drawCentipede, drawAntlion, drawPit, drawAssassin, drawMantis };
})(window);
