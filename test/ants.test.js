const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
const { AntStore, SpatialHash } = require('../public/ants.js');
const ST = AL.ST, K = AL.CARRY;

test('ant store reuses freed slots and tracks the live count', () => {
  const s = new AntStore(8);
  const a = s.spawn(0, AL.CASTE.WORKER, 0, 10, 10, 0), b = s.spawn(0, AL.CASTE.SOLDIER, 0, 20, 20, 0);
  assert.equal(s.count, 2); assert.equal(s.hp[b], AL.CASTES[AL.CASTE.SOLDIER].hp);
  s.tgt[a] = b; s.tuid[a] = s.uid[b];
  assert.ok(s.targetValid(a));
  s.kill(b);
  assert.equal(s.count, 1); assert.ok(!s.targetValid(a), 'target dead');
  const c = s.spawn(1, AL.CASTE.WORKER, 0, 0, 0, 0);
  assert.equal(c, b, 'slot reused');
  assert.ok(!s.targetValid(a), 'a reused slot is not the old target');
});
test('spatial hash counts enemies near a cell', () => {
  const h = new SpatialHash(200, 200, 20, 16, 2);
  h.clear(); h.insert(0, 50, 50, 0); h.insert(1, 65, 52, 1); h.insert(2, 180, 180, 1);
  assert.equal(h.enemiesNear(h.cellOf(50, 50), 0), 1);
  const seen = []; h.each(50, 50, j => { seen.push(j); });
  assert.deepEqual(seen.sort(), [0, 1]);
});

function worldWithFood() {
  // tiny controlled world: one sugar pile 200 units east of the nest
  const w = AL.Sim.createWorld({ seed: 3 });
  const S = w.surface, c = w.player;
  S.foods.length = 0; S.byId.clear();
  AL.Surface.addFood(S, { kind: K.SUGAR, x: c.x + 200, y: c.y, r: 10, amount: 500 });
  AL.Surface.rebuildFoodGrid(S);
  return w;
}
test('forager state machine: wander -> smell food -> pick up -> return laying trail -> deliver', () => {
  const w = worldWithFood(), A = w.ants, c = w.player;
  const i = A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 160, c.y, 0, w.R);   // facing the food
  assert.equal(A.state[i], ST.WANDER);
  let picked = false, delivered = false, sugar0 = c.stock.sugar;
  for (let k = 0; k < 30 * 40 && !delivered; k++) {
    AL.Sim.step(w);
    if (!picked && A.state[i] === ST.RETURN) { picked = true; assert.equal(A.carry[i], K.SUGAR); }
    if (picked && c.stock.sugar > sugar0) delivered = true;
  }
  assert.ok(picked, 'found and picked up a crumb');
  assert.ok(delivered, 'carried it home');
  assert.ok(w.pher.food[0].total() > 0, 'laid a food trail on the way back');
  // the trail runs the whole way between the food and the nest
  const g = w.pher.food[0];
  for (const x of [40, 100, 160]) {
    let s = 0; for (let dy = -16; dy <= 16; dy += 8) s += g.sample(c.x + x, c.y + dy);
    assert.ok(s > 0.1, 'trail present ' + x + ' units out');
  }
});
test('a food trail pulls foragers along it', () => {
  const w = worldWithFood(), A = w.ants, c = w.player, g = w.pher.food[0];
  // paint a trail from the nest to the food, then release foragers that start on it facing outward
  for (let x = c.x + 20; x <= c.x + 200; x += 6) g.depositDisc(x, c.y, 10, 1.5);
  const ids = [];
  for (let k = 0; k < 20; k++) ids.push(A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 30, c.y + (k % 5) - 2, (w.R() - 0.5) * 0.6, w.R));
  let maxReturn = 0;
  for (let k = 0; k < 30 * 12; k++) { AL.Sim.step(w); maxReturn = Math.max(maxReturn, ids.filter(i => A.state[i] === ST.RETURN || A.carry[i]).length); }
  assert.ok(maxReturn >= 10, 'most foragers on the trail reached the food (' + maxReturn + '/20)');
});
test('avoid trail turns ants away', () => {
  const w = worldWithFood(), A = w.ants, c = w.player;
  const x0 = c.x + 60;
  for (let y = c.y - 80; y <= c.y + 80; y += 8) w.pher.avoid.depositDisc(x0 + 40, y, 14, 4);
  const ids = [];
  for (let k = 0; k < 20; k++) ids.push(A.spawn(0, AL.CASTE.FORAGER, 0, x0, c.y + (k - 10) * 3, 0, w.R));
  let crossed = 0;
  for (let k = 0; k < 30 * 4; k++) AL.Sim.step(w);
  for (const i of ids) if (A.x[i] > x0 + 60) crossed++;
  assert.ok(crossed <= 3, 'few crossed the avoid line (' + crossed + ')');
});
test('big prey needs enough carriers before it moves', () => {
  const w = AL.Sim.createWorld({ seed: 9 }), A = w.ants, S = w.surface, c = w.player;
  S.foods.length = 0; S.byId.clear();
  const f = AL.Surface.addFood(S, { kind: K.PROTEIN, x: c.x + 150, y: c.y, r: 16, amount: 40, big: true, needed: 5 });
  AL.Surface.rebuildFoodGrid(S);
  const x0 = f.x;
  for (let k = 0; k < 3; k++) { const i = A.spawn(0, AL.CASTE.WORKER, 0, f.x - 18, f.y + k, 0, w.R); AL.Behavior.pickup(w, i, f); }
  for (let k = 0; k < 30; k++) AL.Sim.step(w);
  assert.equal(f.x, x0, 'three ants cannot move it');
  for (let k = 0; k < 4; k++) { const i = A.spawn(0, AL.CASTE.WORKER, 0, f.x - 18, f.y + k, 0, w.R); AL.Behavior.pickup(w, i, f); }
  for (let k = 0; k < 30; k++) AL.Sim.step(w);
  assert.ok(f.x < x0 - 3, 'seven ants drag it toward the nest');
});

// ---- trails agent: no circling on trails, no milling at the door, dead ends shrink ----
function bareWorld(seed) {
  const w = AL.Sim.createWorld({ seed: seed || 3, start: { workers: 0 } });
  const S = w.surface; S.foods.length = 0; S.byId.clear(); S.blocked.fill(0); AL.Surface.rebuildFoodGrid(S);
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i]) w.ants.kill(i);
  return w;
}
// signed heading change of an ant over n ticks (about-turns of ~180 deg are counted apart)
function watch(w, ids, n) {
  const A = w.ants, turn = new Map(ids.map(i => [i, 0])), last = new Map(ids.map(i => [i, A.a[i]])), start = new Map(ids.map(i => [i, [A.x[i], A.y[i]]]));
  for (let k = 0; k < n; k++) { AL.Sim.step(w); for (const i of ids) { let d = A.a[i] - last.get(i); d = Math.atan2(Math.sin(d), Math.cos(d)); last.set(i, A.a[i]); if (Math.abs(d) < 2) turn.set(i, turn.get(i) + d); } }
  return ids.map(i => ({ i, turn: turn.get(i), net: Math.hypot(A.x[i] - start.get(i)[0], A.y[i] - start.get(i)[1]) }));
}
test('foragers run a saturated ant highway in a line, without spinning loops', () => {
  const w = bareWorld(), A = w.ants, c = w.player, g = w.pher.food[0];
  // a busy highway at the grid max, 2 cells wide, heading east from the mound
  for (let x = c.x + 40; x < c.x + 900; x += 4) { g.depositLin(x, c.y, 12); g.depositLin(x, c.y + 6, 12); }
  const ids = []; for (let k = 0; k < 20; k++) ids.push(A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 80 + k * 12, c.y + (k % 3) * 4 - 4, (w.R() - 0.5) * 0.8, w.R));
  const r = watch(w, ids, 30 * 10);
  const loops = r.filter(o => Math.abs(o.turn) > AL.TAU).length, out = r.filter(o => A.x[o.i] > c.x + 400).length;
  assert.equal(loops, 0, 'no full circles on the highway');
  assert.ok(out >= 16, 'they ran out along it (' + out + '/20)');
});
test('ants leaving the mound pick up the trail out instead of milling at the door', () => {
  const w = bareWorld(5), A = w.ants, c = w.player, g = w.pher.food[0];
  const ang = 2.2, ux = Math.cos(ang), uy = Math.sin(ang);
  for (let d = c.moundR * 0.8; d < 700; d += 4) g.depositLin(c.x + ux * d, c.y + uy * d, 4);
  const ids = []; for (let k = 0; k < 30; k++) { const a = w.R() * AL.TAU; ids.push(A.spawn(0, AL.CASTE.FORAGER, 0, c.x + Math.cos(a) * 4, c.y + Math.sin(a) * 4, a, w.R)); }
  for (let k = 0; k < 30 * 8; k++) AL.Sim.step(w);
  let along = 0, door = 0;
  for (const i of ids) { const dx = A.x[i] - c.x, dy = A.y[i] - c.y; if (dx * ux + dy * uy > 200 && Math.abs(-dx * uy + dy * ux) < 40) along++; if (Math.hypot(dx, dy) < c.moundR + 30) door++; }
  assert.ok(along >= 20, 'most took the trail out (' + along + '/30)');
  assert.ok(door <= 2, 'nobody is left circling the door (' + door + ')');
});
test('a trail to food that is gone: followers search the end, give up and wear the dead end away', () => {
  const w = bareWorld(7), A = w.ants, c = w.player, g = w.pher.food[0];
  for (let x = c.x + 40; x < c.x + 500; x += 4) g.depositLin(x, c.y, 3);
  const end0 = g.sampleLin(c.x + 470, c.y);
  const ids = []; for (let k = 0; k < 20; k++) ids.push(A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 60 + k * 8, c.y, 0, w.R));
  const r = watch(w, ids, 30 * 40);
  // ping-pong check: nobody should still be shuttling up and down the trail (on it, heading along it, near the end)
  let onEnd = 0; for (const i of ids) if (A.state[i] === ST.WANDER && Math.abs(A.y[i] - c.y) < 20 && A.x[i] > c.x + 380 && A.x[i] < c.x + 520) onEnd++;
  assert.ok(onEnd <= 4, 'few still hang about the dead end (' + onEnd + ')');
  assert.ok(g.sampleLin(c.x + 470, c.y) < end0 * 0.5, 'the dead end got weaker than plain evaporation would make it');
  assert.ok(r.filter(o => Math.abs(o.turn) > 2 * AL.TAU).length <= 2, 'no ant spun repeated loops');
});
test('ant highways build up past the painted-trail cap', () => {
  const w = worldWithFood(), A = w.ants, c = w.player, g = w.pher.food[0];
  for (let k = 0; k < 12; k++) A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 150 + k, c.y, 0, w.R);
  for (let k = 0; k < 30 * 90; k++) AL.Sim.step(w);
  let best = 0; for (let x = c.x + 40; x < c.x + 190; x += 8) for (let dy = -16; dy <= 16; dy += 4) best = Math.max(best, g.sampleLin(x, c.y + dy));
  assert.ok(best > AL.TRAIL.PAINT_CAP * 1.5, 'ant-laid trail ' + best.toFixed(2) + ' vs brush cap ' + AL.TRAIL.PAINT_CAP);
});
