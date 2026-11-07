// World stage: fog of war and scent at its edge.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
require('../public/world-time.js'); require('../public/world-poi.js'); require('../public/world-creatures.js'); require('../public/world-fog.js');
const C = AL.CASTE;
function world() {
  // plain core sim (no nest): clear the starting ants so each test places its own
  const w = AL.Sim.createWorld({ seed: 31, creatures: false });
  const A = w.ants; for (let i = 0; i < A.high; i++) if (A.state[i]) A.kill(i);
  AL.World.setTime(w, { timeOfDay: 0.5 });
  return w;
}
const refresh = w => { for (let k = 0; k < AL.FOG_TUNE.EVERY * 2; k++) AL.Sim.step(w); AL.WorldFog.refresh(w, w.fog); };
const pin = (w, ids) => { const A = w.ants; for (const i of ids) { A.state[i] = AL.ST.GUARD; } };

test('fog: player ants and the mound see around them; far rivals stay hidden', () => {
  const w = world(), A = w.ants, F = w.fog;
  const me = A.spawn(0, C.WORKER, 0, 2000, 1500, 0, w.R);
  const far = A.spawn(1, C.WORKER, 0, 2600, 1500, 0, w.R);
  pin(w, [me, far]); refresh(w);
  A.x[me] = 2000; A.y[me] = 1500; A.x[far] = 2600; A.y[far] = 1500; AL.WorldFog.refresh(w, F);
  assert.ok(F.visibleAt(2000, 1500) && F.visibleAt(2050, 1500), 'sees itself and a little around');
  assert.ok(!F.visibleAt(2600, 1500), 'far rival hidden');
  assert.ok(F.visibleAt(w.player.x, w.player.y), 'mound sees');
  assert.ok(!F.visibleAt(w.colonies[1].x, w.colonies[1].y), 'rival mound hidden');
  // the per-pheromone-cell copy matches (used by the core trail renderer)
  const S = w.surface, gi = ((1500 / S.cell) | 0) * S.gw + ((2000 / S.cell) | 0);
  assert.equal(F.visCell[gi], 1);
  // explored stays explored
  A.x[me] = 3000; A.y[me] = 2600; AL.WorldFog.refresh(w, F);
  assert.ok(!F.visibleAt(2000, 1500) && F.seenAt(2000, 1500));
});

test('scent: rivals just past the edge of sight are smelled before they are seen', () => {
  const w = world(), A = w.ants, F = w.fog;
  const me = A.spawn(0, C.WORKER, 0, 2000, 1500, 0, w.R);
  const lurker = [];
  for (let k = 0; k < 4; k++) lurker.push(A.spawn(1, C.WORKER, 0, 2000 + 150 + k * 3, 1500, 0, w.R));
  const far = A.spawn(1, C.WORKER, 0, 3200, 300, 0, w.R);
  pin(w, [me, far].concat(lurker));
  for (let k = 0; k < 4; k++) AL.WorldFog.refresh(w, F);
  assert.ok(!F.visibleAt(2150, 1500), 'not visible');
  assert.ok(F.smellAt(2150, 1500), 'inside the smell ring');
  const hint = F.hints.slice(0, F.nh).find(h => Math.hypot(h.x - 2150, h.y - 1500) < 80);
  assert.ok(hint, 'a scent wisp near the lurkers');
  assert.equal(hint.col, 2, 'tagged with the rival colony (col id + 1)');
  assert.ok(!F.hints.slice(0, F.nh).some(h => Math.hypot(h.x - 3200, h.y - 300) < 200), 'no wisp for rivals far beyond smelling range');
});

test('scent: a spider smells of danger; rain washes scent out faster', () => {
  const w = world(), A = w.ants, F = w.fog;
  const me = A.spawn(0, C.WORKER, 0, 2000, 1500, 0, w.R); pin(w, [me]);
  w.creatures = { slots: [], nextId: 1, ownGrapple: true, lairs: [], bird: null, birdT: 1e9, birdTurn: 0, catTurn: 0 };
  const sp = AL.WorldCreatures.spawn(w, 'spider', 2160, 1500, { state: 'lurk' });
  for (let k = 0; k < 4; k++) AL.WorldFog.refresh(w, F);
  const h = F.hints.slice(0, F.nh).find(q => Math.hypot(q.x - 2160, q.y - 1500) < 80);
  assert.ok(h && h.col === 200, 'danger scent');
  const dry = F.scentAt(2160, 1500);
  AL.WorldCreatures.remove(w, sp);
  const w2 = world(), F2 = w2.fog; w2.creatures = w.creatures;
  F.scent.fill(0); F2.scent.fill(0); F.scent[F.idx(2160, 1500)] = 3; F2.scent[F2.idx(2160, 1500)] = 3;
  AL.World.forceWeather(w2, 'storm', 100, true);
  AL.WorldFog.refresh(w, F); AL.WorldFog.refresh(w2, F2);
  assert.ok(F2.scentAt(2160, 1500) < F.scentAt(2160, 1500), 'rain fades it');
  assert.ok(dry > 0.5);
});

test('night shortens sight for day ants', () => {
  const w = world(), A = w.ants, F = w.fog;
  const me = A.spawn(0, C.SCOUT, 0, 2000, 1500, 0, w.R); pin(w, [me]);
  AL.WorldFog.refresh(w, F);
  const count = () => { let n = 0; for (let i = 0; i < F.n; i++) n += F.vis[i]; return n; };
  const day = count();
  AL.World.setTime(w, { timeOfDay: 0.02 }); AL.WorldFog.refresh(w, F);
  assert.ok(count() < day, 'night ' + count() + ' < day ' + day);
});
