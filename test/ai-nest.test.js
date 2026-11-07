// AI rivals with real nests (opts.rivalNests, ai-nest.js): every rival ant is simulated, above ground and in the
// tunnels; the AI digs rooms, defends, scouts and raids with recruit orders; fights go on in real tunnels.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco']) require('../public/' + f + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, CH = AL.Nest.CH;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const mk = o => AL.Sim.createWorld(Object.assign({ seed: 4, species: 'fire', colonies: 3, rivalSpecies: ['carpenter', 'fire'], rivalNests: true, noFog: true, keypointsAt: 1e9 }, o || {}));
const inNest = (w, c, col) => { let n = 0; const A = w.ants; for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === L.NEST && A.nest[i] === c.id && (col == null || A.col[i] === col)) n++; return n; };

test('rivals get a real nest: tunnels, a queen ant, brood and ants underground (no numbers model)', () => {
  const w = mk();
  assert.deepEqual(w.detailed, [0, 1, 2]);
  for (const c of w.colonies.slice(1)) {
    assert.ok(c.bot && c.nest && !c.inside, 'colony ' + c.id + ' has a nest');
    assert.ok(c.queen.i >= 0 && w.ants.caste[c.queen.i] === C.QUEEN && w.ants.layer[c.queen.i] === L.NEST);
    assert.ok(c.brood.length > 0 && inNest(w, c, c.id) > 10);
    assert.ok(c.ai && c.ai.known && c.ai.known[c.id] === 1, 'the AI still keeps what it knows');
  }
  run(w, 60);
  for (const c of w.colonies.slice(1)) assert.ok(c.pop.reduce((a, b) => a + b, 0) > 10 && c.queen.alive, 'it lives like a person\'s colony');
  // without the option the rivals stay numbers
  const old = AL.Sim.createWorld({ seed: 4, colonies: 3, noFog: true });
  assert.ok(old.colonies[1].inside && !old.colonies[1].nest);
});

test('the AI digs: a full store gets a new food room marked and dug, joined to the tunnels by a corridor', () => {
  const w = mk(), c = w.colonies[1], nest = c.nest;
  run(w, 2);
  const food0 = nest.tiles[CH.FOOD].length;
  c.stock.sugar = c.cap.food * 0.9;
  c.bot.planT = 0;
  AL.AINest.plan(w, c);
  let planned = 0; for (let i = 0; i < nest.n; i++) if (nest.chamber[i] === CH.FOOD && nest.kind[i] !== AL.Nest.TILE.OPEN) planned++;
  assert.ok(planned >= 10, 'a food room is planned: ' + planned + ' tiles');
  for (let k = 0; k < 8; k++) { c.stock.sugar = Math.min(c.stock.sugar, c.cap.food * 0.5); run(w, 30); }
  assert.ok(nest.tiles[CH.FOOD].length > food0 + 5, 'dug out: ' + food0 + ' -> ' + nest.tiles[CH.FOOD].length + ' food tiles');
});

test('the AI raids with real ants: a recruit party walks to a known rival and breaks into its nest', () => {
  const w = mk({ aiKnows: 'all' }), c = w.colonies[1], A = w.ants;
  for (const o of w.colonies) if (o !== c && o.ai) o.ai.raidT = 1e9;
  // a strong army at home
  const [ex, ey] = AL.Nest.centre(c.nest, c.nest.entrance.r * c.nest.cols + c.nest.entrance.c);
  for (let k = 0; k < 20; k++) { const i = A.spawn(c.id, C.SOLDIER, L.NEST, ex, ey + 30, 0, w.R); A.nest[i] = c.id; AL.Life.decide(w, i); }
  run(w, 2);
  c.ai.raidT = 0;
  const ev = { raid: 0, breakIn: 0 };
  const off1 = AL.on('raid', (ww, d) => { if (ww === w && d.col === c.id) ev.raid++; }), off2 = AL.on('breakIn', (ww, d) => { if (ww === w && d.col === c.id) ev.breakIn++; });
  for (let k = 0; k < 30 * 240 && !ev.breakIn; k++) AL.Sim.step(w);
  off1(); off2();
  assert.ok(ev.raid >= 1, 'a raid set off');
  assert.ok(ev.breakIn >= 1, 'raiders got into a nest');
});

test('your ants at a rival mound go down into its tunnels and fight there', () => {
  const w = mk(), c = w.colonies[2], A = w.ants;
  for (const o of w.colonies) if (o.ai) o.ai.raidT = 1e9;
  for (let k = 0; k < 14; k++) { const i = A.spawn(0, C.SOLDIER, L.SURFACE, c.x + (k % 4) * 3 - 5, c.y + 3, 0, w.R); A.state[i] = ST.GUARD; A.tx[i] = c.x; A.ty[i] = c.y; A.timer[i] = 60; }
  run(w, 3);
  assert.ok(inNest(w, c, 0) >= 3, 'raiders inside: ' + inNest(w, c, 0));
  let fights = 0; for (let s = 0; s < 20 && !fights; s++) { run(w, 1); for (let i = 0; i < A.high; i++) if (A.state[i] === ST.FIGHT && A.layer[i] === L.NEST && A.nest[i] === c.id) fights++; }
  assert.ok(fights > 0, 'a fight in the rival\'s tunnels');
});

test('same seed, same match: real rival nests stay deterministic', () => {
  const sig = () => { const w = mk(); run(w, 90); const A = w.ants; let h = 0; for (let i = 0; i < A.high; i++) if (A.state[i]) h = (h * 31 + Math.round(A.x[i] * 10) + A.state[i]) >>> 0; return [h, w.colonies.map(c => c.pop.join(','))]; };
  assert.deepEqual(sig(), sig());
});
