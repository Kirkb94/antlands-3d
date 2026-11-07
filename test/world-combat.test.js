// World stage creatures with the core's M3 combat loaded (core grapples creatures; we hand off to it).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const HAS = ['nest.js', 'life.js', 'combat.js'].every(f => fs.existsSync(path.join(__dirname, '../public', f)));
const AL = require('../public/al.js');
require('../public/sim.js');
if (HAS) { require('../public/nest.js'); require('../public/life.js'); require('../public/combat.js'); }
if (HAS && fs.existsSync(path.join(__dirname, '../public/fog.js'))) require('../public/fog.js');
require('../public/world-time.js'); require('../public/world-poi.js'); require('../public/world-creatures.js'); require('../public/world-fog.js');
const ST = AL.ST, C = AL.CASTE, T = AL.TUNE, TICKS = s => Math.round(s / T.DT);
const run = (w, secs) => { for (let k = 0, n = TICKS(secs); k < n; k++) AL.Sim.step(w); };
const WC = AL.WorldCreatures;
const opt = { skip: !HAS && 'core combat.js not present' };
function quiet(seed) {
  const w = AL.Sim.createWorld({ seed: seed || 41 });
  for (const cr of w.surface.creatures.slice()) WC.remove(w, cr);
  w.creatures.lairs.length = 0; w.creatures.birdT = 1e9;
  AL.World.setTime(w, { timeOfDay: 0.5 });
  return w;
}

test('with core combat: our grapple is off, core fog is used, no double handling', opt, () => {
  const w = quiet();
  assert.equal(w.creatures.ownGrapple, false);
  if (AL.Fog) assert.ok(!w.fog.isWorldFog, 'core fog kept'), assert.ok(!w.scent, 'no second scent layer');
});

test('with core combat: a swarm kills a spider and leaves one spider carcass', opt, () => {
  const w = quiet(), A = w.ants, p = { x: 2000, y: 300 };
  const sp = WC.spawn(w, 'spider', p.x, p.y, { state: 'lurk' });
  const ids = []; for (let k = 0; k < 24; k++) { const a = k / 24 * AL.TAU; ids.push(A.spawn(0, k % 3 ? C.WORKER : C.SOLDIER, 0, p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16, a + Math.PI, w.R)); }
  let died = 0; const off = AL.on('creatureDied', (ww, d) => { if (ww === w && (d.kind === 'spider' || (d.creature && d.creature.type === 'spider'))) died++; });
  for (let k = 0; k < TICKS(30) && sp.alive; k++) { for (const i of ids) if (A.state[i]) A.timer[i] = 0; AL.Sim.step(w); }
  assert.ok(!sp.alive, 'killed');
  assert.equal(died, 1, 'one death event');
  assert.equal(w.surface.foods.filter(f => f.visual === 'spider' && !f.gone).length, 1, 'one carcass');
  assert.ok(!w.surface.creatures.includes(sp), 'removed from the list');
  off();
});

test('with core combat: termite mound breaches (stays on the map) and rebuilds later', opt, () => {
  const w = quiet(), A = w.ants, p = { x: 2000, y: 300 };
  const m = WC.spawn(w, 'termites', p.x, p.y, { state: 'armed' });
  const ids = []; for (let k = 0; k < 36; k++) { const a = k / 36 * AL.TAU; ids.push(A.spawn(0, k % 2 ? C.WORKER : C.SOLDIER, 0, p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40, a + Math.PI, w.R)); }
  for (let k = 0; k < TICKS(60) && m.state !== 'breached'; k++) { for (const i of ids) if (A.state[i]) A.timer[i] = 0; AL.Sim.step(w); }
  assert.equal(m.state, 'breached'); assert.ok(w.surface.creatures.includes(m));
  run(w, 5); assert.equal(w.surface.foods.filter(f => f.visual === 'larvae').length, 1, 'one larvae spill');
  assert.ok(w.surface.foods.some(f => f.visual === 'larvae' && !f.gone));
  run(w, AL.CREATURE_TYPES.termites.breachTime + 2);
  assert.ok((m.state === 'rebuild' || m.state === 'armed') && m.alive);
});

test('with core combat: a full world runs a match-length stretch without errors', opt, () => {
  const w = AL.Sim.createWorld({ seed: 43, layout: AL.WorldPOI.plan({ seed: 43, n: 3 }) });
  run(w, 600);
  assert.ok(w.surface.creatures.length > 0);
  assert.ok(w.colonies.every(c => c.stock));
});
