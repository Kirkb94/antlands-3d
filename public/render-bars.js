// Health bars over hurt ants (surface and nest view) and hurt big creatures. Render only: reads the sim, never
// writes it. drawAnts / drawNestAnts hand every visible ant with hp < maxhp to barAnt(); drawBars() then draws
// them all in a few batched paths (no save/restore per ant).
//   - fill runs green -> yellow -> red with the hp fraction, on a thin dark backing
//   - a thin rim: pale for your own ants, the colony's team colour for rivals (creatures: just the dark backing)
//   - the queen's bar is bigger and never fades; other bars fade a few seconds after the ant was last hurt
//   - zoomed far out (dots) only your own ants that are being hurt right now show a bar
// "Last hurt" is tracked in renderer-owned typed arrays keyed by slot + uid, so nothing is added to the ant store.
(function (root) {
'use strict';
const AL = root.AL, P = AL.Renderer.prototype;
const HOLD = 4, FADE = 1.5;            // seconds a bar stays after the last hit, then fades
const HOLD_DOT = 1.5, FADE_DOT = 1;    // dot view: only fresh hits
const NB = 16, NA = 4;                 // colour buckets, alpha levels (for batching)
const STRIDE = 7, CAP = 4096;          // bar list: x, y, w, h, frac, alpha level, colony (-1 creature)
const RIM_MINE = 'rgba(250,242,220,0.95)';
const CREATURE_BARS = { spider: 1, beetle: 1, ladybug: 1, caterpillar: 1, cocoon: 1, termites: 1, centipede: 1, antlion: 1, assassin: 1, mantis: 1 };
// the hunger meter (cr.food) under every predator when zoomed in: amber while it's fed, red once it's hungry enough
// to come after your ants harder (eco.js HUNGRY)
const HUNGER_BARS = { spider: 1, beetle: 1, centipede: 1, antlion: 1, assassin: 1, mantis: 1 };
const HUNGER_ZOOM = 0.9;

// green -> yellow -> red
function rampColour(f) {
  const g = [92, 204, 72], y = [236, 206, 64], r = [222, 62, 44];
  const a = f > 0.5 ? y : r, b = f > 0.5 ? g : y, t = f > 0.5 ? (f - 0.5) * 2 : f * 2;
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')';
}
const FILL = []; for (let k = 0; k < NB; k++) FILL.push(rampColour((k + 0.5) / NB));
const teamOf = (w, c) => { const col = w.colonies[c]; return (col && col.team) || (AL.Colonies && AL.Colonies.team ? AL.Colonies.team(c) : '#f2c14e'); };

function bars(r) {
  const A = r.world.ants;
  let b = r.hbar;
  if (!b || b.cap !== A.cap || b.world !== r.world) {
    b = r.hbar = { world: r.world, cap: A.cap, uid: new Int32Array(A.cap), last: new Float32Array(A.cap), hurt: new Float32Array(A.cap), seen: new Int32Array(A.cap),
      src: new Float32Array(CAP * 4), n: 0, dot: false, out: new Float32Array(CAP * STRIDE), order: new Int32Array(CAP), cnt: new Int32Array(NA * NB + 1),
      crs: new WeakMap() };
  }
  return b;
}

// start a frame's list (dot: zoomed far out)
P.barBegin = function (dot) { const b = bars(this); b.n = 0; b.dot = !!dot; return b; };
// a hurt, visible ant at screen (sx, sy) with screen body radius rad
P.barAnt = function (i, sx, sy, rad) {
  const b = this.hbar; if (!b || b.n >= CAP) return;
  const o = b.n++ * 4; b.src[o] = i; b.src[o + 1] = sx; b.src[o + 2] = sy; b.src[o + 3] = rad;
};

// how visible a bar is: 1 right after a hit, fading to 0
function fadeOf(age, dot) {
  const hold = dot ? HOLD_DOT : HOLD, fade = dot ? FADE_DOT : FADE;
  return age <= hold ? 1 : Math.max(0, 1 - (age - hold) / fade);
}
function push(b, m, x, y, w, h, frac, alpha, col) {
  if (m >= CAP) return m;
  const o = m * STRIDE, O = b.out;
  O[o] = Math.round(x); O[o + 1] = Math.round(y); O[o + 2] = Math.round(w); O[o + 3] = Math.round(h); O[o + 4] = AL.clamp(frac, 0, 1);
  O[o + 5] = Math.min(NA - 1, Math.max(0, Math.ceil(alpha * NA) - 1)); O[o + 6] = col;
  return m + 1;
}

// hunger meters: a thin bar under each predator in sight (few of them, so drawn one by one)
function drawHunger(ctx, view, w, dpr) {
  const L = w.surface.creatures, a = view.alpha || 0, z = view.z, HUNGRY = AL.Eco ? AL.Eco.TUNE.HUNGRY : 0.35, ow = Math.max(1, Math.round(dpr));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const cr of L) {
    if (!cr.alive || cr.hidden || !HUNGER_BARS[cr.type] || cr.food == null) continue;
    const x = cr.px + (cr.x - cr.px) * a, y = cr.py + (cr.y - cr.py) * a, rr = (cr.r || 8) * (cr.scale || 1);
    if (x < view.x0 - rr || x > view.x1 + rr || y < view.y0 - rr || y > view.y1 + rr) continue;
    if (w.fog && !w.fog.visibleAt(x, y)) continue;
    const rad = rr * z, bw = AL.clamp(rad * 1.6, 22 * dpr, 70 * dpr), bh = Math.max(2 * dpr, Math.round(bw * 0.07));
    const bx = Math.round(x * z + view.ox - bw / 2), by = Math.round(y * z + view.oy + rad + 4 * dpr), f = AL.clamp(cr.food, 0, 1);
    ctx.fillStyle = 'rgba(14,9,5,0.85)'; ctx.fillRect(bx - ow, by - ow, bw + ow * 2, bh + ow * 2);
    ctx.fillStyle = f < HUNGRY ? '#ff5a3c' : '#e8b04a'; ctx.fillRect(bx, by, Math.max(ow, Math.round(bw * f)), bh);
    // a little notch where hunger turns to hunting
    ctx.fillStyle = 'rgba(250,240,220,0.7)'; ctx.fillRect(bx + Math.round(bw * HUNGRY), by - ow, ow, bh + ow * 2);
  }
}
// draw the collected ant bars, plus hurt creatures when a surface view is given (screen space, identity transform)
P.drawBars = function (ctx, view) {
  const b = this.hbar; if (!b) return;
  const w = this.world, A = w.ants, now = w.t || 0, fr = this.frame, ME = w.me || 0, dpr = this.dpr, QUEEN = AL.CASTE.QUEEN;
  let m = 0;
  for (let k = 0; k < b.n; k++) {
    const s = k * 4, i = b.src[s], sx = b.src[s + 1], sy = b.src[s + 2], rad = b.src[s + 3];
    const mx = A.maxhp[i]; if (!(mx > 0)) continue;
    const hp = A.hp[i];
    if (b.uid[i] !== A.uid[i]) { b.uid[i] = A.uid[i]; b.last[i] = mx; b.hurt[i] = -1e9; b.seen[i] = -9; }
    // hurt since last frame; or out of sight / at full hp since then and changed meanwhile (healed, then hit)
    const gap = b.seen[i] < fr - 1, d = hp - b.last[i];
    if (d < -1e-4 || (gap && d > 1e-4)) b.hurt[i] = now;
    b.last[i] = hp; b.seen[i] = fr;
    const queen = A.caste[i] === QUEEN;
    const alpha = queen ? 1 : fadeOf(now - b.hurt[i], b.dot);
    if (alpha <= 0.02) continue;
    let bw, bh;
    if (b.dot) { bw = (queen ? 14 : 8) * dpr; bh = 2 * dpr; }
    else if (queen) { bw = AL.clamp(rad * 1.7, 30 * dpr, 84 * dpr); bh = AL.clamp(bw * 0.12, 4 * dpr, 8 * dpr); }
    else { bw = AL.clamp(rad * 1.6, 12 * dpr, 38 * dpr); bh = AL.clamp(bw * 0.15, 2.5 * dpr, 5 * dpr); }
    m = push(b, m, sx - bw / 2, sy - rad - bh - 3 * dpr, bw, bh, hp / mx, alpha, A.col[i]);
  }
  // big creatures (surface only): spiders, beetles, caterpillars and friends, when hurt and in sight
  if (view && w.surface && w.surface.creatures) {
    const L = w.surface.creatures, a = view.alpha || 0, z = view.z, cz = view.z / (view.dpr || 1);
    const big = Math.min(2.2, Math.max(1, 1.15 / cz));     // matches world-fx.js overAnts
    for (const cr of L) {
      if (!cr.alive || cr.hidden || cr.flying || !CREATURE_BARS[cr.type] || !(cr.maxHp > 1)) continue;
      const x = cr.px + (cr.x - cr.px) * a, y = cr.py + (cr.y - cr.py) * a, rr = (cr.r || 8) * (cr.type === 'termites' || cr.type === 'cocoon' ? 1 : big);
      if (x < view.x0 - rr || x > view.x1 + rr || y < view.y0 - rr || y > view.y1 + rr) continue;
      if (w.fog && !w.fog.visibleAt(x, y)) continue;
      let st = b.crs.get(cr);
      if (!st) { st = { last: cr.maxHp, hurt: -1e9, seen: -9 }; b.crs.set(cr, st); }
      const d = cr.hp - st.last;
      if (d < -1e-4 || (st.seen < fr - 1 && d > 1e-4 && cr.hp < cr.maxHp)) st.hurt = now;
      st.last = cr.hp; st.seen = fr;
      if (cr.hp >= cr.maxHp) continue;
      const alpha = fadeOf(now - st.hurt, false); if (alpha <= 0.02) continue;
      const rad = rr * z, bw = AL.clamp(rad * 1.8, 24 * dpr, 90 * dpr), bh = AL.clamp(bw * 0.1, 3 * dpr, 7 * dpr);
      m = push(b, m, x * z + view.ox - bw / 2, y * z + view.oy - rad - bh - 4 * dpr, bw, bh, cr.hp / cr.maxHp, alpha, -1);
    }
  }
  if (view && w.surface && w.surface.creatures && view.z / (view.dpr || 1) >= HUNGER_ZOOM) drawHunger(ctx, view, w, dpr);
  if (!m) return;
  // counting sort by alpha level and colour bucket, then a handful of batched fills
  const O = b.out, cnt = b.cnt, ord = b.order, K = NA * NB;
  cnt.fill(0);
  for (let k = 0; k < m; k++) cnt[O[k * STRIDE + 5] * NB + Math.min(NB - 1, (O[k * STRIDE + 4] * NB) | 0) + 1]++;
  for (let k = 0; k < K; k++) cnt[k + 1] += cnt[k];
  for (let k = 0; k < m; k++) ord[cnt[O[k * STRIDE + 5] * NB + Math.min(NB - 1, (O[k * STRIDE + 4] * NB) | 0)]++] = k;
  // cnt[key] now holds the end of each key's run
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const ga = ctx.globalAlpha, ow = Math.max(1, Math.round(dpr));
  let start = 0;
  for (let lv = 0; lv < NA; lv++) {
    const end = cnt[lv * NB + NB - 1];
    if (end <= start) continue;
    ctx.globalAlpha = ga * (lv + 1) / NA;
    // rim: pale on your own ants' bars, the team colour on rivals' (creatures get none)
    for (let c = 0; c < w.colonies.length; c++) {
      let any = false;
      for (let q = start; q < end; q++) {
        const o = ord[q] * STRIDE; if (O[o + 6] !== c) continue;
        if (!any) { ctx.fillStyle = c === ME ? RIM_MINE : teamOf(w, c); ctx.beginPath(); any = true; }
        ctx.rect(O[o] - ow * 2, O[o + 1] - ow * 2, O[o + 2] + ow * 4, O[o + 3] + ow * 4);
      }
      if (any) ctx.fill();
    }
    // dark backing, and the empty part of the bar
    ctx.fillStyle = 'rgba(14,9,5,0.92)'; ctx.beginPath();
    for (let q = start; q < end; q++) { const o = ord[q] * STRIDE; ctx.rect(O[o] - ow, O[o + 1] - ow, O[o + 2] + ow * 2, O[o + 3] + ow * 2); }
    ctx.fill();
    ctx.fillStyle = 'rgba(58,34,26,0.95)'; ctx.beginPath();
    for (let q = start; q < end; q++) { const o = ord[q] * STRIDE; ctx.rect(O[o], O[o + 1], O[o + 2], O[o + 3]); }
    ctx.fill();
    // the fill, one path per colour bucket
    let q = start;
    for (let k = 0; k < NB; k++) {
      const e = cnt[lv * NB + k]; if (e <= q) continue;
      ctx.fillStyle = FILL[k]; ctx.beginPath();
      for (; q < e; q++) { const o = ord[q] * STRIDE; ctx.rect(O[o], O[o + 1], Math.max(ow, O[o + 2] * O[o + 4]), O[o + 3]); }
      ctx.fill();
    }
    start = end;
  }
  ctx.globalAlpha = ga;
  b.n = 0;
};
})(window);
