// Nest tabs: once your colony has satellites with their own nest (expansion.js addHome), a column of tabs at the top
// left lists your nests, the capital and each satellite. The picked tab is the nest you give orders from: alarm and
// recruit orders you paint go to that nest's ants only (brush.js, orders.js `hid`), a recruit path starts at its
// mound, and the HUD numbers, the egg queue and the nest tools work on it (ui.js UI.focus, cmd.js / brush.js args.h).
// In the nest view the tabs also switch which nest you see; scrolling into a nest picks its tab. Clicking the tab
// already picked takes the camera to that nest's mound.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, $ = id => document.getElementById(id);
let el = null, sig = '', pick = null;   // pick: the satellite home picked (null: the capital)
function mine(w) {
  const me = w.me || 0, out = [w.colonies[me]];
  for (const h of w.homes || []) if (h && h.sat && h.id === me && !h.gone && h.nest) out.push(h);
  return out;
}
// the nest picked in the tabs (your colony when it's the capital, or the satellite is gone)
UI.picked = function (w) {
  w = w || (AL.Game && AL.Game.world); if (!w) return null;
  if (pick && (pick.gone || !pick.nest || w.homes[pick.hid] !== pick)) pick = null;
  return pick || w.player;
};
UI.pick = function (h, opts) {
  const G = AL.Game, w = G && G.world, r = G && G.renderer; if (!w) return;
  const next = h && h.sat && h.id === (w.me || 0) && !h.gone ? h : null, same = (next || w.player) === UI.picked(w);
  pick = next; sig = '';
  if (r && r.view === 'nest' && r.setNestCol && !(opts && opts.fromView)) { r.setNestCol(next); if (UI.onView) UI.onView('nest'); return; }
  if (!(opts && opts.fromView)) {
    if (same && r && r.view !== 'nest') { const c = next || w.player; r.cam.x = c.x + 40; r.cam.y = c.y - 20; r.cam.z = Math.max(r.cam.z, 1.6); if (r.clampCam) r.clampCam(r.cam); }
    else if (UI.toast && !same) UI.toast(next ? 'Orders from ' + label(w, next) + ': only its ants answer your alarms and Collect circles, and the egg queue is its own.' : 'Orders from your capital.');
    UI.syncQueue();
  }
};
const label = (w, h) => { const k = mine(w).indexOf(h); return k > 0 ? 'Satellite ' + k : 'Capital'; };
function ensure() {
  if (el) return el;
  const left = $('left'); if (!left) return null;
  el = document.createElement('div'); el.id = 'nestTabs'; el.className = 'panel'; el.hidden = true;
  left.insertBefore(el, left.firstChild);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-hid]'); if (!b) return;
    const w = AL.Game && AL.Game.world; if (!w) return;
    UI.pick((w.homes || w.colonies)[+b.dataset.hid]);
  });
  return el;
}
const ants = h => (h.pop ? h.pop.reduce((a, b) => a + b, 0) : 0);
function frame(w) {
  const r = AL.Game && AL.Game.renderer; if (!w || !r) return;
  const list = mine(w), e = ensure(); if (!e) return;
  e.hidden = list.length < 2; if (e.hidden) { pick = null; return; }
  const on = UI.picked(w), s = list.map(h => h.hid + ':' + (h === on ? 1 : 0) + ':' + ants(h) + ':' + (h.queen && h.queen.alive ? 1 : 0)).join(',');
  if (s === sig) return; sig = s;
  e.innerHTML = '<div class="ph"><span data-tip="Pick the nest you give orders from: only its ants answer your alarms and Collect circles, and the egg queue and nest tools work on it">Nests</span></div>' + list.map((h, k) => {
    const q = h.queen && h.queen.alive;
    return '<button data-hid="' + h.hid + '"' + (h === on ? ' class="on"' : '') + ' data-tip="' + (k ? 'Satellite ' + k + ': its own queen' + (q ? '' : ' (dead: it is dying out)') + ', brood and food store' : 'Your capital') + '. Click again to go to its mound.">' +
      '<span>' + (k ? 'Satellite ' + k : 'Capital') + (q ? '' : ' <span class="bad">&#9760;</span>') + '</span><span class="mute">' + ants(h) + '</span></button>';
  }).join('');
}
// the nest view: scrolling into one of your nests picks its tab
const baseView = UI.onView;
UI.onView = function (view) {
  const G = AL.Game, w = G && G.world, r = G && G.renderer;
  if (w && r && view === 'nest') { const o = r.nestOwner(); if (o.id === (w.me || 0)) UI.pick(o.sat ? o : null, { fromView: true }); }
  return baseView.apply(this, arguments);
};
let acc = 0;
const base = UI.frameExtra;
UI.frameExtra = function (w, dt) { if (base) base(w, dt); acc += dt; if (acc < 0.3) return; acc = 0; try { frame(w); } catch (e) { console.error(e); } };
AL.NestSwitch = { mine };
})(window);
