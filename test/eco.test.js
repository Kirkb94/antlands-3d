// The backyard ecosystem (eco.js): creatures eat, starve and breed instead of respawning on a timer.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'bivouac', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog']) require('../public/' + f + '.js');
const E = AL.Eco, WC = AL.WorldCreatures, K = AL.CARRY;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const yard = seed => {   // a yard with no ants about, so only the creatures act
  const w = AL.Sim.createWorld({ seed: seed || 5, species: 'fire', colonies: 2, noFog: true, keypointsAt: 1e9, worldTime: { season: 'summer', timeOfDay: 0.4 } });
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.layer[i] === AL.LAYER.SURFACE) w.ants.kill(i);
  for (const c of w.colonies) { if (c.ai) c.ai.raidT = 1e9; c.x = c.y = -9999; }
  return w;
};
const live = (w, type) => w.surface.creatures.filter(c => c.alive && c.type === type);

test('creatures get hungry; one with nothing to eat starves and leaves a carcass for the ants', () => {
  const w = yard(), cr = live(w, 'beetle')[0] || WC.spawn(w, 'beetle', 900, 900, { state: 'wander' });
  const f0 = cr.food, keep = E.TUNE.FEED.litter;
  E.TUNE.FEED.litter = 0;   // (nothing in the litter either)
  run(w, 20);
  assert.ok(cr.food < f0, 'its belly empties: ' + f0 + ' -> ' + cr.food);
  cr.food = 0; cr.hidden = false; cr.state = 'defend'; cr.hp = cr.maxHp * 0.1;
  const foods0 = w.surface.foods.length;
  let starved = 0; const off = AL.on('creatureStarved', ww => { if (ww === w) starved++; });
  run(w, 12);
  off(); E.TUNE.FEED.litter = keep;
  assert.ok(!cr.alive && starved >= 1, 'it starved');
  assert.ok(w.surface.foods.length > foods0 && w.surface.foods.some(f => f.carcass && f.visual === 'beetle'), 'a carcass is left');
});

test('a well-fed spider guards an egg sac; spiderlings hatch, settle a lair of their own and grow up', () => {
  const w = yard(), s = live(w, 'spider')[0];
  assert.ok(s, 'a spider');
  s.food = 1; s.state = 'lurk';
  run(w, E.TUNE.BREED_HOLD + 3);
  const sacs = live(w, 'eggsac');
  assert.equal(sacs.length, 1, 'an egg sac at her lair');
  assert.ok(s.food < 1 - E.TUNE.BREED_COST * 0.9, 'laying costs her');
  const lairs0 = w.creatures.lairs.length, n0 = live(w, 'spider').length;
  for (const k of live(w, 'spider')) k.food = 0.6;   // (nobody starves while we wait)
  sacs[0].st = 1; run(w, 2);
  const kids = live(w, 'spider').filter(k => k.young);
  assert.ok(kids.length >= 1 && live(w, 'spider').length > n0, 'spiderlings');
  assert.ok(kids[0].scale < 1 && kids[0].maxHp < s.maxHp, 'small to start with');
  assert.ok(w.creatures.lairs.length >= lairs0, 'they have somewhere to live');
  kids[0].born -= E.TUNE.YOUNG_T; kids[0].food = 0.8; run(w, 1.1);
  assert.ok(!kids[0].young && kids[0].scale === 1, 'grown up');
});

test('ladybugs lay on aphid plants; the larvae eat aphids and become ladybugs', () => {
  const w = yard(), p = w.surface.pois.find(q => q.type === 'aphids');
  assert.ok(p, 'an aphid plant');
  p.aphids = 30;
  const lb = WC.spawn(w, 'ladybug', p.x, p.y, { state: 'eat', st: 200, flying: false, prey: true, alt: 0, plant: p, ox: 0, oy: 0, food: 1 });
  p.ladybugCr = lb;
  const a0 = p.aphids;
  run(w, E.TUNE.BREED_HOLD + 4);
  assert.ok(p.aphids < a0, 'she ate aphids');
  const eggs = live(w, 'clutch').filter(c => c.hatch === 'ladybug');
  assert.equal(eggs.length, 1, 'eggs on the plant');
  eggs[0].st = 0.5; run(w, 1.5);
  const larvae = live(w, 'lblarva');
  assert.ok(larvae.length >= 2, 'larvae hatch: ' + larvae.length);
  const before = p.aphids; run(w, 10);
  assert.ok(p.aphids < before || larvae.some(l => l.food > 0.5), 'the larvae eat aphids too');
  larvae[0].born -= E.TUNE.LARVA_T; larvae[0].food = 0.8;
  const n0 = live(w, 'ladybug').length; run(w, 0.2);
  assert.ok(live(w, 'ladybug').length > n0, 'a new ladybug');
});

test('a caterpillar that eats its fill pupates; the butterfly lays on clover and caterpillars hatch', () => {
  const w = yard(), clover = w.surface.pois.find(q => q.type === 'clover');
  for (const c of live(w, 'caterpillar')) WC.remove(w, c);
  const cat = WC.spawn(w, 'caterpillar', clover.x, clover.y, { state: 'crawl', food: E.TUNE.PUPATE_FOOD });
  cat.born -= E.TUNE.PUPATE_AGE;
  run(w, 0.2);
  assert.ok(!cat.alive && live(w, 'cocoon').length === 1, 'a cocoon');
  const co = live(w, 'cocoon')[0]; co.born -= E.TUNE.COCOON_T;
  for (let k = 0; k < 200 && co.alive; k++) run(w, 1);
  assert.ok(!co.alive && live(w, 'butterfly').length === 1, 'a butterfly comes out');
  for (let k = 0; k < 60 && !live(w, 'clutch').some(c => c.hatch === 'caterpillar'); k++) run(w, 1);
  const eggs = live(w, 'clutch').find(c => c.hatch === 'caterpillar');
  assert.ok(eggs, 'she laid eggs on the clover');
  assert.ok(Math.hypot(eggs.x - clover.x, eggs.y - clover.y) < 30);
  eggs.st = 0.5; run(w, 1.5);
  assert.ok(live(w, 'caterpillar').length >= 2, 'caterpillars hatch');
});

test('a hungry beetle scavenges the dead, competing with the ants', () => {
  const w = yard(), b = live(w, 'beetle')[0];
  const f = AL.Surface.addFood(w.surface, { kind: K.PROTEIN, x: b.x + 60, y: b.y, r: 6, amount: 20, max: 20, carcass: true, visual: 'bug' });
  b.food = 0.2; b.state = 'wander'; b.st = 0.01; b.attackers = 0;
  run(w, 25);
  const M = AL.TUNE.FOOD_MUL || 1;   // (food sources hold FOOD_MUL x their listed amount)
  assert.ok(f.amount < 20 * M && b.food > 0.2, 'it ate from the carcass: ' + f.amount + ', belly ' + b.food.toFixed(2));
});

test('a kind that dies out wanders back in after a while (not in winter)', () => {
  const w = yard();
  for (const c of w.surface.creatures.slice()) if (c.type === 'spider' || c.type === 'eggsac') WC.remove(w, c);
  run(w, E.TUNE.IMMIGRATE - 5);
  assert.equal(live(w, 'spider').length, 0);
  run(w, 10);
  assert.equal(live(w, 'spider').length, 1, 'a spider moves in');
});

test('the ecosystem is deterministic', () => {
  const sim = () => { const w = AL.Sim.createWorld({ seed: 13, species: 'fire', colonies: 3 }); run(w, 400); return JSON.stringify(E.census(w)) + w.eco.born + ':' + w.eco.starved; };
  assert.equal(sim(), sim());
});
