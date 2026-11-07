const test = require('node:test'), assert = require('node:assert');
const PheromoneGrid = require('../public/pheromone.js');

test('deposit and sample hit the same cell', () => {
  const g = new PheromoneGrid(10, 10, 16);
  g.deposit(40, 40, 1.5);
  assert.equal(g.sample(40, 40), 1.5);
  assert.equal(g.sample(47, 47), 1.5);       // same 16-unit cell
  assert.equal(g.sample(60, 40), 0);
  assert.equal(g.sample(-5, 40), 0);         // off the map is empty, not an error
});
test('deposits are capped at max', () => {
  const g = new PheromoneGrid(4, 4, 10, { max: 3 });
  for (let i = 0; i < 10; i++) g.deposit(5, 5, 1);
  assert.equal(g.sample(5, 5), 3);
});
test('evaporation halves a trail every half-life', () => {
  const g = new PheromoneGrid(20, 20, 10, { halfLife: 10, diffuse: 0 });
  g.deposit(100, 100, 4);
  for (let i = 0; i < 100; i++) g.update(0.1);   // 10 seconds
  assert.ok(Math.abs(g.sample(100, 100) - 2) < 0.01, 'got ' + g.sample(100, 100));
});
test('unused trails fade to exactly zero and stop costing updates', () => {
  const g = new PheromoneGrid(20, 20, 10, { halfLife: 2, diffuse: 0.5 });
  g.deposit(100, 100, 1);
  for (let i = 0; i < 400; i++) g.update(0.1);
  assert.equal(g.total(), 0);
  assert.equal(g.x1, -1, 'bounding box empties');
});
test('diffusion spreads to neighbours without creating pheromone', () => {
  const g = new PheromoneGrid(21, 21, 10, { halfLife: 1e9, diffuse: 1 });
  g.deposit(105, 105, 8);
  const before = g.total();
  g.update(0.2);
  assert.ok(g.sample(115, 105) > 0, 'neighbour received some');
  assert.ok(g.sample(105, 105) < 8, 'centre lost some');
  assert.ok(Math.abs(g.total() - before) < 1e-3, 'mass conserved without evaporation');
});
test('reinforcement only strengthens an existing trail (traffic keeps trails alive)', () => {
  const g = new PheromoneGrid(10, 10, 10, { halfLife: 5, diffuse: 0 });
  assert.equal(g.reinforce(15, 15, 0.5), 0, 'no trail, nothing to reinforce');
  assert.equal(g.sample(15, 15), 0);
  g.deposit(15, 15, 0.2);
  g.reinforce(15, 15, 0.5);
  assert.ok(g.sample(15, 15) > 0.6);
  // a trail walked every second outlives one that isn't
  const h = new PheromoneGrid(10, 10, 10, { halfLife: 5, diffuse: 0 });
  h.deposit(15, 15, 0.2); g.data.fill(0); g.deposit(15, 15, 0.2);
  for (let s = 0; s < 60; s++) { g.update(1); h.update(1); g.reinforce(15, 15, 0.06); }
  assert.ok(g.sample(15, 15) > 0.05, 'walked trail survives');
  assert.equal(h.sample(15, 15), 0, 'abandoned trail is gone');
});
test('erase and scale (rain) clear trails', () => {
  const g = new PheromoneGrid(20, 20, 10, { diffuse: 0 });
  g.depositDisc(100, 100, 30, 2);
  assert.ok(g.sample(100, 100) > 1);
  g.scale(0.25);
  assert.ok(g.sample(100, 100) < 0.6);
  g.erase(100, 100, 40);
  assert.equal(g.sample(100, 100), 0);
});

// ---- trails agent: thin sub-cell trails, capped brush, strength-dependent lifetime ----
test('sub-cell deposits keep the whole amount and read back smoothly between cells', () => {
  const g = new PheromoneGrid(20, 20, 16, { max: 100 });
  g.depositLin(100, 100, 2);
  assert.ok(Math.abs(g.total() - 2) < 1e-5, 'amount conserved over the 4 nearest cells');
  const c = g.sampleLin(100, 100), side = g.sampleLin(100, 112), far = g.sampleLin(100, 124);
  assert.ok(c > side && side > far && far === 0, 'reading falls off smoothly across the trail');
  assert.ok(Math.abs(g.sampleLin(104, 104) - g.sampleLin(103, 104)) < 0.05, 'no step at the sampling point');
});
test('a capped brush never paints above its cap and never weakens a stronger cell', () => {
  const g = new PheromoneGrid(20, 20, 16, { max: 12 });
  for (let k = 0; k < 40; k++) g.depositDisc(160, 160, 14, 1, 3);
  assert.ok(g.sample(160, 160) <= 3 + 1e-6, 'painted trail stops at the cap');
  g.deposit(160, 160, 9);   // ants keep laying on top
  g.depositDisc(160, 160, 14, 1, 3);
  assert.ok(g.sample(160, 160) > 10, 'the brush left the stronger ant-laid cell alone');
});
test('with a linear fade a strong trail outlives a weak one by far more than the strength ratio alone', () => {
  const life = (v0, fade) => { const g = new PheromoneGrid(10, 10, 16, { halfLife: 100, diffuse: 0, fade, max: 12 }); g.deposit(80, 80, v0); let t = 0; while (g.sample(80, 80) > 0.05 && t < 5000) { g.update(1); t++; } return t; };
  const weak = life(0.3, 0.0005), strong = life(12, 0.0005);
  assert.ok(weak >= 150, 'a single forager trail lasts a long round trip (' + weak + ' s)');
  assert.ok(strong > weak * 2.4 && strong < 900, 'an ant highway lasts much longer but still fades (' + strong + ' s vs ' + weak + ' s)');
  assert.ok(life(0.3, 0.0005) < life(0.3, 0), 'fade shortens weak trails');
});
test('fadeDisc weakens only the dead end', () => {
  const g = new PheromoneGrid(40, 10, 16, { max: 12 });
  for (let x = 8; x < 600; x += 16) g.deposit(x, 80, 6);
  g.fadeDisc(590, 80, 30, 0.3);
  assert.ok(g.sample(590, 80) < 2 && g.sample(300, 80) === 6);
});
