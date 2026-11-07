// Combat feedback (browser only, reads the sim, never changes it): scuffle dust under grappling ants, bite
// flashes at the jaws, stun stars, a puff where an ant dies, a red alarm haze over every battle you can see,
// arrows at the screen edge to your fights off screen, crossed jaws on the minimap, and toasts for the turns
// of a fight (losing a fight you can't win, a raid beaten off, a siege broken or wiped out). Sound: the sim's
// 'fight' events already click in audio.js; kills and the losing warning add a few sounds through AL.Audio.play.
(function (root) {
'use strict';
const AL = root.AL; if (!AL) return;
const ST = AL.ST, TAU = AL.TAU;
let dust = null, haze = null, flash = null;
function sprites() {
  if (dust) return;
  dust = AL.Art.softDot(16, '190,160,112');
  haze = AL.Art.softDot(64, '232,64,36');
  flash = AL.Art.softDot(8, '255,244,200');
}
const isMe = w => AL.Game && w === AL.Game.world;
const seen = (w, x, y) => !w.fog || w.fog.visibleAt(x, y);
const inView = (v, x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
const now = () => performance.now() / 1000;
// short-lived marks where ants died in a fight
const puffs = [];
AL.on('antDied', (w, d) => {
  if (!isMe(w) || d.cause !== 'fight') return;
  if (puffs.length < 160) puffs.push({ x: d.x, y: d.y, layer: d.layer || 0, t: now(), mine: d.col === AL.me() });
  if (!d.layer && Math.random() < 0.5) {
    const r = AL.Game.renderer, v = r && r.lastView;
    if (AL.Audio && v && r.view !== 'nest' && inView(v, d.x, d.y, 0) && v.cam && v.cam.z > 0.8) AL.Audio.play('tick', { vol: 0.03 });
  }
});

// ---- surface ----
function underAnts(ctx, view, r) {
  const w = r.world, A = w.ants, cb = w.cb; sprites();
  const t = now();
  // the alarm scent hanging over a battle: a soft red haze that breathes with the fight
  if (cb) for (const b of cb.battles) {
    if (!inView(view, b.x, b.y, 220) || !seen(w, b.x, b.y)) continue;
    const R = 34 + Math.sqrt(b.size || 1) * 13, a = Math.min(0.24, 0.08 + (b.size || 1) * 0.01) * (0.75 + 0.25 * Math.sin(t * 4 + b.id));
    ctx.globalAlpha = a; ctx.drawImage(haze, b.x - R, b.y - R, R * 2, R * 2);
  }
  // scuffle dust kicked up by every grapple
  const al = view.alpha == null ? 1 : view.alpha;
  let n = 0;
  for (let i = 0; i < A.high && n < 700; i++) {
    if (A.state[i] !== ST.FIGHT || A.layer[i] !== 0) continue;
    const x = A.px[i] + (A.x[i] - A.px[i]) * al, y = A.py[i] + (A.y[i] - A.py[i]) * al;
    if (!inView(view, x, y, 20) || (A.col[i] !== AL.me() && !seen(w, x, y))) continue;
    n++;
    const ph = t * 6 + i * 0.37, rr = 5 + 2.2 * Math.sin(ph) + (A.size[i] || 1) * 2;
    ctx.globalAlpha = 0.22 + 0.1 * Math.sin(ph * 1.3);
    ctx.drawImage(dust, x - rr + Math.cos(ph) * 2, y - rr * 0.8 + Math.sin(ph * 0.7) * 2, rr * 2, rr * 1.6);
  }
  ctx.globalAlpha = 1;
}
function overAnts(ctx, view, r) {
  const w = r.world, A = w.ants; sprites();
  const t = now(), z = view.z, al = view.alpha == null ? 1 : view.alpha;
  if (z > 0.35) {
    let n = 0;
    for (let i = 0; i < A.high && n < 600; i++) {
      if (A.state[i] !== ST.FIGHT || A.layer[i] !== 0) continue;
      const x = A.px[i] + (A.x[i] - A.px[i]) * al, y = A.py[i] + (A.y[i] - A.py[i]) * al;
      if (!inView(view, x, y, 10) || (A.col[i] !== AL.me() && !seen(w, x, y))) continue;
      n++;
      const sz = AL.CASTES[A.caste[i]].size * (w.colonies[A.col[i]].sp.size || 1);
      // a bite: a quick bright flash at the jaws, a few times a second per ant
      const ph = Math.sin(t * 13 + i * 2.17);
      if (ph > 0.8) {
        const jx = x + Math.cos(A.a[i]) * 5.2 * sz, jy = y + Math.sin(A.a[i]) * 5.2 * sz, k = (ph - 0.8) * 5, fr = (2.2 + 1.6 * k) * Math.sqrt(sz);
        ctx.globalAlpha = 0.55 + 0.45 * k; ctx.drawImage(flash, jx - fr, jy - fr, fr * 2, fr * 2);
        ctx.strokeStyle = A.col[i] === AL.me() ? 'rgba(255,236,170,0.9)' : 'rgba(255,170,120,0.9)'; ctx.lineWidth = Math.max(0.35, 0.8 / z);
        ctx.beginPath();
        for (let q = 0; q < 4; q++) { const aa = q * TAU / 4 + t * 3 + i; ctx.moveTo(jx + Math.cos(aa) * fr * 0.4, jy + Math.sin(aa) * fr * 0.4); ctx.lineTo(jx + Math.cos(aa) * fr * 1.1, jy + Math.sin(aa) * fr * 1.1); }
        ctx.stroke();
      }
      // stunned by a fresh grapple: little stars circling its head
      if (A.cbStun && A.cbUid[i] === A.uid[i] && A.cbStun[i] > 0) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffe27a';
        for (let q = 0; q < 3; q++) { const aa = t * 8 + q * TAU / 3; ctx.beginPath(); ctx.arc(x + Math.cos(aa) * 3.2 * sz, y - 3 * sz + Math.sin(aa) * 1.4 * sz, 0.75, 0, TAU); ctx.fill(); }
      }
    }
  }
  drawPuffs(ctx, w, view, 0, t);
  ctx.globalAlpha = 1;
}
function drawPuffs(ctx, w, view, layer, t) {
  sprites();
  for (let k = puffs.length - 1; k >= 0; k--) {
    const p = puffs[k], age = t - p.t;
    if (age > 0.9) { puffs[k] = puffs[puffs.length - 1]; puffs.pop(); continue; }
    if (p.layer !== layer || !inView(view, p.x, p.y, 20)) continue;
    if (!layer && !p.mine && !seen(w, p.x, p.y)) continue;
    const k1 = age / 0.9, R = 4 + 10 * k1;
    ctx.globalAlpha = 0.5 * (1 - k1); ctx.drawImage(dust, p.x - R, p.y - R * 0.8, R * 2, R * 1.6);
    ctx.globalAlpha = 0.8 * (1 - k1); ctx.strokeStyle = p.mine ? 'rgba(255,214,120,1)' : 'rgba(255,110,80,1)'; ctx.lineWidth = Math.max(0.4, 0.9 / view.z);
    ctx.beginPath(); ctx.arc(p.x, p.y, 2 + 6 * k1, 0, TAU); ctx.stroke();
  }
}
// your fights out of sight: a pulsing arrow at the screen edge pointing at each one
function screen(ctx, view, r) {
  const w = r.world, cb = w.cb, lv = r.lastView; if (!cb || !lv || r.view === 'nest') return;
  const t = now(), W = view.w, H = view.h, m = 26 * (view.dpr || 1);
  for (const b of cb.battles) {
    if (!(b.n[0] > 0.3 || b.lost[0] > 0.5)) continue;
    if (inView(lv, b.x, b.y, -10)) continue;
    const sx = b.x * lv.z + lv.ox, sy = b.y * lv.z + lv.oy, cx = W / 2, cy = H / 2;
    const dx = sx - cx, dy = sy - cy, k = Math.min((W / 2 - m) / Math.abs(dx || 1e-6), (H / 2 - m) / Math.abs(dy || 1e-6));
    const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx), s = (9 + Math.min(6, Math.sqrt(b.size || 1))) * (view.dpr || 1);
    const losing = b.lost[0] > 2 && b.lost[0] > (b.lost.reduce((q, v) => q + v, 0) - b.lost[0]);
    ctx.globalAlpha = 0.65 + 0.3 * Math.sin(t * 5 + b.id);
    ctx.fillStyle = losing ? '#ff5236' : '#f2c14e'; ctx.strokeStyle = 'rgba(20,10,4,0.85)'; ctx.lineWidth = 1.5 * (view.dpr || 1);
    ctx.beginPath(); ctx.moveTo(ex + Math.cos(a) * s, ey + Math.sin(a) * s); ctx.lineTo(ex + Math.cos(a + 2.5) * s, ey + Math.sin(a + 2.5) * s); ctx.lineTo(ex + Math.cos(a - 2.5) * s, ey + Math.sin(a - 2.5) * s); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// ---- nest view: bites in the tunnels ----
function nestOver(ctx, view, r) {
  const w = r.world, A = w.ants; sprites();
  const t = now(), al = view.alpha == null ? 1 : view.alpha, on = r.nestOwner ? (r.nestOwner().hid != null ? r.nestOwner().hid : r.nestOwner().id) : (w.me || 0);
  for (let i = 0; i < A.high; i++) {
    if (A.state[i] !== ST.FIGHT || A.layer[i] !== 1 || (A.nest && A.nest[i] !== on)) continue;   // only the nest on view
    const x = A.px[i] + (A.x[i] - A.px[i]) * al, y = A.py[i] + (A.y[i] - A.py[i]) * al;
    if (!inView(view, x, y, 10)) continue;
    const ph = Math.sin(t * 13 + i * 2.17);
    ctx.globalAlpha = 0.25; ctx.drawImage(dust, x - 6, y - 5, 12, 10);
    if (ph > 0.8) { const jx = x + Math.cos(A.a[i]) * 4, jy = y + Math.sin(A.a[i]) * 4, fr = 2 + (ph - 0.8) * 8; ctx.globalAlpha = 0.9; ctx.drawImage(flash, jx - fr, jy - fr, fr * 2, fr * 2); }
  }
  drawPuffs(ctx, w, view, 1, t);
  ctx.globalAlpha = 1;
}
AL.registerSystem({ id: 'combat-fx', order: 95, render: { underAnts, overAnts, screen, nestOver } });

// ---- minimap: crossed jaws at every battle you can see (yours always) ----
function minimap(mm, w, k) {
  const cb = w.cb; if (!cb) return;
  const t = now();
  for (const b of cb.battles) {
    const mine = b.n[0] > 0.3 || b.lost[0] > 0.5;
    if (!mine && !seen(w, b.x, b.y)) continue;
    const x = b.x * k, y = b.y * k, s = 3 + Math.min(3, Math.sqrt(b.size || 1) * 0.6);
    mm.globalAlpha = 0.75 + 0.25 * Math.sin(t * 6 + b.id);
    mm.strokeStyle = '#120d08'; mm.lineWidth = 3;
    mm.beginPath(); mm.moveTo(x - s, y - s); mm.lineTo(x + s, y + s); mm.moveTo(x + s, y - s); mm.lineTo(x - s, y + s); mm.stroke();
    mm.strokeStyle = mine ? '#ffd166' : '#ff6a4a'; mm.lineWidth = 1.6;
    mm.beginPath(); mm.moveTo(x - s, y - s); mm.lineTo(x + s, y + s); mm.moveTo(x + s, y - s); mm.lineTo(x - s, y + s); mm.stroke();
  }
  mm.globalAlpha = 1;
}
AL.MINIMAP_LAYERS = AL.MINIMAP_LAYERS || [];
AL.MINIMAP_LAYERS.push(minimap);

// ---- toasts and sounds for the turns of a fight ----
const last = {};
const once = (key, secs, fn) => { const n = now(); if (last[key] && n - last[key] < secs) return; last[key] = n; fn(); };
const toast = (txt, kind) => { if (AL.UI && AL.UI.toast && !(AL.Game && AL.Game.demo)) AL.UI.toast(txt, kind); };
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
function where(w, x, y) {
  const p = w.player, d = Math.hypot(x - p.x, y - p.y);
  if (d < 260) return 'at your mound';
  return Math.round(d / 10) * 10 + ' to the ' + DIRS[(Math.round(Math.atan2(y - p.y, x - p.x) / (Math.PI / 4)) + 8) % 8];
}
const spName = (w, c) => (w.colonies[c] && w.colonies[c].sp && w.colonies[c].sp.name) || 'Rival';
AL.on('losingFight', (w, d) => {
  if (!isMe(w) || (w.me || 0) !== 0) return;   // the sim only tracks colony 0's battles for this hint
  once('losing', 25, () => {
    const odds = d.foes > d.mine * 1.3 ? ', outnumbered ' + Math.round(d.foes / Math.max(1, d.mine)) + ' to 1' : d.theirs ? ' for ' + d.theirs + ' of theirs' : ' and none of theirs';
    toast('Your ants are losing a fight ' + where(w, d.x, d.y) + ': ' + d.lost + ' dead' + odds + '. ' +
      (d.home ? 'Paint Alarm [R] there to call every soldier out.' : 'Send soldiers with Alarm [R], or steer clear with Avoid [V].'), 'bad');
    if (AL.Audio) { AL.Audio.play('thud', { vol: 0.05 }); AL.Audio.play('clack', { vol: 0.03, when: 0.12 }); }
  });
});
AL.on('raidRepelled', (w, d) => { if (isMe(w) && d.target === AL.me()) once('repelled', 20, () => toast('Raid beaten off! The ' + spName(w, d.col) + ' lost ' + d.lost + ' of ' + d.n0 + ' and turned for home.', 'good')); });
AL.on('siegeBroken', (w, d) => { if (isMe(w) && d.by === AL.me()) once('broken', 30, () => toast('The rival nest\'s defenders are down: your ants are at the queen!', 'good')); });
AL.on('siegeRepelled', (w, d) => { if (isMe(w) && d.by === AL.me()) once('sRepelled', 30, () => toast('Your ants inside the ' + spName(w, d.col) + ' nest were wiped out. Send a bigger force: numbers win.', 'bad')); });
AL.on('nestDefends', (w, d) => { if (isMe(w) && d.col === AL.me()) once('defends', 60, () => toast('Enemies at the door: your nest turns out to defend the mound.')); });
})(window);
