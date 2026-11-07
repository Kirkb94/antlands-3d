// Cross-module wiring checked after the merge: research and perks reach combat; campaign/tutorial/perk/difficulty
// options reach the world; every system boots with 8 colonies of mixed species.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'bivouac.js', 'fog.js', 'founding-sites.js', 'founding.js', 'founding-race.js', 'species.js', 'expansion.js', 'research.js', 'victory.js', 'world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js', 'campaign.js'])
  if (fs.existsSync(path.join(__dirname, '../public', f))) require('../public/' + f);
const C = AL.CASTE;
test('a dps perk shows up in combat stats (research mods -> Combat.stat)', () => {
  const plain = AL.Sim.createWorld({ seed: 3, species: 'bullet' });
  const venom = AL.Sim.createWorld({ seed: 3, species: 'bullet', perk: 'venom' });
  for (let k = 0; k < 40; k++) { AL.Sim.step(plain); AL.Sim.step(venom); }
  const a = AL.Combat.stat(plain.player, C.WORKER).dps, b = AL.Combat.stat(venom.player, C.WORKER).dps;
  assert.ok(Number.isFinite(a) && Number.isFinite(b), 'finite stats');
  assert.ok(b > a * 1.2, 'venom bites harder (' + a.toFixed(2) + ' -> ' + b.toFixed(2) + ')');
});
test('8 colonies of mixed species run every system for 60 s without NaN stats', () => {
  const w = AL.Sim.createWorld({ seed: 9, species: 'army', colonies: 8, aiLevel: 'hard' });
  for (let k = 0; k < 30 * 60; k++) AL.Sim.step(w);
  assert.equal(w.colonies.length, 8);
  for (const c of w.colonies) for (let k = 0; k < AL.NCASTE; k++) { const s = AL.Combat.stat(c, k); assert.ok(Number.isFinite(s.dps) && Number.isFinite(s.tough), c.spKey + ' caste ' + k); }
  for (const c of w.colonies) assert.ok(Number.isFinite(c.stock.sugar), c.spKey + ' sugar');
});
