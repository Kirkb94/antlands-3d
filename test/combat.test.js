const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
for (const m of ['sim', 'life', 'combat', 'orders', 'ai', 'fog']) require('../public/' + m + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER;
const run = (w, secs) => { for (let k = 0; k < secs * 30; k++) AL.Sim.step(w); };
function arena() {
  const w = AL.Sim.createWorld({ seed: 4, flatGround: true });
  // clear the yard of everything but two fresh squads in an empty spot
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.layer[i] === L.SURFACE) w.ants.kill(i);
  w.colonies[1].ai.raidT = 1e9;
  return w;
}
const squad = (w, col, caste, n, x, y) => { const ids = []; for (let k = 0; k < n; k++) { const i = w.ants.spawn(col, caste, L.SURFACE, x + (k % 4) * 3, y + ((k / 4) | 0) * 3, col ? Math.PI : 0, w.R); w.ants.state[i] = ST.GUARD; w.ants.tx[i] = x; w.ants.ty[i] = y; w.ants.timer[i] = 999; ids.push([i, w.ants.uid[i]]); } return ids; };
const alive = (w, ids) => ids.filter(([i, u]) => w.ants.state[i] && w.ants.uid[i] === u).length;

test('numbers win: 12 workers beat 4 workers', () => {
  const w = arena();
  const a = squad(w, 0, C.WORKER, 12, 2000, 2700), b = squad(w, 1, C.WORKER, 4, 2010, 2700);
  run(w, 25);
  assert.equal(alive(w, b), 0, 'small squad wiped out');
  assert.ok(alive(w, a) >= 8, 'big squad mostly survives (' + alive(w, a) + ')');
});
test('soldiers are stronger than workers', () => {
  const w = arena();
  const s = squad(w, 0, C.SOLDIER, 4, 2000, 2700), k = squad(w, 1, C.WORKER, 8, 2010, 2700);
  run(w, 30);
  assert.equal(alive(w, k), 0);
  assert.ok(alive(w, s) >= 2);
});
test('dead ants become protein on the ground', () => {
  const w = arena(), n0 = w.surface.foods.filter(f => f.corpse && !f.gone).length;
  squad(w, 0, C.SOLDIER, 6, 2000, 2700); squad(w, 1, C.WORKER, 3, 2010, 2700);
  run(w, 15);
  assert.ok(w.surface.foods.filter(f => f.corpse && !f.gone).length > n0);
});
test('alarm brings soldiers out of the nest to the spot', () => {
  const w = AL.Sim.createWorld({ seed: 6 }), A = w.ants, c = w.player;
  for (let k = 0; k < 6; k++) { const [x, y] = AL.Nest.centre(w.nest, w.nest.tiles[AL.Nest.CH.QUEEN][k]); const i = A.spawn(0, C.SOLDIER, L.NEST, x, y, 0, w.R); A.timer[i] = 0.1; }
  AL.Orders.addAlarm(w, 0, c.x + 300, c.y - 200);
  run(w, 30);
  let near = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.caste[i] === C.SOLDIER && A.layer[i] === L.SURFACE && AL.dist2(A.x[i], A.y[i], c.x + 300, c.y - 200) < 90 * 90) near++;
  assert.ok(near >= 3, 'soldiers rallied (' + near + ')');
});
test('recruit pulls N ants out along the path', () => {
  const w = AL.Sim.createWorld({ seed: 6 }), c = w.player;
  const o = AL.Orders.addRecruit(w, 0, [{ x: c.x, y: c.y }, { x: c.x + 200, y: c.y - 100 }, { x: c.x + 400, y: c.y - 150 }], 8);
  run(w, 40);
  assert.equal(o.assigned, 8);
  assert.ok(o.arrived >= 5, 'most reached the end (' + o.arrived + ')');
});
test('the rival colony raids and its raiders break into the nest', () => {
  const w = AL.Sim.createWorld({ seed: 8 }), r = w.colonies[1];
  let broke = false; AL.on('breakIn', (ww, d) => { if (ww === w) broke = true; });
  r.inside[C.SOLDIER] += 20; r.ai.raidT = 1;
  AL.AI.discover(w, 1, 0);   // rivals only raid nests they have found (colonies stage)
  run(w, 160);
  assert.ok(r.ai.wave >= 1, 'a raid was launched');
  assert.ok(broke, 'raiders reached the nest');
});
test('breaking into a rival nest with enough ants kills its queen and wins', () => {
  const w = AL.Sim.createWorld({ seed: 8 }), r = w.colonies[1];
  r.inside.fill(0); r.inside[C.SOLDIER] = 5;
  for (let k = 0; k < 40; k++) { const i = w.ants.spawn(0, C.SOLDIER, L.SURFACE, r.x + 2, r.y + 2, 0, w.R); w.ants.state[i] = ST.GUARD; w.ants.tx[i] = r.x; w.ants.ty[i] = r.y; w.ants.timer[i] = 99; }
  run(w, 120);
  assert.equal(r.queen.alive, false);
  assert.ok(w.over && w.over.win, 'player wins');
});
test('fog hides what your ants cannot see; scent leaks past the edge', () => {
  const w = AL.Sim.createWorld({ seed: 8 }), f = w.fog, r = w.colonies[1];
  assert.ok(f.visibleAt(w.player.x, w.player.y));
  assert.ok(!f.visibleAt(r.x, r.y), 'rival nest starts hidden');
  const i = w.ants.spawn(0, C.SCOUT, L.SURFACE, r.x - 300, r.y + 60, 0, w.R); w.ants.state[i] = ST.GUARD; w.ants.tx[i] = r.x - 300; w.ants.ty[i] = r.y + 60; w.ants.timer[i] = 99;
  run(w, 1);
  assert.ok(f.scent.some(v => v > 0.05), 'enemies smelled before seen');
});
test('a recruit order can be cancelled: ants head home and nobody else is pulled out', () => {
  const w = AL.Sim.createWorld({ seed: 6 }), c = w.player, A = w.ants;
  const o = AL.Orders.addRecruit(w, 0, [{ x: c.x, y: c.y }, { x: c.x + 300, y: c.y - 100 }, { x: c.x + 600, y: c.y - 150 }], 30);
  run(w, 12);
  assert.ok(o.assigned > 0);
  const n = AL.Orders.cancelRecruit(w, 0, o.id);
  assert.ok(n > 0, 'some ants were recalled');
  assert.ok(!c.orders.includes(o), 'order removed');
  const assigned = o.assigned;
  run(w, 8);
  let walking = 0; for (let i = 0; i < A.high; i++) if (A.state[i] === ST.RECRUIT && A.str[i] === o.id) walking++;
  assert.equal(walking, 0, 'nobody still walks the path');
  assert.equal(o.assigned, assigned, 'no more ants pulled out');
});
test('finished recruit orders clean themselves up', () => {
  const w = AL.Sim.createWorld({ seed: 6 }), c = w.player;
  const o = AL.Orders.addRecruit(w, 0, [{ x: c.x, y: c.y }, { x: c.x + 150, y: c.y - 60 }], 4);
  run(w, 60);
  assert.ok(o.arrived >= 4 || o.done, 'order completed');
  assert.ok(!c.orders.includes(o), 'and was dropped');
});

// ---- combat stage: pins, flight, alarm, battles, sieges, raid parties, the stats hook ----
const near = (w, col, x, y, r, pred) => { const A = w.ants; let n = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col && A.layer[i] === L.SURFACE && AL.dist2(A.x[i], A.y[i], x, y) < r * r && (!pred || pred(i))) n++; return n; };
test('stats come from one place: caste x species x col.mods (research)', () => {
  const w = arena(), c = w.player, base = AL.Combat.stat(c, C.SOLDIER);
  assert.ok(Math.abs(base.dps - AL.CASTES[C.SOLDIER].dps * c.sp.dps) < 1e-9);
  c.mods = { dps: 2, castes: { soldier: { hp: 1.5 } } }; AL.Combat.refresh(c);
  const up = AL.Combat.stat(c, C.SOLDIER);
  assert.ok(Math.abs(up.dps - base.dps * 2) < 1e-9, 'colony dps mod');
  assert.ok(Math.abs(up.tough - base.tough * 1.5) < 1e-9, 'per-caste toughness mod');
  assert.ok(up.power > base.power * 2.9, 'power folds both in');
  assert.equal(AL.Combat.maxHp(c, C.WORKER), AL.CASTES[C.WORKER].hp * (c.sp.hp || 1));
});
test('numbers win locally: three workers pin a soldier and kill it', () => {
  let won = 0;
  for (const seed of [4, 5, 6, 7]) {
    const w = AL.Sim.createWorld({ seed }); for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.layer[i] === L.SURFACE) w.ants.kill(i);
    w.colonies[1].ai.raidT = 1e9;
    const s = squad(w, 1, C.SOLDIER, 1, 2010, 2700), k = squad(w, 0, C.WORKER, 3, 2000, 2700);
    run(w, 12);
    if (!alive(w, s) && alive(w, k) >= 1) won++;
  }
  assert.ok(won >= 3, 'workers won ' + won + ' of 4');
});
test('a forager meeting a stronger enemy group far from home runs for it', () => {
  const w = arena(), A = w.ants;
  const f = A.spawn(0, C.FORAGER, L.SURFACE, 2000, 2700, 0, w.R); A.state[f] = ST.WANDER; A.timer[f] = 0;
  squad(w, 1, C.WORKER, 6, 2032, 2700);   // close enough to smell, not yet on it
  let fled = false;
  for (let k = 0; k < 60 && !fled; k++) { AL.Sim.step(w); if (A.state[f] === ST.HOMING && A.cbFlee[f] > w.t) fled = true; }
  assert.ok(fled, 'the forager fled');
});
test('a fight is tracked as a battle, clicks for audio, and its alarm pulls nearby soldiers in', () => {
  const w = arena(), A = w.ants;
  let fights = 0; const off = AL.on('fight', (ww, d) => { if (ww === w && d.battle) fights++; });
  squad(w, 0, C.WORKER, 4, 2000, 2700); squad(w, 1, C.WORKER, 4, 2008, 2700);
  const idle = []; for (let k = 0; k < 4; k++) { const i = A.spawn(0, C.SOLDIER, L.SURFACE, 2000 - 110, 2700 + k * 8, 0, w.R); A.state[i] = ST.WANDER; A.timer[i] = 0; idle.push(i); }
  run(w, 2);
  assert.ok(w.cb.battles.length >= 1, 'battle tracked');
  assert.ok(fights > 0, 'fight events for sound');
  const came = idle.filter(i => A.state[i] === ST.RALLY || A.state[i] === ST.FIGHT || A.state[i] === ST.GUARD).length;
  assert.ok(came >= 2, 'soldiers answered the alarm (' + came + ')');
  off();
});
test('abstract siege: a big force breaks the defence and reaches the queen, a token force is wiped out', () => {
  const big = AL.Sim.createWorld({ seed: 8 }), r = big.colonies[1];
  r.inside.fill(0); r.inside[C.WORKER] = 50; r.inside[C.SOLDIER] = 6; r.siege[C.SOLDIER] = 45; r.siegeBy = 0;
  for (let s = 0; s < 120 && r.queen.alive; s++) AL.AI.siegeTick(big, r);
  assert.equal(r.queen.alive, false, 'queen killed');
  const small = AL.Sim.createWorld({ seed: 8 }), q = small.colonies[1];
  q.inside.fill(0); q.inside[C.WORKER] = 50; q.inside[C.SOLDIER] = 6; q.siege[C.SOLDIER] = 5; q.siegeBy = 0;
  let repelled = 0; const off = AL.on('siegeRepelled', ww => { if (ww === small) repelled++; });
  for (let s = 0; s < 120; s++) AL.AI.siegeTick(small, q);
  assert.ok(q.queen.alive && q.queen.hp === q.queen.maxHp, 'queen untouched');
  assert.ok(q.inside[C.WORKER] > 35, 'defence held (' + q.inside[C.WORKER].toFixed(1) + ' workers left)');
  assert.equal(repelled, 1, 'one repelled event');
  off();
});
test('a raid party cut down far below its size turns for home', () => {
  const w = AL.Sim.createWorld({ seed: 8 }), r = w.colonies[1], A = w.ants, p = w.player;
  const d = Math.hypot(p.x - r.x, p.y - r.y);
  r.ai.raid = { target: 0, n0: 20, t0: -30, ux: (p.x - r.x) / d, uy: (p.y - r.y) / d, front: 0, n: 20 }; r.ai.target = 0;
  const ids = []; for (let k = 0; k < 3; k++) { const i = A.spawn(1, C.SOLDIER, L.SURFACE, r.x + 300, r.y + 300 + k * 6, 0, w.R); A.state[i] = ST.RAID; ids.push(i); }
  let rep = null; const off = AL.on('raidRepelled', (ww, e) => { if (ww === w) rep = e; });
  AL.AI.raidParty(w, r);
  assert.ok(rep && rep.lost === 17, 'repelled event with losses');
  assert.ok(ids.every(i => A.state[i] === ST.HOMING), 'survivors head home');
  assert.equal(r.ai.raid, null);
  off();
});
test('the player is warned when losing a fight it cannot win', () => {
  const w = arena(); let warned = null;
  const off = AL.on('losingFight', (ww, d) => { if (ww === w) warned = d; });
  squad(w, 0, C.WORKER, 8, 2000, 2700); squad(w, 1, C.SOLDIER, 14, 2012, 2700);
  run(w, 12);
  assert.ok(warned && warned.lost >= 4 && warned.lost > warned.theirs * 2, 'losingFight emitted');
  off();
});
test('raiders fight at a held door before they get in', () => {
  const w = arena(), A = w.ants, p = w.player; p.recall = true;   // nobody else walks out meanwhile
  for (let k = 0; k < 6; k++) { const i = A.spawn(0, C.SOLDIER, L.SURFACE, p.x + (k - 3) * 6, p.y + 10, 0, w.R); A.state[i] = ST.GUARD; A.tx[i] = p.x; A.ty[i] = p.y; A.timer[i] = 99; }
  run(w, 0.5);
  assert.equal(AL.Combat.doorOpen(w, p), false, 'six guards on the mound hold the door');
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.layer[i] === L.SURFACE) A.kill(i);
  run(w, 0.5);
  assert.equal(AL.Combat.doorOpen(w, p), true, 'an empty mound is open');
});

test('a recruited ant that fights a creature on the way goes back to its path (regression: it crashed the sim)', () => {
  require('../public/world-creatures.js');
  const w = AL.Sim.createWorld({ seed: 4, noFog: true }), A = w.ants, c = w.player;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === L.SURFACE) A.kill(i);
  const pts = []; for (let k = 0; k <= 12; k++) pts.push({ x: c.x + k * 40, y: c.y - k * 10 });
  const o = AL.Orders.addRecruit(w, 0, pts, 4);
  const i = A.spawn(0, C.SOLDIER, L.SURFACE, c.x + 200, c.y - 50, 0, w.R);
  A.state[i] = ST.RECRUIT; A.str[i] = o.id; A.wp[i] = 5; A.timer[i] = 0;
  const cr = AL.WorldCreatures.spawn(w, 'caterpillar', A.x[i] + 8, A.y[i], { state: 'crawl' });
  A.prev[i] = ST.RECRUIT; A.state[i] = ST.FIGHT; A.tgt[i] = -1; A.tuid[i] = cr.id;
  run(w, 1);
  assert.ok(A.wp[i] >= 5, 'its waypoint is kept: ' + A.wp[i]);
  AL.WorldCreatures.remove(w, cr);
  run(w, 2);
  assert.equal(A.state[i], ST.RECRUIT, 'back on the path');
  A.wp[i] = -1; run(w, 1);   // (a bad waypoint index is repaired, not a crash)
  assert.ok(A.wp[i] >= 0);
});

test('a beetle resting against a log can still be bitten from the log side; one out of reach is given up (regression: ants bit the wood for ever)', () => {
  const WC = require('../public/world-creatures.js') && AL.WorldCreatures;
  const w = AL.Sim.createWorld({ seed: 4, noFog: true, flatGround: true }), A = w.ants, S = w.surface, cell = S.cell;
  for (const cr of S.creatures.slice()) WC.remove(w, cr);
  w.creatures.lairs.length = 0; w.creatures.birdT = 1e9; w.colonies[1].ai.raidT = 1e9;
  const block = (cx, cy) => { S.blocked[cy * S.gw + cx] = 1; };
  const fight = (i, cr) => { A.prev[i] = ST.WANDER; A.state[i] = ST.FIGHT; A.tgt[i] = -1; A.tuid[i] = cr.id; A.timer[i] = 0; };
  const gx = Math.floor(2000 / cell), gy = Math.floor(1500 / cell), x0 = gx * cell, y0 = gy * cell;
  for (let k = -3; k <= 3; k++) block(gx - 1, gy + k);   // a log just west of the beetle
  const b = WC.spawn(w, 'beetle', x0 + 2, y0 + cell / 2, { state: 'wander' }); b.tx = b.x; b.ty = b.y;
  const i = A.spawn(0, C.WORKER, L.SURFACE, x0 - 17, b.y, 0, w.R); fight(i, b);
  run(w, 4);
  assert.ok(b.hp < b.maxHp - 2, 'bitten across the edge of the log: ' + b.hp.toFixed(1) + ' / ' + b.maxHp);
  // walled in all round: the ant climbs over the wood and gets to it (ants climb rocks and logs: behavior.js)
  const hx = gx + 40, hy = gy;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 3) block(hx + dx, hy + dy);
  const b2 = WC.spawn(w, 'beetle', (hx + 0.5) * cell, (hy + 0.5) * cell, { state: 'wander' }); b2.tx = b2.x; b2.ty = b2.y;
  const j = A.spawn(0, C.WORKER, L.SURFACE, (hx - 4) * cell, (hy + 0.5) * cell, 0, w.R); fight(j, b2);
  for (let k = 0; k < A.high; k++) if (A.state[k] && k !== j && A.layer[k] === L.SURFACE && A.caste[k] !== C.QUEEN) A.kill(k);   // (only ant j is about: others wandering by bite it)
  run(w, 10);
  assert.ok(b2.hp < b2.maxHp, 'climbed in and bit it: ' + b2.hp.toFixed(1) + ' / ' + b2.maxHp);
});
