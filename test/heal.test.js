// Wounded ants go home to heal (data.js AL.HEAL, combat.js goHeal, life.js rest/healing, ai.js wound pool).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
for (const m of ['sim', 'life', 'combat', 'orders', 'ai', 'fog']) require('../public/' + m + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, ACT = AL.ACT, HL = AL.HEAL;
const run = (w, secs) => { for (let k = 0; k < secs * 30; k++) AL.Sim.step(w); };
function world(seed) {
  const w = AL.Sim.createWorld({ seed: seed || 3 });
  for (const c of w.colonies) if (c.ai) c.ai.raidT = 1e9;   // no raids
  w.player.stock.sugar = 300;
  return w;
}
// a wounded ant in the player's nest (on a queen chamber tile)
function nestAnt(w, caste, frac) {
  const A = w.ants, [x, y] = AL.Nest.centre(w.nest, w.nest.tiles[AL.Nest.CH.QUEEN][1]);
  const i = A.spawn(0, caste, L.NEST, x, y, 0, w.R);
  A.hp[i] = A.maxhp[i] = AL.Combat.maxHp(w.player, caste); A.hp[i] *= frac; A.tx[i] = x; A.ty[i] = y;
  return [i, A.uid[i]];
}
const resting = (A, i) => A.state[i] === ST.N_HEAL || (A.state[i] === ST.N_GOTO && A.act[i] === ACT.HEAL);

test('a wounded worker walks home, rests in the nest and gets up healed', () => {
  const w = world(), A = w.ants, c = w.player;
  const i = A.spawn(0, C.WORKER, L.SURFACE, c.x + 160, c.y + 20, 0, w.R), u = A.uid[i];
  A.hp[i] = A.maxhp[i] * 0.2;
  run(w, 1);
  assert.equal(A.state[i], ST.HEAL, 'heads home to heal');
  let t = 0;
  while (A.layer[i] !== L.NEST && t < 40) { run(w, 1); t++; }
  assert.equal(A.uid[i], u, 'still the same ant');
  assert.equal(A.layer[i], L.NEST, 'got home (' + t + ' s)');
  assert.ok(resting(A, i), 'lies up in the nest (state ' + A.state[i] + ')');
  const hp0 = A.hp[i], sugar0 = c.stock.sugar;
  let healSug = 0; const hp1 = () => A.hp[i];
  t = 0;
  while (resting(A, i) && t < 90) { const h0 = hp1(), s0 = c.stock.sugar; run(w, 1); t++; assert.ok(A.hp[i] <= A.maxhp[i]); if (A.hp[i] > h0) healSug += (A.hp[i] - h0) * AL.HEAL.SUGAR_PER_HP; }
  assert.equal(A.uid[i], u);
  assert.ok(!resting(A, i), 'gets up again');
  assert.ok(t >= 20 && t <= 60, 'healing takes a while (' + t + ' s)');
  assert.ok(A.hp[i] >= A.maxhp[i] * HL.FULL, 'healed (' + A.hp[i].toFixed(1) + '/' + A.maxhp[i] + ')');
  assert.ok(hp0 < A.maxhp[i] * 0.4);
  assert.ok(healSug > 0 && sugar0 > 0, 'healing used sugar (' + healSug.toFixed(2) + ')');   // (the store's level itself also moves with foraging)
  // nest healing tops up to exactly max hp, never above
  const [j] = nestAnt(w, C.SOLDIER, 0.98);
  run(w, 3);
  assert.equal(A.hp[j], A.maxhp[j]);
});

test('no healing while the colony starves', () => {
  const w = world(5), A = w.ants, c = w.player;
  c.recall = true;   // nobody goes out for food
  for (let k = 0; k < A.high; k++) if (A.state[k] && A.col[k] === 0 && A.layer[k] === L.SURFACE) A.kill(k);
  const [i, u] = nestAnt(w, C.WORKER, 0.3), hp0 = A.hp[i];
  for (let k = 0; k < A.high; k++) if (A.state[k] && A.col[k] === 0 && A.caste[k] !== C.QUEEN && k !== i) A.gut[k] = 0.2;   // ants go hungry (hunger.js)
  for (let k = 0; k < 20 * 30; k++) { c.stock.sugar = 0; c.stock.protein = 0; AL.Sim.step(w); if (k > 40 && A.uid[i] === u) assert.ok(A.hp[i] <= hp0 + 1e-6, 'no healing at ' + k); }
  assert.ok(c.starving, 'colony is starving');
  if (A.uid[i] === u) assert.ok(!resting(A, i), 'a starving colony\'s wounded keep working');
  // fed again: it heals
  c.recall = false;
  // (compare with its hp at feeding time: starvation may have bitten it below hp0 meanwhile)
  if (A.uid[i] === u && A.layer[i] === L.NEST) { const hpFed = A.hp[i]; c.stock.sugar = 200; run(w, 3); assert.ok(A.hp[i] > hpFed || A.layer[i] !== L.NEST); }
});

test('a wounded ant ignores a recruit order until healed', () => {
  const w = world(7), A = w.ants, c = w.player;
  const o = AL.Orders.addRecruit(w, 0, [{ x: c.x, y: c.y }, { x: c.x + 300, y: c.y }], 400);
  const [i, u] = nestAnt(w, C.WORKER, 0.15);
  AL.Life.decide(w, i);
  assert.ok(resting(A, i), 'lies up instead of answering');
  let t = 0;
  while (A.hp[i] < A.maxhp[i] * HL.FULL && t < 80) {
    run(w, 1); t++;
    assert.equal(A.uid[i], u);
    assert.ok(A.state[i] !== ST.RECRUIT && A.prev[i] !== ST.RECRUIT, 'not pulled out while wounded (' + t + ' s)');
  }
  assert.ok(A.hp[i] >= A.maxhp[i] * HL.FULL, 'healed');
  assert.ok(!o.done && o.assigned < o.want, 'order still open');
  // healed: next time it thinks it takes the order
  t = 0;
  while (A.state[i] !== ST.RECRUIT && A.prev[i] !== ST.RECRUIT && t < 30) { run(w, 1); t++; }
  assert.ok(A.state[i] === ST.RECRUIT || A.prev[i] === ST.RECRUIT, 'answers the order once healed');
});

test('a wounded soldier outside ignores the alarm unless home is raided', () => {
  const w = world(9), A = w.ants, c = w.player;
  const i = A.spawn(0, C.SOLDIER, L.SURFACE, c.x + 200, c.y, 0, w.R);
  A.hp[i] = A.maxhp[i] * 0.2;
  run(w, 1);
  assert.equal(A.state[i], ST.HEAL);
  AL.Orders.addAlarm(w, 0, c.x + 400, c.y + 100);
  assert.equal(A.state[i], ST.HEAL, 'keeps going home');
  c._raidT = w.t;   // a raid on the mound
  AL.Orders.addAlarm(w, 0, c.x + 60, c.y);
  assert.equal(A.state[i], ST.RALLY, 'defends the mound');
});

test('rival ants heal indoors over time, not for free on the way in', () => {
  const w = world(11), A = w.ants, r = w.colonies[1];
  r.stock.sugar = 200;
  const i = A.spawn(1, C.SOLDIER, L.SURFACE, r.x, r.y, 0, w.R);
  A.maxhp[i] = AL.CASTES[C.SOLDIER].hp * (r.sp.hp || 1); A.hp[i] = A.maxhp[i] * 0.2;
  const missing = A.maxhp[i] - A.hp[i];
  // only soldiers of ours inside, so the released one carries the whole wound
  r.inside.fill(0); AL.AI.wounds(r).fill(0);
  AL.AI.enterAbstract(w, i);
  assert.ok(Math.abs(r.wound[C.SOLDIER] - missing) < 1e-6);
  const s0 = r.stock.sugar;
  AL.AI.healInside(r);
  assert.ok(r.wound[C.SOLDIER] < missing && r.wound[C.SOLDIER] > 0, 'heals a bit each second');
  assert.ok(r.stock.sugar < s0, 'for sugar');
  const before = r.wound[C.SOLDIER];
  AL.AI.release(w, r, C.SOLDIER, ST.WANDER, 1);
  let j = -1; for (let k = 0; k < A.high; k++) if (A.state[k] && A.col[k] === 1 && A.caste[k] === C.SOLDIER) j = k;
  assert.ok(j >= 0);
  assert.ok(Math.abs(A.maxhp[j] - A.hp[j] - before) < 1e-3, 'walks out with its wound');
  assert.ok(r.wound[C.SOLDIER] < 1e-6);
  // back in, then a minute indoors: healed
  AL.AI.enterAbstract(w, j);
  for (let k = 0; k < 60; k++) AL.AI.healInside(r);
  assert.ok(r.wound[C.SOLDIER] < 0.5, 'healed after a minute (' + r.wound[C.SOLDIER].toFixed(2) + ')');
});
