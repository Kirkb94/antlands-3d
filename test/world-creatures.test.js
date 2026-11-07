// World stage: neutral creatures (threats and prey), grappling, carcasses, the bird, termites.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
try { require('../public/nest.js'); require('../public/life.js'); } catch (e) { /* core without a nest model */ }
require('../public/world-time.js'); require('../public/world-poi.js'); require('../public/world-creatures.js'); require('../public/world-fog.js');
const ST = AL.ST, C = AL.CASTE, T = AL.TUNE, TICKS = s => Math.round(s / T.DT);
const run = (w, secs) => { for (let k = 0, n = TICKS(secs); k < n; k++) AL.Sim.step(w); };
const WC = AL.WorldCreatures;
WC.TUNE_GRACE = 0;   // (spiders leave ants alone for the first minutes of a match: tested on its own below)
// a quiet world: no spawner surprises, creatures placed by hand, at noon in spring
function quiet(seed) {
  const w = AL.Sim.createWorld({ seed: seed || 21, fog: false });
  for (const cr of w.surface.creatures.slice()) WC.remove(w, cr);
  w.creatures.lairs.length = 0; w.creatures.birdT = 1e9;
  AL.World.setTime(w, { timeOfDay: 0.5 });
  for (const p of w.surface.pois) if (p.type === 'aphids') p.aphids = 4;   // no ladybug visits
  return w;
}
const spot = w => ({ x: 2000, y: 300 });   // open lawn far from both nests on the core map
const keepOut = (w, list) => { for (const i of list) if (w.ants.state[i]) w.ants.timer[i] = 0; };

test('spider: hunts an ant walking alone, kills and eats it', () => {
  const w = quiet(), A = w.ants, p = spot(w);
  const sp = WC.spawn(w, 'spider', p.x, p.y, { state: 'lurk' });
  const i = A.spawn(1, C.FORAGER, 0, p.x + 60, p.y, 0, w.R), uid = A.uid[i];
  let died = null; const off = AL.on('antDied', (ww, d) => { if (ww === w && d.i === i) died = d; });
  for (let k = 0; k < TICKS(8) && !died; k++) { if (A.state[i] && A.uid[i] === uid && A.state[i] !== WC.GRAPPLE) { A.x[i] = A.px[i]; A.y[i] = A.py[i]; } AL.Sim.step(w); }
  assert.ok(died, 'the lone ant was caught');
  assert.equal(died.cause, 'creature');
  assert.ok(sp.alive && (sp.state === 'feed' || sp.state === 'return' || sp.state === 'lurk'));
  off();
});

test('a quiet start: spiders leave ants alone for the first minutes of a match (not in campaign missions)', () => {
  const keep = WC.TUNE_GRACE; WC.TUNE_GRACE = null;
  const w = quiet(), A = w.ants, p = spot(w);
  WC.spawn(w, 'spider', p.x, p.y, { state: 'lurk' });
  const i = A.spawn(1, C.FORAGER, 0, p.x + 60, p.y, 0, w.R), uid = A.uid[i];
  for (let k = 0; k < TICKS(8); k++) { if (A.state[i] && A.uid[i] === uid) { A.x[i] = A.px[i]; A.y[i] = A.py[i]; } AL.Sim.step(w); }
  WC.TUNE_GRACE = keep;
  assert.ok(A.state[i] && A.uid[i] === uid && A.state[i] !== WC.GRAPPLE, 'the lone ant is left alone early on');
});

test('spider: a swarm kills it and the carcass becomes multi-carrier protein', () => {
  const w = quiet(), A = w.ants, p = spot(w);
  const sp = WC.spawn(w, 'spider', p.x, p.y, { state: 'lurk' });
  const ids = []; for (let k = 0; k < 24; k++) { const a = k / 24 * AL.TAU; ids.push(A.spawn(0, k % 4 ? C.WORKER : C.SOLDIER, 0, p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14, a + Math.PI, w.R)); }
  let ev = null; const off = AL.on('creatureDied', (ww, d) => { if (ww === w && d.kind === 'spider') ev = d; });
  for (let k = 0; k < TICKS(30) && !ev; k++) { keepOut(w, ids); AL.Sim.step(w); }
  assert.ok(ev, 'spider killed'); assert.equal(ev.col, 0);
  assert.ok(!w.surface.creatures.includes(sp));
  const f = w.surface.foods.find(q => q.visual === 'spider' && !q.gone);
  assert.ok(f && f.big && f.needed === 6 && f.amount === AL.CREATURE_TYPES.spider.protein * (AL.TUNE.FOOD_MUL || 1), 'big protein carcass');   // (food sources hold FOOD_MUL x)
  // the ants let go and start hauling it
  run(w, 3);
  assert.ok(ids.some(i => A.state[i] === ST.DRAG), 'ants drag the carcass');
  off();
});

test('lone foragers run from a spider instead of attacking it', () => {
  const w = quiet(), A = w.ants, p = spot(w);
  const sp = WC.spawn(w, 'spider', p.x, p.y, { state: 'feed', st: 99 });
  const i = A.spawn(0, C.FORAGER, 0, p.x + 20, p.y, Math.PI, w.R);
  run(w, 0.3);
  assert.notEqual(A.state[i], WC.GRAPPLE);
  assert.equal(A.state[i], ST.HOMING);
  assert.equal(sp.hp, sp.maxHp);
});

test('beetle: armoured (half damage), bites back, becomes a big carcass', () => {
  const w = quiet(), A = w.ants, p = spot(w);
  const b = WC.spawn(w, 'beetle', p.x, p.y, { state: 'wander', tx: p.x, ty: p.y });
  const ids = []; for (let k = 0; k < 10; k++) { const a = k / 10 * AL.TAU; ids.push(A.spawn(0, C.WORKER, 0, p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, a + Math.PI, w.R)); }
  run(w, 2);
  assert.ok(b.attackers > 4 && b.state === 'defend');
  const lost = b.maxHp - b.hp, raw = b.attackers * AL.CASTES[C.WORKER].dps * w.player.sp.dps * 1.8;
  assert.ok(lost < raw * 0.75, 'armour soaks damage (' + lost.toFixed(1) + ' of ~' + raw.toFixed(1) + ')');
  for (let k = 0; k < TICKS(40) && b.alive; k++) { keepOut(w, ids); AL.Sim.step(w); }
  assert.ok(!b.alive);
  assert.ok(w.surface.foods.some(f => f.visual === 'beetle' && f.big && f.needed === 5 && !f.gone));
});

test('ladybug flies in, eats aphids (stops their regrowth) and flies off when ants defend', () => {
  const w = quiet(), A = w.ants;
  const plant = w.surface.pois.find(p => p.type === 'aphids'); plant.aphids = 20;
  const lb = WC.spawn(w, 'ladybug', plant.x + 300, plant.y, { state: 'flyin', flying: true, prey: false, alt: 1, plant, ox: 10, oy: 0 });
  plant.ladybugCr = lb;
  run(w, 6);
  assert.equal(lb.state, 'eat'); assert.ok(plant.ladybug, 'plant knows');
  run(w, 10);
  assert.ok(plant.aphids < 20, 'ate aphids (' + plant.aphids.toFixed(1) + ')');
  const ids = []; for (let k = 0; k < 6; k++) ids.push(A.spawn(0, C.SOLDIER, 0, lb.x + (k - 3) * 4, lb.y + 12, -Math.PI / 2, w.R));
  for (let k = 0; k < TICKS(6) && lb.state === 'eat'; k++) { keepOut(w, ids); AL.Sim.step(w); }
  assert.equal(lb.state, 'flyoff'); assert.ok(!plant.ladybug);
});

test('caterpillar: slow prey with a big payoff; spins a cocoon in late autumn; a butterfly hatches in spring', () => {
  const w = quiet(), A = w.ants, p = spot(w);
  const cat = WC.spawn(w, 'caterpillar', p.x, p.y, { state: 'crawl' });
  const ids = []; for (let k = 0; k < 14; k++) { const a = k / 14 * AL.TAU; ids.push(A.spawn(0, C.WORKER, 0, p.x + Math.cos(a) * 13, p.y + Math.sin(a) * 13, a + Math.PI, w.R)); }
  for (let k = 0; k < TICKS(30) && cat.alive; k++) { keepOut(w, ids); AL.Sim.step(w); }
  assert.ok(!cat.alive);
  const f = w.surface.foods.find(q => q.visual === 'caterpillar' && !q.gone);
  assert.ok(f && f.amount === 70 * (AL.TUNE.FOOD_MUL || 1) && f.needed === 6);
  const w2 = quiet(22), c2 = WC.spawn(w2, 'caterpillar', 2000, 300, { state: 'crawl' });
  AL.World.setTime(w2, { season: 'autumn', seasonDay: 1, timeOfDay: 0.5 });
  run(w2, 1);
  assert.ok(!c2.alive && w2.surface.creatures.some(q => q.type === 'cocoon'), 'cocooned');
  AL.World.setTime(w2, { season: 'spring', timeOfDay: 0.5 });
  let hatched = false; for (let k = 0; k < TICKS(120) && !hatched; k++) { AL.Sim.step(w2); hatched = w2.surface.creatures.some(q => q.type === 'butterfly'); }
  assert.ok(hatched, 'butterfly');
});

test('bird: telegraphs for seconds, then snatches exposed ants; shade and shelter keep them safe', () => {
  const w = quiet(), A = w.ants, S = w.surface, p = spot(w);
  const exposed = [], safe = [];
  for (let k = 0; k < 8; k++) exposed.push(A.spawn(0, C.FORAGER, 0, p.x + (k % 4) * 6, p.y + (k >> 2) * 6, 0, w.R));
  for (let k = 0; k < 3; k++) { const i = A.spawn(0, C.FORAGER, 0, p.x + 10 + k * 4, p.y - 10, 0, w.R); safe.push(i); w.shade[((A.y[i] / S.cell) | 0) * S.gw + ((A.x[i] / S.cell) | 0)] = 1; }
  const all = exposed.concat(safe), uid = new Map(all.map(i => [i, A.uid[i]])), alive = i => A.state[i] && A.uid[i] === uid.get(i);
  const pin = () => { for (const i of all) if (alive(i)) { A.x[i] = A.px[i]; A.y[i] = A.py[i]; A.state[i] = ST.WANDER; A.timer[i] = 0; } };
  run(w, 0.1);
  const b = WC.trySendBird(w, true);
  assert.ok(b && b.state === 'circle');
  let t = 0, struck = null; const off = AL.on('birdStrike', (ww, d) => { if (ww === w) struck = d; });
  while (!struck && t < 10) { pin(); AL.Sim.step(w); t += T.DT; }
  assert.ok(struck, 'struck'); assert.ok(t > 5.5, 'warned for ' + t.toFixed(1) + 's');
  assert.ok(struck.kills >= 3 && struck.kills <= AL.CREATURE_TYPES.bird.kills, 'kills ' + struck.kills);
  assert.ok(safe.every(alive), 'shaded ants survived');
  run(w, 3);
  assert.equal(w.creatures.bird, null, 'flew off');
  off();
});

test('termite mound: soldiers bite raiders; beaten, it cracks open and spills larvae; truce in winter', () => {
  const w = quiet(), A = w.ants, p = spot(w);
  const m = WC.spawn(w, 'termites', p.x, p.y, { state: 'armed' });
  const ids = []; for (let k = 0; k < 30; k++) { const a = k / 30 * AL.TAU; ids.push(A.spawn(0, k % 3 ? C.WORKER : C.SOLDIER, 0, p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40, a + Math.PI, w.R)); }
  let losses = 0; const off = AL.on('antDied', (ww, d) => { if (ww === w && d.col === 0) losses++; });
  let breached = false; const off2 = AL.on('termitesBreached', ww => { if (ww === w) breached = true; });
  for (let k = 0; k < TICKS(60) && !breached; k++) { keepOut(w, ids); AL.Sim.step(w); }
  // (trails agent) deaths in a 2 s breach are ~1 on average and 0 on many seeds; any bitten raider counts
  const hurt = ids.filter(i => A.state[i] && A.hp[i] < A.maxhp[i]).length;
  assert.ok(breached, 'breached'); assert.ok(losses + hurt > 0, 'raiders took losses (' + losses + ' dead, ' + hurt + ' hurt)');
  assert.equal(m.state, 'breached'); assert.ok(w.surface.creatures.includes(m), 'mound stays');
  assert.ok(w.surface.foods.some(f => f.visual === 'larvae' && !f.gone && f.amount > 50), 'larvae spill out');
  AL.World.setTime(w, { season: 'winter' }); run(w, 1);
  m.state = 'armed'; run(w, 0.2);
  assert.ok(!m.prey && !m.hostile, 'no raiding in the winter truce');
  off(); off2();
});

test('winter: spiders and beetles hide, ladybugs leave, no new creatures appear', () => {
  const w = AL.Sim.createWorld({ seed: 23, fog: false });
  run(w, 2);
  AL.World.setTime(w, { season: 'winter', timeOfDay: 0.5 });
  run(w, 40);
  for (const cr of w.surface.creatures) {
    if (cr.type === 'spider' || cr.type === 'beetle') assert.ok(cr.hidden, cr.type + ' hidden');
    assert.ok(cr.type !== 'ladybug' && cr.type !== 'caterpillar' && cr.type !== 'bird', cr.type + ' should be gone');
  }
});

test('creatures follow the CONTRACT shape', () => {
  const w = AL.Sim.createWorld({ seed: 24 });
  for (const cr of w.surface.creatures) for (const k of ['id', 'type', 'x', 'y', 'a', 'r', 'hp', 'maxHp', 'alive', 'hostile', 'prey', 'armor', 'attackers', 'protein', 'needed', 'onDeath']) assert.ok(k in cr, cr.type + ' has ' + k);
});
