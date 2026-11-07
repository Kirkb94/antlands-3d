// Key point alerts: make the objectives (victory.js key points) impossible to miss while playing.
//  - A warning bar under the top bar whenever a rival is taking a key point (a free one, or one of yours),
//    with who, which, and how far along, plus a soft alarm. Click it to look at the point.
//  - A big red banner in the middle of the screen, with a louder repeating alarm and a red edge glow, when it's
//    serious: a rival is taking the point that would give them the majority (or all of them), your last point is
//    falling, or a rival's hold meter will fill within a minute.
//  - Arrows at the screen edge point to every key point under attack that's off screen; on screen the point
//    gets a pulsing ring.
//  - Heads-up 60 and 10 seconds before the key points wake.
// Browser only: reads world.victory, changes nothing in the sim. Sounds: audio.js listens for kpWarn / kpDanger /
// kpCritical / kpWake (emitted here, for this PC only).
(function (root) {
'use strict';
const AL = root.AL, TAU = Math.PI * 2;
const TEAM = () => (AL.Expansion && AL.Expansion.TEAM) || ['#f2c14e', '#e0503a', '#4aa3df', '#a678de', '#3fbfa0', '#f08a3c', '#e86fa8', '#9ccc4a'];
const team = id => TEAM()[((id % TEAM().length) + TEAM().length) % TEAM().length];
const clock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function nameOf(w, c) {
  const o = w.colonies[c]; if (!o) return 'A rival';
  if (o.isPlayer && o.name) return o.name;
  return 'The ' + o.sp.name.toLowerCase() + (w.colonies.length > 2 ? ' (rival ' + c + ')' : '');
}
const ptName = p => 'the ' + p.name.toLowerCase();
// "The fire ants are", "Kirk is": species names are plural, a person's name isn't
const is = (w, c) => { const o = w.colonies[c]; return o && o.isPlayer && o.name ? ' is ' : ' are '; };
const has = (w, c) => { const o = w.colonies[c]; return o && o.isPlayer && o.name ? ' has ' : ' have '; };
const holds = (w, c) => { const o = w.colonies[c]; return o && o.isPlayer && o.name ? ' holds ' : ' hold '; };
const wins = (w, c) => { const o = w.colonies[c]; return o && o.isPlayer && o.name ? 'wins' : 'win'; };

let S = null;   // per world: previous progress per point, threats this frame, timers
function state(w) {
  if (S && S.w === w) return S;
  S = { w, prev: {}, threats: [], warnAt: {}, critAt: -99, woke: {}, focus: null, crit: null, warn: null };
  return S;
}
// who is pushing hardest on point p (other than the owner): the colony with the most weighted ants on it
function pusher(w, p, not) {
  let best = -1, bv = 0;
  for (let c = 0; c < p.pres.length; c++) if (c !== not && p.pres[c] > bv) { bv = p.pres[c]; best = c; }
  return best;
}
// work out what's going on at every key point (4 times a second)
function assess(w) {
  const V = w.victory, st = state(w), ME = AL.me(), n = V.points.length, need = Math.floor(n / 2) + 1;
  const owned = c => V.points.filter(p => p.owner === c).length;
  const threats = [];
  if (w.t < V.activeAt) { st.threats = threats; return; }
  for (const p of V.points) {
    const was = st.prev[p.id] != null ? st.prev[p.id] : p.prog; st.prev[p.id] = p.prog;
    // a rival taking one of ours: our hold shrinks while someone else stands on it
    if (p.owner === ME && p.prog < 0.999 && p.prog <= was) {
      const by = pusher(w, p, ME); if (by < 0) continue;
      const last = owned(ME) === 1;
      threats.push({ p, by, kind: 'ours', left: p.prog, last, crit: V.holdWin && (last || owned(by) + 1 >= need) });   // (food springs: a warning, not a crisis)
    } else if (p.owner < 0 && p.capper >= 0 && p.capper !== ME && p.prog > 0.02 && p.prog >= was) {
      // a rival taking a free point: serious if it gives them the majority, or all of them
      const have = owned(p.capper), win = have + 1 >= need;
      threats.push({ p, by: p.capper, kind: 'free', prog: p.prog, crit: V.holdWin && win, all: have + 1 === n });
    } else if (p.owner >= 0 && p.owner !== ME && p.contested) {
      threats.push({ p, by: p.owner, kind: 'fight', crit: false });
    }
  }
  // a rival already holding the majority: their meter is filling
  if (V.holdWin) for (const c of w.colonies) {   // (campaign: the hold meter can win)
    if (c.id === ME || c.out) continue;
    const o = owned(c.id); if (o * 2 <= n) continue;
    const rate = o === n ? (V.cfg ? V.cfg.allBonus : 1.5) : 1, left = (V.holdTime - V.hold[c.id]) / rate;
    threats.push({ p: V.points.find(q => q.owner !== c.id) || V.points[0], by: c.id, kind: 'meter', left, owned: o, n, crit: left < 60 || o === n });
  }
  st.threats = threats;
}

// ---- DOM: the warning bar and the critical banner ----------------------------------------------------------
function el(id, cls, parent) {
  let e = document.getElementById(id);
  if (!e) { e = document.createElement('div'); e.id = id; e.className = cls; (parent || document.body).appendChild(e); e.addEventListener('click', () => { const s = S, t = e._focus; if (s && t && AL.Game && AL.Game.renderer) { const r = AL.Game.renderer; if (r.view === 'nest' && r.goSurface) r.goSurface(); r.cam.x = t.x; r.cam.y = t.y; if (r.clampCam) r.clampCam(r.cam); } }); }
  return e;
}
function style() {
  if (document.getElementById('kp-style')) return;
  const s = document.createElement('style'); s.id = 'kp-style';
  s.textContent =
    '#kpWarn{position:fixed;left:50%;transform:translateX(-50%);z-index:21;display:flex;flex-direction:column;gap:4px;align-items:center;max-width:min(560px,calc(100vw - 32px));pointer-events:none}' +
    '#kpWarn .kw{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:10px;background:rgba(60,34,10,.96);border:1px solid rgba(255,170,70,.8);border-left:6px solid #ffaa3c;border-radius:10px;padding:6px 12px;font:600 var(--fs-m,14px)/1.3 system-ui,sans-serif;color:#fff1dc;box-shadow:0 6px 18px rgba(0,0,0,.5)}' +
    '#kpWarn .kw.ours{background:rgba(70,18,10,.97);border-color:rgba(255,100,70,.9);border-left-color:#ff5a3a;color:#ffe2d8}' +
    '#kpWarn .kw i{flex:none;width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.35)}' +
    '#kpWarn .kw .bar{flex:none;width:70px;height:6px;border-radius:3px;background:rgba(0,0,0,.4);overflow:hidden}#kpWarn .kw .bar b{display:block;height:100%}' +
    '#kpWarn .kw small{opacity:.8;font-weight:500}' +
    '#kpCrit{position:fixed;left:50%;top:120px;transform:translateX(-50%);z-index:22;pointer-events:auto;cursor:pointer;text-align:center;min-width:min(440px,calc(100vw - 32px));max-width:calc(100vw - 32px);background:rgba(90,8,4,.96);border:2px solid #ff4a2a;border-radius:14px;padding:14px 22px 12px;color:#fff;box-shadow:0 0 0 4px rgba(255,60,30,.25),0 12px 40px rgba(0,0,0,.6);animation:kpPulse 1s ease-in-out infinite}' +
    '#kpCrit[hidden]{display:none}#kpCrit h2{margin:0 0 4px;font:800 calc(22px * var(--k,1))/1.1 system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#ffd9cc}' +
    '#kpCrit p{margin:0 0 8px;font:600 var(--fs-m,15px)/1.35 system-ui,sans-serif}#kpCrit .bar{height:10px;border-radius:5px;background:rgba(0,0,0,.45);overflow:hidden;margin:0 0 6px}#kpCrit .bar b{display:block;height:100%}' +
    '#kpCrit small{opacity:.85;font:500 var(--fs-s,13px)/1.3 system-ui,sans-serif}' +
    '#kpEdge{position:fixed;inset:0;pointer-events:none;z-index:19;box-shadow:inset 0 0 90px 20px rgba(255,30,10,.55);animation:kpPulse 1s ease-in-out infinite}#kpEdge[hidden]{display:none}' +
    '@keyframes kpPulse{0%,100%{opacity:1}50%{opacity:.72}}' +
    '@media (prefers-reduced-motion: reduce){#kpCrit,#kpEdge{animation:none}}';
  document.head.appendChild(s);
}
function threatLine(w, t) {
  const who = nameOf(w, t.by), c = team(t.by), p = t.p;
  if (t.kind === 'ours') return { cls: 'ours', c, text: who + is(w, t.by) + 'taking <b>' + esc(ptName(p)) + '</b> from you', sub: Math.round(t.left * 100) + '% left', f: t.left, col: '#ff6a4a' };
  if (t.kind === 'free') return { cls: '', c, text: who + is(w, t.by) + 'capturing <b>' + esc(ptName(p)) + '</b>', sub: Math.round(t.prog * 100) + '%', f: t.prog, col: c };
  if (t.kind === 'fight') return { cls: '', c, text: 'Fighting at <b>' + esc(ptName(p)) + '</b>', sub: 'take it back', f: null };
  return { cls: 'ours', c, text: who + holds(w, t.by) + '<b>' + t.owned + ' of ' + t.n + '</b> key points', sub: (is(w, t.by) === ' is ' ? 'wins' : 'they win') + ' in ' + clock(t.left), f: null };
}
function safeArea() {
  const b = id => { const e = document.getElementById(id); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 ? r : null; };
  const L = b('left'), Rt = b('right'), T = b('topbar'), B = b('bottom'), Wn = b('kpWarn'), Cr = b('kpCrit');
  return { l: L ? L.right : 0, r: Rt ? Rt.left : innerWidth, t: Math.max(T ? T.bottom : 0, Wn ? Wn.bottom : 0, Cr ? Cr.bottom : 0), b: B ? B.top : innerHeight };
}
function render(w) {
  style();
  const st = state(w), hud = document.getElementById('hud');
  const warnEl = el('kpWarn', '', document.body), critEl = el('kpCrit', '', document.body), edge = el('kpEdge', '', document.body);
  const tb = document.getElementById('topbar'), r = tb && tb.getBoundingClientRect();
  warnEl.style.top = Math.round(r && r.height > 4 ? r.bottom + 8 : 58) + 'px';
  if (!hud || hud.hidden || (AL.Game && AL.Game.demo) || (w.over)) { warnEl.innerHTML = ''; critEl.hidden = true; edge.hidden = true; return; }
  // the toasts move down below the warnings
  const toasts = document.getElementById('toasts');
  const th = st.threats;
  // critical first: the worst one gets the banner
  const crit = th.filter(t => t.crit).sort((a, b) => (a.kind === 'meter' ? a.left / 60 : a.kind === 'ours' ? a.left : 1 - a.prog) - (b.kind === 'meter' ? b.left / 60 : b.kind === 'ours' ? b.left : 1 - b.prog))[0];
  if (crit) {
    const who = nameOf(w, crit.by), p = crit.p;
    let h, msg, f = null, fc = team(crit.by);
    if (crit.kind === 'meter') { h = crit.owned === crit.n ? 'Every key point is lost' : 'A rival is about to win'; msg = who + holds(w, crit.by) + crit.owned + ' of ' + crit.n + ' key points and ' + wins(w, crit.by) + ' in <b>' + clock(crit.left) + '</b>. Take one back!'; f = 1 - Math.min(1, crit.left / Math.max(1, w.victory.holdTime)); }
    else if (crit.kind === 'ours') { h = crit.last ? 'Your last key point is falling' : 'Key point falling'; msg = who + is(w, crit.by) + 'taking <b>' + esc(ptName(p)) + '</b>' + (crit.last ? ', the last one you hold' : '') + '. Only <b>' + Math.round(crit.left * 100) + '%</b> left!'; f = crit.left; fc = '#ff6a4a'; }
    else { h = crit.all ? 'Last key point under attack' : 'Rival taking the majority'; msg = who + is(w, crit.by) + 'capturing <b>' + esc(ptName(p)) + '</b> (' + Math.round(crit.prog * 100) + '%). If ' + (is(w, crit.by) === ' is ' ? 'they get' : 'they get') + ' it they ' + (crit.all ? 'hold every key point' : 'hold most of the key points') + ' and their hold meter starts filling.'; f = crit.prog; }
    critEl.innerHTML = '<h2>&#9888; ' + h + '</h2><p>' + msg + '</p>' + (f != null ? '<div class="bar"><b style="width:' + Math.round(f * 100) + '%;background:' + fc + '"></b></div>' : '') + '<small>Rally fighters there now [Y] &middot; click to look</small>';
    critEl._focus = p; critEl.hidden = false; edge.hidden = false;
  } else { critEl.hidden = true; edge.hidden = true; }
  // the rest as warning lines (at most three)
  const rest = th.filter(t => t !== crit).slice(0, 3);
  warnEl.innerHTML = rest.map((t, k) => { const L = threatLine(w, t); return '<div class="kw ' + L.cls + '" data-k="' + k + '"><i style="background:' + L.c + '"></i><span>' + L.text + ' <small>' + L.sub + '</small></span>' + (L.f != null ? '<span class="bar"><b style="width:' + Math.round(L.f * 100) + '%;background:' + L.col + '"></b></span>' : '') + '</div>'; }).join('');
  [...warnEl.children].forEach((d, k) => { d.onclick = () => { const p = rest[k] && rest[k].p, R = AL.Game && AL.Game.renderer; if (p && R) { if (R.view === 'nest' && R.goSurface) R.goSurface(); R.cam.x = p.x; R.cam.y = p.y; if (R.clampCam) R.clampCam(R.cam); } }; });
  if (!critEl.hidden) { const wb = warnEl.getBoundingClientRect(); critEl.style.top = Math.round((warnEl.children.length ? wb.bottom : wb.top) + 10) + 'px'; }
  if (toasts) toasts.style.marginTop = warnEl.children.length || !critEl.hidden ? (Math.max(warnEl.getBoundingClientRect().bottom, critEl.hidden ? 0 : critEl.getBoundingClientRect().bottom) - warnEl.getBoundingClientRect().top + 6) + 'px' : '';
  st.safe = safeArea();
}
// sounds and toasts on the moments that matter (throttled per point)
function sounds(w) {
  const st = state(w), V = w.victory, t = w.t;
  // the wake-up countdown
  const left = V.activeAt - t;
  for (const s of [60, 10]) if (left <= s && left > s - 2 && !st.woke[s]) { st.woke[s] = true; AL.emit(w, 'kpWake', { left: s }); if (AL.UI && AL.UI.toast) AL.UI.toast('The key points wake in ' + s + ' seconds. Get fighters onto them [Y].', 'bad'); }
  for (const th of st.threats) {
    const key = th.kind + ':' + th.p.id + ':' + th.by;
    if (th.crit) { if (t - st.critAt >= 4) { st.critAt = t; AL.emit(w, 'kpCritical', { point: th.p.id }); } continue; }
    if (th.kind === 'fight' || th.kind === 'meter') continue;
    if (st.warnAt[key] != null && t - st.warnAt[key] < 20) continue;
    st.warnAt[key] = t;
    AL.emit(w, th.kind === 'ours' ? 'kpDanger' : 'kpWarn', { point: th.p.id, by: th.by });
  }
}

// ---- on the map: edge arrows to threatened points off screen, a pulsing ring on screen ------------------------
function drawScreen(ctx, view, r) {
  const w = r.world, V = w && w.victory; if (!V || !S || S.w !== w || !S.threats.length || r.view === 'nest') return;
  const wv = r.lastView; if (!wv) return;
  const dpr = view.dpr || 1, W = view.w, H = view.h, pad = 34 * dpr, t = view.frame / 60;
  // arrows sit inside the part of the screen the HUD doesn't cover
  const sa = S.safe || { l: 0, r: W / dpr, t: 0, b: H / dpr }, x0 = sa.l * dpr + pad, x1 = Math.max(x0 + 10, sa.r * dpr - pad), y0 = sa.t * dpr + pad, y1 = Math.max(y0 + 10, sa.b * dpr - pad);
  const seen = new Set();
  for (const th of S.threats) {
    const p = th.p; if (seen.has(p.id)) continue; seen.add(p.id);
    const sx = p.x * wv.z + wv.ox, sy = p.y * wv.z + wv.oy, col = th.crit ? '#ff3a1a' : th.kind === 'ours' ? '#ff6a4a' : '#ffaa3c';
    ctx.save();
    if (sx > x0 && sx < x1 && sy > y0 && sy < y1) {
      const rr = p.r * wv.z * (1.05 + 0.08 * Math.sin(t * 6));
      ctx.strokeStyle = col; ctx.globalAlpha = 0.85; ctx.lineWidth = (th.crit ? 5 : 3) * dpr; ctx.setLineDash([14 * dpr, 10 * dpr]); ctx.lineDashOffset = -t * 40 * dpr;
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.stroke();
    } else {
      // an arrow on the screen edge, pointing the way, with the point's name and distance
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = Math.atan2(sy - cy, sx - cx);
      const k = Math.min(Math.abs((x1 - x0) / 2 / (Math.cos(a) || 1e-6)), Math.abs((y1 - y0) / 2 / (Math.sin(a) || 1e-6)));
      const ex = cx + Math.cos(a) * k, ey = cy + Math.sin(a) * k, s = (th.crit ? 20 : 15) * dpr * (1 + 0.12 * Math.sin(t * 7));
      ctx.translate(ex, ey); ctx.rotate(a);
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s * 0.75); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.7, s * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(-a);
      const lab = p.name + (th.kind === 'ours' ? ' (yours)' : '');
      ctx.font = '700 ' + (12 * dpr) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lx = -Math.cos(a) * s * 2.2, ly = -Math.sin(a) * s * 2.2, tw = ctx.measureText(lab).width + 10 * dpr;
      ctx.fillStyle = 'rgba(20,10,6,.85)'; ctx.fillRect(lx - tw / 2, ly - 9 * dpr, tw, 18 * dpr);
      ctx.fillStyle = '#fff1dc'; ctx.fillText(lab, lx, ly);
    }
    ctx.restore();
  }
}

let acc = 0, last = 0;
function frame() {
  const w = AL.Game && AL.Game.world;
  if (w && w.victory && !(AL.Game && AL.Game.demo)) {
    const now = performance.now(); acc += now - (last || now); last = now;
    if (acc >= 250) { acc = 0; assess(w); render(w); sounds(w); }
  } else { last = 0; const c = document.getElementById('kpCrit'), e = document.getElementById('kpEdge'), wn = document.getElementById('kpWarn'); if (c) c.hidden = true; if (e) e.hidden = true; if (wn) wn.innerHTML = ''; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
AL.registerSystem({ id: 'kp-alerts', order: 31, enabled: () => true, render: { screen: drawScreen } });
// a rival's capture gets a red toast (expansion-ui.js says it too, in grey: this one is louder)
AL.on('pointCaptured', (w, d) => { if (!AL.Game || w !== AL.Game.world || d.col === AL.me()) return; AL.emit(w, 'kpDanger', { point: d.point, by: d.col }); });
AL.KPAlerts = { assess, state: () => S };
})(window);
