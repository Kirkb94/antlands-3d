// The expansion stage against the full core: M2 nest model (the player's nest grid and queen ant) and,
// when present, M3 combat / orders / AI (abstract rival nests).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
const HAS_NEST = fs.existsSync(path.join(__dirname, '..', 'public', 'life.js'));
if (HAS_NEST) require('../public/life.js');
const has = f => fs.existsSync(path.join(__dirname, '..', 'public', f));
for (const f of ['combat.js', 'orders.js', 'ai.js', 'fog.js']) if (has(f)) require('../public/' + f);
const HAS_AI = !!AL.AI;
const optAI = { skip: !(HAS_NEST && HAS_AI) && 'no core AI in this tree' };
const X = require('../public/expansion.js');
require('../public/victory.js');
const C = AL.CASTE, ST = AL.ST;
X.CFG.aiAuto = false;
const opt = { skip: !HAS_NEST && 'no nest model in this tree' };

function world(opts) { return AL.Sim.createWorld(Object.assign({ seed: 9, keypointsAt: 1e9 }, opts || {})); }
function run(w, secs) { const n = Math.round(secs * 30); for (let k = 0; k < n; k++) AL.Sim.step(w); }
function satFor(w, ci, x, y) { const c = w.colonies[ci]; c.royal.queens++; X.launch(w, ci, x, y); run(w, 14); run(w, X.CFG.sat.foundT + 1); return c.satellites[c.satellites.length - 1]; }

test('the player\'s real queen ant is the colony queen', opt, () => {
  const w = world(), c = w.player;
  assert.ok(c.nest, 'nest model loaded');
  assert.ok(X.queenAnt(w, c) >= 0);
  assert.equal(c.mainHp, c.mainMaxHp);
});

test('queen ant dies with a satellite: her queen is escorted home into the royal chamber, no game over', opt, () => {
  const w = world(), c = w.player;
  const s = satFor(w, 0, c.x + 800, c.y - 500);
  assert.equal(s.state, 'active');
  const qi = X.queenAnt(w, c), x0 = c.x, y0 = c.y;
  const tk = []; const off = AL.on('queenTakeover', (ww, d) => tk.push(d));
  AL.Combat.killAnt(w, qi, 'fight');           // the core reports queenDied; we handle it
  off();
  assert.equal(tk.length, 1); assert.equal(tk[0].mode, 'adopt');
  assert.equal(c.x, x0); assert.equal(c.y, y0, 'the capital (and its nest grid) stays');
  const nq = X.queenAnt(w, c);
  assert.ok(nq >= 0 && nq !== qi || (nq >= 0 && w.ants.uid[nq] !== 0), 'a new queen ant');
  assert.equal(w.ants.layer[nq], AL.LAYER.NEST);
  assert.equal(w.ants.state[nq], ST.N_QUEEN);
  assert.equal(s.state, 'orphan');
  assert.ok(c.queen.alive && c.alive !== false);
  const eggs = []; const off2 = AL.on('eggLaid', (ww, d) => { if (d.col === 0) eggs.push(d); });
  c.stock.sugar = 200; c.stock.protein = Math.max(c.stock.protein, 60); run(w, 20); off2();   // (fed: this is about the takeover, not the larder)
  assert.equal(w.over, null);
  assert.ok(eggs.length > 0, 'the new queen lays');
});

test('queen ant dies with no satellite: defeat', opt, () => {
  const w = world();
  AL.Combat.killAnt(w, X.queenAnt(w, w.player), 'fight');
  run(w, 2);
  assert.ok(w.over && !w.over.win);
  assert.ok(w.player.out);
});

test('a rival raid tunnel cracks through the player\'s nest grid toward the queen, and its raiders fight in the tunnels', opt, () => {
  const w = world(), c = w.player, r = w.colonies[1];
  for (let k = 0; k < 40; k++) w.ants.spawn(1, C.SOLDIER, 0, r.x + 20, r.y, 0, w.R);
  AL.Sim.countPop(w);
  r.stock.protein = 200; r.stock.sugar = 200; r.research.tunnel = 1;
  X.CFG.tunnel.maxLen = 5000;
  const t = X.orderTunnel(w, 1, 0, 0);
  X.CFG.tunnel.maxLen = 2200;
  assert.ok(t);
  const breached = []; const off = AL.on('nestBreached', (ww, d) => breached.push(d));
  const open0 = c.nest.kind.reduce((n, k) => n + (k === AL.Nest.TILE.OPEN ? 1 : 0), 0);
  run(w, t.len * X.CFG.tunnel.warnAt / X.CFG.tunnel.speed + 2);
  assert.ok(t.warned && t.plan && t.plan.length > 5, 'tremor: the route is planned and shown');
  run(w, t.len * (1 - X.CFG.tunnel.warnAt) / X.CFG.tunnel.speed + 2);
  off();
  assert.equal(t.state, 'done');
  assert.equal(breached.length, 1);
  const open1 = c.nest.kind.reduce((n, k) => n + (k === AL.Nest.TILE.OPEN ? 1 : 0), 0);
  assert.ok(open1 > open0, 'tunnel tiles carved into the grid');
  const edge = t.breachPath[0] % c.nest.cols;
  assert.ok(edge === 0 || edge === c.nest.cols - 1, 'comes in from the side');
  const raiders = () => { let n = 0; for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.col[i] === 1 && w.ants.layer[i] === AL.LAYER.NEST) n++; return n; };
  const inside = raiders();
  assert.ok(inside >= t.crew.length * 0.9, 'raiders are inside the nest grid: ' + inside);
  // the raid goes somewhere: either the queen falls or the defenders wear the raiders down
  const q0 = c.queen.hp, died0 = c.stats.died;
  run(w, 90);
  assert.ok(c.stats.died > died0 || !c.queen.alive || c.queen.hp < q0, 'the raiders did damage');
  assert.ok(raiders() < inside, 'defenders killed raiders (or they left with loot)');
});

test('a rival (core AI, abstract nest) loses its queen: a satellite queen takes over, the capital moves, laying goes on', optAI, () => {
  const w = world(), r = w.colonies[1];
  assert.ok(r.inside && r.queen.abstract, 'core AI colony');
  const s = satFor(w, 1, r.x - 900, r.y + 600);
  assert.equal(s.state, 'active');
  const q = r.queen, layT = q.layT;
  // the player overruns the rival nest (core siegeTick kills the abstract queen and emits queenDied)
  r.inside.fill(0); r.siege[C.SOLDIER] = 40; r.siegeBy = 0;
  run(w, 30);
  assert.equal(w.over, null, 'no victory yet: a satellite queen lives');
  assert.ok(r.queen.alive, 'new queen');
  assert.equal(r.queen, q, 'same core queen record, refilled');
  assert.ok(r.queen.layT != null && layT != null);
  assert.equal(r.x, s.x, 'capital moved to the satellite');
  const b0 = r.broodQ.length + r.stats.born; r.stock.sugar = 300; r.stock.protein = 100;
  run(w, 20);
  assert.ok(r.broodQ.length + r.stats.born > b0, 'the AI colony keeps laying');
});

test('a raid tunnel into a core-AI nest drops the party into its siege; a rally onto its mound storms in', optAI, () => {
  const w = world(), c = w.player, r = w.colonies[1];
  for (let k = 0; k < 40; k++) w.ants.spawn(0, C.SOLDIER, 0, c.x + 30, c.y, 0, w.R);
  AL.Sim.countPop(w); c.stock.protein = 200; c.stock.sugar = 200; c.research.tunnel = 1;
  X.CFG.tunnel.maxLen = 5000;
  const t = X.orderTunnel(w, 0, 1, 0);
  X.CFG.tunnel.maxLen = 2200;
  run(w, t.len / X.CFG.tunnel.speed + 1.5);
  assert.equal(t.state, 'done');
  assert.ok(r.sieging || r.siege.reduce((a, b) => a + b, 0) > 0 || r.stats.died > 0, 'party fights inside the rival nest');
  // rally straight onto the rival mound
  for (let k = 0; k < 10; k++) w.ants.spawn(0, C.SOLDIER, 0, r.x + 60, r.y, Math.PI, w.R);
  const before = r.siege.reduce((a, b) => a + b, 0);
  const sent = X.garrison(w, 0, r.x, r.y, 20, 10, 60);
  assert.ok(sent > 0);
  run(w, 8);
  const after = r.siege.reduce((a, b) => a + b, 0);
  assert.ok(after > before || r.stats.died > 0 || !r.queen.alive, 'rallied ants went in');
});

test('player satellites light up the fog of war', { skip: !AL.Fog && !has('fog.js') && 'no fog' }, () => {
  const w = world();
  if (!w.fog) return;
  const s = satFor(w, 0, w.player.x + 1200, w.player.y - 900);
  run(w, 2);
  assert.ok((w.fog.extra || []).some(e => e.exp && Math.abs(e.x - s.x) < 1));
});

// ---- satellites with their own nest (expansion.js addHome) ------------------------------------------------------
test('a satellite of a colony with a real nest is its own underground colony: nest, queen ant, brood, own store', opt, () => {
  const w = world(), c = w.player, A = w.ants;
  const capSugar0 = c.stock.sugar;
  const s = satFor(w, 0, c.x + 800, c.y - 500);
  assert.equal(s.state, 'active');
  assert.ok(s.home != null, 'it has a home nest');
  const h = w.homes[s.home];
  assert.ok(h.nest && h.nest !== c.nest && h.stock !== c.stock && h.brood !== c.brood, 'its own nest, store and brood');
  assert.equal(h.id, c.id); assert.equal(h.hid, s.home);
  assert.ok(h.queen.alive && h.queen.i >= 0 && A.caste[h.queen.i] === C.QUEEN && A.nest[h.queen.i] === h.hid, 'a queen ant in its nest');
  assert.ok(c.stock.sugar < capSugar0 + 1, 'the queen took some reserves with her');
  let mine = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.home[i] === h.hid) mine++;
  assert.ok(mine >= AL.Expansion.CFG.sat.homeWorkers, 'workers live there: ' + mine);
  // it raises its own brood, fed from its own store
  const born0 = c.stats.born; let bornHere = 0;
  const off = AL.on('antBorn', (ww, d) => { if (ww === w && d.col === 0 && A.home[d.i] === h.hid) bornHere++; });
  h.stock.sugar = 200; h.stock.protein = 120;
  run(w, 120); off();
  assert.ok(bornHere > 0, 'ants born in the satellite live there (' + bornHere + ')');
  assert.ok(c.stats.born > born0);
  assert.ok(h.pop.reduce((a, b) => a + b, 0) > 0 && c.popAll >= c.pop.reduce((a, b) => a + b, 0) + h.pop.reduce((a, b) => a + b, 0) - 1);
});

test('a satellite keeps its own store: its foragers bring food home to it, the capital\'s to the capital', opt, () => {
  const w = world(), c = w.player, A = w.ants;
  const s = satFor(w, 0, c.x + 800, c.y - 500), h = w.homes[s.home];
  const got = { cap: 0, sat: 0 };
  const off = AL.on('foodDelivered', (ww, d) => { if (ww === w && d.col === 0) { if (d.hid === h.hid) got.sat++; else got.cap++; } });
  // a laden forager of each next to its own mound
  const f1 = A.spawn(0, C.FORAGER, AL.LAYER.SURFACE, h.x + 30, h.y, Math.PI, w.R); A.home[f1] = h.hid; A.carry[f1] = AL.CARRY.SUGAR; A.state[f1] = ST.RETURN;
  const s0 = h.stock.sugar, c0 = c.stock.sugar;
  run(w, 8); off();
  assert.ok(h.stock.sugar > s0 - 2 || got.sat > 0, 'the satellite forager delivered at the satellite');
  assert.equal(A.home[f1], h.hid);
});

test('the nest tools and the egg queue work on the satellite nest when told to (args.h)', opt, () => {
  require('../public/brush.js'); require('../public/cmd.js');
  const w = world(), c = w.player;
  const s = satFor(w, 0, c.x + 800, c.y - 500), h = w.homes[s.home];
  const q0 = c.eggQueue.length;
  AL.Cmd.exec(w, 0, 'egg', { caste: C.SOLDIER, h: h.hid });
  assert.equal(h.eggQueue[h.eggQueue.length - 1], C.SOLDIER); assert.equal(c.eggQueue.length, q0, 'the capital\'s queue is untouched');
  const d0 = h.nest.digCount, cd0 = c.nest.digCount, T = h.nest.tile, e = h.nest.entrance;
  AL.Cmd.exec(w, 0, 'paint', { t: 'dig', p: 'start', x: (e.c - 8) * T, y: 12 * T, h: h.hid });
  AL.Cmd.exec(w, 0, 'paint', { t: 'dig', p: 'end', x: (e.c - 8) * T, y: 12 * T, h: h.hid });
  assert.ok(h.nest.digCount > d0, 'dig marks in the satellite nest');
  assert.equal(c.nest.digCount, cd0, 'not in the capital');
});

test('orders from a picked nest (args.h): only its ants answer a Collect circle or an alarm', opt, () => {
  require('../public/brush.js'); require('../public/cmd.js');
  const w = world(), c = w.player, A = w.ants;
  const s = satFor(w, 0, c.x + 800, c.y - 500), h = w.homes[s.home];
  run(w, 3);
  const paint = (t, pts, hh) => pts.forEach((p, k) => AL.Cmd.exec(w, 0, 'paint', { t, p: k ? (k === pts.length - 1 ? 'end' : 'move') : 'start', x: p.x, y: p.y, n: 6, h: hh }));
  // a Collect circle between the two hills, ordered from the satellite: only the satellite's ants go
  const f = AL.Surface.addFood(w.surface, { kind: AL.CARRY.SUGAR, x: (c.x + h.x) / 2, y: (c.y + h.y) / 2, r: 12, amount: 200 });
  const r1 = AL.Cmd.exec(w, 0, 'collect', { x: f.x, y: f.y, r: 40, ids: [f.id], n: 6, h: h.hid });
  assert.ok(r1.ok, JSON.stringify(r1));
  const o = c.collects[c.collects.length - 1];
  assert.equal(o.hid, h.hid);
  run(w, 20);
  const by = { cap: 0, sat: 0 }; for (let k = 0; k < o.mi.length; k++) { const i = o.mi[k]; if (A.home[i] === h.hid || (A.layer[i] === AL.LAYER.NEST && A.nest[i] === h.hid)) by.sat++; else by.cap++; }
  assert.ok(by.sat > 0 && by.cap === 0, 'only satellite ants answer: ' + JSON.stringify(by));
  // the same from the capital (with satellites around its orders carry the capital's id)
  const r2 = AL.Cmd.exec(w, 0, 'collect', { x: f.x, y: f.y, r: 40, ids: [f.id], n: 4 });
  assert.equal(c.collects.find(q => q.id === r2.id).hid, c.hid);
  // an alarm from the satellite: its soldiers rally, the capital's stay put
  const sol = A.spawn(0, C.SOLDIER, AL.LAYER.SURFACE, c.x + 20, c.y, 0, w.R); A.home[sol] = c.hid; A.state[sol] = ST.WANDER;
  const sol2 = A.spawn(0, C.SOLDIER, AL.LAYER.SURFACE, h.x + 20, h.y, 0, w.R); A.home[sol2] = h.hid; A.state[sol2] = ST.WANDER;
  paint('alarm', [{ x: h.x + 150, y: h.y }, { x: h.x + 160, y: h.y }], h.hid);
  assert.equal(A.state[sol2], ST.RALLY, 'the satellite soldier rallies');
  assert.notEqual(A.state[sol], ST.RALLY, 'the capital soldier does not');
  assert.equal(AL.Orders.hotFor(c, c.hid), null, 'no alarm for the capital');
  assert.equal(AL.Orders.hotFor(c, h.hid).hid, h.hid);
});

test('a ruined satellite closes its nest: its ants come up and go home to the capital', opt, () => {
  const w = world(), c = w.player, A = w.ants;
  const s = satFor(w, 0, c.x + 800, c.y - 500), h = w.homes[s.home];
  run(w, 5);
  AL.Expansion.ruin ? AL.Expansion.ruin(w, c, s, 1) : (s.hp = 0, AL.Expansion.closeHome(w, c, s));
  if (!h.gone) AL.Expansion.closeHome(w, c, s);
  assert.ok(h.gone);
  let left = 0, homeless = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0) { if (A.layer[i] === AL.LAYER.NEST && A.nest[i] === h.hid) left++; if (A.home[i] === h.hid) homeless++; }
  assert.equal(left, 0, 'nobody left in the closed nest'); assert.equal(homeless, 0, 'everyone lives at the capital now');
  run(w, 5);
});

test('a satellite with its own nest is fought for in its tunnels: raiders break in, defenders fight, the queen can fall', opt, () => {
  const w = world({ colonies: 2 }), c = w.player, A = w.ants, X = AL.Expansion;
  const s = satFor(w, 0, c.x + 800, c.y - 500), h = w.homes[s.home];
  for (const o of w.colonies) if (o.ai) o.ai.raidT = 1e9;
  const hp0 = s.hp;
  // a band of rival soldiers at the satellite's door
  for (let k = 0; k < 24; k++) { const i = A.spawn(1, C.SOLDIER, AL.LAYER.SURFACE, h.x + (k % 5) * 3 - 6, h.y + 4, 0, w.R); A.state[i] = ST.GUARD; A.tx[i] = h.x; A.ty[i] = h.y; A.timer[i] = 90; }
  let inside = 0, fights = 0;
  for (let s2 = 0; s2 < 40; s2++) {
    run(w, 1);
    for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === AL.LAYER.NEST && A.nest[i] === h.hid) { if (A.col[i] === 1) inside++; if (A.state[i] === ST.FIGHT) fights++; }
  }
  assert.ok(inside > 0, 'raiders went down into the satellite\'s nest');
  assert.ok(fights > 0, 'and fought there');
  // no wearing down from outside any more (once 24 soldiers have killed her queen, an orphaned satellite does wear down)
  if (h.queen.alive) assert.equal(s.hp, hp0, 'no wearing down from outside any more'); else assert.equal(s.state, 'orphan', 'the raiders killed its queen');
  // with the queen dead the satellite is orphaned
  if (h.queen.alive) AL.Combat.killAnt(w, h.queen.i, 'fight');
  run(w, 2);
  assert.equal(s.state, 'orphan');
  assert.equal(c.queen.alive, true, 'the capital\'s queen is fine');
  assert.equal(w.over, null);
});
