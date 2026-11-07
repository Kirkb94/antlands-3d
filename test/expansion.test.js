const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
const X = require('../public/expansion.js');
require('../public/victory.js');
const C = AL.CASTE, ST = AL.ST, K = AL.CARRY;

function world(opts) { return AL.Sim.createWorld(Object.assign({ seed: 7, keypointsAt: 1e9 }, opts || {})); }
function run(w, secs) { const n = Math.round(secs * 30); for (let k = 0; k < n; k++) AL.Sim.step(w); }
// grow a colony to n ants outside (the core has no brood without the nest model)
function grow(w, ci, n, caste) {
  const c = w.colonies[ci];
  for (let k = 0; k < n; k++) { const a = w.R() * AL.TAU; w.ants.spawn(ci, caste == null ? C.FORAGER : caste, 0, c.x + Math.cos(a) * 30, c.y + Math.sin(a) * 30, a, w.R); }
  AL.Sim.countPop(w);
}
function rich(c) { c.stock.protein = 500; c.stock.sugar = 500; }
const events = (type) => { const got = []; const off = AL.on(type, (w, d) => got.push(d)); got.off = off; return got; };

test('the expansion and victory systems join every normal world, not the benchmark', () => {
  const w = world();
  assert.deepEqual(w.systems.map(s => s.id).filter(id => id === 'expansion' || id === 'victory'), ['expansion', 'victory']);
  assert.ok(w.player.queen.alive && w.player.queen.hp > 0 && w.player.queen.hp === w.player.queen.maxHp);
  assert.deepEqual(w.player.satellites, []);
  const b = AL.Sim.createWorld({ seed: 1, bench: 50, benchOnly: true });
  assert.ok(!b.exp);
});

test('winged queens are a late caste: they need a big colony, cost protein and take time', () => {
  const w = world(), c = w.player;
  rich(c);
  assert.equal(X.canRaise(w, 0, 'queen').ok, false, 'locked early');
  grow(w, 0, 40);
  assert.ok(X.canRaise(w, 0, 'queen').ok);
  const p0 = c.stock.protein;
  assert.ok(X.orderRoyal(w, 0, 'queen'));
  assert.equal(c.stock.protein, p0 - X.CFG.royal.queen.protein);
  const got = events('royalEmerged');
  run(w, X.CFG.royal.queen.time * 0.5);
  assert.equal(c.royal.queens, 0, 'still a pupa halfway');
  run(w, X.CFG.royal.queen.time * 0.6);
  assert.equal(c.royal.queens, 1);
  assert.equal(c.expStats.queensRaised, 1);
  assert.equal(got.length, 1); got.off();
  c.stock.protein = 3;
  assert.match(X.canRaise(w, 0, 'male').why, /protein/);
});

test('a winged queen flies out, lands anywhere and founds a satellite that raises its own ants', () => {
  const w = world(), c = w.player;
  rich(c); c.royal.queens = 1; c.royal.males = 1;
  const tx = c.x + 700, ty = c.y - 300;
  assert.ok(X.siteCheck(w, 0, tx, ty).ok);
  assert.equal(X.siteCheck(w, 0, c.x + 40, c.y).ok, false, 'not on top of a nest');
  const took = events('royalTakeoff'), founded = events('satelliteFounded');
  const f = X.launch(w, 0, tx, ty);
  assert.ok(f); assert.equal(c.royal.queens, 0); assert.equal(f.males, 1);
  assert.equal(took.length, 1);
  let maxAlt = 0, phases = new Set();
  for (let k = 0; k < 30 * 12 && w.exp.flights.length; k++) { AL.Sim.step(w); if (w.exp.flights[0]) { maxAlt = Math.max(maxAlt, w.exp.flights[0].alt); phases.add(w.exp.flights[0].phase); } }
  assert.deepEqual([...phases], ['emerge', 'takeoff', 'cruise', 'descend']);
  assert.ok(maxAlt > 0.9);
  assert.equal(c.satellites.length, 1);
  const s = c.satellites[0];
  assert.equal(s.state, 'founding'); assert.equal(s.x, tx);
  assert.ok(Math.abs(s.foundT - X.CFG.sat.foundT * 0.8) < 1e-9, 'a male escort speeds founding up');
  run(w, s.foundT + 1.5);
  assert.equal(s.state, 'active');
  assert.equal(founded.length, 1);
  assert.equal(c.expStats.satFounded, 1);
  const kids0 = s.kids.length / 2;
  assert.equal(kids0, X.CFG.sat.nanitics);
  run(w, 40);
  const kids1 = s.kids.length / 2;
  assert.ok(kids1 > kids0, 'the satellite keeps raising ants');
  // brood is paid from the shared stockpile: when it can't pay, no new ants
  const cost = X.CFG.sat.cost; X.CFG.sat.cost = { protein: 1e9, sugar: 0 };
  const born = s.born;
  run(w, 30);
  X.CFG.sat.cost = cost;
  assert.equal(s.born, born, 'starved satellite stops laying');
  took.off(); founded.off();
});

test('satellites share the stockpile: a forager delivers at the nearest entrance', () => {
  const w = world(), c = w.player;
  const s = { id: 99, col: 0, x: c.x + 900, y: c.y - 200, hp: 100, maxHp: 100, queen: { alive: true, hp: 100, maxHp: 100 }, state: 'active', soil: 10, moundR: 20, terrR: 250, kids: [], born: 0, age: 0, broodAcc: 0, underAttack: 0 };
  c.satellites.push(s);
  assert.equal(X.homeOf(c, s.x + 50, s.y), s);
  assert.equal(X.homeOf(c, c.x + 50, c.y), c);
  // a loaded forager 120 units from the satellite, far from the capital
  const i = w.ants.spawn(0, C.FORAGER, 0, s.x + 120, s.y, Math.PI, w.R);
  w.ants.state[i] = ST.RETURN; w.ants.carry[i] = K.SUGAR; w.ants.str[i] = 1;
  const in0 = c.stats.foodIn, got = events('foodDelivered');
  run(w, 8);
  assert.ok(c.stats.foodIn >= in0 + 1);
  assert.ok(got.some(d => d.sat === 99)); got.off();
  assert.equal(X.territoryOwner(w, s.x + 100, s.y), 0);
  assert.equal(X.territoryOwner(w, w.colonies[1].x, w.colonies[1].y), 1);
});

test('satellites can be raided and destroyed; the raider gets the credit', () => {
  const w = world(), c = w.player, r = w.colonies[1];
  c.royal.queens = 1;
  X.launch(w, 0, c.x + 800, c.y - 500);
  run(w, 12); run(w, X.CFG.sat.foundT + 1);
  const s = c.satellites[0]; assert.equal(s.state, 'active');
  for (let i = 0; i < w.ants.high; i++) if (w.ants.col[i] === 0) w.ants.kill(i);   // defenders gone
  const lost = events('satelliteLost'), warn = events('nestUnderAttack');
  for (let k = 0; k < 12; k++) { const a = k / 12 * AL.TAU; const i = w.ants.spawn(1, C.SOLDIER, 0, s.x + Math.cos(a) * 20, s.y + Math.sin(a) * 20, a, w.R); w.ants.state[i] = ST.X_GARRISON; w.ants.tx[i] = s.x; w.ants.ty[i] = s.y; w.ants.str[i] = 30; w.ants.timer[i] = 300; }
  run(w, 60);
  assert.equal(s.state, 'ruin');
  assert.equal(lost.length, 1); assert.equal(lost[0].by, 1);
  assert.ok(warn.length >= 1);
  assert.equal(r.expStats.nestsRazed, 1);
  assert.equal(c.expStats.satLost, 1);
  run(w, X.CFG.sat.ruinTime + 2);
  assert.equal(c.satellites.length, 0, 'ruins crumble away');
  lost.off(); warn.off();
});

test('queen death: a satellite queen takes over and her nest becomes the capital', () => {
  const w = world(), c = w.player;
  c.royal.queens = 1;
  X.launch(w, 0, c.x + 900, c.y - 400);
  run(w, 12); run(w, X.CFG.sat.foundT + 1);
  const s = c.satellites[0], old = { x: c.x, y: c.y };
  const tk = events('queenTakeover');
  // the core (M3) reports the capital's queen dying
  const d = { col: 0, colony: c };
  c.queen.alive = false; c.queen.hp = 0;
  AL.emit(w, 'queenDied', d);
  assert.equal(d.handled, true, 'default game over suppressed');
  assert.equal(tk.length, 1);
  assert.ok(c.queen.alive);
  assert.equal(c.x, s.x); assert.equal(c.y, s.y);
  assert.ok(c.satellites.some(o => o.state === 'orphan' && o.x === old.x), 'old capital lives on queenless');
  assert.ok(!c.out); assert.equal(c.expStats.takeovers, 1);
  run(w, 2);
  assert.equal(w.over, null);
  tk.off();
});

test('queen death with no satellite queen: the colony is out, fights on briefly, then fades', () => {
  const w = world(), r = w.colonies[1];
  const outs = events('colonyOut'), over = events('gameOver');
  X.hurtQueen(w, 1, null, 9999, 0);
  assert.ok(r.out);
  assert.equal(outs.length, 1);
  run(w, 2);
  assert.equal(over.length, 1);
  assert.equal(w.over.winner, 0);
  assert.match(w.over.reason, /rival queen/i);
  assert.ok(w.over.summary && w.over.summary.rows.length === 2);
  const n0 = r.pop.reduce((a, b) => a + b, 0);
  assert.ok(n0 > 30, 'workers still around right after');
  run(w, X.CFG.out.fadeDelay + 120);   // 8%/s fade: a straggler can outlast one minute
  assert.equal(r.pop.reduce((a, b) => a + b, 0), 0);
  assert.equal(r.alive, false);
  outs.off(); over.off();
});

test('a queen in flight keeps the colony alive and takes over when she lands', () => {
  const w = world(), c = w.player;
  c.royal.queens = 1;
  X.launch(w, 0, c.x + 600, c.y - 600);
  run(w, 1);
  X.hurtQueen(w, 0, null, 9999, 1);
  assert.ok(!c.out && c.interregnum);
  run(w, 14);
  assert.ok(c.queen.alive, 'the landed queen took over');
  assert.ok(!c.interregnum && !c.out);
  assert.equal(w.over, null);
});

test('raid tunnels: research, dig under the map, tremor warning, then the party bursts out at the rival nest', () => {
  const w = world(), c = w.player, r = w.colonies[1];
  rich(c); grow(w, 0, 80, C.WORKER); grow(w, 0, 12, C.SOLDIER);
  assert.match(X.tunnelPlan(w, 0, 1, 0).why, /Research/);
  // deep tunnelling is a late node of the research tree (research.js): it needs the bigger nursery first
  assert.match(X.canResearch(w, 0).why, /Needs bigger nursery/);
  AL.Research.grant(w, 0, 'jelly'); AL.Research.grant(w, 0, 'nursery');
  assert.ok(X.canResearch(w, 0).ok);
  assert.ok(X.research(w, 0));
  run(w, X.CFG.tunnel.research.time + 1);
  assert.equal(c.research.tunnel, 1);
  // too far from the capital: found a satellite closer to the rival first
  X.CFG.tunnel.maxLen = 1400;
  assert.match(X.tunnelPlan(w, 0, 1, 0).why, /far/);
  c.royal.queens = 1; X.launch(w, 0, r.x - 900, r.y + 500); run(w, 14); run(w, X.CFG.sat.foundT + 1);
  X.CFG.tunnel.maxLen = 2200;
  const plan = X.tunnelPlan(w, 0, 1, 0);
  assert.ok(plan.ok, plan.why);
  assert.equal(plan.from, c.satellites[0], 'digs from the nearest own entrance');
  const ants0 = w.ants.count, trem = events('tunnelTremor'), br = events('tunnelBreach');
  const t = X.orderTunnel(w, 0, 1, 0);
  assert.ok(t);
  assert.equal(w.ants.count, ants0 - t.crew.length, 'the crew went underground');
  assert.ok(t.crew.filter(k => k === C.SOLDIER).length >= 8, 'fighters join the party');
  run(w, t.len / X.CFG.tunnel.speed + 3);
  assert.equal(t.state, 'done');
  assert.equal(trem.length, 1); assert.equal(trem[0].target, 1);
  assert.equal(br.length, 1); assert.equal(br[0].handled, false);
  let near = 0;
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.col[i] === 0 && AL.dist2(w.ants.x[i], w.ants.y[i], r.x, r.y) < 120 * 120) near++;
  assert.ok(near >= t.crew.length * 0.8, 'raiders hold the rival entrance');
  assert.ok(r.mainHp < r.mainMaxHp);
  trem.off(); br.off();
});

test('raid tunnels can hand the breach to the nest model through hooks.breach', () => {
  const w = world(), c = w.player;
  rich(c); grow(w, 0, 40, C.SOLDIER); c.research.tunnel = 1;
  let got = null; X.hooks.breach = (world, t, crew) => { got = { t, crew }; return true; };
  X.CFG.tunnel.maxLen = 5000;
  const t = X.orderTunnel(w, 0, 1, 0);
  run(w, t.len / X.CFG.tunnel.speed + 3);
  X.hooks.breach = null; X.CFG.tunnel.maxLen = 2200;
  assert.ok(got && got.crew.length === t.crew.length);
});

test('planBreach digs the cheapest way to the queen chamber and goes around rock', () => {
  // 12 x 8 grid: soil everywhere, a rock wall at column 6 except one gap at row 6, queen at (9, 3)
  const cols = 12, rows = 8;
  const tile = (c, r) => (c === 6 && r !== 6 ? 2 : (c >= 8 && r >= 2 && r <= 4) ? 0 : 1);
  const p = X.planBreach({ cols, rows, tile, queen: { c: 9, r: 3 } }, -1);
  assert.ok(p);
  assert.deepEqual(p.path[p.path.length - 1], { c: 9, r: 3 });
  assert.equal(p.path[0].c, 0);
  assert.ok(p.path.every(q => tile(q.c, q.r) !== 2), 'never through rock');
  assert.ok(p.path.some(q => q.c === 6 && q.r === 6), 'through the gap');
  assert.ok(p.dig.length > 0 && p.dig.every(q => tile(q.c, q.r) === 1));
  // no gap: no way in
  assert.equal(X.planBreach({ cols, rows, tile: (c, r) => (c === 6 ? 2 : 1), queen: { c: 9, r: 3 } }, -1), null);
  // dig-multiplier form (e.g. the Founding stage's soil kinds via gridFromSoil)
  const q = X.planBreach({ cols, rows, dig: (c, r) => (c === 6 && r < 7 ? Infinity : 1), queen: { c: 9, r: 3 } }, -1);
  assert.ok(q.path.some(t => t.c === 6 && t.r === 7));
});

test('rally / garrison sends idle fighters first and they hold the spot', () => {
  const w = world(), c = w.player;
  grow(w, 0, 5, C.SOLDIER);
  const x = c.x + 400, y = c.y - 100;
  const n = X.garrison(w, 0, x, y, 40, 8, 120);
  assert.equal(n, 8);
  let sold = 0; for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] === ST.X_GARRISON && w.ants.caste[i] === C.SOLDIER) sold++;
  assert.equal(sold, 5);
  run(w, 30);
  let inside = 0;
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] === ST.X_GARRISON && AL.dist2(w.ants.x[i], w.ants.y[i], x, y) < 70 * 70) inside++;
  assert.ok(inside >= 6, 'garrison arrived: ' + inside);
});

test('rival AI raises winged queens late and expands to satellites on its own', () => {
  const w = world(), r = w.colonies[1];
  rich(r); grow(w, 1, 80);
  run(w, 4 * 3);
  assert.ok(r.royal.queue.length || r.royal.queens, 'ordered a winged queen');
  run(w, X.CFG.royal.queen.time + 20 + X.CFG.sat.foundT);
  assert.ok(r.satellites.length >= 1, 'founded a satellite');
  const s = r.satellites[0];
  assert.ok(X.siteCheck(w, 0, s.x + 400, s.y).ok !== undefined);
  // it chose a sensible site: away from the player's capital
  assert.ok(Math.hypot(s.x - w.player.x, s.y - w.player.y) > 650);
  const pol = X.aiPolicy(w, 1, { rally: false });
  assert.ok(Array.isArray(pol.rally) && Array.isArray(pol.actions));
});

test('landing on a marked founding site gives the satellite that site\'s modifiers', () => {
  const w = world(), c = w.player;
  const site = { id: 'rock', name: 'Under the rock', x: c.x + 700, y: c.y - 300, r: 40, taken: -1 };
  w.surface.foundingSites = [site];
  const had = AL.Sites;
  AL.Sites = { siteAt: (sites, x, y, d) => sites.find(s => Math.hypot(s.x - x, s.y - y) < d) || null, modsFor: () => ({ defence: 1.5, warmth: 1.2 }) };
  c.royal.queens = 1;
  X.launch(w, 0, site.x + 20, site.y);
  run(w, 12);
  AL.Sites = had;
  const s = c.satellites[0];
  assert.equal(s.site, 'rock'); assert.equal(s.maxHp, Math.round(X.CFG.sat.hp * 1.5));
  assert.equal(site.taken, 0);
});

test('sim code never uses Math.random (seeded world.R only)', () => {
  for (const f of ['expansion.js', 'victory.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    assert.ok(!/Math\.random/.test(src), f);
    assert.ok(!/document|window\./.test(src.replace(/typeof window/g, '')), f + ' has no DOM');
  }
});

test('same seed, same expansion: deterministic', () => {
  const play = () => {
    const w = world({ seed: 11 }), r = w.colonies[1];
    rich(r); grow(w, 1, 80);
    run(w, 160);
    return JSON.stringify(r.satellites.map(s => [Math.round(s.x), Math.round(s.y), s.state]));
  };
  assert.equal(play(), play());
});
