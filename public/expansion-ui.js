// Antlands expansion stage UI (browser only):
// - top-centre strip: the key points (owner + capture ring) and every colony's hold meter
// - bottom-left "Royal chamber" panel: raise winged queens / males, nuptial flight, satellites,
//   deep-tunnelling research (a node of the Evolution tree, research.js) and raid tunnels, rally
// - map tools (L flight, K raid tunnel, G rally) through AL.Tools, with a live preview on the map
// - toasts for the big moments, and the victory / defeat screen with a colony summary
// All DOM lives under #exp-ui.
(function (root) {
'use strict';
const AL = root.AL, X = AL.Expansion, V = AL.Victory, C = AL.CASTE;
if (!X || !V) return;
const clock = V.clock;
const fmt = v => v >= 10000 ? (v / 1000).toFixed(0) + 'k' : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.floor(v).toString();
const team = id => X.TEAM[id % X.TEAM.length];
const G = () => AL.Game;
const W = () => G() && G().world;

const CSS = `
#exp-ui{position:fixed;inset:0;pointer-events:none;z-index:4;font:13px/1.35 system-ui,"Segoe UI",sans-serif;color:var(--ink,#f3e9d2)}
#exp-ui .panel{pointer-events:auto}
#exp-hold{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:6px 14px}
.exp-hold{display:flex;align-items:center;gap:14px;font-size:13px}
#w-expHold{padding:6px 14px}
.exp-hold .pts{display:flex;gap:8px}
.exp-hold .pip{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;position:relative}
.exp-hold .pip i{width:20px;height:20px;border-radius:50%;background:#2a1f15;border:1px solid rgba(0,0,0,.5);display:grid;place-items:center;font:700 10px system-ui;color:#2a1a0c}
.exp-hold .pip.contested{animation:exppulse .6s infinite alternate}
@keyframes exppulse{from{filter:brightness(1)}to{filter:brightness(1.6)}}
.exp-hold .meters{display:flex;flex-direction:column;gap:3px;min-width:190px}
.exp-hold .m{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--mute,#bfae8f)}
.exp-hold .m .xsw{width:8px;height:8px;border-radius:50%}
.exp-hold .m .tr{flex:1;height:7px;border-radius:4px;background:rgba(0,0,0,.45);overflow:hidden;border:1px solid rgba(255,255,255,.06)}
.exp-hold .m .tr b{display:block;height:100%;border-radius:4px;transition:width .4s}
.exp-hold .m .n{font-variant-numeric:tabular-nums;min-width:30px;text-align:right;color:var(--ink,#f3e9d2)}
.exp-hold .cap{font-size:11px;color:var(--mute,#bfae8f);max-width:150px;line-height:1.25}
#exp-royal{position:absolute;left:10px;bottom:10px;width:290px;display:flex;flex-direction:column;gap:6px;box-sizing:border-box}
#exp-royal h3{cursor:pointer;margin:0;font:700 13px system-ui;letter-spacing:.02em;color:var(--gold,#f2c14e);display:flex;justify-content:space-between;align-items:baseline}
#exp-royal h3 small{font-weight:500;color:var(--mute,#bfae8f);font-size:11px}
#exp-royal .xrow{display:flex;gap:6px;min-width:0}
#exp-royal .xrow button{flex:1 1 0;min-width:0;display:block;white-space:normal;padding:6px 8px;font-size:12px;text-align:left;line-height:1.2;margin:0}
#exp-royal .xrow button small{display:block;color:var(--mute,#bfae8f);font-size:10.5px;margin:2px 0 0;white-space:normal}
#exp-royal button:disabled{opacity:.45;cursor:default;filter:none}
#exp-royal button.gold{border-color:var(--gold,#f2c14e);background:#5a4219}
#exp-royal .xbar{position:relative;height:16px;border-radius:5px;background:rgba(0,0,0,.4);overflow:hidden;font-size:10.5px}
#exp-royal .xbar b{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,#8a6a2a,#f2c14e)}
#exp-royal .xbar span{position:relative;padding-left:6px;line-height:16px;text-shadow:0 1px 2px #000}
#exp-royal .xnote{font-size:11px;color:var(--mute,#bfae8f)}
#exp-royal .xsat{display:flex;align-items:center;gap:6px;font-size:11.5px}
#exp-royal .xsat i{width:8px;height:8px;border-radius:50%}
#exp-royal .xsat .xhp{flex:1;height:4px;border-radius:2px;background:rgba(0,0,0,.45);overflow:hidden}
#exp-royal .xsat .xhp b{display:block;height:100%}
#exp-royal .xsep{height:1px;background:var(--line,rgba(214,170,110,.28));margin:2px 0}
#exp-end{position:absolute;inset:0;display:grid;place-items:center;background:radial-gradient(ellipse at center,rgba(10,7,4,.55),rgba(10,7,4,.88));pointer-events:auto;opacity:0;transition:opacity .8s}
#exp-end.show{opacity:1}
#exp-end .card{width:min(720px,94vw);padding:22px 26px;text-align:center;border-radius:16px}
#exp-end canvas{width:150px;height:150px;display:block;margin:-6px auto 2px}
#exp-end h1{margin:0;font:800 40px/1.1 Georgia,"Times New Roman",serif;letter-spacing:.04em}
#exp-end h1.win{color:var(--gold,#f2c14e);text-shadow:0 0 24px rgba(242,193,78,.35)}
#exp-end h1.lose{color:#d9cfc0}
#exp-end .reason{margin:6px 0 14px;color:var(--mute,#bfae8f);font-size:14px}
#exp-end table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
#exp-end th{font-weight:600;color:var(--mute,#bfae8f);font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:4px 6px;border-bottom:1px solid var(--line,rgba(214,170,110,.28))}
#exp-end td{padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.05)}
#exp-end td:first-child,#exp-end th:first-child{text-align:left}
#exp-end td .xsw{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}
#exp-end tr.out td{color:#8d8273}
#exp-end .time{margin-top:10px;color:var(--mute,#bfae8f);font-size:12px}
#exp-end .btns{display:flex;gap:10px;justify-content:center;margin-top:16px}
#exp-end .btns button{padding:9px 18px}
@media (max-width:700px){#exp-royal{width:calc(100vw - 24px);bottom:110px}#exp-hold{top:auto;bottom:170px}}
`;

let root$ = null, hold$ = null, royal$ = null, end$ = null, acc = 0, lastHold = '', lastRoyal = '', endShown = false;
const U = AL.ExpansionUI = { preview: null, rallyN: 12, endScreen: true };   // endScreen: false if the core shows its own game-over screen

function el(tag, attrs, html) { const e = document.createElement(tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }
function ensure() {
  if (root$) return;
  const st = el('style', {}, CSS); st.id = 'exp-style'; document.head.appendChild(st);
  root$ = el('div', { id: 'exp-ui' });
  hold$ = el('div', { id: 'exp-hold', class: 'panel' });
  royal$ = el('div', { id: 'exp-royal', class: 'panel' });
  root$.append(hold$, royal$); document.body.appendChild(root$);
  // pointerdown: acts on press, so a panel refresh between down and up can't eat the click
  royal$.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-fold]')) { U.folded = !U.folded; lastRoyal = ''; const w = W(); if (w) refresh(w, true); return; }
    const b = e.target.closest('button[data-x]'); if (!b || b.disabled) return; e.preventDefault(); act(b.dataset.x);
  });
}
function toast(text) { if (AL.UI && AL.UI.toast) AL.UI.toast(text); }
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
// select one of our map tools through the core UI when it can (it also flips nest view back to the surface)
function selectTool(id) {
  if (id && AL.UI && AL.UI.pickTool) return AL.UI.pickTool(id);
  if (AL.Tools && AL.Tools.select) AL.Tools.select(id);
}
const KEYS = { KeyL: 'xflight', KeyK: 'xtunnel', KeyY: 'xrally' };
window.addEventListener('keydown', e => {
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  const g = G(), id = KEYS[e.code];
  if (!id || !g || !g.world || !g.world.exp || g.scene || e.ctrlKey || e.metaKey || e.altKey) return;
  const cur = AL.Tools && AL.Tools.current;
  selectTool(cur && cur.id === id ? null : id);
});

function act(x) {
  const w = W(); if (!w || !w.exp) return;
  const me = w.me || 0;
  if (x === 'queen' || x === 'male') { const why = X.canRaise(w, me, x).why; AL.Cmd.issue('royal', { kind: x }, ok => { if (!ok) toast(why); lastRoyal = ''; const w2 = W(); if (w2) refresh(w2, true); }); }
  else if (x === 'keep') { const c = w.colonies[me], why = AL.Life.canAdopt(w, c, 'royal').why; AL.Cmd.issue('adoptQueen', {}, ok => { if (!ok) toast(why); lastRoyal = ''; const w2 = W(); if (w2) refresh(w2, true); }); }
  else if (x === 'fly') selectTool('xflight');
  else if (x === 'research') { const why = X.canResearch(w, me).why; AL.Cmd.issue('tunnelResearch', {}, ok => { if (!ok) toast(why); }); }
  else if (x === 'tunnel') selectTool('xtunnel');
  else if (x === 'rally') selectTool('xrally');
  lastRoyal = ''; refresh(w, true);
}

// ---- map tools ------------------------------------------------------------------------------------
function nestUnder(w, x, y) {
  let best = null, bd = 70 * 70;
  for (const t of X.tunnelTargets(w, (w.me || 0))) { const d = AL.dist2(t.x, t.y, x, y); if (d < bd) { bd = d; best = t; } }
  if (best && w.fog && !w.fog.seenAt(best.x, best.y)) return null;
  return best;
}
function registerTools() {
  if (!AL.Tools || !AL.Tools.TOOLS) return;
  const T = AL.Tools.TOOLS;
  T.xflight = { id: 'xflight', name: 'Nuptial flight', key: 'KeyL', layer: 'surface',
    tip: 'Click anywhere on the map: a winged queen flies there and founds a satellite nest. (Army ants: the new queen walks there with part of the colony.)',
    hover(x, y) { const w = W(); if (!w) return; const c = w.player.royal.queens > 0 ? X.siteCheck(w, (w.me || 0), x, y) : { ok: false, why: w.player.sp.nomad ? 'No new queen waiting' : 'No winged queen waiting' }; U.preview = { kind: 'flight', x, y, ok: c.ok, why: c.why }; },
    paint(phase, x, y) {
      if (phase !== 'start') return;
      const w = W(); if (!w) return;
      if (w.player.royal.queens < 1) { toast(w.player.sp.nomad ? 'Raise a new queen first.' : 'Raise a winged queen first.'); return; }
      const c = X.siteCheck(w, (w.me || 0), x, y);
      if (!c.ok) { toast(c.why); return; }
      AL.Cmd.issue('launch', { x, y }); U.preview = null; selectTool(null);
    } };
  T.xtunnel = { id: 'xtunnel', name: 'Raid tunnel', key: 'KeyK', layer: 'surface',
    tip: 'Click a rival nest: your diggers tunnel under the lawn and a raid party breaks into it.',
    hover(x, y) {
      const w = W(); if (!w) return;
      const t = nestUnder(w, x, y);
      if (!t) { U.preview = { kind: 'tunnel', x, y, ok: false }; return; }
      const p = X.tunnelPlan(w, (w.me || 0), t.col, t.sat);
      U.preview = { kind: 'tunnel', x, y, ok: p.ok, why: p.why, target: t, from: p.from || X.homeOf(w.player, t.x, t.y), eta: p.eta || 0 };
    },
    paint(phase, x, y) {
      if (phase !== 'start') return;
      const w = W(); if (!w) return;
      const t = nestUnder(w, x, y); if (!t) { toast('Click a rival nest.'); return; }
      const p = X.tunnelPlan(w, (w.me || 0), t.col, t.sat); if (!p.ok) { toast(p.why); return; }
      AL.Cmd.issue('tunnel', { tcol: t.col, sat: t.sat == null ? null : t.sat }); U.preview = null; selectTool(null);
    } };
  T.xrally = { id: 'xrally', name: 'Rally', key: 'KeyY', layer: 'surface',
    tip: 'Click a spot (a key point, a satellite): your nearest idle fighters go and hold it for 90 s.',
    hover(x, y) { U.preview = { kind: 'rally', x, y, r: 45, n: U.rallyN, ok: true }; },
    paint(phase, x, y) {
      if (phase !== 'start') return;
      const w = W(); if (!w) return;
      const V0 = w.victory, p = V0 && V0.points.find(q => AL.dist2(q.x, q.y, x, y) < q.r * q.r);
      AL.Cmd.issue('garrison', { x: p ? p.x : x, y: p ? p.y : y, r: p ? p.r * 0.7 : 45, n: U.rallyN, secs: 90 }, n => toast(n ? n + ' ants rallying' + (p ? ' to the ' + p.name.toLowerCase() : '') + '.' : 'No idle ants outside to send.'));
    } };
}
// ---- HUD refresh ------------------------------------------------------------------------------------
function holdHtml(w) {
  const Vv = w.victory; if (!Vv) return '';
  const active = w.t >= Vv.activeAt, n = Vv.points.length, need = Math.floor(n / 2) + 1;
  let pts = '';
  for (const p of Vv.points) {
    const who = p.owner >= 0 ? p.owner : p.capper, deg = Math.round((who >= 0 ? p.prog : 0) * 360);
    const ring = who >= 0 ? 'conic-gradient(' + team(who) + ' ' + deg + 'deg, rgba(0,0,0,.45) 0)' : 'rgba(0,0,0,.45)';
    const fill = p.owner >= 0 ? team(p.owner) : '#2a1f15';
    const letter = p.kind === 'spill' ? 'P' : p.kind === 'rock' ? 'R' : p.kind === 'grove' ? 'G' : p.kind === 'mound' ? 'T' : 'A';
    const gives = (p.srcs || []).map(f => (f.kind === AL.CARRY.PROTEIN ? 'protein' : 'sugar')).join(' + ');
    pts += '<div class="pip' + (p.contested ? ' contested' : '') + '" title="' + p.name + (gives && !Vv.holdWin ? ': ' + gives + ' spring' + (p.owner >= 0 ? ' (held by ' + (p.owner === AL.me() ? 'you' : 'a rival') + ')' : '') : '') + '" style="background:' + ring + '"><i style="background:' + fill + ';color:' + (p.owner >= 0 ? '#2a1a0c' : '#bfae8f') + '">' + letter + '</i></div>';
  }
  if (!Vv.holdWin) {   // key points are food springs: who holds what, no win meters
    const ME = AL.me(), mine = Vv.points.filter(p => p.owner === ME);
    let food = 0; for (const p of mine) for (const f of p.srcs || []) food += f.amount;
    const cap = !active ? 'Key points wake in <b>' + clock(Vv.activeAt - w.t) + '</b>: then they refill with food' :
      mine.length ? 'You hold <b>' + mine.length + '</b> of ' + n + ' food springs (' + Math.floor(food) + ' food waiting)' : 'Hold a key point: only the holder\'s ants can harvest its food';
    return '<div class="exp-hold"><div class="pts">' + pts + '</div><div class="cap" style="max-width:220px">' + cap + '</div></div>';
  }
  // colonies stage: with up to 8 colonies show you and the two rivals closest to winning (the rest as a count)
  let ms = '';
  const ME = AL.me(), live = w.colonies.filter(c => !c.out), rivals = live.filter(c => c.id !== ME).sort((a, b) => Vv.hold[b.id] - Vv.hold[a.id] || a.id - b.id);
  const shown = live.filter(c => c.id === ME).concat(rivals.slice(0, w.mp ? 3 : 2));
  for (const c of shown) {
    const h = Vv.hold[c.id], f = Math.min(100, h / Vv.holdTime * 100);
    ms += '<div class="m"><span class="xsw" style="background:' + team(c.id) + '"></span>' + (c.id === ME ? 'You' : c.isPlayer && c.name ? esc(c.name) : 'Rival' + (w.colonies.length > 2 ? ' ' + c.id : '')) +
      '<div class="tr"><b style="width:' + f.toFixed(1) + '%;background:' + team(c.id) + '"></b></div><span class="n">' + clock(Vv.holdTime - h) + '</span></div>';
  }
  const cut = w.mp ? 3 : 2; if (rivals.length > cut) ms += '<div class="m more">+' + (rivals.length - cut) + ' more rival' + (rivals.length > cut + 1 ? 's' : '') + '</div>';
  const cap = active ? 'Hold ' + need + ' of ' + n + ' key points to fill your meter' : 'Key points wake in <b>' + clock(Vv.activeAt - w.t) + '</b>';
  return '<div class="exp-hold"><div class="pts">' + pts + '</div><div class="meters">' + ms + '</div><div class="cap">' + cap + '</div></div>';
}
function btn(x, label, sub, chk, cls) {
  const dis = chk && !chk.ok;
  return '<button data-x="' + x + '"' + (dis ? ' disabled title="' + (chk.why || '') + '"' : '') + (cls ? ' class="' + cls + '"' : '') + '>' + label + '<small>' + (dis && chk.why ? chk.why : sub) + '</small></button>';
}
function royalHtml(w) {
  const c = w.player, R = X.CFG.royal, pop = X.totalPop(c);
  let h = '<h3 data-fold>Royal chamber <small>' + pop + ' ants ' + (U.folded ? '&#9656;' : '&#9662;') + '</small></h3>';
  if (U.folded) return h;
  if (c.out) return h + '<div class="xnote">Your colony has no queen left.</div>';
  if (!c.queen.alive) h += '<div class="xnote" style="color:#ff9a7a">Your queen is dead! ' + (c.royal.queens ? 'Launch a winged queen [L] to found a nest and save the colony.' : 'A queen in flight is your last hope.') + '</div>';
  const army = c.sp.nomad, minPop = army ? X.CFG.split.minPop : R.minPop;
  if (pop < minPop && !c.royal.queens && !c.royal.queue.length) {
    h += '<div class="xnote">' + (army ? 'Army ant queens have no wings and there is no mating flight. At ' + minPop + ' ants the colony can raise a new queen and split: part of the colony follows her to start a second bivouac.' : 'Winged queens and males unlock at ' + R.minPop + ' ants. Raise them late, fly them out, and found satellite nests anywhere on the map.') + '</div>';
    const bar = Math.min(100, pop / minPop * 100);
    h += '<div class="xbar"><b style="width:' + bar + '%"></b><span>' + pop + ' / ' + minPop + ' ants</span></div>';
  } else if (army) {
    h += '<div class="xrow">' + btn('queen', 'New queen', R.queen.protein + 'P ' + R.queen.sugar + 'S, ' + clock(R.queen.time) + ' (no wings)', X.canRaise(w, (w.me || 0), 'queen')) + '</div>';
    for (const q of c.royal.queue) h += '<div class="xbar"><b style="width:' + (q.t / q.dur * 100).toFixed(1) + '%"></b><span>New queen, ' + clock(q.dur - q.t) + '</span></div>';
    if (c.royal.queens) h += '<div class="xrow">' + btn('fly', 'Split the colony [L]', 'about ' + Math.round(X.CFG.split.share * 100) + '% of the ants follow her to a new bivouac', { ok: X.satCount(w, (w.me || 0)) < X.CFG.sat.max && pop >= minPop, why: pop < minPop ? 'Needs ' + minPop + ' ants' : 'Max ' + X.CFG.sat.max + ' colonies' }, 'gold') + '</div>';
  } else {
    h += '<div class="xrow">' + btn('queen', 'Winged queen', R.queen.protein + 'P ' + R.queen.sugar + 'S, ' + clock(R.queen.time), X.canRaise(w, (w.me || 0), 'queen')) +
      btn('male', 'Male', R.male.protein + 'P ' + R.male.sugar + 'S, speeds founding', X.canRaise(w, (w.me || 0), 'male')) + '</div>';
    for (const q of c.royal.queue) h += '<div class="xbar"><b style="width:' + (q.t / q.dur * 100).toFixed(1) + '%"></b><span>' + (q.sex === 'queen' ? 'Winged queen' : 'Male') + ' pupa, ' + clock(q.dur - q.t) + '</span></div>';
    if (c.royal.queens || c.royal.males) h += '<div class="xnote">On the mound: <b>' + c.royal.queens + '</b> queen' + (c.royal.queens === 1 ? '' : 's') + ', <b>' + c.royal.males + '</b> male' + (c.royal.males === 1 ? '' : 's') + '</div>';
    if (c.royal.queens) h += '<div class="xrow">' + btn('fly', 'Nuptial flight [L]', 'pick a landing spot anywhere', { ok: X.satCount(w, (w.me || 0)) < X.CFG.sat.max, why: 'Max ' + X.CFG.sat.max + ' satellites' }, 'gold') +
      (c.sp.polygyne && AL.Life ? btn('keep', 'Keep at home', 'becomes another laying queen', AL.Life.canAdopt(w, c, 'royal')) : '') + '</div>';
  }
  // polygyne species (fire ants): extra laying queens in the main nest
  if (c.sp.polygyne && AL.Life) h += '<div class="xnote">Laying queens in the nest: <b>' + AL.Life.queenCount(c) + '</b> / ' + AL.Life.maxQueens(c) + (c.royal.queens ? '' : '. Keep a winged queen at home to add one.') + '</div>';
  const sats = c.satellites.filter(s => s.state !== 'ruin');
  const fl = w.exp.flights.filter(f => f.col === AL.me());
  if (sats.length || fl.length) {
    h += '<div class="xsep"></div><div class="xnote">Satellites ' + X.satCount(w, (w.me || 0)) + ' / ' + X.CFG.sat.max + '</div>';
    for (const f of fl) h += '<div class="xsat"><i style="background:' + team(0) + '"></i>Queen in flight, ' + f.phase + '</div>';
    for (const s of sats) {
      const st = s.state === 'founding' ? 'founding ' + Math.round(s.found * 100) + '%' : s.state === 'orphan' ? 'old nest, no queen' : (s.kids.length / 2) + ' ants' + (s.siteName ? ', ' + s.siteName : '');
      const hp = s.state === 'founding' ? s.queen.hp / s.queen.maxHp : s.hp / s.maxHp;
      h += '<div class="xsat"><i style="background:' + (s.state === 'orphan' ? '#5a4c3c' : team(0)) + '"></i>' + st + (s.underAttack > 0 ? ' <b style="color:#ff7a5a">under attack</b>' : '') +
        '<div class="xhp"><b style="width:' + (hp * 100).toFixed(0) + '%;background:' + (hp > 0.5 ? '#9be36a' : hp > 0.25 ? '#f2c14e' : '#ff5a3a') + '"></b></div></div>';
    }
  }
  // late research: deep tunnelling and raid tunnels (not for army ants: they dig nothing)
  h += '<div class="xsep"></div>';
  const T = X.CFG.tunnel;
  if (c.sp.nomad) return h + '<div class="xnote">Army ants dig no tunnels: their raids sweep over the open ground [Z].</div><div class="xrow">' + btn('rally', 'Rally [Y]', 'send ' + U.rallyN + ' fighters to hold a spot') + '</div>';
  // research.js: deep tunnelling is a node of the Evolution tree [J]; this button starts it directly
  if (c.research.tunnel < 1 && !(c.research.busy && c.research.cur === 'tunnel')) h += '<div class="xrow">' + btn('research', 'Research deep tunnelling', T.research.protein + 'P ' + T.research.sugar + 'S, ' + clock(T.research.time) + ': dig raid tunnels', X.canResearch(w, (w.me || 0))) + '</div>';
  else if (c.research.tunnel < 1) h += '<div class="xbar"><b style="width:' + (c.research.tunnel * 100).toFixed(1) + '%"></b><span>Deep tunnelling, ' + clock(T.research.time - c.research.t) + '</span></div>';
  else {
    const dig = w.exp.tunnels.find(t => t.col === AL.me() && t.state === 'dig');
    if (dig) h += '<div class="xbar"><b style="width:' + (dig.prog * 100).toFixed(1) + '%;background:linear-gradient(90deg,#5a3a1c,#c08a50)"></b><span>Raid tunnel, ' + dig.crew.length + ' ants, ' + clock((1 - dig.prog) * dig.len / (T.speed * (c.sp.dig || 1))) + ' to breach</span></div>';
    else h += '<div class="xrow">' + btn('tunnel', 'Dig raid tunnel [K]', T.cost.protein + 'P ' + T.cost.sugar + 'S, ' + T.diggers + ' diggers + ' + T.party + ' raiders', { ok: X.tunnelTargets(w, (w.me || 0)).length > 0, why: 'No rival nest left' }) + '</div>';
  }
  h += '<div class="xrow">' + btn('rally', 'Rally [Y]', 'send ' + U.rallyN + ' fighters to hold a spot') + '</div>';
  return h;
}
let widget = false;
function refresh(w, force) {
  ensure();
  // the hold strip lives in the core's top bar when the core UI offers widgets, else in our own panel
  if (!widget && AL.UI && AL.UI.addWidget && document.getElementById('topbar')) { AL.UI.addWidget('expHold', { where: 'top', every: 0.25, html: ww => ww && ww.victory ? holdHtml(ww) : '' }); widget = true; hold$.hidden = true; }
  if (!widget) { const hh = holdHtml(w); if (hh !== lastHold || force) { hold$.innerHTML = hh; lastHold = hh; } }
  const rh = royalHtml(w); if (rh !== lastRoyal || force) { royal$.innerHTML = rh; lastRoyal = rh; }
}

// ---- toasts for the big moments -------------------------------------------------------------------
const say = (type, fn) => AL.on(type, (w, d) => { if (w === W()) { const s = fn(d, w); if (s) toast(s); } });
say('royalEmerged', d => d.col === AL.me() ? (d.sex === 'queen' ? 'A winged queen is ready on the mound. Press L to send her on her nuptial flight.' : 'A winged male joins the royals on the mound.') : null);
say('royalTakeoff', (d, w) => d.col === AL.me() ? 'Nuptial flight! Your queen takes to the air.' : (!w.fog || w.fog.visibleAt(d.x, d.y)) ? 'A rival queen takes to the air!' : null);
say('satelliteFounded', d => d.col === AL.me() ? 'Satellite nest founded: its own queen, food store and workers. Pick it in the Nests tabs (top left) to give orders from it.' : null);
say('satelliteLost', d => d.col === AL.me() ? 'A satellite nest has fallen.' : d.by === AL.me() ? 'You destroyed a rival satellite nest!' : null);
say('nestUnderAttack', d => d.col === AL.me() ? (d.sat ? 'A satellite nest is under attack!' : 'Your nest is under attack!') : null);
say('queenTakeover', d => d.col === AL.me() ? 'Your queen is dead. Long live the queen: a satellite queen takes over the colony.' : 'A rival queen died, but a satellite queen took her place.');
say('colonyOut', d => d.col === AL.me() ? null : 'A rival colony has lost its last queen.');
say('colonySplit', d => d.col === AL.me() ? 'The colony splits: ' + d.n + ' ants follow the new queen to start a second bivouac.' : null);
say('researchDone', d => d.col === AL.me() && d.what === 'tunnel' ? 'Deep tunnelling learned. Press K and pick a rival nest to dig a raid tunnel.' : null);
say('tunnelStarted', d => d.col === AL.me() ? 'Diggers go underground. Breakthrough in about ' + clock(d.eta) + '.' : null);
say('tunnelTremor', d => d.target === AL.me() ? 'Tremors under your nest! A rival raid tunnel is about to break through. Rally fighters there.' : d.col === AL.me() ? 'Your raid tunnel is nearly through.' : null);
say('tunnelBreach', d => d.col === AL.me() ? 'Breach! Your raiders burst into the rival nest.' : d.target === AL.me() ? 'Rival raiders have broken into your nest! They are heading for the queen.' : null);
say('pointCaptured', d => d.col === AL.me() ? 'You captured the ' + d.name.toLowerCase() + '.' : null);
// a rival's capture and our losses are bad news: red toasts that name who did it (kp-alerts.js adds the banners)
const rivalName = (w, c) => { const o = w.colonies[c]; return o ? (o.isPlayer && o.name ? o.name : 'The ' + o.sp.name.toLowerCase()) : 'A rival'; };
AL.on('pointCaptured', (w, d) => { if (w === W() && d.col !== AL.me() && AL.UI && AL.UI.toast) AL.UI.toast(rivalName(w, d.col) + ' captured the ' + d.name.toLowerCase() + '!', 'bad'); });
AL.on('pointLost', (w, d) => { if (w === W() && d.col === AL.me() && AL.UI && AL.UI.toast) AL.UI.toast('You lost the ' + d.name.toLowerCase() + ' to ' + rivalName(w, d.by).replace(/^The /, 'the ') + '!', 'bad'); });

// ---- victory / defeat screen --------------------------------------------------------------------------
function crest(cv, win, pal) {
  const dpr = Math.min(2, root.devicePixelRatio || 1), S = 150;
  cv.width = S * dpr; cv.height = S * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const cx = S / 2, cy = S / 2 + 4;
  const g = x.createRadialGradient(cx, cy, 4, cx, cy, 70);
  g.addColorStop(0, win ? 'rgba(242,193,78,0.45)' : 'rgba(150,140,125,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  // laurel: two arcs of leaves
  const leaf = win ? ['#f2c14e', '#c99a2e'] : ['#8d8273', '#6d6356'];
  for (const side of [-1, 1]) for (let k = 0; k < 9; k++) {
    const a = Math.PI / 2 + side * (0.5 + k * 0.27), rr = 56, lx = cx + Math.cos(a) * rr, ly = cy + Math.sin(a) * rr;
    x.save(); x.translate(lx, ly); x.rotate(a + side * 1.2); x.fillStyle = leaf[k & 1];
    x.beginPath(); x.ellipse(0, 0, 9, 3.6, 0, 0, Math.PI * 2); x.fill(); x.restore();
  }
  // the queen, head up (a fallen one for a defeat)
  x.save(); x.translate(cx + 4, cy); x.rotate(-Math.PI / 2); x.scale(5.2, 5.2);
  if (!win) x.globalAlpha = 0.85;
  AL.Art.drawAnt(x, C.QUEEN, win ? pal : { body: '#5a5248', head: '#4a433a', gaster: '#3a342e' }, 0, { dead: !win });
  x.restore();
  if (win) AL.ExpansionArt && AL.ExpansionArt.drawCrown(x, cx, 22, 11, '#f2c14e', true);
}
function showEnd(w) {
  if (endShown || !w.over || !U.endScreen) return;
  endShown = true;
  ensure();
  const o = w.over, sm = o.summary || V.summary(w), win = o.win;
  end$ = el('div', { id: 'exp-end' });
  const rows = sm.rows.map(r => '<tr class="' + (r.out ? 'out' : '') + '"><td><span class="xsw" style="background:' + r.colour + '"></span>' + r.name + (r.out ? ' (gone)' : '') + '</td><td>' + fmt(r.peakPop) + '</td><td>' + fmt(r.food) + '</td><td>' + r.queensRaised + '</td><td>' + r.satellites + '</td><td>' + r.nestsRazed + '</td><td>' + clock(r.hold) + '</td></tr>').join('');
  end$.innerHTML = '<div class="card panel"><canvas></canvas><h1 class="' + (win ? 'win' : 'lose') + '">' + (win ? 'Victory' : 'Defeat') + '</h1>' +
    '<div class="reason">' + o.reason + '</div>' +
    '<table><thead><tr><th>Colony</th><th>Peak pop.</th><th>Food gathered</th><th>Queens raised</th><th>Satellites</th><th>Nests razed</th><th>Points held</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="time">Game time ' + sm.time + '</div>' +
    '<div class="btns"><button data-e="watch">Keep watching</button><button data-e="again" class="on">New game</button></div></div>';
  root$.appendChild(end$);
  crest(end$.querySelector('canvas'), win, w.player.colours);
  end$.addEventListener('click', e => {
    const b = e.target.closest('[data-e]'); if (!b) return;
    const g = G();
    if (b.dataset.e === 'watch') { end$.remove(); end$ = null; g.paused = false; if (AL.UI && AL.UI.syncSpeed) AL.UI.syncSpeed(); }
    else { end$.remove(); end$ = null; if (AL.UI && AL.UI.showTitle) AL.UI.showTitle(); else if (g.startFlow && AL.SCENES && AL.SCENES.length) g.startFlow({}); else g.newGame({}); }
  });
  requestAnimationFrame(() => end$ && end$.classList.add('show'));
}
// the core UI calls UI.showGameOver(world, over) after a game ends: ours replaces it (richer summary);
// set AL.ExpansionUI.endScreen = false to keep the core's. Without a core screen we listen ourselves.
if (AL.UI && AL.UI.showGameOver) {
  const core = AL.UI.showGameOver;
  AL.UI.showGameOver = function (w, d) {
    if (!U.endScreen) return core.apply(this, arguments);
    showEnd(w);
    const g = G(); if (g) { g.paused = true; if (AL.UI.syncSpeed) AL.UI.syncSpeed(); }
  };
  U.coreGameOver = true;
}
AL.on('gameOver', (w) => { if (!U.coreGameOver && w === W()) setTimeout(() => showEnd(w), 1400); });
// dev / try-it switch: ?play&late starts a colony already in the late game (big colony, food, a winged
// queen and a male on the mound, key points waking after a minute)
function lateStart(w) {
  if (!w || !w.exp || w.opts.bench) return;
  const c = w.player;
  if (AL.Sim.spawnBench) AL.Sim.spawnBench(w, 90);
  for (let k = 0; k < 10; k++) { const a = w.R() * AL.TAU; w.ants.spawn(0, C.SOLDIER, 0, c.x + Math.cos(a) * 60, c.y + Math.sin(a) * 60, a, w.R); }
  AL.Sim.countPop(w);
  Object.assign(c.stock, { sugar: 300, protein: 250 });
  c.royal.queens = 1; c.royal.males = 1;
  if (w.victory) w.victory.activeAt = w.t + 60;
  for (const o of w.colonies) if (!o.isPlayer) { o.stock.protein += 200; o.stock.sugar += 200; if (o.inside) o.inside[C.WORKER] += 60; }
}
U.lateStart = lateStart;
AL.on('worldCreated', (w) => { try { if (new URLSearchParams(location.search).has('late')) setTimeout(() => lateStart(w), 0); } catch (_) {} });
AL.on('worldCreated', () => { endShown = false; if (end$) { end$.remove(); end$ = null; } lastHold = lastRoyal = ''; U.preview = null; });

// ---- per frame (piggybacks on the core UI frame) --------------------------------------------------------
function frame(w, dt) {
  if (!w || !w.exp) { if (root$) root$.hidden = true; return; }
  ensure(); root$.hidden = false;
  acc += dt; if (acc < 0.25) return; acc = 0;
  refresh(w);
}
let lastNow = 0;
function install() {
  registerTools();
  // refresh from the core's 'screen' render layer: once per drawn frame, no patching of AL.UI
  const sys = AL.SYSTEMS.find(q => q.id === 'expansion');
  if (sys) {
    sys.render = sys.render || {};
    sys.render.screen = (ctx, view, r) => {
      const now = performance.now(), dt = lastNow ? Math.min(0.25, (now - lastNow) / 1000) : 0; lastNow = now;
      const cur = AL.Tools && AL.Tools.current;
      if (!cur || !/^x(flight|tunnel|rally)$/.test(cur.id)) U.preview = null;
      try { frame(r.world, dt); } catch (e) { console.error('[expansion-ui]', e); }
    };
  }
}
U.install = install; U.refresh = refresh; U.showEnd = showEnd; U.frame = frame;
install();
})(window);
