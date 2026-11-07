// Underground fight inset: while your ants fight inside another colony's nest, a small window (bottom right) shows
// the fight under that mound, so you can watch it without leaving the surface.
// Rival nests are simulated as numbers (ai.js: col.siege = attackers by caste, col.inside = defenders); a person's
// nest in multiplayer is a real grid (ants on the NEST layer with A.nest = that colony). Either way the inset draws a
// little side view of a nest (tunnel, chambers, the queen at the bottom) with one ant per attacker and defender (up to
// a cap), fighting in pairs; ants fall as the numbers drop. "Go there" moves the camera to that mound; x hides it
// until that fight ends. Pure view: reads the world, never changes it.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, $ = id => document.getElementById(id), TAU = Math.PI * 2;
const W = 300, H = 170, CAP_ATT = 12, CAP_DEF = 14, ANT_K = 1.75;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- which fight to show -------------------------------------------------------------------------------------
function sum(a) { let n = 0; if (a) for (let k = 0; k < a.length; k++) n += a[k]; return n; }
// every nest my ants are fighting in right now: [{ col, att, def, queen }]
function fights(w) {
  const me = w.me || 0, out = [], A = w.ants, L = AL.LAYER;
  for (const o of (w.homes || w.colonies)) {   // colonies' nests and satellites' with their own
    if (!o || o.id === me || o.out || o.gone) continue;
    if (o.siege && !o.nest) {   // an AI rival's nest: numbers
      const att = sum(o.siege);
      if (o.siegeBy === me && att >= 0.5) {
        let def = 0; for (let k = 0; k < o.inside.length; k++) if (k !== AL.CASTE.QUEEN) def += o.inside[k];
        out.push({ col: o, att, def, queen: !!(o.queen && o.queen.alive), mix: o.siege, dmix: o.inside });
      }
    } else if (o.nest && A.nest) {   // a person's nest (multiplayer): real ants
      let att = 0, def = 0;
      for (let i = 0; i < A.high; i++) {
        if (!A.state[i] || A.layer[i] !== L.NEST || A.nest[i] !== (o.hid != null ? o.hid : o.id)) continue;
        if (A.col[i] === me) att++; else if (A.col[i] === o.id && A.caste[i] !== AL.CASTE.QUEEN) def++;
      }
      if (att >= 1) out.push({ col: o, att, def, queen: !!(o.queen && o.queen.alive) });
    }
  }
  return out.sort((a, b) => b.att - a.att);
}

// ---- the little nest ----------------------------------------------------------------------------------------
const bgs = {};
function background(o) {
  if (bgs[o.id]) return bgs[o.id];
  const c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d'); x.scale(2, 2);
  const h = (k, s) => AL.hash2(o.id * 7 + 3, k, s);
  // soil, darker with depth, with a few pebbles
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#6a4a2c'); g.addColorStop(1, '#2e1f12');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 60; k++) { x.fillStyle = 'rgba(' + (120 + h(k, 1) * 60 | 0) + ',' + (95 + h(k, 2) * 40 | 0) + ',70,' + (0.15 + h(k, 3) * 0.2).toFixed(2) + ')'; x.beginPath(); x.ellipse(h(k, 4) * W, 22 + h(k, 5) * (H - 22), 1 + h(k, 6) * 2.5, 1 + h(k, 7) * 1.8, h(k, 8) * 3, 0, TAU); x.fill(); }
  // the surface: grass and the mound
  x.fillStyle = '#4f7a34'; x.fillRect(0, 0, W, 14);
  x.fillStyle = '#7a5634'; x.beginPath(); x.moveTo(W / 2 - 46, 15); x.quadraticCurveTo(W / 2, -10, W / 2 + 46, 15); x.closePath(); x.fill();
  // tunnels and chambers (the dug-out space is a warm dark brown)
  const cav = '#1b120a', ch = chambers(o);
  x.strokeStyle = cav; x.lineCap = 'round'; x.lineWidth = 9;
  x.beginPath(); x.moveTo(W / 2, 4); x.lineTo(ch[0].x, ch[0].y); for (let k = 1; k < ch.length; k++) { x.moveTo(ch[0].x, ch[0].y); x.lineTo(ch[k].x, ch[k].y); } x.stroke();
  x.fillStyle = cav; for (const q of ch) { x.beginPath(); x.ellipse(q.x, q.y, q.rx, q.ry, 0, 0, TAU); x.fill(); }
  // soft edges
  x.strokeStyle = 'rgba(140,100,60,.35)'; x.lineWidth = 1.2; for (const q of ch) { x.beginPath(); x.ellipse(q.x, q.y, q.rx + 1, q.ry + 1, 0, 0, TAU); x.stroke(); }
  return (bgs[o.id] = c);
}
// [hall under the entrance, two side chambers, the queen's chamber at the bottom]
function chambers(o) {
  const h = k => AL.hash2(o.id * 11 + 5, k, 9);
  return [
    { x: W / 2, y: 58, rx: 44, ry: 15 },
    { x: 52 + h(1) * 18, y: 86 + h(2) * 12, rx: 34, ry: 13 },
    { x: W - 52 - h(3) * 18, y: 92 + h(4) * 10, rx: 34, ry: 13 },
    { x: W / 2 + (h(5) - 0.5) * 30, y: 136, rx: 40, ry: 14, queen: true },
  ];
}

// ---- the ants ------------------------------------------------------------------------------------------------
let cur = null, ants = [], hidden = {}, endMsg = '', endT = 0, el = null, cv = null, ctx = null, t = 0, lastSig = '';
const pal = c => Object.assign({}, c.sp, c.colours || {});
function pickCaste(mix, k) {
  // a caste for the k-th ant on a side, in proportion to the mix (soldiers and majors drawn first: they hold the tunnels)
  if (!mix) return AL.CASTE.WORKER;
  const order = [AL.CASTE.MAJOR, AL.CASTE.SOLDIER, AL.CASTE.WORKER, AL.CASTE.FORAGER, AL.CASTE.SCOUT, AL.CASTE.NURSE];
  const tot = order.reduce((a, c) => a + (mix[c] || 0), 0) || 1;
  let acc = 0; const f = (k + 0.5) / 24;
  for (const c of order) { acc += (mix[c] || 0) / tot; if (f < acc) return c; }
  return AL.CASTE.WORKER;
}
function sync(f) {
  const ch = chambers(f.col), want = { att: Math.min(CAP_ATT, Math.round(f.att)), def: Math.min(CAP_DEF, Math.round(f.def)) };
  for (const side of ['att', 'def']) {
    const live = ants.filter(a => a.side === side && !a.dead);
    if (live.length < want[side]) for (let k = live.length; k < want[side]; k++) {
      const q = side === 'att' ? null : ch[k % 3];
      ants.push({ side, caste: pickCaste(side === 'att' ? f.mix : f.dmix, k), dead: 0, wait: side === 'att' ? (k - live.length) * 0.35 : 0, home: k % 3,
        x: side === 'att' ? W / 2 + (Math.random() - 0.5) * 6 : q.x + (Math.random() - 0.5) * q.rx * 1.4,
        y: side === 'att' ? 8 + Math.random() * 6 : q.y + (Math.random() - 0.5) * q.ry, a: side === 'att' ? Math.PI / 2 : Math.random() * TAU, fr: Math.random() * 4 });
    } else for (let k = want[side]; k < live.length; k++) live[k].dead = 0.001;   // the fallen
  }
}
function step(f, dt) {
  const ch = chambers(f.col), att = ants.filter(a => a.side === 'att' && !a.dead), def = ants.filter(a => a.side === 'def' && !a.dead);
  const queenSpot = ch[3];
  // pairs: the k-th attacker goes for the k-th defender (so the fight spreads through the tunnels), a defender stands
  // its ground in its chamber until an attacker comes close
  for (const a of ants) {
    if (a.dead) { a.dead += dt; continue; }
    if (a.wait > 0) { a.wait -= dt; a.y = 6; continue; }
    const mine = a.side === 'att' ? att : def, foes = a.side === 'att' ? def : att, k = mine.indexOf(a);
    let tx, ty, best = foes.length ? foes[k % foes.length] : null;
    if (best && a.side === 'def') { let bd = 1e9; for (const b of foes) { const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2; if (d < bd) { bd = d; best = b; } } if (bd > 40 * 40) best = null; }
    if (best) { tx = best.x; ty = best.y; }
    else if (a.side === 'att' && f.queen) { const g = (k * 2.4) % TAU; tx = queenSpot.x + Math.cos(g) * 22; ty = queenSpot.y + Math.sin(g) * 9; }
    else { const q = ch[a.home]; const g = (k * 1.7) % TAU; tx = q.x + Math.cos(g) * q.rx * 0.6; ty = q.y + Math.sin(g) * q.ry * 0.5; }
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (d > (best ? 8 : 2)) {
      a.a = Math.atan2(dy, dx); const sp = (a.side === 'att' ? 34 : 20) * dt;
      a.x += dx / d * Math.min(sp, d - 6); a.y += dy / d * Math.min(sp, d - 6); a.fr += dt * 10; a.bite = false;
    } else { a.a = Math.atan2(dy, dx) + Math.sin(t * 20 + a.x) * 0.25; a.bite = true; }
    // stay in the dug-out space
    a.y = AL.clamp(a.y, 6, H - 6); a.x = AL.clamp(a.x, 6, W - 6);
  }
  // nobody stacks on one spot
  for (let i = 0; i < ants.length; i++) for (let j = i + 1; j < ants.length; j++) {
    const p = ants[i], q = ants[j]; if (p.dead || q.dead) continue;
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (d < 9) { const k = (9 - d) * 0.5; p.x -= dx / d * k; p.y -= dy / d * k; q.x += dx / d * k; q.y += dy / d * k; }
  }
  ants = ants.filter(a => !a.dead || a.dead < 1.6);
}
function draw(w, f) {
  const x = ctx, dpr = cv.width / W;
  x.setTransform(dpr, 0, 0, dpr, 0, 0);
  x.drawImage(background(f.col), 0, 0, W, H);
  const me = w.colonies[w.me || 0], P = { att: pal(me), def: pal(f.col) };
  // the queen in her chamber
  const ch = chambers(f.col);
  if (f.queen) { x.save(); x.translate(ch[3].x, ch[3].y); x.rotate(Math.PI); x.scale(ANT_K * 1.1, ANT_K * 1.1); AL.Art.drawAnt(x, AL.CASTE.QUEEN, P.def, (t * 2) | 0); x.restore(); }
  const team = { att: AL.Colonies ? AL.Colonies.team(w.me || 0) : '#f2c14e', def: AL.Colonies ? AL.Colonies.team(f.col.id) : '#e0503a' };
  for (const a of ants) {
    if (a.wait > 0) continue;
    const sz = Math.min(1.35, (AL.CASTES[a.caste] ? AL.CASTES[a.caste].size : 1) * ((a.side === 'att' ? me : f.col).sp.size || 1));
    if (!a.dead) { x.fillStyle = team[a.side]; x.globalAlpha = 0.55; x.beginPath(); x.ellipse(a.x, a.y + 1.5, 6.5 * sz, 3.2 * sz, 0, 0, TAU); x.fill(); x.globalAlpha = 1; }
    x.save(); x.translate(a.x, a.y);
    if (a.dead) { x.globalAlpha = Math.max(0, 1 - a.dead / 1.6); x.rotate(a.a); x.scale(1, -1); }   // on its back, fading
    else x.rotate(a.a);
    x.scale(ANT_K * sz, ANT_K * sz);
    AL.Art.drawAnt(x, a.caste, P[a.side], a.dead ? 0 : (a.fr | 0));
    x.restore();
    if (a.bite && !a.dead && Math.sin(t * 13 + a.x * 3) > 0.9) { x.fillStyle = 'rgba(255,235,180,.9)'; x.beginPath(); x.arc(a.x + Math.cos(a.a) * 9, a.y + Math.sin(a.a) * 9, 1.8, 0, TAU); x.fill(); }
  }
  if (endMsg) { x.fillStyle = 'rgba(14,9,5,.62)'; x.fillRect(0, H / 2 - 16, W, 32); x.fillStyle = '#ffe7b0'; x.font = '600 14px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(endMsg, W / 2, H / 2); }
}

// ---- a real nest (rivals with tunnels, sim opts.rivalNests; a person's nest in multiplayer) ---------------------
// drawn by the main renderer's own nest painter into this little canvas: a view object that inherits everything
// from the renderer and only swaps the canvas, the camera and the nest
let rv = null;
function drawReal(w, f) {
  const r = AL.Game && AL.Game.renderer;
  if (!r || !r.drawNest || !f.col.nest) return false;
  if (!rv || Object.getPrototypeOf(rv) !== r) rv = Object.create(r);
  const nest = f.col.nest;
  if (rv._for !== (f.col.hid != null ? f.col.hid : f.col.id)) {
    rv._for = f.col.hid != null ? f.col.hid : f.col.id; rv.nestCol = f.col; rv.nest = nest;
    const c = r._nc && r._nc[f.col.hid != null ? f.col.hid : f.col.id];
    if (c) { rv.soilCv = c.soilCv; rv.cavCv = c.cavCv; }
    else {
      rv.soilCv = r.paintSoil(nest); rv.cavCv = AL.Art.canvas(nest.cols * nest.tile * 2, nest.rows * nest.tile * 2);
      if (r._nc) r._nc[f.col.hid != null ? f.col.hid : f.col.id] = { soilCv: rv.soilCv, cavCv: rv.cavCv, cavVer: -1 };
    }
    rv.cavVer = -1; rv.cavAt = 0;
  }
  rv.ctx = ctx; rv.w = cv.width; rv.h = cv.height; rv.dpr = cv.width / W;
  // look where the fight is: the middle of your ants down there (else the queen's chamber)
  const A = w.ants, me = w.me || 0; let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === AL.LAYER.NEST && A.nest[i] === (f.col.hid != null ? f.col.hid : f.col.id) && A.col[i] === me) { sx += A.x[i]; sy += A.y[i]; n++; }
  if (!n) { const q = nest.tiles[AL.Nest.CH.QUEEN]; if (q && q.length) { const [qx, qy] = AL.Nest.centre(nest, q[0]); sx = qx; sy = qy; n = 1; } else { sx = nest.cols * nest.tile / 2; sy = 120; n = 1; } }
  const tx = sx / n, ty = sy / n, cam = rv._cam || (rv._cam = { x: tx, y: ty, z: 1.05 });
  cam.x += (tx - cam.x) * 0.08; cam.y += (ty - cam.y) * 0.08;
  try { rv.drawNest(ctx, cam, 1, 1); } catch (e) { console.error(e); return false; }
  return true;
}
function zoomIn() {
  const G = AL.Game, r = G && G.renderer, w = G && G.world; if (!r || !w || cur == null) return;
  const o = (w.homes || w.colonies)[cur]; if (!o || !o.nest || !r.setNestCol) return;
  if (r.view === 'nest') { r.setNestCol(o); if (UI.onView) UI.onView('nest'); }
  else r.goNest(o);
}

// ---- the panel -------------------------------------------------------------------------------------------------
function ensure() {
  if (el) return;
  const s = document.createElement('style');
  s.textContent = '#fightInset{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:12px;width:' + W + 'px;max-width:calc(100vw - 24px);z-index:30;padding:8px;border-radius:12px}' +
    '#fightInset header{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:var(--fs-s,13px)}#fightInset header b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '#fightInset header button{padding:2px 8px;font-size:var(--fs-xs,11px)}#fightInset canvas{display:block;width:100%;height:auto;border-radius:8px;background:#2e1f12}' +
    '#fightInset .tally{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:var(--fs-xs,11px);color:var(--mute)}#fightInset .tally b{color:var(--fg,#f4ead6);font-variant-numeric:tabular-nums}' +
    '#fightInset .tug{flex:1;height:6px;border-radius:3px;background:var(--bad,#c4291b);overflow:hidden}#fightInset .tug i{display:block;height:100%;background:var(--good,#7bc96f)}';
  document.head.appendChild(s);
  el = document.createElement('section'); el.id = 'fightInset'; el.className = 'panel'; el.hidden = true;
  el.innerHTML = '<header><b id="fiTitle"></b><button id="fiGo" data-tip="Move the camera to this nest">Go there</button><button id="fiX" data-tip="Hide until this fight ends" aria-label="Close">&times;</button></header>' +
    '<canvas id="fiCv" width="' + W * 2 + '" height="' + H * 2 + '"></canvas><div class="tally" id="fiTally"></div>';
  document.body.appendChild(el);
  cv = $('fiCv'); ctx = cv.getContext('2d');
  cv.addEventListener('click', zoomIn);
  $('fiX').onclick = () => { if (cur != null) hidden[cur] = true; el.hidden = true; };
  $('fiGo').onclick = () => {
    const G = AL.Game, w = G && G.world, r = G && G.renderer; if (!w || cur == null || !r) return;
    const o = (w.homes || w.colonies)[cur]; if (r.view === 'nest') { r.view = 'surface'; if (UI.onView) UI.onView('surface'); }
    r.cam.x = o.x; r.cam.y = o.y; r.clampCam(r.cam);
  };
}
// sit above the bottom tool bar when it reaches this far right, else in the corner
function place() {
  const b = $('bottom'), r = b && b.getBoundingClientRect(), rc = $('right'), rr = rc && rc.getBoundingClientRect();
  const narrow = innerWidth < 760;
  // wide screens: just left of the right-hand column, above the tool bar; phones: full width above the tool bar
  const right = !narrow && rr && rr.width > 2 ? Math.round(innerWidth - rr.left + 10) : 12;
  el.style.right = right + 'px';
  el.style.bottom = (r && r.height > 2 ? Math.round(innerHeight - r.top + 10) : 12) + 'px';
}
addEventListener('resize', () => { if (el && !el.hidden) place(); });
function spName(o) { return (o.sp && o.sp.name) || 'rival'; }
function frame(w, dt) {
  if (!w || w.demo || (AL.Game && AL.Game.demo)) { if (el) el.hidden = true; return; }
  t += dt;
  const list = fights(w);
  const key = o => (o.hid != null ? o.hid : o.id);
  for (const k of Object.keys(hidden)) if (!list.some(f => key(f.col) === +k)) delete hidden[k];
  let f = list.find(q => !hidden[key(q.col)]) || null;
  if (!f && cur != null && endT > 0) {   // the fight just ended: hold the last picture a moment with the result
    endT -= dt; const o = (w.homes || w.colonies)[cur];
    if (endT <= 0 || !o) { cur = null; ants = []; endMsg = ''; if (el) el.hidden = true; return; }
    if (o.nest && drawReal(w, { col: o })) { const x = ctx; x.setTransform(cv.width / W, 0, 0, cv.width / W, 0, 0); x.fillStyle = 'rgba(14,9,5,.62)'; x.fillRect(0, H / 2 - 16, W, 32); x.fillStyle = '#ffe7b0'; x.font = '600 14px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(endMsg, W / 2, H / 2); return; }
    step({ col: o, queen: !!(o.queen && o.queen.alive) }, dt); draw(w, { col: o, queen: !!(o.queen && o.queen.alive) });
    return;
  }
  if (!f) {
    if (cur != null && !hidden[cur]) {
      const o = (w.homes || w.colonies)[cur];
      endMsg = !o || o.out || (o.queen && !o.queen.alive) ? 'The nest has fallen' : 'Your ants were driven out';
      for (const a of ants) if (a.side === (endMsg === 'The nest has fallen' ? 'def' : 'att') && !a.dead) a.dead = 0.001;
      endT = 3;
      return;
    }
    cur = null; if (el) el.hidden = true; return;
  }
  ensure();
  if (cur !== key(f.col)) { cur = key(f.col); ants = []; endMsg = ''; endT = 0; }   // (cur: the nest id)
  if (el.hidden) place();
  el.hidden = false;
  cv.style.cursor = f.col.nest ? 'zoom-in' : 'default'; cv.title = f.col.nest ? 'Tap to go down into this nest' : '';
  if (!drawReal(w, f)) { sync(f); step(f, Math.min(dt, 0.05)); draw(w, f); }
  const sig = key(f.col) + ':' + Math.round(f.att) + ':' + Math.round(f.def) + ':' + f.queen + ':' + list.length;
  if (sig !== lastSig) {
    lastSig = sig;
    $('fiTitle').textContent = (f.col.sat ? 'Fight in a ' + spName(f.col) + ' satellite nest' : 'Fight in the ' + spName(f.col) + ' nest') + (list.length > 1 ? ' (+' + (list.length - 1) + ' more)' : '');
    const a = Math.round(f.att), d = Math.round(f.def), share = a + d > 0 ? a / (a + d) : 1;
    $('fiTally').innerHTML = 'Yours <b>' + a + '</b><span class="tug"><i style="width:' + (share * 100).toFixed(0) + '%"></i></span><b>' + d + '</b> defenders' + (d < 1 && f.queen ? ' &middot; <b>at the queen</b>' : '');
  }
}
const baseExtra = UI.frameExtra;
UI.frameExtra = function (w, dt) { if (baseExtra) baseExtra(w, dt); try { frame(w, dt); } catch (e) { console.error(e); } };
AL.FightInset = { fights };
})(window);
