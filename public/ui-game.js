// Antlands UI, game side: minimap, event toasts, game over.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI;
const $ = id => document.getElementById(id);
let mm = null, mmT = 0, thumb = null;
const throttle = {};
const once = (key, secs, fn) => { const now = performance.now() / 1000; if (throttle[key] && now - throttle[key] < secs) return; throttle[key] = now; fn(); };

// ---- events -> toasts ----
AL.on('raid', (w, d) => { if (d.target === AL.me()) UI.toast(((w.colonies[d.col] && w.colonies[d.col].sp.name) || 'Rival') + ' raid! About ' + d.n + ' of them are marching on your mound.', 'bad'); });   // colonies stage: the raider's species
AL.on('breakIn', (w, d) => { if (d.target === AL.me()) once('breakIn', 20, () => UI.toast('Raiders broke into your nest! Your ants fight in the tunnels.', 'bad')); });
AL.on('foodStolen', () => once('stolen', 25, () => UI.toast('Raiders are stealing from your food store.', 'bad')));
AL.on('siege', (w, d) => { if (d.by === AL.me()) once('siege', 25, () => UI.toast('Your ants broke into the rival nest. Keep them coming: numbers win.', 'good')); });
AL.on('caveIn', () => once('cave', 20, () => UI.toast('A gravel tunnel caved in.')));
AL.on('broodLost', (w, d) => { if (d.col === AL.me() && d.cause === 'flood') once('flood', 20, () => UI.toast('Flood water drowned some brood.', 'bad')); if (d.col === AL.me() && d.cause === 'starve') once('starve', 30, () => UI.toast('Larvae are starving: bring protein home.', 'bad')); });
AL.on('queenDied', (w, d) => { if (d.col !== AL.me() && !(AL.Expansion && AL.Expansion.livingQueens && AL.Expansion.livingQueens(w, w.colonies[d.col]) > 0)) UI.toast('A rival queen is dead.', 'good'); });
AL.on('antDied', (w, d) => { if (d.col === AL.me() && d.caste === AL.CASTE.QUEEN) UI.toast(d.extra ? 'One of your extra queens has died.' : 'Your queen has died.', 'bad'); });
AL.on('antInjured', (w, d) => { if (d.col === AL.me() && d.kind === 'head') once('behead', 45, () => UI.toast('One of your ants lost its head in a fight. It will wander blindly until it starves.')); });   // injury.js
// polygyne colonies (fire ants): extra laying queens
AL.on('queenAdopted', (w, d) => { if (d.col === AL.me()) UI.toast(d.how === 'auto' ? 'A newly mated queen has joined your nest. ' + d.n + ' queens are laying now.' : 'The winged queen stays home and starts laying. ' + d.n + ' queens are laying now.', 'good'); });
AL.on('queenPromoted', (w, d) => { if (d.col === AL.me()) UI.toast('Another queen in the chamber takes her place. The colony lives on.', 'good'); else if (!w.fog || w.fog.visibleAt(w.colonies[d.col].x, w.colonies[d.col].y)) UI.toast('A rival queen died, but another queen in her nest carries on.'); });
AL.on('starving', (w, d) => { if (d.col === AL.me()) once('starving', 40, () => UI.toast('Your ants are starving! Bring sugar home: fruit, honeydew, the picnic spill.', 'bad')); });
AL.on('bigFood', (w, d) => { if (d.col === AL.me()) UI.toast('Big prey dragged home!', 'good'); });
AL.on('gameOver', (w, d) => setTimeout(() => UI.showGameOver && UI.showGameOver(w, d), 1200));

// ---- minimap ----
function drawMinimap(w) {
  const cv = $('minimap'), r = AL.Game.renderer, S = w.surface;
  if (!mm) mm = cv.getContext('2d');
  const W = cv.width, H = cv.height, k = W / S.W, q = W / 200;   // polish: q = marker scale (2x backing store), markers drawn bigger
  if (!thumb) { thumb = AL.Art.canvas(W, H); thumb.getContext('2d').drawImage(r.ground, 0, 0, W, H); }
  mm.globalAlpha = 1; mm.drawImage(thumb, 0, 0);
  // food sources
  for (const f of S.foods) { if (f.gone || f.amount < 1 || f.corpse) continue; mm.fillStyle = f.kind === AL.CARRY.SUGAR ? '#f2c14e' : f.kind === AL.CARRY.PROTEIN ? '#ec8a6c' : f.kind === AL.CARRY.WATER ? '#7cc4e8' : '#c9e09a'; mm.fillRect(f.x * k - 2 * q, f.y * k - 2 * q, 4 * q, 4 * q); }
  // ants (sampled)
  const A = w.ants, fog = w.fog, step = A.count > 2000 ? 3 : 1;
  for (let i = 0; i < A.high; i += step) {
    if (!A.state[i] || A.layer[i] !== 0) continue;
    if (A.col[i] !== AL.me() && fog && !fog.visibleAt(A.x[i], A.y[i])) continue;
    mm.fillStyle = A.col[i] === AL.me() ? '#2b1608' : '#ff3a22'; mm.fillRect(A.x[i] * k, A.y[i] * k, 1.6 * q, 1.6 * q);
  }
  // fog
  if (fog) {
    if (!drawMinimap.f || drawMinimap.f.width !== fog.w) { drawMinimap.f = AL.Art.canvas(fog.w, fog.h); drawMinimap.fi = drawMinimap.f.getContext('2d').createImageData(fog.w, fog.h); }
    const d = drawMinimap.fi.data; for (let i = 0; i < fog.n; i++) { d[i * 4] = 14; d[i * 4 + 1] = 16; d[i * 4 + 2] = 12; d[i * 4 + 3] = fog.vis[i] ? 0 : fog.seen[i] ? 110 : 225; }
    drawMinimap.f.getContext('2d').putImageData(drawMinimap.fi, 0, 0);
    mm.imageSmoothingEnabled = true; mm.drawImage(drawMinimap.f, 0, 0, W, H);
  }
  for (const c of w.colonies) {
    if (c.id !== AL.me() && fog && !fog.seenAt(c.x, c.y)) continue;
    mm.fillStyle = c.id === AL.me() ? '#f2c14e' : c.alive ? '#ff4a32' : '#777'; mm.strokeStyle = '#120d08'; mm.lineWidth = 2 * q;
    mm.beginPath(); mm.arc(c.x * k, c.y * k, 6.5 * q, 0, AL.TAU); mm.fill(); mm.stroke();
    if (c.id === AL.me()) { mm.strokeStyle = 'rgba(255,240,200,0.9)'; mm.lineWidth = 1.2 * q; mm.beginPath(); mm.arc(c.x * k, c.y * k, 9.5 * q, 0, AL.TAU); mm.stroke(); }
  }
  for (const c of w.colonies) for (const s of c.satellites || []) {
    if (s.state === 'ruin' || (c.id !== AL.me() && fog && !fog.seenAt(s.x, s.y))) continue;
    mm.fillStyle = c.id === AL.me() ? '#f2c14e' : '#ff4a32'; mm.beginPath(); mm.arc(s.x * k, s.y * k, 4 * q, 0, AL.TAU); mm.fill();
  }
  if (w.victory && w.victory.points) for (const p of w.victory.points) {
    mm.strokeStyle = p.owner == null || p.owner < 0 ? 'rgba(255,255,255,0.8)' : p.owner === AL.me() ? '#f2c14e' : '#ff4a32'; mm.lineWidth = 2.5 * q;
    mm.beginPath(); mm.arc(p.x * k, p.y * k, 6 * q, 0, AL.TAU); mm.stroke();
  }
  for (const cr of S.creatures) if (cr.alive && (!fog || fog.visibleAt(cr.x, cr.y))) { mm.fillStyle = '#e0e0ff'; mm.fillRect(cr.x * k - 2 * q, cr.y * k - 2 * q, 4 * q, 4 * q); }
  // extra minimap marks from other modules (combat-fx.js: battles), fn(ctx, world, scale)
  if (AL.MINIMAP_LAYERS) for (const f of AL.MINIMAP_LAYERS) { try { f(mm, w, k); } catch (e) { /* a broken layer must not stop the minimap */ } }
  // view rectangle
  if (r.view !== 'nest') { const v = r.viewRect(r.cam, 0); mm.strokeStyle = 'rgba(255,240,210,0.9)'; mm.lineWidth = 1.2 * q; mm.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k); }
}
function minimapClick(e) {
  const w = AL.Game.world, r = AL.Game.renderer; if (!w) return;
  const cv = $('minimap'), b = cv.getBoundingClientRect();
  const x = (e.clientX - b.left) / b.width * w.surface.W, y = (e.clientY - b.top) / b.height * w.surface.H;
  if (r.view === 'nest') { r.view = 'surface'; UI.onView('surface'); }
  r.cam.x = x; r.cam.y = y; r.clampCam(r.cam);
}

// active orders as chips above the tool bar (Collect circles, recruit paths); click the x to cancel
let ordSig = '';
function drawOrders(w) {
  const el = $('orders'), os = (w.player.orders || []).filter(o => !o.done), cs = (w.player.collects || []).filter(o => !o.done);
  const sig = os.map(o => o.id + ':' + o.arrived + '/' + o.assigned).join(',') + '|' + cs.map(o => o.id + ':' + o.foods.length + ':' + o.mi.length).join(',');
  if (sig === ordSig) return; ordSig = sig;
  el.innerHTML = cs.map(o => '<span class="chip" data-tip="Collect: ' + o.mi.length + ' of ' + o.want + ' ants on it, carrying the food in the circle home until it is gone. Right-click the circle or press the x to call it off.">Collect · ' + o.foods.length + ' left · ' + o.mi.length + ' ants <button data-uncollect="' + o.id + '" aria-label="Call off">&#10005;</button></span>').join('') + os.map(o => '<span class="chip" data-tip="Recruit order: ' + o.assigned + ' left the nest, ' + o.arrived + ' reached the end. Erase over the path or press the x to cancel.">Recruit ' + o.want + ' · ' + o.arrived + '/' + o.want + ' there <button data-cancel="' + o.id + '" aria-label="Cancel order">&#10005;</button></span>').join('');
}
function cancelCollect(id) {
  if (!AL.Game.world) return;
  AL.Cmd.issue('collectCancel', { id }, n => { UI.toast('Collect called off, ' + (n || 0) + ' ants heading home'); ordSig = ''; drawOrders(AL.Game.world); });
}
function cancelOrder(id) {
  const w = AL.Game.world; if (!w) return;
  AL.Cmd.issue('recruitCancel', { id }, n => { UI.toast('Recruit order cancelled, ' + (n || 0) + ' ants heading home'); ordSig = ''; drawOrders(AL.Game.world); });
}
// mower alarm button: lit while the alarm is on, blinking while the mower is on its way
UI.toggleRecall = function () {
  const w = AL.Game.world; if (!w || AL.Game.demo || !AL.WorldPOI || !w.poi) return;
  AL.Cmd.issue('recall', { on: !w.player.recall }, () => syncRecall(AL.Game.world));
};
function syncRecall(w) {
  const b = $('btnRecall'); if (!b) return;
  const M = w.poi && w.poi.human.mower;
  b.hidden = !M; if (!M) return;
  b.classList.toggle('on', !!w.player.recall);
  b.classList.toggle('warn', M.state === 'warn' || M.state === 'mow');
}
// sugar running low: warn about 2 minutes ahead and point at the nearest sugar the player has seen
let sugWarnT = -1e9;
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
function nearestSugar(w) {
  const c = w.player, fog = w.fog; let best = null, bd = 1e18;
  for (const f of w.surface.foods) {
    if (f.gone || f.amount < 3 || f.kind !== AL.CARRY.SUGAR || f.corpse) continue;
    if (fog && !fog.seenAt(f.x, f.y)) continue;
    const d = AL.dist2(f.x, f.y, c.x, c.y); if (d < 200 * 200) continue;   // already on the doorstep
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
function checkSugar(w) {
  const c = w.player, F = c.sugarFlow; if (!F || F.n < 20 || AL.Game.demo || (w.env && w.env.winter)) return;
  const net = F.inMin - F.outMin; if (net >= -0.2) return;
  const left = c.stock.sugar / -net; if (left > 2 || w.t - sugWarnT < 90) return;
  sugWarnT = w.t;
  const f = nearestSugar(w);
  let where = 'Scout for aphid plants, flowers or fallen fruit.';
  if (f) {
    const a = Math.atan2(f.y - c.y, f.x - c.x), dir = DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
    const what = { honeydew: 'aphid honeydew', nectar: 'flower nectar', fruit: 'fallen fruit', cookie: 'the picnic cookie' }[f.visual] || 'sugar crumbs';
    where = 'Nearest sugar you have found: ' + what + ', ' + Math.round(Math.hypot(f.x - c.x, f.y - c.y) / 10) * 10 + ' to the ' + dir + '. Paint a food trail [F] to it.';
  }
  UI.toast('Sugar runs out in about ' + Math.max(1, Math.round(left)) + ' min. ' + where, 'bad');
}
const baseInit = UI.init, baseNew = UI.onNewGame;
UI.init = function (game) {
  baseInit(game);
  $('orders').addEventListener('click', e => { const b = e.target.closest('[data-cancel]'); if (b) cancelOrder(+b.dataset.cancel); const u = e.target.closest('[data-uncollect]'); if (u) cancelCollect(+u.dataset.uncollect); });
  // right-click inside a Collect circle (or on a recruit path's end marker) to call it off
  $('cv').addEventListener('contextmenu', e => {
    const w = AL.Game.world, r = AL.Game.renderer; if (!w || r.view === 'nest') return;
    const p = r.screenToWorld(e.clientX, e.clientY);
    for (const o of w.player.collects || []) if (!o.done && AL.dist2(o.x, o.y, p.x, p.y) < o.r * o.r) { cancelCollect(o.id); return; }
    for (const o of w.player.orders || []) { const end = o.pts[o.pts.length - 1]; if (!o.done && AL.dist2(end.x, end.y, p.x, p.y) < 22 * 22) { cancelOrder(o.id); break; } }
  });
  $('minimap').addEventListener('pointerdown', e => { e.stopPropagation(); minimapClick(e); });
  if ($('btnRecall')) $('btnRecall').addEventListener('click', () => UI.toggleRecall());
};
UI.onNewGame = function (world, opts) {
  baseNew(world, opts);
  thumb = null; $('minimap').hidden = false;
  if ($('gameover')) $('gameover').hidden = true;
};
const baseExtra = UI.frameExtra;
UI.frameExtra = function (w, dt) {
  if (baseExtra) baseExtra(w, dt);
  mmT += dt; if (mmT > 0.25) { mmT = 0; drawMinimap(w); drawOrders(w); syncRecall(w); checkSugar(w); }
};
UI.showGameOver = UI.showGameOver || function (w, d) {
  let el = $('gameover');
  if (!el) { el = document.createElement('section'); el.id = 'gameover'; el.className = 'ov'; document.body.appendChild(el); }
  const c = w.player, mins = Math.floor(w.t / 60);
  el.innerHTML = '<div class="sheet"><h1>' + (d.win ? 'Victory' : 'The colony has fallen') + '</h1><p>' + d.reason + '</p>' +
    '<p class="mute">' + mins + ' minutes · ' + c.stats.born + ' ants raised · ' + Math.round(c.stats.kills) + ' enemies killed · ' + Math.round(c.stats.foodIn) + ' food brought home</p>' +
    '<div class="row"><button class="go" id="btnAgain">Play again</button></div></div>';
  el.hidden = false;
  $('btnAgain').onclick = () => { el.hidden = true; if (UI.showTitle) UI.showTitle(); else AL.Game.newGame({}); };
  AL.Game.paused = true; UI.syncSpeed();
};
})(window);
