// Multiplayer (lockstep): two PCs (different world.me) given the same seed and commands keep identical worlds;
// every human colony gets the full player model; elimination and the last-colony-standing win.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'bivouac.js', 'fog.js', 'species.js', 'expansion.js', 'research.js', 'victory.js', 'world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js', 'brush.js', 'cmd.js']) require('../public/' + f);
const mp = me => ({ seed: 21, colonies: 4, mp: { humans: 3, me, species: ['fire', 'honeypot', 'slavemaker'], names: ['A', 'B', 'C'], perks: ['random', null, null] } });
test('two PCs with the same seed and commands stay identical, whoever is watching', () => {
  const run = me => require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '../tools/mp-run.js'), String(me)], { encoding: 'utf8' }).trim().split(' ');
  const a = run(0), b = run(2);
  assert.deepEqual(a.slice(0, -2), b.slice(0, -2), 'world hashes per 100 turns');
  assert.equal(a[a.length - 2], 'trail', 'trail painted');
  assert.equal(a[a.length - 1], '0'); assert.equal(b[b.length - 1], '2');
});
test('every person gets a detailed nest with a queen and brood', () => {
  const w = AL.Sim.createWorld(mp(1));
  for (let k = 0; k < 30 * 30; k++) AL.Sim.step(w);
  for (let c = 0; c < 3; c++) { const o = w.colonies[c]; assert.ok(o.isPlayer && o.nest && o.queen.alive && o.brood.length > 0, 'colony ' + c); }
  assert.ok(!w.colonies[3].isPlayer && !w.colonies[3].nest, 'colony 3 is an AI rival');
});
test('the last colony standing wins', () => {
  const w = AL.Sim.createWorld({ seed: 5, colonies: 3, mp: { humans: 3, me: 1, species: ['fire', 'bullet', 'harvester'], names: ['A', 'B', 'C'] } });
  for (let k = 0; k < 30 * 10; k++) AL.Sim.step(w);
  AL.Combat.killAnt(w, w.colonies[0].queen.i, 'fight'); AL.Combat.killAnt(w, w.colonies[2].queen.i, 'fight');
  for (let k = 0; k < 30 * 5; k++) AL.Sim.step(w);
  assert.ok(w.over && w.over.winner === 1 && w.over.win, JSON.stringify(w.over && w.over.reason));
});

test('with the crowd LOD on, PCs looking at different places stay identical (the LOD uses a view shared by all)', () => {
  const run = me => require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '../tools/mp-run.js'), String(me)], { encoding: 'utf8', env: Object.assign({}, process.env, { LOD: '1' }) }).trim().split(' ');
  const a = run(0), b = run(2);
  assert.deepEqual(a.slice(0, -1), b.slice(0, -1));
});
test('with real rival nests (AI rivals underground too) two PCs still stay identical', () => {
  const run = me => require('child_process').execFileSync(process.execPath, [require('path').join(__dirname, '../tools/mp-run.js'), String(me)], { encoding: 'utf8', env: Object.assign({}, process.env, { RN: '1' }) }).trim().split(' ');
  const a = run(0), b = run(2);
  assert.deepEqual(a.slice(0, -1), b.slice(0, -1));
});
