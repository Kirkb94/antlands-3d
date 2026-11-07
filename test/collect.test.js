// The Collect tool (Nov 2026, replaces the player's Recruit): drag a circle over food and that many ants carry
// everything inside home, food piles and dead bugs, trip after trip until it is gone (orders.js addCollect).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'nestclimate', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'fog', 'species', 'expansion', 'research', 'victory',
  'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'eco-hunters', 'brush', 'cmd', 'raids', 'links', 'nestplan']) require('../public/' + f + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, K = AL.CARRY;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
// a calm summer yard with a big store, the food near the mound cleared away
function yard() {
  const w = AL.Sim.createWorld({ seed: 6, worldTime: { season: 'summer', timeOfDay: 0.35 }, noMower: true });
  const c = w.player;
  for (const f of w.surface.foods) if (!f.gone && AL.dist2(f.x, f.y, c.x, c.y) < 700 * 700) { f.amount = 0; f.gone = true; }
  w.surface.foodDirty = true;
  c.stock.sugar = 300; c.stock.protein = 200; c.stock.water = 60;
  return w;
}
const spot = (w, dx, dy) => {   // open ground near the mound
  const c = w.player;
  for (let k = 0; k < 40; k++) { const x = c.x + dx + k * 13, y = c.y + dy - k * 7; if (!AL.Surface.isBlocked(w.surface, x, y)) return { x, y }; }
  return { x: c.x + dx, y: c.y + dy };
};
const food = (w, p, o) => AL.Surface.addFood(w.surface, Object.assign({ kind: K.SUGAR, x: p.x, y: p.y, r: 8, amount: 10 }, o));
const onOrder = (w, o) => { const A = w.ants; let n = 0; for (let k = 0; k < o.mi.length; k++) if (A.state[o.mi[k]] && A.uid[o.mi[k]] === o.mu[k]) n++; return n; };

test('the ants in a Collect circle carry every pile and the dead bug in it home, then the order closes', () => {
  const w = yard(), c = w.player, p = spot(w, 260, -120);
  const piles = [food(w, p), food(w, { x: p.x + 30, y: p.y + 10 }, { kind: K.PROTEIN, amount: 8 }), food(w, { x: p.x - 20, y: p.y + 25 }, { amount: 12 })];
  const moth = food(w, { x: p.x + 10, y: p.y - 30 }, { kind: K.PROTEIN, r: 10, amount: 22, max: 22, big: true, needed: 3, visual: 'moth', carcass: true });
  const s0 = c.stats.foodIn;
  const r = AL.Cmd.exec(w, 0, 'collect', { x: p.x, y: p.y, r: 70, ids: piles.concat(moth).map(f => f.id), n: 10 });
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.equal(r.piles, 4); assert.equal(r.want, 10);
  const o = c.collects[0];
  run(w, 20);
  assert.ok(onOrder(w, o) >= 6, 'ants joined (' + onOrder(w, o) + ')');
  let t = 0; while (!o.done && t < 300) { run(w, 5); t += 5; }
  assert.ok(o.done, 'the order closed after ' + t + ' s; food left: ' + o.foods.length);
  assert.equal(o.why, 'done');
  for (const f of piles.concat(moth)) assert.ok(f.gone || f.amount < 1, 'all fetched: ' + f.kind + ' ' + f.amount);
  assert.ok(c.stats.foodIn - s0 >= 30, 'it reached the store (' + (c.stats.foodIn - s0) + ')');
  run(w, 10);
  let still = 0; for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] === ST.COLLECT && w.ants.col[i] === 0) still++;
  assert.equal(still, 0, 'nobody is still out collecting');
  assert.equal(c.collects, null, 'the finished order is dropped');
});

test('only food your ants can carry home counts, and never more ants than loads', () => {
  const w = yard(), c = w.player, p = spot(w, -260, 140);
  const water = food(w, p, { kind: K.WATER, r: 20, amount: 400 }), leaf = food(w, { x: p.x + 20, y: p.y }, { kind: K.LEAF, r: 20, amount: 100 });
  const far = food(w, { x: p.x + 600, y: p.y }, { amount: 10 });
  assert.equal(AL.Cmd.exec(w, 0, 'collect', { x: p.x, y: p.y, r: 60, ids: [water.id, leaf.id, far.id], n: 25 }).ok, false, 'water, leaves (no fungus garden) and food outside the circle');
  const crumb = food(w, { x: p.x - 10, y: p.y + 5 }, { amount: 4, noMul: true });   // two loads
  const r = AL.Cmd.exec(w, 0, 'collect', { x: p.x, y: p.y, r: 60, ids: [crumb.id, water.id, 99999], n: 25 });
  assert.ok(r.ok); assert.equal(r.piles, 1); assert.equal(r.want, 2, 'two loads: two ants');
});

test('calling a Collect off sends its ants home, and erasing over the circle does too', () => {
  const w = yard(), c = w.player, p = spot(w, 320, 60);
  const big = food(w, p, { amount: 300, r: 14 });
  const r = AL.Cmd.exec(w, 0, 'collect', { x: p.x, y: p.y, r: 50, ids: [big.id], n: 12 });
  run(w, 25);
  const o = c.collects.find(q => q.id === r.id);
  assert.ok(onOrder(w, o) > 0);
  const n = AL.Cmd.exec(w, 0, 'collectCancel', { id: r.id });
  assert.ok(o.done && o.why === 'cancelled');
  assert.ok(n >= 0);
  run(w, 1);
  for (let i = 0; i < w.ants.high; i++) assert.notEqual(w.ants.state[i] === ST.COLLECT && w.ants.str[i] === r.id, true, 'nobody walks out to it');
  run(w, 30);
  for (let k = 0; k < o.mi.length; k++) { const i = o.mi[k]; if (w.ants.state[i] && w.ants.uid[i] === o.mu[k]) assert.notEqual(w.ants.state[i], ST.COLLECT); }
  // a second one, erased over its middle
  const r2 = AL.Cmd.exec(w, 0, 'collect', { x: p.x, y: p.y, r: 50, ids: [big.id], n: 5 });
  for (const ph of ['start', 'end']) AL.Cmd.exec(w, 0, 'paint', { t: 'erase', p: ph, x: p.x + 5, y: p.y });
  assert.ok(c.collects.find(q => q.id === r2.id).done, 'erased');
});

test('an ant on a Collect that dies is replaced by another from the nest', () => {
  const w = yard(), c = w.player, p = spot(w, 220, 200);
  const big = food(w, p, { amount: 400, r: 16 });
  const r = AL.Cmd.exec(w, 0, 'collect', { x: p.x, y: p.y, r: 50, ids: [big.id], n: 5 });
  const o = c.collects.find(q => q.id === r.id);
  run(w, 15);
  assert.equal(o.mi.length, 5);
  const dead = o.mi[0], uid = o.mu[0];
  w.ants.kill(dead);
  run(w, 20);
  assert.equal(o.mi.length, 5, 'back to five');
  assert.ok(!o.mi.some((i, k) => i === dead && o.mu[k] === uid), 'the dead one left the order');
});

test('two copies of a world with a Collect order stay in lockstep', () => {
  const make = () => yard();
  const a = make(), b = make(), p = spot(a, 260, -160);
  for (const w of [a, b]) {
    const fs = [food(w, p, { amount: 30 }), food(w, { x: p.x + 25, y: p.y }, { kind: K.PROTEIN, amount: 20 })];
    AL.Cmd.runTurn(w, [{ col: 0, n: 'collect', a: { x: p.x, y: p.y, r: 60, ids: fs.map(f => f.id), n: 15 } }]);
  }
  for (let s = 0; s < 60; s++) { run(a, 1); run(b, 1); }
  const sig = w => { const A = w.ants; let h = 0; for (let i = 0; i < A.high; i++) if (A.state[i]) h = (h * 31 + ((A.x[i] * 100) | 0) + A.state[i]) | 0; return h + ':' + w.player.stock.sugar + ':' + w.player.stock.protein; };
  assert.equal(sig(a), sig(b));
});
