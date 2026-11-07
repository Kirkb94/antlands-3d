// World stage: clock, seasons, weather, env, trail wash, floods, heat, hibernation.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
try { require('../public/nest.js'); require('../public/life.js'); } catch (e) { /* core without a nest model */ }
require('../public/world-time.js'); require('../public/world-poi.js'); require('../public/world-creatures.js'); require('../public/world-fog.js');
const ST = AL.ST, T = AL.TUNE, TICKS = s => Math.round(s / T.DT);
const run = (w, secs) => { for (let k = 0, n = TICKS(secs); k < n; k++) AL.Sim.step(w); };
const make = (o) => AL.Sim.createWorld(Object.assign({ seed: 11, creatures: false }, o));

test('clock starts on a spring morning and days pass at TUNE.DAY', () => {
  const w = make();
  assert.equal(w.env.season, 'spring'); assert.equal(w.env.day, 1);
  assert.ok(Math.abs(w.env.timeOfDay - AL.WORLD_TUNE.START_TOD) < 1e-6);
  assert.equal(w.env.night, 0, 'daylight at 7:15');
  run(w, T.DAY);
  assert.equal(w.env.day, 2);
  AL.World.setTime(w, { timeOfDay: 0.97 }); assert.ok(w.env.night > 0.95, 'night near midnight');
  AL.World.setTime(w, { timeOfDay: 0.5 }); assert.equal(w.env.night, 0, 'noon is day');
  AL.World.setTime(w, { timeOfDay: 19.5 / 24 }); assert.ok(w.env.dusk > 0.5, 'dusk around sunset');
});

test('a year is 36 real minutes: spring, summer, autumn, a fast winter', () => {
  assert.equal(AL.World.yearDur(), 36 * 60);
  const w = make();
  const seen = [];
  const off = AL.on('season', (ww, d) => { if (ww === w) seen.push(d.season); });
  AL.World.setTime(w, { season: 'autumn', seasonDay: 1, timeOfDay: 0.9 });
  let warned = false; const off2 = AL.on('winterSoon', ww => { if (ww === w) warned = true; });
  run(w, 2);
  assert.ok(warned, 'winter warning a day ahead');
  run(w, T.DAY * 0.12);
  assert.equal(w.env.season, 'winter'); assert.ok(w.env.winter && w.env.truce && w.env.forage === 0);
  assert.ok(w.env.metabolism < 1);
  assert.equal(w.weather.kind, 'snow', 'winter opens with snow');
  // winter days run at half length
  const d0 = w.env.day; run(w, T.DAY * 0.5 + 1); assert.equal(w.env.day, d0 + 1);
  off(); off2();
  assert.deepEqual(seen.slice(-1), ['winter']);
});

test('species night modifiers: carpenters stronger at night, fire ants weaker', () => {
  const c = AL.World.nightMod('carpenter', 1), f = AL.World.nightMod('fire', 1), d = AL.World.nightMod('fire', 0);
  assert.ok(c.speed > 1 && c.dps > 1); assert.ok(f.speed < 1 && f.vis < 1); assert.equal(d.speed, 1);
  const w = make({ species: 'carpenter' });
  AL.World.setTime(w, { timeOfDay: 0.02 }); run(w, 0.1);
  assert.ok(w.env.mods.carpenter.speed > 1.1);
});

test('weather: the first two minutes are fair, then the season signature shows up; clouds gather before rain', () => {
  const w = make();
  let first = null; const off = AL.on('weather', (ww, d) => { if (ww === w && !first) first = { kind: d.kind, t: ww.t }; });
  run(w, 100); assert.equal(first, null, 'no weather change during the grace period');
  AL.World.forceWeather(w, 'clear', 30);
  w.weather.next = 'storm';
  run(w, 30 - AL.WORLD_TUNE.WEATHER_LEAD + 20);
  assert.ok(w.weather.cloud > 0.5, 'clouds build before the storm (' + w.weather.cloud.toFixed(2) + ')');
  assert.ok(w.env.rain < 0.1, 'but no rain yet');
  run(w, 15);
  assert.equal(w.weather.kind, 'storm'); assert.ok(w.env.rain > 0.6);
  off();
});

test('rain washes trails away except under shelters', () => {
  const w = make(), S = w.surface, g = w.pher.food[0];
  let si = -1; for (let i = 0; i < S.shelter.length; i++) if (S.shelter[i] && !S.blocked[i]) { si = i; break; }
  assert.ok(si >= 0, 'map has a sheltered cell');
  const sx = (si % S.gw + 0.5) * S.cell, sy = ((si / S.gw | 0) + 0.5) * S.cell, ox = 2000, oy = 200;
  g.deposit(sx, sy, 5); g.deposit(ox, oy, 5);
  AL.World.forceWeather(w, 'storm', 120, true);
  run(w, 6);
  const open = g.sample(ox, oy), dry = g.sample(sx, sy);
  assert.ok(open < dry * 0.6, 'open trail washed (' + open.toFixed(3) + ' vs sheltered ' + dry.toFixed(3) + ')');
});

test('storms soak the soil and flood nests from the bottom, then it drains', () => {
  const w = make();
  let flooded = false; const off = AL.on('flood', (ww, d) => { if (ww === w && d.on) flooded = true; });
  AL.World.forceWeather(w, 'storm', 200, true);
  run(w, 70);
  const lvl = AL.World.floodLevel(w, 0);
  assert.ok(lvl > 0.1 && lvl <= AL.WORLD_TUNE.FLOOD_MAX, 'flood level ' + lvl.toFixed(2));
  assert.ok(flooded, 'flood event');
  assert.ok(AL.World.floodInflow(w, 0) > w.env.rain * 3.2, 'inflow includes saturated soil');
  AL.World.forceWeather(w, 'heat', 600, true); AL.World.setTime(w, { season: 'summer', timeOfDay: 0.5 });
  run(w, 150);
  assert.ok(AL.World.floodLevel(w, 0) < lvl * 0.5, 'drains in the sun');
  off();
});

test('heat waves slow ants in open sun; shade cancels it', () => {
  const w = make({ fog: false });
  AL.World.setTime(w, { season: 'summer', timeOfDay: 0.55 }); AL.World.forceWeather(w, 'heat', 600, true);
  run(w, 20);
  assert.ok(w.env.heat > 0.5 && w.env.sunSlow > 0.2, 'heat ' + w.env.heat.toFixed(2));
  const A = w.ants, c = w.player, S = w.surface;
  // two homing foragers the same distance from home; make one of them shaded all the way
  const a = A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 300, c.y, Math.PI, w.R), b = A.spawn(0, AL.CASTE.FORAGER, 0, c.x, c.y - 300, Math.PI / 2, w.R);
  A.state[a] = A.state[b] = ST.HOMING;
  for (let y = c.y - 320; y <= c.y + 20; y += 8) for (let x = c.x - 20; x <= c.x + 20; x += 8) { const i = ((y / S.cell) | 0) * S.gw + ((x / S.cell) | 0); w.shade[i] = 1; }
  for (let x = c.x; x <= c.x + 320; x += 8) for (let dy = -20; dy <= 20; dy += 8) { const i = (((c.y + dy) / S.cell) | 0) * S.gw + ((x / S.cell) | 0); w.shade[i] = 0; }
  const d0a = Math.hypot(A.x[a] - c.x, A.y[a] - c.y), d0b = Math.hypot(A.x[b] - c.x, A.y[b] - c.y);
  run(w, 3);
  const da = d0a - Math.hypot(A.x[a] - c.x, A.y[a] - c.y), db = d0b - Math.hypot(A.x[b] - c.x, A.y[b] - c.y);
  assert.ok(da < db * 0.8, 'sun ant covered ' + da.toFixed(1) + ' vs shade ant ' + db.toFixed(1));
});

test('winter: everyone heads home; colonies without a nest model park ants inside and wake them in spring', () => {
  const w = make({ fog: false }), A = w.ants;
  const rival = w.colonies[1];
  const surf = col => { let n = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col && A.layer[i] === 0) n++; return n; };
  run(w, 5);
  const before = surf(1);
  assert.ok(before > 10, 'rival foragers out (' + before + ')');
  AL.World.setTime(w, { season: 'winter', timeOfDay: 0.4 });
  run(w, 60);
  assert.ok(surf(1) < before * 0.25, 'rival ants went home (' + surf(1) + ' still out)');
  if (w.player.enter) assert.ok(surf(0) < 6, 'player ants stay in the nest (' + surf(0) + ' out)');
  let parked = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 1 && A.layer[i] === AL.LAYER.INSIDE) parked++;
  if (!rival.enter) assert.ok(parked > 10, 'parked inside: ' + parked);
  AL.World.setTime(w, { season: 'spring', timeOfDay: 0.4 });
  run(w, 10);
  if (!rival.enter) assert.ok(surf(1) > parked * 0.6, 'woke up in spring (' + surf(1) + ')');
});

test('ants left outside in winter freeze after the grace period', () => {
  const w = make({ fog: false }), A = w.ants;
  AL.World.setTime(w, { season: 'winter', timeOfDay: 0.4 });
  // an ant stuck far away (blocked in by rocks would be ideal; just keep resetting it)
  const i = A.spawn(1, AL.CASTE.WORKER, 0, 3800, 2900, 0, w.R);
  let died = false; const off = AL.on('antDied', (ww, d) => { if (ww === w && d.i === i && d.cause === 'cold') died = true; });
  for (let k = 0; k < TICKS(AL.WORLD_TUNE.COLD_GRACE + 25) && A.state[i]; k++) { A.x[i] = 3800; A.y[i] = 2900; AL.Sim.step(w); }
  assert.ok(died, 'froze');
  off();
});
