// Raid and Send tools (the sim side is raids.js). Picking either shows three sliders above the tools: how many
// workers (workers, foragers and scouts), soldiers and majors of the nest picked in the Nests tabs go. Raid: click an
// enemy anthill; the party gathers at its mound, then marches, breaks in and fights until the queen is dead (or you
// call it off in the Raids list at the top left). Send: click another of your hills; the ants move there to live.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, $ = id => document.getElementById(id);
const G = () => AL.Game, W = () => AL.Game && AL.Game.world;
const GROUPS = [{ k: 'w', name: 'Workers', tip: 'Workers, foragers and scouts' }, { k: 's', name: 'Soldiers' }, { k: 'm', name: 'Majors' }];
const P = { w: 0, s: 0, m: 0 }, MAX = { w: 0, s: 0, m: 0 };
let panel = null, list = null, mode = null, touched = false, sig = '';
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch]));
const toast = (t, k) => { if (UI.toast) UI.toast(t, k); };
const focus = () => (UI.focus && UI.focus(W())) || (W() && W().player);
const hArg = a => { const f = focus(); if (f && f.sat) a.h = f.hid; return a; };
const nestName = (w, h) => { if (!h || !h.sat) return 'your capital'; const k = AL.NestSwitch ? AL.NestSwitch.mine(w).indexOf(h) : -1; return k > 0 ? 'satellite ' + k : 'your satellite'; };

function ensure() {
  if (panel) return panel;
  const bot = $('bottom'), anchor = $('collectN'); if (!bot) return null;
  panel = document.createElement('div'); panel.id = 'partyPanel'; panel.className = 'panel'; panel.hidden = true;
  panel.innerHTML = '<div class="pp-h"><b id="ppTitle">Raid</b><span class="mute" id="ppFrom"></span></div>' + GROUPS.map(g =>
    '<label class="pp-row"' + (g.tip ? ' data-tip="' + g.tip + '"' : '') + '><span class="pp-n">' + g.name + '</span><input type="range" min="0" max="0" step="1" value="0" data-k="' + g.k + '"><span class="pp-v" id="ppv-' + g.k + '">0 / 0</span></label>').join('') +
    '<div class="pp-q"><button data-q="0">None</button><button data-q="0.5">Half</button><button data-q="1">All</button></div><div class="mute pp-hint" id="ppHint"></div>';
  bot.insertBefore(panel, anchor ? anchor.nextSibling : bot.firstChild);
  panel.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.k; if (!k) return; P[k] = +e.target.value; touched = true; show(); });
  panel.addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (!b) return; const q = +b.dataset.q; for (const g of GROUPS) P[g.k] = Math.round(MAX[g.k] * q); touched = true; show(); });
  return panel;
}
function refresh() {
  const w = W(), f = focus(); if (!w || !f || !AL.Raids) return;
  const n = AL.Raids.counts(w, f);
  for (const g of GROUPS) {
    MAX[g.k] = n[g.k];
    if (!touched) P[g.k] = mode === 'send' ? Math.round(n[g.k] / 2) : n[g.k];   // raid: everyone; send: half
    P[g.k] = Math.min(P[g.k], n[g.k]);
  }
  $('ppFrom').textContent = 'from ' + nestName(w, f);
  show();
}
function show() {
  if (!panel) return;
  for (const g of GROUPS) { const r = panel.querySelector('[data-k="' + g.k + '"]'); r.max = MAX[g.k]; r.value = P[g.k]; $('ppv-' + g.k).textContent = P[g.k] + ' / ' + MAX[g.k]; }
  const tot = P.w + P.s + P.m;
  $('ppTitle').textContent = mode === 'send' ? 'Send ' + tot + ' ants' : 'Raid with ' + tot + ' ants';
  $('ppHint').textContent = mode === 'send' ? 'Click another of your hills: they move there to live.' : 'Click an enemy anthill: they gather here, then march and fight until its queen is dead.';
}
UI.onPartyTool = function (tool) {
  const p = ensure(); if (!p) return;
  const m = tool && (tool.id === 'raid' || tool.id === 'send') ? tool.id : null;
  if (m !== mode) touched = false;
  mode = m; p.hidden = !m;
  if (m) refresh();
};
function go(phase, x, y) {
  if (phase !== 'start') return;
  const w = W(); if (!w) return;
  const a = hArg({ x: Math.round(x), y: Math.round(y), w: P.w, s: P.s, m: P.m });
  if (!(P.w + P.s + P.m)) { toast('Pick some ants with the sliders first.'); return; }
  AL.Cmd.issue(mode === 'send' ? 'send' : 'raid', a, r => {
    if (!r) return;
    if (!r.ok) { toast(r.why || 'Can\'t do that.'); return; }
    if (mode === 'send') toast(r.n + ' ants on their way to their new hill.', 'good');
    else toast(r.n + ' ants gather at ' + nestName(w, focus()) + ', then march on the ' + (r.sat ? 'satellite' : 'anthill') + '. They won\'t turn back until its queen is dead.', 'good');
    touched = false; refresh();
  });
}
function register() {
  const T = AL.Tools && AL.Tools.TOOLS; if (!T) return;
  T.raid = { id: 'raid', layer: 'surface', name: 'Raid', key: 'KeyI', tip: 'Pick how many workers, soldiers and majors go, then click an enemy anthill (a colony or a satellite). They gather at your mound, march, break in and fight until its queen is dead. Hunger and wounds don\'t turn them back.', paint: go };
  T.send = { id: 'send', layer: 'surface', name: 'Send', key: 'KeyO', tip: 'Pick how many workers, soldiers and majors go, then click another of your hills: they move there and live there from then on. Pick the nest they leave from in the Nests tabs.', paint: go };
}
register();

// ---- the Raids list: raids under way, with how many are still fighting and a Call off button ----
function ensureList() {
  if (list) return list;
  const left = $('left'); if (!left) return null;
  list = document.createElement('div'); list.id = 'raidList'; list.className = 'panel'; list.hidden = true;
  const tabs = $('nestTabs'); left.insertBefore(list, tabs ? tabs.nextSibling : left.firstChild);
  list.addEventListener('click', e => { const b = e.target.closest('[data-end]'); if (!b) return; AL.Cmd.issue('raidEnd', { id: +b.dataset.end }, ok => { if (ok) toast('Raid called off: the survivors head home.'); }); });
  return list;
}
function frameList(w) {
  const el = ensureList(); if (!el) return;
  const me = w.me || 0, mine = (w.praids || []).filter(r => r.col === me);
  el.hidden = !mine.length; if (!mine.length) { sig = ''; return; }
  const s = mine.map(r => r.id + ':' + r.n + ':' + (w.t < r.go ? 1 : 0)).join(',');
  if (s === sig) return; sig = s;
  el.innerHTML = '<div class="ph"><span>Raids</span></div>' + mine.map(r => {
    const t = AL.Raids.target(w, r), who = t ? (t.sat ? esc(t.sp.name) + ' satellite' : esc(t.sp.name) + ' colony') : 'a colony';
    return '<div class="rl-row"><span>' + who + '<br><span class="mute">' + (w.t < r.go ? 'gathering' : 'fighting') + ': ' + r.n + ' of ' + r.n0 + ' left</span></span><button data-end="' + r.id + '" data-tip="Call the raid off: the survivors head home">Call off</button></div>';
  }).join('');
}
AL.on('playerRaidOver', (w, d) => {
  if (!W() || w !== W() || d.col !== (w.me || 0)) return;
  if (d.why === 'won') toast('Raid won: the enemy queen is dead. The survivors loot the store and come home.', 'good');
  else if (d.why === 'lost') toast('Raid lost: every raider fell.', 'bad');
});
let acc = 0;
const base = UI.frameExtra;
UI.frameExtra = function (w, dt) {
  if (base) base(w, dt);
  acc += dt; if (acc < 0.5) return; acc = 0;
  try { if (mode) refresh(); frameList(w); } catch (e) { console.error(e); }
};
AL.RaidsUI = { P, MAX };
})(window);
