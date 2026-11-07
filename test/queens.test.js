// Colony growth: extra laying queens for polygyne species (fire ants), succession to an extra queen,
// and the colony-size laying bonus for every species (life.js, ai.js; tuning in AL.TUNE.GROW / AL.TUNE.POLY).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'species.js', 'expansion.js', 'research.js', 'victory.js', 'cmd.js']) require('../public/' + f);
const C = AL.CASTE, ST = AL.ST, T = AL.TUNE;
AL.Expansion.CFG.aiAuto = false;

function world(opts) { return AL.Sim.createWorld(Object.assign({ seed: 5, keypointsAt: 1e9 }, opts || {})); }
function run(w, secs) { const n = Math.round(secs * 30); for (let k = 0; k < n; k++) AL.Sim.step(w); }
// eggs the player's queens lay in `secs` seconds, with stores kept full so only the queens set the pace
function eggsIn(w, secs, each) {
  let n = 0;
  const off = AL.on('eggLaid', (ww, d) => { if (ww === w && d.col === w.player.id) n++; });
  for (let s = 0; s < secs; s++) { const st = w.player.stock; st.sugar = 600; st.protein = 300; if (each) each(); run(w, 1); }
  off();
  return n;
}

test('a fire-ant colony keeps a winged queen at home: she lays in the queen chamber and the colony lays faster', () => {
  const w1 = world({ species: 'fire' }), w2 = world({ species: 'fire' }), c = w2.player;
  assert.ok(c.sp.polygyne > 1, 'fire ants are polygyne');
  assert.equal(AL.Life.queenCount(c), 1);
  c.royal.queens = 2;
  assert.ok(AL.Life.canAdopt(w2, c, 'royal').ok);
  assert.equal(AL.Cmd.exec(w2, 0, 'adoptQueen', {}), true);
  assert.equal(AL.Cmd.exec(w2, 0, 'adoptQueen', {}), true);
  assert.equal(c.royal.queens, 0, 'the winged queens were used');
  assert.equal(c.queens2.length, 2);
  assert.equal(AL.Life.queenCount(c), 3);
  const A = w2.ants;
  for (const x of c.queens2) {
    assert.equal(A.caste[x.i], C.QUEEN); assert.equal(A.state[x.i], ST.N_QUEEN); assert.equal(A.layer[x.i], AL.LAYER.NEST);
    assert.equal(c.nest.chamber[AL.Nest.tileOf(c.nest, A.x[x.i], A.y[x.i])], AL.Nest.CH.QUEEN, 'she lives in the queen chamber');
  }
  assert.equal(AL.Cmd.exec(w2, 0, 'adoptQueen', {}), false, 'no winged queen left to keep');
  const one = eggsIn(w1, 30), three = eggsIn(w2, 30);
  assert.ok(three > one * 1.5, 'three queens lay much faster: ' + one + ' vs ' + three);
  // the queen chamber has room for sp.polygyne queens at most
  c.royal.queens = 10;
  while (AL.Life.adoptQueen(w2, c, 'royal'));
  assert.equal(AL.Life.queenCount(c), c.sp.polygyne);
  assert.match(AL.Life.canAdopt(w2, c, 'royal').why, /full/);
});

test('the main queen dies with an extra queen alive: the extra queen takes over and the colony lives on', () => {
  const w = world({ species: 'fire' }), c = w.player, A = w.ants;
  c.royal.queens = 1; AL.Cmd.exec(w, 0, 'adoptQueen', {});
  const extra = c.queens2[0].i, old = c.queen.i;
  const died = [], promoted = [];
  const off1 = AL.on('queenDied', (ww, d) => { if (ww === w) died.push(d); }), off2 = AL.on('queenPromoted', (ww, d) => { if (ww === w) promoted.push(d); });
  AL.Combat.killAnt(w, old, 'fight');
  off1(); off2();
  assert.equal(promoted.length, 1); assert.equal(died.length, 0, 'no succession crisis');
  assert.ok(c.queen.alive); assert.equal(c.queen.i, extra);
  assert.equal(c.queens2.length, 0);
  assert.equal(A.caste[c.queen.i], C.QUEEN);
  assert.equal(AL.Expansion.queenAnt(w, c), extra, 'expansion sees her as the colony queen');
  const eggs = eggsIn(w, 20);
  assert.ok(eggs > 0, 'the new main queen lays');
  assert.equal(w.over, null); assert.ok(!c.out && c.alive);
  // ... and when she dies too with nobody left, the colony is lost as before
  AL.Combat.killAnt(w, c.queen.i, 'fight'); run(w, 2);
  assert.ok(!c.queen.alive);
});

test('raiders in the nest attack extra queens too', () => {
  const w = world({ species: 'fire' }), c = w.player, A = w.ants;
  c.royal.queens = 1; AL.Cmd.exec(w, 0, 'adoptQueen', {});
  const x = c.queens2[0].i;
  AL.Combat.killAnt(w, c.queen.i, 'fight');    // the extra queen is now the only one; kill her as a raider would
  assert.equal(c.queen.i, x);
  c.royal.queens = 1; AL.Cmd.exec(w, 0, 'adoptQueen', {});
  const y = c.queens2[0].i, hp0 = A.hp[y];
  // a raider standing next to the new extra queen (in the queen chamber) goes for the nearest queen: her
  const r = A.spawn(1, C.SOLDIER, AL.LAYER.NEST, A.x[y] + 3, A.y[y], 0, w.R);
  A.nest[r] = c.id; A.state[r] = ST.N_RAID; A.task[r] = AL.Nest.F.QUEEN; A.hp[r] = A.maxhp[r] = 1e6;
  for (let k = 0; k < 30 * 20 && A.state[y] && A.uid[y] === c.queens2[0].uid; k++) { A.hp[r] = 1e6; AL.Sim.step(w); }
  assert.ok(A.hp[y] < hp0 - 5 || !A.state[y] || A.caste[y] !== C.QUEEN, 'the extra queen was bitten');
  assert.ok(A.hp[r] < 1e6 || A.state[r] === ST.FIGHT, 'and she bites back');
});

test('single-queen species cannot keep extra queens', () => {
  for (const sp of ['leafcutter', 'carpenter', 'army', 'honeypot', 'harvester', 'slavemaker', 'bullet']) assert.ok(!AL.SPECIES[sp].polygyne, sp + ' is single-queen');
  const w = world({ species: 'leafcutter' }), c = w.player;
  c.royal.queens = 1;
  assert.equal(AL.Cmd.exec(w, 0, 'adoptQueen', {}), false);
  assert.equal(c.royal.queens, 1, 'the winged queen is still waiting');
  assert.ok(!c.queens2 || !c.queens2.length);
  assert.match(AL.Life.canAdopt(w, c, 'royal').why, /many queens/);
  w.t = 1e4;
  assert.equal(AL.Life.autoQueen(w, c, 5000), false, 'no automatic adoption either');
});

test('big polygyne colonies take in new queens by themselves now and then (player and rival)', () => {
  const w = world({ species: 'fire', colonies: 3, rivalSpecies: ['fire', 'leafcutter'] }), c = w.player, P = T.POLY;
  assert.equal(AL.Life.autoQueen(w, c, P.autoPop + 50), false, 'not this early');
  w.t = P.autoFirst + 1;
  assert.equal(AL.Life.autoQueen(w, c, P.autoPop - 1), false, 'not while small');
  assert.equal(AL.Life.autoQueen(w, c, P.autoPop + 50), true);
  assert.equal(AL.Life.autoQueen(w, c, P.autoPop + 50), false, 'one at a time: the next only after autoEvery s');
  w.t += P.autoEvery; assert.equal(AL.Life.autoQueen(w, c, P.autoPop + 50), true);
  assert.equal(c.queens2.length, 2);
  // rivals keep extra queens as a number in their abstract nest; one takes over when the main queen falls
  const fire = w.colonies[1], leaf = w.colonies[2];
  assert.equal(AL.Life.autoQueen(w, fire, P.autoPop + 50), true);
  assert.equal(fire.queenX, 1);
  assert.equal(AL.Life.autoQueen(w, leaf, P.autoPop + 50), false);
  fire.queen.hp = 0; fire.queen.alive = false;
  assert.ok(AL.Life.promoteQueen(w, fire));
  assert.ok(fire.queen.alive && fire.queen.hp > 0); assert.equal(fire.queenX, 0);
});

test('laying speeds up as the colony grows (every species; leafcutters at least as steeply as before)', () => {
  const S = AL.SPECIES, sb = AL.Life.sizeBonus;
  assert.equal(sb(S.fire, 0), 1);
  assert.ok(sb(S.fire, 350) > 1.3 && sb(S.carpenter, 350) > 1.3);
  assert.equal(sb(S.fire, 1e5), 1 + T.GROW.max, 'capped');
  for (const n of [0, 100, 220, 330, 1000, 5000]) assert.ok(sb(S.leafcutter, n) >= 1 + Math.min(1.5, n / 220) - 1e-9, 'leafcutters keep their old climb at ' + n);
  // in the sim: the same colony lays more with 700 more adults around
  const w1 = world({ species: 'carpenter' }), w2 = world({ species: 'carpenter' });
  for (let k = 0; k < 700; k++) w2.ants.spawn(0, C.FORAGER, AL.LAYER.SURFACE, w2.player.x + 30, w2.player.y + 30, 0, w2.R);
  AL.Sim.countPop(w2);
  const small = eggsIn(w1, 30), big = eggsIn(w2, 30);
  assert.ok(big > small * 1.4, 'bigger colony lays faster: ' + small + ' vs ' + big);
});

test('single-queen species: the size bonus keeps climbing past the old cap (the first ~250 adults unchanged)', () => {
  const S = AL.SPECIES, sb = AL.Life.sizeBonus, G = T.GROW, old = n => 1 + Math.min(G.max, n / G.per);
  for (const k of ['carpenter', 'honeypot', 'army', 'bullet']) {
    assert.ok(!S[k].polygyne, k + ' has one queen');
    for (const n of [0, 100, G.soloFrom]) assert.ok(Math.abs(sb(S[k], n) - old(n)) < 1e-9, k + ' unchanged at ' + n);
    assert.ok(sb(S[k], 600) > old(600) + 0.5, k + ' bigger at 600');
    assert.ok(sb(S[k], 1500) > 1 + G.max + 1, k + ' past the old cap');
    assert.equal(sb(S[k], 1e5), 1 + G.max + G.soloMax, 'capped');
  }
  assert.ok(sb(S.leafcutter, 1500) > 1 + G.fungusMax, 'leafcutters (one queen) climb past their fungus cap too');
  for (const n of [0, 350, 1000, 1e5]) assert.equal(sb(S.fire, n), old(n), 'polygyne fire ants unchanged at ' + n);
  // in the sim: a lone queen in a huge colony lays more than one egg a second
  const w = world({ species: 'carpenter' });
  for (let k = 0; k < 1200; k++) w.ants.spawn(0, C.FORAGER, AL.LAYER.SURFACE, w.player.x + 30, w.player.y + 30, 0, w.R);
  AL.Sim.countPop(w);
  w.player.brood.length = 0; w.player.cap.nursery = 400;
  const n = eggsIn(w, 20, () => { w.player.cap.nursery = 400; });
  assert.ok(n > 24, 'more than one egg a second: ' + n);
});

test('the auto egg mix keeps a few scouts (about 1 per 40 adults, at least 2 from 30 ants, capped)', () => {
  const sp = AL.SPECIES.carpenter;
  const col = (adults, scouts) => { const pop = new Array(AL.NCASTE).fill(0); pop[C.WORKER] = adults - scouts; pop[C.SCOUT] = scouts; return { sp, pop, brood: [], autoN: 0, eggQueue: [] }; };
  const plan = (c, n) => { const out = []; for (let k = 0; k < n; k++) out.push(AL.Life.autoCaste(c)); return out; };
  assert.ok(!plan(col(20, 0), 60).includes(C.SCOUT), 'a tiny colony lays no scouts');
  assert.ok(plan(col(40, 0), 60).includes(C.SCOUT), '40 adults, no scouts: lays some');
  assert.ok(!plan(col(40, 2), 60).includes(C.SCOUT), '2 is enough for 40 adults');
  const b = col(40, 0); b.brood = [{ caste: C.SCOUT, stage: 1 }, { caste: C.SCOUT, stage: 2 }];
  assert.ok(!plan(b, 60).includes(C.SCOUT), 'scouts still in the brood count');
  assert.ok(plan(col(400, 5), 60).includes(C.SCOUT), '400 adults want about 10');
  assert.ok(!plan(col(2000, 10), 60).includes(C.SCOUT), 'capped at 10');
  const p = plan(col(200, 0), 100), sc = p.filter(k => k === C.SCOUT).length;
  assert.ok(sc >= 5 && sc < 30, 'a minor share of the eggs: ' + sc);
  // nurses come first when the brood is short of them
  const c = col(200, 0); c.pop[C.SOLDIER] = 30; c.brood = new Array(80).fill({ stage: 0 });
  const q = plan(c, 60);
  assert.ok(q.filter(k => k === C.NURSE).length > q.filter(k => k === C.SCOUT).length, 'nurses before scouts');
});
