// Swarms against big ants (combat.js GANG / PILE / BULK_MAX, injury.js PULL)
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
for (const m of ['sim', 'life', 'injury', 'combat', 'orders', 'ai']) require('../public/' + m + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, CT = AL.COMBAT_TUNE;
const run = (w, secs) => { for (let k = 0; k < secs * 30; k++) AL.Sim.step(w); };
// an empty patch of yard: the player's colony is spA, the rival spB
function arena(seed, spA, spB) {
  const w = AL.Sim.createWorld({ seed, species: spA, rivalSpecies: [spB] });
  for (let i = 0; i < w.ants.high; i++) if (w.ants.state[i] && w.ants.layer[i] === L.SURFACE) w.ants.kill(i);
  for (const c of w.colonies) if (c.ai) c.ai.raidT = 1e9;
  for (const cr of w.surface.creatures) cr.alive = false;
  return w;
}
function squad(w, col, caste, n, x, y) {
  const A = w.ants, ids = [];
  for (let k = 0; k < n; k++) {
    const i = A.spawn(col, caste, L.SURFACE, x + (k % 4) * 4, y + ((k / 4) | 0) * 4, col ? Math.PI : 0, w.R);
    A.hp[i] = A.maxhp[i] = AL.Combat.maxHp(w.colonies[col], caste);
    A.state[i] = ST.GUARD; A.tx[i] = x; A.ty[i] = y; A.timer[i] = 999; ids.push([i, A.uid[i]]);
  }
  return ids;
}
const alive = (w, ids) => ids.filter(([i, u]) => w.ants.state[i] && w.ants.uid[i] === u).length;
const hpOf = (w, ids) => ids.reduce((s, [i, u]) => s + (w.ants.state[i] && w.ants.uid[i] === u ? w.ants.hp[i] : 0), 0);

test('bullet ants win small even fights, but a swarm four times their number drags them down', () => {
  const fight = (seed, nb, nf) => {
    const w = arena(seed, 'fire', 'bullet');
    const f = squad(w, 0, C.WORKER, nf, 2000, 2700), b = squad(w, 1, C.WORKER, nb, 2024, 2700);
    for (let t = 0; t < 60 && alive(w, f) && alive(w, b); t++) run(w, 1);
    return alive(w, b) > 0 && !alive(w, f);
  };
  let duel = 0, even = 0, swarmed = 0;
  for (const seed of [4, 5, 6, 7, 8, 9]) {
    if (fight(seed, 1, 1)) duel++;
    if (fight(seed, 4, 4)) even++;          // four on four: the bullet ants win
    if (!fight(seed, 4, 16)) swarmed++;     // four to one: the swarm wins (the bullet ants won most of these before swarms ganged up)
  }
  assert.equal(duel, 6, 'the bullet ant won every duel');
  assert.ok(even >= 5, '4 bullet ants beat 4 fire ants ' + even + ' times of 6');
  assert.ok(swarmed >= 5, '16 fire ants beat 4 bullet ants ' + swarmed + ' times of 6');
});

test('ganging up only counts between species: a colony\'s own majors keep their worth against its workers', () => {
  const fight = gang => {
    const keep = CT.GANG; CT.GANG = gang;
    const w = arena(5, 'fire', 'fire');
    const m = squad(w, 1, C.MAJOR, 1, 2014, 2700), k = squad(w, 0, C.WORKER, 4, 2000, 2700);
    run(w, 6);
    CT.GANG = keep;
    return hpOf(w, m) + ':' + hpOf(w, k);
  };
  assert.equal(fight(CT.GANG), fight(0));
});

test('a big ant already held down is stunned in full by a small newcomer', () => {
  const stunFrom = held => {
    const w = arena(4, 'fire', 'bullet'), A = w.ants;
    const [[b]] = squad(w, 1, C.WORKER, 1, 2014, 2700), [[f1], [f2]] = squad(w, 0, C.WORKER, 2, 2000, 2700);
    A.state[b] = ST.FIGHT; A.tgt[b] = f1; A.tuid[b] = A.uid[f1];   // busy with someone else
    A.cbHeld[b] = held;
    AL.Combat.engage(w, f2, b);
    return A.cbStun[b];
  };
  const loose = stunFrom(0), pinned = stunFrom(3);
  assert.ok(loose > 0 && loose < CT.STUN * 0.7, 'a lone fire ant barely rocks a bullet ant (' + loose + ')');
  assert.ok(Math.abs(pinned - CT.STUN) < 1e-6, 'held down, the grab lands in full (' + pinned + ')');
});

test('a big enemy rings a bigger alarm: more nestmates come to a fight with a bullet ant', () => {
  const came = bulk => {
    const keep = CT.BULK_MAX; CT.BULK_MAX = bulk;
    const w = arena(6, 'fire', 'bullet'), A = w.ants;
    squad(w, 0, C.WORKER, 1, 2000, 2700); squad(w, 1, C.WORKER, 1, 2010, 2700);
    const idle = [];
    for (let k = 0; k < 10; k++) { const i = A.spawn(0, C.SOLDIER, L.SURFACE, 2000 - 70 - (k % 2) * 10, 2660 + k * 8, 0, w.R); A.state[i] = ST.WANDER; A.timer[i] = 0; idle.push(i); }
    run(w, 1.2);
    CT.BULK_MAX = keep;
    return idle.filter(i => A.state[i] === ST.RALLY || A.state[i] === ST.FIGHT).length;
  };
  const heads = came(1), bulk = came(CT.BULK_MAX);
  assert.ok(bulk > heads, 'counted by bulk ' + bulk + ' came, by heads ' + heads);
});

test('maiming adds up: an ant pinned by a swarm loses legs faster than one bitten as hard by a single enemy', () => {
  const legs = held => {
    const w = arena(4, 'fire', 'bullet'), A = w.ants;
    let lost = 0;
    for (let k = 0; k < 40; k++) {
      const [[b]] = squad(w, 1, C.WORKER, 1, 2000 + k * 30, 2500);
      A.state[b] = ST.WANDER;
      for (let t = 0; t < 30; t++) AL.Injury.bite(w, b, 0.6, 1, 0, held);   // 18 hp of small bites (a bullet ant has 50)
      lost += AL.Injury.lost(w, b);
      A.kill(b);
    }
    return lost;
  };
  const alone = legs(0.5), pinned = legs(3);
  assert.ok(alone > 0, 'small bites add up to lost legs (' + alone + ')');
  assert.ok(pinned > alone * 1.5, 'pinned ' + pinned + ' legs vs ' + alone);
});
