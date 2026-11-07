// Title / menu settings: rival difficulty (Easy / Normal / Hard -> opts.aiLevel, see ai.js AL.AI_LEVELS) and
// text & UI size (Small / Normal / Large -> CSS --ui-scale, see style.css). Both remembered in localStorage.
// Adds one row under the title's options row and one to the pause menu; wraps UI.startGame so every new game
// (and Restart) gets the chosen difficulty unless the caller passes its own aiLevel.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI;
const $ = id => document.getElementById(id);
const SCALES = { small: 0.9, normal: 1, large: 1.15 };
const LEVELS = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']];
const SIZES = [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']];
const load = (k, d) => { try { return localStorage.getItem('antlands.' + k) || d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem('antlands.' + k, v); } catch (e) { /* private mode: not remembered */ } };

UI.aiLevel = load('aiLevel', 'normal'); if (!LEVELS.some(l => l[0] === UI.aiLevel)) UI.aiLevel = 'normal';
UI.uiSize = load('uiSize', 'normal'); if (!SCALES[UI.uiSize]) UI.uiSize = 'normal';

UI.setUiSize = function (k) {
  if (!SCALES[k]) return;
  UI.uiSize = k; save('uiSize', k);
  document.documentElement.style.setProperty('--ui-scale', SCALES[k]);
  // canvas icons are drawn at a fixed size: rebuild them
  if (AL.Game && AL.Game.world && UI.buildEggButtons) { UI.buildEggButtons(); UI.syncQueue(); }
  sync();
};
UI.setAiLevel = function (k) { UI.aiLevel = k; save('aiLevel', k); sync(); };

const seg = (cls, list, cur, tip) => '<span class="seg ' + cls + '" data-tip="' + tip + '">' + list.map(([k, l]) => '<button type="button" data-v="' + k + '"' + (k === cur ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</span>';
function rowHtml(withLevel) {
  return (withLevel ? '<label>Rivals ' + seg('seg-ai', LEVELS, UI.aiLevel, 'Rival difficulty. Easy: rivals raid later, smaller and less often, breed slower and spot your nest from closer. Hard: early, big, frequent raids.') + '</label>' : '') +
    '<label>Text ' + seg('seg-ui', SIZES, UI.uiSize, 'Text and HUD size') + '</label>';
}
function sync() {
  for (const b of document.querySelectorAll('.seg-ai button')) b.classList.toggle('on', b.dataset.v === UI.aiLevel);
  for (const b of document.querySelectorAll('.seg-ui button')) b.classList.toggle('on', b.dataset.v === UI.uiSize);
}
function mount() {
  // title: a row under the options row (after the "Untick both..." note's previous sibling)
  const opt = $('chkFlight') && $('chkFlight').closest('.row');
  if (opt && !$('setRow')) { const r = document.createElement('div'); r.className = 'row setrow'; r.id = 'setRow'; r.innerHTML = rowHtml(true); opt.after(r); }
  const pm = $('btnResume') && $('btnResume').closest('.col');
  if (pm && !$('setRowPause')) { const r = document.createElement('div'); r.className = 'row setrow'; r.id = 'setRowPause'; r.innerHTML = rowHtml(false); pm.after(r); }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.seg button'); if (!b) return;
    if (b.parentElement.classList.contains('seg-ai')) UI.setAiLevel(b.dataset.v);
    else if (b.parentElement.classList.contains('seg-ui')) UI.setUiSize(b.dataset.v);
  });
  // a sharper minimap (2x backing store; ui-game.js scales its markers with the canvas)
  const mm = $('minimap'); if (mm && mm.width < 400) { mm.width = 400; mm.height = 300; }
}
const prevInit = UI.initScreens;
UI.initScreens = function () { if (prevInit) prevInit.apply(this, arguments); mount(); sync(); };
document.documentElement.style.setProperty('--ui-scale', SCALES[UI.uiSize]);

// every new game gets the chosen difficulty unless the caller (campaign, tests) set one
const prevStart = UI.startGame;
if (prevStart) UI.startGame = function (opts) { return prevStart.call(this, Object.assign({ aiLevel: UI.aiLevel }, opts || {})); };
})(window);
