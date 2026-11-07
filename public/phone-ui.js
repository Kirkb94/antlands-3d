// Phone layout: on narrow screens (under 900 px wide, or under 500 px tall) the HUD's side columns turn into a
// slim strip along the top (sugar, protein, water, ants, game speed) and a tab bar above the tools that slides a
// sheet up from the bottom: Colony (food and ants), Brood (nursery and egg queue), Map, World (season, wildlife,
// evolution, Royal chamber, key points) and Goals (tips and mission objectives). Tap a tab to open it, tap it
// again to close. The panels themselves are the PC ones, moved into the sheet (and back when the screen widens),
// so they keep updating as before. PC keeps its side columns.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, $ = id => document.getElementById(id);
const MQ = root.matchMedia('(max-width: 899px), (max-height: 500px)');
const TABS = [
  { id: 'res', label: 'Colony', tip: 'Food, water, soil and your ants' },
  { id: 'brood', label: 'Brood', tip: 'Nursery and the egg queue' },
  { id: 'map', label: 'Map', tip: 'The yard map: tap to look there' },
  { id: 'world', label: 'World', tip: 'Season and weather, wildlife, evolution, Royal chamber, key points' },
  { id: 'goals', label: 'Goals', tip: 'Tips and mission objectives' },
];
// which tab a HUD panel goes to (by id); anything else from the side columns goes to World
const HOME = { stocks: 'res', pop: 'res', raidList: 'res', nestPlan: 'brood', nestStats: 'brood', eggPanel: 'brood', 'w-species': 'brood', 'w-bivouac': 'brood', minimap: 'map', hint: 'goals', 'w-campaign': 'goals' };
const tabFor = el => HOME[el.id] || 'world';
const KEEP = { speed: 1, 'w-expHold': 1, nestTabs: 1 };   // stay where they are (the strip / the top bar; the nest tabs float at the left edge)
let on = false, top = null, tabs = null, sheet = null, panes = {}, open = null, hintSig = '';
try { open = localStorage.getItem('antlands.phoneTab') || null; } catch (e) { open = null; }

function build() {
  if (top) return;
  const hud = $('hud'); if (!hud) return;
  top = document.createElement('div'); top.id = 'phoneTop';
  top.innerHTML = '<div class="pt-res"><span class="r sugar" data-tip="Sugar"><b id="ptSug">0</b></span><span class="r protein" data-tip="Protein"><b id="ptPro">0</b></span>' +
    '<span class="r water" data-tip="Water"><b id="ptWat">0</b></span><span class="r ants" data-tip="Ants"><b id="ptAnt">0</b> ants</span></div>';
  hud.appendChild(top);
  sheet = document.createElement('div'); sheet.id = 'phoneSheet'; sheet.className = 'panel'; sheet.hidden = true;
  for (const t of TABS) { const p = document.createElement('div'); p.className = 'ps-pane'; p.dataset.tab = t.id; p.hidden = true; sheet.appendChild(p); panes[t.id] = p; }
  tabs = document.createElement('div'); tabs.id = 'phoneTabs'; tabs.className = 'panel';
  tabs.innerHTML = TABS.map(t => '<button data-pt="' + t.id + '" data-tip="' + t.tip + '">' + t.label + '</button>').join('');
  tabs.addEventListener('click', e => { const b = e.target.closest('[data-pt]'); if (b) show(open === b.dataset.pt ? null : b.dataset.pt); });
  const bot = $('bottom'); bot.insertBefore(tabs, bot.firstChild); bot.insertBefore(sheet, tabs);
}
function show(id) {
  open = id && panes[id] ? id : null;
  try { if (open) localStorage.setItem('antlands.phoneTab', open); else localStorage.removeItem('antlands.phoneTab'); } catch (e) { /* fine */ }
  if (!sheet) return;
  sheet.hidden = !open;
  for (const t of TABS) panes[t.id].hidden = t.id !== open;
  for (const b of tabs.children) b.classList.toggle('on', b.dataset.pt === open);
  if (open === 'goals') { const d = tabs.querySelector('[data-pt="goals"]'); if (d) d.classList.remove('dot'); }
  if (open === 'map' && UI.drawMinimap && AL.Game && AL.Game.world) try { UI.drawMinimap(AL.Game.world); } catch (e) { /* drawn next frame */ }
}
// move a panel into its tab (remembering where it lived)
function adopt(el) {
  if (!el || el.dataset.phoneHome || KEEP[el.id]) return;
  el.dataset.phoneHome = el.parentNode && el.parentNode.id ? el.parentNode.id : 'right';
  panes[tabFor(el)].appendChild(el);
}
function sweep() {
  for (const id of ['left', 'right', 'topbar']) { const c = $(id); if (c) for (const el of Array.from(c.children)) adopt(el); }
  const royal = $('exp-royal'); if (royal && !royal.dataset.phoneHome) adopt(royal);
  const sp = $('speed'); if (sp && sp.parentNode !== top) { sp.dataset.phoneHome = 'right'; top.appendChild(sp); }
  const nt = $('nestTabs'), hud = $('hud'); if (nt && hud && nt.parentNode !== hud) { nt.dataset.phoneHome = 'left'; hud.appendChild(nt); }
  // the Nest / Yard switch sits at the end of the tab bar; key hints ([U], [Tab]) are dropped from button labels
  const v = $('btnView'); if (v && v.parentNode !== tabs) { v.dataset.phoneAfter = v.previousElementSibling ? v.previousElementSibling.id : ''; v.dataset.phoneHome = 'bottomRow'; tabs.appendChild(v); }
  for (const b of [$('btnView'), $('btnRecall')]) if (b) { const t = b.textContent, k = t.replace(/\s*\[[^\]]+\]\s*$/, ''); if (k !== t) { b.dataset.full = t; b.textContent = k; } }
  // a new tip or objective lights a dot on Goals
  const h = $('hint'), sig = h && !h.hidden ? h.textContent.slice(0, 80) : '';
  if (sig && sig !== hintSig && open !== 'goals') { const d = tabs.querySelector('[data-pt="goals"]'); if (d) d.classList.add('dot'); }
  hintSig = sig;
}
function enter() {
  build(); if (!top) return;
  on = true; document.body.classList.add('phone');
  sweep(); show(open);
}
function leave() {
  on = false; document.body.classList.remove('phone');
  if (!top) return;
  for (const b of [$('btnView'), $('btnRecall')]) if (b && b.dataset.full) { if (b.dataset.full.indexOf(b.textContent) === 0) b.textContent = b.dataset.full; delete b.dataset.full; }
  for (const el of Array.from(document.querySelectorAll('[data-phone-home]'))) {
    const home = $(el.dataset.phoneHome) || $('right'); delete el.dataset.phoneHome;
    if (el.id === 'btnView') { const a = $(el.dataset.phoneAfter); if (a && a.parentNode) a.parentNode.insertBefore(el, a.nextSibling); else { const r = $('btnRecall'); if (r) r.parentNode.insertBefore(el, r.nextSibling); } delete el.dataset.phoneAfter; continue; }
    if (el.id === 'speed' || el.id === 'nestTabs') home.insertBefore(el, home.firstChild);
    else if (el.id === 'exp-royal') { const ui = $('exp-ui'); (ui || document.body).appendChild(el); }
    else home.appendChild(el);
  }
  sheet.hidden = true;
}
function strip(w) {
  const c = w && ((UI.focus && UI.focus(w)) || w.player); if (!c || !top) return;   // (the nest picked in the nest tabs)
  const s = c.stock, f = v => v >= 10000 ? Math.round(v / 1000) + 'k' : String(Math.floor(v));
  const set = (id, v) => { const e = $(id); if (e && e.textContent !== v) e.textContent = v; };
  set('ptSug', f(s.sugar)); set('ptPro', f(s.protein)); set('ptWat', f(s.water || 0));
  set('ptAnt', f(c.pop ? c.pop.reduce((a, b) => a + b, 0) : 0));
  const st = $('stocks');   // the wanted-food arrow (behavior.js needs) shows on the strip too
  if (st) for (const k of ['sugar', 'protein']) { const r = top.querySelector('.r.' + k), want = !!st.querySelector('.res.' + k + '.wanted'); if (r) r.classList.toggle('wanted', want); }
}
let acc = 0;
const baseExtra = UI.frameExtra;
UI.frameExtra = function (w, dt) {
  if (baseExtra) baseExtra(w, dt);
  if (!on) return;
  acc += dt; if (acc < 0.4) return; acc = 0;
  try { sweep(); strip(w); } catch (e) { console.error(e); }
};
// the PC layout pass sizes the side columns and slides the tool bar; on a phone the strip and the sheet do that
const baseLayout = UI.layout;
UI.layout = function () {
  if (!on) return baseLayout.apply(this, arguments);
  const bot = $('bottom'); if (bot) bot.style.left = '';
  const tb = top && top.getBoundingClientRect(), ts = $('toasts');
  if (ts && tb) ts.style.top = Math.round(tb.bottom + 6) + 'px';
};
UI.phone = () => on;
const sync = () => { if (MQ.matches && !on) enter(); else if (!MQ.matches && on) leave(); };
if (MQ.addEventListener) MQ.addEventListener('change', sync); else MQ.addListener(sync);
const wait = () => { if ($('hud') && $('bottom')) sync(); else setTimeout(wait, 50); };
wait();
})(window);
