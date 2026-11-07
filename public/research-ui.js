// Antlands research UI (browser only):
// - an "Evolution [J]" button in the right HUD column with the current research and its progress
// - the Evolution panel: the colony's tree (Foraging, Defence, Colony, and its species' own traits) as node cards
//   with cost, state (done / researching / available / short of food / locked) and tooltips; click to research
// - the species perk picker on the title screen (3 cards under the species picker, remembered per species)
// - toasts when a trait has evolved, the perk on inspect
// All DOM lives under #rs-ui (panel) and #rs-perks (title) / #rs-btn (HUD).
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, RS = AL.Research;
if (!RS || !UI) return;
const G = () => AL.Game;
const W = () => { const g = G(); return g && !g.demo && !g.scene ? g.world : null; };
const $ = id => document.getElementById(id);
const clock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const CSS = `
#rs-btn{display:flex;flex-direction:column;align-items:stretch;gap:3px;width:100%;padding:6px 10px;text-align:left;white-space:normal}
#rs-btn .rt{display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-weight:600;letter-spacing:.02em}
#rs-btn .rt small{font-weight:500;color:var(--mute);font-size:11px}
#rs-btn .rb{height:4px;border-radius:2px;background:rgba(255,255,255,.1);overflow:hidden}
#rs-btn .rb i{display:block;height:100%;background:linear-gradient(90deg,#7aa84a,#c8e07a)}
#rs-btn.idle .rt small{color:#c8e07a}
#rs-ui{position:fixed;inset:0;z-index:12;pointer-events:none;display:flex;align-items:center;justify-content:center;padding:58px 12px 12px}
#rs-ui .sheet{pointer-events:auto;max-width:880px;width:100%;max-height:calc(100vh - 80px);overflow:auto;padding:14px 16px 16px;border-radius:16px;background:var(--panel2);border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.6)}
#rs-ui .hd{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}
#rs-ui .hd h2{margin:0;font:700 22px/1.1 Georgia,"Times New Roman",serif;color:var(--gold)}
#rs-ui .hd .sub{color:var(--mute);font-size:12px;flex:1}
#rs-ui .hd button{padding:3px 9px}
#rs-ui .cur{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:6px 8px;border-radius:9px;background:rgba(0,0,0,.25);font-size:12px}
#rs-ui .cur .rb{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}
#rs-ui .cur .rb i{display:block;height:100%;background:linear-gradient(90deg,#7aa84a,#c8e07a);transition:width .3s}
#rs-ui .cur button{padding:2px 8px;font-size:11px}
#rs-ui .cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
#rs-ui .col h3{margin:0 0 6px;font:600 12px system-ui;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);display:flex;justify-content:space-between}
#rs-ui .col h3 b{color:var(--ink);font-weight:600}
#rs-ui .nd{display:block;width:100%;text-align:left;white-space:normal;margin:0 0 6px;padding:6px 8px 7px;border-radius:10px;position:relative;line-height:1.25}
#rs-ui .nd .nm{display:flex;justify-content:space-between;gap:6px;font-weight:600;font-size:12.5px}
#rs-ui .nd .nm i{font-style:normal;font-weight:500;color:var(--mute);font-size:10px;white-space:nowrap}
#rs-ui .nd .ln{display:block;color:var(--mute);font-size:11px;margin-top:2px}
#rs-ui .nd .ct{display:block;font-size:10.5px;margin-top:3px;font-variant-numeric:tabular-nums}
#rs-ui .nd .ct .s{color:var(--sugar)}#rs-ui .nd .ct .p{color:var(--protein)}
#rs-ui .nd.t2{margin-left:8px;width:calc(100% - 8px)}#rs-ui .nd.t3{margin-left:16px;width:calc(100% - 16px)}#rs-ui .nd.t4{margin-left:24px;width:calc(100% - 24px)}
#rs-ui .nd.done{border-color:rgba(242,193,78,.6);background:linear-gradient(180deg,#4f3d17,#3a2c12)}
#rs-ui .nd.done .nm::after{content:'\\2713';color:var(--gold)}
#rs-ui .nd.available{border-color:rgba(160,220,120,.65);background:#3b3a1c}
#rs-ui .nd.available:hover{filter:brightness(1.25)}
#rs-ui .nd.short{opacity:.85}
#rs-ui .nd.wait{opacity:.8}
#rs-ui .nd.short .ct{color:var(--warn)}
#rs-ui .nd.locked{opacity:.45;filter:saturate(.4)}
#rs-ui .nd.researching{border-color:#c8e07a;box-shadow:0 0 0 1px rgba(200,224,122,.35),0 0 14px rgba(200,224,122,.18)}
#rs-ui .nd.researching .ct{color:#c8e07a}
#rs-ui .nd .pb{position:absolute;left:0;bottom:0;height:3px;border-radius:0 0 10px 10px;background:#c8e07a}
#rs-ui .perk{margin:0 0 8px;padding:6px 8px;border-radius:10px;border:1px dashed var(--line2);font-size:11.5px;color:var(--mute)}
#rs-ui .perk b{color:var(--ink);display:block;font-size:12px}
#rs-ui .foot{margin-top:6px;color:var(--mute);font-size:11px}
#rs-perks{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:-4px 0 12px}
#rs-perks .lbl{grid-column:1/-1;font-size:11px;color:var(--mute);letter-spacing:.06em;text-transform:uppercase}
#rs-perks button{display:block;white-space:normal;text-align:left;padding:5px 8px;line-height:1.2}
#rs-perks button b{display:block;font-size:12px}
#rs-perks button small{display:block;color:var(--mute);font-size:10.5px;margin-top:2px}
@media (max-width:820px),(max-height:560px){
  #rs-ui{padding:8px}#rs-ui .sheet{max-height:calc(100vh - 16px);padding:10px}
  #rs-ui .cols{grid-template-columns:repeat(2,minmax(0,1fr))}
  #rs-ui .nd .ln{display:none}
  #rs-btn{padding:4px 7px}
  #rs-perks button small{display:none}
}
`;
let css = false, open = false, panel$ = null, btn$ = null, acc = 0, lastSig = '';
function ensureCss() { if (css) return; css = true; const st = document.createElement('style'); st.id = 'rs-style'; st.textContent = CSS; document.head.appendChild(st); }
function toast(t, k) { if (UI.toast) UI.toast(t, k); }
const perkOf = c => c && c.perk ? RS.perkDef(c.spKey, c.perk) : null;

// ---- HUD button ------------------------------------------------------------------------------------------
function ensureBtn() {
  if (btn$ && document.body.contains(btn$)) return btn$;
  const right = $('right'); if (!right) return null;
  ensureCss();
  btn$ = document.createElement('button'); btn$.id = 'rs-btn'; btn$.className = 'panel';
  btn$.dataset.tip = 'Evolution [J]: your colony\'s research tree. Spend sugar and protein to evolve new traits, one at a time.';
  btn$.addEventListener('click', () => toggle());
  const sp = $('speed'); if (sp && sp.nextSibling) right.insertBefore(btn$, sp.nextSibling); else right.appendChild(btn$);
  return btn$;
}
function btnHtml(w) {
  const c = w.player, r = c.research || {};
  const done = (r.order || []).length, all = RS.nodesFor(c.spKey).length;
  if (r.busy) {
    const d = RS.node(r.cur), p = RS.progress(c);
    return '<span class="rt">Evolving <small>' + esc(d.name) + ' ' + clock(r.dur - r.t) + '</small></span><span class="rb"><i style="width:' + (p * 100).toFixed(1) + '%"></i></span>';
  }
  const avail = RS.nodesFor(c.spKey).some(d => RS.status(w, (w.me || 0), d.id) === 'available');
  btn$.classList.toggle('idle', avail);
  return '<span class="rt">Evolution [J] <small>' + (avail ? 'ready to evolve' : done + ' / ' + all) + '</small></span>';
}

// ---- panel ----------------------------------------------------------------------------------------------
function ensurePanel() {
  if (panel$) return panel$;
  ensureCss();
  panel$ = document.createElement('div'); panel$.id = 'rs-ui'; panel$.hidden = true;
  document.body.appendChild(panel$);
  // pointerdown: acts on press, so a refresh between down and up can't eat the click
  panel$.addEventListener('pointerdown', e => {
    const w = W(); if (!w) return;
    if (e.target.closest('[data-close]')) { show(false); return; }
    if (e.target.closest('[data-cancel]')) { AL.Cmd.issue('researchCancel', {}, () => refresh(true)); return; }
    const b = e.target.closest('[data-node]'); if (!b) return;
    e.preventDefault();
    const me = w.me || 0, id = b.dataset.node, st = RS.status(w, me, id);
    if (st === 'done' || st === 'researching') return;
    if (st !== 'locked' && w.player.research.busy) { toast('One research at a time: ' + RS.node(w.player.research.cur).name + ' is still evolving.', 'bad'); return; }
    const why = RS.can(w, me, id).why;
    AL.Cmd.issue('research', { id }, ok => { if (!ok) toast(why || 'Can\'t evolve that yet.', 'bad'); refresh(true); });
  });
}
function costHtml(d) {
  const k = RS.cost(d);
  return '<span class="s">' + k.sugar + ' sugar</span> · <span class="p">' + k.protein + ' protein</span> · ' + clock(k.time);
}
function nodeHtml(w, d) {
  const c = w.player, chk = RS.can(w, (w.me || 0), d.id);
  let st = RS.status(w, (w.me || 0), d.id);
  if (st === 'short' && chk.busy) st = 'wait';   // only waiting for the current research to finish
  const why = st === 'locked' || st === 'short' || st === 'wait' ? chk.why : '';
  let ct;
  if (st === 'done') ct = 'Evolved';
  else if (st === 'researching') ct = 'Evolving, ' + clock(c.research.dur - c.research.t) + ' left';
  else if (st === 'locked') ct = esc(why);
  else ct = costHtml(d) + (st === 'short' && why && !/^Needs \d/.test(why) ? ' · ' + esc(why) : '');
  const tip = d.name + ': ' + d.line + (d.req.length ? ' Needs ' + d.req.map(q => RS.node(q).name).join(' + ') + '.' : '') + (st === 'short' ? ' (' + why + ')' : '');
  const pb = st === 'researching' ? '<i class="pb" style="width:' + (RS.progress(c) * 100).toFixed(1) + '%"></i>' : '';
  return '<button class="nd ' + st + ' t' + d.tier + '" data-node="' + d.id + '" data-tip="' + esc(tip) + '"><span class="nm">' + esc(d.name) + '<i>tier ' + d.tier + '</i></span><span class="ln">' + esc(d.line) + '</span><span class="ct">' + ct + '</span>' + pb + '</button>';
}
function panelHtml(w) {
  const c = w.player, r = c.research, nodes = RS.nodesFor(c.spKey), p = perkOf(c);
  let h = '<div class="hd"><h2>Evolution</h2><span class="sub">' + esc(c.sp.name) + ' · ' + r.order.length + ' of ' + nodes.length + ' traits · one at a time</span><button data-close data-tip="Close [J / Esc]">&times;</button></div>';
  if (r.busy) {
    const d = RS.node(r.cur);
    h += '<div class="cur"><b>' + esc(d.name) + '</b><span class="rb"><i style="width:' + (RS.progress(c) * 100).toFixed(1) + '%"></i></span><span>' + clock(r.dur - r.t) + '</span><button data-cancel data-tip="Stop this research: you get half its cost back.">Cancel</button></div>';
  }
  h += '<div class="cols">';
  for (const B of RS.BRANCHES) {
    const list = nodes.filter(d => d.branch === B.id).sort((a, b) => a.tier - b.tier);
    if (!list.length && B.id !== 'species') continue;
    const n = list.filter(d => r.done[d.id]).length;
    h += '<div class="col"><h3 data-tip="' + esc(B.tip) + '">' + (B.id === 'species' ? esc(c.sp.name) : B.name) + ' <b>' + n + '/' + list.length + '</b></h3>';
    if (B.id === 'species' && p) h += '<div class="perk" data-tip="Your species perk, chosen on the title screen. It lasts the whole match.">Perk<b>' + esc(p.name) + '</b>' + esc(p.line) + '</div>';
    for (const d of list) h += nodeHtml(w, d);
    h += '</div>';
  }
  h += '</div><div class="foot">Costs are paid when research starts. Rival colonies evolve too, so check what their ants can do.</div>';
  return h;
}
function refresh(force) {
  const w = W();
  if (!w || !w.player || !w.player.research) { if (btn$) btn$.hidden = true; if (panel$) panel$.hidden = true; return; }
  const b = ensureBtn(); if (b) { b.hidden = false; const bh = btnHtml(w); if (bh !== b._h) { b.innerHTML = bh; b._h = bh; } }
  if (!open) return;
  ensurePanel(); panel$.hidden = false;
  // rebuild only when a node changes state; progress bars and clocks are updated in place (stable DOM for clicks/tooltips)
  const c = w.player, r = c.research;
  const sig = r.cur + '|' + r.order.length + '|' + RS.nodesFor(c.spKey).map(d => { const st = RS.status(w, (w.me || 0), d.id); return st === 'short' && RS.can(w, (w.me || 0), d.id).busy ? 'w' : st[0]; }).join('');
  if (force || sig !== lastSig || !panel$.firstChild) {
    lastSig = sig;
    const sc = panel$.firstChild ? panel$.firstChild.scrollTop : 0;
    panel$.innerHTML = '<div class="sheet">' + panelHtml(w) + '</div>';
    panel$.firstChild.scrollTop = sc;
    return;
  }
  if (r.busy) {
    const p = (RS.progress(c) * 100).toFixed(1) + '%', left = clock(r.dur - r.t);
    const bar = panel$.querySelector('.cur .rb i'), tm = panel$.querySelector('.cur > span:not(.rb)');
    if (bar) bar.style.width = p; if (tm) tm.textContent = left;
    const nd = panel$.querySelector('.nd.researching');
    if (nd) { const pb = nd.querySelector('.pb'); if (pb) pb.style.width = p; const ct = nd.querySelector('.ct'); if (ct) ct.textContent = 'Evolving, ' + left + ' left'; }
  }
}
function show(on) {
  open = !!on && !!W();
  if (!open && panel$) { panel$.hidden = true; if (UI.tip) UI.tip(null); }   // the hovered node is gone: drop its tooltip
  if (open) { if (UI.tip) UI.tip(null); refresh(true); }
}
function toggle() { show(!open); }
AL.ResearchUI = { show, toggle, refresh, get open() { return open; } };

// keys: J toggles the panel, Esc closes it (before the core's Esc opens the pause menu)
const baseKey = UI.key;
UI.key = function (e) {
  const g = G();
  if (g && !g.scene && g.world && !g.demo && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const title = $('title'), pause = $('pausem');
    if ((!title || title.hidden) && (!pause || pause.hidden)) {
      if (e.code === 'KeyJ') { toggle(); return; }
      if (e.code === 'Escape' && open) { show(false); return; }
    }
  }
  return baseKey.apply(this, arguments);
};

// per frame, piggybacking on the core UI frame
const baseExtra = UI.frameExtra;
UI.frameExtra = function (w, dt) {
  if (baseExtra) baseExtra(w, dt);
  acc += dt; if (acc < 0.25) return; acc = 0;
  try { refresh(false); } catch (e) { console.error('[research-ui]', e); }
};
const baseNew = UI.onNewGame;
UI.onNewGame = function (world, opts) {
  if (baseNew) baseNew(world, opts);
  show(false); lastSig = '';
  if (btn$) btn$._h = '';
  if (opts && opts.demo && btn$) btn$.hidden = true;
};
const baseScene = UI.onScene;
UI.onScene = function () { show(false); if (baseScene) baseScene.apply(this, arguments); };

// ---- toasts ----------------------------------------------------------------------------------------------
AL.on('researchDone', (w, d) => {
  if (w !== W() || d.col !== AL.me() || !d.node || d.what === 'tunnel') return;   // expansion-ui says its own line for deep tunnelling
  toast('Evolved: ' + d.node.name + '. ' + d.node.line, 'good');
});
AL.on('researchStarted', (w, d) => { if (w === W() && d.col === AL.me() && open) refresh(true); });

// ---- inspect: species, perk and how far that colony has evolved ------------------------------------------
const baseClick = UI.click;
UI.click = function (wx, wy, e) {
  baseClick.call(UI, wx, wy, e);
  const g = G(), w = g && g.world; if (!w || g.demo) return;
  const tt = $('inspect'); if (!tt || tt.hidden) return;
  const A = w.ants, nestView = g.renderer.view === 'nest';
  let best = -1, bd = 14 * 14;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== (nestView ? 1 : 0) || (nestView && A.nest[i] !== AL.me())) continue;
    if (A.col[i] !== AL.me() && w.fog && !nestView && !w.fog.visibleAt(A.x[i], A.y[i])) continue;
    const d = AL.dist2(A.x[i], A.y[i], wx, wy); if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  const col = w.colonies[A.col[best]]; if (!col || col.id === AL.me()) return;
  const p = perkOf(col), n = col.research && col.research.order ? col.research.order.length : 0;
  tt.innerHTML += '<br><span class="mute">' + esc(col.sp.name) + (p ? ' · perk: ' + esc(p.name) : '') + ' · ' + n + ' trait' + (n === 1 ? '' : 's') + ' evolved</span>';
};

// ---- title: the perk picker under the species picker --------------------------------------------------------
const KEY = sp => 'antlands.perk.' + sp;
UI.perkFor = function (sp) {
  const list = RS.perksFor(sp); if (!list.length) return null;
  let id = null; try { id = localStorage.getItem(KEY(sp)); } catch (_) {}
  return list.some(p => p.id === id) ? id : list[0].id;
};
function buildPerks() {
  const host = $('speciesPick'); if (!host) return;
  ensureCss();
  let el = $('rs-perks');
  if (!el) { el = document.createElement('div'); el.id = 'rs-perks'; host.parentNode.insertBefore(el, host.nextSibling); }
  const sp = UI.species || 'fire', list = RS.perksFor(sp), cur = UI.perkFor(sp);
  if (!list.length) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<div class="lbl">' + esc(AL.SPECIES[sp].name) + ' perk: pick one</div>' + list.map(p => '<button type="button" data-perk="' + p.id + '" class="' + (p.id === cur ? 'on' : '') + '" data-tip="' + esc(p.name + ': ' + p.line) + '"><b>' + esc(p.name) + '</b><small>' + esc(p.line) + '</small></button>').join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#rs-perks [data-perk]');
  if (b) { try { localStorage.setItem(KEY(UI.species || 'fire'), b.dataset.perk); } catch (_) {} buildPerks(); return; }
  if (e.target.closest && e.target.closest('#speciesPick [data-sp]')) setTimeout(buildPerks, 0);   // species changed
});
const baseScreens = UI.initScreens;
UI.initScreens = function () {
  if (baseScreens) baseScreens.apply(this, arguments);
  buildPerks();
  // how to play: one paragraph on evolution and perks
  const how = document.querySelector('#howto .sheet'), last = how && how.querySelector('p.mute');
  if (how && last && !how.querySelector('.rs-how')) {
    const p = document.createElement('p'); p.className = 'rs-how';
    p.innerHTML = '<b>Evolution [J]</b> Spend sugar and protein to evolve your colony one trait at a time: keener antennae, tougher exoskeletons, faster brood, and traits only your species has. Your <b>perk</b>, picked on the title screen under your species, shapes the whole match. Rivals evolve too.';
    how.insertBefore(p, last);
  }
};
const baseBuild = UI.buildSpecies;
if (baseBuild) UI.buildSpecies = function () { const r = baseBuild.apply(this, arguments); setTimeout(buildPerks, 0); return r; };
// the chosen perk rides along in the game options (flight and founding pass it through to createWorld)
const baseStart = UI.startGame;
UI.startGame = function (opts) {
  opts = Object.assign({}, opts || {});
  const sp = opts.species || UI.species || 'fire';
  if (opts.perk === undefined) opts.perk = UI.perkFor(sp);
  const r = baseStart.call(this, opts);
  if (UI.lastOpts) UI.lastOpts.perk = opts.perk;
  return r;
};
})(window);
