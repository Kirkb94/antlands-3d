// Research / evolution tree and species perks (public/research.js).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'fog.js', 'founding-sites.js', 'founding.js', 'founding-race.js', 'species.js', 'expansion.js', 'victory.js',
  'world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js', 'research.js']) require('../public/' + f);
const RS = AL.Research, X = AL.Expansion, C = AL.CASTE, K = AL.CARRY, L = AL.LAYER;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const mk = (extra) => AL.Sim.createWorld(Object.assign({ seed: 11, species: 'fire', noFog: true, keypointsAt: 1e9 }, extra || {}));
const rich = c => { c.stock.sugar = 400; c.stock.protein = 400; };
const events = type => { const got = []; got.off = AL.on(type, (w, d) => got.push(d)); return got; };

test('the tree: three core branches of 4-6 nodes (tier 5 is the late game), 2-3 own nodes per species, every prerequisite exists', () => {
  for (const b of ['forage', 'defence', 'colony']) {
    const n = RS.NODES.filter(d => d.branch === b).length;
    assert.ok(n >= 4 && n <= 6, b + ' has ' + n);
  }
  for (const sp of AL.SPECIES_ORDER) {
    const own = RS.NODES.filter(d => d.sp === sp).length;
    assert.ok(own >= 2 && own <= 3, sp + ' has ' + own + ' own nodes');
    assert.equal(RS.perksFor(sp).length, 3, sp + ' perks');
  }
  const ids = new Set(RS.NODES.map(d => d.id));
  assert.equal(ids.size, RS.NODES.length, 'unique ids');
  for (const d of RS.NODES) {
    for (const q of d.req) assert.ok(ids.has(q), d.id + ' needs ' + q);
    assert.ok(d.tier >= 1 && d.tier <= 5 && d.name && d.line);
    const k = RS.cost(d); assert.ok(k.sugar > 0 && k.protein > 0 && k.time > 0, d.id + ' cost');
  }
  // the raid-tunnel research is one node of the tree, costed by the expansion stage's CFG
  assert.equal(RS.cost(RS.node('tunnel')), X.CFG.tunnel.research);
  // tier 1 is cheap, tier 4 dear; the whole tree is most of a 30-50 minute match
  assert.ok(RS.CFG.tier[1].sugar + RS.CFG.tier[1].protein < 40);
  for (const sp of AL.SPECIES_ORDER) {
    const secs = RS.nodesFor(sp).reduce((a, d) => a + RS.cost(d).time, 0);
    assert.ok(secs > 25 * 60 && secs < 40 * 60, sp + ' tree takes ' + (secs / 60).toFixed(1) + ' min of research');
  }
});

test('research: prerequisites, costs paid up front, one at a time, progress, then done with its effect', () => {
  const w = mk(), c = w.player;
  rich(c);
  assert.match(RS.can(w, 0, 'scent').why, /Needs keener antennae/);
  assert.equal(RS.status(w, 0, 'scent'), 'locked');
  assert.equal(RS.status(w, 0, 'antennae'), 'available');
  assert.match(RS.can(w, 0, 'swarmsting').why, /Needs sharper mandibles/);
  assert.match(RS.can(w, 0, 'cultivar').why, /species/, 'another species\' node');
  const started = events('researchStarted'), done = events('researchDone');
  const s0 = c.stock.sugar, p0 = c.stock.protein, k = RS.cost(RS.node('antennae'));
  assert.ok(RS.start(w, 0, 'antennae'));
  assert.equal(c.stock.sugar, s0 - k.sugar); assert.equal(c.stock.protein, p0 - k.protein);
  assert.equal(started.length, 1); assert.equal(started[0].what, 'antennae');
  assert.match(RS.can(w, 0, 'exo').why, /Researching keener antennae/, 'one at a time');
  assert.equal(c.mods.smell, 0);
  run(w, k.time * 0.5);
  assert.ok(RS.progress(c) > 0.4 && RS.progress(c) < 0.6);
  run(w, k.time * 0.5 + 1.5);
  assert.ok(RS.isDone(c, 'antennae'));
  assert.equal(done.length, 1); assert.equal(done[0].what, 'antennae'); assert.equal(done[0].col, 0);
  assert.equal(c.mods.smell, 16); assert.equal(c.mods.search, 1.25);
  assert.equal(RS.status(w, 0, 'scent'), 'available');
  assert.match(RS.can(w, 0, 'antennae').why, /Already/);
  c.stock.sugar = 1;
  assert.match(RS.can(w, 0, 'scent').why, /sugar/);
  assert.equal(RS.status(w, 0, 'scent'), 'short');
  started.off(); done.off();
});

test('cancelling refunds half the cost', () => {
  const w = mk(), c = w.player;
  rich(c);
  const s0 = c.stock.sugar, k = RS.cost(RS.node('exo'));
  RS.start(w, 0, 'exo');
  assert.ok(RS.cancel(w, 0));
  assert.ok(Math.abs(c.stock.sugar - (s0 - k.sugar * 0.5)) < 2);
  assert.ok(!c.research.busy && !RS.isDone(c, 'exo'));
});

test('deep tunnelling is the tree\'s tunnel node: the expansion API and research.tunnel still work', () => {
  const w = mk(), c = w.player;
  rich(c); AL.Sim.spawnBench(w, 110); AL.Sim.countPop(w);
  assert.match(X.canResearch(w, 0).why, /Needs bigger nursery/);
  RS.grant(w, 0, 'jelly'); RS.grant(w, 0, 'nursery');
  assert.ok(X.canResearch(w, 0).ok);
  assert.ok(X.research(w, 0));
  assert.ok(c.research.busy && c.research.cur === 'tunnel');
  run(w, 30);
  assert.ok(c.research.tunnel > 0 && c.research.tunnel < 1, 'progress mirrored for the old UI');
  run(w, X.CFG.tunnel.research.time);
  assert.equal(c.research.tunnel, 1);
  assert.ok(c.mods.tunnel);
  assert.doesNotMatch(X.tunnelPlan(w, 0, 1, 0).why || '', /Research/);
});

test('col.sp is a per-colony view: mods multiply into speed/breed/life, AL.SPECIES stays untouched', () => {
  const w = mk(), c = w.player, base = AL.SPECIES.fire;
  assert.equal(c.sp.name, base.name); assert.equal(c.sp.key, 'fire');
  assert.equal(c.sp.speed, base.speed);
  RS.grant(w, 0, 'antennae'); RS.grant(w, 0, 'crop'); RS.grant(w, 0, 'scent'); RS.grant(w, 0, 'highways'); RS.grant(w, 0, 'legs');
  assert.ok(Math.abs(c.sp.speed - base.speed * 1.08) < 1e-9);
  assert.equal(base.speed, 1.05, 'species data unchanged');
  assert.equal(w.colonies[1].sp.speed, w.colonies[1].sp._rsBase.speed, 'other colonies unaffected');
  RS.grant(w, 0, 'jelly'); RS.grant(w, 0, 'nursery');
  assert.ok(Math.abs(c.sp.breed - base.breed * 1.1) < 1e-9);
  assert.ok(Math.abs(c.sp.carry - 1.25) < 1e-9);
  assert.equal(c.sp.honeyStore, undefined, 'fields the species lacks stay undefined');
  // trails last longer: the colony's own food grid
  assert.ok(Math.abs(w.pher.food[0].halfLife - w.pher.food[1].halfLife * 1.6) < 1e-6);
});

test('hp mods reach every ant (existing ones and new ones), the queen, and dps goes through dpsMul', () => {
  const w = mk({ rivalPerks: false }), c = w.player, A = w.ants;
  run(w, 1);
  let wi = -1; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.caste[i] === C.WORKER) { wi = i; break; }
  const hp0 = A.maxhp[wi], q0 = c.queen.maxHp;
  RS.grant(w, 0, 'exo'); run(w, 0.5);
  assert.ok(Math.abs(A.maxhp[wi] - hp0 * 1.15) < 1e-3, 'existing worker rescaled');
  const j = A.spawn(0, C.SOLDIER, L.SURFACE, c.x + 40, c.y, 0, w.R);
  run(w, 0.5);
  assert.ok(Math.abs(A.maxhp[j] - AL.CASTES[C.SOLDIER].hp * 1.15) < 1e-3, 'new ant gets it');
  RS.grant(w, 0, 'jaws'); RS.grant(w, 0, 'soldiers'); RS.grant(w, 0, 'alarm'); RS.grant(w, 0, 'walls');
  run(w, 0.5);
  assert.ok(Math.abs(A.maxhp[j] - AL.CASTES[C.SOLDIER].hp * 1.15 * 1.2) < 1e-3, 'soldier caste on top');
  assert.ok(Math.abs(c.queen.maxHp - q0 * 1.5) < 1e-3, 'mound walls: queen');
  assert.ok(Math.abs(A.maxhp[c.queen.i] - c.queen.maxHp) < 1e-3, 'the queen ant too');
  assert.ok(Math.abs(RS.dpsMul(c, C.SOLDIER) - 1.15 * 1.2) < 1e-6);
  assert.ok(Math.abs(RS.dpsMul(c, C.WORKER) - 1.15) < 1e-6);
  assert.equal(RS.dpsMul(w.colonies[1], C.WORKER), 1);
});

test('colony nodes: brood speed, nursery size and cold tolerance reach life.js', () => {
  const w = mk(), c = w.player;
  run(w, 2);
  const r0 = AL.Life.broodRate(w, c), n0 = c.cap.nursery;
  RS.grant(w, 0, 'jelly');
  assert.ok(Math.abs(AL.Life.broodRate(w, c) / r0 - 1.2) < 1e-6);
  RS.grant(w, 0, 'nursery'); run(w, 1.1);
  assert.ok(c.cap.nursery >= Math.round(n0 * 1.4) - 1 && c.cap.nursery > n0, 'nursery ' + n0 + ' -> ' + c.cap.nursery);
  w.nest.nurseryTemp = 13; for (const r of w.nest.rooms || []) r.temp = 13;   // (each room keeps its own temperature: nestclimate.js)
  const cold0 = AL.Life.broodRate(w, c);
  RS.grant(w, 0, 'elders'); RS.grant(w, 0, 'cold');
  assert.ok(AL.Life.broodRate(w, c) > cold0 * 1.3, 'a cold nursery hurts less');
});

test('foraging nodes: laden foragers lay stronger trails', () => {
  const lay = (scent) => {
    const w = mk({ seed: 3 }), c = w.player, A = w.ants;
    if (scent) { RS.grant(w, 0, 'antennae'); RS.grant(w, 0, 'scent'); }
    const g = w.pher.food[0]; g.data.fill(0);
    const i = A.spawn(0, C.FORAGER, L.SURFACE, c.x + 400, c.y, Math.PI, w.R);
    A.state[i] = AL.ST.RETURN; A.carry[i] = K.SUGAR; A.str[i] = 1;
    AL.Behavior.updateSurface(w);
    let s = 0; for (let k = 0; k < g.data.length; k++) s += g.data[k];
    return s;
  };
  const a = lay(false), b = lay(true);
  assert.ok(a > 0 && Math.abs(b / a - 1.35) < 0.01, a + ' -> ' + b);
});

test('perks: the player\'s choice comes in as opts.perk; rivals get a seeded one; every perk does something', () => {
  const w = mk({ perk: 'stingers', colonies: 6 });
  assert.equal(w.player.perk, 'stingers');
  assert.ok(Math.abs(RS.dpsMul(w.player, C.SOLDIER) - 1.3) < 1e-6);
  for (const c of w.colonies.slice(1)) assert.ok(RS.perkDef(c.spKey, c.perk), 'rival ' + c.id + ' ' + c.spKey + ' has a perk');
  const w2 = mk({ perk: 'stingers', colonies: 6 });
  assert.deepEqual(w2.colonies.map(c => c.perk), w.colonies.map(c => c.perk), 'seeded');
  assert.equal(mk({ perk: 'nonsense' }).player.perk, null, 'unknown perk ignored');
  assert.equal(mk({}).player.perk, null, 'no perk unless chosen');
  // each perk changes the colony's mods or its start
  const base = RS.baseMods();
  for (const sp of AL.SPECIES_ORDER) for (const p of RS.perksFor(sp)) {
    const m = RS.applyFx(RS.baseMods(), p.fx);
    const diff = Object.keys(base).filter(k => k === 'hp' || k === 'dps' ? m[k].some((v, i) => v !== base[k][i]) : m[k] !== base[k]);
    assert.ok(diff.length >= 1 || p.start, sp + '/' + p.id);
    // none is a free lunch: every perk has a downside (some multiplier below 1, or a lost start)
    const down = m.appetite > 1 || Object.keys(base).some(k => k === 'hp' || k === 'dps' ? m[k].some(v => v < 1) : k !== 'appetite' && typeof m[k] === 'number' && m[k] < base[k]);
    assert.ok(down, sp + '/' + p.id + ' has a trade-off');
  }
});

test('perk start bonuses: stock, workers, brood (player nest and rival abstract nest)', () => {
  const plain = mk({ species: 'honeypot' }), hoard = mk({ species: 'honeypot', perk: 'hoard' });
  assert.ok(hoard.player.stock.sugar >= plain.player.stock.sugar + 79, 'honey hoard');
  const f0 = mk({ species: 'fire' }), f1 = mk({ species: 'fire', perk: 'swarmfound' });
  AL.Sim.countPop(f0); AL.Sim.countPop(f1);
  const pop = w => w.player.pop.reduce((a, b) => a + b, 0);
  assert.equal(pop(f1) - pop(f0), 12, 'swarm founding');
  assert.ok(f1.player.mods.life < 1);
  const b0 = mk({ species: 'bullet' }), b1 = mk({ species: 'bullet', perk: 'bigbrood' });
  run(b0, 1); run(b1, 1);
  assert.equal(b1.player.brood.length - b0.player.brood.length, 3, 'bigger brood');
  const lc = mk({ species: 'leafcutter', perk: 'fungusrich' });
  assert.ok(lc.player.stock.fungus >= 60 && lc.player.stock.leaves >= 40);
  const hv = mk({ species: 'fire', colonies: 3, rivalSpecies: ['harvester', 'army'], rivalPerks: ['seedhoard', 'march'] });
  assert.equal(hv.colonies[1].perk, 'seedhoard'); assert.equal(hv.colonies[2].perk, 'march');
  const hv0 = mk({ species: 'fire', colonies: 3, rivalSpecies: ['harvester', 'army'], rivalPerks: false });
  assert.ok(hv.colonies[1].stock.seeds >= hv0.colonies[1].stock.seeds + 99, 'rival seed hoard');
  assert.ok(hv.colonies[2].sp.speed > hv0.colonies[2].sp.speed * 1.1);
});

test('species nodes deepen the species: leafcutter fungus, harvester meadows, slave-maker propaganda reach their systems', () => {
  // fungus cultivar: more fungus from the same leaves
  const fung = cult => {
    const w = mk({ species: 'leafcutter', seed: 4 }), c = w.player;
    if (cult) { RS.grant(w, 0, 'jelly'); RS.grant(w, 0, 'cultivar'); }
    const N = AL.Nest, nest = w.nest; N.carveRoom(nest, nest.entrance.c + 8, 14, 3, 2, N.CH.FUNGUS); N.rebuild(nest);
    run(w, 1); c.stock.leaves = 200; c.stock.fungus = 0;
    const p0 = c.stock.protein + c.stock.sugar;
    run(w, 10);
    return c.stock.fungus + c.stock.protein + c.stock.sugar - p0 + (200 - c.stock.leaves) * 0;
  };
  const f0 = fung(false), f1 = fung(true);
  assert.ok(f1 > f0 * 1.15, 'fungus ' + f0.toFixed(1) + ' -> ' + f1.toFixed(1));
  // seed meadows: harvester grass regrows faster
  const w = mk({ species: 'harvester' }), grass = () => w.surface.foods.filter(f => f.poi && f.poi.grass && f.poi.col === 0);
  const g0 = grass()[0].regen;
  RS.grant(w, 0, 'antennae'); RS.grant(w, 0, 'meadows');
  assert.ok(Math.abs(grass()[0].regen - g0 * 1.6) < 1e-9);
  // propaganda perk: a stronger chance to grab brood from an abstract nest
  const sm = mk({ species: 'slavemaker', perk: 'propaganda' });
  assert.equal(sm.player.mods.propaganda, 1.5);
});

test('rivals research on their own (priority list, paced by stock) and skip founding colonies', () => {
  const w = mk({ colonies: 4, seed: 21 });
  assert.deepEqual(RS.aiOrder('army').slice(0, 4), ['exo', 'antennae', 'phasic', 'jelly']);
  run(w, 10 * 60);   // (was 8 min: with the ecosystem the early protein from creature carcasses comes and goes)
  const nodes = w.colonies.slice(1).filter(c => c.alive).map(c => c.research.order.length + (c.research.busy ? 1 : 0));
  assert.ok(nodes.some(n => n >= 2), 'rivals evolve: ' + nodes.join(','));
  assert.equal(w.player.research.order.length, 0, 'the player only researches when asked');
  for (const c of w.colonies.slice(1)) for (const id of c.research.order) { const d = RS.node(id); assert.ok(!d.sp || d.sp === c.spKey); assert.ok(d.req.every(q => c.research.order.indexOf(q) < c.research.order.indexOf(id))); }
  // a founding rival does not research
  const f = mk({ colonies: 2, seed: 9 }); f.colonies[1].founding = { progress: 0.2 }; f.colonies[1].stock.sugar = f.colonies[1].stock.protein = 500;
  run(f, 120);
  assert.equal(f.colonies[1].research.busy || f.colonies[1].research.order.length > 0, false);
});

test('deterministic for a seed with research and perks on', () => {
  const sig = () => {
    const w = mk({ colonies: 4, seed: 77, perk: 'opportunists' });
    rich(w.player); RS.start(w, 0, 'antennae');
    run(w, 240);
    return JSON.stringify(w.colonies.map(c => [c.perk, c.research.order.join(','), Math.round(c.stock.sugar), c.pop.reduce((a, b) => a + b, 0)]));
  };
  assert.equal(sig(), sig());
});
