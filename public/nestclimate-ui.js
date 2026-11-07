// UI for nestclimate.js: rows in the Layout panel (room levels, each nursery's and dryer's temperature, how much of
// the nest is lined), and in the nest view the sheen of spit-lined walls (render-nest.js puts each room's level, and
// a nursery's or dryer's temperature, on its name label).
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, NCl = AL.NestClimate, N = AL.Nest, CH = N.CH, NC = NCl.NC;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SHORT = { [CH.QUEEN]: 'Queen', [CH.NURSERY]: 'Nursery', [CH.FOOD]: 'Store', [CH.BARRACKS]: 'Barracks', [CH.MIDDEN]: 'Midden', [CH.WATER]: 'Water', [CH.FUNGUS]: 'Garden', [CH.APHID]: 'Aphids', [CH.DRYER]: 'Dryer' };
const PERK = {
  [CH.QUEEN]: l => '+' + Math.round(NC.LAY * 100 * (l - 1)) + '% laying',
  [CH.NURSERY]: l => '+' + Math.round(NC.BROOD * 100 * (l - 1)) + '% brood speed, +' + Math.round(NC.CAP * 100 * (l - 1)) + '% room',
  [CH.FOOD]: l => '+' + Math.round(NC.CAP * 100 * (l - 1)) + '% capacity, -' + Math.round(NC.SPOIL * 100 * (l - 1)) + '% spoilage',
  [CH.MIDDEN]: l => '+' + Math.round(NC.CAP * 100 * (l - 1)) + '% capacity, -' + Math.round(NC.DISEASE * 100 * (l - 1)) + '% disease',
  [CH.DRYER]: l => '+' + Math.round(NC.BROOD * 100 * (l - 1)) + '% pupa speed',
};
const perk = (ch, l) => (PERK[ch] ? PERK[ch](l) : '+' + Math.round(NC.CAP * 100 * (l - 1)) + '% capacity');
const nextAt = l => NC.LEVELS[l - 1];
// the biggest room of each chamber type
function bigRooms(nest) {
  const out = new Map();
  for (const r of roomsOf(nest)) { const b = out.get(r.ch); if (!b || r.tiles.length > b.tiles.length) out.set(r.ch, r); }
  return [...out.values()].sort((a, b) => a.ch - b.ch);
}
const deg = t => Math.round(t) + '°';
// read-only: the rooms the sim last worked out (the UI must never make it work them out at another moment)
const roomsOf = nest => nest.rooms || [];
function sig(f) {
  const n = f && f.nest; if (!n || n.bivouac) return '';
  const rs = roomsOf(n);
  return rs.map(r => r.ch + ':' + r.tiles.length + (r.warm ? ':' + Math.round(r.temp) + ':' + r.brood : '')).join(',') + '|' + (n.lineLeft || 0);
}
function rows(f) {
  const n = f && f.nest; if (!n || n.bivouac) return '';
  let h = '<div class="nc-rooms" data-tip="Rooms level up as you dig them bigger (' + NC.LEVELS.join(', ') + ' tiles). Each level holds more, and some rooms get a bonus of their own.">';
  for (const r of bigRooms(n)) {
    const l = r.level, nx = nextAt(l), info = N.CH_INFO[r.ch];
    const tip = info.name + ' level ' + l + ' (' + r.tiles.length + ' tiles)' + (l > 1 ? ': ' + perk(r.ch, l) : '') + '. ' + (nx ? 'Level ' + (l + 1) + ' at ' + nx + ' tiles: ' + perk(r.ch, l + 1) + '.' : 'Top level.');
    h += '<span class="nc-chip" data-tip="' + esc(tip) + '"><i class="sw" style="background:' + info.col + '"></i>' + SHORT[r.ch] + ' <b>' + l + '</b>' + (nx ? '<small>' + r.tiles.length + '/' + nx + '</small>' : '') + '</span>';
  }
  h += '</div>';
  // nurseries and dryers: each its own temperature, and where the brood is
  const warm = roomsOf(n).filter(r => r.warm && r.ch === CH.NURSERY), dry = roomsOf(n).filter(r => r.warm && r.ch === CH.DRYER);
  if (warm.length > 1 || dry.length) {
    const t = r => '<b class="' + (r.temp < 20 || r.temp > 34 ? 'warn' : '') + '">' + deg(r.temp) + '</b>' + (r.brood ? '<small> ' + r.brood + '</small>' : '');
    h += '<div class="nc-temp" data-tip="Each nursery has its own temperature: shallow ones warm up by day and cool at night, deep ones stay near 20°C. Brood grows fastest near ' + NC.BEST_T + '°C; the nurses carry it to whichever room is better. Pupae go to the pupa dryer (' + Math.round((NC.DRYER - 1) * 100) + '% faster in the top ' + NC.DRYER_ROWS + ' rows). The small numbers are brood in each room.">' +
      'Nurseries ' + warm.sort((a, b) => a.row - b.row).map(t).join(' · ') + (dry.length ? ' &nbsp;Dryer ' + dry.map(t).join(' · ') : '') + '</div>';
  }
  // lining
  const open = n.lineOpen || 0, done = open - (n.lineLeft || 0), pct = open ? Math.round(100 * done / open) : 0;
  h += '<div class="np-plug" data-tip="Workers with nothing better to do line the walls with spit, a tile at a time (' + NC.LINE_SUGAR + ' sugar each, only with ' + NC.LINE_KEEP + '+ sugar in store). Lined tunnels never cave in, and flood water never stands deeper than ankle-high in them, so ants there don\'t drown."><span>Walls lined</span><span class="np-bar"><i style="width:' + pct + '%;background:#cdbb8a"></i></span><span class="mute">' + pct + '%</span></div>';
  return h;
}

// ---- the nest view ----
let cache = null;
function linedCanvas(nest) {
  const key = nest.version + ':' + (nest.lineLeft || 0) + ':' + nest.n;
  if (cache && cache.nest === nest && cache.key === key) return cache.cv;
  const T = nest.tile, cols = nest.cols, rows = nest.rows;
  const cv = cache && cache.nest === nest ? cache.cv : document.createElement('canvas');
  cv.width = cols * T; cv.height = rows * T;
  const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height);
  x.strokeStyle = 'rgba(232,214,168,0.55)'; x.lineWidth = 1.4; x.beginPath();
  const solid = j => j < 0 || j >= nest.n || nest.kind[j] !== N.TILE.OPEN;
  for (let i = cols; i < nest.n; i++) {
    if (!nest.lined[i] || nest.kind[i] !== N.TILE.OPEN) continue;
    const c = i % cols, r = (i / cols) | 0, x0 = c * T, y0 = r * T;
    if (solid(i - cols)) { x.moveTo(x0, y0 + 0.8); x.lineTo(x0 + T, y0 + 0.8); }
    if (solid(i + cols)) { x.moveTo(x0, y0 + T - 0.8); x.lineTo(x0 + T, y0 + T - 0.8); }
    if (c === 0 || solid(i - 1)) { x.moveTo(x0 + 0.8, y0); x.lineTo(x0 + 0.8, y0 + T); }
    if (c === cols - 1 || solid(i + 1)) { x.moveTo(x0 + T - 0.8, y0); x.lineTo(x0 + T - 0.8, y0 + T); }
  }
  x.stroke();
  cache = { nest, key, cv };
  return cv;
}
function nestOver(ctx, view, r) {
  const nest = r.nest; if (!nest || nest.bivouac || !nest.lined) return;
  ctx.drawImage(linedCanvas(nest), 0, 0);
}
const sys = AL.SYSTEMS.find(s => s.id === 'nestclimate');
if (sys) sys.render = Object.assign(sys.render || {}, { nestOver });

AL.on('nestLined', (w, d) => { if (w === (AL.Game && AL.Game.world) && d.col === (w.me || 0) && UI.toast) UI.toast('The whole nest is lined: no cave-ins, and floods stay shallow.', 'good'); });
AL.NestClimateUI = { rows, sig };
})(window);
