// Army ants: a bivouac of living ants that runs on its brood's clock (settle / wander), swarm raids, and
// colonies that split instead of flying. For the player and for rivals.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'bivouac', 'swarm', 'fog', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog']) require('../public/' + f + '.js');
const B = AL.Bivouac, ST = AL.ST, L = AL.LAYER, K = AL.CARRY, C = AL.CASTE, TILE = AL.Nest.TILE;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const count = (w, f) => { let n = 0; for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && f(i)) n++; return n; };
const wander = (w, c) => { const b = B.state(c); b.phase = 'nomadic'; b.since = w.t; b.end = -1e9; b.moveAt = w.t + 999; };   // skip ahead to the wandering phase
const noRaids = w => { for (const c of w.colonies) c.swarmNext = 1e9; };

test('the bivouac is a cluster of living ants, not a burrow: no soil, no digging, and it grows with the colony', () => {
  const w = AL.Sim.createWorld({ seed: 5, species: 'army', colonies: 2 }), n = w.player.nest;
  assert.ok(n.bivouac, 'army ants get a bivouac');
  const kinds = new Set(n.kind);
  for (const k of kinds) assert.ok(k === TILE.OPEN || k === TILE.LIVE || k === TILE.AIR, 'only ants, air and the space inside: ' + k);
  assert.ok(n.tiles[AL.Nest.CH.QUEEN].length > 0 && n.tiles[AL.Nest.CH.NURSERY].length > 0, 'a queen chamber and a nursery');
  let wall = -1; for (let i = 0; i < n.n; i++) if (n.kind[i] === TILE.LIVE) { wall = i; break; }
  assert.ok(!AL.Nest.mark(n, wall % n.cols, (wall / n.cols) | 0), 'the living wall can\'t be dug');
  const hw = n.bivouac.hw, open = n.tiles[AL.Nest.CH.NURSERY].length;
  assert.ok(AL.Nest.shapeBivouac(n, 500, false), 'a bigger colony, a bigger cluster');
  assert.ok(n.bivouac.hw > hw && n.tiles[AL.Nest.CH.NURSERY].length > open);
  // a fire colony still digs as before
  const f = AL.Sim.createWorld({ seed: 5, species: 'fire', colonies: 2 });
  assert.ok(!f.player.nest.bivouac && f.player.nest.kind.some(k => k === TILE.CLAY));
});

test('the brood clock: settled while the batch is laid, wandering while the larvae are hungry, settled again', () => {
  const w = AL.Sim.createWorld({ seed: 5, species: 'army', colonies: 2 }), c = w.player;
  const log = [];
  const off = [AL.on('bivPhase', (ww, d) => { if (ww === w && d.col === 0) log.push([d.phase, Math.round(ww.t)]); }), AL.on('bivBatch', (ww, d) => { if (ww === w && d.col === 0) log.push(['batch', d.n]); })];
  assert.equal(c.biv.phase, 'statary');
  run(w, 5);
  assert.ok(B.banks(w, c), 'before the batch the queen saves her eggs');
  run(w, B.TUNE.STAT_MAX + B.TUNE.NOM_MAX + 60);
  off.forEach(f => f());
  const phases = log.filter(e => e[0] !== 'batch').map(e => e[0]);
  assert.ok(phases.indexOf('nomadic') >= 0 && phases.indexOf('statary') > phases.indexOf('nomadic'), 'settle -> wander -> settle: ' + JSON.stringify(log));
  assert.ok(log.some(e => e[0] === 'batch' && e[1] >= 5), 'a batch of eggs: ' + JSON.stringify(log));
  // marching is only for the wandering phase
  for (let k = 0; k < 150 && c.biv.march; k++) run(w, 1);
  const st = B.state(c); st.phase = 'statary';
  const r = B.canMarch(w, c);
  assert.ok(!r.ok && r.settled, r.why);
});

test('the player\'s march: the column streams along the route with brood and queen, a new bivouac forms at the end', () => {
  const w = AL.Sim.createWorld({ seed: 5, species: 'army', colonies: 2, rivalSpecies: ['honeypot'] }), c = w.player, A = w.ants;   // (a quiet neighbour)
  noRaids(w); run(w, 10); wander(w, c);
  const from = { x: c.x, y: c.y }, to = { x: c.x + 700, y: c.y - 300 };
  const eggs0 = c.brood.filter(b => b.stage === 0).length;
  const r = B.start(w, c, to.x, to.y);
  assert.ok(r.ok, r.why);
  assert.ok(r.march.dur >= B.TUNE.DUR[0] && r.march.dur <= B.TUNE.DUR[1], 'a night\'s move: ' + r.march.dur);
  assert.ok(r.march.column >= 8, 'ants left the bivouac for the column: ' + r.march.column);
  assert.ok(r.march.carriers.size > 0, 'brood is carried');
  assert.equal(count(w, i => A.state[i] === ST.B_MARCH && A.carry[i] === K.BROOD), r.march.carriers.size);
  assert.deepEqual([c.x, c.y], [from.x, from.y]);
  run(w, r.march.dur * 0.5);
  const mid = Math.hypot(c.x - from.x, c.y - from.y), all = Math.hypot(to.x - from.x, to.y - from.y);
  assert.ok(mid > all * 0.15 && mid < all * 0.75, 'half way the queen is part way along: ' + Math.round(mid) + ' of ' + Math.round(all));
  assert.ok(c.brood.filter(b => b.stage === 0).length <= eggs0, 'no eggs laid on the march');
  run(w, r.march.dur * 0.9);
  assert.equal(c.biv.march, null);
  assert.deepEqual([Math.round(c.x), Math.round(c.y)], [Math.round(to.x), Math.round(to.y)]);
  assert.equal(count(w, i => A.state[i] === ST.B_MARCH), 0, 'everyone is in');
  assert.equal(count(w, i => A.carry[i] === K.BROOD), 0);
  assert.ok(count(w, i => A.col[i] === 0 && A.layer[i] === L.NEST) >= 10, 'the bivouac view has its ants back');
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === L.NEST && A.nest[i] === 0) assert.equal(c.nest.kind[AL.Nest.tileOf(c.nest, A.x[i], A.y[i])], TILE.OPEN, 'nobody inside a wall');
  // a short rest before the next move (still wandering)
  B.state(c).phase = 'nomadic'; B.state(c).since = w.t; B.state(c).end = w.t;
  const again = B.start(w, c, c.x - 500, c.y);
  assert.ok(!again.ok && /before it moves again/.test(again.why), again.why);
  run(w, B.TUNE.MOVE_MIN + 1);
  assert.ok(B.canMarch(w, c).ok);
});

test('marching is exposed: a killed brood carrier loses its brood', () => {
  const w = AL.Sim.createWorld({ seed: 7, species: 'army', colonies: 2 }), c = w.player;
  noRaids(w); run(w, 5); wander(w, c);
  const r = B.start(w, c, c.x + 600, c.y);
  assert.ok(r.ok, r.why);
  const brood0 = c.brood.length;
  let killed = 0;
  for (const [, i] of r.march.carriers) { if (killed >= 3) break; AL.Combat.killAnt(w, i, 'fight'); killed++; }
  run(w, 2);
  assert.equal(r.march.lost, killed);
  assert.ok(c.brood.length <= brood0 - killed + 1, 'brood went with them: ' + brood0 + ' -> ' + c.brood.length);
});

test('bad march targets are refused', () => {
  const w = AL.Sim.createWorld({ seed: 5, species: 'army', colonies: 2 }), c = w.player;
  wander(w, c);
  assert.ok(!B.start(w, c, c.x + 40, c.y).ok, 'too close');
  const fw = AL.Sim.createWorld({ seed: 5, species: 'fire', colonies: 2 });
  assert.ok(!B.start(fw, fw.player, fw.player.x + 600, fw.player.y).ok, 'only army ants march');
  const r = B.start(w, c, c.x + 2600, c.y - 50);
  if (r.ok) assert.ok(Math.hypot(r.march.to.x - r.march.from.x, r.march.to.y - r.march.from.y) <= B.TUNE.MAX_D + 1);
});

test('army colonies move on their own in the wandering phase, deterministically', () => {
  const marches = seed => {
    const w = AL.Sim.createWorld({ seed, colonies: 3, rivalSpecies: ['army', 'fire'] });
    const r = w.colonies.find(c => !c.isPlayer && c.sp.nomad);
    assert.ok(r, 'an army rival');
    const log = [];
    const off = AL.on('march', (ww, d) => { if (ww === w) log.push([d.col, Math.round(d.x), Math.round(d.y), Math.round(ww.t)]); });
    run(w, B.TUNE.STAT_MAX + B.TUNE.NOM_MAX);
    off();
    return { log, r };
  };
  const a = marches(11), b = marches(11);
  assert.ok(a.log.length >= 1, 'the rival moved at least once');
  assert.deepEqual(a.log, b.log, 'same seed, same moves');
  assert.ok(a.r.biv.marches >= 1);
});

test('swarm raids sweep the litter and carry the catch home', () => {
  const w = AL.Sim.createWorld({ seed: 5, species: 'army', colonies: 2 }), c = w.player, A = w.ants, S = AL.Swarm;
  noRaids(w); run(w, 5);
  const p0 = c.stats.foodIn;
  const r = S.start(w, c, c.x + 500, c.y + 100);
  assert.ok(r.ok, r.why);
  assert.ok(r.n >= S.TUNE.MIN * 0.5 && count(w, i => A.state[i] === ST.B_SWARM) === r.n);
  assert.ok(!S.start(w, c).ok, 'one raid at a time');
  const here = { x: c.x + 250, y: c.y + 50 }, prey0 = S.preyAt(w, here.x, here.y);
  run(w, 40);
  assert.ok(r.swarm.caught > 0, 'the front caught something: ' + r.swarm.caught);
  assert.ok(count(w, i => A.col[i] === 0 && A.state[i] === ST.RETURN && A.carry[i] === K.PROTEIN) > 0 || c.stats.foodIn > p0, 'raiders ferry prey home');
  assert.ok(S.preyAt(w, here.x, here.y) < prey0, 'the raided ground is stripped');
  run(w, 80);
  assert.notEqual(c.swarm, r.swarm, 'the raid is over');
  if (!c.swarm) assert.equal(count(w, i => A.state[i] === ST.B_SWARM), 0);
  assert.ok(c.stats.foodIn > p0, 'prey came home');
  // aiming: a person's aim stands for the next raid
  const a = S.aim(w, c, c.x - 400, c.y);
  assert.ok(a.ok);
  if (c.swarm) assert.ok(Math.cos(c.swarm.a) < -0.5, 'heading where they aimed');
});

test('army colonies split instead of flying, and dig no raid tunnels', () => {
  const w = AL.Sim.createWorld({ seed: 5, species: 'army', colonies: 2 }), c = w.player, X = AL.Expansion, A = w.ants;
  run(w, 2);
  assert.ok(!X.canRaise(w, 0, 'male').ok, 'no males');
  assert.ok(!X.canResearch(w, 0).ok && !X.tunnelPlan(w, 0, 1, 0).ok, 'no tunnels');
  // a big colony with a new queen ready
  for (let k = 0; k < 140; k++) { const i = A.spawn(0, C.WORKER, L.NEST, c.nest.entrance.c * c.nest.tile + 5, 80, 0, w.R); A.state[i] = ST.N_IDLE; A.nest[i] = 0; }
  run(w, 1.2);
  c.royal.queens = 1;
  const site = { x: c.x + 600, y: c.y };
  assert.ok(X.siteCheck(w, 0, site.x, site.y).ok);
  const r = X.launch(w, 0, site.x, site.y);
  assert.ok(r && r.split && r.n >= 20, 'a share of the colony follows her: ' + (r && r.n));
  assert.equal(w.exp.flights.length, 0, 'no mating flight');
  assert.equal(c.satellites.length, 1);
  run(w, X.CFG.split.foundT + 2);
  assert.equal(c.satellites[0].state, 'active', 'the second bivouac is up');
});
