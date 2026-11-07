// The UI side of nest tunnels (links.js) and aphid farming (aphids.js).
//  - Link tool [P] (after the Nest tunnels research): click one of your nests, then another; diggers start the tunnel.
//  - On the surface a tunnel shows as a dashed line under the lawn while it's dug (the dug part solid), then as a
//    solid one with specks of food moving along it when haulers carry loads.
//  - In the nest view the root-aphid chamber shows its herd (green aphids on the roots).
//  - The chamber bar gets the Root-aphid button once Aphid farming is researched.
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, TAU = Math.PI * 2;
const W = () => AL.Game && AL.Game.world;
const toast = (t, k) => { if (UI.toast) UI.toast(t, k); };
let first = null;   // the first nest picked with the Link tool

function register() {
  const T = AL.Tools && AL.Tools.TOOLS; if (!T) return;
  T.link = { id: 'link', layer: 'surface', name: 'Link nests', key: 'KeyP',
    tip: 'Nest tunnels: click one of your nests, then another. Diggers tunnel between them (costs 30 sugar and 30 protein from the first). Once open, ants sent between them go underground and haulers even out the two food stores.',
    paint(phase, x, y) {
      if (phase !== 'start') return;
      const w = W(); if (!w || !AL.Links) return;
      const me = w.me || 0, h = AL.Links.hillAt(w, me, x, y);
      if (!h) { toast(first ? 'Click the other nest to link.' : 'Click one of your nests.'); return; }
      if (!first || first === h) { first = h; toast('Now click the nest to link it to.'); return; }
      const a = first.hid, b = h.hid; first = null;
      AL.Cmd.issue('link', { a, b }, r => {
        if (!r) return;
        if (!r.ok) { toast(r.why || 'Can\'t link those.'); return; }
        toast(r.crew + ' diggers start the tunnel: about ' + Math.max(1, Math.round(r.eta / 60)) + ' min to dig.', 'good');
        if (AL.Tools.select) AL.Tools.select(null);
      });
    } };
}
register();
const baseTool = UI.onTool;
UI.onTool = function (tool) { if (!tool || tool.id !== 'link') first = null; return baseTool.apply(this, arguments); };

AL.on('linkOpen', (w, d) => { if (w === W() && d.col === (w.me || 0)) toast('Nest tunnel open: ants sent between those nests go underground, and haulers even out the food.', 'good'); });
AL.on('linkLost', (w, d) => { if (w === W() && d.col === (w.me || 0)) toast('A nest tunnel caved in: one of its nests is gone.', 'bad'); });
AL.on('researchDone', (w, d) => {
  if (w !== W() || d.col !== (w.me || 0)) return;
  if (d.what === 'aphidfarm' && UI.buildChambers) { UI.buildChambers(); toast('Aphid farming: paint a Root-aphid chamber in the nest. Foragers will bring live aphids home from the wild plants.', 'good'); }
  if (d.what === 'nestlink') toast('Nest tunnels: pick Link [P] and click two of your nests.', 'good');
});

// ---- drawing ----
function under(ctx, view, r) {
  const w = r.world, me = w.me || 0, Ls = w.links; if (!Ls || !Ls.length) return;
  const z = view.z, lw = Math.max(2.5, 4 / z);
  for (const l of Ls) {
    if (l.col !== me || l.state === 'lost') continue;
    const dx = l.x1 - l.x0, dy = l.y1 - l.y0, len = Math.hypot(dx, dy) || 1, k = l.state === 'open' ? 1 : l.prog;
    ctx.lineCap = 'round';
    // the dug part: dark soil seen through the grass
    ctx.strokeStyle = 'rgba(70,45,24,0.55)'; ctx.lineWidth = lw * 1.6;
    ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x0 + dx * k, l.y0 + dy * k); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,105,60,0.75)'; ctx.lineWidth = lw * 0.6;
    ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x0 + dx * k, l.y0 + dy * k); ctx.stroke();
    if (l.state === 'dig') {
      // still to dig: dashed, with the diggers' face pulsing
      ctx.setLineDash([8 / z * 2, 8 / z * 2]); ctx.strokeStyle = 'rgba(150,105,60,0.45)'; ctx.lineWidth = lw * 0.5;
      ctx.beginPath(); ctx.moveTo(l.x0 + dx * k, l.y0 + dy * k); ctx.lineTo(l.x1, l.y1); ctx.stroke(); ctx.setLineDash([]);
      const p = 0.5 + 0.5 * Math.sin(view.frame / 8);
      ctx.fillStyle = 'rgba(230,180,110,' + (0.4 + 0.4 * p) + ')'; ctx.beginPath(); ctx.arc(l.x0 + dx * k, l.y0 + dy * k, lw * (1.2 + p * 0.6), 0, TAU); ctx.fill();
    } else if (l.haul > 0) {
      // haulers on the way: food specks moving along it
      const n = Math.min(6, l.haul * 2), t = view.frame / 60;
      for (let j = 0; j < n; j++) {
        const u = ((t * 45 / len) + j / n) % 1;
        ctx.fillStyle = j % 2 ? '#f6e7b4' : '#d0674a';
        ctx.beginPath(); ctx.arc(l.x0 + dx * u, l.y0 + dy * u, lw * 0.55, 0, TAU); ctx.fill();
      }
    }
  }
  // the first nest picked with the Link tool
  if (first && AL.Tools.current && AL.Tools.current.id === 'link') {
    ctx.strokeStyle = 'rgba(201,154,98,0.9)'; ctx.lineWidth = Math.max(1.5, 2.5 / z); ctx.setLineDash([6 / z * 2, 5 / z * 2]);
    ctx.beginPath(); ctx.arc(first.x, first.y, (first.moundR || 16) * 1.9 + 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
}
// root aphids in the nest on view: little green bodies on the chamber's roots
function nestOver(ctx, view, r) {
  const nest = r.nest, h = r.nestOwner && r.nestOwner(); if (!nest || !h || !h.aphids || !nest.tiles[AL.Nest.CH.APHID]) return;
  const tiles = nest.tiles[AL.Nest.CH.APHID]; if (!tiles.length) return;
  const T = nest.tile, cols = nest.cols, n = Math.min(Math.floor(h.aphids), tiles.length * 4), t = view.frame / 60;
  for (let k = 0; k < n; k++) {
    const i = tiles[k % tiles.length], sl = (k / tiles.length) | 0;
    const cx = ((i % cols) + 0.5) * T, cy = (((i / cols) | 0) + 0.5) * T;
    const ox = (AL.hash2(i, sl, 7) - 0.5) * T * 0.75, oy = (AL.hash2(i, sl, 11) - 0.5) * T * 0.6 + Math.sin(t * 0.7 + k) * 0.25;
    const s = 1.1 + AL.hash2(i, sl, 13) * 0.6;
    ctx.fillStyle = '#8fc45a'; ctx.beginPath(); ctx.ellipse(cx + ox, cy + oy, s * 1.25, s, AL.hash2(i, sl, 17) * 3, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(40,70,20,0.6)'; ctx.beginPath(); ctx.arc(cx + ox + s * 0.9, cy + oy, s * 0.35, 0, TAU); ctx.fill();
  }
}
for (const id of ['links', 'aphids']) {
  const sys = AL.SYSTEMS.find(s => s.id === id);
  if (sys) sys.render = Object.assign(sys.render || {}, id === 'links' ? { underAnts: under } : { nestOver });
}
// a carried aphid: a little green body in the jaws
const R = AL.Renderer && AL.Renderer.prototype;
if (R && R.drawCarried) {
  const base = R.drawCarried;
  R.drawCarried = function (ctx, kind, x, y, z) {
    if (kind !== AL.CARRY.APHID) return base.apply(this, arguments);
    const r = Math.max(1.3, 1.9 * z); ctx.fillStyle = '#8fc45a'; ctx.beginPath(); ctx.ellipse(x, y, r * 1.3, r, 0.4, 0, TAU); ctx.fill();
  };
}
AL.DeepNestUI = { get first() { return first; } };
})(window);
