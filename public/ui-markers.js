// Easier-to-spot world markers: incoming raids (a red ring round the raiding party, or an arrow at the screen
// edge pointing at it when it's off screen), bigger ends on recruit paths, and the player's Collect circles (the one
// being dragged out, with the food it would take, and the ones under way). Render only.
(function (root) {
'use strict';
const AL = root.AL, TAU = Math.PI * 2;
let cache = { t: -1, groups: [] };

// raiding parties heading for the player: centroid + head count per rival colony (refreshed twice a second)
function raiders(w) {
  if (Math.abs(w.t - cache.t) < 0.5) return cache.groups;
  const A = w.ants, ST = AL.ST, by = new Map();
  for (let i = 0; i < A.high; i++) {
    if (A.state[i] !== ST.RAID || A.layer[i] !== 0) continue;
    const c = w.colonies[A.col[i]];
    if (!c || !c.ai || c.ai.target !== AL.me()) continue;
    let g = by.get(c.id); if (!g) by.set(c.id, g = { col: c.id, n: 0, x: 0, y: 0, seen: 0 });
    g.n++; g.x += A.x[i]; g.y += A.y[i];
    if (!w.fog || w.fog.visibleAt(A.x[i], A.y[i])) g.seen++;
  }
  cache = { t: w.t, groups: [...by.values()].filter(g => g.n >= 3).map(g => Object.assign(g, { x: g.x / g.n, y: g.y / g.n })) };
  return cache.groups;
}
function overAnts(ctx, view, r) {
  const w = r.world; if (!w || w.over) return;
  const pulse = 0.5 + 0.5 * Math.sin(r.frame * 0.12), k = 1 / view.z * view.dpr;
  for (const g of raiders(w)) {
    if (!g.seen) continue;
    ctx.strokeStyle = 'rgba(255,80,50,' + (0.55 + pulse * 0.4) + ')'; ctx.lineWidth = 3 * k;
    ctx.beginPath(); ctx.arc(g.x, g.y, 40 + pulse * 8, 0, TAU); ctx.stroke();
  }
  // recruit path ends: a bigger, labelled target
  const col = w.player;
  for (const o of col.orders || []) {
    if (o.done || o.cancelled || !o.pts || !o.pts.length) continue;
    const e = o.pts[o.pts.length - 1];
    ctx.strokeStyle = 'rgba(95,211,230,0.9)'; ctx.lineWidth = 2.5 * k;
    ctx.beginPath(); ctx.arc(e.x, e.y, 12 * k + pulse * 3 * k, 0, TAU); ctx.stroke();
  }
  collects(ctx, w, k, pulse);
}
// Collect circles: dashed amber rings, a small ring round every food still to fetch, the ants out on it
const AMBER = 'rgba(232,176,74,';
function ringFoods(ctx, foods, k, a) {
  ctx.strokeStyle = AMBER + a + ')'; ctx.lineWidth = 1.8 * k;
  for (const f of foods) { ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 4 * k, 0, TAU); ctx.stroke(); }
}
function label(ctx, text, x, y, k) {
  ctx.font = '700 ' + (12 * k) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(20,14,6,0.8)'; ctx.strokeText(text, x, y); ctx.fillStyle = '#ffe6b0'; ctx.fillText(text, x, y);
}
function collects(ctx, w, k, pulse) {
  const S = w.surface, c = w.player;
  ctx.save();
  for (const o of (c && c.collects) || []) {
    const left = o.foods.map(id => S.byId.get(id)).filter(f => f && !f.gone);
    const fade = o.done ? Math.max(0, 1 - (w.t - o.doneT) / 4) : 1; if (fade <= 0) continue;
    ctx.setLineDash([9 * k, 6 * k]); ctx.lineDashOffset = -w.t * 12 * k;
    ctx.strokeStyle = AMBER + (0.75 * fade) + ')'; ctx.lineWidth = 2.2 * k;
    ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    if (!o.done) ringFoods(ctx, left, k, 0.5 + pulse * 0.4);
    label(ctx, o.done ? (o.why === 'done' ? 'Collected' : 'Collect ended') : 'Collect: ' + left.length + ' left, ' + o.mi.length + ' ants', o.x, o.y - o.r - 4 * k, k);
  }
  // the circle being dragged out right now
  const T = AL.Tools, cc = T && T.collectCircle && T.collectCircle();
  if (cc) {
    const inside = T.foodsIn(w, cc.x, cc.y, cc.r);
    ctx.fillStyle = AMBER + '0.12)'; ctx.strokeStyle = AMBER + '0.95)'; ctx.lineWidth = 2.5 * k; ctx.setLineDash([9 * k, 6 * k]);
    ctx.beginPath(); ctx.arc(cc.x, cc.y, cc.r, 0, TAU); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ringFoods(ctx, inside, k, 0.95);
    label(ctx, inside.length ? inside.length + (inside.length === 1 ? ' find' : ' finds') + ' · ' + (T.collectN || 10) + ' ants' : 'No food here', cc.x, cc.y - cc.r - 4 * k, k);
  }
  ctx.restore();
}
// off-screen raids: an arrow on the screen edge
function screen(ctx, view, r) {
  const w = r.world; if (!w || w.over || view.scene !== 'surface') return;
  const lv = r.lastView; if (!lv) return;
  const dpr = view.dpr || 1, M = 46 * dpr, W = view.w, H = view.h;
  for (const g of raiders(w)) {
    const sx = g.x * lv.z + lv.ox, sy = g.y * lv.z + lv.oy;
    if (sx > 0 && sy > 0 && sx < W && sy < H) continue;
    const cx = W / 2, cy = H / 2, a = Math.atan2(sy - cy, sx - cx);
    const t = Math.min((W / 2 - M) / Math.max(1e-6, Math.abs(Math.cos(a))), (H / 2 - M) / Math.max(1e-6, Math.abs(Math.sin(a))));
    const x = cx + Math.cos(a) * t, y = cy + Math.sin(a) * t, s = 16 * dpr;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(40,12,6,0.85)'; ctx.beginPath(); ctx.arc(0, 0, s * 1.35, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff5a3a'; ctx.beginPath(); ctx.moveTo(s * 1.25, 0); ctx.lineTo(-s * 0.5, -s * 0.75); ctx.lineTo(-s * 0.15, 0); ctx.lineTo(-s * 0.5, s * 0.75); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = '700 ' + (12 * dpr) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe2d8'; ctx.fillText('Raid ' + g.n, x - Math.cos(a) * s * 2.6, y - Math.sin(a) * s * 2.6);
  }
}
AL.registerSystem({ id: 'ui-markers', order: 90, render: { overAnts, screen } });
})(window);
