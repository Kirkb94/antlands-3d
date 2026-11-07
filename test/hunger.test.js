// Per-ant hunger in people's colonies (hunger.js): stomachs empty, hungry ants eat at the food store, surface ants
// come home to eat, nurses carry food to the larvae and the queen, and an empty store starves ants. AI rivals keep
// their colony-level upkeep.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
for (const m of ['sim', 'life', 'combat', 'orders', 'ai', 'fog']) require('../public/' + m + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, ACT = AL.ACT, K = AL.CARRY, HG = AL.HUNGER, N = AL.Nest, CH = N.CH;
const run = (w, secs, each) => { for (let k = 0; k < secs * 30; k++) { if (each) each(k); AL.Sim.step(w); } };

// the player's colony with only its queen left (no brood, no laying), no food on the map, no raids
function emptyColony(seed, o) {
  const w = AL.Sim.createWorld(Object.assign({ seed: seed || 3 }, o || {})), A = w.ants, c = w.player;
  for (const r of w.colonies) if (r.ai) r.ai.raidT = 1e9;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.caste[i] !== C.QUEEN) A.kill(i);
  c.brood.length = 0; c.auto = false; c.eggQueue.length = 0;
  const S = w.surface; S.foods.length = 0; S.byId.clear(); AL.Surface.rebuildFoodGrid(S);
  c.stock.sugar = 200; c.stock.protein = 100;
  return w;
}
function nestAnt(w, caste, ch) {
  const A = w.ants, t = w.nest.tiles[ch], [x, y] = N.centre(w.nest, t[(t.length / 2) | 0]);
  const i = A.spawn(0, caste, L.NEST, x, y, 0, w.R);
  A.tx[i] = x; A.ty[i] = y; AL.Life.idle(w, i, 0.5);
  return i;
}
const chamberOf = (w, i) => w.nest.chamber[N.tileOf(w.nest, w.ants.x[i], w.ants.y[i])];

test('a stomach empties at the caste\'s eating rate; a hungry ant walks to the food store and eats from the stock', () => {
  const w = emptyColony(3), A = w.ants, c = w.player;
  const i = nestAnt(w, C.WORKER, CH.QUEEN), u = A.uid[i];
  A.gut[i] = 0.9; run(w, 30);
  const per = (0.9 - A.gut[i]) / 30;
  assert.ok(Math.abs(per - 1 / HG.FULL_T) < 0.2 / HG.FULL_T, 'empties ~1/FULL_T per second: ' + per);
  // a full stomach holds FULL_T seconds of what the caste eats (colony upkeep for one ant)
  assert.ok(Math.abs(AL.Hunger.capOf(c, C.WORKER) - AL.Colony.casteUpkeep(c.sp, C.WORKER) * AL.TUNE.SUGAR_PER_ANT * HG.FULL_T) < 1e-9);
  assert.ok(AL.Hunger.capOf(c, C.MAJOR) > AL.Hunger.capOf(c, C.WORKER) * 2, 'majors eat more');
  A.gut[i] = HG.HUNGRY - 0.01; AL.Life.decide(w, i);
  assert.equal(A.act[i], ACT.EAT, 'off to eat');
  const s0 = c.stock.sugar, g0 = A.gut[i];
  let ateAt = -1;
  run(w, 40, () => { if (ateAt < 0 && A.gut[i] > 0.9) ateAt = chamberOf(w, i); });
  assert.equal(A.uid[i], u);
  assert.equal(ateAt, CH.FOOD, 'ate in the food store');
  const want = (1 - g0) * AL.Hunger.capOf(c, C.WORKER);
  assert.ok(s0 - c.stock.sugar > want * 0.8, 'took its meal from the colony stock (' + (s0 - c.stock.sugar).toFixed(3) + ' of ' + want.toFixed(3) + ')');
});

test('with the sugar gone, adults eat protein at half its worth', () => {
  const w = emptyColony(9), A = w.ants, c = w.player;
  const i = nestAnt(w, C.WORKER, CH.FOOD); A.gut[i] = 0.1;
  c.stock.sugar = 0; c.stock.protein = 40;
  const cap = AL.Hunger.capOf(c, C.WORKER), want = 0.9 * cap;
  const got = AL.Hunger.eat(w, i, c);
  assert.ok(Math.abs(got - want) < 1e-6, 'a full meal: ' + got);
  assert.ok(Math.abs((40 - c.stock.protein) - want / HG.PROT_EAT) < 1e-6, 'twice its worth in protein');
  assert.ok(A.gut[i] > 0.99);
  // sugar first when there is some
  A.gut[i] = 0.1; c.stock.sugar = 100; const p0 = c.stock.protein;
  AL.Hunger.eat(w, i, c);
  assert.equal(c.stock.protein, p0);
  assert.equal(AL.Hunger.edible({ sugar: 3, protein: 10 }), 3 + 10 * HG.PROT_EAT);
});

test('a forager out on the surface comes home when hungry, eats and goes back out', () => {
  const w = emptyColony(5), A = w.ants, c = w.player;
  const i = A.spawn(0, C.FORAGER, L.SURFACE, c.x + 220, c.y + 30, 0, w.R), u = A.uid[i];
  A.gut[i] = HG.HOME + 0.02;
  assert.ok(!AL.Behavior.needsToEat(w, i));
  let homing = false, ate = false, out = false;
  for (let k = 0; k < 30 * 120 && !out; k++) {
    AL.Sim.step(w);
    if (A.state[i] === ST.HOMING) homing = true;
    if (A.gut[i] > 0.9) ate = true;
    if (ate && A.layer[i] === L.SURFACE && A.state[i] === ST.WANDER) out = true;
  }
  assert.equal(A.uid[i], u);
  assert.ok(homing && ate && out, 'home ' + homing + ', ate ' + ate + ', back out ' + out);
  // with an empty store it doesn't come home for nothing: it keeps foraging
  A.gut[i] = 0.05; c.stock.sugar = 0; c.stock.protein = 0;
  assert.ok(!AL.Behavior.needsToEat(w, i));
});

test('nurses carry food to the larvae and the queen; unfed brood stalls and an unfed queen stops laying', () => {
  const w = emptyColony(7), A = w.ants, c = w.player, q = c.queen;
  c.brood.push({ caste: C.WORKER, stage: 1, t: 0, starve: 0, slot: -1 }, { caste: C.WORKER, stage: 1, t: 0, starve: 0, slot: -1 });
  AL.Life.placeBrood(c);
  c.broodFood.sugar = 0; c.broodFood.protein = 0;
  // nobody to feed them: the larvae stall and the queen goes hungry
  A.gut[q.i] = HG.QUEEN_LAY + 0.05; c.auto = true;
  let laid = 0; const off = AL.on('eggLaid', (ww, d) => { if (ww === w && d.col === 0) laid++; });
  run(w, 30);
  assert.ok(c.brood[0].t < 0.01 && c.brood[0].starve > 20, 'an unfed larva stalls (t ' + c.brood[0].t + ', starve ' + c.brood[0].starve + ')');
  assert.ok(A.gut[q.i] < HG.QUEEN_LAY, 'the queen got hungry');
  const laid0 = laid; run(w, 10);
  assert.equal(laid, laid0, 'a hungry queen does not lay');
  c.auto = false;
  for (const b of c.brood) b.starve = 0;   // (keep them alive for the second half)
  // two nurses: they fetch loads from the store and take them to the nursery and the queen's chamber
  const n1 = nestAnt(w, C.NURSE, CH.NURSERY), n2 = nestAnt(w, C.NURSE, CH.NURSERY);
  let carried = 0, toQueen = false;
  run(w, 80, () => {
    for (const n of [n1, n2]) if (A.load[n] > 0 && (A.carry[n] === K.SUGAR || A.carry[n] === K.PROTEIN)) { carried++; if (A.act[n] === ACT.FEEDQ) toQueen = true; }
  });
  off();
  assert.ok(carried > 0, 'nurses carried food');
  assert.ok(toQueen, 'a load went to the queen');
  assert.ok(A.gut[q.i] > HG.QUEEN_FEED, 'the queen is fed (' + A.gut[q.i].toFixed(2) + ')');
  assert.ok(c.brood.length < 2 || c.brood[0].stage > 1 || c.brood[0].t > 0.3, 'the larvae grow again');
});

test('with no nurses, workers feed the queen', () => {
  const w = emptyColony(9), A = w.ants, c = w.player, q = c.queen;
  for (let k = 0; k < 6; k++) nestAnt(w, C.WORKER, CH.QUEEN);
  A.gut[q.i] = 0.2;
  run(w, 90);
  assert.ok(A.gut[q.i] > HG.QUEEN_FEED, 'queen fed by workers (' + A.gut[q.i].toFixed(2) + ')');
});

test('an empty store: ants go hungry, the colony starves, empty stomachs cost hp and kill', () => {
  const w = emptyColony(11), A = w.ants, c = w.player;
  c.recall = true;
  const ids = []; for (let k = 0; k < 5; k++) { const i = nestAnt(w, C.WORKER, CH.QUEEN); A.gut[i] = 0.02; A.hp[i] = A.maxhp[i] * 0.3; ids.push([i, A.uid[i], A.hp[i]]); }
  let starving = false, died = 0;
  const off = AL.on('antDied', (ww, d) => { if (ww === w && d.col === 0 && d.cause === 'starve') died++; });
  const off2 = AL.on('starving', (ww, d) => { if (ww === w && d.col === 0) starving = true; });
  run(w, 10, () => { c.stock.sugar = 0; c.stock.protein = 0; c.stock.seeds = 0; });
  assert.ok(starving && c.starving, 'the colony is starving');
  assert.ok(c.hunger.empty >= 5, 'empty stomachs counted: ' + c.hunger.empty);
  for (const [i, u, hp] of ids) if (A.uid[i] === u) assert.ok(A.hp[i] < hp, 'losing hp');
  run(w, 90, () => { c.stock.sugar = 0; c.stock.protein = 0; c.stock.seeds = 0; });
  assert.ok(died >= 5, 'starved to death: ' + died);
  // the queen does not starve to death, she only stops laying
  assert.ok(c.queen.alive);
  // food comes in: no longer starving
  c.stock.sugar = 100; run(w, 2);
  assert.ok(!c.starving);
  off(); off2();
});

test('an ant that can\'t eat (AL.Injury.canEat false) keeps starving with food in store', () => {
  const w = emptyColony(13), A = w.ants, c = w.player;
  const i = nestAnt(w, C.WORKER, CH.FOOD), j = nestAnt(w, C.WORKER, CH.FOOD);
  A.gut[i] = A.gut[j] = 0.1;
  const prev = AL.Injury; AL.Injury = Object.assign(Object.create(prev || {}), { canEat: (ww, k) => k !== i, speedMul: () => 1 });   // the rest of injury.js stays (when loaded)
  try {
    assert.equal(AL.Hunger.eat(w, i, c), 0);
    run(w, 5);
    assert.ok(A.gut[i] < 0.1 && A.gut[j] > 0.9, 'only the one that can eat ate: ' + A.gut[i].toFixed(2) + ' / ' + A.gut[j].toFixed(2));
  } finally { if (prev) AL.Injury = prev; else delete AL.Injury; }
});

test('scouts use the real hunger: hungry ones come home and eat at the store', () => {
  const w = emptyColony(15), A = w.ants, c = w.player;
  const i = A.spawn(0, C.SCOUT, L.SURFACE, c.x + 250, c.y, 0, w.R);
  A.gut[i] = 0.8; run(w, 1);
  assert.ok(!AL.Behavior.needsToEat(w, i), 'fed: not hungry');
  A.gut[i] = 0.1;
  assert.ok(AL.Behavior.needsToEat(w, i), 'hungry');
  const s0 = c.stock.sugar;
  let out = false, ate = false;
  for (let k = 0; k < 30 * 90 && !out; k++) { AL.Sim.step(w); if (A.gut[i] > 0.9) ate = true; if (ate && A.layer[i] === L.SURFACE && A.state[i] === ST.WANDER) out = true; }
  assert.ok(ate && out, 'ate ' + ate + ', back out ' + out);
  assert.ok(c.stock.sugar < s0, 'from the stock');
});

test('AI rivals keep their colony upkeep: no stomachs drain, their ants never head home to eat', () => {
  const w = AL.Sim.createWorld({ seed: 17, colonies: 2, rivalSpecies: ['fire'] }), A = w.ants, r = w.colonies[1];
  run(w, 2);
  let k = -1; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 1 && A.caste[i] !== C.SCOUT) { k = i; break; }
  assert.ok(k >= 0);
  const u = A.uid[k], g = A.gut[k];
  run(w, 20);
  if (A.uid[k] === u) assert.equal(A.gut[k], g, 'rival stomach untouched');
  A.gut[k] = 0;
  assert.ok(!AL.Behavior.needsToEat(w, k), 'rival forager not sent home');
  assert.ok(!r.hunger, 'no per-ant hunger state on a rival');
  // the rival's store still pays one upkeep for everyone (ai.js): with nobody out delivering, it goes down by at least that
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 1 && A.layer[i] === L.SURFACE) A.kill(i);
  r.stock.sugar = 500; w.env.winter = false;
  const want = AL.Colony.upkeep(r) + AL.TUNE.QUEEN_SUGAR;
  run(w, 1);
  assert.ok(500 - r.stock.sugar >= want * 0.95, 'rival sugar eaten ' + (500 - r.stock.sugar).toFixed(3) + ', upkeep ' + want.toFixed(3));
});

test('slave-makers short of food send captives and their own workers out foraging, and lay workers, not soldiers', () => {
  require('../public/species.js');
  const w = AL.Sim.createWorld({ seed: 19, species: 'slavemaker' }), A = w.ants, c = w.player;
  for (const r of w.colonies) if (r.ai) r.ai.raidT = 1e9;
  run(w, 2);
  for (let k = 0; k < 8; k++) nestAnt(w, C.WORKER, CH.QUEEN);   // a few of the queen's own workers
  const n = { cap: 0, capOut: 0, own: 0, ownOut: 0 };
  const tryAll = () => { for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== 0 || A.layer[i] !== L.NEST) continue;
    const k = A.caste[i]; if (k !== C.CAPTIVE && k !== C.WORKER) continue;
    A.gut[i] = 1; A.prev[i] = 0; AL.Life.decide(w, i);
    const out = A.state[i] === ST.N_GOTO && A.act[i] === ACT.EXIT && A.prev[i] === ST.WANDER;
    if (k === C.CAPTIVE) { n.cap++; if (out) n.capOut++; } else { n.own++; if (out) n.ownOut++; }
  } };
  c.stock.sugar = 0; c.stock.protein = 0; c.starving = true; tryAll();
  assert.ok(n.cap > 3 && n.capOut / n.cap > 0.45, 'captives forage: ' + n.capOut + '/' + n.cap);
  assert.ok(n.own > 0 && n.ownOut / n.own > 0.3, 'own workers forage: ' + n.ownOut + '/' + n.own);
  assert.equal(AL.Species.autoCaste(c), C.WORKER, 'no soldiers while food is short');
});

test('a starving colony: hungry, hurt ants keep foraging instead of trooping in and out for crumbs, and drink at the sugar they find', () => {
  const w = AL.Sim.createWorld({ seed: 6, colonies: 1, noFog: true, keypointsAt: 1e9 }), c = w.player, A = w.ants;
  for (let k = 0; k < 30 * 2; k++) AL.Sim.step(w);
  c.stock.sugar = 2; c.stock.protein = 0;   // a crumb or two: under a meal, too little to heal on
  const out = [];
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, i = A.spawn(0, C.FORAGER, AL.LAYER.SURFACE, c.x + Math.cos(a) * 200, c.y + Math.sin(a) * 200, a, w.R); A.home[i] = c.hid; A.gut[i] = 0.08; A.hp[i] = A.maxhp[i] * 0.3; A.state[i] = AL.ST.WANDER; out.push(i); }
  let back = 0;
  for (let s = 0; s < 15 * 30; s++) { AL.Sim.step(w); c.stock.sugar = 2; c.stock.protein = 0; for (const i of out) if (A.state[i] === AL.ST.HEAL || A.state[i] === AL.ST.HOMING) { back++; } }
  assert.ok(back < 12 * 15 * 30 * 0.1, 'they stay out foraging (ant-ticks spent heading home: ' + back + ')');
  // a hungry forager at a sugar source drinks first
  const f = w.surface.foods.find(q => q.kind === AL.CARRY.SUGAR && q.amount > 10 && !q.big);
  assert.ok(f, 'some sugar in the yard');
  const i = A.spawn(0, C.FORAGER, AL.LAYER.SURFACE, f.x, f.y, 0, w.R); A.home[i] = c.hid; A.gut[i] = 0.05;
  const a0 = f.amount;
  AL.Hunger.graze(w, i, f);
  assert.ok(A.gut[i] > 0.9 && f.amount < a0, 'drank its fill: ' + A.gut[i].toFixed(2));
});
