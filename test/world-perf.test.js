// World stage cost at the lead's benchmark size: 5,000 surface ants, every world system on.
// Prints ms per sim tick with and without the World stage; fails only on a gross regression.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'fog.js']) if (fs.existsSync(path.join(__dirname, '../public', f))) require('../public/' + f);
require('../public/world-time.js'); require('../public/world-poi.js'); require('../public/world-creatures.js'); require('../public/world-fog.js');

function msPerTick(opts, setup) {
  const w = AL.Sim.createWorld(Object.assign({ seed: 12345, bench: 5000, benchOnly: true }, opts));
  w.view = { x0: 0, y0: 0, x1: 1400, y1: 900 };
  if (setup) setup(w);
  for (let k = 0; k < 90; k++) AL.Sim.step(w);
  const N = 450, t0 = process.hrtime.bigint();
  for (let k = 0; k < N; k++) AL.Sim.step(w);
  return Number(process.hrtime.bigint() - t0) / 1e6 / N;
}
test('5,000 ants: the World stage adds well under a millisecond per tick', () => {
  msPerTick({ world: false });   // warm the JIT
  const base = Math.min(msPerTick({ world: false }), msPerTick({ world: false }));
  const rows = [['core only', base]];
  for (const [label, setup] of [
    ['world, clear day', null],
    ['world, storm', w => AL.World.forceWeather(w, 'storm', 999, true)],
    ['world, heat wave noon', w => { AL.World.setTime(w, { season: 'summer', timeOfDay: 0.55 }); AL.World.forceWeather(w, 'heat', 999, true); }],
    ['world, night', w => AL.World.setTime(w, { timeOfDay: 0.95 })],
    ['world, fog on (noFog=false, own fog)', w => w],
  ]) rows.push([label, Math.min(msPerTick({}, setup), msPerTick({}, setup))]);
  for (const [l, v] of rows) console.log('# ' + l.padEnd(40) + v.toFixed(3) + ' ms/tick' + (l === 'core only' ? '' : '  (+' + (v - base).toFixed(3) + ')'));
  const worst = Math.max(...rows.slice(1).map(r => r[1] - base));
  assert.ok(worst < 1.5, 'world overhead ' + worst.toFixed(3) + ' ms/tick');
});
