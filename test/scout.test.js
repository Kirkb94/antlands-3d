// Scouts are pathfinders: they spot food far off, lay a strong trail home without carrying anything, and go
// back out. Hauling (anything carried, or big prey dragged) slows an ant to TUNE.CARRY_SLOW.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
const ST = AL.ST, K = AL.CARRY, C = AL.CASTE;
const run = (w, secs) => { for (let k = 0; k < secs * 30; k++) AL.Sim.step(w); };

// open ground, no ants, no food, no rocks
function bareWorld(seed, o) {
  const w = AL.Sim.createWorld(Object.assign({ seed: seed || 3, start: { workers: 0 }, flatGround: true }, o || {}));
  const S = w.surface; S.foods.length = 0; S.byId.clear(); S.blocked.fill(0); AL.Surface.rebuildFoodGrid(S);
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i]) w.ants.kill(i);
  return w;
}
const sugarAt = (w, x, y) => { const f = AL.Surface.addFood(w.surface, { kind: K.SUGAR, x, y, r: 10, amount: 300 }); AL.Surface.rebuildFoodGrid(w.surface); return f; };
// trail strength along the straight line from the nest out to x0 + len (summed across the trail's width)
function trailAlong(g, c, x0, len) {
  let s = 0;
  for (let x = x0; x <= x0 + len; x += 8) for (let dy = -24; dy <= 24; dy += 8) s += g.sampleLin(c.x + x, c.y + dy);
  return s;
}

test('a scout finds food, carries nothing, lays a trail home stronger than a forager\'s and goes back out', () => {
  const w = bareWorld(3), A = w.ants, c = w.player, g = w.pher.food[0];
  const f = sugarAt(w, c.x + 420, c.y);
  // the scout starts well out of smelling range of the food (it sees it: the pile is inside its sight)
  const i = A.spawn(0, C.SCOUT, 0, c.x + 150, c.y + 40, 0, w.R);
  const amt0 = f.amount;
  let found = -1, home = -1, carried = false;
  for (let k = 0; k < 30 * 60 && home < 0; k++) {
    AL.Sim.step(w);
    if (A.carry[i]) carried = true;
    if (found < 0 && A.state[i] === ST.RETURN) found = k;
    if (found >= 0 && A.state[i] === ST.WANDER) home = k;
  }
  assert.ok(found >= 0, 'the scout found the food');
  assert.ok(!carried, 'it never picked anything up');
  assert.equal(f.amount, amt0, 'the pile is untouched');
  assert.ok(home > found, 'it reached the mound and turned back out');
  assert.equal(A.layer[i], AL.LAYER.SURFACE, 'without going in');
  // it heads back out toward its find
  const d0 = Math.hypot(A.x[i] - f.x, A.y[i] - f.y);
  run(w, 3);
  assert.ok(Math.hypot(A.x[i] - f.x, A.y[i] - f.y) < d0 - 80, 'walking back to the find');
  const scoutTrail = trailAlong(g, c, 60, 300);
  assert.ok(scoutTrail > 1, 'a trail runs home (' + scoutTrail.toFixed(2) + ')');
  // the same trip by a laden forager: picks up at the pile and walks home once
  const w2 = bareWorld(3), B = w2.ants, c2 = w2.player, g2 = w2.pher.food[0];
  sugarAt(w2, c2.x + 420, c2.y);
  const j = B.spawn(0, C.FORAGER, 0, c2.x + 405, c2.y, 0, w2.R);
  for (let k = 0; k < 30 * 60 && B.state[j] !== ST.WANDER; k++) AL.Sim.step(w2);
  assert.equal(B.state[j], ST.WANDER, 'the forager delivered');
  const foragerTrail = trailAlong(g2, c2, 60, 300);
  assert.ok(scoutTrail > foragerTrail * 1.5, 'scout trail ' + scoutTrail.toFixed(2) + ' vs forager ' + foragerTrail.toFixed(2));
});

test('foragers follow a scout\'s trail out to the food it found', () => {
  const w = bareWorld(4), A = w.ants, c = w.player;
  const f = sugarAt(w, c.x + 300, c.y - 380);
  const i = A.spawn(0, C.SCOUT, 0, c.x + 60, c.y - 120, -1, w.R);
  for (let k = 0; k < 30 * 40 && A.state[i] !== ST.RETURN; k++) AL.Sim.step(w);
  assert.equal(A.state[i], ST.RETURN, 'found it');
  for (let k = 0; k < 30 * 30 && A.state[i] === ST.RETURN; k++) AL.Sim.step(w);
  // foragers stepping out of the mound take the fresh trail
  const ids = []; for (let k = 0; k < 20; k++) { const a = w.R() * AL.TAU; ids.push(A.spawn(0, C.FORAGER, 0, c.x + Math.cos(a) * 4, c.y + Math.sin(a) * 4, a, w.R)); }
  const amt0 = f.amount;
  run(w, 40);
  assert.ok(amt0 - f.amount >= 6, 'foragers reached the find and took ' + (amt0 - f.amount) + ' crumbs');
});

test('a scout spots food at its sight radius that a worker would not', () => {
  const r = AL.CASTES[C.SCOUT].vis * AL.TUNE.FOG_CELL;
  assert.ok(r >= 300, 'scout sight ' + r);
  const near = caste => {
    const w = bareWorld(6), A = w.ants, c = w.player;
    // far from the nest, the pile ~0.9 sight radii off to one side of the ant's heading
    const x = c.x + 900, y = c.y - 300, f = sugarAt(w, x, y + r * 0.9);
    const i = A.spawn(0, caste, 0, x, y, 0, w.R);
    let best = 1e9;
    for (let k = 0; k < 30 * 9; k++) { AL.Sim.step(w); if (A.state[i] === ST.WANDER || A.state[i] === ST.RETURN) best = Math.min(best, Math.hypot(A.x[i] - f.x, A.y[i] - f.y)); }
    return { best, state: A.state[i], carry: A.carry[i] };
  };
  const s = near(C.SCOUT), wk = near(C.WORKER);
  assert.ok(s.best < 20 && s.state === ST.RETURN, 'the scout walked over to it (' + s.best.toFixed(0) + ')');
  assert.ok(wk.best > 100 && !wk.carry, 'the worker never noticed it (' + wk.best.toFixed(0) + ')');
});

test('scouts leave food the colony already has a trail to', () => {
  const w = bareWorld(8), A = w.ants, c = w.player, g = w.pher.food[0];
  const x = c.x + 900, y = c.y - 300;
  sugarAt(w, x + 200, y);
  for (let d = 0; d < 300; d += 4) g.depositLin(x + 200 - d, y, 3);   // a forager highway already leads there
  const i = A.spawn(0, C.SCOUT, 0, x, y + 60, 0, w.R);
  let reported = false;
  for (let k = 0; k < 30 * 8; k++) { AL.Sim.step(w); if (A.state[i] === ST.RETURN) reported = true; }
  assert.ok(!reported, 'no second trail to a known find');
});

test('an ant carrying something walks 20% slower than the same ant empty', () => {
  assert.equal(AL.TUNE.CARRY_SLOW, 0.8);
  const w = bareWorld(5), A = w.ants, c = w.player;
  const a = A.spawn(0, C.FORAGER, 0, c.x + 600, c.y, Math.PI, w.R), b = A.spawn(0, C.FORAGER, 0, c.x + 600, c.y + 100, Math.PI, w.R);
  A.state[a] = A.state[b] = ST.HOMING; A.carry[b] = K.SUGAR;
  let da = 0, db = 0;
  for (let k = 0; k < 30; k++) { AL.Sim.step(w); da += Math.hypot(A.x[a] - A.px[a], A.y[a] - A.py[a]); db += Math.hypot(A.x[b] - A.px[b], A.y[b] - A.py[b]); }
  assert.ok(Math.abs(db / da - 0.8) < 0.01, 'carrying / empty = ' + (db / da).toFixed(3));
});

test('big prey dragged home moves 20% slower than before', () => {
  const w = bareWorld(9), A = w.ants, S = w.surface, c = w.player;
  const f = AL.Surface.addFood(S, { kind: K.PROTEIN, x: c.x + 300, y: c.y, r: 16, amount: 40, big: true, needed: 2 });
  AL.Surface.rebuildFoodGrid(S);
  for (let k = 0; k < 6; k++) { const i = A.spawn(0, C.WORKER, 0, f.x + 18, f.y + k, 0, w.R); AL.Behavior.pickup(w, i, f); }
  const x0 = f.x;
  run(w, 1);
  // six pullers, two needed: full speed would be min(22, 6 + 3 * (6 - 2)) = 18 units per second
  assert.ok(Math.abs((x0 - f.x) - 18 * AL.TUNE.CARRY_SLOW) < 0.5, 'moved ' + (x0 - f.x).toFixed(2));
});

test('nest ants carrying something walk 20% slower inside too', () => {
  require('../public/life.js');
  const w = AL.Sim.createWorld({ seed: 11 }), A = w.ants, c = w.player, N = AL.Nest;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.caste[i] !== C.QUEEN) A.kill(i);
  const [x, y] = N.centre(c.nest, c.nest.entrance.r * c.nest.cols + c.nest.entrance.c);
  const mk = carry => { const i = A.spawn(0, C.WORKER, AL.LAYER.NEST, x, y, 0, w.R); A.carry[i] = carry; AL.Life.goTo(w, i, N.F.FOOD, AL.ACT.STORE); A.tx[i] = x; A.ty[i] = y; return i; };
  const a = mk(0), b = mk(K.SUGAR);
  let ma = 0, mb = 0;
  for (let k = 0; k < 20; k++) { AL.Sim.step(w); ma = Math.max(ma, Math.hypot(A.x[a] - A.px[a], A.y[a] - A.py[a])); mb = Math.max(mb, Math.hypot(A.x[b] - A.px[b], A.y[b] - A.py[b])); }
  assert.ok(ma > 0 && Math.abs(mb / ma - 0.8) < 0.02, 'carrying / empty step = ' + (mb / ma).toFixed(3));
});

test('a hungry scout goes home, eats at the food store and heads back out', () => {
  require('../public/life.js');
  const w = AL.Sim.createWorld({ seed: 13 }), A = w.ants, c = w.player, S = w.surface;
  S.foods.length = 0; S.byId.clear(); AL.Surface.rebuildFoodGrid(S);
  const i = A.spawn(0, C.SCOUT, 0, c.x + 250, c.y, 0, w.R);
  run(w, 1);
  assert.ok(!AL.Behavior.needsToEat(w, i), 'just out: not hungry');
  A.gut[i] = AL.HUNGER.HOME - 0.05;   // its stomach is nearly empty (hunger.js)
  assert.ok(AL.Behavior.needsToEat(w, i));
  let homing = false, store = false, out = false;
  for (let k = 0; k < 30 * 90 && !out; k++) {
    AL.Sim.step(w);
    if (A.state[i] === ST.HOMING) homing = true;
    if (A.layer[i] === AL.LAYER.NEST && (A.act[i] === AL.ACT.STORE || A.act[i] === AL.ACT.EAT)) store = true;
    if (store && A.layer[i] === AL.LAYER.SURFACE && A.state[i] === ST.WANDER) out = true;
  }
  assert.ok(homing && store && out, 'home ' + homing + ', to the store ' + store + ', back out ' + out);
  assert.ok(!AL.Behavior.needsToEat(w, i), 'fed again');
});

test('a rival scout touches its abstract nest and goes back out instead of vanishing inside', () => {
  require('../public/life.js'); require('../public/combat.js'); require('../public/orders.js'); require('../public/ai.js');
  const w = AL.Sim.createWorld({ seed: 14, colonies: 2 }), A = w.ants, r = w.colonies[1];
  const i = A.spawn(1, C.SCOUT, 0, r.x + 200, r.y, Math.PI, w.R);
  run(w, 0.2);
  A.scAte[i] = w.t - AL.Behavior.SCOUT.OUT - 1; A.state[i] = ST.HOMING;
  const in0 = r.inside[C.SCOUT];
  let back = false;
  for (let k = 0; k < 30 * 20 && !back; k++) { AL.Sim.step(w); if (A.state[i] === ST.WANDER && Math.hypot(A.x[i] - r.x, A.y[i] - r.y) < 60) back = true; }
  assert.ok(back && A.state[i], 'still out on the surface');
  assert.ok(r.inside[C.SCOUT] < in0 + 0.5, 'not counted inside');   // (numbers inside age away a little)
  assert.ok(!AL.Behavior.needsToEat(w, i), 'the visit counted as a meal');
});
