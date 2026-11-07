// Antlands first-time hints: a short flow of cards that each finish when you do the thing.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI;
const $ = id => document.getElementById(id);
const KEY = 'antlands.hints.v1';
const STEPS = [
  { id: 'trail', title: 'Lay a food trail', text: 'Your foragers wander at random until they find food. Pick <b>Food trail [F]</b> and paint a line from your mound toward food: they follow it, and every trip home makes it stronger.', done: ['tool:food'] },
  { id: 'nest', title: 'Look inside', text: 'Press <b>Tab</b> (or roll the wheel in over your mound) to zoom down into the nest under it.', done: ['view:nest'] },
  { id: 'dig', title: 'Dig and build', text: 'Use <b>Dig [G]</b> on soil next to a tunnel. Then paint rooms with <b>Chamber [C]</b>: a bigger nursery and food store, a midden for the dead, a water room.', done: ['dig', 'chamber'] },
  { id: 'eggs', title: 'Choose the eggs', text: 'The queen lays what you queue on the right. Larvae need <b>protein</b> (soldiers 3, majors 6), so keep bringing insects home.', done: ['egg'] },
  { id: 'war', title: 'Rival colonies', text: 'Rival colonies live somewhere in the yard. They don\'t know where you are either until their scouts find you. Red wisps at the edge of the fog are their scent. <b>Alarm [R]</b> rallies your soldiers; <b>Raid [I]</b> sends a party to break into their mound and kill their queen.', done: ['alarm', 'tool:raid'] },
];
let state = { step: 0, off: false }, el = null;
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) state = s; } catch (_) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {} };

function show() {
  if (!el) { el = document.createElement('div'); el.id = 'hint'; el.className = 'panel'; document.getElementById('left').appendChild(el); }
  const s = STEPS[state.step];
  if (state.off || !s || (AL.Game && AL.Game.demo)) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = '<div class="ph"><span>' + s.title + '</span><span class="mute">' + (state.step + 1) + ' / ' + STEPS.length + '</span></div><p>' + s.text + '</p><div class="row"><button id="hintNext">Next</button><button id="hintOff">Hide tips</button></div>';
  $('hintNext').onclick = () => advance();
  $('hintOff').onclick = () => { state.off = true; save(); show(); };
}
function advance() { state.step++; save(); show(); }
UI.hintEvent = function (ev) {
  const s = STEPS[state.step];
  if (!s || state.off) return;
  if (s.done.includes(ev)) advance();
};
UI.resetHints = function () { state = { step: 0, off: false }; save(); show(); };
const baseNew = UI.onNewGame;
UI.onNewGame = function (w, o) { baseNew(w, o); show(); };
const baseTool = UI.onTool;
UI.onTool = function (t) { baseTool(t); if (t) UI.hintEvent('tool:' + t.id); };
AL.on('tunnelDug', () => {});
// tool use events from the brushes
const baseSelect = AL.Tools.select;
document.addEventListener('pointerup', () => { const t = AL.Tools.current; if (t && (t.id === 'dig' || t.id === 'chamber' || t.id === 'alarm')) UI.hintEvent(t.id); });
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#eggBtns [data-caste]')) UI.hintEvent('egg'); });
})(window);
