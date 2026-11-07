// Antlands screens: title (with a live colony behind it), how to play, pause menu.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI;
const $ = id => document.getElementById(id);
let G = null, demoT = 0;

const HOWTO = `
<h2>You are the colony</h2>
<p>You don't command single ants. You lay <b>pheromone trails</b> and decide what the queen lays; the ants do the rest, like real ants. Trails fade unless ants keep walking them.</p>
<div class="cols">
<div><h3>On the surface</h3>
<ul>
<li><b>Food trail [F]</b> paint from your mound toward food. Foragers follow it, and ants carrying food home keep it strong.</li>
<li><b>Alarm [R]</b> soldiers pour out and guard the spot.</li>
<li><b>Collect [T]</b> drag a circle over food: that many ants carry everything inside home until it is gone.</li>
<li><b>Avoid [V]</b> ants steer around it. <b>Erase [E]</b> wipes trails.</li>
</ul></div>
<div><h3>In the nest</h3>
<ul>
<li><b>Tab</b> or the wheel over your mound zooms into the nest.</li>
<li><b>Dig [G]</b> mark soil; workers dig it out and pile it on the mound.</li>
<li><b>Chamber [C]</b> paint rooms: nursery, food store, barracks, midden, water.</li>
<li><b>Egg queue</b> pick each egg. Larvae need protein.</li>
<li><b>Many queens</b> fire ants can keep a winged queen at home (Royal chamber): up to 6 queens lay together.</li>
</ul></div>
</div>
<h3>Keeping the colony alive</h3>
<p>Sugar feeds adults, protein raises brood. Food stores hold food; overflow spoils. A bigger mound keeps the nursery warm (brood grows fastest near 27°C). Carry the dead to a midden or disease spreads. Wounded ants walk home and rest in the nest (soldiers in the barracks) until healed, for a little sugar; they ignore alarms and recruit calls meanwhile unless the mound itself is attacked. Fights can cost legs, and big jaws now and then take a head: limbs never grow back, every lost leg makes an ant slower, one with no legs left on a side walks in circles, and a headless ant wanders blindly until it starves. Rival colonies, each a random species (2 to 8 colonies per match, set on the title screen), live around the yard. They forage, breed and raid each other and you, but nobody knows where anyone lives at first: their scouts have to find your nest, and your ants have to find theirs. You smell rivals (red wisps) before you see them. <b>Kill a queen</b> by sending enough ants into her mound. Lose yours and it's over.</p>
<p>Every ant has its own stomach: hungry ants walk to a food store and eat (surface ants come home for it), and nurses carry food to the larvae and the queen, who lays only when fed. When the store runs dry, ants with empty stomachs weaken and starve.</p>
<p class="mute">Pan: drag, WASD or arrows · Zoom: wheel, pinch, + / − · Space pause · 1 / 2 / 3 speed · H hide trails · M sound · click anything to inspect it · Esc menu</p>`;

UI.initScreens = function () {
  G = AL.Game;
  const div = document.createElement('div');
  div.innerHTML = `
<section class="ov title" id="title" hidden>
  <div class="sheet hero">
    <div class="kicker">A backyard ant colony sim</div>
    <h1>Antlands</h1>
    <p>Lay pheromone trails, dig the nest, raise the brood, and outgrow the rival colonies next door.</p>
    <div id="speciesPick"></div>
    <div class="row"><label class="auto"><input type="checkbox" id="chkFlight" checked> Nuptial flight</label><label class="auto"><input type="checkbox" id="chkFound" checked> Founding</label><label class="auto colpick" data-tip="Colonies in the match: you plus 1 to 7 rivals, each a random species. Rivals don't know where you are until their scouts find you.">Colonies <button type="button" id="colDn" aria-label="Fewer colonies">&minus;</button><b id="colN">6</b><button type="button" id="colUp" aria-label="More colonies">+</button></label></div>
    <p class="mute small" style="margin:2px 0 10px">Untick both to start straight away with a young colony of about 40 ants.</p>
    <div class="row startrow"><button class="go" id="btnStart">Start colony</button><button id="btnCampaign" data-tip="A Backyard Summer: ten short missions that teach the game, then test it.">Campaign</button><button id="btnHow">How to play</button></div>
    <p class="mute small">Uses your mouse or touch. <a href="#" id="lnkBench">Run the 5,000-ant benchmark</a></p>
  </div>
</section>
<section class="ov" id="howto" hidden><div class="sheet wide">${HOWTO}<div class="row"><button class="go" id="btnHowClose">Got it</button></div></div></section>
<section class="ov" id="pausem" hidden>
  <div class="sheet narrow"><h1>Paused</h1>
    <div class="col"><button class="go" id="btnResume">Resume [Esc]</button><button id="btnHow2">How to play</button><button id="btnSound" hidden>Sound: off</button><button id="btnRestart">Restart colony</button><button id="btnQuit">Quit to title</button></div>
  </div>
</section>`;
  document.body.appendChild(div);
  $('btnStart').onclick = () => UI.startGame();
  $('btnHow').onclick = () => { $('howto').hidden = false; };
  $('btnCampaign').onclick = () => { if (AL.CampaignUI) AL.CampaignUI.open(); };   // campaign mode (campaign-ui.js)
  $('btnHow2').onclick = () => { $('howto').hidden = false; };
  $('btnHowClose').onclick = () => { $('howto').hidden = true; };
  $('btnResume').onclick = () => UI.showPause(false);
  $('btnRestart').onclick = () => { UI.showPause(false); UI.startGame(UI.lastOpts); };
  $('btnQuit').onclick = () => { UI.showPause(false); UI.showTitle(); };
  $('lnkBench').onclick = e => { e.preventDefault(); location.search = '?bench=5000'; };
  if (AL.Audio) { $('btnSound').hidden = false; $('btnSound').onclick = () => { AL.Audio.toggle(); UI.syncSound(); }; }
  if (UI.buildSpecies) UI.buildSpecies($('speciesPick'));
  // colonies per match (2-8, remembered)
  const C = AL.Colonies, syncCol = () => { $('colN').textContent = UI.colonies; $('colDn').disabled = UI.colonies <= C.MIN; $('colUp').disabled = UI.colonies >= C.MAX; };
  const setCol = n => { UI.colonies = C.clampN(n); try { localStorage.setItem('antlands.colonies', String(UI.colonies)); } catch (_) {} syncCol(); };
  $('colDn').onclick = () => setCol(UI.colonies - 1); $('colUp').onclick = () => setCol(UI.colonies + 1);
  syncCol();
  const st = document.createElement('style');
  st.textContent = '.colpick{margin-left:14px}.colpick button{min-width:22px;padding:1px 6px;line-height:1.2}.colpick b{min-width:12px;text-align:center;color:var(--ink)}';
  document.head.appendChild(st);
};
try { UI.colonies = AL.Colonies.clampN(localStorage.getItem('antlands.colonies') || AL.Colonies.DEFAULT); } catch (_) { UI.colonies = AL.Colonies.DEFAULT; }
// a rival's scouts found your nest: say so only when one of your ants could see the scout
AL.on('colonyFound', (w, d) => { if (d.target === (w.me || 0) && d.seen && AL.Game && w === AL.Game.world && !AL.Game.demo) UI.toast('A rival colony has found your nest.', 'bad'); });
// a full-screen scene (nuptial flight, founding) owns the canvas: hide the colony HUD

UI.onScene = function () {
  document.body.classList.add('scene');
  for (const id of ['hud', 'toasts', 'perf', 'tooltip', 'title', 'howto', 'pausem', 'gameover']) { const el = $(id); if (el) el.hidden = true; }
  AL.Tools.select(null);
};
// species picker on the title: code-drawn worker portrait, name, blurb and perks
try { UI.species = localStorage.getItem('antlands.species') || 'fire'; } catch (_) { UI.species = 'fire'; }
const playable = k => !AL.isPlayable || AL.isPlayable(k);
if (!playable(UI.species)) UI.species = 'fire';
UI.buildSpecies = function (el) {
  el.className = 'species';
  el.innerHTML = '';
  if (!AL.SPECIES[UI.species] || !playable(UI.species)) UI.species = 'fire';
  // the playable species first, then the rest greyed out as "Coming soon"
  const order = (AL.SPECIES_ORDER || Object.keys(AL.SPECIES)).slice().sort((a, b) => (playable(a) ? 0 : 1) - (playable(b) ? 0 : 1));
  for (const key of order) {
    const sp = AL.SPECIES[key], b = document.createElement('button'), soon = !playable(key);
    if (!sp) continue;
    b.className = 'spc' + (UI.species === key ? ' on' : '') + (soon ? ' soon' : ''); b.dataset.sp = key;
    const cv = document.createElement('canvas'); cv.width = cv.height = 96; cv.style.width = cv.style.height = '44px'; cv.className = 'spc-art';
    // portrait: the species' signature ant (a replete for honeypot ants), big species drawn a little larger but kept in frame
    // (bigger than before so the species are easy to tell apart at a glance)
    const k = 4.6 * Math.min(sp.size, 1.3), caste = sp.repletes ? AL.CASTE.HONEYPOT : AL.CASTE.WORKER;
    const x = cv.getContext('2d'); x.setTransform(0, -k, k, 0, 48, 52); AL.Art.drawAnt(x, caste, sp, 1);
    const t = document.createElement('span');
    t.innerHTML = '<b>' + sp.name + (soon ? ' <em class="soon-tag">Coming soon</em>' : '') + '</b><small>' + sp.blurb + '</small>';
    b.appendChild(cv); b.appendChild(t);
    b.dataset.tip = sp.name + (soon ? ' (coming soon)' : '') + ': ' + (sp.perks || []).join(' · ');
    if (soon) { b.setAttribute('aria-disabled', 'true'); el.appendChild(b); continue; }
    b.onclick = () => { UI.species = key; try { localStorage.setItem('antlands.species', key); } catch (_) {} for (const o of el.children) o.classList.toggle('on', o.dataset.sp === key); };
    el.appendChild(b);
  }
};
UI.syncSound = function () { if (AL.Audio && $('btnSound')) $('btnSound').textContent = 'Sound: ' + (AL.Audio.on ? 'on' : 'off'); };
UI.showTitle = function () {
  // a live demo colony runs behind the title
  G.demo = true;
  G.newGame({ seed: 777, demo: true, noFog: true });
  $('hud').hidden = true; $('title').hidden = false;
  G.renderer.cam.z = 1.6; G.speed = 1; G.paused = false;
};
UI.startGame = function (opts) {
  opts = Object.assign({ seed: (Math.random() * 1e9) | 0, rivalNests: true, species: playable(UI.species) ? UI.species : 'fire', skipFlight: !$('chkFlight').checked, skipFounding: !$('chkFound').checked, colonies: UI.colonies || AL.Colonies.DEFAULT }, opts || {});
  // each rival gets a random species; the flight's rival queens (opts.rivals) are the same ones
  opts.colonies = AL.Colonies.clampN(opts.colonies);
  // army ant queens have no wings and found nothing alone: their colonies split (expansion.js), so no flight or founding
  if (AL.SPECIES[opts.species] && AL.SPECIES[opts.species].nomad) { opts.skipFlight = true; opts.skipFounding = true; }
  if (!opts.rivalSpecies) opts.rivalSpecies = AL.Colonies.pickSpecies(opts.seed, opts.colonies - 1);
  if (opts.rivals == null) opts.rivals = opts.rivalSpecies.slice();
  UI.lastOpts = { species: opts.species, skipFlight: true, skipFounding: true, colonies: opts.colonies, biome: opts.biome, mapSize: opts.mapSize };
  G.demo = false;
  $('title').hidden = true; $('howto').hidden = true;
  G.startFlow(opts);
};
UI.showPause = function (on) {
  if (G.demo || !G.world) return;
  $('pausem').hidden = !on; G.paused = on; UI.syncSpeed(); UI.syncSound();
};
UI.screenKey = function (e) {
  if (!$('howto').hidden && (e.code === 'Escape' || e.code === 'Enter')) { $('howto').hidden = true; return true; }
  if (!$('pausem').hidden) { if (e.code === 'Escape' || e.code === 'Space') { UI.showPause(false); e.preventDefault(); } return true; }
  if (!$('title').hidden) { if (e.code === 'Enter' || e.code === 'Space') { UI.startGame(); e.preventDefault(); } return true; }
  return false;
};
const baseNew = UI.onNewGame;
UI.onNewGame = function (world, opts) {
  baseNew(world, opts);
  if (opts && opts.demo) { $('hud').hidden = true; }
  document.body.classList.toggle('demo', !!(opts && opts.demo)); document.body.classList.remove('scene');
  // the Royal chamber panel (Expansion) starts folded; it unfolds once royals can be raised
  if (AL.ExpansionUI) AL.ExpansionUI.folded = world.player.pop.reduce((a, b) => a + b, 0) < 70 && !(opts && opts.late);
};
const baseExtra = UI.frameExtra;
UI.frameExtra = function (w, dt) {
  if (baseExtra) baseExtra(w, dt);
  // unfold the Royal chamber once the colony is big enough to raise royals
  if (AL.ExpansionUI && !w._royalShown && !G.demo) { const pop = w.player.pop.reduce((a, b) => a + b, 0); if (pop >= 70) { w._royalShown = true; AL.ExpansionUI.folded = false; } }
  if (G.demo) {
    // slow drift over the yard behind the title
    demoT += dt;
    const r = G.renderer, c = w.player;
    r.cam.x = c.x + 330 + Math.sin(demoT * 0.05) * 120; r.cam.y = c.y - 60 + Math.cos(demoT * 0.04) * 80; r.cam.z = 1.9; r.clampCam(r.cam);
  }
};
})(window);
