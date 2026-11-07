// Antlands player tools: pheromone brushes painted with the mouse/finger.
// Surface: food trail, alarm, avoid, collect, erase. Nest tools (dig, chambers) register themselves later.
(function (root) {
'use strict';
const AL = root.AL;
const TOOLS = {};
let G = null, cur = null, stroke = null;


// Painting is split in two: paint() here runs in the UI and sends each stroke step as a 'paint' command
// (AL.Cmd); brush.js does the brush work on the world for one colony, the same on every PC of a match.
let sent = null;   // last point sent for the current stroke (thins the 'move' commands)
function issuePaint(id, phase, x, y) {
  const a = { t: id, p: phase, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, n: AL.Tools.collectN || 10, ch: AL.Tools.chamberType };
  const on = AL.UI && AL.UI.focus && AL.UI.focus(G.world);
  if (on && on.sat && on.id === (G.world.me || 0)) a.h = on.hid;   // orders from (or painting in) one of your satellites' nests (nest tabs)
  if (phase === 'start') { sent = { x, y }; stroke = { id }; }
  else if (!stroke) return;
  else if (phase === 'move') { if (sent && AL.dist2(sent.x, sent.y, x, y) < 9) return; sent = { x, y }; }
  else stroke = null;
  AL.Cmd.issue('paint', a);
}
const radius = id => (AL.Brush && AL.Brush.B[id] && AL.Brush.B[id].radius) || 14;
function brush(id, opts) {
  TOOLS[id] = Object.assign({ id, layer: 'surface', get radius() { return radius(id); },
    paint(phase, x, y) { if (G.world) issuePaint(this.id, phase, x, y); } }, opts);
}
brush('food', { name: 'Food trail', key: 'KeyF', tip: 'Paint a path from the mound toward food. Foragers follow it; it fades unless ants keep walking it.' });
brush('alarm', { name: 'Alarm', key: 'KeyR', tip: 'Sound the alarm: soldiers pour out of the nest and rally where you paint, then guard the spot.' });
// Collect: press on the ground and drag out a circle; letting go sends that many ants for the food inside (the piles and
// dead bugs you have seen there). They carry it all home, trip after trip, until it is gone. The circle being drawn is
// UI only; the order is one 'collect' command (cmd.js -> orders.js addCollect).
const CIRCLE = { MIN: 18, MAX: 600 };
let circle = null;
function foodsIn(w, x, y, r) {
  const c = w.player, fog = w.fog, out = [];
  if (!c || !AL.Orders || !AL.Orders.collectable) return out;
  for (const f of w.surface.foods) {
    if (!AL.Orders.collectable(w, c, f) || AL.dist2(f.x, f.y, x, y) > AL.sq(r + f.r * 0.5)) continue;
    if (fog && fog.seenAt && !fog.seenAt(f.x, f.y)) continue;   // only food this player knows about
    out.push(f);
  }
  return out;
}
TOOLS.collect = { id: 'collect', layer: 'surface', name: 'Collect', key: 'KeyT', tip: 'Press on the ground and drag out a circle over food. When you let go, that many ants (pick the number) go out and carry everything inside home, food piles and dead bugs, trip after trip until it is gone. Right-click the circle or press its x to call it off.',
  paint(phase, x, y) {
    const w = G.world; if (!w) return;
    if (phase === 'start') { circle = { x, y, r: CIRCLE.MIN }; stroke = { id: 'collect' }; return; }
    if (!circle) return;
    if (phase === 'move') { circle.r = AL.clamp(Math.hypot(x - circle.x, y - circle.y), CIRCLE.MIN, CIRCLE.MAX); return; }
    const c = circle; circle = null; stroke = null;
    if (phase !== 'end') return;   // (Esc: no order)
    c.r = AL.clamp(Math.hypot(x - c.x, y - c.y), CIRCLE.MIN, CIRCLE.MAX);
    const ids = foodsIn(w, c.x, c.y, c.r).map(f => f.id);
    if (!ids.length) { if (AL.UI && AL.UI.toast) AL.UI.toast('No food you know of inside that circle. Drag a bigger one over food piles or dead bugs.'); return; }
    const a = { x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, r: Math.round(c.r * 10) / 10, ids, n: AL.Tools.collectN || 10 };
    const on = AL.UI && AL.UI.focus && AL.UI.focus(w);
    if (on && on.sat && on.id === (w.me || 0)) a.h = on.hid;   // from one of your satellites' nests (nest tabs)
    AL.Cmd.issue('collect', a, r => {
      if (!r) return;
      if (!r.ok) { if (r.why && AL.UI) AL.UI.toast(r.why); return; }
      if (AL.UI && AL.UI.toast) AL.UI.toast(r.want + (r.want === 1 ? ' ant collects ' : ' ants collect ') + (r.piles === 1 ? 'the food' : r.piles + ' finds') + ' in the circle until it\'s gone.', 'good');
      if (AL.UI && AL.UI.hintEvent) AL.UI.hintEvent('collect');
    });
  } };
// army ants: steer the bivouac's clock (bivouac.js). The colony moves on its own in the wandering (nomadic)
// phase; March sends the next move where you click. Swarm raid aims the next raid (swarm.js).
TOOLS.march = { id: 'march', layer: 'surface', name: 'March', key: 'KeyB', tip: 'Army ants only: while the colony is wandering (nomadic phase, hungry larvae), click a spot and the next move goes there, carrying brood and queen. The column is exposed on the way. If you don\'t choose, the colony follows its raid trail.',
  paint(phase, x, y) {
    if (phase !== 'start') return;
    const w = G.world, c = w.player;
    if (!c.sp.nomad || !AL.Bivouac) return;
    AL.Cmd.issue('march', { x, y }, r => {
      if (!r || !r.ok) { if (r && r.why) AL.UI.toast(r.why); return; }
      AL.UI.toast('The bivouac packs up: ' + r.march.column + ' ants march, about ' + Math.round(r.march.dur) + ' s to the new site.', 'good');
    });
    AL.Tools.select(null);
  } };
TOOLS.swarm = { id: 'swarm', layer: 'surface', name: 'Swarm raid', key: 'KeyZ', tip: 'Army ants only: click where the next swarm raid should sweep. A broad front of raiders rolls out that way, catching everything in the leaf litter and eating the brood of any nest it overruns. Raided ground needs a few minutes to recover.',
  paint(phase, x, y) {
    if (phase !== 'start') return;
    const w = G.world, c = w.player;
    if (!c.sp.nomad || !AL.Swarm) return;
    AL.Cmd.issue('swarmAim', { x, y }, r => {
      if (!r) return;
      if (!r.ok) { if (r.why) AL.UI.toast(r.why); return; }
      AL.UI.toast(r.later ? r.why : 'The swarm pours out: ' + r.n + ' raiders sweep that way.', r.later ? undefined : 'good');
    });
    AL.Tools.select(null);
  } };
// Bridge: press on one bank, drag across the stream, let go on the far bank. Workers (one per few units of water) walk
// out and lock together into a living bridge (bridges.js). The line being dragged is UI only (drawn by bridges.js).
let bdrag = null;
TOOLS.bridge = { id: 'bridge', layer: 'surface', name: 'Bridge', key: 'Digit4', tip: 'Press on one bank and drag across the water to the other. Workers leave the nest and lock their legs together into a living bridge your ants can cross at full speed (the wider the water, the more workers it takes). They stay on it until enemies kill them, and never fight back. Without a bridge ants swim, at a third of their speed. Drag over a damaged bridge to patch it.',
  paint(phase, x, y) {
    const w = G.world; if (!w) return;
    if (phase === 'start') { bdrag = { x0: x, y0: y, x1: x, y1: y }; stroke = { id: 'bridge' }; return; }
    if (!bdrag) return;
    if (phase === 'move') { bdrag.x1 = x; bdrag.y1 = y; return; }
    const d = bdrag; bdrag = null; stroke = null;
    if (phase !== 'end') return;   // (Esc: no bridge)
    d.x1 = x; d.y1 = y;
    const toast = (m, k) => { if (AL.UI && AL.UI.toast) AL.UI.toast(m, k); };
    if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 12) { toast('Press on one bank and drag across the water to the far bank.'); return; }
    const r1 = v => Math.round(v * 10) / 10;
    AL.Cmd.issue('bridge', { x0: r1(d.x0), y0: r1(d.y0), x1: r1(d.x1), y1: r1(d.y1) }, r => {
      if (!r) return;
      if (!r.ok) { if (r.why) toast(r.why); return; }
      toast(r.patch ? r.need + (r.need === 1 ? ' worker heads' : ' workers head') + ' out to patch the bridge.' : r.need + ' workers head out to lock together across the water.', 'good');
    });
  } };
brush('avoid', { name: 'Avoid', key: 'KeyV', tip: 'Mark danger. Your ants steer around it.' });
brush('erase', { name: 'Erase', key: 'KeyE', tip: 'Wipe your trails under the brush.' });

// ---- nest tools: work on tiles of the side view (of your own nest) ----
function tileBrush(id, opts) {
  TOOLS[id] = Object.assign({ id, layer: 'nest', get tiles() { return (AL.Brush && AL.Brush.B[id] && AL.Brush.B[id].tiles) || 0; },
    paint(phase, x, y) { const w = G.world, nc = G.renderer && G.renderer.nestCol; if (w && w.nest && !(nc && nc.id !== (w.me || 0))) issuePaint(this.id, phase, x, y); } }, opts);   // (not while looking into a rival's nest)
}
tileBrush('dig', { name: 'Dig', key: 'KeyG', color: 'rgba(255,180,80,0.95)', tip: 'Paint soil to dig. Workers excavate tile by tile and carry the soil up to the mound. Rocks and roots can\'t be dug.' });
tileBrush('chamber', { name: 'Chamber', key: 'KeyC', tip: 'Paint a room type on dug tunnels (or on soil to dig it out as that room). Capacity grows with area.',
  colorOf() { const i = AL.Nest.CH_INFO[AL.Tools.chamberType]; return i ? i.col : '#fff'; } });
tileBrush('fill', { name: 'Undo', key: 'KeyX', color: 'rgba(200,200,200,0.8)', tip: 'Remove dig marks and room designations.' });

AL.Tools = {
  chamberType: 2, collectN: 10,
  collectCircle: () => circle, foodsIn, bridgeDrag: () => bdrag,
  TOOLS, brush,
  init(game) { G = game; },
  get current() { return cur; },
  select(id) {
    cur = id && TOOLS[id] ? TOOLS[id] : null;
    AL.Input.tool = cur;
    document.getElementById('cv').style.cursor = cur ? 'crosshair' : 'grab';
    if (AL.UI && AL.UI.onTool) AL.UI.onTool(cur);
  },
  stroke: () => stroke,
  // deterministic brush work for one colony (the 'paint' command, cmd.js)
};
})(window);

// Esc while drawing cancels the stroke (no order is placed)
window.addEventListener('keydown', e => {
  if (e.code !== 'Escape' || !AL.Tools.stroke()) return;
  const t = AL.Tools.current; if (t) t.paint('cancel', 0, 0, e);
  e.stopImmediatePropagation();
}, true);
