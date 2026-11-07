// Sugar upkeep scales with body size: bigger castes and bigger species eat more (but less per unit of body).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
const C = AL.CASTE;
test('a major eats more sugar than a worker, a nurse less; bullet ants more than fire ants', () => {
  const fire = AL.SPECIES.fire, bullet = AL.SPECIES.bullet, U = AL.Colony.casteUpkeep;
  assert.equal(U(fire, C.WORKER), 1);
  assert.ok(U(fire, C.MAJOR) > 2 && U(fire, C.MAJOR) < 3, 'major ~2.4x');
  assert.ok(U(fire, C.SOLDIER) > 1.3 && U(fire, C.SOLDIER) < 1.7, 'soldier ~1.5x');
  assert.ok(U(fire, C.NURSE) < 1, 'nurse eats less');
  assert.equal(U(fire, C.QUEEN), 0, 'queen is charged separately');
  assert.ok(U(bullet, C.WORKER) > 2, 'bullet ant workers ~2.3x');
});
test('colony upkeep sums the castes and applies the species appetite', () => {
  const col = { sp: AL.SPECIES.fire, pop: new Int32Array(AL.NCASTE) };
  col.pop[C.WORKER] = 10;
  const w10 = AL.Colony.upkeep(col);
  assert.ok(Math.abs(w10 - 10 * AL.TUNE.SUGAR_PER_ANT) < 1e-9);
  col.pop[C.MAJOR] = 1;
  assert.ok(AL.Colony.upkeep(col) > w10 + 2 * AL.TUNE.SUGAR_PER_ANT, 'one major costs over two workers');
  const harv = { sp: AL.SPECIES.harvester, pop: col.pop };
  assert.ok(AL.Colony.upkeep(harv) < AL.Colony.upkeep(col), 'harvesters eat less');
});
