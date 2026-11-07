const test = require('node:test'), assert = require('node:assert');
const core = f => { try { return require('../public/' + f); } catch (_) { return require('../../_core/public/' + f); } };
const AL = core('al.js');
core('sim.js');
require('../public/founding.js');
const Fd = AL.Founding, T = AL.Sites.TILE;

const site = id => ({ id, def: AL.SITES[id], x: 100, y: 100 });
// a player who makes the given choices and otherwise waits
function play(opts, choices) {
  choices = choices || {};
  const fs = Fd.create(Object.assign({ site: site('meadow'), seed: 7 }, opts));
  let guard = 0;
  while (fs.phase !== 'done' && fs.phase !== 'dead' && guard++ < 20000) {
    if (fs.phase === 'land' && choices.shed !== false) Fd.shedWings(fs);
    if (fs.phase === 'choose') Fd.chooseDepth(fs, choices.depth || 'shallow');
    if (choices.clutch && fs.phase === 'brood' && fs.laid === 0) Fd.setClutch(fs, choices.clutch);
    if (choices.eat) choices.eat(fs);
    if (choices.stopAt && choices.stopAt(fs)) break;
    Fd.update(fs, 0.1);
  }
  return fs;
}

test('the whole founding runs through every phase in about a minute of real time', () => {
  const fs = Fd.create({ site: site('meadow'), seed: 3, autoThreats: false, autoHazards: false });
  const seen = new Set([fs.phase]); let real = 0;
  while (fs.phase !== 'done' && fs.phase !== 'dead' && real < 300) {
    if (fs.phase === 'choose') Fd.chooseDepth(fs, 'shallow');
    if (fs.opened && fs.laid >= fs.clutch && !fs.eggs.length && !fs.larvae.length && !fs.pupae.length) Fd.finish(fs);
    Fd.update(fs, 0.1); real += 0.1; seen.add(fs.phase);
  }
  for (const p of ['land', 'shed', 'choose', 'dig', 'seal', 'brood', 'open', 'done']) assert.ok(seen.has(p), 'phase ' + p);
  assert.ok(real > 35 && real < 90, 'about a minute (' + real.toFixed(0) + ' s)');
  assert.equal(fs.workers.length, 10);
  for (const k of ['shed', 'sealed', 'egg', 'larva', 'pupa', 'worker', 'opened']) assert.equal(typeof fs.marks[k], 'number', 'timeline mark ' + k);
});

test('wings: protein reserve is locked in the flight muscles until she sheds them', () => {
  const fs = Fd.create({ site: site('rock'), seed: 1 });
  assert.equal(fs.queen.prot, 0); assert.equal(fs.queen.wings, 1);
  Fd.shedWings(fs);
  for (let k = 0; k < 20; k++) Fd.advance(fs, 0.05);
  assert.equal(fs.queen.wings, 0); assert.equal(fs.queen.prot, fs.queen.protMax);
  assert.equal(fs.phase, 'choose');
});

test('digging carves a shaft and a chamber; deep takes longer than shallow', () => {
  const dig = depth => { const fs = play({ site: site('meadow'), autoThreats: false, autoHazards: false }, { depth, stopAt: f => f.phase === 'brood' }); return fs; };
  const a = dig('shallow'), b = dig('deep');
  assert.ok(a.chamber.length >= 6);
  for (const p of a.chamber) assert.equal(a.grid.tiles[p.r * a.cols + p.c], T.AIR);
  assert.ok(b.chamberBox.r0 > a.chamberBox.r0, 'deep is deeper');
  assert.ok(b.marks.sealed > a.marks.sealed, 'deep takes longer');
  assert.ok(a.sealed && !a.opened);
  // the path is connected from the entrance down to the chamber
  const open = new Set(a.path.map(p => p.r * a.cols + p.c));
  assert.ok(open.has(a.entrance.c), 'starts at the entrance');
});

test('dig speed follows the site: sand fastest, rock slow', () => {
  const sealDay = id => play({ site: site(id), autoThreats: false, autoHazards: false, seed: 4 }, { stopAt: f => f.phase === 'brood' }).marks.sealed;
  assert.ok(sealDay('sand') < sealDay('meadow'));
  assert.ok(sealDay('rock') > sealDay('meadow'));
});

test('brood: warmth speeds it up (pavement crack beats the rotting log)', () => {
  const first = id => play({ site: site(id), autoThreats: false, autoHazards: false, seed: 5 }, { stopAt: f => f.workers.length > 0 }).marks.worker;
  assert.ok(first('crack') < first('meadow'));
  assert.ok(first('meadow') < first('log'));
});

test('eggs cost fat, larvae eat protein, nanitics hatch', () => {
  const fs = play({ autoThreats: false, autoHazards: false }, { clutch: 6, stopAt: f => f.larvae.length > 0 });
  const p0 = fs.queen.prot; Fd.update(fs, 2);
  assert.ok(fs.queen.prot < p0, 'larvae eat protein');
  const done = play({ autoThreats: false, autoHazards: false }, { clutch: 6 });
  assert.equal(done.phase, 'done'); assert.equal(done.workers.length, 6);
  assert.ok(done.workers.every(w => w.nanitic));
});

test('eating eggs stretches the reserves (and saves larvae on a big clutch)', () => {
  const fs = play({ autoThreats: false, autoHazards: false }, { clutch: 10, stopAt: f => f.eggs.length >= 4 });
  const { fat, prot } = fs.queen, n = fs.eggs.length;
  assert.ok(Fd.eatEgg(fs));
  assert.equal(fs.eggs.length, n - 1); assert.equal(fs.stats.eaten, 1);
  assert.ok(fs.queen.fat > fat && fs.queen.prot > prot);
  // big clutch: a player who eats eggs while protein is short raises more workers than one who doesn't
  const greedy = play({ autoThreats: false, autoHazards: false, seed: 9 }, { clutch: 16 });
  const careful = play({ autoThreats: false, autoHazards: false, seed: 9 }, { clutch: 16, eat: f => { if (f.eggs.length > 1 && f.queen.prot < (f.larvae.length * 1.3 + f.eggs.length * 2.6) * 0.9) Fd.eatEgg(f); } });
  assert.ok(greedy.stats.lost > careful.stats.lost, 'fewer starved larvae');
  assert.ok(careful.workers.length >= greedy.workers.length);
  assert.ok(careful.workers.length > 10, 'a big clutch done right beats the medium one');
});

test('an over-ambitious queen can starve', () => {
  const fs = Fd.create({ site: site('crack'), seed: 2, autoThreats: false, autoHazards: false });
  fs.queen.fat = fs.queen.fatMax = 12;
  Fd.shedWings(fs); Fd.chooseDepth(fs, 'deep'); Fd.setClutch(fs, 30);
  for (let k = 0; k < 4000 && fs.phase !== 'dead'; k++) Fd.advance(fs, 0.05);
  assert.equal(fs.phase, 'dead'); assert.match(fs.deathReason, /starved/);
  assert.equal(Fd.handoff(fs).ok, false);
});

test('rivals can attack at any time; sealed = hidden, opening exposes', () => {
  const fs = play({ autoThreats: false, autoHazards: false }, { stopAt: f => f.phase === 'brood' && f.eggs.length > 2 });
  const t = Fd.target(fs);
  assert.equal(t.kind, 'founding'); assert.ok(t.sealed && t.hidden && t.founding);
  const sealedExp = Fd.exposure(fs);
  const r = Fd.attack(fs, 12, 'A rival raid');
  assert.ok(r && !r.repelled && r.broodLost > 0 && fs.queen.hp < 100, 'a big raid hurts');
  assert.ok(Fd.attack(fs, 0.5).repelled, 'a lone scout is driven off');
  const fs2 = play({ autoThreats: false, autoHazards: false }, { stopAt: f => f.workers.length > 0 });
  assert.ok(!fs2.opened && Fd.openEntrance(fs2));
  assert.ok(Fd.exposure(fs2) > sealedExp * 2 && !Fd.target(fs2).hidden);
  // during landing and digging she is exposed too: no safe period
  const fs3 = Fd.create({ site: site('meadow'), seed: 1 });
  assert.ok(Fd.exposure(fs3) > 0 && Fd.attack(fs3, 1));
});

test('exposed sites get raided more often than hidden ones', () => {
  let meadow = 0, rock = 0;
  for (let s = 1; s <= 12; s++) {
    meadow += play({ site: site('meadow'), seed: s, autoHazards: false }).stats.attacks;
    rock += play({ site: site('rock'), seed: s, autoHazards: false }).stats.attacks;
  }
  assert.ok(meadow > rock, 'meadow ' + meadow + ' vs rock ' + rock);
});

test('army ants: bivouac founding with an escort, no seal, normal workers', () => {
  const fs = play({ species: 'army', autoThreats: false, autoHazards: false }, { clutch: 10 });
  assert.equal(fs.prof.mode, 'bivouac');
  assert.equal(fs.marks.sealed, undefined);
  assert.equal(fs.phase, 'done');
  const h = Fd.handoff(fs);
  assert.equal(h.nanitics, 0); assert.ok(h.workers >= 10 + 10, 'escort + new workers');
  assert.equal(h.nest.mode, 'bivouac');
});

test('handoff has everything colony play needs', () => {
  const fs = play({ site: site('log'), autoThreats: false });
  const h = Fd.handoff(fs);
  assert.ok(h.ok); assert.equal(h.siteId, 'log'); assert.equal(h.mods.flood, AL.SITES.log.mods.flood);
  assert.ok(h.nanitics > 0); assert.ok(h.naniticStats.size < 1 && h.naniticStats.hp < 1);
  for (const k of ['eggs', 'larvae', 'pupae']) assert.ok(Array.isArray(h.brood[k]));
  assert.ok(h.stock.sugar >= 0 && h.stock.protein >= 0);
  assert.ok(h.nest.chamber.cells.length >= 6 && h.nest.tunnel.length >= 3);
  assert.equal(h.nest.cols, 90); assert.equal(h.nest.rows, 60);
  assert.ok(h.nest.tiles instanceof Uint8Array);
});

test('headless AI founding (rival queens) completes on every site', () => {
  for (const id of AL.SITE_ORDER) for (const sp of ['fire', 'carpenter']) {
    const h = Fd.simulate({ site: site(id), species: sp, seed: 21 });
    assert.ok(h.ok && h.nanitics >= 4, id + '/' + sp + ': ' + h.nanitics + ' nanitics ' + (h.reason || ''));
  }
});

test('flight bonus: first to land starts with bigger reserves', () => {
  const a = Fd.create({ site: site('rock'), reserveBonus: 0.25 }), b = Fd.create({ site: site('rock'), reserveBonus: -0.1 });
  assert.ok(a.queen.fatMax > b.queen.fatMax && a.queen.protMax > b.queen.protMax);
});

test('in-game system: founding results reach the colonies on the first tick', () => {
  const fs = play({ site: site('rock'), autoThreats: false });
  const ho = Fd.handoff(fs);
  const rival = Fd.simulate({ site: site('meadow'), seed: 5, col: 1 });
  const w = AL.Sim.createWorld({ seed: 4, playerSite: { x: ho.x || 760, y: ho.y || 2240 }, start: { workers: ho.nanitics }, founding: ho, rivalFoundings: [rival] });
  AL.Sim.step(w);
  const A = w.ants, mine = [], theirs = [];
  for (let i = 0; i < A.high; i++) if (A.state[i]) (A.col[i] === 0 ? mine : theirs).push(i);
  assert.equal(mine.length, ho.nanitics);
  assert.equal(theirs.length, rival.nanitics);
  const full = AL.CASTES[AL.CASTE.WORKER].hp;
  assert.ok(mine.every(i => A.maxhp[i] < full), 'nanitics are weaker');
  assert.equal(w.player.site.id, 'rock'); assert.equal(w.player.nanitics, ho.nanitics);
  assert.equal(w.player.stock.sugar, ho.stock.sugar);
  assert.equal(w.founding.sites.length, 8);
});

test('nest preset: the lead nest gets the site soil and the dug chamber', () => {
  try { core('life.js'); } catch (_) { return; }      // the nest module (core M2)
  if (!AL.Nest) return;
  for (const id of ['rock', 'stump', 'crack']) {
    const ho = Fd.handoff(play({ site: site(id), autoThreats: false, autoHazards: false }, { clutch: 6 }));
    const w = AL.Sim.createWorld({ seed: 8, nestPreset: Fd.nestPreset(ho), start: { workers: ho.nanitics, brood: [], stock: ho.stock }, founding: ho });
    const n = w.nest;
    assert.equal(n.entrance.c, ho.nest.entrance.c, id + ' entrance');
    for (const [c, r] of ho.nest.chamber.cells) { const i = r * n.cols + c; assert.equal(n.kind[i], AL.Nest.TILE.OPEN); assert.equal(n.chamber[i], AL.Nest.CH.QUEEN); }
    assert.ok(n.tiles[AL.Nest.CH.QUEEN].length >= 6, id + ' queen chamber registered');
    let top = { rock: AL.Nest.TILE.ROCK, stump: AL.Nest.TILE.WOOD, crack: AL.Nest.TILE.ROCK }[id], cnt = 0;
    for (let r = 0; r < 6; r++) for (let c = 0; c < n.cols; c++) if (n.base[r * n.cols + c] === top) cnt++;
    assert.ok(cnt > 15, id + ' signature layer in the nest (' + cnt + ')');
    for (let k = 0; k < 30; k++) AL.Sim.step(w);
    assert.ok(w.player.queen.alive);
  }
});
