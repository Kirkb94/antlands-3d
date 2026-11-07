// Fight injuries (injury.js, tuning data.js AL.INJURY): lost legs slow ants, one side gone walks them in circles,
// headless ants wander blind until they starve; limbs never grow back.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
for (const m of ['sim', 'life', 'combat', 'orders', 'ai', 'fog']) require('../public/' + m + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, IJ = AL.Injury, T = AL.INJURY;
const run = (w, secs) => { for (let k = 0; k < secs * 30; k++) AL.Sim.step(w); };
function world(seed) {
  const w = AL.Sim.createWorld({ seed: seed || 3 });
  for (const c of w.colonies) if (c.ai) c.ai.raidT = 1e9;   // no raids
  w.player.stock.sugar = 300;
  return w;
}
// a surface ant of the player's colony at (dx, dy) from the mound, walking home
function homing(w, dx, dy, caste) {
  const A = w.ants, c = w.player;
  const i = A.spawn(0, caste == null ? C.WORKER : caste, L.SURFACE, c.x + dx, c.y + dy, Math.atan2(-dy, -dx), w.R);
  A.state[i] = ST.HOMING;
  return i;
}
const step = (A, i) => Math.hypot(A.x[i] - A.px[i], A.y[i] - A.py[i]);
const pop = m => { let n = 0; for (let b = 0; b < 6; b++) n += m >> b & 1; return n; };

test('every lost leg costs exactly 20% of the speed; 5 or 6 lost and it cannot move', () => {
  const w = world(), A = w.ants;
  for (let k = 0; k <= 6; k++) {
    const i = homing(w, 300, 0);
    A.legs[i] = 63 >> k;   // k legs gone
    assert.equal(IJ.lost(w, i), k);
    assert.ok(Math.abs(IJ.speedMul(w, i) - Math.max(0, 1 - 0.2 * k)) < 1e-9, 'speedMul ' + IJ.speedMul(w, i));
  }
  // walking side by side: the lame ant covers exactly 0.8 / 0.6 / ... of the whole ant's step
  const w2 = world(), B = w2.ants;
  const ants = [0, 1, 2, 3, 4, 5, 6].map(k => { const i = homing(w2, 260, 0); B.legs[i] = 63 >> k; B.a[i] = Math.PI; return i; });
  const x0 = ants.map(i => B.x[i]), y0 = ants.map(i => B.y[i]);
  run(w2, 0.1);
  const s0 = step(B, ants[0]);
  assert.ok(s0 > 0.5, 'the whole ant walks (' + s0 + ')');
  for (let k = 1; k <= 4; k++) assert.ok(Math.abs(step(B, ants[k]) / s0 - (1 - 0.2 * k)) < 1e-3, k + ' legs lost: ' + (step(B, ants[k]) / s0).toFixed(4));
  run(w2, 10);
  for (const k of [5, 6]) { const i = ants[k]; assert.ok(Math.hypot(B.x[i] - x0[k], B.y[i] - y0[k]) < 1e-6, k + ' legs lost: has not moved'); }
});

test('no legs left on one side: it walks in small circles near where it started', () => {
  for (const legs of [0b111000, 0b000111, 0b011000]) {   // left side gone, right side gone, left gone + one right leg lost
    const w = world(), A = w.ants;
    const i = homing(w, 220, 140), u = A.uid[i], x0 = A.x[i], y0 = A.y[i];
    A.legs[i] = legs; IJ.mem(A).ijA[i] = A.a[i];
    assert.ok(IJ.circling(w, i), 'circling');
    let far = 0, path = 0;
    for (let s = 0; s < 120; s++) {
      for (let k = 0; k < 30; k++) { AL.Sim.step(w); path += step(A, i); }
      assert.equal(A.uid[i], u, 'still alive at ' + s + ' s');
      far = Math.max(far, Math.hypot(A.x[i] - x0, A.y[i] - y0));
    }
    assert.ok(path > 300, 'it keeps walking (' + path.toFixed(0) + ' units)');
    assert.ok(far < 25, 'but never gets anywhere (' + far.toFixed(1) + ' units from the start)');
    assert.equal(A.layer[i], L.SURFACE, 'never got home');
  }
});

test('a headless ant wanders blind and slow, ignores trails, orders and enemies, can\'t eat, and starves', () => {
  const w = world(), A = w.ants, c = w.player;
  const events = [], deaths = [];
  const off = AL.on('antInjured', (ww, d) => { if (ww === w) events.push(d); });
  const off2 = AL.on('antDied', (ww, d) => { if (ww === w) deaths.push(d); });
  const i = homing(w, 260, -60), u = A.uid[i], whole = homing(w, 260, -60);
  A.carry[i] = AL.CARRY.SUGAR;
  IJ.behead(w, i);
  assert.equal(A.headless[i], 1);
  assert.deepEqual(events.map(e => e.kind), ['head']);
  assert.equal(A.carry[i], 0, 'dropped what it carried');
  assert.equal(IJ.canEat(w, i), false, 'can\'t eat');
  assert.equal(IJ.canEat(w, whole), true);
  assert.equal(AL.Combat.reach(A, i), 0, 'starts no fights');
  // a strong food trail all round it: it never follows (its trail memory never sees one)
  const g = w.pher.food[0];
  for (let dx = -120; dx <= 120; dx += 8) for (let dy = -120; dy <= 120; dy += 8) g.deposit(A.x[i] + dx, A.y[i] + dy, 3);
  run(w, 0.1);
  assert.ok(Math.abs(step(A, i) / step(A, whole) - T.HEADLESS_SPEED) < 1e-3, 'stumbles at ' + T.HEADLESS_SPEED + ' of its speed');
  // orders and alarms don't reach it
  A.state[i] = ST.RALLY; run(w, 0.1);
  assert.equal(A.state[i], ST.WANDER, 'back to wandering');
  A.state[i] = ST.HEAL; run(w, 0.1);
  assert.equal(A.state[i], ST.WANDER);
  // an enemy jumps it: it doesn't bite back
  const e = A.spawn(1, C.WORKER, L.SURFACE, A.x[i] + 3, A.y[i], 0, w.R);
  AL.Combat.engage(w, e, i);
  assert.notEqual(A.state[i], ST.FIGHT, 'doesn\'t fight back');
  A.kill(e);
  // food right under it: it can't pick it up
  AL.Surface.addFood(w.surface, { kind: AL.CARRY.SUGAR, x: A.x[i], y: A.y[i], r: 10, amount: 20 });
  w.surface.foodDirty = true;
  let maxFar = 0; const sx = A.x[i], sy = A.y[i];
  for (let s = 0; s < 20; s++) { run(w, 1); assert.equal(A.carry[i], 0, 'never carries'); assert.ok(A.tmUid[i] !== u || A.tmOn[i] < 0, 'never on a trail'); maxFar = Math.max(maxFar, Math.hypot(A.x[i] - sx, A.y[i] - sy)); }
  assert.ok(maxFar > 3, 'it does wander about (' + maxFar.toFixed(1) + ')');
  // it starves within a few minutes: the fallback drain, or with per-ant hunger (hunger.js, people's colonies) its
  // stomach runs empty first (it can't eat) and then it starves, which takes longer
  const limit = A.gut && AL.HUNGER ? 900 : T.STARVE_T + 30;
  let t = 20;
  while (A.uid[i] === u && t < limit) { run(w, 1); t++; }
  assert.notEqual(A.uid[i], u, 'dead after ' + t + ' s');
  assert.ok(t > T.STARVE_T * 0.6, 'but it took a while (' + t + ' s)');
  assert.ok(deaths.some(d => d.i === i && d.cause === 'starve'), 'of starvation');
  off(); off2();
});

test('stuck and circling rival ants starve too; queens are never decapitated', () => {
  const w = world(), A = w.ants, r = w.colonies[1];
  const i = A.spawn(1, C.WORKER, L.SURFACE, r.x + 250, r.y, 0, w.R), u = A.uid[i];
  A.legs[i] = 1;   // five legs gone
  let t = 0;
  while (A.uid[i] === u && t < T.STARVE_T + 30) { run(w, 1); t++; }
  assert.notEqual(A.uid[i], u, 'a stuck rival ant starves (' + t + ' s)');
  const q = w.player.queen.i;
  IJ.behead(w, q);
  for (let k = 0; k < 10000; k++) IJ.bite(w, q, 1, 3, 100);   // ~340 rolls at 4%: a leg goes for sure
  assert.equal(A.headless[q], 0, 'the queen keeps her head');
  assert.ok(A.legs[q] !== 63, 'but she can lose legs');
  assert.ok(IJ.jawOf(w.player, C.MAJOR) > IJ.jawOf(w.player, C.SOLDIER) && IJ.jawOf(w.player, C.SOLDIER) > IJ.jawOf(w.player, C.WORKER), 'bigger castes, bigger jaws');
});

test('healing restores hp, not limbs', () => {
  const w = world(), A = w.ants, [x, y] = AL.Nest.centre(w.nest, w.nest.tiles[AL.Nest.CH.QUEEN][1]);
  const i = A.spawn(0, C.WORKER, L.NEST, x, y, 0, w.R), u = A.uid[i];
  A.hp[i] = A.maxhp[i] = AL.Combat.maxHp(w.player, C.WORKER); A.hp[i] *= 0.2; A.tx[i] = x; A.ty[i] = y;
  A.legs[i] = 0b110110;   // a front leg gone on each side
  run(w, 70);
  assert.equal(A.uid[i], u);
  assert.ok(A.hp[i] >= A.maxhp[i] * AL.HEAL.FULL, 'healed (' + A.hp[i].toFixed(1) + ')');
  assert.equal(A.legs[i], 0b110110, 'legs never grow back');
});

test('abstract rival nests keep their cripples: lost legs walk back out', () => {
  const w = world(), A = w.ants, r = w.colonies[1];
  const i = A.spawn(1, C.SOLDIER, L.SURFACE, r.x, r.y, 0, w.R);
  A.legs[i] = 0b110101;   // two legs gone
  AL.AI.enterAbstract(w, i);
  assert.ok(Math.abs(r.crip[C.SOLDIER] - 2) < 1e-9, 'its lost legs pooled');
  const old = new Set(); for (let j = 0; j < A.high; j++) if (A.state[j]) old.add(A.uid[j]);
  AL.AI.release(w, r, C.SOLDIER, ST.WANDER, Math.floor(r.inside[C.SOLDIER]));
  let lost = 0;
  for (let j = 0; j < A.high; j++) if (A.state[j] && !old.has(A.uid[j])) { lost += 6 - pop(A.legs[j]); assert.ok((A.legs[j] & 7) && (A.legs[j] >> 3), 'nobody comes out walking in circles'); }
  assert.equal(lost, 2, 'two legs came back out');
});

test('injuries in fights are deterministic and happen', () => {
  const sig = () => {
    const w = world(11), A = w.ants, c = w.player;
    let legs = 0, heads = 0;
    const off = AL.on('antInjured', (ww, d) => { if (ww === w) { if (d.kind === 'leg') legs++; else heads++; } });
    for (let k = 0; k < 30; k++) {
      A.spawn(0, k % 3 ? C.WORKER : C.SOLDIER, L.SURFACE, c.x + 300 + (k % 6) * 5, c.y + 200 + ((k / 6) | 0) * 5, 0, w.R);
      A.spawn(1, k % 3 ? C.WORKER : C.MAJOR, L.SURFACE, c.x + 330 + (k % 6) * 5, c.y + 200 + ((k / 6) | 0) * 5, Math.PI, w.R);
    }
    run(w, 40);
    off();
    let h = 2166136261;
    for (let i = 0; i < A.high; i++) { h = Math.imul(h ^ A.legs[i] ^ (A.headless[i] << 8) ^ A.state[i] << 12, 16777619) >>> 0; h = Math.imul(h ^ Math.round(A.x[i] * 100), 16777619) >>> 0; }
    return { h, legs, heads, r: w.R.state() };
  };
  const a = sig(), b = sig();
  assert.deepEqual(a, b);
  assert.ok(a.legs > 0, 'legs were lost (' + a.legs + ', heads ' + a.heads + ')');
});
