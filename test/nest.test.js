const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js'); require('../public/life.js');
const N = AL.Nest, CH = N.CH, TILE = N.TILE, C = AL.CASTE;
const run = (w, secs) => { for (let k = 0; k < secs * 30; k++) AL.Sim.step(w); };
const newWorld = (o) => AL.Sim.createWorld(Object.assign({ seed: 11 }, o || {}));

test('a new colony starts with a queen, ~40 workers, brood and a starter nest', () => {
  const w = newWorld(), c = w.player;
  assert.ok(w.nest && c.queen.alive);
  assert.equal(w.ants.caste[c.queen.i], C.QUEEN);
  let mine = 0; for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.col[i] === 0) mine++;
  assert.equal(mine, 41);
  assert.ok(c.brood.length >= 10);
  for (const ch of [CH.QUEEN, CH.NURSERY, CH.FOOD]) assert.ok(w.nest.tiles[ch].length > 3, 'has chamber ' + ch);
});
test('rocks and roots cannot be dug; soil can', () => {
  const w = newWorld(), n = w.nest;
  let rock = -1, soil = -1;
  for (let i = 0; i < n.n; i++) { if (rock < 0 && n.kind[i] === TILE.ROCK) rock = i; if (soil < 0 && n.kind[i] === TILE.CLAY) soil = i; }
  assert.equal(N.mark(n, rock % n.cols, (rock / n.cols) | 0), false);
  assert.equal(N.mark(n, soil % n.cols, (soil / n.cols) | 0), true);
});
test('flow fields lead from the entrance to the queen', () => {
  const w = newWorld(), n = w.nest, f = n.fields[N.F.QUEEN];
  let i = n.entrance.r * n.cols + n.entrance.c, steps = 0;
  assert.ok(f[i] < N.FAR);
  while (f[i] > 0 && steps < 500) { i = N.nextTile(n, N.F.QUEEN, i, w.R); steps++; }
  assert.equal(n.chamber[i], CH.QUEEN);
});
test('workers dig marked tiles and the soil grows the mound', () => {
  const w = newWorld(), n = w.nest, c = w.player;
  // mark a short tunnel off the nursery
  const nt = n.tiles[CH.NURSERY], last = nt[nt.length - 1], c0 = last % n.cols, r0 = (last / n.cols) | 0;
  let marked = 0; for (let k = 1; k <= 4; k++) if (N.mark(n, c0 + k, r0)) marked++;
  const soil0 = c.moundSoil, open0 = n.kind.filter(k => k === TILE.OPEN).length;
  run(w, 150);
  const open1 = n.kind.filter(k => k === TILE.OPEN).length;
  assert.ok(open1 >= open0 + marked, 'tiles dug (' + (open1 - open0) + ')');
  assert.ok(c.moundSoil > soil0, 'mound grew ' + soil0 + ' -> ' + c.moundSoil);
});
test('chamber capacity comes from its area', () => {
  const w = newWorld(), n = w.nest;
  const before = n.caps.food;
  const ft = n.tiles[CH.FOOD], i0 = ft[0], c0 = i0 % n.cols, r0 = (i0 / n.cols) | 0;
  for (let k = 1; k <= 3; k++) { N.carve(n, c0 - k, r0, c0 - k, r0); N.designate(n, c0 - k, r0, CH.FOOD); }
  N.rebuild(n);
  // each tile holds STORE_PER_TILE, a bit more in a room that has grown a level (nestclimate.js)
  assert.ok(Math.abs(n.caps.food - AL.NestClimate.capMul(n, CH.FOOD) * AL.TUNE.STORE_PER_TILE) < 1e-9);
  assert.ok(n.caps.food >= before + 3 * AL.TUNE.STORE_PER_TILE, before + ' -> ' + n.caps.food);
});
test('brood develops egg -> larva -> pupa -> adult, and larvae need protein', () => {
  const w = newWorld(), c = w.player;
  c.brood.length = 0; c.auto = false;
  c.brood.push({ caste: C.SOLDIER, stage: 0, t: 0, starve: 0, slot: -1 });
  AL.Life.placeBrood(c);
  c.stock.sugar = 500;
  for (let k = 0; k < 60 * 30; k++) { c.stock.protein = 0; c.broodFood.protein = 0; AL.Sim.step(w); }   // no protein at all (in store or carried to the nursery; nurses need a while to bring it once there is some)
  const b = c.brood[0];
  assert.ok(b && b.stage === 1, 'stuck as a larva without protein');
  c.stock.protein = 50;
  const born0 = c.stats.born;
  run(w, 200);
  assert.ok(c.stats.born > born0, 'emerged once fed');
  let soldiers = 0; for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.col[i] === 0 && w.ants.caste[i] === C.SOLDIER) soldiers++;
  assert.ok(soldiers >= 1);
});
test('the egg queue decides what the queen lays', () => {
  const w = newWorld(), c = w.player;
  c.brood.length = 0; c.eggQueue = [C.MAJOR, C.SCOUT]; c.stock.sugar = 300;
  run(w, 12);
  const castes = c.brood.filter(b => b.stage === 0).map(b => b.caste);
  assert.deepEqual(castes.slice(0, 2), [C.MAJOR, C.SCOUT]);
});
test('ants age and die; bodies in the nest raise disease until carried out', () => {
  const w = newWorld(), c = w.player, A = w.ants;
  let victim = -1; for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === AL.LAYER.NEST && A.caste[i] === C.WORKER) { victim = i; break; }
  A.age[victim] = A.life[victim] + 1;
  run(w, 1.1);
  assert.equal(A.state[victim] === 0 || A.uid[victim] === 0 || A.caste[victim] !== C.WORKER || A.age[victim] < 5, true);
  assert.ok(w.nest.corpses.length >= 1 || c.stats.died >= 1);
  // pile up bodies with nobody around to clear them
  for (let k = 0; k < 20; k++) w.nest.corpses.push({ i: w.nest.tiles[CH.QUEEN][0], x: 0, y: 0, a: 0, col: 0, t: w.t });
  const d0 = c.disease; run(w, 3);
  assert.ok(c.disease > d0, 'disease rises');
});
test('food spoils: protein slowly, overflow quickly; honeypot sugar keeps', () => {
  const w = newWorld(), c = w.player;
  for (const f of w.surface.foods) f.amount = 0;
  c.brood.length = 0; c.auto = false;
  c.stock.protein = 100; c.stock.sugar = 0;
  run(w, 60);
  assert.ok(c.stock.protein < 99, 'protein went off');
  c.stock.sugar = c.cap.food * 3; const s0 = c.stock.sugar; run(w, 5);
  assert.ok(c.stock.sugar < s0 * 0.95, 'overflow spoils');
});
test('rain floods the lowest tunnels', () => {
  const w = newWorld(), n = w.nest;
  w.env.rain = 1; run(w, 20);
  assert.ok(n.water.some((v, i) => v > 0.5 && n.kind[i] === TILE.OPEN));
  w.env.rain = 0; run(w, 200);
  assert.ok(n.flood < 1, 'flood drains after the rain');
});
