// Player raids and moves (raids.js): the Raid tool sends the chosen workers, soldiers and majors of a nest against an
// enemy hill and they don't turn back until its queen is dead or they are called off; Send moves ants between hills.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'brush', 'cmd', 'raids']) require('../public/' + f + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const mk = o => AL.Sim.createWorld(Object.assign({ seed: 4, species: 'fire', colonies: 2, rivalSpecies: ['carpenter'], rivalNests: true, noFog: true, keypointsAt: 1e9 }, o || {}));
const party = (w, id) => { const A = w.ants, by = {}; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.str[i] === id && AL.Raids.raiding(w, i)) by[A.caste[i]] = (by[A.caste[i]] || 0) + 1; return by; };
const army = (w, c, n, caste) => { const A = w.ants; for (let k = 0; k < n; k++) { const i = A.spawn(c.id, caste, L.SURFACE, c.x + (k % 6) * 4 - 10, c.y + 20 + ((k / 6) | 0) * 4, 0, w.R); A.home[i] = c.hid; A.state[i] = ST.WANDER; } };

test('a raid takes the numbers picked from each group, musters, then marches and keeps going hungry or hurt', () => {
  const w = mk(), c = w.player, t = w.colonies[1], A = w.ants;
  for (const o of w.colonies) if (o.ai) o.ai.raidT = 1e9;
  army(w, c, 8, C.SOLDIER); army(w, c, 3, C.MAJOR);
  run(w, 2);
  const have = AL.Raids.counts(w, c);
  assert.ok(have.w >= 6 && have.s >= 8 && have.m >= 3, JSON.stringify(have));
  const r = AL.Cmd.exec(w, 0, 'raid', { x: t.x, y: t.y, w: 4, s: 6, m: 2 });
  assert.ok(r.ok, r.why); assert.equal(r.n, 12);
  const p = party(w, r.id);
  assert.equal((p[C.SOLDIER] || 0), 6); assert.equal(p[C.MAJOR] || 0, 2);
  assert.equal((p[C.WORKER] || 0) + (p[C.FORAGER] || 0) + (p[C.SCOUT] || 0), 4);
  assert.ok(!p[C.NURSE], 'no nurses');
  assert.equal(AL.Cmd.exec(w, 0, 'raid', { x: c.x, y: c.y, s: 1 }).ok, false, 'not your own hill');
  // mustering: still near home
  run(w, 6);
  const near = () => { let n = 0, far = 0; for (let i = 0; i < A.high; i++) if (A.state[i] === ST.RAID && A.col[i] === 0 && A.str[i] === r.id) { if (Math.hypot(A.x[i] - c.x, A.y[i] - c.y) < 140) n++; else far++; } return [n, far]; };
  assert.ok(near()[0] >= 4, 'gathering at home: ' + near());
  // starving and badly hurt: they still go
  const raiders = []; for (let i = 0; i < A.high; i++) if (A.state[i] === ST.RAID && A.col[i] === 0 && A.str[i] === r.id) raiders.push(i);
  for (const i of raiders) { if (A.gut) A.gut[i] = 0.01; A.hp[i] = A.maxhp[i] * 0.2; }
  run(w, 14);
  let gone = 0, onward = 0;
  for (const i of raiders) { if (!A.state[i]) continue; if (AL.Raids.raiding(w, i)) onward++; else gone++; }
  assert.ok(onward > 0 && gone === 0, 'nobody turned back: onward ' + onward + ' back ' + gone);
  const d0 = Math.hypot(t.x - c.x, t.y - c.y);
  let closer = 0; for (const i of raiders) if (A.state[i] && A.layer[i] === L.SURFACE && Math.hypot(A.x[i] - t.x, A.y[i] - t.y) < d0 - 100) closer++;
  assert.ok(closer > 0, 'marching on the rival');
  // call it off: they head home
  assert.ok(AL.Cmd.exec(w, 0, 'raidEnd', { id: r.id }));
  assert.equal((w.praids || []).length, 0);
  run(w, 1);
  for (const i of raiders) if (A.state[i] && A.layer[i] === L.SURFACE) assert.ok(A.state[i] !== ST.RAID, 'called off');
});

test('raiders break into the enemy nest, kill the queen, and the raid ends', () => {
  const w = mk(), c = w.player, t = w.colonies[1], A = w.ants;
  for (const o of w.colonies) if (o.ai) o.ai.raidT = 1e9;
  // a weak rival next door: only its queen left
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 1 && A.caste[i] !== C.QUEEN) A.kill(i);
  t.x = c.x + 500; t.y = c.y;   // (the mound moves next door for the test; its nest stays)
  A.hp[t.queen.i] = 120;   // (an old, worn queen: this tests the raid, not the balance)
  army(w, c, 25, C.SOLDIER); army(w, c, 6, C.MAJOR);
  run(w, 1);
  const ev = { over: null };
  const off = AL.on('playerRaidOver', (ww, d) => { if (ww === w) ev.over = d.why; });
  const r = AL.Cmd.exec(w, 0, 'raid', { x: t.x, y: t.y, w: 0, s: 25, m: 6 });
  assert.ok(r.ok, r.why);
  let inside = 0;
  for (let s = 0; s < 120 && !ev.over; s++) { run(w, 1); for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.layer[i] === L.NEST && A.nest[i] === t.id) inside = Math.max(inside, 1); }
  off();
  assert.ok(inside, 'raiders got into its tunnels');
  assert.equal(ev.over, 'won');
  assert.ok(!t.queen.alive);
});

test('Send moves the picked ants to another of your hills: they live there afterwards', () => {
  const X = AL.Expansion; X.CFG.aiAuto = false;
  const w = mk({ rivalNests: false }), c = w.player, A = w.ants;
  c.royal.queens++; X.launch(w, 0, c.x + 600, c.y - 300); run(w, 14); run(w, X.CFG.sat.foundT + 1);
  const s = c.satellites[c.satellites.length - 1], h = w.homes[s.home];
  assert.ok(h && h.nest, 'a satellite with a nest');
  army(w, c, 6, C.SOLDIER);
  run(w, 1);
  const before = AL.Raids.counts(w, h);
  assert.equal(AL.Cmd.exec(w, 0, 'send', { x: c.x, y: c.y, w: 3 }).ok, false, 'not to the hill they live at');
  const r = AL.Cmd.exec(w, 0, 'send', { x: h.x, y: h.y, w: 5, s: 4, m: 0 });
  assert.ok(r.ok, r.why); assert.equal(r.n, 9);
  run(w, 90);
  const after = AL.Raids.counts(w, h);
  assert.ok(after.s >= before.s + 3, 'soldiers live at the satellite now: ' + JSON.stringify([before, after]));
  assert.ok(after.w >= before.w + 3, 'workers too: ' + JSON.stringify([before, after]));
});

test('big prey is dragged to the nearest of the colony\'s hills: a satellite with a nest stores it', () => {
  const X = AL.Expansion; X.CFG.aiAuto = false;
  const w = mk({ rivalNests: false }), c = w.player, A = w.ants, S = w.surface;
  c.royal.queens++; X.launch(w, 0, c.x + 700, c.y - 300); run(w, 14); run(w, X.CFG.sat.foundT + 1);
  const s = c.satellites[c.satellites.length - 1], h = w.homes[s.home];
  assert.ok(h && h.nest, 'a satellite with a nest');
  // a dead beetle just past the satellite, far from the capital
  const dx = h.x - c.x, dy = h.y - c.y, k = 90 / Math.hypot(dx, dy);
  const f = AL.Surface.addFood(S, { kind: AL.CARRY.PROTEIN, x: h.x + dx * k, y: h.y + dy * k, r: 16, amount: 40, big: true, needed: 3 });
  AL.Surface.rebuildFoodGrid(S);
  assert.equal(AL.Behavior.dragHome(w, c, f.x, f.y), h, 'the satellite is the nearest hill');
  const p0 = h.stock.protein;
  let got = null; const off = AL.on('bigFood', (ww, d) => { if (ww === w && d.food === f) got = d; });
  for (let n = 0; n < 8; n++) { const i = A.spawn(0, C.WORKER, L.SURFACE, f.x - 18, f.y + n, 0, w.R); A.home[i] = h.hid; AL.Behavior.pickup(w, i, f); }
  run(w, 40);
  off();
  assert.ok(got, 'dragged home');
  assert.equal(got.hid, h.hid, 'to the satellite, not the capital');
  assert.ok(h.stock.protein > p0 + 20, 'into the satellite\'s store: ' + p0.toFixed(0) + ' -> ' + h.stock.protein.toFixed(0));
});
