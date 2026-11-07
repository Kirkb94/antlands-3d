// The founding race: species pace, rivals founding alongside the player, leaving early,
// still-founding nests in colony play (col.founding), and raids both ways.
const test = require('node:test'), assert = require('node:assert');
const fsys = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'fog.js']) if (fsys.existsSync(path.join(__dirname, '../public', f))) require('../public/' + f);
require('../public/founding-sites.js'); require('../public/founding.js'); require('../public/founding-race.js');
const Fd = AL.Founding, FR = AL.FoundingRace, C = AL.CASTE;
const site = (id, x, y) => ({ id, def: AL.SITES[id], x: x || 760, y: y || 2240 });

// AI founding: day of colony stage
function colonyDay(sp, siteId, seed) {
  const fs = Fd.create({ site: site(siteId), species: sp, seed: seed || 3, ai: true, autoThreats: false, autoHazards: false });
  while (fs.marks.colony == null && fs.phase !== 'dead' && fs.day < 80) Fd.advance(fs, 0.05);
  return fs.marks.colony;
}
// a player who digs shallow and starts the colony the moment it is ready
const eager = f => { if (f.phase === 'land') Fd.shedWings(f); if (f.phase === 'choose') Fd.chooseDepth(f, 'shallow'); if (Fd.colonyReady(f)) Fd.finish(f); };
function race(opts) {
  opts = opts || {};
  const specs = FR.rivalSpecs({ rivalSpecies: opts.rivals || ['fire', 'leafcutter', 'carpenter'] }, opts.seed || 9);
  const fs = Fd.create({ site: site(opts.site || 'meadow'), species: opts.species || 'fire', seed: opts.pseed || 5 });
  return FR.create({ player: fs, rivals: specs, seed: opts.seed || 9, x: 760, y: 2240 });
}

test('species pace is explicit: fire fastest, then leafcutter, carpenter slowest; army quick', () => {
  for (const id of ['meadow', 'garden', 'rock']) {
    const f = colonyDay('fire', id), l = colonyDay('leafcutter', id), c = colonyDay('carpenter', id), a = colonyDay('army', id);
    assert.ok(f < l && l < c, id + ': fire ' + f.toFixed(1) + ' < leafcutter ' + l.toFixed(1) + ' < carpenter ' + c.toFixed(1));
    assert.ok(a < f, id + ': army ' + a.toFixed(1) + ' before fire');
  }
  for (const k of ['fire', 'leafcutter', 'carpenter', 'army']) assert.ok(Fd.PROFILE[k].pace && Fd.PROFILE[k].colonyAt >= 3, k);
});

test('PROFILE is open: unknown species fall back, partial entries merge with the default', () => {
  const p = Fd.profileFor('nosuchant');
  assert.equal(p.mode, 'claustral'); assert.equal(p.colonyAt, Fd.PROFILE_DEFAULT.colonyAt);
  Fd.PROFILE.testant = { dev: 0.5, pace: 'very slow' };
  try {
    const q = Fd.profileFor('testant');
    assert.equal(q.dev, 0.5); assert.equal(q.fat, Fd.PROFILE_DEFAULT.fat); assert.equal(q.key, 'testant');
    const h = Fd.simulate({ site: site('meadow'), species: 'testant', seed: 2 }, 160);
    assert.ok(h.ok && h.nanitics >= 4);
    assert.ok(colonyDay('testant', 'meadow') > colonyDay('fire', 'meadow') * 1.5);
  } finally { delete Fd.PROFILE.testant; }
});

test('site and choices can beat species: a carpenter queen on a warm crack beats fire ants in a cold log', () => {
  assert.ok(colonyDay('carpenter', 'crack') < colonyDay('fire', 'log'));
  // a shallow chamber is warmer than a deep one
  const sh = Fd.create({ site: site('meadow'), seed: 1 }); sh.depth = 'shallow';
  const dp = Fd.create({ site: site('meadow'), seed: 1 }); dp.depth = 'deep';
  assert.ok(Fd.devRate(sh) > Fd.devRate(dp));
});

test('colony stage: enough nanitics and an open entrance; progress reaches exactly 1 there', () => {
  const fs = Fd.create({ site: site('meadow'), seed: 4, autoThreats: false, autoHazards: false });
  let last = 0, mono = true, seen = new Set();
  while (!Fd.colonyReady(fs) && fs.day < 60) {
    eager(fs); if (fs.phase === 'done') break;
    Fd.advance(fs, 0.05);
    const r = Fd.race(fs); seen.add(r.phase);
    if (r.progress + 1e-6 < last - 0.02) mono = false; last = r.progress;
  }
  assert.ok(Fd.colonyReady(fs), 'reached colony stage');
  assert.ok(fs.workers.length >= fs.prof.colonyAt && fs.opened);
  assert.equal(Fd.race(fs).progress, 1); assert.equal(Fd.race(fs).phase, 'colony');
  assert.ok(mono, 'progress only goes up');
  for (const p of ['digging', 'eggs', 'larvae', 'pupae']) assert.ok(seen.has(p), 'phase ' + p);
});

test('the race is deterministic per seed and works for any number of rivals', () => {
  const sig = r => JSON.stringify(FR.rows(r).map(x => [x.col, x.phase, x.progress.toFixed(4)])) + r.events.map(e => e.text).join('|');
  const a = FR.run(race({ seed: 4 }), 80, eager), b = FR.run(race({ seed: 4 }), 80, eager);
  assert.equal(sig(a), sig(b));
  for (const n of [0, 1, 7]) {
    const r = race({ rivals: Array.from({ length: n }, (_, k) => ['fire', 'leafcutter', 'carpenter', 'army'][k % 4]) });
    FR.run(r, 80, eager);
    assert.equal(r.rivals.length, n);
    assert.equal(FR.rows(r).length, n + 1);
    assert.equal(FR.rivalPatch(r).length, n);
    assert.ok(r.player.fs.phase === 'done');
  }
  // the colony count can come from opts.colonies (2-8)
  assert.equal(FR.rivalSpecs({ colonies: 6 }, 1).length, 5);
  assert.equal(FR.rivalSpecs({}, 1).length, 1, 'core default: one rival');
});

test('leaving early: rivals still founding go into the patch with their progress', () => {
  const r = FR.run(race({ site: 'crack', rivals: ['fire', 'leafcutter', 'carpenter', 'carpenter'] }), 80, eager);
  const patch = FR.rivalPatch(r);
  const still = patch.filter(h => h.race.stillFounding);
  assert.ok(still.length >= 2, still.length + ' still founding');
  for (const h of still) {
    assert.ok(h.race.progress > 0 && h.race.progress < 1);
    assert.ok(h.race.colonyAt >= 3 && Array.isArray(h.race.brood) && h.race.devRate > 0);
    assert.equal(typeof h.col, 'number');
  }
  for (const h of patch.filter(z => !z.race.stillFounding)) assert.ok(h.race.out && h.headStart >= 0);
});

test('both ways: rivals that are out find nests still founding and raid them, telegraphed first', () => {
  // a slow carpenter queen on an exposed meadow, surrounded by fast fire ants, keeps her nest open
  let telegraphed = 0, raided = 0, warnedFirst = true;
  for (let seed = 1; seed <= 6; seed++) {
    const r = race({ species: 'carpenter', rivals: ['fire', 'fire', 'fire', 'army'], seed, pseed: seed });
    const pf = r.player.fs;
    FR.run(r, 60, f => { if (f.phase === 'land') Fd.shedWings(f); if (f.phase === 'choose') Fd.chooseDepth(f, 'shallow'); if (f.workers.length && !f.opened && !f.plugged) Fd.openEntrance(f); if (f.marks.colony != null && f.day - f.marks.colony > 6) Fd.finish(f); });
    telegraphed += r.events.filter(e => e.kind === 'found').length;
    raided += r.raids.filter(x => x.to === 0).length;
    // every raid on the player follows a warning from the same rival
    for (const x of r.raids.filter(z => z.to === 0)) if (!r.events.some(e => e.kind === 'found' && e.col === x.from && e.day < x.day - 1)) warnedFirst = false;
    assert.ok(r.raids.every(x => r.rivals.find(z => z.col === x.from).out), 'only rivals that are out raid');
  }
  assert.ok(telegraphed > 0 && raided > 0, telegraphed + ' warnings, ' + raided + ' raids');
  assert.ok(warnedFirst, 'raids on the player are telegraphed');
});

test('plugging the entrance hides the nest again (and stops foraging)', () => {
  const fs = Fd.create({ site: site('meadow'), seed: 2, autoThreats: false, autoHazards: false });
  while (!fs.opened && fs.day < 60) { eager(fs); if (fs.phase === 'done') break; Fd.advance(fs, 0.05); }
  const open = Fd.exposure(fs);
  assert.ok(Fd.plugEntrance(fs));
  assert.ok(Fd.exposure(fs) < open * 0.5 && fs.sealed && fs.plugged);
  const f0 = fs.stats.foraged; for (let k = 0; k < 40; k++) Fd.advance(fs, 0.05);
  assert.equal(fs.stats.foraged, f0, 'no food while plugged');
  assert.ok(!fs.opened, 'stays plugged (no auto-open)');
  assert.ok(Fd.openEntrance(fs) && !fs.plugged);
});

test('the founding start grows the longer you wait at colony stage', () => {
  const at = wait => {
    const fs = Fd.create({ site: site('garden'), seed: 6, autoThreats: false, autoHazards: false });
    while (fs.phase !== 'done' && fs.day < 90) {
      if (fs.phase === 'land') Fd.shedWings(fs); if (fs.phase === 'choose') Fd.chooseDepth(fs, 'shallow');
      if (fs.marks.colony != null && fs.day - fs.marks.colony >= wait) Fd.finish(fs);
      Fd.advance(fs, 0.05);
    }
    const h = Fd.handoff(fs);
    return { food: h.stock.sugar + h.stock.protein, ants: h.nanitics + h.brood.eggs.length + h.brood.larvae.length + h.brood.pupae.length };
  };
  const now = at(0), later = at(7);
  assert.ok(later.food > now.food + 10, 'food ' + now.food + ' -> ' + later.food);
  assert.ok(later.ants > now.ants, 'ants+brood ' + now.ants + ' -> ' + later.ants);
});

// ---- colony play --------------------------------------------------------------------------------
function matchFrom(r, extra) {
  const pf = r.player.fs, ho = Fd.handoff(pf), rivals = FR.rivalPatch(r);
  const w = AL.Sim.createWorld(Object.assign({ seed: 9, rivalSpecies: r.rivals.map(z => z.species), rivalSites: r.rivals.map(z => ({ x: z.x, y: z.y })), playerSite: { x: 760, y: 2240 },
    start: { workers: ho.nanitics, brood: [], stock: ho.stock }, founding: ho, rivalFoundings: rivals, noFog: true }, extra || {}));
  AL.Sim.step(w);
  return { w, rivals };
}
const stepS = (w, s) => { for (let k = 0; k < s * 30; k++) AL.Sim.step(w); };

test('colony play: still-founding rivals are small, weak and stay home, then become normal colonies', () => {
  const r = FR.run(race({ site: 'crack', rivals: ['fire', 'carpenter'] }), 80, eager);
  const { w, rivals } = matchFrom(r);
  const fc = w.colonies.filter(c => c.founding);
  assert.ok(fc.length >= 1, 'some rivals still founding');
  for (const c of fc) {
    assert.ok(c.queen.maxHp <= FR.M.QUEEN_HP && c.moundSoil <= FR.M.MOUND, 'weak queen, tiny mound');
    assert.ok(c.founding.progress > 0 && c.founding.progress < 1 && c.founding.colonyAt >= 3);
    assert.equal(c.broodQ.length, 0, 'brood is in col.founding until colony stage');
  }
  const done = [];
  const off = AL.on('foundingDone', (ww, d) => { if (ww === w) done.push([d.col, w.t]); });
  let far = 0, maxOut = 0, raids = 0;
  const offR = AL.on('raid', (ww, d) => { if (ww === w && w.colonies[d.col].founding) raids++; });
  try {
    for (let s = 0; s < 480 && done.length < fc.length; s++) {
      stepS(w, 1);
      for (const c of w.colonies) if (c.founding) maxOut = Math.max(maxOut, c.surf);
      const A = w.ants;
      for (let i = 0; i < A.high; i++) { const c = w.colonies[A.col[i]]; if (A.state[i] && c.founding && Math.hypot(A.x[i] - c.x, A.y[i] - c.y) > FR.M.LEASH + 140) far++; }
    }
  } finally { off(); offR(); }
  assert.equal(done.length, fc.length, 'every founding rival reached colony stage');
  assert.ok(maxOut <= FR.M.OUT_MAX, 'few nanitics outside (' + maxOut + ')');
  assert.equal(far, 0, 'no long foraging trips'); assert.equal(raids, 0, 'no raids while founding');
  for (const c of fc) { assert.equal(c.founding, undefined); assert.ok(c.queen.maxHp >= 500, 'a normal queen now'); }
  // the faster species graduates first when it started ahead
  const byId = new Map(done);
  const fire = fc.find(c => c.spKey === 'fire'), carp = fc.find(c => c.spKey === 'carpenter');
  const hoF = fire && rivals.find(h => h.col === fire.id), hoC = carp && rivals.find(h => h.col === carp.id);
  if (fire && carp && hoF.race.progress >= hoC.race.progress) assert.ok(byId.get(fire.id) < byId.get(carp.id));
});

test('colony play: raiding a founding nest kills its queen and ends the colony', () => {
  const r = FR.run(race({ site: 'crack', rivals: ['carpenter', 'carpenter'] }), 80, eager);
  const { w } = matchFrom(r);
  const c = w.colonies.find(z => z.founding);
  assert.ok(c);
  const A = w.ants, died = [];
  const off = AL.on('queenDied', (ww, d) => { if (ww === w) died.push(d.col); });
  try {
    for (let k = 0; k < 12; k++) { const i = A.spawn(0, C.SOLDIER, AL.LAYER.SURFACE, c.x + 30, c.y, Math.PI, w.R); A.state[i] = AL.ST.RAID; A.tx[i] = c.x; A.ty[i] = c.y; }
    for (let s = 0; s < 90 && c.alive; s++) {
      for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.caste[i] === C.SOLDIER) { A.state[i] = AL.ST.RAID; A.a[i] = Math.atan2(c.y - A.y[i], c.x - A.x[i]); }
      stepS(w, 1);
    }
  } finally { off(); }
  assert.ok(!c.alive && died.includes(c.id), 'the founding queen fell');
  assert.ok(!w.over || w.over.winner === 0);
});

test('colony play: rivals that left founding before you start bigger (head start)', () => {
  const r = FR.run(race({ site: 'log', species: 'carpenter', rivals: ['fire', 'fire'] }), 80, eager);
  const patch = FR.rivalPatch(r), out = patch.filter(h => h.race.out && h.headStart > 3);
  assert.ok(out.length, 'a fire rival left well before the carpenter player');
  const { w } = matchFrom(r);
  for (const h of out) {
    const c = w.colonies[h.col];
    assert.equal(c.founding, undefined);
    assert.ok(c.inside[C.WORKER] + c.surf > h.nanitics + h.workers, 'grew during the head start');
  }
});

test('with real rival nests: a rival that was still founding gets its real nest when it opens (and the others have theirs from the start)', () => {
  require('../public/ai-nest.js');
  const r = FR.run(race({ site: 'crack', rivals: ['fire', 'carpenter'] }), 80, eager);
  const { w } = matchFrom(r, { rivalNests: true });
  const fc = w.colonies.filter(c => c.founding);
  assert.ok(fc.length >= 1, 'some rivals still founding');
  for (const c of w.colonies) if (!c.isPlayer && !c.founding) assert.ok(c.nest && c.bot, 'colony ' + c.id + ' out of founding has its nest');
  for (const c of fc) assert.ok(!c.nest && c.inside, 'still founding: the numbers model for now');
  const left = new Set(fc.map(c => c.id));
  for (let s = 0; s < 480 && left.size; s++) { stepS(w, 1); for (const id of [...left]) if (!w.colonies[id].founding) left.delete(id); }
  assert.equal(left.size, 0, 'every founding rival opened');
  stepS(w, 2);
  for (const c of fc) {
    assert.ok(c.nest && c.bot && !c.inside, 'colony ' + c.id + ' now has a real nest');
    assert.ok(c.queen.alive && c.queen.i >= 0 && w.ants.caste[c.queen.i] === C.QUEEN, 'a queen ant');
    assert.ok(w.detailed.includes(c.id));
  }
});
