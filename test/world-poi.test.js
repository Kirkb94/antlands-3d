// World stage: fair map planning, POIs on the core map, dynamic POIs and the human zone.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
try { require('../public/nest.js'); require('../public/life.js'); } catch (e) { /* core without a nest model */ }
require('../public/world-time.js'); require('../public/world-poi.js'); require('../public/world-creatures.js'); require('../public/world-fog.js');
const K = AL.CARRY, T = AL.TUNE, TICKS = s => Math.round(s / T.DT);
const run = (w, secs) => { for (let k = 0, n = TICKS(secs); k < n; k++) AL.Sim.step(w); };
const P = AL.WorldPOI;
const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('fair map: every colony gets the same sector, rotated (1-8 colonies, several seeds)', () => {
  for (let n = 1; n <= 8; n++) for (const seed of [1, 7, 42, 999]) {
    const L = P.plan({ seed, n });
    assert.equal(L.nests.length, n);
    // sector POIs: the multiset of (type, distance to own nest) is identical for every colony
    const sig = c => L.pois.filter(p => p.col === c).map(p => p.type + ':' + Math.round(d(p, L.nests[c]) / 2)).sort().join(',');
    for (let c = 1; c < n; c++) assert.equal(sig(c), sig(0), 'n=' + n + ' seed=' + seed + ' colony ' + c);
    // everything inside the yard, nests well apart
    for (const p of [].concat(L.pois, L.rocks, L.logs, L.sprinklers, L.stormSpots)) assert.ok(p.x > 20 && p.y > 20 && p.x < L.W - 20 && p.y < L.H - 20, 'inside n=' + n + ' ' + JSON.stringify(p));
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) assert.ok(d(L.nests[a], L.nests[b]) > 850, 'nests apart n=' + n);
    // sector food never sits closer to a neighbour's nest than to its own
    for (const p of L.pois) if (p.col != null) for (let c = 0; c < n; c++) assert.ok(d(p, L.nests[p.col]) <= d(p, L.nests[c]) + 1, 'n=' + n + ' ' + p.type + ' of ' + p.col + ' nearer to ' + c);
    // contested slots: equally far from the two neighbours they sit between (and the picnic is dead centre)
    if (n >= 2) for (const s of L.slots) {
      const ds = L.nests.map(q => d(q, s)).sort((a, b) => a - b);
      assert.ok(Math.abs(ds[0] - ds[1]) < 2, 'slot fair n=' + n + ' (' + ds[0].toFixed(1) + ' vs ' + ds[1].toFixed(1) + ')');
    }
    const ctr = L.pois.find(p => p.type === 'spill');
    const dc = L.nests.map(q => d(q, ctr)); assert.ok(Math.max(...dc) - Math.min(...dc) < 2, 'picnic central');
  }
});

test('fair map: sector items of different colonies do not overlap', () => {
  for (let n = 2; n <= 8; n++) for (const seed of [3, 8]) {
    const L = P.plan({ seed, n });
    const items = [];
    for (const p of L.pois) if (p.col != null) items.push({ x: p.x, y: p.y, r: p.type === 'crumb' ? 8 : 50, c: p.col });
    for (const r of L.rocks) items.push({ x: r.x, y: r.y, r: r.rx, c: -1 });
    for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
      const A = items[a], B = items[b]; if (A.c === B.c && A.c >= 0) continue;
      assert.ok(d(A, B) > (A.r + B.r) * 0.6, 'n=' + n + ' seed=' + seed + ' overlap at ' + Math.round(A.x) + ',' + Math.round(A.y));
    }
  }
});

test('createWorld with a planned layout: map, nests, termite mound, lairs', () => {
  const L = P.plan({ seed: 5, n: 4 });
  const w = AL.Sim.createWorld({ seed: 5, layout: L });
  const S = w.surface;
  assert.equal(w.colonies.length, 4);
  for (const c of w.colonies) assert.ok(!AL.Surface.isBlocked(S, c.x, c.y), 'nest walkable');
  assert.ok(w.poi.fair);
  assert.equal(S.pois.filter(p => p.type === 'aphids').length, 4);
  assert.ok(S.creatures.some(c => c.type === 'termites'));
  for (const l of w.poi.lairs.concat(w.poi.beetleHomes)) assert.ok(!AL.Surface.isBlocked(S, l.x, l.y), 'lair reachable');
  assert.ok(S.rocks.filter(r => r.shelter).length >= 4, 'a shelter rock per colony');
  assert.ok(w.shade.some(v => v === 2), 'shelters in the shade map');
});

test('core map: the termite mound sits the same distance from the player and the rival', () => {
  const w = AL.Sim.createWorld({ seed: 2 });
  assert.ok(!w.poi.fair);
  const t = w.poi.termites[0]; assert.ok(t, 'placed');
  const a = d(t, w.colonies[0]), b = d(t, w.colonies[1]);
  assert.ok(Math.abs(a - b) < 2, a.toFixed(1) + ' vs ' + b.toFixed(1));
  assert.ok(!AL.Surface.isBlocked(w.surface, t.x, t.y));
  assert.equal(w.poi.sprinklers.length, 2);
});

test('storm puddles fill the hollows, then dry up and vanish in a heat wave', () => {
  const w = AL.Sim.createWorld({ seed: 3, creatures: false });
  AL.World.forceWeather(w, 'storm', 400, true);
  run(w, 40);
  const temp = w.surface.pois.filter(p => p.type === 'puddle' && p.temp);
  assert.ok(temp.length >= 2, 'storm puddles (' + temp.length + ')');
  assert.ok(temp.every(p => p.r > 20), 'they grew');
  const big = w.surface.pois.find(p => p.type === 'puddle' && !p.temp), r0 = big.r;
  AL.World.setTime(w, { season: 'summer', timeOfDay: 0.5 }); AL.World.forceWeather(w, 'heat', 900, true);
  run(w, 240);
  assert.equal(w.surface.pois.filter(p => p.type === 'puddle' && p.temp).length, 0, 'temporary puddles dried out');
  assert.ok(big.r < r0 * 0.8 && big.src.amount < big.src.max, 'the pond shrinks and holds less water');
});

test('fruit rots faster in heat and not at all in winter', () => {
  const mk = () => { const w = AL.Sim.createWorld({ seed: 4, creatures: false }); return [w, w.surface.foods.find(f => f.visual === 'fruit')]; };
  const [a, fa] = mk(); run(a, 60); const normal = fa.rot;
  const [b, fb] = mk(); AL.World.setTime(b, { season: 'summer', timeOfDay: 0.5 }); AL.World.forceWeather(b, 'heat', 900, true); run(b, 60);
  const [c, fc] = mk(); AL.World.setTime(c, { season: 'winter' }); run(c, 60);
  assert.ok(fb.rot > normal * 1.3, 'heat ' + fb.rot.toFixed(3) + ' vs ' + normal.toFixed(3));
  assert.equal(fc.rot, 0, 'frozen');
});

test('footsteps: a shoe shadow shows first, then it stomps exposed ants (not sheltered ones)', () => {
  const w = AL.Sim.createWorld({ seed: 6, creatures: false, fog: false }), A = w.ants;
  P.startWalk(w, 1);
  run(w, 0.05);
  // walk until the first footprint exists, then put ants under it
  let st = null; for (let k = 0; k < 200 && !st; k++) { AL.Sim.step(w); st = w.poi.human.steps[0]; }
  assert.ok(st && !st.stomped, 'telegraphed');
  const ids = []; for (let k = 0; k < 6; k++) ids.push(A.spawn(1, AL.CASTE.WORKER, 0, st.x + Math.cos(st.a) * (k * 3), st.y + Math.sin(st.a) * (k * 3), 0, w.R));
  // one more under the shoe but sheltered: mark its cell as shelter
  const sheltered = A.spawn(1, AL.CASTE.WORKER, 0, st.x - Math.cos(st.a) * 30, st.y - Math.sin(st.a) * 30, 0, w.R);   // under the heel, in another cell
  const S = w.surface, ci = ((A.y[sheltered] / S.cell) | 0) * S.gw + ((A.x[sheltered] / S.cell) | 0);
  w.shade[ci] = 2;
  let deaths = 0; const off = AL.on('antDied', (ww, dd) => { if (ww === w && dd.cause === 'crushed') deaths++; });
  for (let k = 0; k < TICKS(1.3) && !st.stomped; k++) { for (const i of ids.concat([sheltered])) if (A.state[i]) { A.x[i] = A.px[i]; A.y[i] = A.py[i]; } AL.Sim.step(w); }
  assert.ok(st.stomped, 'landed');
  assert.ok(deaths >= 3, 'stomped ' + deaths);
  assert.ok(A.state[sheltered], 'sheltered ant survived');
  off();
});

test('lawnmower: warned first, then mows the whole yard strip by strip, killing about half the exposed ants', () => {
  const w = AL.Sim.createWorld({ seed: 8, creatures: false, fog: false }), A = w.ants, M = w.poi.human.mower, S = w.surface;
  let warn = false, end = false; const off = AL.on('mower', (ww, dd) => { if (ww !== w) return; if (dd.phase === 'warn') warn = true; if (dd.phase === 'end') end = true; });
  P.startMower(w);
  assert.ok(warn && M.state === 'warn');
  assert.equal(M.lanes, Math.ceil(S.H / PT().MOWER_W));
  // exposed ants spread over the whole yard, held in place
  const victims = [];
  for (let k = 0; k < 60; k++) { let x = 300 + (k % 10) * 340, y = 200 + Math.floor(k / 10) * 480; while (AL.World.shadeAt(w, x, y) === 2 || AL.Surface.isBlocked(w.surface, x, y)) x += 40; victims.push(A.spawn(1, AL.CASTE.WORKER, 0, x, y, 0, w.R)); }
  const uid = new Map(victims.map(i => [i, A.uid[i]])), alive = i => A.state[i] && A.uid[i] === uid.get(i);
  const soil0 = w.colonies.map(c => c.moundSoil);
  for (let k = 0; k < TICKS(PT().MOWER_WARN + 160) && !end; k++) { for (const i of victims) if (alive(i) && A.layer[i] === 0) { A.state[i] = AL.ST.WANDER; A.x[i] = A.px[i]; A.y[i] = A.py[i]; } AL.Sim.step(w); }
  assert.ok(end, 'finished the yard within ~2.5 min');
  const dead = victims.filter(i => !alive(i)).length;
  assert.ok(dead >= 15 && dead <= 45, 'about half died (' + dead + '/60)');
  assert.ok(w.colonies.every((c, k) => c.moundSoil < soil0[k]), 'every mound got flattened');
  assert.equal(M.state, 'off'); assert.equal(M.stripes.length, M.lanes);
  assert.ok(M.next >= PT().MOWER_EVERY[0], 'next mow days away');
  off();
});
test('mower alarm: surface ants run home, the nest keeps them in, and it clears when the mower is done', () => {
  const w = AL.Sim.createWorld({ seed: 8, creatures: false, fog: false }), A = w.ants, c = w.player;
  run(w, 20);
  const out = () => { let n = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === 0 && A.col[i] === 0 && A.caste[i] !== AL.CASTE.QUEEN) n++; return n; };
  assert.ok(out() > 0, 'some ants outside to begin with');
  P.startMower(w);
  assert.ok(P.setRecall(w, 0, true) && c.recall && c.recallMow);
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === 0 && A.col[i] === 0 && A.caste[i] !== AL.CASTE.QUEEN) assert.ok(A.state[i] === AL.ST.HOMING || A.state[i] === AL.ST.RETURN, 'heading home');
  run(w, 25);   // still in the warning
  assert.ok(out() <= 3, 'almost everyone is home (' + out() + ' out)');
  assert.ok(w.colonies.slice(1).every(r => r.recall), 'rivals sounded theirs too');
  for (let k = 0; k < 200 && w.poi.human.mower.state !== 'off'; k++) run(w, 1);
  run(w, 2);
  assert.ok(!c.recall && w.colonies.every(r => !r.recall), 'all clear after the mow');
  run(w, 20);
  assert.ok(out() > 0, 'ants go back out');
  // sounded with no mower around, it lasts until called off
  P.setRecall(w, 0, true); run(w, 30); assert.ok(c.recall && !c.recallMow);
  P.setRecall(w, 0, false); assert.ok(!c.recall);
});
const PT = () => AL.POI_TUNE;

test('sprinklers: wash trails and flood the nest they reach', () => {
  const w = AL.Sim.createWorld({ seed: 9, creatures: false });
  w.poi.sprinklers.length = 1;   // only the player's sprinkler (normally every colony has one, all run together)
  const sp = w.poi.sprinklers[0], g = w.pher.food[0];
  g.deposit(sp.x + 40, sp.y + 40, 6);
  P.setSprinklers(w, true, 60);
  run(w, 50);
  assert.ok(g.sample(sp.x + 40, sp.y + 40) < 0.5, 'trail under the spray washed');
  assert.ok(AL.World.floodLevel(w, 0) > AL.World.floodLevel(w, 1), 'the sprayed colony floods more');
  assert.ok(AL.World.floodLevel(w, 0) > 0.05);
});

test('dead insects drop mirrored: one per colony, same distance from each nest', () => {
  const w = AL.Sim.createWorld({ seed: 10, layout: P.plan({ seed: 10, n: 3 }), creatures: false });
  const before = w.surface.foods.length;
  const n = P.spawnMirrored(w, 'moth');
  assert.equal(n, 3);
  const add = w.surface.foods.slice(before);
  const ds = add.map((f, k) => Math.round(d(f, w.colonies[k])));
  assert.ok(Math.max(...ds) - Math.min(...ds) <= 1, ds.join(','));
  assert.ok(add.every(f => f.big && f.needed === 3 && f.visual === 'moth'));
});

test('aphid herding: escorted aphids walk to a new spot and settle as a honeydew source', () => {
  const w = AL.Sim.createWorld({ seed: 12, fog: false }), A = w.ants, c = w.player;
  const from = P.aphidsNear(w, c.x, c.y, 3000), n0 = from.aphids, plants0 = w.surface.pois.filter(p => p.type === 'aphids').length;
  for (let k = 0; k < 6; k++) A.spawn(0, AL.CASTE.WORKER, 0, from.x + k * 4 - 10, from.y + 20, 0, w.R);
  const tx = from.x + 160, ty = from.y + 60;
  const herd = P.herd(w, from, 0, tx, ty, 10);
  assert.ok(herd && from.aphids === n0 - 10);
  let settled = false; const off = AL.on('aphidsSettled', ww => { if (ww === w) settled = true; });
  run(w, 40);
  assert.ok(settled, 'arrived');
  const np = w.surface.pois.filter(p => p.type === 'aphids');
  assert.equal(np.length, plants0 + 1);
  const p = np.find(q => q.herded); assert.ok(p && d(p, { x: tx, y: ty }) < 30 && p.src && p.src.visual === 'honeydew');
  run(w, 30); assert.ok(p.src.amount > 1, 'honeydew flows');
  off();
});

test('picnic: a summer lunchtime refills the blanket and sends people walking out', () => {
  const w = AL.Sim.createWorld({ seed: 13, creatures: false, layout: P.plan({ seed: 13, n: 2 }) });
  const spill = w.surface.pois.find(p => p.type === 'spill'); for (const f of spill.srcs) f.amount = 0;
  AL.World.setTime(w, { season: 'summer', timeOfDay: 11.98 / 24 });
  let soon = false, drop = false;
  const o1 = AL.on('picnicSoon', ww => { if (ww === w) soon = true; }), o2 = AL.on('picnic', ww => { if (ww === w) drop = true; });
  run(w, 40);
  assert.ok(soon && drop);
  assert.ok(w.surface.foods.filter(f => f.picnic && !f.gone).length >= 3);
  assert.ok(w.poi.human.foot.walking || w.poi.human.steps.length > 0, 'people walk out');
  o1(); o2();
});
