const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
const X = require('../public/expansion.js');
const V = require('../public/victory.js');
const C = AL.CASTE, ST = AL.ST;
X.CFG.aiAuto = false;   // these tests place every ant by hand

function world(opts) { return AL.Sim.createWorld(Object.assign({ seed: 7 }, opts || {})); }
function run(w, secs) { const n = Math.round(secs * 30); for (let k = 0; k < n; k++) AL.Sim.step(w); }
// park n ants of a colony on a key point (garrison state keeps them there)
function occupy(w, ci, p, n, caste) {
  for (let k = 0; k < n; k++) {
    const a = k / n * AL.TAU, i = w.ants.spawn(ci, caste == null ? C.SOLDIER : caste, 0, p.x + Math.cos(a) * p.r * 0.4, p.y + Math.sin(a) * p.r * 0.4, a, w.R);
    w.ants.state[i] = ST.X_GARRISON; w.ants.tx[i] = p.x; w.ants.ty[i] = p.y; w.ants.str[i] = p.r * 0.5; w.ants.timer[i] = 9999;
  }
}

test('three key points are picked from the map: the picnic spill, the shelter rock and an aphid plant', () => {
  const w = world();
  const pts = w.victory.points;
  assert.equal(pts.length, 3);
  assert.deepEqual(pts.map(p => p.kind).sort(), ['aphids', 'rock', 'spill']);
  for (const p of pts) assert.ok(!AL.Surface.isBlocked(w.surface, p.x, p.y), p.name + ' is on open ground');
  // fair-ish: total distance advantage small compared with the map size
  const d = (a, p) => Math.hypot(a.x - p.x, a.y - p.y);
  const bias = pts.reduce((s, p) => s + d(w.colonies[0], p) - d(w.colonies[1], p), 0);
  assert.ok(Math.abs(bias) < 900, 'bias ' + bias);
});

test('key points sleep until activeAt, then capture needs a clear majority', () => {
  const w = world({ keypointsAt: 20 }), [a, b] = w.victory.points;
  occupy(w, 0, a, 6);
  run(w, 10);
  assert.equal(a.owner, -1, 'asleep');
  assert.ok(a.pres[0] > 0, 'presence still counted for the HUD');
  const caps = []; const off = AL.on('pointCaptured', (ww, d) => caps.push(d));
  run(w, 40);
  assert.equal(a.owner, 0);
  assert.equal(caps.length, 1); off();
  // contested: equal forces freeze the point
  occupy(w, 0, b, 6); occupy(w, 1, b, 6);
  run(w, 20);
  assert.equal(b.owner, -1); assert.ok(b.contested);
});

test('an enemy majority neutralises then flips an owned point', () => {
  const w = world({ keypointsAt: 0 }), p = w.victory.points[0];
  occupy(w, 0, p, 5); run(w, 30);
  assert.equal(p.owner, 0);
  for (let i = 0; i < w.ants.high; i++) if (w.ants.col[i] === 0) w.ants.kill(i);
  occupy(w, 1, p, 12);
  const lost = []; const off = AL.on('pointLost', (ww, d) => lost.push(d));
  run(w, 40);
  assert.equal(lost.length, 1); assert.equal(lost[0].col, 0);
  assert.equal(p.owner, 1); off();
});

test('campaign rule (opts.keypointWin): holding most of the key points fills the hold meter and wins', () => {
  const w = world({ keypointsAt: 0, keypointWin: true }), pts = w.victory.points;
  w.victory.holdTime = 60;
  occupy(w, 0, pts[0], 8); occupy(w, 0, pts[1], 8);
  const over = []; const off = AL.on('gameOver', (ww, d) => over.push(d));
  run(w, 25);
  assert.ok(pts[0].owner === 0 && pts[1].owner === 0);
  const h = w.victory.hold[0];
  assert.ok(h > 0 && h < 60);
  run(w, 70);
  assert.ok(w.over); assert.equal(w.over.winner, 0);
  assert.match(w.over.reason, /You held the picnic spill and the shelter rock and filled your hold meter/);
  assert.equal(over.length, 1); off();
  // the summary has what the end screen shows
  const row = w.over.summary.rows[0];
  for (const k of ['peakPop', 'food', 'queensRaised', 'satellites', 'nestsRazed', 'hold']) assert.ok(k in row, k);
  assert.equal(w.over.summary.time, V.clock(w.over.t));
});

test('campaign rule: the rival can win by holding too (defeat)', () => {
  const w = world({ keypointsAt: 0, keypointWin: true }), pts = w.victory.points;
  w.victory.holdTime = 30;
  for (const p of pts) occupy(w, 1, p, 8);
  run(w, 60);
  assert.ok(w.over); assert.equal(w.over.winner, 1); assert.equal(w.over.win, false);
  assert.match(w.over.reason, /rival held/i);
});

test('elimination counts satellites: killing the capital queen is not enough', () => {
  const w = world({ keypointsAt: 1e9 }), r = w.colonies[1];
  // the rival has an active satellite far from its capital
  r.royal.queens = 1; X.launch(w, 1, r.x - 900, r.y + 700); run(w, 12); run(w, X.CFG.sat.foundT + 1);
  assert.equal(r.satellites[0].state, 'active');
  const sat = r.satellites[0];
  X.hurtQueen(w, 1, null, 9999, 0);
  run(w, 2);
  assert.equal(w.over, null, 'satellite queen took over');
  assert.equal(X.livingQueens(w, r), 1);
  // now kill her too
  X.hurtQueen(w, 1, null, 9999, 0);
  run(w, 2);
  assert.ok(w.over); assert.equal(w.over.winner, 0);
  assert.ok(r.out); assert.ok(sat);
});

test('losing your last queen is a defeat', () => {
  const w = world({ keypointsAt: 1e9 });
  X.hurtQueen(w, 0, null, 9999, 1);
  run(w, 2);
  assert.ok(w.over); assert.equal(w.over.win, false); assert.equal(w.over.winner, 1);
  assert.match(w.over.reason, /last queen/);
});

test('peak population is tracked for the summary', () => {
  const w = world({ keypointsAt: 1e9 }), c = w.player;
  for (let k = 0; k < 60; k++) w.ants.spawn(0, C.WORKER, 0, c.x, c.y, 0, w.R);
  run(w, 2.1);
  const peak = c.expStats.peakPop;
  assert.ok(peak >= 100);
  for (let i = 0; i < w.ants.high; i++) if (w.ants.col[i] === 0 && i % 2) w.ants.kill(i);
  run(w, 2);
  assert.equal(c.expStats.peakPop, peak, 'peak stays');
});

// ---- key points as food springs (the normal rule) ---------------------------------------------------------------
test('normal matches: holding every key point never wins; they are food springs instead', () => {
  const w = world({ keypointsAt: 0 }), pts = w.victory.points;
  assert.equal(w.victory.holdWin, false);
  for (const p of pts) occupy(w, 0, p, 8);
  run(w, 400);
  assert.equal(w.over, null, 'no hold win');
  for (const p of pts) assert.ok(p.srcs && p.srcs.length >= 1, p.name + ' has a spring');
  assert.ok(pts.some(p => p.srcs.some(f => f.kind === AL.CARRY.PROTEIN)), 'protein springs');
});

test('the springs are empty until the points wake, then refill, faster later in the match', () => {
  const w = world({ keypointsAt: 30 }), p = w.victory.points[0], f = p.srcs[0];
  run(w, 20);
  assert.ok(f.amount < 1, 'asleep: empty');
  run(w, 20);
  const early = f.amount; assert.ok(early > 1, 'awake: refilling (' + early.toFixed(1) + ')');
  f.amount = 0; run(w, 10); const rate0 = f.amount / 10;
  w.t += V.CFG.RICH_T; f.amount = 0; run(w, 10); const rate1 = f.amount / 10;
  assert.ok(rate1 > rate0 * 1.8, 'richer later: ' + rate0.toFixed(2) + ' -> ' + rate1.toFixed(2) + ' a second');
});

test('only the holder\'s ants can harvest a key point\'s spring', () => {
  const w = world({ keypointsAt: 0 }), A = w.ants;
  const p = w.victory.points.find(q => q.kind === 'rock') || w.victory.points[1], f = p.srcs[0];
  for (const q of w.victory.points) for (const g of q.srcs) g.spring = Object.assign({}, g.spring, { rate: 0 });   // (no refill: count what is taken)
  f.amount = f.max; w.surface.foodDirty = true;
  for (let k = 0; k < 3; k++) { const i = A.spawn(0, AL.CASTE.FORAGER, AL.LAYER.SURFACE, f.x + 3 + k, f.y, 0, w.R); A.state[i] = AL.ST.WANDER; }
  p.owner = -1; run(w, 2);
  assert.equal(f.amount, f.max, 'unheld: untouched');
  p.owner = 1; run(w, 2);
  assert.equal(f.amount, f.max, 'held by the rival: your ants leave it');
  p.owner = 0; run(w, 3);
  assert.ok(f.amount < f.max, 'yours: your foragers take from it (' + f.amount + ' of ' + f.max + ')');
});
