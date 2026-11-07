// Antlands expansion stage art (browser only): territory tint, nest links, satellite mounds and markers,
// founding pits, ruins, winged queens on the mound and in flight, raid tunnels, key-point capture rings
// and the little particle bursts that go with them. Everything is Canvas paths, drawn in world units
// through the core render layers (ground / underAnts / overAnts).
(function (root) {
'use strict';
const AL = root.AL, Art = AL.Art, X = AL.Expansion, TAU = Math.PI * 2, C = AL.CASTE;
if (!X || !Art) return;

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const rgba = (hex, a) => { const c = rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; };
const team = id => X.TEAM[id % X.TEAM.length];
const seen = (world, x, y, ci) => ci === AL.me() || !world.fog || world.fog.seenAt(x, y);
const visible = (world, x, y, ci) => ci === AL.me() || !world.fog || world.fog.visibleAt(x, y);
const inView = (v, x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

// ---- per-world render state + particles ---------------------------------------------------------
let RS = null;
function rs(world) {
  if (!RS || RS.world !== world) RS = { world, terrCv: null, terrSig: '', terrFrame: -99, fx: [], last: performance.now(), dust: Art.softDot(16, '150,115,75'), glow: Art.softDot(24, '255,226,150'), shade: Art.softDot(16, '18,12,4'), trails: new Map() };
  return RS;
}
function puff(S, kind, x, y, n, o) {
  o = o || {};
  for (let k = 0; k < n && S.fx.length < 900; k++) {
    const a = (o.a0 || 0) + (o.spread == null ? Math.random() * TAU : (Math.random() - 0.5) * o.spread), sp = (o.speed || 30) * (0.4 + Math.random() * 0.8);
    S.fx.push({ kind, x: x + (o.jit ? (Math.random() - 0.5) * o.jit : 0), y: y + (o.jit ? (Math.random() - 0.5) * o.jit : 0),
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: (o.life || 1) * (0.6 + Math.random() * 0.6), size: (o.size || 4) * (0.6 + Math.random() * 0.8), col: o.col || '#fff', rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 6 });
  }
}
// sim events -> bursts (listeners are global; only the world being drawn gets them)
const on = (type, fn) => AL.on(type, (w, d) => { if (RS && RS.world === w) fn(RS, d, w); });
on('royalTakeoff', (S, d, w) => { puff(S, 'dust', d.x, d.y, 26, { speed: 55, life: 1.4, size: 9, jit: 14 }); puff(S, 'mote', d.x, d.y, 18, { speed: 30, life: 1.6, size: 2.2, col: '#ffe9a8' }); });
on('royalLanded', (S, d) => { puff(S, 'dust', d.x, d.y, 14, { speed: 30, life: 1.1, size: 7, jit: 8 }); });
on('satelliteFounded', (S, d, w) => { puff(S, 'ring', d.x, d.y, 1, { speed: 0, life: 1.4, size: 70, col: team(d.col) }); puff(S, 'mote', d.x, d.y, 24, { speed: 40, life: 1.3, size: 2, col: team(d.col) }); });
on('satelliteLost', (S, d) => { puff(S, 'dust', d.x, d.y, 30, { speed: 45, life: 1.8, size: 10, jit: 20 }); puff(S, 'clod', d.x, d.y, 22, { speed: 70, life: 1.2, size: 2.6, col: '#5e442a' }); });
on('tunnelBreach', (S, d) => {
  puff(S, 'ring', d.x, d.y, 1, { speed: 0, life: 1.1, size: 90, col: '#ff9a5a' });
  puff(S, 'clod', d.x, d.y, 46, { speed: 120, life: 1.4, size: 3.2, col: '#6a4a2c' });
  puff(S, 'dust', d.x, d.y, 34, { speed: 70, life: 2, size: 12, jit: 30 });
});
on('queenTakeover', (S, d) => { puff(S, 'ring', d.to.x, d.to.y, 1, { speed: 0, life: 2.2, size: 140, col: team(d.col) }); puff(S, 'crown', d.to.x, d.to.y, 1, { speed: 0, life: 2.6, size: 14, col: team(d.col) }); puff(S, 'mote', d.to.x, d.to.y, 40, { speed: 45, life: 1.8, size: 2.2, col: '#ffe9a8' }); });
on('pointCaptured', (S, d) => { puff(S, 'ring', d.x, d.y, 1, { speed: 0, life: 1.2, size: 120, col: team(d.col) }); puff(S, 'mote', d.x, d.y, 30, { speed: 55, life: 1.2, size: 2.2, col: team(d.col) }); });
on('colonyOut', (S, d) => { puff(S, 'ring', d.x, d.y, 1, { speed: 0, life: 2.5, size: 160, col: '#9a9488' }); });

function updateFx(S, ctx, z) {
  const now = performance.now(), dt = Math.min(0.1, (now - S.last) / 1000); S.last = now;
  const fx = S.fx;
  for (let k = fx.length - 1; k >= 0; k--) {
    const p = fx[k]; p.age += dt;
    if (p.age >= p.life) { fx[k] = fx[fx.length - 1]; fx.pop(); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 2.2; p.vy *= 1 - dt * 2.2; p.rot += p.vr * dt;
    const u = p.age / p.life, a = 1 - u;
    if (p.kind === 'dust') { ctx.globalAlpha = a * 0.55; const s = p.size * (1 + u * 1.6); ctx.drawImage(S.dust, p.x - s, p.y - s, s * 2, s * 2); }
    else if (p.kind === 'mote') {
      const s0 = p.size * (0.5 + a * 0.5);
      ctx.globalAlpha = a * 0.35; ctx.drawImage(S.glow, p.x - s0 * 3, p.y - u * 10 - s0 * 3, s0 * 6, s0 * 6);
      ctx.globalAlpha = a; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y - u * 10, s0 * 0.55, 0, TAU); ctx.fill();
    }
    else if (p.kind === 'clod') { ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = p.col; const h = Math.sin(u * Math.PI) * 14; ctx.fillStyle = 'rgba(20,12,5,0.3)'; ctx.beginPath(); ctx.arc(p.x + 2, p.y + 3, p.size * 0.8, 0, TAU); ctx.fill(); ctx.fillStyle = p.col; ctx.beginPath(); ctx.ellipse(p.x, p.y - h, p.size, p.size * 0.75, p.rot, 0, TAU); ctx.fill(); }
    else if (p.kind === 'ring') { ctx.globalAlpha = a * 0.8; ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1.5, 4 * a) ; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.25 + AL.smooth(u) * 0.75), 0, TAU); ctx.stroke(); }
    else if (p.kind === 'crown') { ctx.globalAlpha = Math.min(1, a * 1.5); drawCrown(ctx, p.x, p.y - 30 - u * 30, p.size * (1 + u * 0.3), p.col, true); }
    else if (p.kind === 'wing') { ctx.globalAlpha = a * 0.7; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); wingShape(ctx, p.size, p.size * 0.32); ctx.restore(); }
  }
  ctx.globalAlpha = 1;
}

// ---- small glyphs ---------------------------------------------------------------------------------
function drawCrown(ctx, x, y, s, col, filled) {
  ctx.save(); ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(-s, s * 0.5); ctx.lineTo(-s, -s * 0.25); ctx.lineTo(-s * 0.5, s * 0.1); ctx.lineTo(0, -s * 0.65); ctx.lineTo(s * 0.5, s * 0.1); ctx.lineTo(s, -s * 0.25); ctx.lineTo(s, s * 0.5); ctx.closePath();
  ctx.lineJoin = 'round';
  if (filled) { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = 'rgba(40,24,10,0.85)'; ctx.lineWidth = s * 0.16; ctx.stroke(); }
  else { ctx.strokeStyle = col; ctx.lineWidth = s * 0.2; ctx.stroke(); }
  ctx.restore();
}
function wingShape(ctx, L, W, glass) {
  ctx.fillStyle = glass ? 'rgba(215,232,255,0.2)' : 'rgba(228,238,255,0.42)'; ctx.strokeStyle = glass ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.65)'; ctx.lineWidth = Math.max(0.15, W * (glass ? 0.06 : 0.08));
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(L * 0.3, -W, L * 0.85, -W * 0.9, L, 0); ctx.bezierCurveTo(L * 0.8, W * 0.7, L * 0.3, W * 0.6, 0, 0); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,110,90,0.35)'; ctx.beginPath(); ctx.moveTo(L * 0.05, 0); ctx.lineTo(L * 0.9, -W * 0.15); ctx.moveTo(L * 0.3, -W * 0.25); ctx.lineTo(L * 0.55, W * 0.35); ctx.stroke();
}
// an atlas sprite in world units at (x,y), heading a, overall scale s
function sprite(ctx, r, col, caste, frame, x, y, a, s) {
  const at = r.atlas[col] || r.atlas[0], sp = at.hi[caste], k = s / sp.scale, cs = sp.cs;
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(k, k);
  ctx.drawImage(sp.img, (frame & 3) * cs, 0, cs, cs, -cs / 2, -cs / 2, cs, cs);
  ctx.restore();
}
function spriteShadow(ctx, r, col, caste, x, y, a, s, alpha) {
  const at = r.atlas[col] || r.atlas[0], sh = at.shadow[caste], sp = at.hi[caste], k = s / sp.scale;
  ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(a); ctx.scale(k, k);
  ctx.drawImage(sh.img, -sh.cs / 2, -sh.cs / 2); ctx.restore();
}
// a flying reproductive: shadow on the ground (further away the higher she is), body, buzzing wings
function drawFlyer(ctx, r, col, x, y, a, alt, s, t, male) {
  const len = Art.BASE_LEN * AL.CASTES[C.WINGED].size * s;
  // shadow: soft, smaller and further to the lower right the higher she flies
  const so = alt * 34 * s, ss = 1 - alt * 0.3, S0 = RS && RS.shade;
  if (S0) {
    ctx.save(); ctx.translate(x + so * 0.8 + 1.6, y + so + 2.2); ctx.rotate(a); ctx.globalAlpha *= 0.5 * (1 - alt * 0.4);
    const sx = len * 0.95 * ss, sy = len * 1.05 * ss; ctx.drawImage(S0, -sx, -sy, sx * 2, sy * 2); ctx.restore();
  }
  const lift = 1 + alt * 0.5;
  sprite(ctx, r, col, C.WINGED, 0, x, y, a, s * lift);
  // wings: two pairs spread from the thorax, fast flutter with motion ghosts
  const ca = Math.cos(a), sa = Math.sin(a), tx = x + ca * 0.4 * s * lift, ty = y + sa * 0.4 * s * lift;
  const L = (male ? 8 : 10) * s * lift, W = 3.2 * s * lift;
  const base = ctx.globalAlpha;
  for (let g = 1; g >= 0; g--) {
    const ph = t * 34 - g * 0.7, flap = Math.sin(ph);
    ctx.globalAlpha = base * (g ? 0.35 : 1);
    for (const side of [-1, 1]) for (const fore of [1, 0]) {
      const ang = a + side * (Math.PI / 2 + (fore ? -0.2 : 0.5) + flap * 0.3), l = L * (fore ? 1 : 0.75) * (0.78 + 0.22 * Math.abs(Math.cos(ph)));
      ctx.save(); ctx.translate(tx, ty); ctx.rotate(ang); wingShape(ctx, l, W * (fore ? 1 : 0.8), true); ctx.restore();
    }
  }
  ctx.globalAlpha = base;
}

// ---- territory: one low-res RGBA image, rebuilt when nests change, upscaled smoothly -------------
const TCELL = 10;
let WOB = null, WOBW = 0;
// wobble of a territory edge at (x,y): cached value noise per territory cell so borders look hand-painted
function wob(x, y) {
  const cx = (x / TCELL) | 0, cy = (y / TCELL) | 0;
  if (WOB && cx >= 0 && cy >= 0 && cx < WOBW && cy * WOBW + cx < WOB.length) return WOB[cy * WOBW + cx];
  return 0.94 + 0.12 * AL.noise2(cx * 0.18, cy * 0.18, 17);
}
function homesFor(world) {
  const out = [];
  for (const c of world.colonies) {
    if (!c.out && seen(world, c.x, c.y, c.id)) out.push({ c: c.id, x: c.x, y: c.y, r: c.terrR });
    for (const s of c.satellites) {
      if (s.state === 'ruin' || !seen(world, s.x, s.y, c.id)) continue;
      out.push({ c: c.id, x: s.x, y: s.y, r: s.state === 'founding' ? 90 + s.found * 60 : s.state === 'orphan' ? s.terrR * Math.max(0.3, s.hp / s.maxHp) : s.terrR });
    }
  }
  return out;
}
// rebuilt only when a nest appears, moves, dies or its reach changes by a noticeable step
function territory(S, world) {
  const W = world.surface, cell = TCELL, gw = Math.ceil(W.W / cell), gh = Math.ceil(W.H / cell);
  if (!WOB || WOBW !== gw) { WOBW = gw; WOB = new Float32Array(gw * gh); for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) WOB[cy * gw + cx] = 0.94 + 0.12 * AL.noise2(cx * 0.18, cy * 0.18, 17); }
  const hs = homesFor(world);
  const sig = hs.map(h => h.c + ':' + (h.x | 0) + ',' + (h.y | 0) + ',' + (h.r / 20 | 0)).join('|');
  if (sig === S.terrSig && S.terrCv) return S.terrCv;
  S.terrSig = sig;
  for (const h of hs) h.r = (Math.floor(h.r / 20) + 0.5) * 20;   // same quantised reach for fill and border
  S.homes = hs;
  if (!S.terrCv) { S.terrCv = Art.canvas(gw, gh); S.terrCtx = S.terrCv.getContext('2d'); S.terrImg = S.terrCtx.createImageData(gw, gh); S.terrOwn = new Int8Array(gw * gh); S.terrV = new Float32Array(gw * gh); }
  const own = S.terrOwn, val = S.terrV, d = S.terrImg.data;
  own.fill(-1); val.fill(0);
  for (const h of hs) {
    const r = h.r * 1.07, x0 = Math.max(0, ((h.x - r) / cell) | 0), x1 = Math.min(gw - 1, ((h.x + r) / cell) | 0);
    const y0 = Math.max(0, ((h.y - r) / cell) | 0), y1 = Math.min(gh - 1, ((h.y + r) / cell) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + 0.5) * cell - h.x, dy = (cy + 0.5) * cell - h.y, i = cy * gw + cx;
      const v = 1 - Math.sqrt(dx * dx + dy * dy) / (h.r * WOB[i]);
      if (v > val[i]) { val[i] = v; own[i] = h.c; }
    }
  }
  const cols = X.TEAM.map(rgb);
  for (let i = 0; i < gw * gh; i++) {
    const o = own[i];
    if (o < 0) { d[i * 4 + 3] = 0; continue; }
    const cx = i % gw, cy = (i / gw) | 0;
    const edge = (cx > 0 && own[i - 1] !== o) || (cx < gw - 1 && own[i + 1] !== o) || (cy > 0 && own[i - gw] !== o) || (cy < gh - 1 && own[i + gw] !== o);
    const c = cols[o % cols.length];
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2];
    // faint wash that deepens toward the border
    const v = val[i];
    d[i * 4 + 3] = edge && v > 0.05 ? 40 : 16 + (v < 0.14 ? (0.14 - v) / 0.14 * 30 : 0);
  }
  S.terrCtx.putImageData(S.terrImg, 0, 0);
  // border polylines: each home's wobbly circle, minus the parts another home covers
  S.borders = [];
  const N = 120;
  for (const h of hs) {
    let seg = null;
    for (let k = 0; k <= N; k++) {
      const a = k / N * TAU, rr = h.r * wob(h.x + Math.cos(a) * h.r, h.y + Math.sin(a) * h.r);
      const x = h.x + Math.cos(a) * rr, y = h.y + Math.sin(a) * rr;
      let covered = false;
      for (const o of hs) { if (o === h) continue; if (Math.hypot(x - o.x, y - o.y) < o.r * wob(x, y) - 2) { covered = true; break; } }
      if (covered) { seg = null; continue; }
      if (!seg) { seg = { c: h.c, x0: h.x - h.r, x1: h.x + h.r, y0: h.y - h.r, y1: h.y + h.r, pts: [] }; S.borders.push(seg); }
      seg.pts.push(x, y);
    }
  }
  return S.terrCv;
}
function drawBorders(ctx, view, S) {
  const z = view.z, dp = view.dpr || 1;
  ctx.lineWidth = 1.7 * dp / z; ctx.setLineDash([8 / z * dp, 6 / z * dp]);
  for (const b of S.borders || []) {
    if (b.x1 < view.x0 || b.x0 > view.x1 || b.y1 < view.y0 || b.y0 > view.y1 || b.pts.length < 4) continue;
    ctx.strokeStyle = rgba(team(b.c), 0.6);
    ctx.beginPath(); ctx.moveTo(b.pts[0], b.pts[1]);
    for (let k = 2; k < b.pts.length; k += 2) ctx.lineTo(b.pts[k], b.pts[k + 1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

// ---- ground layer: territory, nest links, key point decals ----------------------------------------
function drawGround(ctx, view, r) {
  const world = r.world; if (!world.exp) return;
  const S = rs(world), z = view.z;
  const tc = territory(S, world);
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = 0.9;
  ctx.drawImage(tc, 0, 0, tc.width * TCELL, tc.height * TCELL);
  ctx.globalAlpha = 1;
  drawBorders(ctx, view, S);
  // linked trails between a capital and its satellites, with porters (dots) walking them
  const lw = Math.max(1.2, 2.2 / Math.max(0.6, z) * 1.4);
  for (const c of world.colonies) {
    if (c.out) continue;
    for (const s of c.satellites) {
      if (s.state === 'ruin' || s.state === 'founding' || !seen(world, s.x, s.y, c.id)) continue;
      const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy);
      ctx.strokeStyle = rgba(team(c.id), 0.28); ctx.lineWidth = lw; ctx.setLineDash([10, 9]); ctx.lineDashOffset = -view.frame * 0.4;
      ctx.beginPath(); ctx.moveTo(c.x + dx / d * c.moundR, c.y + dy / d * c.moundR); ctx.lineTo(s.x - dx / d * s.moundR, s.y - dy / d * s.moundR); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba(team(c.id), 0.55);
      const n = Math.min(12, d / 160 | 0);
      for (let k = 0; k < n; k++) { const u = ((view.frame * 0.0016 + k / n) % 1); ctx.beginPath(); ctx.arc(c.x + dx * u, c.y + dy * u, Math.max(1.6, 2.4 / z), 0, TAU); ctx.fill(); }
    }
  }
  // key points: a ring of pale pebbles marks each one on the ground
  const V = world.victory;
  if (V) for (const p of V.points) {
    if (!inView(view, p.x, p.y, p.r + 40)) continue;
    const R = AL.rng(p.id * 977 + 3);
    for (let k = 0; k < 36; k++) {
      const a = k / 36 * TAU + (R() - 0.5) * 0.08, rr = p.r + (R() - 0.5) * 6, x = p.x + Math.cos(a) * rr, y = p.y + Math.sin(a) * rr, s = 2.4 + R() * 2;
      ctx.fillStyle = 'rgba(25,18,8,0.3)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.6, s, s * 0.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = ['#d8d0bc', '#c7bea8', '#e6dfcc'][k % 3]; ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.78, R() * 3, 0, TAU); ctx.fill();
    }
  }
}

// ---- under ants: satellites, founding pits, ruins, perched royals, key-point rings --------------
function drawSatellite(ctx, view, r, world, c, s) {
  const z = view.z, t = view.frame / 60;
  if (s.state === 'founding') {
    // the dealate queen digging her first chamber: a little crater, soil flicked out, her shed wings beside it
    const R = AL.rng(s.id * 31 + 5), pr = 7 + s.found * 6;
    for (let k = 0; k < 10 + s.found * 26; k++) {
      const a = R() * TAU, d = pr + R() * (6 + s.found * 10), gx = s.x + Math.cos(a) * d, gy = s.y + Math.sin(a) * d;
      ctx.fillStyle = (gx - s.x + gy - s.y) < 0 ? 'rgba(190,150,100,0.85)' : 'rgba(110,78,45,0.85)';
      ctx.beginPath(); ctx.arc(gx, gy, 0.9 + R() * 1.4, 0, TAU); ctx.fill();
    }
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, pr);
    g.addColorStop(0, 'rgba(20,12,6,0.95)'); g.addColorStop(0.7, 'rgba(60,40,20,0.7)'); g.addColorStop(1, 'rgba(90,60,30,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, pr, 0, TAU); ctx.fill();
    // shed wings lying on the grass
    for (let k = 0; k < 4; k++) { ctx.save(); ctx.translate(s.x + 16 + (k % 2) * 5, s.y + 8 + (k >> 1) * 4); ctx.rotate(0.4 + k * 0.5); ctx.globalAlpha = 0.85; wingShape(ctx, k < 2 ? 9 : 7, 3); ctx.restore(); }
    ctx.globalAlpha = 1;
    // the queen herself, head-down at the pit's rim, wiggling as she digs
    const wig = Math.sin(t * 9 + s.id) * 0.25, qa = Math.PI * 0.75 + wig;
    spriteShadow(ctx, r, c.id, C.QUEEN, s.x - Math.cos(qa) * (pr + 4) + 1.5, s.y - Math.sin(qa) * (pr + 4) + 2, qa, 0.72, 0.6);
    sprite(ctx, r, c.id, C.QUEEN, (t * 6 | 0), s.x - Math.cos(qa) * (pr + 4), s.y - Math.sin(qa) * (pr + 4), qa, 0.72);
    if (Math.random() < 0.25) puff(rs(world), 'clod', s.x, s.y, 1, { speed: 40, life: 0.6, size: 1.6, col: '#7a5534' });
    // progress ring
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,14,8,0.45)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 30, 0, TAU); ctx.stroke();
    ctx.strokeStyle = team(c.id); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(s.x, s.y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * s.found); ctx.stroke();
    ctx.lineCap = 'butt';
    return;
  }
  if (s.state === 'ruin') {
    const k = Math.min(1, s.ruinT / 30), R = AL.rng(s.id * 13 + 1), rr = s.moundR || 16;
    ctx.globalAlpha = 0.75 * k;
    for (let n = 0; n < 40; n++) { const a = R() * TAU, d = Math.sqrt(R()) * rr * 1.3; ctx.fillStyle = n % 3 ? '#6b4c2e' : '#3e2b18'; ctx.beginPath(); ctx.ellipse(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 1.5 + R() * 3, 1.2 + R() * 2, R() * 3, 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(15,10,5,0.7)'; ctx.beginPath(); ctx.ellipse(s.x, s.y, rr * 0.35, rr * 0.25, 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(20,12,6,0.6)'; ctx.lineWidth = 1;
    for (let n = 0; n < 5; n++) { const a = R() * TAU; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(a) * rr, s.y + Math.sin(a) * rr * 0.9); ctx.stroke(); }
    ctx.globalAlpha = 1;
    return;
  }
  const m = r.moundCanvas({ id: 1000 + s.id, moundR: s.moundR });
  if (s.state === 'orphan') ctx.globalAlpha = 0.6 + 0.4 * Math.max(0, s.hp / s.maxHp);
  ctx.drawImage(m.cv, s.x - m.off, s.y - m.off, m.size, m.size);
  ctx.globalAlpha = 1;
  // ring in the colony's colour so a satellite reads as "ours" at a glance
  ctx.strokeStyle = rgba(team(c.id), s.state === 'orphan' ? 0.35 : 0.6); ctx.lineWidth = Math.max(1.2, 1.6 / Math.min(1, z));
  ctx.setLineDash(s.state === 'orphan' ? [4, 6] : []);
  ctx.beginPath(); ctx.arc(s.x, s.y, s.moundR + 6, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
}
function drawPerched(ctx, view, r, c) {
  const n = c.royal.queens + c.royal.males; if (!n || view.z < 0.7) return;
  const t = view.frame / 60;
  for (let k = 0; k < Math.min(6, n); k++) {
    const male = k >= c.royal.queens, a = -2.2 + k * 0.85, d = c.moundR * 0.52;
    const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d, h = a + Math.PI + Math.sin(t * 1.3 + k) * 0.3;
    // nuptial shimmer under a waiting queen
    if (!male) { ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 3 + k); ctx.drawImage(rs(r.world).glow, x - 14, y - 14, 28, 28); ctx.globalAlpha = 1; }
    spriteShadow(ctx, r, c.id, C.WINGED, x + 1.5, y + 2, h, male ? 0.75 : 1, 0.7);
    sprite(ctx, r, c.id, C.WINGED, 0, x, y, h, male ? 0.75 : 1);
    // a wing flick now and then
    const fl = Math.max(0, Math.sin(t * 2.1 + k * 1.7) - 0.85) * 6;
    if (fl > 0) for (const side of [-1, 1]) { ctx.save(); ctx.translate(x, y); ctx.rotate(h + Math.PI + side * (0.25 + fl * 0.3)); wingShape(ctx, male ? 6 : 8, 2.6); ctx.restore(); }
  }
}
function drawPointRing(ctx, view, world, p, V) {
  const z = view.z, t = view.frame / 60, active = world.t >= V.activeAt;
  if (!inView(view, p.x, p.y, p.r + 30)) return;
  const lw = Math.max(4, 3 / z);
  if (!active) {
    ctx.strokeStyle = 'rgba(240,230,210,0.35)'; ctx.lineWidth = lw * 0.5; ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  if (p.owner >= 0) {
    const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.2, p.x, p.y, p.r);
    g.addColorStop(0, rgba(team(p.owner), 0.02)); g.addColorStop(1, rgba(team(p.owner), 0.22));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  // track + capture arc
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(20,14,8,0.5)'; ctx.lineWidth = lw + 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 8, 0, TAU); ctx.stroke();
  const who = p.owner >= 0 ? p.owner : p.capper;
  if (who >= 0 && p.prog > 0) {
    ctx.strokeStyle = team(who); ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 8, -Math.PI / 2, -Math.PI / 2 + TAU * p.prog); ctx.stroke();
    if (p.owner >= 0) {
      // owned: bright dashes chase around the ring
      ctx.strokeStyle = 'rgba(255,250,230,0.5)'; ctx.lineWidth = lw * 0.35; ctx.setLineDash([3, 22]); ctx.lineDashOffset = -t * 30;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  if (p.contested) {
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.35 * Math.sin(t * 10)) + ')'; ctx.lineWidth = lw * 0.5; ctx.setLineDash([8, 10]); ctx.lineDashOffset = t * 40;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r - 1, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.lineCap = 'butt';
}
function drawUnder(ctx, view, r) {
  const world = r.world; if (!world.exp) return;
  for (const c of world.colonies) {
    for (const s of c.satellites) if (inView(view, s.x, s.y, 60) && seen(world, s.x, s.y, c.id)) drawSatellite(ctx, view, r, world, c, s);
  }
  const V = world.victory;
  if (V) for (const p of V.points) drawPointRing(ctx, view, world, p, V);
}

// ---- over ants: flights, tunnels, badges, labels, preview, particles ------------------------------
function drawFlights(ctx, view, r, world) {
  const a = view.alpha || 0, z = view.z, S = rs(world);
  for (const f of world.exp.flights) {
    const x = f.px + (f.x - f.px) * a, y = f.py + (f.y - f.py) * a, alt = f.palt + (f.alt - f.palt) * a, t = f.pt + (f.t - f.pt) * a;
    if (!visible(world, x, y, f.col)) continue;
    if (!inView(view, x, y, 120)) continue;
    const boost = Math.max(1, 20 / (15 * z));
    // the moment she lifts off: a ring of dust blown off the mound and a swirl of golden motes
    if (f.phase !== f._fx) {
      if (f.phase === 'takeoff') {
        puff(S, 'ring', x, y, 1, { speed: 0, life: 1.0, size: 80, col: '#e9d3a0' });
        for (let k = 0; k < 22; k++) { const a0 = k / 22 * TAU; puff(S, 'dust', x + Math.cos(a0) * 10, y + Math.sin(a0) * 10, 1, { a0, spread: 0.3, speed: 70, life: 1.3, size: 8 }); }
        puff(S, 'mote', x, y, 26, { speed: 45, life: 1.6, size: 2.2, col: team(f.col) });
      }
      f._fx = f.phase;
    }
    if (f.phase === 'emerge') { ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 12); ctx.drawImage(S.glow, x - 26, y - 26, 52, 52); ctx.globalAlpha = 1; }
    if (f.phase === 'takeoff' && Math.random() < 0.6) puff(S, 'dust', x, y, 1, { speed: 30, life: 1, size: 7 });
    // a fading golden ribbon behind her
    let tr = S.trails.get(f.id); if (!tr) { tr = []; S.trails.set(f.id, tr); }
    if (f.phase !== 'emerge' && (!tr.length || AL.dist2(tr[tr.length - 1].x, tr[tr.length - 1].y, x, y) > 36)) { tr.push({ x, y, t: view.frame }); if (tr.length > 40) tr.shift(); }
    if (tr.length > 1) {
      ctx.lineCap = 'round';
      for (let k = 1; k < tr.length; k++) {
        const u = k / tr.length; ctx.strokeStyle = 'rgba(255,230,160,' + (u * 0.45) + ')'; ctx.lineWidth = Math.max(1, 2.4 / z) * u * boost;
        ctx.beginPath(); ctx.moveTo(tr[k - 1].x, tr[k - 1].y); ctx.lineTo(tr[k].x, tr[k].y); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    if (f.phase === 'cruise' && Math.random() < 0.5) puff(S, 'mote', x, y, 1, { speed: 8, life: 1.2, size: 1.8 * boost, col: '#ffe6a0' });
    // escorting males circle her
    for (let k = 0; k < f.males; k++) {
      const ang = t * 2.6 + k * Math.PI, rr = (26 + 6 * Math.sin(t * 2 + k)) * boost * (0.35 + alt * 0.65);
      const mx = x + Math.cos(ang) * rr, my = y + Math.sin(ang) * rr;
      drawFlyer(ctx, r, f.col, mx, my, ang + Math.PI / 2, Math.max(0.15, alt), 0.72 * boost, t + k, true);
    }
    drawFlyer(ctx, r, f.col, x, y, f.a, alt, boost, t, false);
  }
  if (S.trails.size > world.exp.flights.length) for (const id of S.trails.keys()) if (!world.exp.flights.some(f => f.id === id)) S.trails.delete(id);
}
function drawTunnels(ctx, view, r, world) {
  const z = view.z, t = view.frame / 60;
  for (const tn of world.exp.tunnels) {
    if (tn.state !== 'dig') continue;
    const mine = tn.col === AL.me(), aimedAtMe = tn.tcol === AL.me() && tn.warned;
    if (!mine && !aimedAtMe) continue;
    const hx = AL.lerp(tn.x0, tn.x1, tn.prog), hy = AL.lerp(tn.y0, tn.y1, tn.prog);
    if (mine) {
      // dug part: a dark seam under the lawn; the rest: a faint dotted plan line
      ctx.lineCap = 'round';
      // dug part: soil pushed up along the tunnel (crumbs on the lawn); the rest: a faint plan line
      const L = Math.hypot(hx - tn.x0, hy - tn.y0), ux = (tn.x1 - tn.x0) / tn.len, uy = (tn.y1 - tn.y0) / tn.len, R = AL.rng(tn.id * 31 + 7);
      const step = Math.max(7, 5 / z);
      for (let d = 0; d < L; d += step) {
        const j = (R() - 0.5) * 5, s0 = 1.4 + R() * 1.6, px = tn.x0 + ux * d - uy * j, py = tn.y0 + uy * d + ux * j;
        ctx.fillStyle = 'rgba(20,12,5,0.25)'; ctx.beginPath(); ctx.arc(px + 1, py + 1.4, s0, 0, TAU); ctx.fill();
        ctx.fillStyle = R() < 0.5 ? '#7a5534' : '#5e412a'; ctx.beginPath(); ctx.ellipse(px, py, s0, s0 * 0.8, R() * 3, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = rgba(team(0), 0.4); ctx.lineWidth = Math.max(1.5, 1.3 / z); ctx.setLineDash([2, 10]); ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(tn.x1, tn.y1); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      // the dig head: a heaving bump of soil
      const bump = 1 + 0.15 * Math.sin(t * 8);
      ctx.fillStyle = 'rgba(20,12,5,0.3)'; ctx.beginPath(); ctx.ellipse(hx + 2, hy + 3, 9 * bump, 7 * bump, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#8d6a42'; ctx.beginPath(); ctx.ellipse(hx, hy, 8 * bump, 6 * bump, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#b48a5a'; ctx.beginPath(); ctx.ellipse(hx - 2, hy - 2, 4 * bump, 3 * bump, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = team(0); ctx.lineWidth = Math.max(1.5, 1.5 / z); ctx.beginPath(); ctx.arc(hx, hy, 14 + 3 * Math.sin(t * 4), 0, TAU); ctx.stroke();
      if (Math.random() < 0.15) puff(rs(world), 'clod', hx, hy, 1, { speed: 25, life: 0.5, size: 1.5, col: '#6a4a2c' });
    }
    if (aimedAtMe) {
      // tremors under your nest: cracks and pulsing dust rings
      const k = (t * 1.6) % 1;
      ctx.strokeStyle = 'rgba(255,120,70,' + (0.6 * (1 - k)) + ')'; ctx.lineWidth = Math.max(2, 2 / z);
      ctx.beginPath(); ctx.arc(tn.x1, tn.y1, 30 + k * 60, 0, TAU); ctx.stroke();
      const R = AL.rng(tn.id * 7 + 1); ctx.strokeStyle = 'rgba(30,18,8,0.65)'; ctx.lineWidth = 1.2;
      for (let n = 0; n < 6; n++) { const a = R() * TAU, d0 = 22 + R() * 10; ctx.beginPath(); ctx.moveTo(tn.x1 + Math.cos(a) * d0, tn.y1 + Math.sin(a) * d0); ctx.lineTo(tn.x1 + Math.cos(a + 0.15) * (d0 + 14), tn.y1 + Math.sin(a + 0.15) * (d0 + 14)); ctx.lineTo(tn.x1 + Math.cos(a - 0.05) * (d0 + 26 * tn.prog), tn.y1 + Math.sin(a - 0.05) * (d0 + 26 * tn.prog)); ctx.stroke(); }
    }
  }
}
// map badge above a nest: team disc with a crown (queen alive) or hollow crown, and an hp arc
function badge(ctx, view, x, y, colId, queen, hpFrac, attacked, kind) {
  const z = view.z, s = Math.max(6, 9 / z), t = view.frame / 60;
  if (attacked) { ctx.strokeStyle = 'rgba(255,80,50,' + (0.5 + 0.5 * Math.sin(t * 12)) + ')'; ctx.lineWidth = s * 0.35; ctx.beginPath(); ctx.arc(x, y, s * 1.7, 0, TAU); ctx.stroke(); }
  ctx.fillStyle = 'rgba(20,14,8,0.4)'; ctx.beginPath(); ctx.arc(x + s * 0.15, y + s * 0.25, s * 1.15, 0, TAU); ctx.fill();
  ctx.fillStyle = kind === 'orphan' ? '#3a3026' : team(colId); ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,10,0.9)'; ctx.lineWidth = s * 0.16; ctx.stroke();
  drawCrown(ctx, x, y + s * 0.08, s * 0.52, kind === 'orphan' ? 'rgba(230,220,200,0.6)' : '#2a1a0c', queen);
  if (hpFrac < 0.999) {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = s * 0.3; ctx.beginPath(); ctx.arc(x, y, s * 1.35, 0, TAU); ctx.stroke();
    ctx.strokeStyle = hpFrac > 0.5 ? '#9be36a' : hpFrac > 0.25 ? '#f2c14e' : '#ff5a3a';
    ctx.beginPath(); ctx.arc(x, y, s * 1.35, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, hpFrac)); ctx.stroke();
  }
}
function label(ctx, view, x, y, text, sub, col) {
  const z = view.z, px = 12 * (view.dpr || 1) / z;
  ctx.font = '600 ' + px + 'px system-ui, "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width, sw = sub ? (ctx.font = '500 ' + px * 0.85 + 'px system-ui, sans-serif', ctx.measureText(sub).width) : 0;
  const W = Math.max(w + px * 1.6, sw + px * 1.2), H = px * (sub ? 2.5 : 1.6);
  ctx.fillStyle = 'rgba(24,17,11,0.82)'; ctx.strokeStyle = 'rgba(214,170,110,0.35)'; ctx.lineWidth = px * 0.08;
  ctx.beginPath(); ctx.roundRect(x - W / 2, y - H, W, H, px * 0.5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col || '#f3e9d2'; ctx.beginPath(); ctx.arc(x - w / 2 - px * 0.25, y - H + px * 0.8, px * 0.28, 0, TAU); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '600 ' + px + 'px system-ui, "Segoe UI", sans-serif'; ctx.fillStyle = '#f3e9d2'; ctx.fillText(text, x + px * 0.2, y - H + px * 0.82);
  if (sub) { ctx.font = '500 ' + px * 0.85 + 'px system-ui, sans-serif'; ctx.fillStyle = '#bfae8f'; ctx.fillText(sub, x, y - H + px * 1.85); }
}
function drawMarkers(ctx, view, world) {
  const z = view.z;
  for (const c of world.colonies) {
    if (!c.out && seen(world, c.x, c.y, c.id) && inView(view, c.x, c.y, 60) && (z < 1.2 || c.underAttack > 0 || c.mainHp < c.mainMaxHp)) {
      badge(ctx, view, c.x, c.y - c.moundR - Math.max(10, 14 / z), c.id, c.queen.alive, c.mainHp / c.mainMaxHp, c.underAttack > 0, 'main');
    }
    for (const s of c.satellites) {
      if (s.state === 'ruin' || s.state === 'founding' || !seen(world, s.x, s.y, c.id) || !inView(view, s.x, s.y, 60)) continue;
      badge(ctx, view, s.x, s.y - s.moundR - Math.max(8, 12 / z), c.id, !!(s.queen && s.queen.alive), s.hp / s.maxHp, s.underAttack > 0, s.state);
    }
  }
  const V = world.victory;
  if (V) for (const p of V.points) {
    if (!inView(view, p.x, p.y, p.r + 60)) continue;
    const active = world.t >= V.activeAt;
    const who = p.owner >= 0 ? p.owner : -1;
    const sub = !active ? 'wakes in ' + AL.Victory.clock(V.activeAt - world.t) : p.contested ? 'contested' : p.owner >= 0 ? (p.owner === AL.me() ? 'yours' : 'held by rival') : p.capper >= 0 && p.prog > 0 ? Math.round(p.prog * 100) + '% ' + (p.capper === 0 ? 'yours' : 'rival') : 'key point';
    label(ctx, view, p.x, p.y - p.r - 6 / z, p.name, sub, who >= 0 ? team(who) : 'rgba(240,230,210,0.6)');
  }
}
function drawPreview(ctx, view, world) {
  const U = AL.ExpansionUI, P = U && U.preview; if (!P) return;
  const z = view.z, t = view.frame / 60, c = world.player, ok = P.ok, col = ok ? '#9be36a' : '#ff6a4a';
  ctx.lineWidth = Math.max(1.5, 2 / z);
  if (P.kind === 'flight') {
    const dx = P.x - c.x, dy = P.y - c.y, d = Math.hypot(dx, dy) || 1, cx = (c.x + P.x) / 2 - dy * 0.18, cy = (c.y + P.y) / 2 + dx * 0.18;
    ctx.strokeStyle = rgba(team(0), 0.7); ctx.setLineDash([8, 10]); ctx.lineDashOffset = -t * 30;
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.quadraticCurveTo(cx, cy, P.x, P.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(P.x, P.y, 26 + Math.sin(t * 5) * 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(P.x, P.y, X.CFG.sat.minGap, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    label(ctx, view, P.x, P.y - 34, ok ? 'Found a satellite here' : 'Can\'t land here', ok ? Math.round(d) + ' units away' : P.why, col);
  } else if (P.kind === 'tunnel') {
    if (P.target) {
      ctx.strokeStyle = col; ctx.setLineDash([4, 8]); ctx.beginPath(); ctx.moveTo(P.from.x, P.from.y); ctx.lineTo(P.target.x, P.target.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(P.target.x, P.target.y, 40 + Math.sin(t * 6) * 3, 0, TAU); ctx.stroke();
      label(ctx, view, P.target.x, P.target.y - 46, ok ? 'Dig a raid tunnel' : 'Can\'t tunnel', ok ? 'about ' + AL.Victory.clock(P.eta) + ' to break through' : P.why, col);
    } else label(ctx, view, P.x, P.y - 12, 'Pick a rival nest', 'click its mound', '#ff6a4a');
  } else if (P.kind === 'rally') {
    ctx.strokeStyle = rgba(team(0), 0.9); ctx.setLineDash([5, 6]); ctx.lineDashOffset = t * 20; ctx.beginPath(); ctx.arc(P.x, P.y, P.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, view, P.x, P.y - P.r - 6, 'Rally ' + P.n + ' ants here', 'fighters first, for 90 s', team(0));
  }
}
function drawOver(ctx, view, r) {
  const world = r.world; if (!world.exp) return;
  const S = rs(world);
  drawTunnels(ctx, view, r, world);
  for (const c of world.colonies) if (!c.out && inView(view, c.x, c.y, 60) && visible(world, c.x, c.y, c.id)) drawPerched(ctx, view, r, c);
  drawFlights(ctx, view, r, world);
  updateFx(S, ctx, view.z);
  drawMarkers(ctx, view, world);
  drawPreview(ctx, view, world);
}

// ---- nest view: a rival raid tunnel creeping toward the royal chamber, then the breach ----------------
function drawNestOver(ctx, view, r) {
  const world = r.world; if (!world.exp || !world.nest || r.nestCol) return;   // (your own nest only)
  const nest = world.nest, T = nest.tile, cols = nest.cols, t = view.frame / 60, z = view.z;
  const ctr = i => [((i % cols) + 0.5) * T, (((i / cols) | 0) + 0.5) * T];
  for (const tn of world.exp.tunnels) {
    if (tn.tcol !== AL.me()) continue;
    if (tn.state === 'dig' && tn.plan && tn.plan.length > 1) {
      // tremors: hairline cracks run ahead of the diggers through the soil
      const W = X.CFG.tunnel.warnAt, u = AL.clamp((tn.prog - W) / (1 - W), 0, 1), n = Math.max(1, Math.round(tn.plan.length * u));
      const R = AL.rng(tn.id * 17 + 3);
      const pts = []; for (let k = 0; k < n; k++) { const [x, y] = ctr(tn.plan[k]); pts.push(x + (R() - 0.5) * T * 0.7, y + (R() - 0.5) * T * 0.7); }
      const crack = (col, w) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); for (let k = 0; k < pts.length; k += 2) { if (k) ctx.lineTo(pts[k], pts[k + 1]); else ctx.moveTo(pts[k], pts[k + 1]); } ctx.stroke(); };
      ctx.lineJoin = 'round';
      crack('rgba(255,140,80,' + (0.25 + 0.15 * Math.sin(t * 6)) + ')', Math.max(2.4, 3.2 / z * (view.dpr || 1)));   // a hot glow along the crack
      crack('rgba(15,8,3,0.9)', Math.max(0.9, 1.3 / z * (view.dpr || 1)));
      const [hx, hy] = ctr(tn.plan[n - 1]), k2 = (t * 1.8) % 1;
      ctx.strokeStyle = 'rgba(255,120,70,' + (0.8 * (1 - k2)) + ')'; ctx.lineWidth = Math.max(1, 1.6 / z * (view.dpr || 1));
      ctx.beginPath(); ctx.arc(hx, hy, 4 + k2 * 16, 0, TAU); ctx.stroke();
      // where it will come out: the royal chamber, marked
      const [qx, qy] = ctr(tn.plan[tn.plan.length - 1]);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,120,70,0.55)'; ctx.beginPath(); ctx.arc(qx, qy, 14 + Math.sin(t * 5) * 2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (tn.state === 'done' && tn.breachPath) {
      const age = world.t - (tn.tDone || world.t);
      if (age > 45) continue;
      const a = 1 - age / 45;
      ctx.strokeStyle = 'rgba(255,110,60,' + (0.55 * a) + ')'; ctx.lineWidth = Math.max(0.8, 1 / z * (view.dpr || 1));
      for (const i of tn.breachPath) { const [x, y] = ctr(i); ctx.strokeRect(x - T / 2 + 0.5, y - T / 2 + 0.5, T - 1, T - 1); }
      if (age < 8) { const [bx, by] = ctr(tn.breachPath[0]), u = age / 8; ctx.strokeStyle = 'rgba(255,160,90,' + (1 - u) + ')'; ctx.lineWidth = 3 * (1 - u) + 0.5; ctx.beginPath(); ctx.arc(bx, by, 6 + u * 40, 0, TAU); ctx.stroke(); }
    }
  }
}

const sys = AL.SYSTEMS.find(s => s.id === 'expansion');
if (sys) sys.render = Object.assign(sys.render || {}, { ground: drawGround, underAnts: drawUnder, overAnts: drawOver, nestOver: drawNestOver });

AL.ExpansionArt = { drawCrown, wingShape, drawFlyer, sprite, team, rgba, rs, puff };
})(window);
