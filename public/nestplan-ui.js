// UI for nestplan.js: the Layout panel (which room bonuses the nest on focus has, and the door plug with its
// Open / Close button), the plug on each mound (a soil cap, with a health bar while it's chewed), glints on buried
// finds next to open tunnels in the nest view, and toasts for finds and broken plugs.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, TAU = Math.PI * 2, $ = id => document.getElementById(id);
const W = () => AL.Game && AL.Game.world;
const toast = (t, k) => { if (UI.toast) UI.toast(t, k); };
let el = null, sig = '';
const fmt = v => String(Math.round(v));

function ensure() {
  if (el) return el;
  const after = $('nestStats'); if (!after || !after.parentNode) return null;
  el = document.createElement('div'); el.id = 'nestPlan'; el.className = 'panel'; el.hidden = true;
  after.parentNode.insertBefore(el, after.nextSibling);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-plug]'); if (!b) return;
    const w = W(), f = UI.focus && UI.focus(w); if (!w || !f) return;
    const a = { on: b.dataset.plug === '1' }; if (f.sat) a.h = f.hid;
    AL.Cmd.issue('plug', a, () => { sig = ''; });
  });
  return el;
}
function row(on, label, tip, good) {
  return '<div class="np-row' + (on ? ' on' : '') + (on && good === false ? ' bad' : '') + '" data-tip="' + tip + '"><span class="np-dot">' + (on ? (good === false ? '!' : '✓') : '·') + '</span>' + label + '</div>';
}
function frame(w) {
  const e = ensure(); if (!e || !AL.NestPlan) return;
  const f = (UI.focus && UI.focus(w)) || w.player;
  if (!f || !f.nest || (f.sp && f.sp.nomad)) { e.hidden = true; return; }
  // read-only: what the sim worked out (layout once a second, the plug when it made one); never compute here
  const L = Object.prototype.hasOwnProperty.call(f, 'layout') ? f.layout : null, p = AL.NestPlan.plugPeek(f);
  if (!L) { e.hidden = true; return; }
  const NCU = AL.NestClimateUI;   // rooms, nursery temperatures and lined walls (nestclimate-ui.js)
  const s = [L.v, L.nursery, L.food, L.midden, L.barracks, p && p.on, p && Math.round(p.hp / 5), p && Math.round(p.max), NCU ? NCU.sig(f) : ''].join(',');
  e.hidden = false;
  if (s === sig) return; sig = s;
  const NP = AL.NestPlan.NP, heads = AL.NestPlan.heads(f);
  e.innerHTML = '<div class="ph"><span data-tip="Bonuses for how the nest is laid out. Distances are walking tiles between rooms.">Layout</span></div>' +
    row(L.nursery, 'Nursery by the queen <span class="mute">+15% brood</span>', 'Dig the nursery within ' + NP.NEAR + ' tiles of the queen\'s chamber: eggs go straight to the nurses and the brood grows 15% faster.') +
    row(L.food, 'Store by the reservoir <span class="mute">½ spoilage</span>', 'Dig the food store within ' + NP.NEAR + ' tiles of a water reservoir: the cool damp keeps food fresh, so it spoils half as fast.') +
    (L.midden < 0 ? row(true, 'Midden by the nursery <span class="mute">2× disease</span>', 'The midden is within ' + NP.NEAR + ' tiles of the nursery: twice the disease from it, and it smells. Move it ' + NP.FAR_MIDDEN + '+ tiles away.', false)
      : row(L.midden > 0, 'Midden far from the nursery <span class="mute">½ disease</span>', 'Keep the midden ' + NP.FAR_MIDDEN + ' or more tiles from the nursery: half the disease from it.')) +
    row(L.barracks, 'Barracks by the door <span class="mute">2× plug repair</span>', 'Dig the barracks within ' + (NP.NEAR + 2) + ' tiles of the entrance: the door plug is rebuilt twice as fast.') +
    (p ? '<div class="np-plug" data-tip="' + (heads ? 'Carpenter majors block the door with their heads: ' + NP.PLUG_HEADS + '× as tough. ' : '') + 'Your ants pass the plug; raiders must chew through it before they get in. Workers rebuild it with soil once nobody has chewed it for ' + NP.PLUG_QUIET + ' s.">' +
      '<span>Door ' + (p.on ? (heads ? 'held by majors' : 'plugged') : '<b class="warn">open</b>') + '</span>' +
      (p.on ? '<span class="np-bar"><i style="width:' + Math.round(100 * p.hp / Math.max(1, p.max)) + '%"></i></span><span class="mute">' + fmt(p.hp) + '</span>' : '') +
      '<button data-plug="' + (p.on ? 0 : 1) + '">' + (p.on ? 'Open' : 'Plug') + '</button></div>' : '') +
    (NCU ? NCU.rows(f) : '');
}

// ---- drawing ----
function over(ctx, view, r) {
  const w = r.world, z = view.z;
  for (const h of w.homes || w.colonies) {
    if (!h || h.gone || !h.nest || h.alive === false || !h.plug || !Object.prototype.hasOwnProperty.call(h, 'plug')) continue;
    const p = h.plug; if (!p.on || p.hp <= 0) continue;
    if (r.fogged && r.fogged(h.x, h.y)) continue;
    const rr = Math.max(3, (h.moundR || 16) * 0.22), heads = AL.NestPlan.heads(h);
    ctx.fillStyle = heads ? 'rgba(52,38,32,0.95)' : 'rgba(120,86,52,0.95)';
    ctx.beginPath(); ctx.arc(h.x, h.y, rr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(30,20,12,0.7)'; ctx.lineWidth = Math.max(0.6, 1 / z); ctx.stroke();
    if (heads) { ctx.fillStyle = 'rgba(90,64,50,0.95)'; for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.4; ctx.beginPath(); ctx.arc(h.x + Math.cos(a) * rr * 0.45, h.y + Math.sin(a) * rr * 0.45, rr * 0.35, 0, TAU); ctx.fill(); } }
    if (p.hp < p.max - 0.5 && w.t - p.hitT < 8) {   // being chewed: a health bar over the door
      const bw = Math.max(18, rr * 5), by = h.y - rr - Math.max(5, 7 / z), bh = Math.max(2, 3 / z);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(h.x - bw / 2, by, bw, bh);
      ctx.fillStyle = '#d9a35a'; ctx.fillRect(h.x - bw / 2, by, bw * p.hp / p.max, bh);
    }
  }
}
function nestOver(ctx, view, r) {
  const nest = r.nest; if (!nest || !AL.NestPlan) return;
  const T = nest.tile, cols = nest.cols, t = view.frame / 60;
  for (const [i, f] of AL.NestPlan.hints(nest)) {
    const cx = ((i % cols) + 0.5) * T, cy = (((i / cols) | 0) + 0.5) * T, ph = AL.hash2(i, 3, 5) * TAU;
    const a = 0.35 + 0.45 * Math.max(0, Math.sin(t * 2.2 + ph));
    ctx.fillStyle = f === 'spring' ? 'rgba(140,200,255,' + a + ')' : f === 'pocket' ? 'rgba(220,220,220,' + a + ')' : 'rgba(255,225,140,' + a + ')';
    const s = T * 0.13;
    ctx.beginPath(); ctx.moveTo(cx, cy - s * 2); ctx.lineTo(cx + s * 0.5, cy - s * 0.5); ctx.lineTo(cx + s * 2, cy); ctx.lineTo(cx + s * 0.5, cy + s * 0.5);
    ctx.lineTo(cx, cy + s * 2); ctx.lineTo(cx - s * 0.5, cy + s * 0.5); ctx.lineTo(cx - s * 2, cy); ctx.lineTo(cx - s * 0.5, cy - s * 0.5); ctx.closePath(); ctx.fill();
  }
}
const sys = AL.SYSTEMS.find(s => s.id === 'nestplan');
if (sys) sys.render = Object.assign(sys.render || {}, { overAnts: over, nestOver });

AL.on('nestFind', (w, d) => {
  if (w !== W() || d.col !== (w.me || 0)) return;
  const g = d.give ? Object.keys(d.give).map(k => '+' + Math.round(d.give[k] * (k === 'water' ? 1 : d.mul || 1)) + ' ' + k).join(', ') : 'a few tiles open up';
  toast('Diggers found ' + d.name.replace(/^An? /, m => m.toLowerCase()) + ': ' + g + '.', 'good');
});
AL.on('plugBroken', (w, d) => {
  if (w !== W()) return;
  const me = w.me || 0;
  if (d.col === me) toast('Raiders chewed through a door plug: they\'re breaking in!', 'bad');
  else if (d.by === me) toast('Your ants chewed through their door plug.', 'good');
});
let acc = 0;
const base = UI.frameExtra;
UI.frameExtra = function (w, dt) { if (base) base(w, dt); acc += dt; if (acc < 0.4) return; acc = 0; try { frame(w); } catch (e) { console.error(e); } };
})(window);
