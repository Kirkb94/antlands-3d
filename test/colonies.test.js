// Colonies stage: 2-8 colonies per match, fair N-colony maps, random rival species, rivals that must find you.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'fog', 'expansion', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog']) require('../public/' + f + '.js');
const Col = require('../public/colonies.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clearSurface = w => { for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.layer[i] === L.SURFACE) w.ants.kill(i); };

test('colonies 2-8: N colonies on a fair map, each rival a valid species, nobody knows anybody', () => {
  for (let n = 2; n <= 8; n++) {
    const w = AL.Sim.createWorld({ seed: 30 + n, colonies: n });
    assert.equal(w.colonies.length, n);
    assert.ok(w.poi.fair && w.surface.fairApplied, 'fair map n=' + n);
    assert.equal(w.pher.food.length, n);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert.ok(d(w.colonies[a], w.colonies[b]) > 850, 'apart');
    for (const c of w.colonies.slice(1)) {
      assert.ok(AL.SPECIES[c.spKey], c.spKey);
      assert.equal(c.ai.known.reduce((a, b) => a + b, 0), 1, 'rival ' + c.id + ' starts knowing only itself');
      assert.equal(c.ai.known[c.id], 1);
      assert.equal(c.ai.target, -1);
    }
    // the player's fog hides every rival nest at the start (the minimap only draws seen nests)
    for (const c of w.colonies.slice(1)) assert.ok(!w.fog.seenAt(c.x, c.y), 'rival nest ' + c.id + ' unseen');
  }
  // clamped and defaulted
  assert.equal(Col.clampN(1), 2); assert.equal(Col.clampN(12), 8); assert.equal(Col.clampN(undefined), 6);
});

test('rival species are random per seed, deterministic, and spread over every playable species', () => {
  const keys = Object.keys(AL.SPECIES).filter(AL.isPlayable);
  assert.deepEqual(keys.sort(), AL.PLAYABLE.slice().sort(), 'only the playable species are picked as rivals');
  assert.deepEqual(Col.pickSpecies(5, 7), Col.pickSpecies(5, 7));
  const p = Col.pickSpecies(5, 7);
  for (const k of keys.slice(0, Math.min(7, keys.length))) if (keys.length <= 7) assert.ok(p.includes(k), 'has ' + k);
  const seen = new Set(); for (let s = 1; s < 40; s++) seen.add(Col.pickSpecies(s, 1)[0]);
  assert.equal(seen.size, keys.length, 'the first rival is not always fire ants');
  const w = AL.Sim.createWorld({ seed: 9, colonies: 6 });
  assert.deepEqual(w.colonies.slice(1).map(c => c.spKey), Col.pickSpecies(9, 5));
  // rivals of the same species still look different
  const fire = w.colonies.filter(c => !c.isPlayer && c.spKey === w.colonies[1].spKey);
  if (fire.length > 1) assert.notEqual(fire[0].colours.body, fire[1].colours.body);
});

test('a founding site keeps the player where they chose; missing rivals are spread round the yard', () => {
  const w = AL.Sim.createWorld({ seed: 4, colonies: 6, playerSite: { x: 900, y: 2100 }, rivalSites: [{ x: 3200, y: 800 }] });
  assert.equal(w.colonies.length, 6);
  assert.deepEqual([w.player.x, w.player.y], [900, 2100]);
  assert.deepEqual([w.colonies[1].x, w.colonies[1].y], [3200, 800]);
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) assert.ok(d(w.colonies[a], w.colonies[b]) > 700, a + '-' + b + ' apart');
  assert.ok(!w.poi.fair, 'the flight map is kept');
  // the termite mound: about as far from every nest as from any other
  const t = w.poi.termites[0]; assert.ok(t, 'termite mound placed');
  const ds = w.colonies.map(c => d(c, t));
  assert.ok(Math.max(...ds) - Math.min(...ds) < 900, 'termites central-ish ' + ds.map(Math.round));
});

test('no raids on nests nobody has found; once found, the rival raids that colony', () => {
  const w = AL.Sim.createWorld({ seed: 8, colonies: 3, aiLevel: 1 }), r = w.colonies[1];
  for (const c of w.colonies.slice(1)) c.ai.raidT = 1e9;
  r.inside[C.SOLDIER] += 30; r.ai.raidT = 1; r.ai.scoutT = 1e9;
  const raids = []; const off = AL.on('raid', (ww, e) => { if (ww === w) raids.push(e); });
  run(w, 5);
  assert.equal(raids.length, 0, 'nobody known: no raid');
  AL.AI.discover(w, 1, 2);
  run(w, 25);
  off();
  assert.ok(raids.length >= 1, 'raid launched');
  assert.equal(raids[0].target, 2, 'rivals fight each other');
  assert.equal(r.ai.target, 2);
});

test('rivals find nests by sight: a rival scout next to your mound finds it and you hear about it', () => {
  const w = AL.Sim.createWorld({ seed: 12, colonies: 4 }), p = w.player;
  const ev = []; const off = AL.on('colonyFound', (ww, e) => { if (ww === w) ev.push(e); });
  const i = w.ants.spawn(2, C.SCOUT, L.SURFACE, p.x + 150, p.y, 0, w.R);
  w.ants.state[i] = ST.GUARD; w.ants.tx[i] = p.x + 150; w.ants.ty[i] = p.y; w.ants.timer[i] = 99;
  run(w, 1.1);
  off();
  const e = ev.find(x => x.col === 2 && x.target === 0);
  assert.ok(e, 'found');
  assert.ok(e.seen, 'your ants could see the scout');
  assert.ok(AL.AI.knows(w, 2, 0) && !AL.AI.knows(w, 3, 0), 'only that rival knows');
});

test('a hidden site is noticed from closer', () => {
  const w = AL.Sim.createWorld({ seed: 12, colonies: 3 });
  const open = AL.AI.noticeR(w.player);
  w.player.siteTraits = { visibility: 0.35 };
  assert.ok(AL.AI.noticeR(w.player) < open * 0.5);
  w.player.noticeR = 0; assert.equal(AL.AI.noticeR(w.player), 0, 'a stage can override it');
});

test('enemy ants walking home give a lead; scouts follow its bearing', () => {
  const w = AL.Sim.createWorld({ seed: 14, colonies: 3 }), r = w.colonies[1];
  clearSurface(w); r.ai.scoutT = 1e9;
  const x = (r.x + w.colonies[2].x) / 2, y = (r.y + w.colonies[2].y) / 2;
  const a = w.ants.spawn(1, C.FORAGER, L.SURFACE, x, y, 0, w.R); w.ants.state[a] = ST.GUARD; w.ants.tx[a] = x; w.ants.ty[a] = y; w.ants.timer[a] = 99;
  const b = w.ants.spawn(2, C.FORAGER, L.SURFACE, x + 30, y, 1.2, w.R); w.ants.state[b] = ST.HOMING;
  AL.Sim.step(w);
  AL.AI.sense(w); w.tick += 30; AL.AI.sense(w);   // sampled every other second per ant
  const lead = r.ai.leads.find(l => l.col === 2);
  assert.ok(lead, 'lead on colony 2');
  const pt = AL.AI.scoutPoint(w, r);
  assert.ok(pt.lead, 'scouts go where the lead points');
});

test('six colonies, five minutes: rivals scout, find each other and the player', () => {
  const w = AL.Sim.createWorld({ seed: 8, colonies: 6 });
  const found = []; const off = AL.on('colonyFound', (ww, e) => { if (ww === w) found.push(e); });
  run(w, 300);
  off();
  assert.ok(found.length >= 3, 'finds ' + found.length);   // the exact count shifts with any balance change (seeded behaviour)
  assert.ok(found.some(e => e.target !== 0), 'rivals find rivals');
  let scouts = 0; for (const c of w.colonies.slice(1)) scouts += c.ai.scouts;
  assert.ok(scouts > 20, 'scouting parties went out (' + scouts + ')');
});

test('a founding colony is left alone by the AI and is nobody\'s raid target', () => {
  const w = AL.Sim.createWorld({ seed: 16, colonies: 3 }), f = w.colonies[2], r = w.colonies[1];
  f.founding = true; const s0 = f.stock.sugar;
  r.ai.known.fill(1); r.inside[C.SOLDIER] += 30;
  run(w, 3);
  assert.equal(f.stock.sugar, s0, 'no AI economy while founding');
  for (let k = 0; k < 20; k++) assert.notEqual(AL.AI.pickTarget(w, r), 2);
});

test('the species hook runs once a second for every AI colony', () => {
  const w = AL.Sim.createWorld({ seed: 17, colonies: 4 });
  const calls = {};
  AL.Species = Object.assign(AL.Species || {}, { aiSecond: (ww, col) => { if (ww === w) calls[col.id] = (calls[col.id] || 0) + 1; } });
  run(w, 3);
  delete AL.Species.aiSecond;
  assert.deepEqual(Object.keys(calls).map(Number).sort(), [1, 2, 3]);
  assert.ok(calls[1] >= 2 && calls[1] <= 4);
});

test('leafcutter rivals farm fungus from leaves', () => {
  const w = AL.Sim.createWorld({ seed: 18, colonies: 2, rivalSpecies: ['leafcutter'] }), r = w.colonies[1];
  assert.equal(r.spKey, 'leafcutter');
  r.stock.leaves = 100; r.stock.protein = 0;
  run(w, 5);
  assert.ok(r.stock.leaves < 100 && r.stock.protein > 0, 'leaves became food');
});

test('key points with 3+ colonies: fair map uses the contested slots so every colony is equally placed', () => {
  for (const n of [3, 4, 6, 8]) {
    const w = AL.Sim.createWorld({ seed: 40 + n, colonies: n });
    const pts = w.victory.points;
    assert.ok(pts.some(p => p.kind === 'spill'));
    assert.equal(pts.length, 1 + (n % 2 === 0 ? n / 2 : n), 'n=' + n);
    const near = w.colonies.map(c => Math.min(...pts.filter(p => p.kind !== 'spill').map(p => d(c, p))));
    assert.ok(Math.max(...near) - Math.min(...near) < 3, 'n=' + n + ' ' + near.map(Math.round));
    for (const p of pts) assert.ok(!AL.Surface.isBlocked(w.surface, p.x, p.y), p.name + ' open');
  }
  // a flight map with 5 colonies: a greedy fair set
  const w = AL.Sim.createWorld({ seed: 3, colonies: 5, playerSite: { x: 800, y: 2200 } });
  assert.ok(w.victory.points.length >= 3);
});

test('every nest starts with the same little food lying round it (not in campaign missions)', () => {
  const T = AL.TUNE.STARTER, w = AL.Sim.createWorld({ seed: 12, colonies: 4 });
  const near = c => w.surface.foods.filter(f => !f.poi && !f.picnic && Math.hypot(f.x - c.x, f.y - c.y) >= T.near - 1 && Math.hypot(f.x - c.x, f.y - c.y) <= T.far + 1);
  for (const c of w.colonies) {
    const f = near(c);
    assert.ok(f.length >= T.piles, 'colony ' + c.id + ' has ' + f.length + ' piles');
    assert.ok(f.some(q => q.kind === AL.CARRY.SUGAR) && f.some(q => q.kind === AL.CARRY.PROTEIN));
  }
  const m = AL.Sim.createWorld({ seed: 12, colonies: 4, campaign: 'x' });
  assert.ok(m.surface.foods.length < w.surface.foods.length, 'missions keep their own food');
  assert.deepEqual(AL.Sim.createWorld({ seed: 12, colonies: 4 }).surface.foods.map(f => [f.x, f.y]), w.surface.foods.map(f => [f.x, f.y]), 'same seed, same food');
});
