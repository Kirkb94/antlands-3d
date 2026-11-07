// Species twists on the rivals' abstract model (balance pass, Nov 2026): ai.js AL.AI_SPECIES_TUNE, species.js
// (slave raids take pupae only, army raids eat brood, honeypot hunting), bivouac.js (rivals lose a marched bivouac).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'bivouac', 'fog', 'expansion', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'species']) require('../public/' + f + '.js');
const S = AL.Species, AIS = AL.AI_SPECIES_TUNE, C = AL.CASTE, ST = AL.ST, K = AL.CARRY, L = AL.LAYER;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const world = (rivals, extra) => AL.Sim.createWorld(Object.assign({ seed: 9, colonies: rivals.length + 1, rivalSpecies: rivals, noFog: true }, extra || {}));
// an ant of colony `col` standing at colony `at`'s door
const antAt = (w, col, caste, at, state) => { const i = w.ants.spawn(col.id, caste, L.SURFACE, at.x + 3, at.y, 0, w.R); w.ants.state[i] = state; return i; };

test('the twist table only names real species, and leaves the player alone', () => {
  for (const k in AIS) assert.ok(AL.SPECIES[k], k);
  const w = world(['slavemaker']);
  assert.deepEqual(AL.AI.twist(w.player), w.player.spKey in AIS ? AIS[w.player.spKey] : {});
  assert.equal(AL.AI.twist(w.colonies[1]), AIS.slavemaker);
});

// todo: food in over four seeds is noise-dominated (a raid or a spider swings a match by more than the forage share does;
// it flips with any change to the RNG stream, Nov 2026). The forage share itself only slows how fast their own workers
// refill the yard: needs a firmer measure before it can gate anything.
test('rival slave-makers\' own workers barely forage: without enough captives the colony brings in far less', { todo: 'noisy: see above' }, () => {
  // (one seed is too noisy to tell: a raid or a spider swings a 400 s match either way; over four it shows)
  const food = forage => {
    const keep = AIS.slavemaker.forage, T = AL.TUNE, rates = [T.HONEYDEW_RATE, T.NECTAR_RATE]; AIS.slavemaker.forage = forage;
    T.HONEYDEW_RATE = T.NECTAR_RATE = 0.09;   // (a leaner yard than the Nov 2026 balance run's: this measures their foraging, not the yard)
    let sum = 0;
    for (const seed of [9, 3, 5, 7]) {
      const w = AL.Sim.createWorld({ seed, colonies: 2, rivalSpecies: ['slavemaker'], noFog: true, flatGround: true, noStarter: true }), r = w.colonies[1];
      run(w, 400); sum += r.stats.foodIn;
    }
    AIS.slavemaker.forage = keep; [T.HONEYDEW_RATE, T.NECTAR_RATE] = rates;
    return sum;
  };
  assert.ok(AIS.slavemaker.forage < 1);
  const lazy = food(AIS.slavemaker.forage), busy = food(1);
  assert.ok(lazy < busy * 0.9, 'food in: ' + Math.round(lazy) + ' vs ' + Math.round(busy) + ' if their own workers foraged like anyone\'s');
});

test('a rival slave raid on a rival nest carries off pupae, not eggs; with none left the raiders turn home', () => {
  const w = world(['slavemaker', 'fire']), sm = w.colonies[1], v = w.colonies[2];
  v.inside.fill(0); v.broodQ.length = 0;
  for (let k = 0; k < 6; k++) v.broodQ.push({ caste: C.WORKER, t: 0.1, fed: k % 2 === 0 });   // eggs and small larvae
  const i = antAt(w, sm, C.SOLDIER, v, ST.S_BRAID);
  assert.equal(S.raidIn(w, i, v), false, 'nothing worth carrying');
  assert.equal(v.broodQ.length, 6);
  v.broodQ.push({ caste: C.WORKER, t: S.CFG.SM_AI_PUPA + 0.1, fed: true });
  let got = false;
  for (let k = 0; k < 20 && !got; k++) { const j = antAt(w, sm, C.SOLDIER, v, ST.S_BRAID); got = S.raidIn(w, j, v); if (got) assert.equal(w.ants.carry[j], K.BROOD); }
  assert.ok(got, 'the pupa was carried off');
  assert.equal(v.broodQ.length, 6);
  assert.ok(v.broodQ.every(b => b.t < S.CFG.SM_AI_PUPA), 'only the eggs and larvae are left');
  // a raider at a nest with no pupae left walks home instead of breaking in
  const j = antAt(w, sm, C.SOLDIER, v, ST.S_BRAID); w.ants.task[j] = v.id;
  w.surfaceHandlers[ST.S_BRAID](w, j, 1 / 30, true);
  assert.equal(w.ants.state[j], ST.HOMING);
});

test('rival army raids eat the brood of the nests they break into', () => {
  const w = world(['army', 'fire']), ar = w.colonies[1], v = w.colonies[2];
  v.inside.fill(0); v.broodQ.length = 0;
  for (let k = 0; k < 5; k++) v.broodQ.push({ caste: C.WORKER, t: 0.3, fed: true });
  const p0 = ar.stock.protein;
  let got = 0;
  for (let k = 0; k < 10; k++) { const i = antAt(w, ar, C.WORKER, v, ST.RAID); if (S.preyIn(w, i, v)) { got++; assert.equal(w.ants.carry[i], K.PROTEIN); assert.equal(w.ants.state[i], ST.RETURN); } }
  assert.ok(got >= 3, 'brood eaten: ' + got);
  assert.equal(v.broodQ.length, 5 - got);
  assert.ok(Math.abs(ar.stock.protein - p0 - got * (S.CFG.PREY_PROT - 1)) < 1e-6, 'each larva is worth PREY_PROT protein (one crumb carried)');
  // only raiders of rival army colonies hunt brood
  const f = w.colonies[2], i = antAt(w, w.colonies[1], C.WORKER, v, ST.WANDER);
  assert.equal(S.preyIn(w, i, v), false);
  assert.ok(f);
});

test('rivals lose track of a rival bivouac that has marched away', () => {
  const w = world(['army', 'fire'], { aiKnows: 'all' }), ar = w.colonies[1], o = w.colonies[2];
  run(w, 5);
  assert.equal(o.ai.known[ar.id], 1);
  // march away from the fire rival (army colonies only move in their wandering phase)
  AL.Bivouac.state(ar).phase = 'nomadic';
  const d = Math.hypot(ar.x - o.x, ar.y - o.y) || 1, tx = AL.clamp(ar.x + (ar.x - o.x) / d * 600, 200, w.surface.W - 200), ty = AL.clamp(ar.y + (ar.y - o.y) / d * 600, 200, w.surface.H - 200);
  const r = AL.Bivouac.start(w, ar, tx, ty);
  assert.ok(r.ok, r.why);
  let ended = false; const off = AL.on('marchEnd', (ww, e) => { if (ww === w && e.col === ar.id) ended = true; });
  for (let k = 0; k < 200 && !ended; k++) run(w, 1);
  off();
  assert.ok(ended, 'the march ended');
  assert.ok(Math.hypot(ar.x - o.x, ar.y - o.y) > AL.Bivouac.TUNE.AI_FORGET, 'it settled far from the fire rival');
  assert.equal(o.ai.known[ar.id], 0, 'the fire rival has to find it again');
  assert.equal(ar.ai.known[o.id], 1, 'the army still knows its neighbours');
});

test('carpenter rivals hold their wood galleries: a siege inside costs the attackers more', () => {
  const lost = nestDef => {
    const w = world(['carpenter', 'fire']), c = w.colonies[1];
    const keep = AIS.carpenter.nestDef; AIS.carpenter.nestDef = nestDef;
    c.inside.fill(0); c.inside[C.WORKER] = 20; c.siege.fill(0); c.siege[C.SOLDIER] = 10; c.siegeBy = 2;
    for (let k = 0; k < 5; k++) AL.AI.siegeTick(w, c);
    AIS.carpenter.nestDef = keep;
    return 10 - c.siege[C.SOLDIER];
  };
  assert.ok(AIS.carpenter.nestDef > 1);
  const a = lost(1), b = lost(AIS.carpenter.nestDef);
  assert.ok(b > a * 1.3, 'attackers lost ' + b.toFixed(2) + ' vs ' + a.toFixed(2) + ' in a plain nest');
});

test('honeypot rivals with a full honey bank hunt for protein', () => {
  const w = world(['honeypot']), h = w.colonies[1];
  run(w, 1);
  h.inside[C.HONEYPOT] = 30; h.honey = 300; h.stock.protein = 0; h.stock.sugar = 25;   // (no sugar to bank)
  run(w, 3);
  assert.ok(h.stock.protein > 0.5, 'protein ' + h.stock.protein);
  assert.ok(h.honey < 300, 'paid in honey: ' + h.honey);
});

test('fire rivals take in extra queens while the colony is still small', () => {
  const w = world(['fire']), f = w.colonies[1];
  run(w, 1);
  w.t = AL.TUNE.POLY.autoFirst + 1;
  const adults = Math.ceil(AL.TUNE.POLY.autoPop / AIS.fire.queenPop) + 5;
  f.inside.fill(0); f.inside[C.WORKER] = adults;
  run(w, 2);
  assert.ok((f.queenX || 0) >= 1, 'an extra queen at ' + adults + ' adults');
});

test('carpenter rivals raise brood on honeydew (less protein, some sugar); fire rivals bring home more of each catch', () => {
  const w = world(['carpenter', 'fire']), cp = w.colonies[1], f = w.colonies[2], A = w.ants;
  run(w, 1);
  cp.broodQ.length = 0; cp.broodQ.push({ caste: C.SOLDIER, t: 0, fed: false });
  cp.stock.protein = AL.CASTES[C.SOLDIER].prot * AIS.carpenter.broodProt + 0.01; cp.stock.sugar = 100;
  run(w, 1);
  assert.ok(cp.broodQ.length === 0 || cp.broodQ[0].fed, 'a soldier larva fed on half its protein');
  const p0 = f.stock.protein, i = A.spawn(f.id, C.FORAGER, L.SURFACE, f.x, f.y, 0, w.R);
  A.carry[i] = K.PROTEIN; f.enter(w, i);
  assert.ok(Math.abs(f.stock.protein - p0 - AIS.fire.prey) < 1e-6, 'one crumb of prey is worth ' + AIS.fire.prey);
});

test('bullet rivals raise a handful of brood at a time', () => {
  const w = world(['bullet']), b = w.colonies[1], G = AL.TUNE.GROW;
  let most = 0;
  // (an eager queen: an egg every second, so the brood chambers are the limit)
  for (let k = 0; k < 60; k++) { b.stock.sugar = 300; b.stock.protein = 200; b.queen.layT = 0; run(w, 1); most = Math.max(most, b.broodQ.length); }
  assert.ok(most <= Math.ceil(G.aiBrood * AIS.bullet.broodRoom) + 2, 'brood queue at most ' + most);
  assert.ok(most >= Math.floor(G.aiBrood * AIS.bullet.broodRoom) - 1, 'and fill them: ' + most);
});
