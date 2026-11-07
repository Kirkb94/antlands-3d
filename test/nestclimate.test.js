// Nest climate and rooms (nestclimate.js): room levels, temperature layers, nurses moving brood, the pupa dryer and
// spit-lined walls.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'combat', 'orders', 'nestplan', 'nestclimate']) require('../public/' + f + '.js');
const N = AL.Nest, CH = N.CH, F = N.F, TILE = N.TILE, C = AL.CASTE, NCl = AL.NestClimate, NC = NCl.NC;
const run = (w, secs, each) => { for (let k = 0; k < secs * 30; k++) { AL.Sim.step(w); if (each && k % 30 === 0) each(); } };
const mk = (seed) => { const w = AL.Sim.createWorld({ seed: seed || 21, colonies: 1, noFog: true, keypointsAt: 1e9 }); w.player.stock.sugar = 300; w.player.stock.protein = 200; return w; };
const roomsOf = (nest, ch) => NCl.ensureRooms(nest).filter(r => r.ch === ch);
// a second nursery deep down, joined to the queen's chamber by a shaft
function deepNursery(c, ch) {
  const n = c.nest, e = n.entrance.c;
  N.carve(n, e + 1, 17, e + 1, 44);
  N.carveRoom(n, e + 1, 46, 3.2, 1.5, ch || CH.NURSERY);
  N.rebuild(n); n.version++; n.layoutVersion++;
  AL.Life.updateCaps(c);
  return roomsOf(n, ch || CH.NURSERY).find(r => r.row > 40);
}

test('rooms: each patch of a chamber type is a room; rooms level up as they grow and hold more', () => {
  const w = mk(), c = w.player, n = c.nest;
  const nur = roomsOf(n, CH.NURSERY), q = roomsOf(n, CH.QUEEN);
  assert.equal(nur.length, 1); assert.equal(q.length, 1);
  assert.equal(nur[0].level, 1, 'the starter nursery is level 1 (' + nur[0].tiles.length + ' tiles)');
  assert.equal(NCl.levelOf(NC.LEVELS[0]), 2); assert.equal(NCl.levelOf(NC.LEVELS[2]), 4); assert.equal(NCl.levelOf(5), 1);
  // grow the food store past the first level
  const cap0 = n.caps.food, ft = n.tiles[CH.FOOD], c0 = ft[0] % n.cols, r0 = (ft[0] / n.cols) | 0;
  for (let r = r0; r < r0 + 4; r++) for (let k = 1; k <= 9; k++) { N.carve(n, c0 - k, r, c0 - k, r); N.designate(n, c0 - k, r, CH.FOOD); }
  N.rebuild(n);
  const store = roomsOf(n, CH.FOOD)[0];
  assert.ok(store.tiles.length >= NC.LEVELS[0] && store.level >= 2, 'store ' + store.tiles.length + ' tiles, level ' + store.level);
  assert.ok(Math.abs(n.caps.food - store.tiles.length * (1 + NC.CAP * (store.level - 1)) * AL.TUNE.STORE_PER_TILE) < 1e-6);
  assert.ok(n.caps.food > cap0);
  // the store's level means less spoilage (folded into the nest's layout: nestplan.js)
  n.layoutVersion++;
  const L = AL.NestPlan.layout(n);
  assert.ok(L.spoil < 1 && Math.abs(NCl.layoutMul(n).spoil - (1 - NC.SPOIL * (store.level - 1))) < 1e-9);
  assert.equal(L.lay, 1, 'the starter queen chamber lays at the normal rate');
});

test('temperature layers: shallow rooms warm by day and cool at night, deep rooms stay steady', () => {
  const w = mk(), c = w.player, n = c.nest;
  const deep = deepNursery(c), shallow = roomsOf(n, CH.NURSERY).find(r => r.row < 20);
  assert.ok(deep && shallow);
  const at = (temp, light) => { w.env.temp = temp; w.env.light = light; N.second(n, w); return [shallow.temp, deep.temp]; };
  const [sd, dd] = at(26, 1), [sn, dn] = at(12, 0);
  assert.ok(sd - sn > 6, 'shallow swings: ' + sd.toFixed(1) + ' by day, ' + sn.toFixed(1) + ' at night');
  assert.ok(Math.abs(dd - dn) < 5, 'deep stays steady: ' + dd.toFixed(1) + ' / ' + dn.toFixed(1));
  // the best room for eggs flips between day and night
  const egg = { stage: 0 };
  at(24, 1); const dayBest = NCl.target(c, egg);
  at(8, 0); const nightBest = NCl.target(c, egg);
  assert.equal(dayBest, shallow.id, 'by day the shallow nursery');
  assert.equal(nightBest, deep.id, 'on a cold night the deep one');
});

test('the nurses carry brood to the better nursery, and it grows faster there', () => {
  const w = mk(), c = w.player, n = c.nest, A = w.ants;
  const deep = deepNursery(c), shallow = roomsOf(n, CH.NURSERY).find(r => r.row < 20);
  let moved = 0; const off = AL.on('broodMoved', (ww, d) => { if (ww === w && d.col === 0) moved++; });
  // a cold night: the deep nursery is the warm one
  const night = () => { w.env.temp = 6; w.env.light = 0; w.env.night = 1; };
  night(); run(w, 1, night);
  const inDeep = () => c.brood.filter(b => b.room === deep.id).length;
  const d0 = inDeep(), total = c.brood.length;
  assert.ok(total > 5 && d0 < total, 'most brood starts in the shallow nursery (' + d0 + ' of ' + total + ' deep)');
  let carried = 0;
  run(w, 120, () => { night(); for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.carry[i] === AL.CARRY.BROOD) carried++; });
  off();
  assert.ok(moved >= 2, 'nurses moved brood: ' + moved);   // (brood changing stage is laid straight in the best room)
  assert.ok(carried > 0, 'carried in their jaws on the way');
  assert.ok(inDeep() > d0 + 4, 'brood in the deep nursery: ' + d0 + ' -> ' + inDeep() + ' of ' + c.brood.length);
  // brood in the warm room grows faster than brood left in the cold one
  const bd = c.brood.find(b => b.room === deep.id && b.stage === 0), bs = { stage: 0, room: shallow.id };
  if (bd) assert.ok(NCl.broodMul(c, bd) > NCl.broodMul(c, bs), 'warm room grows faster');
});

test('the pupa dryer: nurses take pupae there and they hatch faster; eggs and larvae stay in the nursery', () => {
  const w = mk(), c = w.player, n = c.nest;
  // a dryer just under the surface, off the entrance shaft
  const e = n.entrance.c;
  N.carve(n, e + 1, 4, e + 4, 4); N.carveRoom(n, e + 7, 4, 2.5, 1.2, CH.DRYER);
  N.rebuild(n); n.version++; n.layoutVersion++; AL.Life.updateCaps(c);
  const dryer = roomsOf(n, CH.DRYER)[0];
  assert.ok(dryer && dryer.row <= NC.DRYER_ROWS, 'a shallow dryer');
  assert.ok(n.caps.dryer > 0 && n.caps.nursery >= n.caps.dryer, 'dryer tiles count as brood room');
  for (let k = 0; k < 4; k++) c.brood.push({ caste: C.WORKER, stage: 2, t: 0, starve: 0, slot: -1 });
  AL.Life.placeBrood(c);
  N.second(n, w);
  const pupa = { stage: 2 }, egg = { stage: 0 };
  assert.equal(NCl.target(c, pupa), dryer.id, 'pupae belong in the dryer');
  assert.notEqual(NCl.target(c, egg), dryer.id, 'eggs never go to the dryer');
  run(w, 15);
  const inDryer = c.brood.filter(b => b.room === dryer.id);
  assert.ok(inDryer.length >= 2, 'pupae in the dryer: ' + inDryer.length);
  assert.ok(inDryer.every(b => b.stage === 2), 'only pupae');
  const bp = inDryer[0], nurseryRoom = roomsOf(n, CH.NURSERY)[0];
  assert.ok(NCl.score(c, dryer, bp) > NCl.score(c, nurseryRoom, bp) * 1.15, 'pupae do better in the dryer');
});

test('lined walls: idle workers line the nest for a little sugar; lined tunnels never cave in and never fill deep with water', () => {
  const w = mk(), c = w.player, n = c.nest;
  NCl.lineField(n);
  const left0 = n.lineLeft, sugar0 = c.stock.sugar;
  assert.ok(left0 > 50, 'a fresh nest is unlined: ' + left0);
  run(w, 240, () => { c.stock.sugar = Math.max(c.stock.sugar, 100); });
  let lined = 0; for (let i = 0; i < n.n; i++) if (n.lined[i] && n.kind[i] === TILE.OPEN) lined++;
  assert.ok(lined >= 15, 'workers lined ' + lined + ' tiles in 4 minutes');
  assert.ok(sugar0 > 0);
  // a lined tile never caves in: dig next to lined tunnels in loose gravel many times
  const st = c.siteTraits || (c.siteTraits = {}); st.caveIn = 0.5;
  for (let i = 0; i < n.n; i++) if (n.kind[i] === TILE.OPEN) n.lined[i] = 1;
  let caved = 0; const off = AL.on('caveIn', (ww) => { if (ww === w) caved++; });
  const e = n.entrance.c;
  for (let r = 20; r < 40; r++) { const i = N.idx(n, e - 20, r); n.kind[i] = TILE.GRAVEL; n.base[i] = TILE.GRAVEL; N.excavate(n, i, w); n.lined[i] = 1; }
  off();
  assert.equal(caved, 0, 'nothing caved in');
  // water: a lined tile holds at most LINED_WATER (ants wade, they don't drown)
  w.env.rain = 1; n.flood = 400;
  N.second(n, w);
  let deepest = 0; for (let i = 0; i < n.n; i++) if (n.lined[i] && n.kind[i] === TILE.OPEN && ((i / n.cols) | 0) < n.waterTable) deepest = Math.max(deepest, n.water[i]);
  assert.ok(deepest <= N.LINED_WATER + 1e-9 && deepest > 0, 'deepest water in a lined tunnel: ' + deepest);
});

test('a bigger queen chamber lays faster', () => {
  const w = mk(), c = w.player, n = c.nest;
  const qr = roomsOf(n, CH.QUEEN)[0], need = NC.LEVELS[0] - qr.tiles.length;
  const qt = n.tiles[CH.QUEEN], c0 = qt[0] % n.cols, r0 = (qt[0] / n.cols) | 0;
  let added = 0;
  for (let r = r0; r < r0 + 4 && added < need + 4; r++) for (let k = 1; k <= 8 && added < need + 4; k++) { if (N.designate(n, c0 - k, r, CH.QUEEN) || n.chamber[N.idx(n, c0 - k, r)] === CH.QUEEN) { N.carve(n, c0 - k, r, c0 - k, r); added++; } }
  N.rebuild(n); n.layoutVersion++;
  const q2 = roomsOf(n, CH.QUEEN).sort((a, b) => b.tiles.length - a.tiles.length)[0];
  assert.ok(q2.level >= 2, 'queen chamber level ' + q2.level + ' (' + q2.tiles.length + ' tiles)');
  assert.ok(NCl.layoutMul(n).lay > 1);
  assert.ok(Math.abs(AL.NestPlan.layout(n).lay - (1 + NC.LAY * (q2.level - 1))) < 1e-9);
});
