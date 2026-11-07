// Antlands World stage rendering: plugs into the core render layers (CONTRACT section 6).
//   ground     picnic blanket, mowed stripes, sprinkler wet patches, shoe prints, wet ground, frost/snow cover, rain ripples
//   underAnts  termite mounds, cocoons, aphid herds, sprinkler heads, spider webs
//   overAnts   spider, beetle, ladybug, caterpillar (scaled up a little when zoomed out so they stay readable)
//   weather    flying critters, shoe shadows and stomps, lawnmower, sprinkler spray, robin shadow + dive, cloud shadows
//   grade      night (darker, cooler), dusk warmth, overcast, heat, winter desaturation; mound glow, fireflies, eyeshine
//   fog        fog of war (eased), scent wisps at its edge
//   screen     heat shimmer, rain streaks, snow, lightning, off-screen bird warning
// Plus a season-clock widget (AL.UI.addWidget) and toasts for world events. Browser only.
(function (root) {
'use strict';
const AL = root.AL, Art = AL.Art, WA = AL.WorldArt, TAU = Math.PI * 2, PI = Math.PI;

// ---- per renderer state ---------------------------------------------------------------------------
const STATE = new WeakMap();
function st(r) {
  let s = STATE.get(r);
  if (!s) {
    s = { frame: -1, last: 0, dt: 1 / 60, t: 0, world: null,
      rain: new Float32Array(700 * 3), nRain: 0, snow: new Float32Array(420 * 4), nSnow: 0, rip: new Float32Array(240 * 4), nRip: 0,
      cloud: null, frost: null, cloudPat: null, frostPat: null, fogCv: null, fogImg: null, fogA: null,
      glow: Art.softDot(32, '255,190,110'), fly: Art.softDot(16, '225,255,150'), eye: Art.softDot(16, '170,255,190'), mist: Art.softDot(24, '235,225,205'), sprFade: 0 };
    STATE.set(r, s);
  }
  return s;
}
function frameTick(s, v, r) {
  if (s.frame === v.frame) return;
  const now = performance.now();
  s.dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 1 / 60; s.last = now; s.t += s.dt; s.frame = v.frame;
  if (s.world !== r.world) { s.world = r.world; s.fogCv = null; s.nRip = 0; }
}

// ---- periodic noise tiles (clouds, frost) -----------------------------------------------------------
function pnoise(x, y, p, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), m = k => ((k % p) + p) % p;
  const a = AL.hash2(m(xi), m(yi), seed), b = AL.hash2(m(xi + 1), m(yi), seed), c = AL.hash2(m(xi), m(yi + 1), seed), d = AL.hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function pfbm(x, y, p, seed) { let s = 0, amp = 0.5, n = 0; for (let o = 0; o < 4; o++) { s += amp * pnoise(x, y, p, seed + o * 17); n += amp; amp *= 0.5; x *= 2; y *= 2; p *= 2; } return s / n; }
function tile(size, period, seed, px) {
  const c = Art.canvas(size, size), x = c.getContext('2d'), img = x.createImageData(size, size), d = img.data;
  for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) { const v = pfbm(xx / size * period, yy / size * period, period, seed), i = (yy * size + xx) * 4; px(v, d, i, xx, yy); }
  x.putImageData(img, 0, 0);
  return c;
}
const ss = (a, b, v) => { const t = AL.clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function patterns(s, ctx) {
  if (!s.cloud) {
    s.cloud = tile(192, 4, 811, (v, d, i) => { d[i] = 18; d[i + 1] = 26; d[i + 2] = 38; d[i + 3] = ss(0.44, 0.72, v) * 255; });
    s.frost = tile(192, 8, 377, (v, d, i, x, y) => { const sp = AL.hash2(x, y, 5) > 0.93 ? 1 : 0; d[i] = 236; d[i + 1] = 244; d[i + 2] = 250; d[i + 3] = Math.min(255, (0.35 + 0.65 * ss(0.38, 0.7, v)) * 200 + sp * 55); });
  }
  if (!s.cloudPat) { s.cloudPat = ctx.createPattern(s.cloud, 'repeat'); s.frostPat = ctx.createPattern(s.frost, 'repeat'); }
}
function fillPattern(ctx, v, pat, scale, ox, oy) {
  if (pat.setTransform) pat.setTransform(new DOMMatrix([scale, 0, 0, scale, ox, oy]));
  ctx.fillStyle = pat; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
}
const inView = (v, x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
const canSee = (w, x, y) => !w.fog || w.fog.visibleAt(x, y);
const zoomOf = v => v.z / (v.dpr || 1);

// ---- layers --------------------------------------------------------------------------------------------
function ground(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const e = w.env, P = w.poi, PT = AL.POI_TUNE;
  if (P && P.blanket) WA.drawBlanket(ctx, P.blanket);
  if (P && P.human) {
    const M = P.human.mower, S = w.surface;
    // freshly mowed stripes (lighter, fading over a couple of minutes)
    for (const sp of M.stripes) { ctx.fillStyle = 'rgba(214,236,150,' + (0.13 * (1 - sp.age / 150)) + ')'; ctx.fillRect(0, sp.y - PT.MOWER_W / 2, S.W, PT.MOWER_W); }
    if (M.state === 'mow') { const x0 = M.dir > 0 ? 0 : M.x, x1 = M.dir > 0 ? M.x : S.W; ctx.fillStyle = 'rgba(214,236,150,0.14)'; ctx.fillRect(x0, M.y - PT.MOWER_W / 2, x1 - x0, PT.MOWER_W); }
    // sprinkler wet patches
    s.sprFade = AL.clamp(s.sprFade + (P.human.sprink.on ? 1 : -0.08) * s.dt, 0, 1);
    if (s.sprFade > 0.01) for (const sp of P.sprinklers) {
      if (!inView(v, sp.x, sp.y, sp.r)) continue;
      const g = ctx.createRadialGradient(sp.x, sp.y, 10, sp.x, sp.y, sp.r);
      g.addColorStop(0, 'rgba(30,60,80,' + 0.22 * s.sprFade + ')'); g.addColorStop(0.85, 'rgba(30,60,80,' + 0.12 * s.sprFade + ')'); g.addColorStop(1, 'rgba(30,60,80,0)');
      ctx.fillStyle = g; ctx.fillRect(sp.x - sp.r, sp.y - sp.r, sp.r * 2, sp.r * 2);
    }
    // shoe prints in the grass
    for (const f of P.human.steps) if (f.stomped && inView(v, f.x, f.y, 60)) WA.drawImprint(ctx, f, 1 - (f.t - PT.STEP_TELE) / 14);
  }
  if (e.wet > 0.02) { ctx.fillStyle = 'rgba(16,30,40,' + (e.wet * 0.14) + ')'; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0); }
  if (e.frost > 0.01) {
    patterns(s, ctx);
    ctx.globalAlpha = e.frost * 0.8; fillPattern(ctx, v, s.frostPat, 1.6, 0, 0);
    ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(225,236,245,' + e.frost * 0.2 + ')'; ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
  }
  // rain ripples on open ground (shelters stay dry)
  const rain = e.rain;
  if (rain > 0.02) {
    const area = (v.x1 - v.x0) * (v.y1 - v.y0), want = Math.min(240, rain * 220 * area / 700000);
    const R = s.rip;
    let n = s.nRip;
    const spawn = want * s.dt * 2.2;
    for (let k = 0; k < spawn && n < 240; k++) {
      const x = AL.lerp(v.x0, v.x1, Math.random()), y = AL.lerp(v.y0, v.y1, Math.random());
      if (AL.World.shadeAt(w, x, y) === 2) continue;
      R[n * 4] = x; R[n * 4 + 1] = y; R[n * 4 + 2] = 0; R[n * 4 + 3] = 0.45 + Math.random() * 0.4; n++;
    }
    s.nRip = n;
  }
  if (s.nRip) {
    const R = s.rip; let n = s.nRip;
    ctx.lineWidth = 0.7; ctx.strokeStyle = 'rgba(220,236,255,0.5)';
    for (let k = n - 1; k >= 0; k--) {
      R[k * 4 + 2] += s.dt;
      const age = R[k * 4 + 2] / R[k * 4 + 3];
      if (age >= 1) { n--; for (let q = 0; q < 4; q++) R[k * 4 + q] = R[n * 4 + q]; continue; }
      ctx.globalAlpha = (1 - age) * 0.8;
      ctx.beginPath(); ctx.ellipse(R[k * 4], R[k * 4 + 1], 1 + age * 6, 0.7 + age * 4.2, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1; s.nRip = n;
  }
}

function underAnts(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const L = w.surface.creatures || [], fog = w.fog;
  // spider webs: a silk funnel at each lair
  if (w.creatures) for (const l of w.creatures.lairs) {
    if (l.type !== 'spider' || !inView(v, l.x, l.y, 40) || (fog && !fog.seenAt(l.x, l.y))) continue;
    ctx.strokeStyle = 'rgba(240,240,250,0.35)'; ctx.lineWidth = 0.5;
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU; ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x + Math.cos(a) * 26, l.y + Math.sin(a) * 22); ctx.stroke(); }
    for (let q = 1; q <= 3; q++) { ctx.beginPath(); ctx.ellipse(l.x, l.y, q * 8, q * 6.6, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = 'rgba(20,14,8,0.6)'; ctx.beginPath(); ctx.ellipse(l.x, l.y, 4, 3, 0, 0, TAU); ctx.fill();
  }
  for (const cr of L) {
    if ((!cr.alive && cr.state !== 'breached') || cr.hidden || !inView(v, cr.x, cr.y, 60)) continue;
    if (cr.type === 'termites') { if (!fog || fog.seenAt(cr.x, cr.y)) WA.drawTermiteMound(ctx, cr, s.t); }
    else if (cr.type === 'cocoon') { if (canSee(w, cr.x, cr.y)) WA.drawCocoon(ctx, cr.x, cr.y, cr.a, 1); }
    else if (cr.type === 'herd') {
      if (!canSee(w, cr.x, cr.y)) continue;
      const n = Math.min(14, cr.count);
      for (let k = 0; k < n; k++) {
        const a = k * 2.4 + Math.sin(s.t * 3 + k) * 0.2, d = 3 + (k % 4) * 2.3, x = cr.x + Math.cos(a) * d, y = cr.y + Math.sin(a) * d;
        ctx.fillStyle = 'rgba(20,30,10,0.25)'; ctx.beginPath(); ctx.ellipse(x + 0.8, y + 1.2, 2.5, 1.8, a, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c8e68a'; ctx.beginPath(); ctx.ellipse(x, y, 2.5, 1.8, cr.a, 0, TAU); ctx.fill();
      }
    }
  }
  if (w.poi) for (const sp of w.poi.sprinklers) if (inView(v, sp.x, sp.y, 20)) WA.drawSprinkler(ctx, sp, false, s.t);
}

// ecosystem young (eco.js): a ladybug larva (a little spiky grey-black crocodile with orange spots) and a spider's egg sac
function drawLarva(ctx, x, y, a, k, anim) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(k, k);
  const wig = Math.sin(anim * 0.8) * 0.12;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(0.6, 1, 4.6, 1.8, 0, 0, TAU); ctx.fill();
  for (let k2 = 0; k2 < 5; k2++) { const sx = 2.6 - k2 * 1.5, sw = 1.6 - Math.abs(k2 - 1.5) * 0.25; ctx.fillStyle = k2 === 0 ? '#2a2a2e' : '#3c3c44'; ctx.beginPath(); ctx.ellipse(sx, Math.sin(k2 + wig * 8) * 0.25, 1, sw, 0, 0, TAU); ctx.fill(); }
  ctx.fillStyle = '#e8892e'; ctx.beginPath(); ctx.arc(0.9, -0.8, 0.45, 0, TAU); ctx.arc(0.9, 0.8, 0.45, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#26262a'; ctx.lineWidth = 0.35;
  for (const s2 of [-1, 1]) for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(2.2 - j * 0.9, s2 * 0.9); ctx.lineTo(2.6 - j * 1.1, s2 * 2.1); ctx.stroke(); }
  ctx.restore();
}
function drawEggSac(ctx, x, y, t) {
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, 5, 3.5, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 5);
  g.addColorStop(0, '#fbf8ee'); g.addColorStop(1, '#cfc8b4');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 4.6, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.3;
  for (let k = 0; k < 4; k++) { const a = k * 0.8 + Math.sin(t * 0.3) * 0.05; ctx.beginPath(); ctx.ellipse(x, y, 4.6, 1.6, a, 0, TAU); ctx.stroke(); }
}
function overAnts(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const L = w.surface.creatures || [], a = v.alpha || 0;
  const big = Math.min(2.2, Math.max(1, 1.15 / zoomOf(v)));     // keep silhouettes readable from far away
  for (const cr of L) {
    if (!cr.alive || cr.hidden || cr.flying) continue;
    const x = cr.px + (cr.x - cr.px) * a, y = cr.py + (cr.y - cr.py) * a;
    if (!inView(v, x, y, 40) || !canSee(w, x, y)) continue;
    switch (cr.type) {
      case 'spider': WA.drawSpider(ctx, x, y, cr.a, big * (cr.scale || 1), cr.anim * 0.35, { lunge: cr.state === 'stalk' || cr.state === 'hunt' }); break;
      case 'lblarva': drawLarva(ctx, x, y, cr.a, big, cr.anim); break;
      case 'eggsac': drawEggSac(ctx, x, y, s.t); break;
      case 'beetle': WA.drawBeetle(ctx, x, y, cr.a, big * 0.95, cr.anim * 0.5, { angry: cr.attackers > 0 }); break;
      case 'ladybug': WA.drawLadybug(ctx, x, y, cr.a, Math.max(1, big * 0.9), s.t, 0); break;
      case 'caterpillar': WA.drawCaterpillar(ctx, x, y, cr.a, big * 0.95, cr.anim, { thrash: cr.state === 'thrash' }); break;
    }
  }
}

function weather(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const e = w.env, P = w.poi, PT = AL.POI_TUNE, L = w.surface.creatures || [], a = v.alpha || 0, lw = (v.dpr || 1) / v.z;
  // flying critters
  for (const cr of L) {
    if (!cr.alive || !cr.flying || cr.type === 'bird') continue;
    const x = cr.px + (cr.x - cr.px) * a, y = cr.py + (cr.y - cr.py) * a;
    if (!inView(v, x, y, 60) || (w.fog && !w.fog.seenAt(x, y))) continue;
    if (cr.type === 'ladybug') WA.drawLadybug(ctx, x, y, cr.a, 1.1, s.t, cr.alt || 1);
    else if (cr.type === 'butterfly') WA.drawButterfly(ctx, x, y, cr.a + PI / 2, cr.anim, cr.alt || 1);
  }
  if (P && P.human) {
    const H = P.human, M = H.mower;
    for (const f of H.steps) {
      if (!inView(v, f.x, f.y, 90)) continue;
      if (!f.stomped) WA.drawShoeShadow(ctx, f, AL.clamp(f.t / PT.STEP_TELE, 0, 1));
      else if (f.t - PT.STEP_TELE < 0.35) { ctx.globalAlpha = 1 - (f.t - PT.STEP_TELE) / 0.35; WA.drawShoe(ctx, f); ctx.globalAlpha = 1; }
    }
    if (M.state === 'warn' || M.state === 'mow') {
      const S = w.surface, pulse = 0.5 + 0.5 * Math.sin(s.t * 8);
      if (M.state === 'warn') {
        ctx.fillStyle = 'rgba(255,90,50,' + (0.06 + 0.07 * pulse) + ')'; ctx.fillRect(0, M.y - PT.MOWER_W / 2, S.W, PT.MOWER_W);
        ctx.strokeStyle = 'rgba(255,120,70,' + (0.4 + 0.3 * pulse) + ')'; ctx.lineWidth = 3 * lw; ctx.setLineDash([18 * lw, 12 * lw]);
        ctx.beginPath(); ctx.moveTo(0, M.y - PT.MOWER_W / 2); ctx.lineTo(S.W, M.y - PT.MOWER_W / 2); ctx.moveTo(0, M.y + PT.MOWER_W / 2); ctx.lineTo(S.W, M.y + PT.MOWER_W / 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,140,90,' + (0.35 + 0.3 * pulse) + ')';
        for (let x = (s.t * 60 * M.dir) % 220 - 220; x < S.W + 220; x += 220) {
          if (x < v.x0 - 60 || x > v.x1 + 60) continue;
          ctx.beginPath(); ctx.moveTo(x + 30 * M.dir, M.y); ctx.lineTo(x - 10 * M.dir, M.y - 30); ctx.lineTo(x, M.y); ctx.lineTo(x - 10 * M.dir, M.y + 30); ctx.closePath(); ctx.fill();
        }
      } else if (inView(v, M.x, M.y, 260)) WA.drawMower(ctx, M, s.t);
    }
    if (H.sprink.on) for (const sp of P.sprinklers) if (inView(v, sp.x, sp.y, sp.r)) WA.drawSprinkler(ctx, sp, true, s.t);
  }
  // the robin: warning ring at the target, a shadow that circles and closes in, then the dive
  const b = w.creatures && w.creatures.bird;
  if (b && b.alive) {
    const pulse = 0.5 + 0.5 * Math.sin(s.t * 10), R = b.def.strikeR;
    if (b.state !== 'leave') {
      const urgent = b.state === 'dive';
      ctx.fillStyle = 'rgba(255,70,40,' + (urgent ? 0.14 : 0.06) + ')'; ctx.beginPath(); ctx.arc(b.tx, b.ty, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,90,50,' + (0.45 + 0.4 * pulse) + ')'; ctx.lineWidth = 2.5 * lw; ctx.setLineDash([8 * lw, 6 * lw]);
      ctx.beginPath(); ctx.arc(b.tx, b.ty, R + (urgent ? 0 : 6 * pulse), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    WA.drawBirdShadow(ctx, b.x + 14 * b.alt, b.y + 20 * b.alt, b.a, 0.55 + b.alt * 0.75, 0.2 + 0.45 * (1 - b.alt));
    if ((b.state === 'dive' && b.st < 0.7) || (b.state === 'leave' && b.st > 1.2)) {
      const k = b.state === 'dive' ? 1 - b.st / 0.7 : (b.st - 1.2) / 1;
      ctx.globalAlpha = AL.clamp(k * 1.5, 0, 1);
      WA.drawBird(ctx, b.x - 50 * b.alt, b.y - 75 * b.alt, b.a, 0.85 + b.alt * 0.5, s.t * 14);
      ctx.globalAlpha = 1;
    }
    if (b.state === 'leave' && b.st > 1.5) {
      const k = (2.2 - b.st) / 0.7;
      ctx.strokeStyle = 'rgba(230,210,170,' + (1 - k) * 0.7 + ')'; ctx.lineWidth = 3 * lw; ctx.beginPath(); ctx.arc(b.tx, b.ty, R * (0.5 + k), 0, TAU); ctx.stroke();
    }
  }
  // soft cloud shadows drifting with the wind
  if (e.cloud > 0.06) {
    patterns(s, ctx);
    s.cx = (s.cx || 0) + (e.windX || 0.2) * 22 * s.dt; s.cy = (s.cy || 0) + (e.windY || 0.1) * 22 * s.dt;
    ctx.globalAlpha = Math.min(0.42, e.cloud * 0.36); fillPattern(ctx, v, s.cloudPat, 9, s.cx, s.cy);
    ctx.globalAlpha = Math.min(0.2, e.cloud * 0.18); fillPattern(ctx, v, s.cloudPat, 5.2, s.cx * 0.6 + 300, s.cy * 0.6 + 200);
    ctx.globalAlpha = 1;
  }
}

function grade(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const e = w.env, W = v.w, H = v.h, n = e.night || 0;
  const toS = (x, y) => [x * v.z + v.ox, y * v.z + v.oy];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // overcast and rain dim and cool everything
  const dim = Math.min(1, (e.cloud || 0) * 0.45 + (e.rain || 0) * 0.35 + (e.snow || 0) * 0.2);
  if (dim > 0.02) { ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = 'rgb(' + (255 - 70 * dim | 0) + ',' + (255 - 62 * dim | 0) + ',' + (255 - 42 * dim | 0) + ')'; ctx.fillRect(0, 0, W, H); }
  if (e.heat > 0.03) {
    ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(255,186,70,' + (e.heat * 0.42) + ')'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(255,238,200,' + (e.heat * 0.07) + ')'; ctx.fillRect(0, 0, W, H);
  }
  if (e.frost > 0.02) {
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,' + (e.frost * 0.55) + ')'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(170,200,232,' + (e.frost * 0.14) + ')'; ctx.fillRect(0, 0, W, H);
  }
  if (e.dusk > 0.02) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(255,128,56,' + (e.dusk * 0.5) + ')'; ctx.fillRect(0, 0, W, H); }
  if (n > 0.01) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(' + (255 - 150 * n | 0) + ',' + (255 - 138 * n | 0) + ',' + (255 - 98 * n | 0) + ')'; ctx.fillRect(0, 0, W, H);
    // light at night: the warm glow of mound entrances, fireflies on summer nights, spiders' eyeshine
    ctx.globalCompositeOperation = 'lighter';
    for (const c of w.colonies) {
      if (c.id !== AL.me() && w.fog && !w.fog.seenAt(c.x, c.y)) continue;
      const [x, y] = toS(c.x, c.y), rr = 90 * v.z;
      ctx.globalAlpha = 0.22 * n; ctx.drawImage(s.glow, x - rr, y - rr, rr * 2, rr * 2);
    }
    if (e.season === 'summer' && !e.rain) {
      const cell = 260, x0 = Math.floor(v.x0 / cell), x1 = Math.floor(v.x1 / cell), y0 = Math.floor(v.y0 / cell), y1 = Math.floor(v.y1 / cell);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const h = AL.hash2(cx, cy, 99); if (h < 0.35) continue;
        const wx = (cx + 0.5) * cell + Math.sin(s.t * 0.4 + h * 20) * 90, wy = (cy + 0.5) * cell + Math.cos(s.t * 0.33 + h * 31) * 70;
        const blink = Math.pow(Math.max(0, Math.sin(s.t * 1.7 + h * 40)), 6);
        if (blink < 0.02) continue;
        const [x, y] = toS(wx, wy), rr = Math.max(6, 14 * v.z);
        ctx.globalAlpha = blink * n; ctx.drawImage(s.fly, x - rr, y - rr, rr * 2, rr * 2);
      }
    }
    for (const cr of w.surface.creatures || []) {
      if (cr.type !== 'spider' || !cr.alive || cr.hidden || !inView(v, cr.x, cr.y, 30) || !canSee(w, cr.x, cr.y)) continue;
      const big = Math.min(2.2, Math.max(1, 1.15 / zoomOf(v)));
      for (const sd of [-1, 1]) {
        const ex = cr.x + (Math.cos(cr.a) * 5.4 - Math.sin(cr.a) * sd * 1.15) * big, ey = cr.y + (Math.sin(cr.a) * 5.4 + Math.cos(cr.a) * sd * 1.15) * big;
        const [x, y] = toS(ex, ey), rr = Math.max(3, 3.2 * v.z);
        ctx.globalAlpha = 0.9 * n; ctx.drawImage(s.eye, x - rr, y - rr, rr * 2, rr * 2);
      }
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
}

function scentColour(w, c) {
  if (c === 200) return '196,150,255';      // spider: danger
  if (c === 201) return '214,240,160';      // prey
  const col = w.colonies[c - 1];
  if (!col) return '255,120,90';
  const n = parseInt((col.colours.body || '#c4291b').slice(1), 16);
  return Math.min(255, (n >> 16) + 70) + ',' + Math.min(255, ((n >> 8) & 255) + 60) + ',' + Math.min(255, (n & 255) + 50);
}
function fog(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const F = w.fog, sc = w.scent, e = w.env;
  if (F && F.isWorldFog && F.own) {
    const n = F.w * F.h;
    if (!s.fogCv || s.fogCv.width !== F.w || s.fogCv.height !== F.h) {
      s.fogCv = Art.canvas(F.w, F.h); s.fogCtx = s.fogCv.getContext('2d'); s.fogImg = s.fogCtx.createImageData(F.w, F.h); s.fogA = new Float32Array(n);
      const d = s.fogImg.data; for (let i = 0; i < n; i++) { d[i * 4] = 13; d[i * 4 + 1] = 11; d[i * 4 + 2] = 9; s.fogA[i] = F.vis[i] ? 0 : 0.88; }
    }
    const d = s.fogImg.data, A = s.fogA, k = Math.min(1, s.dt * 4), fw = F.w, fh = F.h;
    // target darkness per cell, blurred 3x3 so the edge is a soft gradient instead of cell steps
    if (!s.fogT || s.fogT.length !== n) s.fogT = new Float32Array(n);
    const T = s.fogT;
    for (let i = 0; i < n; i++) T[i] = F.vis[i] ? 0 : F.seen[i] ? 0.46 : 0.84;
    for (let y = 0; y < fh; y++) {
      const up = (y > 0 ? y - 1 : y) * fw, row = y * fw, dn = (y < fh - 1 ? y + 1 : y) * fw;
      for (let x = 0; x < fw; x++) {
        const l = x > 0 ? x - 1 : x, rr = x < fw - 1 ? x + 1 : x;
        const tgt = (T[up + l] + T[up + x] + T[up + rr] + T[row + l] + T[row + x] * 2 + T[row + rr] + T[dn + l] + T[dn + x] + T[dn + rr]) / 10;
        const i = row + x;
        A[i] += (tgt - A[i]) * k; d[i * 4 + 3] = A[i] * 255;
      }
    }
    s.fogCtx.putImageData(s.fogImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s.fogCv, 0, 0, F.w * F.cell, F.h * F.cell);
  }
  // scent wisps where the colony smells what it can't see
  if (sc && sc.nh) {
    const lw = Math.max(0.9, 1.6 * (v.dpr || 1) / v.z + 0.6);
    ctx.lineCap = 'round';
    for (let k = 0; k < sc.nh; k++) {
      const h = sc.hints[k];
      if (!inView(v, h.x, h.y, 60)) continue;
      const rgb = scentColour(w, h.col), al = Math.min(0.7, 0.2 + h.s * 0.25);
      ctx.globalAlpha = al * 0.35; ctx.drawImage(s.mist, h.x - 20, h.y - 22, 40, 40);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(' + rgb + ',' + al + ')'; ctx.lineWidth = lw;
      for (let j = 0; j < 3; j++) {
        ctx.beginPath();
        for (let m = 0; m < 7; m++) {
          const px = h.x + (j - 1) * 9 + Math.sin(s.t * 1.6 + j * 2.1 + m * 0.9 + k) * 6 + (e.windX || 0) * m * 5;
          const py = h.y + 12 - m * 6.5 + Math.cos(s.t * 1.2 + j + m) * 2 + (e.windY || 0) * m * 4;
          if (m === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
  }
}

function screen(ctx, v, r) {
  const w = r.world, s = st(r); frameTick(s, v, r);
  const e = w.env, W = v.w, H = v.h, dpr = v.dpr || 1;
  // heat shimmer: thin bands of the frame nudged sideways
  if (e.heat > 0.2) {
    const bands = 12, bh = Math.max(2, (4 * dpr) | 0);
    for (let k = 0; k < bands; k++) {
      const y = ((k / bands) * H + s.t * 26 * dpr) % H | 0, dx = Math.sin(s.t * 2.3 + k * 1.9) * e.heat * 2.6 * dpr;
      ctx.drawImage(r.cv, 0, y, W, bh, dx, y, W, bh);
    }
  }
  // rain streaks
  const rain = e.rain || 0;
  if (rain > 0.02) {
    const count = Math.min(700, (110 + 560 * rain) | 0), A = s.rain, wind = (e.windX || 0) * 0.45;
    while (s.nRain < count) { const i = s.nRain++; A[i * 3] = Math.random() * W; A[i * 3 + 1] = Math.random() * H; A[i * 3 + 2] = 0.6 + Math.random() * 0.4; }
    const sp = 1500 * dpr * s.dt, len = (16 + 22 * rain) * dpr;
    ctx.strokeStyle = 'rgba(205,220,240,' + (0.22 + 0.2 * rain) + ')'; ctx.lineWidth = Math.max(1, dpr * 0.9);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      let x = A[i * 3], y = A[i * 3 + 1]; const k = A[i * 3 + 2];
      y += sp * k; x += wind * sp * k;
      if (y > H + len) { y -= H + len * 2; x = Math.random() * W; }
      if (x < 0) x += W; else if (x > W) x -= W;
      A[i * 3] = x; A[i * 3 + 1] = y;
      ctx.moveTo(x, y); ctx.lineTo(x - wind * len * k, y - len * k);
    }
    ctx.stroke();
  }
  // snow
  const snow = e.snow || 0;
  if (snow > 0.02) {
    const count = Math.min(420, (60 + 360 * snow) | 0), A = s.snow;
    while (s.nSnow < count) { const i = s.nSnow++; A[i * 4] = Math.random() * W; A[i * 4 + 1] = Math.random() * H; A[i * 4 + 2] = 1 + Math.random() * 2.2; A[i * 4 + 3] = Math.random() * 10; }
    ctx.fillStyle = 'rgba(250,252,255,' + (0.85 * Math.min(1, snow * 1.5)) + ')';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const sz = A[i * 4 + 2] * dpr;
      let x = A[i * 4], y = A[i * 4 + 1];
      y += (30 + sz * 22) * s.dt; x += (Math.sin(s.t * 1.3 + A[i * 4 + 3]) * 18 + (e.windX || 0) * 50) * s.dt * dpr;
      if (y > H + 4) { y = -4; x = Math.random() * W; } if (x < -4) x += W + 8; else if (x > W + 4) x -= W + 8;
      A[i * 4] = x; A[i * 4 + 1] = y;
      ctx.moveTo(x + sz, y); ctx.arc(x, y, sz, 0, TAU);
    }
    ctx.fill();
  }
  if (w.weather && w.weather.flash > 0.02) { ctx.fillStyle = 'rgba(235,240,255,' + (w.weather.flash * 0.45) + ')'; ctx.fillRect(0, 0, W, H); }
  // off-screen warning: the bird is after your ants somewhere you aren't looking
  const b = w.creatures && w.creatures.bird, wv = r.lastView || v;   // the screen layer's view has z=1, so use the world view
  if (b && b.alive && b.state !== 'leave' && b.col === AL.me() && (b.tx < wv.x0 || b.tx > wv.x1 || b.ty < wv.y0 || b.ty > wv.y1)) {
    const sx = b.tx * wv.z + wv.ox, sy = b.ty * wv.z + wv.oy, cx = W / 2, cy = H / 2, a = Math.atan2(sy - cy, sx - cx);
    const m = 34 * dpr, ex = AL.clamp(sx, m, W - m), ey = AL.clamp(sy, m, H - m);
    const pulse = 0.6 + 0.4 * Math.sin(s.t * 10);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
    ctx.fillStyle = 'rgba(255,90,50,' + pulse + ')'; ctx.beginPath(); ctx.moveTo(16 * dpr, 0); ctx.lineTo(-8 * dpr, -11 * dpr); ctx.lineTo(-8 * dpr, 11 * dpr); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '700 ' + (13 * dpr) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', ex - Math.cos(a) * 2 * dpr, ey + 5 * dpr);
  }
  if (!(AL.UI && AL.UI.addWidget) && w.clock) drawClockFallback(ctx, w, W, dpr);
}

// ---- season clock (UI widget, SVG) ------------------------------------------------------------------------
const ICONS = {
  sun: '<circle cx="7" cy="7" r="3.2" fill="#f2c14e"/><g stroke="#f2c14e" stroke-width="1.3" stroke-linecap="round"><path d="M7 .8v1.6M7 11.6v1.6M.8 7h1.6M11.6 7h1.6M2.6 2.6l1.1 1.1M10.3 10.3l1.1 1.1M2.6 11.4l1.1-1.1M10.3 3.7l1.1-1.1"/></g>',
  cloud: '<path d="M3.6 11h7a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.9-.6A2.9 2.9 0 0 0 3.6 11z" fill="#c9c3b6"/>',
  rain: '<path d="M3.6 8.6h7a2.4 2.4 0 0 0 .3-4.8 3.4 3.4 0 0 0-6.5-.6A2.7 2.7 0 0 0 3.6 8.6z" fill="#a9b4c2"/><g stroke="#7cc4e8" stroke-width="1.2" stroke-linecap="round"><path d="M4.5 10.2l-.7 2.2M7.3 10.2l-.7 2.2M10 10.2l-.7 2.2"/></g>',
  storm: '<path d="M3.6 8.2h7a2.4 2.4 0 0 0 .3-4.8 3.4 3.4 0 0 0-6.5-.6A2.7 2.7 0 0 0 3.6 8.2z" fill="#7d8796"/><path d="M7.6 8.4L5.6 11.2h1.8l-1 2.6 3-3.6H7.6l1-1.8z" fill="#f2c14e"/>',
  heat: '<circle cx="7" cy="5.2" r="3" fill="#ff9a3a"/><g stroke="#ff7a3a" stroke-width="1.2" fill="none" stroke-linecap="round"><path d="M2 10.2q1.2-1 2.4 0t2.4 0 2.4 0 2.4 0M2 12.6q1.2-1 2.4 0t2.4 0 2.4 0 2.4 0"/></g>',
  snow: '<g stroke="#e6f2fa" stroke-width="1.3" stroke-linecap="round"><path d="M7 1.5v11M2.2 4.2l9.6 5.6M2.2 9.8l9.6-5.6"/></g>',
};
function arc(r, a0, a1) {
  const p = a => [(Math.cos(a) * r).toFixed(2), (Math.sin(a) * r).toFixed(2)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return 'M' + x0 + ' ' + y0 + 'A' + r + ' ' + r + ' 0 ' + (a1 - a0 > PI ? 1 : 0) + ' 1 ' + x1 + ' ' + y1;
}
function clockHTML(w) {
  if (!w || !w.clock || !AL.World) return '';
  const I = AL.World.info(w), c = w.clock, e = w.env, SE = AL.WORLD_TUNE.SEASONS, Y = AL.World.yearDur();
  let svg = '<svg width="68" height="68" viewBox="-34 -34 68 68" style="flex:none">';
  let acc = 0;
  for (const s of SE) {
    const d = AL.World.seasonDur(s) / Y, a0 = -PI / 2 + acc * TAU + 0.05, a1 = -PI / 2 + (acc + d) * TAU - 0.05;
    svg += '<path d="' + arc(28, a0, a1) + '" stroke="' + s.colour + '" stroke-width="6" fill="none" stroke-linecap="round" opacity="' + (s.key === I.season ? 1 : 0.45) + '"/>';
    acc += d;
  }
  const ya = -PI / 2 + c.yearT * TAU;
  svg += '<circle cx="' + (Math.cos(ya) * 28).toFixed(2) + '" cy="' + (Math.sin(ya) * 28).toFixed(2) + '" r="4.2" fill="#fff" stroke="#1a120a" stroke-width="1.5"/>';
  const night = c.night, dusk = c.dusk;
  const sky = Art.mix(Art.mix('#7ec4ec', '#ffa060', dusk * 0.6), '#16203a', night);
  svg += '<circle r="19" fill="' + sky + '" stroke="rgba(214,170,110,.35)"/>';
  // sun by day, moon by night, travelling over the top of the dial (noon = top)
  const ta = c.tod * TAU + PI / 2, bx = Math.cos(ta) * 11, by = Math.sin(ta) * 11;
  if (night < 0.5) svg += '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="4.2" fill="#ffd45a"/>';
  else svg += '<circle cx="' + bx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="4" fill="#e8ecf4"/><circle cx="' + (bx + 1.8).toFixed(1) + '" cy="' + (by - 1).toFixed(1) + '" r="3.4" fill="' + sky + '"/>';
  if (e.frost > 0.3) svg += '<path d="M-14 9q14-7 28 0" stroke="#e6f2fa" stroke-width="2.4" fill="none" opacity="' + e.frost.toFixed(2) + '"/>';
  svg += '<path d="M-19 0h38" stroke="rgba(30,40,20,.5)" stroke-width="1"/></svg>';
  let lines = '<div style="font-weight:700;color:' + I.colour + '">' + I.seasonName + ' <span style="color:var(--mute);font-weight:500">day ' + I.day + '/' + I.days + (I.year > 1 ? ' · year ' + I.year : '') + '</span></div>';
  lines += '<div style="font-variant-numeric:tabular-nums">' + I.clock + ' · ' + I.temp + '°C</div>';
  lines += '<div style="display:flex;align-items:center;gap:5px"><svg width="14" height="14" viewBox="0 0 14 14">' + (ICONS[I.icon] || '') + '</svg>' + I.weatherName + '</div>';
  if (I.forecast) lines += '<div style="color:#7cc4e8">' + I.forecast + '</div>';
  if (e.winter) lines += '<div style="color:#bfe3f2">Hibernating · truce</div>';
  else if (I.winterSoon) lines += '<div style="color:#ff9a5a;font-weight:600">' + I.winterText + ' - stockpile!</div>';
  if (I.flood > 0.04) lines += '<div style="color:#7cc4e8">Nest flooding ' + Math.round(I.flood * 100) + '%</div>';
  if (e.heat > 0.3) lines += '<div style="color:#ffb070">Hot sun: keep to the shade</div>';
  const sc = w.scent; if (sc && sc.nh) {
    let riv = 0, spi = 0; for (let k = 0; k < sc.nh; k++) { if (sc.hints[k].col === 200) spi++; else if (sc.hints[k].col > 0 && sc.hints[k].col < 200) riv++; }
    if (riv || spi) lines += '<div style="color:var(--mute)">Your ants smell ' + [riv ? 'rivals' : '', spi ? 'a spider' : ''].filter(Boolean).join(' and ') + '</div>';
  }
  return '<div style="display:flex;gap:10px;align-items:center;min-width:210px;font-size:12px;line-height:1.35">' + svg + '<div>' + lines + '</div></div>';
}
function drawClockFallback(ctx, w, W, dpr) {
  const I = AL.World.info(w);
  ctx.font = '600 ' + (12 * dpr) + 'px system-ui,sans-serif'; ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(24,17,11,.8)'; ctx.fillRect(W - 230 * dpr, 60 * dpr, 218 * dpr, 40 * dpr);
  ctx.fillStyle = I.colour; ctx.fillText(I.seasonName + ' day ' + I.day + '  ' + I.clock, W - 20 * dpr, 76 * dpr);
  ctx.fillStyle = '#f3e9d2'; ctx.fillText(I.weatherName + ' ' + I.temp + '°C ' + (I.forecast || (I.winterSoon ? I.winterText : '')), W - 20 * dpr, 93 * dpr);
}

// ---- toasts for things the player should react to -------------------------------------------------------
const lastToast = {};
function toastOn(type, fn, gap) {
  AL.on(type, (w, d) => {
    if (!AL.UI || !AL.UI.toast || !AL.Game || w !== AL.Game.world) return;
    const now = w.t; if (lastToast[type] != null && now - lastToast[type] < (gap || 8) && now >= lastToast[type]) return;
    const t = fn(w, d); if (!t) return;
    lastToast[type] = now; AL.UI.toast(t);
  });
}
toastOn('forecast', (w, d) => d.kind === 'storm' ? 'A storm is coming: trails will wash away and low tunnels may flood' : 'Rain is on the way');
toastOn('weather', (w, d) => d.kind === 'heat' ? 'Heat wave: ants crawl in open sun - use shade and shelters' : null);
toastOn('season', (w, d) => d.season === 'winter' ? null : d.name + (d.year > 1 ? ' (year ' + d.year + ')' : ''));
toastOn('winterSoon', (w, d) => 'Winter in ' + AL.World.fmtTime(d.in) + ': stockpile food before the colony hibernates');
toastOn('hibernate', (w, d) => d.on ? 'Winter: every colony hibernates. Foraging stops - truce' : 'Spring thaw: the colonies wake up');
toastOn('bird', (w, d) => d.col === AL.me() ? 'A bird is circling over your foragers!' : null, 20);
toastOn('mower', (w, d) => d.phase === 'warn' ? 'Lawnmower in ' + Math.round(d.in) + ' s! It mows the whole yard. Sound the mower alarm [U] to call your ants home'
  : d.phase === 'end' && !w.player.recall ? 'The mower is gone' : null);
toastOn('recall', (w, d) => d.col !== AL.me() ? null : d.on ? ((AL.BIOMES && AL.BIOMES[w.biomeKey] || {}).humans === false ? 'Recall: every ant on the surface is running home' : 'Mower alarm: every ant on the surface is running home') : d.auto ? 'All clear: the mower is gone and your ants head back out' : 'Recall off: your ants head back out', 1);
toastOn('sprinkler', (w, d) => d.on ? 'Sprinklers on: trails wash out and nearby nests flood' : null, 60);
toastOn('picnicSoon', () => 'Picnic! Food is about to land on the blanket', 60);
toastOn('flood', (w, d) => d.col === AL.me() && d.on ? 'Your nest is flooding from below' : null, 30);
toastOn('termitesBreached', (w, d) => d.col === AL.me() ? 'Your ants broke into the termite mound!' : 'The termite mound was raided', 30);
toastOn('creatureDied', (w, d) => {
  const kind = d.kind || (d.creature && d.creature.type);   // ours: {kind}, core combat: {creature}
  return d.col === AL.me() && (kind === 'spider' || kind === 'caterpillar' || kind === 'beetle') ? 'Your ants brought down a ' + AL.CREATURE_TYPES[kind].name.toLowerCase() + '. Drag it home!' : null;
}, 5);
toastOn('spiderHunt', (w, d) => d.col === AL.me() ? 'A spider is hunting your foragers' : null, 90);

AL.WorldFX = { clockHTML, layers: { ground, underAnts, overAnts, weather, grade, fog, screen } };
AL.registerSystem({
  id: 'world-fx', order: 14,
  enabled(opts) { return opts.world !== false; },
  render: { ground, underAnts, overAnts, weather, grade, fog, screen },
});
if (AL.UI && AL.UI.addWidget) AL.UI.addWidget('world-clock', { where: 'right', every: 0.5, html: clockHTML });
})(window);
