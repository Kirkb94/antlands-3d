// Antlands World stage: the clock (day/night), seasons, weather and what they do to the backyard.
// Owns world.env (CONTRACT.md section 4) and adds world.clock, world.weather, world.flood, world.shade.
// Also holds the small shared helpers the other world-* modules use (ant queries, hurting ants).
// Sim only: no DOM, runs in node --test.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); }
const ST = AL.ST, T = AL.TUNE, LAYER = AL.LAYER;

// ---- tuning ------------------------------------------------------------------------------
// One year = 3 + 3 + 2 days at 240 s plus 2 winter days at 120 s = 36 real minutes at 1x, so a
// 30-50 minute match sees spring, summer, autumn, the winter truce and (in long games) a second spring.
const WT = AL.WORLD_TUNE = Object.assign({
  START_TOD: 7.25 / 24,       // matches open at 7:15 on the first spring morning
  SEASONS: [
    { key: 'spring', name: 'Spring', days: 3, pace: 1,   temp: 15, sunrise: 6.0, sunset: 19.5, weather: { clear: 3, cloudy: 2, rain: 3, storm: 1 }, signature: 'rain', colour: '#8fcf5a' },
    { key: 'summer', name: 'Summer', days: 3, pace: 1,   temp: 26, sunrise: 5.5, sunset: 20.5, weather: { clear: 3, cloudy: 1, heat: 3, storm: 1, rain: 0.4 }, signature: 'heat', colour: '#f2c14e' },
    { key: 'autumn', name: 'Autumn', days: 2, pace: 1,   temp: 12, sunrise: 6.5, sunset: 18.5, weather: { clear: 2, cloudy: 3, rain: 3, storm: 1 }, signature: 'storm', colour: '#d9822b' },
    { key: 'winter', name: 'Winter', days: 2, pace: 0.5, temp: -3, sunrise: 7.5, sunset: 17.0, weather: { clear: 2, cloudy: 2, snow: 3 }, signature: 'snow', colour: '#bfe3f2' },
  ],
  TWILIGHT: 0.9,              // hours of dawn/dusk blend either side of sunrise/sunset
  WEATHER_LEAD: 25,           // seconds of gathering clouds before rain arrives (the telegraph)
  GRACE: 120,                 // first seconds of a match are always fair weather
  WASH: 0.16,                 // share of trail strength lost per second at full rain (shelters exempt)
  SNOW_WASH: 0.03,
  SOAK: 0.014, DRAIN: 0.004,  // soil saturation per second of full rain / drained per second
  FLOOD_AT: 0.3,              // saturation where the lowest tunnels start to flood
  FLOOD_MAX: 0.6,             // at most this share of a nest's depth floods (from the bottom up)
  SUN_SLOW: 0.4,              // speed lost in open sun at full heat (shade cancels it)
  SUN_SLOW_FALLBACK: true,    // apply it after the move until behavior.js reads env.sunSlow itself
  COLD_GRACE: 30, COLD_DPS: 0.6,  // winter: seconds to get home, then hp/s lost by ants left outside
  WINTER_METABOLISM: 0.35,    // food use multiplier while hibernating
}, AL.WORLD_TUNE || {});

const KINDS = AL.WEATHER = Object.assign({
  clear:  { name: 'Clear',     icon: 'sun',   cloud: 0.12, rain: 0,    heat: 0, snow: 0, wind: 0.25, dur: [70, 150] },
  cloudy: { name: 'Overcast',  icon: 'cloud', cloud: 0.62, rain: 0,    heat: 0, snow: 0, wind: 0.45, dur: [45, 100] },
  rain:   { name: 'Rain',      icon: 'rain',  cloud: 0.86, rain: 0.45, heat: 0, snow: 0, wind: 0.55, dur: [45, 85] },
  storm:  { name: 'Rainstorm', icon: 'storm', cloud: 1,    rain: 1,    heat: 0, snow: 0, wind: 1,    dur: [32, 55], storm: true },
  heat:   { name: 'Heat wave', icon: 'heat',  cloud: 0,    rain: 0,    heat: 1, snow: 0, wind: 0.1,  dur: [80, 140] },
  snow:   { name: 'Snow',      icon: 'snow',  cloud: 0.75, rain: 0,    heat: 0, snow: 1, wind: 0.5,  dur: [60, 120] },
}, AL.WEATHER || {});

// night strength per species and creature: 1 = unchanged, blended in by env.night.
AL.NIGHT_MODS = Object.assign({
  fire:       { speed: 0.82, dps: 0.95, vis: 0.6 },
  leafcutter: { speed: 0.95, dps: 1.0,  vis: 0.7 },
  carpenter:  { speed: 1.12, dps: 1.2,  vis: 0.95 },   // nocturnal: stronger after dark
  army:       { speed: 0.9,  dps: 1.1,  vis: 0.5 },
  spider:     { speed: 1.15, dps: 1.35, vis: 1.6 },    // hunts by night
  beetle:     { speed: 1.2,  dps: 1.1,  vis: 1.2 },
  _default:   { speed: 0.82, dps: 1.0,  vis: 0.6 },
}, AL.NIGHT_MODS || {});

function nightMod(key, night, out) {
  const m = AL.NIGHT_MODS[key] || AL.NIGHT_MODS._default;
  out = out || {};
  out.speed = 1 + (m.speed - 1) * night; out.dps = 1 + (m.dps - 1) * night; out.vis = 1 + (m.vis - 1) * night;
  return out;
}

// ---- shared helpers ----------------------------------------------------------------------
// surface ants within r of (x,y), gathered from the spatial hash into buf (no allocation).
// Valid during tick/post/second (the hash is rebuilt by updateSurface every tick).
const BUF = new Int32Array(8192);
function antsIn(world, x, y, r, buf) {
  buf = buf || BUF;
  const h = world.hash, A = world.ants, inv = h.inv, r2 = r * r, cap = buf.length;
  let cx0 = Math.floor((x - r) * inv), cx1 = Math.floor((x + r) * inv), cy0 = Math.floor((y - r) * inv), cy1 = Math.floor((y + r) * inv);
  if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0; if (cx1 >= h.w) cx1 = h.w - 1; if (cy1 >= h.h) cy1 = h.h - 1;
  let n = 0;
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    for (let j = h.head[cy * h.w + cx]; j !== -1; j = h.next[j]) {
      if (!A.state[j] || A.layer[j] !== 0) continue;
      const dx = A.x[j] - x, dy = A.y[j] - y;
      if (dx * dx + dy * dy <= r2) { buf[n++] = j; if (n >= cap) return n; }
    }
  }
  return n;
}
// hurt / kill an ant through the core combat API when it exists (M3), with a faithful fallback
function hurtAnt(world, i, dmg, cause) {
  const A = world.ants;
  if (!A.state[i]) return true;
  if (AL.Combat && AL.Combat.hitAnt) { AL.Combat.hitAnt(world, i, dmg, cause || 'creature'); return !A.state[i]; }
  A.hp[i] -= dmg;
  if (A.hp[i] <= 0) { killAnt(world, i, cause); return true; }
  return false;
}
function killAnt(world, i, cause, corpse) {
  const A = world.ants;
  if (!A.state[i]) return;
  if (AL.Combat && AL.Combat.killAnt && corpse !== false) return AL.Combat.killAnt(world, i, cause || 'creature');
  if (A.state[i] === ST.DRAG && AL.Behavior.releaseDrag) AL.Behavior.releaseDrag(world, i);
  const c = A.col[i], x = A.x[i], y = A.y[i], layer = A.layer[i], caste = A.caste[i];
  if (corpse !== false && layer === 0) AL.Surface.dropCorpse(world.surface, x, y, c, 1);
  const col = world.colonies[c]; if (col) col.stats.died++;
  A.kill(i);
  AL.emit(world, 'antDied', { col: c, i, caste, x, y, layer, cause: cause || 'creature' });
}
const cellOf = (S, x, y) => {
  const cx = (x / S.cell) | 0, cy = (y / S.cell) | 0;
  return (cx < 0 || cy < 0 || cx >= S.gw || cy >= S.gh) ? -1 : cy * S.gw + cx;
};
// 0 open sun, 1 tree canopy (dappled: no heat penalty, birds can't dive), 2 shelter (rock/log overhang:
// also dry in rain and safe from feet and the mower)
function shadeAt(world, x, y) { const i = cellOf(world.surface, x, y); return i < 0 || !world.shade ? 0 : world.shade[i]; }
function isExposed(world, x, y, level) { return shadeAt(world, x, y) < (level || 1); }

function buildShade(world) {
  const S = world.surface, n = S.gw * S.gh;
  const sh = world.shade && world.shade.length === n ? world.shade : (world.shade = new Uint8Array(n));
  sh.fill(0);
  const c = S.cell;
  for (const t of S.trees) {
    const r = t.r * 0.85, x0 = Math.max(0, ((t.x - r) / c) | 0), x1 = Math.min(S.gw - 1, ((t.x + r) / c) | 0);
    const y0 = Math.max(0, ((t.y - r) / c) | 0), y1 = Math.min(S.gh - 1, ((t.y + r) / c) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + 0.5) * c - t.x - 30, dy = (cy + 0.5) * c - t.y - 40;   // shade falls to the lower right
      if (dx * dx + dy * dy <= r * r) sh[cy * S.gw + cx] = 1;
    }
  }
  // overhangs: a ring round every log and big rock counts as shelter too
  for (const l of S.logs) AL.Surface.stampEllipse(S, S.shelter, l.x, l.y, l.len / 2 + 34, l.r + 40, l.rot, 1);
  for (const r of S.rocks) if (r.shelter || r.rx >= 60) AL.Surface.stampEllipse(S, S.shelter, r.x, r.y, r.rx + 60, r.ry + 52, r.rot, 1);
  for (let i = 0; i < n; i++) if (S.shelter[i] && !S.blocked[i]) sh[i] = 2;
  return sh;
}

// ---- clock -------------------------------------------------------------------------------
const SEAS = () => WT.SEASONS;
function seasonDur(s) { return s.days * T.DAY * s.pace; }
function yearDur() { let d = 0; for (const s of SEAS()) d += seasonDur(s); return d; }

function makeClock(opts) {
  const c = { time: 0, day: 0, dayOfSeason: 0, season: 0, year: 1, tod: WT.START_TOD, hour: 0, daylight: 1, night: 0, dusk: 0,
    seasonT: 0, yearT: 0, winterIn: 0, warned: false, wasNight: false };
  if (opts.season != null) c.season = typeof opts.season === 'string' ? Math.max(0, SEAS().findIndex(s => s.key === opts.season)) : opts.season | 0;
  if (opts.timeOfDay != null) c.tod = AL.clamp(+opts.timeOfDay, 0, 0.9999);
  if (opts.seasonDay != null) c.dayOfSeason = Math.min(SEAS()[c.season].days - 1, opts.seasonDay | 0);
  return c;
}
function sunCalc(c) {
  const s = SEAS()[c.season], h = c.tod * 24, tw = WT.TWILIGHT;
  let d;
  if (h < s.sunrise - tw || h > s.sunset + tw) d = 0;
  else if (h < s.sunrise + tw) d = AL.smooth((h - (s.sunrise - tw)) / (2 * tw));
  else if (h > s.sunset - tw) d = AL.smooth(((s.sunset + tw) - h) / (2 * tw));
  else d = 1;
  c.hour = h; c.daylight = d; c.night = 1 - d; c.dusk = d > 0 && d < 1 ? 4 * d * (1 - d) : 0;
}
function advanceClock(world, dt) {
  const c = world.clock;
  let s = SEAS()[c.season];
  c.time += dt;
  c.tod += dt / (T.DAY * s.pace);
  while (c.tod >= 1) {
    c.tod -= 1; c.day++; c.dayOfSeason++;
    if (c.dayOfSeason >= s.days) {
      c.dayOfSeason = 0; c.season = (c.season + 1) % SEAS().length; if (c.season === 0) c.year++;
      s = SEAS()[c.season];
      onSeason(world);
    }
  }
  sunCalc(c);
  c.seasonT = (c.dayOfSeason + c.tod) / s.days;
  let before = 0; for (let k = 0; k < c.season; k++) before += seasonDur(SEAS()[k]);
  c.yearT = (before + c.seasonT * seasonDur(s)) / yearDur();
  // seconds until winter (0 while it is winter)
  if (s.key === 'winter') c.winterIn = 0;
  else {
    let left = (s.days - c.dayOfSeason - c.tod) * T.DAY * s.pace;
    for (let k = c.season + 1; k < SEAS().length && SEAS()[k].key !== 'winter'; k++) left += seasonDur(SEAS()[k]);
    c.winterIn = left;
  }
  if (c.night > 0.5 !== c.wasNight) { c.wasNight = c.night > 0.5; AL.emit(world, c.wasNight ? 'dusk' : 'dawn', { day: c.day + 1 }); }
}

// ---- weather ---------------------------------------------------------------------------------
function makeWeather() {
  return { kind: 'clear', name: 'Clear', timer: WT.GRACE, dur: WT.GRACE, next: 'cloudy', seen: {},
    rain: 0, heat: 0, cloud: 0.12, snow: 0, wind: 0.25, windA: 0.6, wx: 0.2, wy: 0.15,
    storm: false, flash: 0, flashX: 0, flashY: 0, wet: 0, frost: 0, heatFor: 0 };
}
function pickWeather(world, avoid) {
  const c = world.clock, s = SEAS()[c.season], W = world.weather;
  // every season shows its signature weather at least once (spring rain, summer heat wave, autumn storm, winter snow)
  if (!W.seen[s.key + ':' + s.signature] && c.seasonT > 0.3 && avoid !== s.signature) return s.signature;
  // the biome shifts the odds (terrain.js): the desert hardly rains and bakes, the wetland rains a lot
  const B = AL.BIOMES && AL.BIOMES[world.biomeKey], bw = B && B.weather, wt = k => s.weather[k] * (!bw ? 1 : k === 'rain' || k === 'storm' ? bw.rain : k === 'heat' ? bw.heat : 1);
  let tot = 0;
  for (const k in s.weather) if (k !== avoid) tot += wt(k);
  let r = world.R() * tot;
  for (const k in s.weather) { if (k === avoid) continue; r -= wt(k); if (r <= 0) return k; }
  return 'clear';
}
function startWeather(world, kind, dur) {
  const W = world.weather, prev = W.kind, k = KINDS[kind] || KINDS.clear;
  W.kind = kind; W.name = k.name; W.storm = !!k.storm; W.forecasted = false;
  W.dur = W.timer = dur || AL.lerp(k.dur[0], k.dur[1], world.R());
  W.seen[SEAS()[world.clock.season].key + ':' + kind] = true;
  W.next = pickWeather(world, kind);
  if (kind !== 'heat') W.heatFor = 0;
  if (prev !== kind) AL.emit(world, 'weather', { kind, prev, name: k.name, dur: W.dur, next: W.next });
}
function onSeason(world) {
  const c = world.clock, s = SEAS()[c.season], W = world.weather;
  c.warned = false;
  AL.emit(world, 'season', { season: s.key, name: s.name, year: c.year, day: c.day + 1 });
  // weather that doesn't belong to the new season ends now; winter opens with the first snowfall
  if (s.key === 'winter') startWeather(world, 'snow');
  else if (!s.weather[W.kind]) startWeather(world, s.key === 'spring' ? 'rain' : 'clear');
  else W.next = pickWeather(world, W.kind);
}
const approach = (v, t, dt, tau) => v + (t - v) * Math.min(1, dt / tau);
function updateWeather(world, dt) {
  const W = world.weather, c = world.clock;
  W.timer -= dt;
  if (W.timer <= 0) startWeather(world, W.next);
  const k = KINDS[W.kind] || KINDS.clear, nk = KINDS[W.next] || KINDS.clear;
  let cloudT = k.cloud, rainT = k.rain, windT = k.wind;
  // the telegraph: clouds gather and the wind picks up before rain or a storm arrives
  if (W.timer < WT.WEATHER_LEAD && nk.rain > 0 && W.next !== W.kind) {
    const f = 1 - W.timer / WT.WEATHER_LEAD;
    if (!W.forecasted) { W.forecasted = true; AL.emit(world, 'forecast', { kind: W.next, name: nk.name, in: W.timer }); }
    cloudT = Math.max(cloudT, AL.lerp(cloudT, nk.cloud, f)); windT = Math.max(windT, AL.lerp(windT, nk.wind, f));
    if (W.timer < 5) rainT = Math.max(rainT, nk.rain * 0.25);
  }
  W.cloud = approach(W.cloud, cloudT, dt, 7);
  W.rain = approach(W.rain, rainT, dt, 7); if (W.rain < 0.004) W.rain = 0;
  W.heat = approach(W.heat, k.heat, dt, 18); if (W.heat < 0.004) W.heat = 0;
  W.snow = approach(W.snow, k.snow, dt, 10); if (W.snow < 0.004) W.snow = 0;
  W.wind = approach(W.wind, windT, dt, 10);
  W.windA += (world.R() - 0.5) * dt * 0.08;
  W.wx = AL.cos(W.windA) * W.wind; W.wy = AL.sin(W.windA) * W.wind;
  if (W.kind === 'heat') W.heatFor += dt;
  // wet ground, frost cover (melts slowly into spring)
  W.wet = AL.clamp(W.wet + dt * (W.rain / 18 - (1 + W.heat * 3) / 110), 0, 1);
  const winter = SEAS()[c.season].key === 'winter';
  const f0 = W.frost;
  W.frost = approach(W.frost, winter ? 1 : 0, dt, winter ? 35 : 70); if (W.frost < 0.003) W.frost = 0;
  W.melt = Math.max(0, f0 - W.frost) / dt;   // melt rate, feeds spring floods
  // lightning during storms (visual + event; strikes don't hurt anyone)
  W.flash = Math.max(0, W.flash - dt * 2.5);
  if (W.storm && W.rain > 0.7 && world.R() < dt * 0.14) {
    W.flash = 1; W.flashX = world.R() * world.surface.W; W.flashY = world.R() * world.surface.H;
    AL.emit(world, 'lightning', { x: W.flashX, y: W.flashY });
  }
}

// ---- env (the shape the core reads) -------------------------------------------------------------
function updateEnv(world) {
  const c = world.clock, W = world.weather, e = world.env, s = SEAS()[c.season];
  const winter = s.key === 'winter';
  e.day = c.day + 1; e.timeOfDay = c.tod; e.night = c.night; e.dusk = c.dusk;
  e.light = (1 - 0.82 * c.night) * (1 - 0.22 * W.cloud);
  e.rain = W.rain; e.snow = W.snow; e.cloud = W.cloud; e.wind = W.wind; e.windX = W.wx; e.windY = W.wy; e.storm = W.storm;
  // heat waves bite in the afternoon sun, much less at night or under cloud
  e.heat = W.heat * (0.35 + 0.65 * c.daylight) * (1 - 0.6 * W.cloud);
  e.temp = s.temp + 6 * (c.daylight - 0.5) + 10 * e.heat - 4 * W.rain - 2 * W.cloud - 3 * W.snow + ((AL.BIOMES && AL.BIOMES[world.biomeKey] && AL.BIOMES[world.biomeKey].weather.temp) || 0);
  e.season = s.key; e.seasonName = s.name; e.seasonT = c.seasonT; e.yearT = c.yearT; e.year = c.year;
  e.winter = winter; e.hibernate = winter; e.truce = winter;
  e.forage = winter ? 0 : 1;
  e.metabolism = winter ? WT.WINTER_METABOLISM : 1;
  e.thirst = 1 + 2 * e.heat;
  e.sunSlow = WT.SUN_SLOW * e.heat;
  e.frost = W.frost; e.wet = W.wet;
  e.winterIn = c.winterIn;
  if (!e.mods) e.mods = {};
  for (const col of world.colonies) e.mods[col.spKey] = nightMod(col.spKey, c.night, e.mods[col.spKey]);
  e.flood = world.flood ? world.flood.level[0] : 0;
}

// ---- flooding: soil saturation per colony mound ----------------------------------------------------
function makeFlood(world) {
  const n = world.colonies.length;
  return { sat: new Float32Array(n), level: new Float32Array(n), extra: new Float32Array(n), on: new Uint8Array(n) };
}
// extra water at a colony's mound this second (sprinklers, puddles): 1 = like a second of full rain
function addWater(world, col, amt) { if (world.flood && col >= 0 && col < world.flood.extra.length) world.flood.extra[col] += amt; }
// share of the colony's nest depth under water, from the bottom up (0 dry .. FLOOD_MAX)
function floodLevel(world, col) { return world.flood && col < world.flood.level.length ? world.flood.level[col] : 0; }
// water entering the nest this second, in the nest model's units (what nest.js uses as env.rain * 3.2)
function floodInflow(world, col) {
  const F = world.flood; if (!F || col >= F.sat.length) return (world.env.rain || 0) * 3.2;
  const c = world.colonies[col], sheltered = shadeAt(world, c.x, c.y) === 2 ? 0.3 : 1;
  return (world.env.rain * sheltered + F.lastExtra[col]) * 3.2 + Math.max(0, F.sat[col] - WT.FLOOD_AT) * 2;
}
function updateFlood(world, dt) {
  const F = world.flood, W = world.weather, e = world.env;
  if (!F.lastExtra) F.lastExtra = new Float32Array(F.sat.length);
  for (let k = 0; k < F.sat.length; k++) {
    const c = world.colonies[k], sheltered = shadeAt(world, c.x, c.y) === 2 ? 0.3 : 1;
    const inflow = W.rain * sheltered + F.extra[k] + (W.melt || 0) * 12;
    F.sat[k] = AL.clamp(F.sat[k] + dt * (inflow * WT.SOAK - WT.DRAIN - e.heat * 0.006), 0, 1);
    const lvl = WT.FLOOD_MAX * AL.smooth(AL.clamp((F.sat[k] - WT.FLOOD_AT) / (1 - WT.FLOOD_AT), 0, 1));
    F.level[k] = lvl;
    if (!F.on[k] && lvl > 0.08) { F.on[k] = 1; AL.emit(world, 'flood', { col: k, on: true, level: lvl }); }
    else if (F.on[k] && lvl < 0.04) { F.on[k] = 0; AL.emit(world, 'flood', { col: k, on: false, level: lvl }); }
    F.lastExtra[k] = F.extra[k]; F.extra[k] = 0;
  }
}

// ---- local trail wash (sprinklers); global rain uses the core AL.Sim.washTrails -------------------------
function washDisc(world, x, y, r, keep) {
  const S = world.surface, c = S.cell, sh = S.shelter;
  const x0 = Math.max(0, ((x - r) / c) | 0), x1 = Math.min(S.gw - 1, ((x + r) / c) | 0);
  const y0 = Math.max(0, ((y - r) / c) | 0), y1 = Math.min(S.gh - 1, ((y + r) / c) | 0);
  for (const g of world.pherList) {
    if (g.x1 < 0 || g.x1 < x0 || g.x0 > x1 || g.y1 < y0 || g.y0 > y1) continue;
    const d = g.data;
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const i = cy * S.gw + cx; if (sh[i] || !d[i]) continue;
      const dx = (cx + 0.5) * c - x, dy = (cy + 0.5) * c - y;
      if (dx * dx + dy * dy <= r * r) d[i] *= keep;
    }
  }
}

// ---- winter: hibernation ----------------------------------------------------------------------
// With a nest model (world.enterNest) ants simply go home and the nest keeps them in (env.winter).
// Without one, ants that reach the mound are parked (layer INSIDE) and walk back out in spring.
function park(world, i) {
  const H = world.hib, A = world.ants;
  if (!H.idx) { H.idx = new Int32Array(A.cap); H.uid = new Int32Array(A.cap); }
  if (H.n >= H.idx.length) return;
  const col = world.colonies[A.col[i]];
  A.layer[i] = LAYER.INSIDE; A.state[i] = ST.WANDER; A.carry[i] = 0;
  A.x[i] = A.px[i] = col.x; A.y[i] = A.py[i] = col.y;
  H.idx[H.n] = i; H.uid[H.n] = A.uid[i]; H.n++;
}
function unparkSome(world, max) {
  const H = world.hib, A = world.ants, R = world.R;
  let done = 0;
  while (H.n > 0 && done < max) {
    H.n--; const i = H.idx[H.n];
    if (A.uid[i] !== H.uid[H.n] || !A.state[i] || A.layer[i] !== LAYER.INSIDE) continue;
    const col = world.colonies[A.col[i]], a = R() * AL.TAU;
    A.layer[i] = LAYER.SURFACE; A.state[i] = ST.WANDER; A.timer[i] = 0; A.a[i] = a;
    A.x[i] = A.px[i] = col.x + AL.cos(a) * 6; A.y[i] = A.py[i] = col.y + AL.sin(a) * 6;
    done++;
  }
}
function winterSweep(world) {
  const A = world.ants, H = world.hib, e = world.env;
  H.cold += 1;
  const cold = H.cold > WT.COLD_GRACE;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== 0) continue;
    const st = A.state[i];
    if (st === ST.WANDER) { A.state[i] = ST.HOMING; A.timer[i] = 0; }
    else if (st === ST.DRAG) { AL.Behavior.releaseDrag(world, i); A.state[i] = ST.HOMING; }
    if (cold && A.caste[i] !== AL.CASTE.QUEEN) hurtAnt(world, i, WT.COLD_DPS * (1 + e.snow * 0.5), 'cold');
  }
}

// ---- debug / scripting ------------------------------------------------------------------------
function setTime(world, o) {
  const c = world.clock;
  if (o.season != null) {
    const k = typeof o.season === 'string' ? SEAS().findIndex(s => s.key === o.season) : o.season | 0;
    if (k >= 0 && k !== c.season) { c.season = k; c.dayOfSeason = 0; onSeason(world); }
  }
  if (o.seasonDay != null) c.dayOfSeason = Math.min(SEAS()[c.season].days - 1, o.seasonDay | 0);
  if (o.timeOfDay != null) c.tod = AL.clamp(+o.timeOfDay, 0, 0.9999);
  advanceClock(world, 0); updateEnv(world);
}
function forceWeather(world, kind, dur, instant) {
  if (!KINDS[kind]) return;
  startWeather(world, kind, dur);
  if (instant) { const W = world.weather, k = KINDS[kind]; W.cloud = k.cloud; W.rain = k.rain; W.heat = k.heat; W.snow = k.snow; W.wind = k.wind; }
  updateEnv(world);
}
// strings for HUDs
function fmtTime(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function info(world) {
  const c = world.clock, W = world.weather, s = SEAS()[c.season], h = Math.floor(c.hour), m = Math.floor((c.hour - h) * 60);
  const nk = KINDS[W.next];
  return {
    season: s.key, seasonName: s.name, colour: s.colour, day: c.dayOfSeason + 1, days: s.days, year: c.year,
    clock: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'), night: c.night > 0.5,
    weather: W.kind, weatherName: W.name, icon: (KINDS[W.kind] || KINDS.clear).icon, temp: Math.round(world.env.temp),
    next: W.next, nextName: nk ? nk.name : '', nextIn: fmtTime(W.timer),
    forecast: nk && nk.rain > 0 && W.timer < 60 && W.kind !== W.next ? nk.name + ' in ' + fmtTime(W.timer) : '',
    winterIn: c.winterIn, winterSoon: c.winterIn > 0 && c.winterIn < T.DAY, winterText: c.winterIn > 0 ? 'Winter in ' + fmtTime(c.winterIn) : 'Hibernating - truce',
    flood: floodLevel(world, 0),
  };
}

AL.World = { WT, KINDS, nightMod, antsIn, hurtAnt, killAnt, shadeAt, isExposed, buildShade, addWater, floodLevel, floodInflow,
  washDisc, setTime, forceWeather, info, fmtTime, yearDur, seasonDur, SEASONS: WT.SEASONS };

AL.registerSystem({
  id: 'world-time', order: 10,
  enabled(opts) { return opts.world !== false; },
  init(world, opts) {
    world.clock = makeClock(opts.worldTime || {});
    world.weather = makeWeather();
    world.flood = makeFlood(world);
    world.hib = { n: 0, idx: null, uid: null, cold: 0, on: false };
    sunCalc(world.clock);
    buildShade(world);
    // a match that starts in winter (scripted / debug) opens under snow
    if (WT.SEASONS[world.clock.season].key === 'winter') { world.weather.frost = 1; startWeather(world, 'snow'); }
    if (opts.worldTime && opts.worldTime.weather) forceWeather(world, opts.worldTime.weather, null, true);
    advanceClock(world, 0); updateEnv(world);
    // hibernation for colonies without a nest model (no colony.enter): ants reaching home in winter stay in
    const arrive0 = world.arrive;
    world.arrive = function (w, i) {
      const col = w.colonies[w.ants.col[i]];
      arrive0(w, i);
      if (w.env.winter && !(col && col.enter) && !w.enterNest && w.ants.state[i] && w.ants.layer[i] === 0) park(w, i);
    };
  },
  pre(world, dt) { advanceClock(world, dt); updateWeather(world, dt); updateEnv(world); },
  post(world, dt) {
    // heat: ants crossing open sun are slowed (shade cancels it). Fallback until behavior.js reads env.sunSlow.
    const e = world.env;
    if (!WT.SUN_SLOW_FALLBACK || e.sunSlow < 0.01) return;
    const A = world.ants, sh = world.shade, S = world.surface, inv = 1 / S.cell, gw = S.gw, k = 1 - e.sunSlow;
    const X = A.x, Y = A.y, PX = A.px, PY = A.py, STA = A.state, LY = A.layer;
    const lod = world.lod, v = world.mp ? world.mpView || AL.Sim.ALL : world.view, tick = world.tick;
    for (let i = 0; i < A.high; i++) {
      const st = STA[i];
      // skip ants that position themselves (dragging, stage states >= 40) and ants the sim LOD skipped this tick
      if (!st || LY[i] !== 0 || st === ST.DRAG || st >= 40) continue;
      const x = X[i], y = Y[i];
      if (lod && (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) && ((i + tick) & 1) !== 0) continue;
      if (sh[((y * inv) | 0) * gw + ((x * inv) | 0)]) continue;
      X[i] = PX[i] + (x - PX[i]) * k; Y[i] = PY[i] + (y - PY[i]) * k;
    }
  },
  second(world) {
    const e = world.env, W = world.weather, H = world.hib, c = world.clock;
    // rain and snow wash trails away (the core skips sheltered cells)
    const rate = WT.WASH * W.rain + WT.SNOW_WASH * W.snow;
    if (rate > 0.002 && AL.Sim.washTrails) AL.Sim.washTrails(world, 1 - rate);
    updateFlood(world, 1);
    if (!c.warned && c.winterIn > 0 && c.winterIn < T.DAY) { c.warned = true; AL.emit(world, 'winterSoon', { in: c.winterIn }); }
    if (e.winter) {
      if (!H.on) { H.on = true; H.cold = 0; AL.emit(world, 'hibernate', { on: true }); }
      winterSweep(world);
    } else if (H.on) { H.on = false; AL.emit(world, 'hibernate', { on: false }); }
    if (!e.winter && H.n > 0 && c.daylight > 0.3) unparkSome(world, 12);
  },
});

if (NODE) module.exports = AL.World;
})(typeof window !== 'undefined' ? window : globalThis);
