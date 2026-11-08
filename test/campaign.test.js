// Campaign mode: mission data, the mission runner (objective trackers, script, win / fail), saved progress, and
// every mission won headlessly by a scripted 'cheat' strategy (extra ants, stock, forced events) that still goes
// through the real sim and the real trackers.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'fog', 'founding-sites', 'founding', 'founding-race', 'species', 'flight', 'expansion', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'brush', 'cmd', 'raids']) require('../public/' + f + '.js');
const Cp = require('../public/campaign.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, N = AL.Nest, Fd = AL.Founding, FR = AL.FoundingRace;

const step = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
// run until the mission ends (or maxSecs), calling each(w, second) once per sim second
function play(w, maxSecs, each) {
  for (let s = 0; s < maxSecs && !w.over; s++) { if (each) each(w, s); step(w, 1); }
  return w.over && w.over.campaign;
}
const goal = (w, id) => { const st = Cp.status(w); return st.goals.concat(st.bonus).find(g => g.id === id); };
const mission = (id, extra) => AL.Sim.createWorld(Cp.optsFor(id, extra));
const soldiers = (w, x, y, n, state) => {
  for (let k = 0; k < n; k++) {
    const a = k / n * AL.TAU, i = w.ants.spawn(0, C.SOLDIER, L.SURFACE, x + Math.cos(a) * 20, y + Math.sin(a) * 20, a, w.R);
    if (state != null) { w.ants.state[i] = state; w.ants.tx[i] = x; w.ants.ty[i] = y; }
  }
};
const won = (r, id) => { assert.ok(r, id + ': the mission ended'); assert.equal(r.id, id); assert.equal(r.win, true, id + ': ' + r.reason); assert.ok(r.stars >= 1 && r.stars <= 3); };

// ---- data ----------------------------------------------------------------------------------------------------
test('ten missions, in order, each with setup, objectives, briefing and debrief; trackers exist for every objective', () => {
  assert.equal(Cp.MISSIONS.length, 10);
  const ids = new Set(), species = new Set();
  Cp.MISSIONS.forEach((m, k) => {
    assert.equal(m.n, k + 1); assert.ok(!ids.has(m.id)); ids.add(m.id);
    assert.ok(m.title && m.when && m.story && m.debrief.win && m.debrief.lose, m.id + ' texts');
    assert.ok(m.goals.length >= 1 && m.bonus.length === 2, m.id + ' goals + 2 bonus');
    for (const o of m.goals.concat(m.bonus)) { assert.ok(Cp.TRACK[o.type], m.id + ': tracker ' + o.type); assert.ok(o.id && o.text, m.id + ' objective'); }
    if (m.species) { assert.ok(AL.SPECIES[m.species], m.species); species.add(m.species); } else assert.ok(m.pickSpecies);
    assert.ok(m.map.x >= 0 && m.map.x <= 1 && m.map.y >= 0 && m.map.y <= 1);
  });
  assert.ok(species.size >= 6, 'species mix: ' + [...species]);
  const o = Cp.optsFor('neighbours');
  assert.equal(o.campaign, 'neighbours'); assert.equal(o.skipFlight, true); assert.equal(o.species, 'carpenter');
  assert.deepEqual(Cp.optsFor('neighbours'), o, 'deterministic');
  assert.equal(Cp.optsFor('queen', { species: 'army' }).species, 'army', 'pick-species mission takes the choice');
  assert.equal(Cp.next('forage').id, 'dig'); assert.equal(Cp.next('queen'), null);
});

test('the runner only runs in campaign worlds; setup applies (solo map, no key points, no mower, calm weather)', () => {
  const plain = AL.Sim.createWorld({ seed: 3 });
  assert.equal(plain.campaign, undefined); assert.ok(!plain.systems.some(s => s.id === 'campaign'));
  const w = mission('forage');
  assert.ok(w.campaign && w.systems.some(s => s.id === 'campaign'));
  assert.equal(w.colonies.length, 1, 'solo');
  assert.equal(w.victory.points.length, 0, 'no key points');
  assert.ok(w.poi.human.mower.next > 1e8, 'no mower');
  assert.equal(w.weather.kind, 'clear'); assert.ok(w.weather.timer > 800);
  assert.equal(w.env.season, 'summer');
  const st = Cp.status(w);
  assert.equal(st.goals.length, 2); assert.equal(st.goals[0].state, 'open'); assert.equal(st.goals[1].prog, '0 / 150');
  const msgs = []; const off = AL.on('campaignMsg', (ww, d) => { if (ww === w) msgs.push(d.text); });
  step(w, 5); off();
  assert.ok(msgs.length >= 1 && /food trail/i.test(msgs[0]), 'script message');
});

test('trackers report progress: deliveries, trail strokes, losses (keep), within', () => {
  const w = mission('forage');
  const S = goal(w, 'sugar');
  AL.emit(w, 'foodDelivered', { col: 0, kind: AL.CARRY.SUGAR, amt: 1 });
  AL.emit(w, 'foodDelivered', { col: 1, kind: AL.CARRY.SUGAR, amt: 1 });          // not ours
  AL.emit(w, 'foodDelivered', { col: 0, kind: AL.CARRY.PROTEIN, amt: 1 });        // not sugar
  assert.equal(goal(w, 'sugar').v, S.v + 1);
  assert.equal(goal(w, 'protein').v, 1);
  // a stroke that doesn't reach an aphid plant does nothing; one from the mound to the plant completes the goal
  const c = w.player, aph = w.surface.pois.filter(p => p.type === 'aphids').sort((a, b) => AL.dist2(a.x, a.y, c.x, c.y) - AL.dist2(b.x, b.y, c.x, c.y))[0];
  AL.emit(w, 'trailPainted', { col: 0, pts: [{ x: c.x, y: c.y }, { x: c.x + 60, y: c.y }] });
  assert.equal(goal(w, 'trail').state, 'open');
  AL.emit(w, 'trailPainted', { col: 0, pts: [{ x: c.x + 10, y: c.y }, { x: (c.x + aph.x) / 2, y: (c.y + aph.y) / 2 }, { x: aph.x - 20, y: aph.y }] });
  assert.equal(goal(w, 'trail').state, 'done');
  // keep-type: losses over the cap fail it
  const s = mission('storm');
  for (let k = 0; k < 4; k++) AL.emit(s, 'broodLost', { col: 0, cause: 'flood' });
  AL.emit(s, 'broodLost', { col: 0, cause: 'starve' });
  assert.equal(goal(s, 'brood').v, 4); assert.equal(goal(s, 'brood').state, 'open'); assert.equal(goal(s, 'dry').state, 'failed');
  AL.emit(s, 'broodLost', { col: 0, cause: 'flood' });
  assert.equal(goal(s, 'brood').state, 'failed');
  step(s, 1.1);
  assert.ok(s.over && s.over.campaign && !s.over.campaign.win && /flood/.test(s.over.campaign.reason), 'a failed goal fails the mission');
  assert.equal(s.over.win, false);
});

test('saved progress: unlock chain, best stars and bonus flags kept, storage errors swallowed', () => {
  const P = Cp.Progress, mem = { d: {}, getItem(k) { return this.d[k] || null; }, setItem(k, v) { this.d[k] = v; } };
  let p = P.load(mem);
  assert.deepEqual(p, P.empty());
  assert.equal(P.state(p, 'forage'), 'open'); assert.equal(P.state(p, 'dig'), 'locked');
  P.record(p, { id: 'forage', win: false, stars: 0, bonus: [false, false], time: 50 });
  assert.equal(P.state(p, 'dig'), 'locked', 'a loss unlocks nothing');
  P.record(p, { id: 'forage', win: true, stars: 2, bonus: [true, false], time: 280 });
  P.record(p, { id: 'forage', win: true, stars: 2, bonus: [false, true], time: 250 });
  const e = p.missions.forage;
  assert.equal(e.stars, 3, 'bonus flags add up across runs'); assert.equal(e.best, 250); assert.equal(e.plays, 3);
  assert.equal(P.state(p, 'forage'), 'done'); assert.equal(P.state(p, 'dig'), 'open'); assert.equal(P.state(p, 'neighbours'), 'locked');
  // missions with a species that isn't playable yet are "coming soon", and the chain steps over them
  assert.equal(P.state(p, 'storm'), 'soon'); assert.equal(P.prevOpen('neighbours').id, 'dig');
  P.record(p, { id: 'dig', win: true, stars: 1, bonus: [false, false], time: 300 });
  assert.equal(P.state(p, 'neighbours'), 'open', 'winning Dig Deep opens Neighbours (The Storm is coming soon)');
  assert.equal(Cp.next('dig').id, 'neighbours'); assert.equal(Cp.next('neighbours').id, 'queen');
  for (const m of Cp.MISSIONS) assert.equal(Cp.soon(m), m.pickSpecies ? false : !AL.isPlayable(m.species) || (m.opts.rivalSpecies || []).some(k => !AL.isPlayable(k)), m.id);
  delete p.missions.dig;
  assert.ok(P.save(p, mem));
  assert.deepEqual(P.load(mem), p);
  assert.equal(P.stars(p), 3);
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(P.load(bad), P.empty()); assert.equal(P.save(p, bad), false);
  assert.deepEqual(P.load({ getItem: () => '{not json' }), P.empty());
});

// ---- every mission can be won ---------------------------------------------------------------------------------
test('1 First Foragers: paint the trail to the aphids, bring sugar home', () => {
  const w = mission('forage'), c = w.player;
  const aph = w.surface.pois.filter(p => p.type === 'aphids').sort((a, b) => AL.dist2(a.x, a.y, c.x, c.y) - AL.dist2(b.x, b.y, c.x, c.y))[0];
  const pts = []; for (let k = 0; k <= 20; k++) pts.push({ x: AL.lerp(c.x, aph.x, k / 20), y: AL.lerp(c.y, aph.y, k / 20) });
  for (const p of pts) w.pher.food[0].depositDisc(p.x, p.y, 14, 0.4, 3);   // what the Food trail tool lays
  AL.emit(w, 'trailPainted', { col: 0, pts });
  let last = 0;
  const r = play(w, 600, () => { const g = goal(w, 'sugar'); assert.ok(g.v >= last); last = g.v; });
  won(r, 'forage');
  assert.equal(goal(w, 'trail').state, 'done'); assert.ok(goal(w, 'sugar').v >= 150);
});

test('2 Dig Deep: carve a nursery and a food store, raise 30 ants', () => {
  const w = mission('dig'), n = w.nest, e = n.entrance.c;
  assert.equal(n.tiles[N.CH.NURSERY].length, 0, 'starts without a nursery');
  N.carve(n, e - 12, 6, e + 12, 6);
  N.carveRoom(n, e + 8, 8, 5, 2, N.CH.NURSERY); N.carveRoom(n, e - 8, 8, 5, 2, N.CH.FOOD); N.carveRoom(n, e - 15, 6, 2, 1, N.CH.MIDDEN);
  N.rebuild(n);
  const r = play(w, 900);
  won(r, 'dig');
  assert.ok(goal(w, 'raise').v >= 30);
  assert.deepEqual(r.bonus.slice(0, 1), [true], 'midden bonus');
});

test('3 The Storm: a forced storm floods a starter nest; a deep sump saves the brood', () => {
  // passive play loses brood to the flood (protein kept up so the nursery stays full whether or not the foragers
  // happen to drag in big prey before the storm; whether it loses more than 4 is close to a coin flip between seeds)
  const a = mission('storm');
  const ra = play(a, 400, () => { a.player.stock.protein = Math.max(a.player.stock.protein, 30); });
  assert.ok(ra, 'the mission ended');
  assert.ok(goal(a, 'brood').v >= 1, 'passive play drowns brood: ' + goal(a, 'brood').v);
  assert.ok(a.weather.seen['summer:storm'], 'the storm came');
  // cheat: a water reservoir dug below the nest takes the water first
  const w = mission('storm'), n = w.nest, e = n.entrance.c;
  N.carve(n, e + 1, 17, e + 1, 30); N.carveRoom(n, e + 1, 33, 6, 3, N.CH.WATER); N.rebuild(n);
  let rained = false;
  const r = play(w, 400, () => { if (w.env.rain > 0.8) rained = true; });
  assert.ok(rained);
  won(r, 'storm'); assert.equal(r.stars, 3);
});

test('4 Neighbours: scout the rival nest, the raid comes, soldiers beat it off', () => {
  const w = mission('neighbours'), rv = w.colonies[1], me = w.player;
  assert.equal(w.colonies.length, 2); assert.equal(rv.spKey, 'fire'); assert.equal(me.spKey, 'carpenter');
  step(w, 3);
  assert.equal(goal(w, 'find').state, 'open', 'the rival starts hidden');
  // cheat: lift the fog over the rival nest (what a scout would do)
  const f = w.fog, cx = (rv.x * f.inv) | 0, cy = (rv.y * f.inv) | 0;
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) f.seen[y * f.w + x] = 1;
  let raids = 0; const off = AL.on('raid', (ww, d) => { if (ww === w && d.target === 0) raids++; });
  soldiers(w, me.x, me.y, 40, ST.GUARD);
  const r = play(w, 420, (ww, s) => { if (s === 2) assert.equal(goal(w, 'find').state, 'done'); });
  off();
  assert.ok(raids >= 1, 'the scripted raid was launched');
  won(r, 'neighbours');
});

test('5 The Mower: the mower crosses the yard; the alarm in time keeps the colony safe', () => {
  const w = mission('mower');
  let crushed = 0; const off = AL.on('antDied', (ww, d) => { if (ww === w && d.col === 0 && d.cause === 'crushed') crushed++; });
  let warned = false;
  const r = play(w, 400, () => { const M = w.poi.human.mower; if (M.state === 'warn') { warned = true; if (M.t < 20) AL.WorldPOI.setRecall(w, 0, true); } });
  off();
  assert.ok(warned, 'the scripted mower came');
  won(r, 'mower');
  assert.ok(crushed <= 2, 'crushed ' + crushed); assert.equal(goal(w, 'losses').v, crushed);
});

// the founding race, headless: the player founds eagerly, rivals found alongside (as the founding scene does)
function raceWorld(rivalsFirst) {
  const o = Cp.optsFor('race');
  if (rivalsFirst) o.rivalSpecies = ['army', 'army', 'army'];
  const specs = FR.rivalSpecs(o, o.seed);
  const fs = Fd.create({ site: { id: 'meadow', def: AL.SITES.meadow, x: 760, y: 2240 }, species: o.species, seed: 5 });
  const lazy = rivalsFirst, eager = f => { if (f.phase === 'land') Fd.shedWings(f); if (f.phase === 'choose') Fd.chooseDepth(f, lazy ? 'deep' : 'shallow'); if (Fd.colonyReady(f) && (!lazy || f.day > 40)) Fd.finish(f); };
  const race = FR.create({ player: fs, rivals: specs, seed: 9, x: 760, y: 2240 });
  FR.run(race, 90, eager);
  const ho = Fd.handoff(fs), rk = FR.rank(race);
  Object.assign(o, { playerSite: { x: 760, y: 2240 }, nestPreset: Fd.nestPreset(ho), start: { workers: ho.nanitics + ho.workers, brood: [], stock: ho.stock }, founding: ho,
    rivalFoundings: FR.rivalPatch(race), foundingRace: { day: race.day, place: rk.place, of: rk.of, stillFounding: rk.still } });
  return AL.Sim.createWorld(o);
}
test('6 The Founding Race: open early, find a founding nest and raze it', () => {
  const w = raceWorld(false);
  step(w, 2);
  assert.equal(goal(w, 'early').state, 'done'); assert.equal(goal(w, 'first').state, 'done');
  const c = w.colonies.find(z => z.founding); assert.ok(c);
  assert.match(goal(w, 'kill').note, /still founding/);
  for (let k = 0; k < 14; k++) { const i = w.ants.spawn(0, C.SOLDIER, L.SURFACE, c.x + 30, c.y, Math.PI, w.R); w.ants.state[i] = ST.RAID; w.ants.tx[i] = c.x; w.ants.ty[i] = c.y; }
  const r = play(w, 240);
  won(r, 'race'); assert.equal(r.stars, 3);
  assert.equal(goal(w, 'kill').v, 1); assert.ok(!c.queen.alive, 'the founding queen is dead');
  // too slow: every rival out before you means nothing left to raid -> the mission fails at once
  const late = raceWorld(true);
  const rl = play(late, 10);
  assert.equal(late.opts.foundingRace.stillFounding, 0);
  assert.ok(rl && !rl.win && /founding/.test(rl.reason), rl && rl.reason);
});

test('7 Big Game: march the bivouac, breach the termite mound, bring protein home', () => {
  const w = mission('biggame'), c = w.player;
  assert.ok(c.sp.nomad);
  const tm = w.surface.creatures.filter(z => z.type === 'termites').sort((a, b) => AL.dist2(a.x, a.y, c.x, c.y) - AL.dist2(b.x, b.y, c.x, c.y))[0];
  assert.ok(tm, 'a termite mound on the map');
  // march: what the March tool does, to open ground part way to the mound
  let mx = AL.lerp(c.x, tm.x, 0.55), my = AL.lerp(c.y, tm.y, 0.55);
  for (let k = 0; k < 20 && AL.Surface.isBlocked(w.surface, mx, my); k++) mx += 20;
  c.x = mx; c.y = my; c.marchT = w.t; c.moundSoil = 40; AL.Colony.updateMound(c); AL.Surface.stampEllipse(w.surface, w.surface.blocked, mx, my, 60, 60, 0, 0);
  AL.emit(w, 'march', { col: 0, x: mx, y: my });
  step(w, 1);
  assert.equal(goal(w, 'march').state, 'done');
  // storm the mound with a swarm
  soldiers(w, tm.x, tm.y + tm.r + 14, 70, ST.WANDER);
  const r = play(w, 900, (ww, s) => { if (s % 60 === 30 && goal(w, 'breach').state !== 'done') soldiers(w, tm.x, tm.y + tm.r + 14, 30, ST.WANDER); });
  won(r, 'biggame');
  assert.ok(goal(w, 'protein').v >= 300);
});

test('8 Two Fronts: six colonies; garrisons on the key points fill the hold meter', () => {
  const w = mission('fronts');
  assert.equal(w.colonies.length, 6); assert.equal(w.player.spKey, 'slavemaker');
  assert.equal(w.victory.activeAt, 90); assert.equal(w.victory.holdTime, 180);
  const pts = w.victory.points; assert.ok(pts.length >= 3);
  const garrison = () => { for (const p of pts) { for (let k = 0; k < 25; k++) { const a = k / 25 * AL.TAU, i = w.ants.spawn(0, C.SOLDIER, L.SURFACE, p.x + Math.cos(a) * p.r * 0.4, p.y + Math.sin(a) * p.r * 0.4, a, w.R); w.ants.state[i] = ST.X_GARRISON; w.ants.tx[i] = p.x; w.ants.ty[i] = p.y; w.ants.str[i] = p.r * 0.5; w.ants.timer[i] = 9999; } } };
  let peak = 0;
  const r = play(w, 600, (ww, s) => { if (s >= 85 && s % 85 === 0) garrison();   // (keep the garrisons topped up: rival colonies contest the points) peak = Math.max(peak, goal(w, 'hold').v); });
  won(r, 'fronts');
  assert.ok(peak >= 90, 'hold meter reported ' + peak + '%');
  assert.ok(r.bonus[1], 'owned every point');
});

test('9 Winter Is Coming: stock the larder, hibernate, wake in spring', () => {
  const w = mission('winter');
  assert.equal(w.env.season, 'autumn'); assert.ok(w.env.winterIn > 300 && w.env.winterIn < 480, 'winter in ' + w.env.winterIn);
  step(w, 2);
  w.player.stock.seeds += 500;   // cheat: a full granary
  step(w, 2);
  assert.equal(goal(w, 'larder').state, 'done'); assert.equal(goal(w, 'big').state, 'done');
  let slept = false;
  const r = play(w, 1100, () => { if (w.env.winter) { slept = true; assert.equal(goal(w, 'sleep').note, 'hibernating'); } });
  assert.ok(slept, 'winter came');
  won(r, 'winter');
  assert.equal(w.env.season, 'spring');
  // without the stock, winter fails the larder goal
  const f = mission('winter');
  f.player.stock.seeds = 0; f.player.stock.sugar = 20; f.player.stock.protein = 0;
  for (const c of f.colonies) c.stock.seeds = 0;
  const rf = play(f, 600, () => { if (f.player.stock.seeds + f.player.stock.sugar + f.player.stock.protein > 200) { f.player.stock.seeds = 0; f.player.stock.sugar = 20; } });
  assert.ok(rf && !rf.win && /before winter/.test(rf.reason), rf && rf.reason);
});

test('10 Queen of the Yard: a normal match; the core victory ends the mission', () => {
  const w = mission('queen', { species: 'fire' });
  assert.equal(w.colonies.length, 4); assert.equal(w.victory.holdTime, 240); assert.equal(w.victory.activeAt, 600);
  step(w, 5);
  // cheat: every rival queen dies (what a successful siege does)
  for (const c of w.colonies.slice(1)) {
    c.queen.hp = 0; c.queen.alive = false;
    const data = { handled: false };
    AL.emit(w, 'queenDied', { col: c.id, colony: c, data, by: 0 });
    if (!data.handled) AL.Life.queenLost(w, c);
  }
  const r = play(w, 30);
  won(r, 'queen');
  assert.equal(goal(w, 'win').state, 'done');
  assert.ok(r.bonus[0] && r.bonus[1], 'two queens, inside 30 min');
  assert.equal(r.stars, 3);
});

test('a dead queen fails any mission through the core game over', () => {
  const w = mission('dig');
  step(w, 2);
  AL.Life.queenLost(w, w.player);
  step(w, 1);
  const r = w.over.campaign;
  assert.ok(r && !r.win && r.stars === 0); assert.match(r.reason, /queen/i);
});

// ---- species tutorials ----------------------------------------------------------------------------------------
// a scripted player: does what the active step asks (paints the trail, queues the egg, marks the dig, sends fighters,
// draws the Recruit path ...) the moment the step starts and again every 20 s, then lets the sim run.

const line = (a, b, n) => { const o = []; for (let k = 0; k <= n; k++) o.push({ x: AL.lerp(a.x, b.x, k / n), y: AL.lerp(a.y, b.y, k / n) }); return o; };
const fighters = (w, p, n) => { for (let k = 0; k < n; k++) { const a = k / n * AL.TAU, i = w.ants.spawn(0, C.SOLDIER, L.SURFACE, p.x + Math.cos(a) * 30, p.y + Math.sin(a) * 30, a, w.R); if (i >= 0) w.ants.state[i] = ST.WANDER; } };
// do what a player would do for the active step (called when the step starts and every 20 s while it lasts)
function act(w, s, k) {
  const c = w.player, o = s.o, n = w.nest;
  const sp = Cp.spotOf(w, o.spot) || Cp.spotOf(w, o.to === 'aphids' ? 'aphids' : o.to);
  switch (o.type) {
    case 'trail': case 'deliver': {
      const t = o.type === 'trail' ? Cp.spotOf(w, o.to === 'food' ? 'food' : o.to) : sp;
      if (!t) break;
      const pts = line(c, t, 20); for (const p of pts) w.pher.food[0].depositDisc(p.x, p.y, 14, 0.4, 3);
      if (o.type === 'trail') AL.emit(w, 'trailPainted', { col: 0, pts });
      break;
    }
    case 'view': AL.emit(w, 'viewChanged', { view: o.view }); break;
    case 'eggQueued': for (let j = 0; j < (o.n || 1); j++) { w.player.eggQueue.push(C[o.caste]); AL.emit(w, 'eggQueued', { col: 0, caste: C[o.caste] }); } break;
    case 'dug': {
      // mark tiles beside open tunnels (of the wanted kind) for the diggers
      let m = 0;
      for (let i = 0; i < n.n && m < 30; i++) {
        const cc = i % n.cols, r = (i / n.cols) | 0; if (n.kind[i] === 0 || r < 1) continue;
        if (o.kind && n.kind[i] !== N.TILE[o.kind]) continue;
        if (N.HARD[n.kind[i]] === Infinity) continue;
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => N.isOpen(n, cc + dx, r + dy))) continue;
        if (N.mark(n, cc, r)) m++;
      }
      break;
    }
    case 'chamberGrow': {
      const ch = N.CH[o.ch], t = n.tiles[ch]; if (!t.length) break;
      const [x, y] = N.centre(n, t[0]); const c0 = (x / n.tile) | 0, r0 = (y / n.tile) | 0;
      for (let dc = -6; dc <= 6; dc++) for (let dr = -2; dr <= 2; dr++) N.designate(n, c0 + dc, r0 + dr, ch);
      break;
    }
    case 'hunt': if (sp) fighters(w, sp, 30); break;
    case 'bigPrey': if (sp) { const pts = line(c, sp, 20); for (const p of pts) w.pher.food[0].depositDisc(p.x, p.y, 14, 0.4, 3); fighters(w, sp, 8); } break;
    case 'recruit': {
      const t = o.to === 'rival' ? Cp.spotOf(w, 'rival') : (sp || { x: c.x + 200, y: c.y });
      if (k === 0) AL.Orders.addRecruit(w, 0, line(c, t, 10), 20);
      break;
    }
    case 'collect': { if (k === 0 && sp) { fighters(w, c, 12); AL.Cmd.exec(w, 0, 'collect', { x: sp.x, y: sp.y, r: 60, ids: [sp.id], n: 12 }); } break; }
    case 'playerRaid': case 'stolen': {   // the Raid tool (raids.js), as a player would send it
      const t = Cp.spotOf(w, 'rival'); if (!t || k % 2) break;
      fighters(w, c, 20);
      AL.Cmd.exec(w, 0, 'raid', { x: t.x, y: t.y, w: 20, s: 20, m: 5 });
      break;
    }
    case 'march': {
      let x = c.x + 420, y = c.y - 200; for (let j = 0; j < 30 && AL.Surface.isBlocked(w.surface, x, y); j++) x -= 25;
      c.x = x; c.y = y; c.marchT = w.t; c.moundSoil = 40; AL.Colony.updateMound(c); AL.Surface.stampEllipse(w.surface, w.surface.blocked, x, y, 60, 60, 0, 0);
      AL.emit(w, 'march', { col: 0, x, y }); break;
    }
    case 'castePop': if (o.caste === 'MAJOR' && k === 0) w.player.eggQueue.push(C.MAJOR); break;
    case 'born': if (k === 0 && o.caste == null) w.player.stock.protein += 40; break;
  }
}
// play a tutorial to the end; returns { result, steps: [[id, secs]] }
function playTutorial(id, maxSecs) {
  const w = AL.Sim.createWorld(Cp.optsFor(id));
  const log = []; let cur = -1, k = 0, since = 0;
  for (let t = 0; t < (maxSecs || 900) && !w.over; t++) {
    const st = w.campaign, s = st.goals[st.step];
    if (st.step !== cur) { if (cur >= 0) log.push([st.goals[cur].o.id, since]); cur = st.step; k = 0; since = 0; act(w, s, k++); }
    else if (since > 0 && since % 20 === 0) act(w, s, k++);
    step(w, 1); since++;
  }
  if (w.over && cur >= 0) log.push([w.campaign.goals[cur].o.id, since]);
  return { w, result: w.over && w.over.campaign, steps: log, stuck: w.over ? null : w.campaign.goals[w.campaign.step].o.id };
}

test('eight species tutorials, one per species, 5-8 steps each with help text; open for the playable species, coming soon for the rest', () => {
  assert.equal(Cp.TUTORIALS.length, 8);
  assert.deepEqual(Cp.TUTORIALS.map(t => t.species).sort(), AL.SPECIES_ORDER.slice().sort());
  const P = Cp.Progress, p = P.empty();
  for (const t of Cp.TUTORIALS) {
    assert.ok(t.steps.length >= 5 && t.steps.length <= 8, t.id + ' ' + t.steps.length + ' steps');
    for (const s of t.steps) { assert.ok(Cp.TRACK[s.type], t.id + ': ' + s.type); assert.ok(s.text && s.help, t.id + '/' + s.id + ' text + help'); }
    assert.equal(P.state(p, t.id), AL.isPlayable(t.species) ? 'open' : 'soon'); assert.equal(Cp.tutorialFor(t.species), t);
  }
  assert.equal(Cp.next('tut-fire'), null, 'tutorials are not part of the mission chain');
});

test('tutorial steps run one at a time; Skip and Back move between them; safe setup', () => {
  const w = mission('tut-fire');
  assert.ok(w.campaign.tut); assert.equal(w.colonies.length, 1); assert.ok(w.player.stock.sugar >= 150);
  let s = Cp.status(w);
  assert.equal(s.step, 0); assert.ok(s.goals[0].active && !s.goals[1].active); assert.equal(s.goals[0].hl, '#tools [data-tool="food"]'); assert.ok(Cp.spotOf(w, s.goals[0].spot), 'the aphid plant is pointed at');
  // events for a later step don't count before it is active
  AL.emit(w, 'viewChanged', { view: 'nest' });
  assert.ok(Cp.skipStep(w)); s = Cp.status(w);
  assert.equal(s.step, 1); assert.equal(s.goals[0].state, 'done'); assert.ok(s.goals[0].skipped);
  assert.ok(Cp.skipStep(w)); assert.equal(Cp.status(w).step, 2);
  assert.equal(Cp.status(w).goals[2].state, 'open', 'the early nest view did not count');
  AL.emit(w, 'viewChanged', { view: 'nest' }); step(w, 1.1);
  assert.equal(Cp.status(w).step, 3, 'auto-advance');
  assert.ok(Cp.backStep(w)); assert.equal(Cp.status(w).step, 2); assert.equal(Cp.status(w).goals[2].state, 'open', 'back resets the step');
  while (Cp.status(w).step < w.campaign.goals.length - 1) Cp.skipStep(w);
  Cp.skipStep(w);
  assert.ok(w.over && w.over.campaign && w.over.campaign.win, 'skipping the last step completes the tutorial');
});

for (const t of Cp.TUTORIALS) {
  test('tutorial ' + t.species + ': a scripted player completes every step', () => {
    const r = playTutorial(t.id, 900);
    assert.ok(r.result, t.id + ' stuck at ' + r.stuck);
    won(r.result, t.id);
    assert.equal(r.steps.length, t.steps.length, 'every step reached: ' + JSON.stringify(r.steps));
    assert.ok(r.w.campaign.goals.every(g => g.done && !g.skipped));
  });
}
