// Wildlife AI (world-creatures.js, eco-hunters.js): behaviour true to each creature, and no creature left standing
// stuck against a rock or a log. Deterministic fixtures: one creature, a few ants, a known spot.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'eco-hunters', 'swarm']) require('../public/' + f + '.js');
const WC = AL.WorldCreatures, H = AL.EcoHunters, C = AL.CASTE, ST = AL.ST;
const run = (w, secs, each) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) { AL.Sim.step(w); if (each) each(); } };
const mk = o => AL.Sim.createWorld(Object.assign({ seed: 3, colonies: 2, noFog: true, hunters: false, keypointsAt: 1e9 }, o || {}));
function spot(w, away) {
  const S = w.surface;
  for (let k = 0; k < 400; k++) {
    const x = 300 + ((k * 977) % (S.W - 600)), y = 300 + ((k * 571) % (S.H - 600));
    if (!AL.Surface.isBlocked(S, x, y) && w.colonies.every(c => Math.hypot(c.x - x, c.y - y) > (away || 500))) return { x, y };
  }
  throw new Error('no open spot');
}
function ant(w, x, y, a) { const A = w.ants, i = A.spawn(0, C.WORKER, 0, x, y, a || 0, w.R); A.state[i] = ST.WANDER; A.timer[i] = 0; return i; }
// a wall of blocked cells between a creature and its home (a log across the way)
function wall(w, x, y0, y1) { const S = w.surface; for (let y = y0; y <= y1; y += 4) AL.Surface.stampEllipse(S, S.blocked, x, y, 10, 10, 0, 0); }
test.beforeEach(() => { WC.TUNE_GRACE = 0; });
test.afterEach(() => { delete WC.TUNE_GRACE; });

test('a creature with a log between it and home walks round it instead of standing at the wall', () => {
  const w = mk(), p = spot(w);
  wall(w, p.x, p.y - 70, p.y + 70);
  const sp = WC.spawn(w, 'spider', p.x + 60, p.y, { state: 'return', food: 0.95 });
  sp.home = { x: p.x - 60, y: p.y };
  run(w, 25);
  assert.ok(Math.hypot(sp.x - sp.home.x, sp.y - sp.home.y) < 8, 'got home: ' + sp.x.toFixed(0) + ',' + sp.y.toFixed(0) + ' state ' + sp.state);
});

test('a hungry wolf spider goes prowling at night; by day she waits at her lair', () => {
  const day = mk(), p = spot(day);
  AL.World.setTime(day, { timeOfDay: 0.5 });
  const s1 = WC.spawn(day, 'spider', p.x, p.y, { state: 'lurk', food: 0.2 });
  let prowled = false; run(day, 30, () => { if (s1.state === 'prowl') prowled = true; });
  assert.ok(!prowled, 'no prowling by day');
  const night = mk(); AL.World.setTime(night, { timeOfDay: 0.97 });
  const s2 = WC.spawn(night, 'spider', p.x, p.y, { state: 'lurk', food: 0.2 });
  run(night, 60, () => { if (s2.state === 'prowl') prowled = true; });
  assert.ok(night.env.night > 0.5, 'still night');
  assert.ok(prowled, 'she prowled after dark');
});

test("a wolf spider's dash is short: an ant she can't catch gets away and she rests", () => {
  const w = mk(), p = spot(w), A = w.ants;
  const sp = WC.spawn(w, 'spider', p.x, p.y, { state: 'stalk', food: 0.3 });
  const i = ant(w, p.x + 30, p.y, 0);
  sp.victim = i; sp.victimUid = A.uid[i]; sp.dash = WC.SPIDER.DASH_T - 0.05;   // at the end of her dash
  A.x[i] = p.x + 44;   // just out of reach
  run(w, 0.2, () => { A.x[i] = sp.x + 44; A.y[i] = sp.y; });
  assert.notEqual(sp.state, 'stalk'); assert.notEqual(sp.state, 'bite'); assert.ok(sp.rest > 0, 'resting before the next try');
});

test('a ladybug grabbed by ants clamps down under her shell before she flies', () => {
  const w = mk(), p = spot(w), dt = 1 / 30, LB = WC.BEHAVE.ladybug;
  const plant = { type: 'aphids', x: p.x, y: p.y, aphids: 30 }; w.surface.pois.push(plant);
  const lb = WC.spawn(w, 'ladybug', p.x, p.y, { state: 'eat', st: 60, flying: false, prey: true, plant });
  const tick = (secs, att) => { for (let k = 0; k < secs * 30; k++) { lb.attackers = att; LB(w, lb, dt); } };
  tick(0.5, 2);
  assert.equal(lb.state, 'eat'); assert.ok(lb.clamped && lb.armor >= 0.75, 'clamped: armour ' + lb.armor);
  tick(3.5, 2);
  assert.equal(lb.state, 'flyoff', 'then she flew');
  assert.equal(lb.armor, lb.def.armor, 'armour back to normal');
  // let go before she flies: she unclamps and goes on eating
  const lb2 = WC.spawn(w, 'ladybug', p.x + 30, p.y, { state: 'eat', st: 60, flying: false, prey: true, plant });
  for (let k = 0; k < 15; k++) { lb2.attackers = 1; LB(w, lb2, dt); }
  for (let k = 0; k < 15; k++) { lb2.attackers = 0; LB(w, lb2, dt); }
  assert.equal(lb2.state, 'eat'); assert.ok(!lb2.clamped && lb2.armor === lb2.def.armor);
});

test('a mobbed mantis hops to a nearby plant, never across the yard', () => {
  const w = mk(), p = spot(w);
  const near = { type: 'clover', x: p.x + 200, y: p.y }, far = { type: 'clover', x: p.x + 1500, y: p.y };
  w.surface.pois.push(near, far);
  const m = H.make(w, 'mantis', p.x, p.y, { state: 'perch', food: 0.5 });
  m.attackers = 9; m.hp = m.maxHp * 0.2;
  AL.WorldCreatures.BEHAVE.mantis(w, m, 1 / 30);
  assert.equal(m.state, 'fly'); assert.ok(Math.hypot(m.tx - p.x, m.ty - p.y) < 430, 'a short hop: ' + Math.round(Math.hypot(m.tx - p.x, m.ty - p.y)));
});

test('a ground beetle hunts ants after dark; by day only a starving one does', () => {
  for (const [night, food, want] of [[0, 0.5, false], [1, 0.5, true], [0, 0.1, true]]) {
    const w = mk(), p = spot(w);
    AL.World.setTime(w, { timeOfDay: night ? 0.97 : 0.5 });
    const b = WC.spawn(w, 'beetle', p.x, p.y, { state: 'wander', food });
    ant(w, p.x + 40, p.y);
    AL.Sim.step(w); b.food = food; b.state = 'wander';   // (the ant goes on the map's grid)
    assert.equal(H.beetleAnts(w, b), want, 'night ' + night + ' food ' + food);
  }
});

test('a centipede back from the hunt crawls into its nook under a log', () => {
  const w = mk(), p = spot(w);
  AL.Surface.stampEllipse(w.surface, w.surface.blocked, p.x, p.y, 16, 16, 0, 0);   // the log
  const c = H.make(w, 'centipede', p.x + 70, p.y, { state: 'return', food: 0.9 });
  c.home = { x: p.x, y: p.y };
  AL.World.setTime(w, { timeOfDay: 0.5 });
  run(w, 12);
  assert.equal(c.state, 'hide'); assert.ok(c.hidden);
});
