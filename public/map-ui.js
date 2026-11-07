// The map screen: pick a biome (terrain.js AL.BIOMES) and a map size (AL.MAP_SIZES) before a match.
// A "Map" button on the title screen opens it; the choice is remembered (UI.biome, UI.mapSize) and goes into
// UI.startGame's options. Each biome card shows a little preview of its terrain, what's on the ground and which
// species do a bit better there. Map size needs the nuptial flight and founding off (they play on a medium yard).
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
try { UI.biome = AL.BIOMES[localStorage.getItem('antlands.biome')] ? localStorage.getItem('antlands.biome') : 'backyard'; } catch (e) { UI.biome = 'backyard'; }
try { UI.mapSize = AL.MAP_SIZES[localStorage.getItem('antlands.mapSize')] ? localStorage.getItem('antlands.mapSize') : 'medium'; } catch (e) { UI.mapSize = 'medium'; }
const save = () => { try { localStorage.setItem('antlands.biome', UI.biome); localStorage.setItem('antlands.mapSize', UI.mapSize); } catch (e) { /* fine */ } };

// a small preview of a biome's ground (same noise and picker as terrain.js, no world needed)
const TONE = ['#5b8a3b', '#d9c28c', '#a39a8a', '#5e4630', '#7a5a2e', '#3f78a8', '#8a6a3e'];
const previews = {};
function preview(key) {
  if (previews[key]) return previews[key];
  const B = AL.BIOMES[key], w = 96, h = 72, c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h), T = AL.TERRAIN, bands = AL.Terrain.streamPlan(7, B, h * 40, [[-28 * 40, 18 * 40], [28 * 40, -18 * 40], [-28 * 40, -18 * 40], [28 * 40, 18 * 40]]);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const u = (px - w / 2) * 40, v = (py - h / 2) * 40;
    const a = AL.fbm(u / 620 + 7.3, v / 620 + 1.9, 101, 3), b = AL.fbm(u / 380 + 3.1, v / 380 - 2.2, 202, 3), cc = AL.fbm(u / 240 - 5.5, v / 240 + 4.4, 303, 2);
    let t = B.pick(a, b, cc);
    if (bands.length && AL.Terrain.inStream(bands.map(b => Object.assign({}, b, { w: b.w * 3 })), u, v, 7)) t = T.STREAM;   // (drawn wider: the preview is tiny)
    const hex = parseInt(TONE[t].slice(1), 16), n = 0.88 + AL.hash2(px, py, 5) * 0.2, i = (py * w + px) * 4;
    img.data[i] = ((hex >> 16) & 255) * n; img.data[i + 1] = ((hex >> 8) & 255) * n; img.data[i + 2] = (hex & 255) * n; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // the colonies round the edge, the prize in the middle
  x.fillStyle = '#2a1a0c'; for (const [qx, qy] of [[20, 54], [76, 18], [20, 18], [76, 54]]) { x.beginPath(); x.arc(qx, qy, 3.2, 0, Math.PI * 2); x.fill(); }
  x.strokeStyle = '#f2c14e'; x.lineWidth = 1.5; x.beginPath(); x.arc(48, 36, 5, 0, Math.PI * 2); x.stroke();
  return (previews[key] = c.toDataURL());
}
const SP_NAME = k => (AL.SPECIES[k] ? AL.SPECIES[k].name : k);
function edgeText(B) {
  const e = B.edge, keys = e ? Object.keys(e).filter(k => !AL.isPlayable || AL.isPlayable(k)) : [];
  if (!keys.length) return 'No species is favoured here.';
  return 'A little better here: ' + keys.map(k => { const f = e[k]; return SP_NAME(k) + (f.fungus && f.fungus < 1 ? ' (worse)' : ''); }).join(', ') + '.';
}
function sizeHint(n) { return n <= 3 ? 'small' : n <= 5 ? 'medium' : 'large'; }
function label() {
  const B = AL.BIOMES[UI.biome], Z = AL.MAP_SIZES[UI.mapSize];
  return 'Map: <b>' + esc(B.name) + '</b> &middot; ' + esc(Z.name);
}
function render() {
  const el = $('mapPick'); if (!el) return;
  const n = UI.colonies || AL.Colonies.DEFAULT, hint = sizeHint(n);
  let h = '<h1>Choose a map</h1><div class="biomes">';
  for (const k of AL.BIOME_ORDER) {
    const B = AL.BIOMES[k];
    const ter = B.terrain.map(t => { const info = AL.TERRAIN_INFO.find(q => q.key === t); return '<i data-tip="' + esc(info.tip) + '" style="background:' + info.col + '"></i>' + esc(info.name); }).join(' ');
    h += '<button class="biome' + (UI.biome === k ? ' on' : '') + '" data-biome="' + k + '"><img src="' + preview(k) + '" alt=""><b>' + esc(B.name) + '</b><span>' + esc(B.blurb) + '</span><small class="ter">' + ter + '</small><small>' + esc(edgeText(B)) + '</small></button>';
  }
  h += '</div><h3>Map size</h3><div class="sizes">';
  for (const k of ['small', 'medium', 'large']) {
    const Z = AL.MAP_SIZES[k], on = UI.mapSize === k;
    h += '<button class="size' + (on ? ' on' : '') + '" data-size="' + k + '"><b>' + Z.name + (k === hint ? ' <em>suggested</em>' : '') + '</b><span>' + Z.W + ' &times; ' + Z.H + ' &middot; ' + Z.best + '</span>' +
      '<i class="szbox" style="width:' + Math.round(Z.W / 80) + 'px;height:' + Math.round(Z.H / 80) + 'px"></i></button>';
  }
  h += '</div><p class="mute small">' + ('You picked ' + n + ' colonies: ' + AL.MAP_SIZES[hint].name.toLowerCase() + ' fits best. Bigger maps mean longer walks and later fights.') + '</p>';
  h += '<div class="row"><button class="go" id="mapDone">Done</button></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-biome]').forEach(b => { b.onclick = () => { UI.biome = b.dataset.biome; save(); render(); sync(); }; });
  el.querySelectorAll('[data-size]').forEach(b => { b.onclick = () => { if (b.disabled) return; UI.mapSize = b.dataset.size; save(); render(); sync(); }; });
  $('mapDone').onclick = () => { $('mapov').hidden = true; };
}
function sync() { const b = $('btnMap'); if (b) b.innerHTML = label() + ' &#9656;'; }
function style() {
  const s = document.createElement('style');
  s.textContent = '#btnMap{margin-left:12px}#btnMap b{color:var(--gold,#f2c14e)}' +
    '#mapPick .biomes{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:8px 0 14px}' +
    '#mapPick .biome{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:10px;border-radius:12px;border:2px solid transparent;min-width:0;white-space:normal}' +
    '#mapPick .biome.on{border-color:var(--gold,#f2c14e);box-shadow:0 0 0 2px rgba(242,193,78,.25)}#mapPick .biome img{width:100%;height:auto;border-radius:8px;image-rendering:pixelated}' +
    '#mapPick .biome b{font-size:var(--fs-l,16px)}#mapPick .biome span{font-size:var(--fs-s,13px);line-height:1.35}#mapPick .biome small{color:var(--mute);font-size:var(--fs-xs,11px);line-height:1.4}' +
    '#mapPick .ter i{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 2px 0 6px;vertical-align:-1px}#mapPick .ter i:first-child{margin-left:0}' +
    '#mapPick .sizes{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0}#mapPick .size{display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:8px 12px;border-radius:10px;border:2px solid transparent;min-width:150px;white-space:normal}' +
    '#mapPick .size.on{border-color:var(--gold,#f2c14e)}#mapPick .size em{font-style:normal;font-size:var(--fs-xs,11px);color:var(--gold,#f2c14e);margin-left:4px}#mapPick .size span{font-size:var(--fs-xs,11px);color:var(--mute)}' +
    '#mapPick .szbox{display:block;border:1px solid rgba(240,220,180,.5);background:rgba(120,160,80,.25);border-radius:2px;margin-top:3px}#mapPick .size[disabled]{opacity:.45}';
  document.head.appendChild(s);
}
// build: a Map button on the title's options row and the overlay (UI.buildTitle runs first, from ui-screens.js)
function build() {
  if ($('btnMap') || !$('colN')) return;
  style();
  const row = $('colN').closest('.row'), b = document.createElement('button'); b.type = 'button'; b.id = 'btnMap';
  b.setAttribute('data-tip', 'Biome and map size'); row.appendChild(b);
  const ov = document.createElement('section'); ov.className = 'ov'; ov.id = 'mapov'; ov.hidden = true; ov.innerHTML = '<div class="sheet wide" id="mapPick"></div>';
  document.body.appendChild(ov);
  b.onclick = () => { render(); ov.hidden = false; };
  for (const id of ['chkFlight', 'chkFound', 'colUp', 'colDn']) { const e = $(id); if (e) e.addEventListener('click', () => setTimeout(sync, 0)); }
  sync();
}
// the options go into every new game (ui-screens.js UI.startGame) unless the caller set them
const baseStart = UI.startGame;
UI.startGame = function (opts) {
  opts = Object.assign({}, opts || {});
  if (opts.biome == null) opts.biome = UI.biome;
  if (opts.mapSize == null) opts.mapSize = UI.mapSize;
  return baseStart.call(this, opts);
};
UI.mapLabel = label;
// no people about in the wild biomes: the recall button is just a recall there (no mower)
const baseNew = UI.onNewGame;
UI.onNewGame = function (world, opts) {
  if (baseNew) baseNew.apply(this, arguments);
  const b = $('btnRecall'), B = AL.BIOMES[world && world.biomeKey] || AL.BIOMES.backyard;
  if (b) b.textContent = B.humans ? 'Mower alarm [U]' : 'Recall all [U]';
  if (b) b.setAttribute('data-tip', B.humans ? 'Mower alarm [U]: every ant on the surface runs home and stays in the nest. Sounded while the mower is coming, it clears itself when the mower is done. Press again to call it off.' : 'Recall all [U]: every ant on the surface runs home and stays in the nest until you press it again. Handy in a storm or when a raid is coming.');
};
const tryBuild = () => { if (document.getElementById('colN')) build(); else setTimeout(tryBuild, 50); };
tryBuild();
})(window);
