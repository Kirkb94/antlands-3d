// Antlands research / evolution tree and species perks (pure simulation, no DOM; runs in node --test).
//
// Every colony grows a small evolution tree over the match: a shared core (Foraging, Defence, Colony) plus a
// few nodes unique to its species. One research runs at a time; it costs sugar + protein up front and takes
// sim time. A species perk (chosen on the title screen for the player, seeded for rivals) is a starting
// identity choice that uses the same effect system. Effects never touch other modules directly: everything
// lands in ONE object per colony, `col.mods` (multipliers and flags, see MODS below), which other systems read.
//
//   col.mods       the colony's current modifiers (perk + every finished node); rebuilt by AL.Research.refresh
//   col.research   { cur, t, dur, busy, done: {id: true}, order: [ids], fund, tunnel /* compat, see below */ }
//   col.perk       the colony's perk id (or null)
//   events         researchStarted { col, what: id, node }   researchDone { col, what: id, node }
//                  researchCancelled { col, what }           perkChosen { col, perk }
//
// Where the mods are read (small hooks, each marked "research:" in the file):
//   behavior.js  smell (food sensed further ahead), search (forage time), trail (trail laid per tick)
//   life.js      brood (development speed), cold (nursery temperature tolerance), nursery (capacity)
//   combat.js    dps per caste, through AL.Research.dpsMul(col, caste)
//   species.js   propaganda (slave-maker raids)
//   here         hp per caste (applied to every ant as it appears, see fixHp), the queen's hp, the mound, trail and
//                alarm persistence, winter laying, hygiene, fungus / mill yield, seed meadows, leaf loads, the AI brood
//   col.sp       a per-colony view of AL.SPECIES[key] whose speed / breed / life / dig / appetite / carry / honeyStore
//                values multiply in the mods, so every existing `col.sp.speed` style read picks them up (no edits)
// Deep tunnelling (the expansion stage's raid-tunnel research) is the 'tunnel' node: when it is done
// col.research.tunnel becomes 1, which expansion.js / ui.js read as before.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); }
const C = AL.CASTE, K = AL.CARRY, NC = AL.NCASTE;

// ---- tuning -------------------------------------------------------------------------------------------
const CFG = {
  tier: [null,
    { sugar: 15, protein: 15, time: 60 },
    { sugar: 30, protein: 30, time: 90 },
    { sugar: 45, protein: 45, time: 120 },
    { sugar: 65, protein: 65, time: 150 },
    { sugar: 90, protein: 90, time: 180 },   // tier 5: the late game
  ],
  refund: 0.5,          // a cancelled research gives back this share of its cost
  ai: {
    every: 5,           // seconds between AI research decisions
    cost: 0.9,          // rivals pay this share of a node's cost (their abstract economy is leaner)
    sugarKeep: 45,      // sugar a rival keeps for eating before it saves for research ...
    sugarRate: 0.08,    // ... then saves this share of the surplus per second
    sugarMax: 1.6,
    protKeep: 4, protRate: 0.12, protMax: 0.35,
    swap: 2.2,          // a sugar-rich rival pays a protein shortfall with this much sugar per protein
    swapKeep: 160,      // ... once it has this much sugar over its keep
    minT: 90,           // no rival research before this many seconds
  },
  hpEvery: 10,          // ticks between passes that apply hp multipliers to new ants
};

// ---- modifiers ---------------------------------------------------------------------------------------
// Multipliers default to 1, additive values to 0, flags to false. hp / dps are per caste (Float32Array).
const ADD = { smell: 1, winterLay: 1, hygiene: 1, leafCarry: 1 };
const FLAG = { tunnel: 1, nestlink: 1, rootAphids: 1 };
function baseMods() {
  return {
    // foraging
    smell: 0,        // extra reach (world units) at which a forager smells food straight ahead
    search: 1,       // how long a forager searches before heading home
    trail: 1,        // food trail laid per tick by a laden forager
    trailKeep: 1,    // food trail half-life (and 1 / linear fade)
    carry: 1,        // crumbs per trip (col.sp.carry)
    leafCarry: 0,    // extra leaves per leaf brought home
    speed: 1,        // walking speed (col.sp.speed)
    // defence
    hp: new Float32Array(NC).fill(1),    // per caste, applied to each ant's maxhp
    dps: new Float32Array(NC).fill(1),   // per caste, read by combat through dpsMul
    alarm: 1,        // alarm hotspots (calls for soldiers) last this much longer
    mound: 1,        // the mound's own defences (expansion's mainMaxHp)
    // colony
    brood: 1,        // brood development speed
    lay: 1,          // queen laying rate (col.sp.breed)
    nursery: 1,      // nursery capacity
    life: 1,         // adult lifespan (col.sp.life)
    cold: 1,         // nursery temperature tolerance (2 = the cold/heat penalty is halved)
    winterLay: 0,    // the queen keeps laying in winter at this share of her normal rate
    hygiene: 0,      // extra disease decay per second (player nest)
    appetite: 1,     // sugar upkeep (col.sp.appetite)
    dig: 1,          // digging speed (col.sp.dig, also raid-tunnel speed)
    honey: 1,        // replete honey capacity (col.sp.honeyStore)
    fungus: 1,       // fungus garden yield (leafcutters)
    mill: 1,         // seed milling yield (harvesters)
    meadow: 1,       // harvester grass patches: seed regrowth and size
    propaganda: 1,   // slave-maker raids: defenders scatter more
    tunnel: false,   // deep tunnelling known (raid tunnels)
    nestlink: false, // nest tunnels: link your own nests underground (links.js)
    rootAphids: false, // aphid farming: the root-aphid chamber (aphids.js)
  };
}
const ALL = [C.WORKER, C.FORAGER, C.SCOUT, C.SOLDIER, C.MAJOR, C.NURSE, C.HONEYPOT, C.WINGED, C.CAPTIVE];
const GROUPS = {
  all: ALL, small: [C.WORKER, C.FORAGER, C.SCOUT], fighters: [C.SOLDIER, C.MAJOR],
  worker: [C.WORKER], forager: [C.FORAGER], scout: [C.SCOUT], soldier: [C.SOLDIER], major: [C.MAJOR],
  nurse: [C.NURSE], honeypot: [C.HONEYPOT], queen: [C.QUEEN], captive: [C.CAPTIVE],
};
// fold one effect spec ({ speed: 1.1, smell: 16, hp: { fighters: 1.2 }, tunnel: true }) into mods
function applyFx(m, fx) {
  for (const k in fx) {
    const v = fx[k];
    if (k === 'hp' || k === 'dps') { for (const g in v) for (const c of GROUPS[g] || []) m[k][c] *= v[g]; }
    else if (FLAG[k]) m[k] = m[k] || !!v;
    else if (ADD[k]) m[k] += v;
    else if (k in m) m[k] *= v;
  }
  return m;
}

// ---- the tree ----------------------------------------------------------------------------------------
const BRANCHES = [
  { id: 'forage', name: 'Foraging', tip: 'Finding food and bringing it home.' },
  { id: 'defence', name: 'Defence', tip: 'Tougher ants and a harder nest to crack.' },
  { id: 'colony', name: 'Colony', tip: 'Brood, lifespan, the seasons and the deep nest.' },
  { id: 'species', name: 'Species', tip: 'Traits only your species can evolve.' },
];
// n(id, branch, tier, name, effect line, fx, req, extra)
const NODES = [];
function n(id, branch, tier, name, line, fx, req, extra) { NODES.push(Object.assign({ id, branch, tier, name, line, fx, req: req || [] }, extra || {})); }
// Foraging
n('antennae', 'forage', 1, 'Keener antennae', 'Foragers smell food 16 units further ahead and search 25% longer.', { smell: 16, search: 1.25 });
n('scent', 'forage', 2, 'Strong trail scent', 'Laden foragers lay 35% more trail: highways form faster.', { trail: 1.35 }, ['antennae']);
n('crop', 'forage', 2, 'Bigger crop', 'Every trip home carries 25% more food.', { carry: 1.25 }, ['antennae']);
n('highways', 'forage', 3, 'Ant highways', 'Food trails last 60% longer before they fade.', { trailKeep: 1.6 }, ['scent']);
n('legs', 'forage', 4, 'Long legs', 'Every ant walks 8% faster.', { speed: 1.08 }, ['crop', 'highways']);
n('aphidfarm', 'forage', 5, 'Aphid farming', 'Build root-aphid chambers: foragers bring live aphids home from the wild plants, and the herd breeds and makes honeydew (sugar) safe inside the nest.', { rootAphids: true }, ['legs']);
// Defence
n('exo', 'defence', 1, 'Thicker exoskeleton', 'Every ant has 15% more health.', { hp: { all: 1.15 } });
n('jaws', 'defence', 2, 'Sharper mandibles', 'Every ant bites 15% harder.', { dps: { all: 1.15 } }, ['exo']);
n('alarm', 'defence', 2, 'Alarm pheromone', 'Alarm calls last 60% longer, so more soldiers turn out; alarm scent lingers.', { alarm: 1.6 }, ['exo']);
n('soldiers', 'defence', 3, 'Soldier caste', 'Soldiers and majors get 20% more health and bite 20% harder.', { hp: { fighters: 1.2 }, dps: { fighters: 1.2 } }, ['jaws']);
n('walls', 'defence', 4, 'Mound walls', 'The queen has 50% more health and the mound holds out 60% longer.', { hp: { queen: 1.5 }, mound: 1.6 }, ['soldiers', 'alarm']);
// Colony
n('jelly', 'colony', 1, 'Royal jelly', 'Brood grows 20% faster.', { brood: 1.2 });
n('nursery', 'colony', 2, 'Bigger nursery', 'Nurseries hold 40% more brood and the queen lays 10% faster.', { nursery: 1.4, lay: 1.1 }, ['jelly']);
n('elders', 'colony', 2, 'Long-lived workers', 'Adults live 25% longer.', { life: 1.25 }, ['jelly']);
n('cold', 'colony', 3, 'Cold tolerance', 'Brood minds a cold or hot nursery half as much, and the queen keeps laying in winter.', { cold: 2, winterLay: 0.35 }, ['elders']);
n('tunnel', 'colony', 4, 'Deep tunnelling', 'Dig raid tunnels under the lawn into rival nests [K].', { tunnel: true }, ['nursery'], { costFrom: 'tunnel' });
n('nestlink', 'colony', 5, 'Nest tunnels', 'Link two of your nests with a tunnel [P]: ants walk between them out of harm\'s way, and haulers carry food from the fuller store to the emptier one.', { nestlink: true }, ['tunnel']);
// Species (two each, deepening what the species already does)
n('swarmsting', 'species', 3, 'Stinging swarm', 'Workers, foragers and scouts sting 25% harder.', { dps: { small: 1.25 } }, ['jaws'], { sp: 'fire' });
n('polygyne', 'species', 3, 'Polygyne queens', 'Extra queens join the colony: laying 25% faster.', { lay: 1.25 }, ['nursery'], { sp: 'fire' });
n('cultivar', 'species', 3, 'Fungus cultivar', 'A better fungus strain: the garden yields 40% more.', { fungus: 1.4 }, ['jelly'], { sp: 'leafcutter' });
n('refuse', 'species', 3, 'Refuse workers', 'Dedicated midden workers: disease clears much faster and adults live 10% longer.', { hygiene: 0.6, life: 1.1 }, ['elders'], { sp: 'leafcutter' });
n('hardheads', 'species', 3, 'Hard heads', 'Workers, foragers and scouts get 25% more health.', { hp: { small: 1.25 } }, ['exo'], { sp: 'carpenter' });
n('doorkeepers', 'species', 3, 'Door-keepers', 'Plug-headed majors guard the doors: the queen +30% health, majors bite 20% harder.', { hp: { queen: 1.3 }, dps: { major: 1.2 } }, ['soldiers'], { sp: 'carpenter' });
n('phasic', 'species', 3, 'Phasic brood', 'The whole brood develops in one synchronised wave: 30% faster.', { brood: 1.3 }, ['jelly'], { sp: 'army' });
n('columns', 'species', 3, 'Raid columns', 'Soldiers and majors bite 20% harder; foragers range 20% longer.', { dps: { fighters: 1.2 }, search: 1.2 }, ['jaws'], { sp: 'army' });
n('repletes', 'species', 3, 'Deeper repletes', 'Each replete holds 50% more honey.', { honey: 1.5 }, ['crop'], { sp: 'honeypot' });
n('potguards', 'species', 3, 'Replete guards', 'Soldiers and majors get 30% more health and bite 15% harder.', { hp: { fighters: 1.3 }, dps: { fighters: 1.15 } }, ['exo'], { sp: 'honeypot' });
n('millers', 'species', 3, 'Granary millers', 'Milled seed yields 35% more food.', { mill: 1.35 }, ['crop'], { sp: 'harvester' });
n('meadows', 'species', 3, 'Seed meadows', 'The grass round the mound sheds seed 60% faster and holds 60% more.', { meadow: 1.6 }, ['antennae'], { sp: 'harvester' });
n('sickle', 'species', 3, 'Sickle jaws', 'Soldiers and majors bite 20% harder.', { dps: { fighters: 1.2 } }, ['jaws'], { sp: 'slavemaker' });
n('care', 'species', 3, 'Captive care', 'Captives tend brood 25% faster and have 20% more health.', { brood: 1.25, hp: { captive: 1.2 } }, ['jelly'], { sp: 'slavemaker' });
n('hunters', 'species', 3, 'Lone hunters', 'Each hunter hauls 33% more and smells food 16 units further ahead.', { carry: 1.33, smell: 16 }, ['antennae'], { sp: 'bullet' });
n('giants', 'species', 3, 'Armoured giants', 'Every ant has 20% more health.', { hp: { all: 1.2 } }, ['exo'], { sp: 'bullet' });
const BY_ID = {}; for (const d of NODES) BY_ID[d.id] = d;

// ---- species perks: one starting identity per match ---------------------------------------------------
// Each perk trades something away, so none is strictly best. `start` is a one-off bonus at the start.
const PERKS = {
  fire: [
    { id: 'stingers', name: 'Fierce stingers', line: 'Soldiers and majors sting 30% harder; the queen lays 8% slower.', fx: { dps: { fighters: 1.3 }, lay: 0.92 } },
    { id: 'opportunists', name: 'Opportunists', line: 'Smell food 20 units further and carry 15% more; bites 8% weaker.', fx: { smell: 20, carry: 1.15, dps: { all: 0.92 } } },
    { id: 'swarmfound', name: 'Swarm founding', line: '+12 workers and 20 sugar at the start; adults live 10% shorter.', fx: { life: 0.9 }, start: { workers: 12, sugar: 20 } },
  ],
  leafcutter: [
    { id: 'fungusrich', name: 'Fungus-rich', line: 'Start with 60 fungus and 40 leaves; the queen lays 8% slower.', fx: { lay: 0.92 }, start: { fungus: 60, leaves: 40 } },
    { id: 'bigheads', name: 'Big-headed soldiers', line: 'Soldiers and majors 40% tougher; the colony eats 8% more.', fx: { hp: { fighters: 1.4 }, appetite: 1.08 } },
    { id: 'cutters', name: 'Fast cutters', line: 'Each leaf brings 35% more and ants walk 4% faster; 10% less health.', fx: { leafCarry: 0.35, speed: 1.04, hp: { all: 0.9 } } },
  ],
  carpenter: [
    { id: 'heartwood', name: 'Heartwood borers', line: 'Dig 50% faster and the mound holds out 30% longer; the queen lays 5% slower.', fx: { dig: 1.5, mound: 1.3, lay: 0.95 } },
    { id: 'giantmajors', name: 'Giant majors', line: 'Majors 35% tougher and bite 25% harder; the queen lays 10% slower.', fx: { hp: { major: 1.35 }, dps: { major: 1.25 }, lay: 0.9 } },
    { id: 'patient', name: 'Patient colony', line: 'Adults live 30% longer and eat 10% less; brood grows 12% slower.', fx: { life: 1.3, appetite: 0.9, brood: 0.88 } },
  ],
  army: [
    { id: 'march', name: 'Relentless march', line: 'Every ant walks 12% faster; the colony eats 10% more.', fx: { speed: 1.12, appetite: 1.1 } },
    { id: 'swarmraid', name: 'Swarm raids', line: 'Workers, foragers and scouts bite 30% harder; 10% less health.', fx: { dps: { small: 1.3 }, hp: { all: 0.9 } } },
    { id: 'callows', name: 'Tough callows', line: 'Every ant 18% tougher; brood grows 12% slower.', fx: { hp: { all: 1.18 }, brood: 0.88 } },
  ],
  honeypot: [
    { id: 'hoard', name: 'Honey hoard', line: 'Start with 80 extra sugar; bites 10% weaker.', fx: { dps: { all: 0.9 } }, start: { sugar: 80 } },
    { id: 'runners', name: 'Desert runners', line: 'Walk 10% faster and smell food 16 units further; repletes hold 15% less.', fx: { speed: 1.1, smell: 16, honey: 0.85 } },
    { id: 'thrifty', name: 'Thrifty colony', line: 'The colony eats 15% less; repletes hold 20% less.', fx: { appetite: 0.85, honey: 0.8 } },
  ],
  harvester: [
    { id: 'seedhoard', name: 'Seed hoard', line: 'Start with 100 extra seeds; the queen lays 8% slower.', fx: { lay: 0.92 }, start: { seeds: 100 } },
    { id: 'redsting', name: 'Red harvester sting', line: 'Every ant stings 15% harder; the colony eats 8% more.', fx: { dps: { all: 1.15 }, appetite: 1.08 } },
    { id: 'oldmillers', name: 'Long-lived millers', line: 'Adults live 25% longer; brood grows 10% slower.', fx: { life: 1.25, brood: 0.9 } },
  ],
  slavemaker: [
    { id: 'propaganda', name: 'Master propaganda', line: 'Propaganda scent 50% stronger on raids; 10% less health.', fx: { propaganda: 1.5, hp: { all: 0.9 } } },
    { id: 'swift', name: 'Swift raiders', line: 'Every ant walks 12% faster; captives have 10% less health.', fx: { speed: 1.12, hp: { captive: 0.9 } } },
    { id: 'loyal', name: 'Loyal captives', line: 'Captives 35% tougher and bite 25% harder; propaganda 15% weaker.', fx: { hp: { captive: 1.35 }, dps: { captive: 1.25 }, propaganda: 0.85 } },
  ],
  bullet: [
    { id: 'venom', name: 'Deadly venom', line: 'Every ant stings 25% harder; the queen lays 10% slower.', fx: { dps: { all: 1.25 }, lay: 0.9 } },
    { id: 'elders', name: 'Long-lived hunters', line: 'Adults live 35% longer; ants walk 6% slower.', fx: { life: 1.35, speed: 0.94 } },
    { id: 'bigbrood', name: 'Bigger brood', line: '+3 brood at the start and the queen lays 20% faster; 10% less health.', fx: { lay: 1.2, hp: { all: 0.9 } }, start: { brood: 3 } },
  ],
};
const perksFor = key => PERKS[key] || [];
const perkDef = (key, id) => perksFor(key).find(p => p.id === id) || null;

// ---- costs, availability ---------------------------------------------------------------------------
function node(id) { return BY_ID[id] || null; }
function nodesFor(spKey) { return NODES.filter(d => !d.sp || d.sp === spKey); }
function cost(d) {
  if (d.costFrom === 'tunnel' && AL.Expansion && AL.Expansion.CFG) return AL.Expansion.CFG.tunnel.research;
  return CFG.tier[d.tier] || CFG.tier[1];
}
const totalPop = c => { let s = 0; for (let k = 0; k < c.pop.length; k++) s += c.pop[k]; return s; };
// extra conditions some nodes have (deep tunnelling is a late research: a big colony or a satellite)
function gate(world, c, d) {
  if ((d.id === 'nestlink' || d.id === 'aphidfarm') && c.sp && c.sp.nomad) return 'Army ants don\'t dig chambers or tunnels';
  if (d.id === 'tunnel') {
    if (c.sp && c.sp.nomad) return 'Army ants don\'t dig: they raid in the open';
    const T = AL.Expansion && AL.Expansion.CFG && AL.Expansion.CFG.tunnel; if (!T) return null;
    const sats = (c.satellites || []).some(s => s.state === 'active');
    if (!sats && totalPop(c) < T.minPop) return 'Needs a satellite nest or ' + T.minPop + ' ants';
  }
  return null;
}
function ensure(c) {
  const r = c.research || (c.research = { tunnel: 0, busy: false, t: 0 });
  if (!r.done) { r.done = {}; r.order = []; r.cur = null; r.dur = 0; r.fund = { sugar: 0, protein: 0 }; }
  if (r.busy == null) r.busy = false;
  return r;
}
function isDone(c, id) { return !!(c.research && c.research.done && c.research.done[id]); }
function reqsMet(c, d) { return d.req.every(id => isDone(c, id)); }
// { ok, why } for starting node id now (the player pays from stock)
function can(world, ci, id) {
  const c = world.colonies[ci], d = node(id);
  if (!c || !d) return { ok: false, why: 'Unknown research' };
  const r = ensure(c);
  if (d.sp && d.sp !== c.spKey) return { ok: false, why: 'Another species\' trait' };
  if (r.done[id]) return { ok: false, why: 'Already known' };
  if (r.busy && r.cur === id) return { ok: false, why: 'Researching' };
  const miss = d.req.filter(q => !r.done[q]);
  if (miss.length) return { ok: false, why: 'Needs ' + miss.map(q => node(q).name.toLowerCase()).join(' and ') };
  const g = gate(world, c, d); if (g) return { ok: false, why: g };
  if (c.out || c.alive === false || (c.queen && !c.queen.alive)) return { ok: false, why: 'No queen' };
  if (r.busy) return { ok: false, why: 'Researching ' + (node(r.cur) ? node(r.cur).name.toLowerCase() : 'something else'), busy: true };
  const k = cost(d);
  if (c.stock.protein < k.protein || c.stock.sugar < k.sugar) return { ok: false, why: 'Needs ' + k.protein + ' protein, ' + k.sugar + ' sugar' };
  return { ok: true };
}
// 'done' | 'researching' | 'available' (can start now) | 'short' (only food missing) | 'locked'
function status(world, ci, id) {
  const c = world.colonies[ci], r = ensure(c), d = node(id);
  if (r.done[id]) return 'done';
  if (r.busy && r.cur === id) return 'researching';
  if (!reqsMet(c, d) || gate(world, c, d)) return 'locked';
  return can(world, ci, id).ok ? 'available' : 'short';
}
function begin(world, c, d) {
  const r = ensure(c);
  r.busy = true; r.cur = d.id; r.t = 0; r.dur = cost(d).time;
  if (d.id === 'tunnel') r.tunnel = 0;
  AL.emit(world, 'researchStarted', { col: c.id, what: d.id, node: d });
}
function start(world, ci, id) {
  if (!can(world, ci, id).ok) return false;
  const c = world.colonies[ci], d = node(id), k = cost(d);
  c.stock.protein -= k.protein; c.stock.sugar -= k.sugar;
  begin(world, c, d);
  return true;
}
function cancel(world, ci) {
  const c = world.colonies[ci], r = ensure(c);
  if (!r.busy) return false;
  const d = node(r.cur), k = cost(d), f = CFG.refund;
  c.stock.protein += k.protein * f; c.stock.sugar += k.sugar * f;
  r.busy = false; r.cur = null; r.t = 0;
  if (d.id === 'tunnel' && r.tunnel < 1) r.tunnel = 0;
  AL.emit(world, 'researchCancelled', { col: ci, what: d.id });
  return true;
}
function finish(world, c, id) {
  const r = ensure(c), d = node(id);
  if (r.done[id]) return;
  r.done[id] = true; r.order.push(id);
  if (r.cur === id) { r.busy = false; r.cur = null; r.t = 0; }
  refresh(world, c);
  AL.emit(world, 'researchDone', { col: c.id, what: id, node: d });
}
// dev / tests / scenarios: mark a node done at once (no cost)
function grant(world, ci, id) { const c = world.colonies[ci]; if (c && node(id)) finish(world, c, id); }
function progress(c) { const r = c.research; return r && r.busy && r.dur ? Math.min(1, r.t / r.dur) : 0; }
function advance(world, c, dt) {
  const r = c.research; if (!r || !r.busy) return;
  if (c.out || c.alive === false) return;
  r.t += dt;
  if (r.cur === 'tunnel') r.tunnel = Math.min(0.999, r.t / r.dur);   // expansion-ui's old progress read
  if (r.t >= r.dur) finish(world, c, r.cur);
}

// ---- the species view: col.sp reads multiply in col.mods ------------------------------------------------
// col.sp stays the species data (prototype = AL.SPECIES[key]); fields with a modifier other than 1 get an own
// value (base x mod), rewritten on every refresh. Plain data properties, not getters: col.sp.speed is read per
// ant per tick in the surface loop. Fields never modified keep reading through to AL.SPECIES.
const VIEW = { speed: ['speed', 1], breed: ['lay', 1], life: ['life', 1], dig: ['dig', 1], appetite: ['appetite', 1], carry: ['carry', 1], honeyStore: ['honey', 0] };
function makeView(c) {
  const base = (c.sp && c.sp._rsBase) || c.sp || AL.SPECIES[c.spKey];
  const v = Object.create(base);
  Object.defineProperty(v, '_rsBase', { value: base });
  c.sp = v;
}
function syncView(c) {
  const v = c.sp, base = v._rsBase, m = c.mods;
  for (const f in VIEW) {
    const [mk, keep] = VIEW[f], b = base[f];
    if (b == null && !keep) continue;              // a field the species doesn't have (honeyStore for non-honeypots)
    if (m[mk] === 1 && !Object.prototype.hasOwnProperty.call(v, f)) continue;
    v[f] = (b == null ? 1 : b) * m[mk];
  }
}

// ---- refresh: rebuild col.mods from the perk + finished nodes, then apply the one-shot effects -----------------
function refresh(world, c) {
  const old = c.mods, m = baseMods();
  const p = c.perk && perkDef(c.spKey, c.perk); if (p) applyFx(m, p.fx);
  // the biome suits some species a little better (terrain.js AL.BIOMES edge)
  const B = AL.BIOMES && AL.BIOMES[world.biomeKey], e = B && B.edge && B.edge[c.spKey]; if (e) applyFx(m, e);
  const r = ensure(c);
  for (const id of r.order) { const d = node(id); if (d) applyFx(m, d.fx); }
  c.mods = m;
  if (!c.sp || !c.sp._rsBase) makeView(c);
  syncView(c);
  if (m.tunnel) r.tunnel = 1;
  applyOneShots(world, c, old || baseMods(), m);
  return m;
}
function applyOneShots(world, c, o, m) {
  // trails and alarm scent: this colony's own pheromone grids
  const P = world.pher;
  if (P && P.food && P.food[c.id]) {
    const g = P.food[c.id]; if (g._rsHalf == null) { g._rsHalf = g.halfLife; g._rsFade = g.fade; }
    g.halfLife = g._rsHalf * m.trailKeep; g.fade = g._rsFade / m.trailKeep;
  }
  if (P && P.alarm && P.alarm[c.id]) {
    const g = P.alarm[c.id]; if (g._rsHalf == null) g._rsHalf = g.halfLife;
    g.halfLife = g._rsHalf * m.alarm;
  }
  // the queen (an ant in the player's nest, a number in an abstract one)
  const qr = m.hp[C.QUEEN] / o.hp[C.QUEEN];
  if (qr !== 1 && c.queen) {
    if (c.queen.maxHp) { c.queen.maxHp *= qr; c.queen.hp *= qr; }
    const A = world.ants, qi = c.queen.i;
    if (qi != null && qi >= 0 && A.state[qi] && A.caste[qi] === C.QUEEN && A.col[qi] === c.id) { A.maxhp[qi] *= qr; A.hp[qi] *= qr; }
  }
  // the mound (expansion's siege model for abstract nests)
  const mr = m.mound / o.mound;
  if (mr !== 1 && c.mainMaxHp) { c.mainMaxHp *= mr; c.mainHp *= mr; }
  // harvester grass patches near the mound
  const gr = m.meadow / o.meadow;
  if (gr !== 1 && world.surface) for (const f of world.surface.foods) if (f.poi && f.poi.grass && f.poi.col === c.id) { f.regen *= gr; f.max *= gr; }
}

// ---- hp: every ant of a colony gets its caste multiplier once, as it appears (or when the mods change) ------
function hpArrays(A) {
  if (!A.rsUid || A.rsUid.length < A.cap) { A.rsUid = new Int32Array(A.cap); A.rsHp = new Float32Array(A.cap).fill(1); A.rsCaste = new Uint8Array(A.cap); }
}
function fixHp(world) {
  const A = world.ants, cols = world.colonies; hpArrays(A);
  const U = A.rsUid, H = A.rsHp, KC = A.rsCaste;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i]) continue;
    const k = A.caste[i]; if (k === C.QUEEN) continue;   // the queen is scaled in applyOneShots
    const c = cols[A.col[i]], want = c && c.mods ? c.mods.hp[k] : 1;
    if (U[i] !== A.uid[i] || KC[i] !== k) {
      // a new ant (or one recast to another caste, which resets its maxhp): full multiplier
      U[i] = A.uid[i]; KC[i] = k; H[i] = want;
      if (want !== 1) { A.maxhp[i] *= want; A.hp[i] *= want; }
    } else if (H[i] !== want) { const f = want / H[i]; A.maxhp[i] *= f; A.hp[i] *= f; H[i] = want; }
  }
}
// read by combat (one place): damage multiplier for an ant of this caste in this colony
function dpsMul(c, caste) { return c && c.mods ? c.mods.dps[caste] : 1; }
function hpMul(c, caste) { return c && c.mods ? c.mods.hp[caste] : 1; }

// ---- leaf loads: wrap the colony's entrance (chained with species.js' wrapper) ------------------------
function chainHas(f, flag) { for (let g = f, n = 0; g && n < 8; g = g.orig, n++) if (g[flag]) return true; return false; }
function ensureEnter(c) {
  if (!c.enter || chainHas(c.enter, '_rs')) return;
  c.enter = wrapEnter(c.enter);
}
function wrapEnter(orig) {
  const f = function (world, i) {
    const A = world.ants, col = world.colonies[A.col[i]];
    if (A.carry[i] === K.LEAF && col.mods && col.mods.leafCarry > 0) AL.Sim.addStock(col, K.LEAF, col.mods.leafCarry);
    return orig.call(this, world, i);
  };
  f._rs = true; f.orig = orig; if (orig._sp) f._sp = true;   // species.js only checks the outer wrapper
  return f;
}

// ---- per-second colony effects that have no hook elsewhere ------------------------------------------------
const AI_BROOD_RATE = 0.8 / (AL.TUNE.EGG_T + AL.TUNE.LARVA_T + AL.TUNE.PUPA_T);   // ai.js's brood queue pace
function colonySecond(world, c) {
  const m = c.mods, s = c.stock, env = world.env || {};
  // alarm calls last longer (combat / ai push hotspots; we stretch the new ones once)
  if (m.alarm !== 1 && c.hotspots) for (const h of c.hotspots) if (!h._rs) { h._rs = 1; h.life = (h.life || 25) * m.alarm; }
  // fungus: extra yield on what the garden converted this second (life.js / ai.js ran between our two passes)
  if (c.sp.fungus && m.fungus !== 1 && c._rsLeaves != null) {
    const conv = c._rsLeaves - s.leaves;
    if (conv > 0) s.fungus += conv * 1.6 * (m.fungus - 1);
  }
  // seed milling (species.js keeps a running total in col.milled)
  if (c.sp.seeds && m.mill !== 1) {
    const dm = (c.milled || 0) - (c._rsMilled == null ? (c.milled || 0) : c._rsMilled);
    if (dm > 0) { s.sugar += dm * 0.55 * (m.mill - 1); s.protein += dm * 0.25 * (m.mill - 1); }
  }
  c._rsMilled = c.milled || 0;
  // hygiene: disease clears faster in the player's nest
  if (m.hygiene > 0 && c.disease > 0) c.disease = Math.max(0, c.disease - m.hygiene);
  // the AI's abstract brood queue: brood speed
  if (c.inside && c.broodQ && m.brood !== 1 && !c.founding) for (const b of c.broodQ) if (b.fed) b.t = Math.max(0, b.t + AI_BROOD_RATE * (m.brood - 1));
  // cold tolerance: the queen keeps laying in winter (the core stops laying altogether)
  if (env.winter && m.winterLay > 0 && c.queen && c.queen.alive && !c.founding) {
    c._rsWinter = (c._rsWinter || 0) + m.winterLay * (c.sp.breed || 1) / AL.TUNE.LAY_INTERVAL;
    if (c._rsWinter >= 1) {
      c._rsWinter -= 1;
      if (c.brood && c.nest && c.cap && c.brood.length < (c.cap.nursery || 6) && s.protein > 4) {
        c.brood.push({ caste: C.WORKER, stage: 0, t: 0, starve: 0, slot: -1 });
        if (AL.Life && AL.Life.placeBrood) AL.Life.placeBrood(c);
        AL.emit(world, 'eggLaid', { col: c.id, caste: C.WORKER });
      } else if (c.broodQ && c.inside && c.broodQ.length < 40 && s.sugar > 4) c.broodQ.push({ caste: C.WORKER, t: 0, fed: false });
    }
  }
}

// ---- rival research: a simple priority list per species, paced by what the colony can spare -------------------
const AI_ORDER = {
  base: ['exo', 'antennae', 'jelly', 'jaws', 'crop', 'elders', 'nursery', 'soldiers', 'scent', 'alarm', 'cold', 'highways', 'tunnel', 'walls', 'legs'],
  // species nodes slot in after this many core nodes
  fire: [[3, 'swarmsting'], [7, 'polygyne']],
  leafcutter: [[2, 'cultivar'], [8, 'refuse']],
  carpenter: [[1, 'hardheads'], [8, 'doorkeepers']],
  army: [[2, 'phasic'], [5, 'columns']],
  honeypot: [[3, 'repletes'], [6, 'potguards']],
  harvester: [[2, 'millers'], [5, 'meadows']],
  slavemaker: [[3, 'sickle'], [5, 'care']],
  bullet: [[1, 'giants'], [4, 'hunters']],
};
function aiOrder(spKey) {
  const out = AI_ORDER.base.slice(), ins = (AI_ORDER[spKey] || []).slice().sort((a, b) => b[0] - a[0]);
  for (const [at, id] of ins) out.splice(Math.min(at, out.length), 0, id);
  return out;
}
function aiPick(world, c) {
  const r = ensure(c), list = c._rsOrder || (c._rsOrder = aiOrder(c.spKey));
  for (const id of list) {
    const d = node(id); if (!d || r.done[id] || (d.sp && d.sp !== c.spKey)) continue;
    if (!reqsMet(c, d) || gate(world, c, d)) continue;
    return d;
  }
  return null;
}
function aiSecond(world, c) {
  const A = CFG.ai, r = ensure(c), s = c.stock;
  if (r.busy || world.t < A.minT || c.out || !c.queen || !c.queen.alive) return;
  const d = aiPick(world, c); if (!d) return;
  const k = cost(d), needS = k.sugar * A.cost, needP = k.protein * A.cost, f = r.fund;
  // save a little every second toward the next node, never more than it needs: sugar above what the colony
  // eats (honeypot repletes count: their honey is sugar too), a share of spare protein
  const keepS = A.sugarKeep + (AL.Colony && AL.Colony.upkeep ? AL.Colony.upkeep(c) * 60 : 0);
  const honey = c.honey || 0, spare = s.sugar + honey - keepS;
  if (f.sugar < needS && spare > 0) {
    let v = Math.min(A.sugarMax, spare * A.sugarRate, needS - f.sugar); f.sugar += v;
    const h = Math.min(honey, v); if (h > 0) { c.honey -= h; v -= h; }
    s.sugar -= v;
  }
  if (f.protein < needP && s.protein > A.protKeep) { const v = Math.min(A.protMax, (s.protein - A.protKeep) * A.protRate, needP - f.protein); s.protein -= v; f.protein += v; }
  if ((((world.t | 0) + c.id) % A.every) !== 0) return;
  // a sugar-rich rival trades sugar for its protein shortfall (and a protein-rich one the other way)
  if (f.protein < needP && s.sugar > keepS + A.swapKeep) {
    const v = Math.min(needP - f.protein, (s.sugar - keepS - A.swapKeep) / A.swap);
    s.sugar -= v * A.swap; f.protein += v;
  }
  if (f.sugar < needS && s.protein > A.protKeep + 40) {
    const v = Math.min(needS - f.sugar, (s.protein - A.protKeep - 40) * 0.5);
    s.protein -= v; f.sugar += v;
  }
  if (f.sugar >= needS - 1e-6 && f.protein >= needP - 1e-6) {
    f.sugar = Math.max(0, f.sugar - needS); f.protein = Math.max(0, f.protein - needP);
    begin(world, c, d);
  }
}

// ---- perks: setup and the one-off start bonuses ----------------------------------------------------------
function pickRivalPerk(world, c) {
  const list = perksFor(c.spKey); if (!list.length) return null;
  return list[Math.floor(AL.hash2(world.seed >>> 0, c.id * 7919 + 31, 0x9e55) * list.length) % list.length].id;
}
function chosenPerk(world, c, opts) {
  const list = perksFor(c.spKey); if (!list.length) return null;
  if (c.isPlayer) {
    const p = world.mp ? (world.mp.perks || [])[c.id] : opts.perk;
    if (p && perkDef(c.spKey, p)) return p;
    if (p === 'random') return pickRivalPerk(world, c);
    return null;   // no perk chosen (tests, old saves): plain species
  }
  const given = opts.rivalPerks && opts.rivalPerks[c.id - 1];
  if (given && perkDef(c.spKey, given)) return given;
  if (opts.rivalPerks === false) return null;
  return pickRivalPerk(world, c);
}
function startBonus(world, c) {
  const p = c.perk && perkDef(c.spKey, c.perk); if (!p || !p.start || c._rsStart) return;
  // a rival still founding (founding race) gets its start bonus at colony stage, not in the sealed cell
  if (c.founding || (!c.isPlayer && (world.opts.rivalFoundings || []).some(h => h && h.col === c.id && h.race && h.race.stillFounding) && world.tick === 0)) return;
  c._rsStart = true;
  const st = p.start, s = c.stock;
  for (const k of ['sugar', 'protein', 'seeds', 'fungus', 'leaves']) if (st[k]) s[k] = (s[k] || 0) + st[k];
  const A = world.ants, R = world.R;
  if (st.workers) {
    if (c.nest && AL.Nest) {
      const N = AL.Nest, nest = c.nest, open = [];
      for (let i = 0; i < nest.n; i++) if (nest.kind[i] === N.TILE.OPEN && !nest.chamber[i]) open.push(i);
      if (!open.length) for (let i = 0; i < nest.n; i++) if (nest.kind[i] === N.TILE.OPEN) open.push(i);
      for (let k = 0; k < st.workers && open.length; k++) {
        const [x, y] = N.centre(nest, open[(R() * open.length) | 0]);
        const i = A.spawn(c.id, k % 3 === 2 ? C.FORAGER : C.WORKER, AL.LAYER.NEST, x, y, R() * AL.TAU, R);
        if (i < 0) break;
        A.hp[i] = A.maxhp[i] = AL.CASTES[A.caste[i]].hp * ((c.sp && c.sp.hp) || 1); A.tx[i] = x; A.ty[i] = y; A.timer[i] = 1 + R() * 2;
        if (c.sp.life) A.life[i] *= c.sp.life;
      }
    } else if (c.inside) { c.inside[C.WORKER] += Math.round(st.workers * 2 / 3); c.inside[C.FORAGER] += st.workers - Math.round(st.workers * 2 / 3); }
  }
  if (st.brood) {
    for (let k = 0; k < st.brood; k++) {
      if (c.nest && c.brood) c.brood.push({ caste: C.WORKER, stage: k % 3, t: R() * 0.5, starve: 0, slot: -1 });
      else if (c.broodQ) c.broodQ.push({ caste: C.WORKER, t: 0.3, fed: true });
    }
    if (c.nest && c.brood && AL.Life && AL.Life.placeBrood) AL.Life.placeBrood(c);
  }
}

// ---- systems ----------------------------------------------------------------------------------------------
// 'research' (order 1): sets up col.mods / col.sp before the other systems' init read them, and notes the leaf
// store at the start of every second so 'research-late' can tell what the fungus garden converted.
AL.registerSystem({
  id: 'research', order: 1,
  enabled: opts => !opts.benchOnly && opts.research !== false,
  init(world, opts) {
    for (const c of world.colonies) {
      ensure(c);
      c.perk = chosenPerk(world, c, opts);
      refresh(world, c);
      if (c.perk) AL.emit(world, 'perkChosen', { col: c.id, perk: c.perk });
    }
  },
  second(world) { for (const c of world.colonies) c._rsLeaves = c.stock.leaves; },
});
AL.registerSystem({
  id: 'research-late', order: 40,
  enabled: opts => !opts.benchOnly && opts.research !== false,
  init(world) {
    for (const c of world.colonies) { ensure(c); if (!c.mods) refresh(world, c); else applyOneShots(world, c, baseMods(), c.mods); ensureEnter(c); startBonus(world, c); }
    fixHp(world);
  },
  tick(world) { if (world.tick % CFG.hpEvery === 0) fixHp(world); },
  second(world, dt) {
    for (const c of world.colonies) {
      if (!c.mods) refresh(world, c);
      ensureEnter(c);
      if (c.alive === false || c.out) continue;
      if (!c._rsStart && c.perk && !c.founding) startBonus(world, c);   // deferred: a rival that was founding
      advance(world, c, dt);
      colonySecond(world, c);
      if (!c.isPlayer && !c.founding && (world.opts.rivalResearch !== false)) aiSecond(world, c);
    }
  },
});

AL.Research = { wrapEnter,
  CFG, BRANCHES, NODES, PERKS, GROUPS,
  node, nodesFor, cost, can, start, cancel, grant, status, progress, isDone,
  refresh, baseMods, applyFx, dpsMul, hpMul, fixHp,
  perksFor, perkDef, pickRivalPerk, aiOrder, aiPick,
};
if (NODE) module.exports = AL.Research;
})(typeof window !== 'undefined' ? window : globalThis);
