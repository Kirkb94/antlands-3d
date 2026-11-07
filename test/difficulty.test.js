// Rival difficulty (opts.aiLevel): Easy / Normal / Hard scale raid timing, raid size, breeding and discovery.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'fog']) require('../public/' + f + '.js');

test('level keys: strings, numbers and the default', () => {
  const K = AL.AI.levelKey;
  assert.equal(K('easy'), 'easy'); assert.equal(K('hard'), 'hard'); assert.equal(K(undefined), 'normal');
  assert.equal(K(1), 'normal'); assert.equal(K(0.5), 'easy'); assert.equal(K(1.5), 'hard'); assert.equal(K('silly'), 'normal');
  const w = AL.Sim.createWorld({ seed: 3, colonies: 3, aiLevel: 'hard' });
  assert.equal(w.colonies[1].ai.level, 'hard');
  assert.equal(AL.AI.levelOf(w.colonies[1]), AL.AI_LEVELS.hard);
});

test('easy rivals raid later than hard ones (same seed), and the knobs are ordered', () => {
  const first = lv => AL.Sim.createWorld({ seed: 12, colonies: 4, aiLevel: lv }).colonies.slice(1).map(c => c.ai.raidT);
  const e = first('easy'), n = first('normal'), h = first('hard');
  for (let k = 0; k < e.length; k++) assert.ok(e[k] > n[k] && n[k] > h[k], 'first raid ' + [e[k], n[k], h[k]].map(Math.round));
  const L = AL.AI_LEVELS;
  for (const key of ['raidSize', 'breed', 'sight']) assert.ok(L.easy[key] < L.normal[key] && L.normal[key] < L.hard[key], key);
  assert.ok(L.easy.raidEvery > L.normal.raidEvery && L.normal.raidEvery > L.hard.raidEvery);
});

test('normal: right after a raid on the player, other rivals pick another target', () => {
  const w = AL.Sim.createWorld({ seed: 8, colonies: 3, aiKnows: 'all', aiLevel: 'normal' });
  const r = w.colonies[1];
  AL.emit(w, 'raid', { col: 2, target: 0, n: 10, wave: 1 });
  for (let k = 0; k < 20; k++) assert.notEqual(AL.AI.pickTarget(w, r), 0, 'the player was just raided');
  // with nobody else to raid: normal waits, hard goes for the player anyway
  const only = lv => { const x = AL.Sim.createWorld({ seed: 8, colonies: 3, aiKnows: 'all', aiLevel: lv }); x.colonies[2].alive = false; AL.emit(x, 'raid', { col: 2, target: 0, n: 10, wave: 1 }); return AL.AI.pickTarget(x, x.colonies[1]); };
  assert.equal(only('normal'), -1);
  assert.equal(only('hard'), 0);
});
