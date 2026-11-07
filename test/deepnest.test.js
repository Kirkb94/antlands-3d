// Late-game nest research: aphid farming (aphids.js, the root-aphid chamber) and nest tunnels (links.js).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'brush', 'cmd', 'raids', 'aphids', 'links']) require('../public/' + f + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, K = AL.CARRY, CH = AL.Nest.CH;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const mk = o => AL.Sim.createWorld(Object.assign({ seed: 9, species: 'fire', colonies: 2, keypointsAt: 1e9, noFog: true }, o || {}));
// a root-aphid room dug out next to the food store
function aphidRoom(c) {
  const nest = c.nest, e = nest.entrance;
  AL.Nest.carveRoom(nest, e.c + 10, 14, 3, 1.5, CH.APHID);
  AL.Nest.rebuild(nest); AL.Life.updateCaps(c);
  return nest.caps.aphid;
}

test('aphid farming: the chamber needs the research; aphids carried home join the herd, breed and make sugar', () => {
  const w = mk(), c = w.player, A = w.ants;
  run(w, 2);
  // without the research the chamber can't be painted
  const nest = c.nest, e = nest.entrance, i0 = AL.Nest.idx(nest, e.c, e.r + 2);
  assert.equal(AL.Brush.B.chamber.apply(nest, e.c, e.r + 2, { ch: CH.APHID }), false, 'no aphid chamber before the research');
  AL.Research.grant(w, 0, 'aphidfarm');
  assert.ok(c.mods.rootAphids);
  const cap = aphidRoom(c);
  assert.ok(cap >= 9, 'room for aphids: ' + cap);
  // a forager at a wild aphid plant's honeydew brings a live aphid home now and then
  const p = w.surface.pois.find(q => q.type === 'aphids' && !q.gone); assert.ok(p, 'an aphid plant');
  const a0 = p.aphids;
  let caught = 0;
  for (let k = 0; k < 40 && !caught; k++) {
    const i = A.spawn(0, C.FORAGER, L.SURFACE, p.x, p.y, 0, w.R); A.home[i] = c.hid;
    if (AL.Aphids.catchAphid(w, i, p.src)) { caught++; assert.equal(A.carry[i], K.APHID); assert.equal(A.state[i], ST.RETURN); }
    w.tick++;
  }
  assert.ok(caught && p.aphids === a0 - 1, 'an aphid taken from the plant');
  // home: into the chamber
  AL.Sim.addStock(c, K.APHID, 1); AL.Sim.addStock(c, K.APHID, 1);
  assert.equal(c.aphids, 2);
  for (let k = 0; k < 100; k++) AL.Sim.addStock(c, K.APHID, 1);
  assert.equal(c.aphids, cap, 'a full chamber takes no more');
  // they make sugar and breed
  c.aphids = 6; c.stock.sugar = 100;
  const s0 = c.stock.sugar, h0 = c.aphids;
  run(w, 30);
  assert.ok(c.aphids > h0, 'the herd grew: ' + h0 + ' -> ' + c.aphids.toFixed(1));
  assert.ok(c._honeydew > 0.1, 'honeydew a second: ' + c._honeydew);
});

const X = AL.Expansion; X.CFG.aiAuto = false;
function satFor(w, x, y) { const c = w.player; c.royal.queens++; X.launch(w, 0, x, y); run(w, 14); run(w, X.CFG.sat.foundT + 1); const s = c.satellites[c.satellites.length - 1]; return w.homes[s.home]; }

test('nest tunnels: dug between two of your nests; ants sent across go underground; haulers even out the stores', () => {
  const w = mk(), c = w.player, A = w.ants;
  const h = satFor(w, c.x + 600, c.y - 300);
  assert.ok(h && h.nest);
  assert.equal(AL.Cmd.exec(w, 0, 'link', { a: c.hid, b: h.hid }).ok, false, 'needs the research');
  AL.Research.grant(w, 0, 'nestlink');
  c.stock.sugar = 200; c.stock.protein = 120;
  assert.equal(AL.Cmd.exec(w, 0, 'link', { a: c.hid, b: c.hid }).ok, false, 'not a nest to itself');
  const r = AL.Cmd.exec(w, 0, 'link', { a: c.hid, b: h.hid });
  assert.ok(r.ok, r.why); assert.ok(r.crew >= 4, 'a crew went down: ' + r.crew);
  assert.equal(AL.Cmd.exec(w, 0, 'link', { a: h.hid, b: c.hid }).ok, false, 'only one tunnel between them');
  const l = w.links[0];
  let opened = false; const off = AL.on('linkOpen', ww => { if (ww === w) opened = true; });
  for (let s = 0; s < 200 && !opened; s++) run(w, 1);
  off();
  assert.ok(opened && l.state === 'open', 'the tunnel opened: ' + l.prog.toFixed(2));
  // Send soldiers from the capital: the ones inside go through the tunnel and live at the satellite
  for (let k = 0; k < 6; k++) { const [x, y] = AL.Nest.centre(c.nest, c.nest.entrance.r * c.nest.cols + c.nest.entrance.c); const i = A.spawn(0, C.SOLDIER, L.NEST, x, y + 20, 0, w.R); A.nest[i] = c.hid; A.home[i] = c.hid; AL.Life.decide(w, i); }
  run(w, 1);
  const s0 = AL.Raids.counts(w, h).s;
  const res = AL.Cmd.exec(w, 0, 'send', { x: h.x, y: h.y, w: 0, s: 6, m: 0 });
  assert.ok(res.ok, res.why);
  let transit = 0; for (let i = 0; i < A.high; i++) if (A.state[i] === ST.N_TRANSIT && A.col[i] === 0) transit++;
  assert.ok(transit > 0, 'underground: ' + transit);
  run(w, 2 + l.len / AL.Links.LK.WALK);
  assert.ok(AL.Raids.counts(w, h).s >= s0 + transit, 'they live at the satellite now');
  // haulers: a full capital and an empty satellite
  c.stock.sugar = Math.min(c.cap.food, 250); h.stock.sugar = 0;
  let hauled = 0; const off2 = AL.on('linkHaul', (ww, d) => { if (ww === w && d.to === h.hid) hauled += d.amt; });
  run(w, 60);
  off2();
  assert.ok(hauled >= 10, 'sugar carried across: ' + hauled);
});
