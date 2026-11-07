// Antlands game data: castes, ant states, carried items, species and tuning numbers.
// Pure data, no logic, so balancing happens in one place.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;

// ---- castes -------------------------------------------------------------------------
const C = { WORKER: 0, FORAGER: 1, SCOUT: 2, SOLDIER: 3, MAJOR: 4, NURSE: 5, HONEYPOT: 6, QUEEN: 7, WINGED: 8, CAPTIVE: 9 };
AL.CASTE = C;
AL.NCASTE = 10;
// size: sprite scale; speed: units/s; life: seconds of adult life at 1x (balance, Nov 2026: workers, foragers, scouts
// and nurses doubled so colonies can grow into the thousands; the balance runs after that: foragers, scouts, soldiers
// and majors longer again, since cohorts dying of old age at once made colonies crash mid-match); prot/sug: cost to raise one larva
// vis: fog-of-war sight in fog cells; carry: crumbs per trip; drag: pull strength on big prey
// hp/dps: combat (tools/combat-harness.js balance pass, Oct 2026), equal protein + upkeep: soldiers beat workers
// (~23% of their hp left), majors beat worker swarms (only ~4 workers fit round a major) but are a coin flip
// against soldiers, scouts lose to everything. Read stats through AL.Combat.stat() (species and research apply there).
AL.CASTES = [
  { key: 'worker',   name: 'Worker',   size: 1.0,  speed: 34, hp: 10,  dps: 3,   life: 2250, prot: 1, sug: 1,   vis: 2.5, drag: 1, tip: 'Generalist: digs, hauls, forages and helps with brood.' },
  { key: 'forager',  name: 'Forager',  size: 1.0,  speed: 42, hp: 9,   dps: 2.5, life: 2000, prot: 1, sug: 1,   vis: 3,   drag: 1, tip: 'Long legs and a good nose. Lives on the surface bringing food home.' },
  { key: 'scout',    name: 'Scout',    size: 0.9,  speed: 52, hp: 8,   dps: 2,   life: 1700, prot: 1, sug: 1.5, vis: 10,  drag: 0,   tip: 'Fast pathfinder that sees far through the fog. Finds food and lays a strong trail home for foragers to follow, but carries nothing.' },
  { key: 'soldier',  name: 'Soldier',  size: 1.3,  speed: 30, hp: 26,  dps: 8,   life: 1800, prot: 3, sug: 2,   vis: 2.5, drag: 2, tip: 'Big jaws. Answers alarm trails and guards the mound.' },
  { key: 'major',    name: 'Major',    size: 1.75, speed: 24, hp: 66,  dps: 13,  life: 2100, prot: 7, sug: 3,   vis: 2.5, drag: 4, tip: 'Huge and slow. Crushes enemies and drags big prey on its own.' },
  { key: 'nurse',    name: 'Nurse',    size: 0.85, speed: 28, hp: 9,   dps: 1.5, life: 2400, prot: 1, sug: 1,   vis: 2,   drag: 0.5, tip: 'Stays in the nursery. Each nurse speeds up brood.' },
  { key: 'honeypot', name: 'Honeypot', size: 1.15, speed: 8,  hp: 12,  dps: 0,   life: 1800, prot: 2, sug: 3,   vis: 1,   drag: 0, tip: 'Living storage: hangs in a food store and holds sugar that never spoils.' },
  { key: 'queen',    name: 'Queen',    size: 2.3,  speed: 8,  hp: 600,  dps: 6,   life: 1e9,  prot: 0, sug: 0,   vis: 2,   drag: 0, tip: 'The heart of the colony. Never leaves her chamber.' },
  { key: 'winged',   name: 'Winged',   size: 1.4,  speed: 30, hp: 14,  dps: 1,   life: 1500, prot: 4, sug: 4,   vis: 3,   drag: 0, tip: 'Future queens and males (nuptial flight comes later).' },
  // slave-makers only: hatched from brood stolen in a raid, a worker of the victim's species (never laid by a queen)
  { key: 'captive',  name: 'Captive',  size: 1.0,  speed: 34, hp: 10,  dps: 2.5, life: 1600, prot: 1, sug: 1,   vis: 2.5, drag: 1, tip: 'A worker of another species, raised from a stolen pupa. It forages, digs and nurses for its slave-maker masters.' },
];
AL.EGG_CASTES = [C.WORKER, C.FORAGER, C.SCOUT, C.SOLDIER, C.MAJOR, C.NURSE, C.HONEYPOT];

// ---- ant states ---------------------------------------------------------------------
AL.ST = {
  DEAD: 0,
  // surface
  WANDER: 1, RETURN: 2, RECRUIT: 3, RALLY: 4, FIGHT: 5, DRAG: 6, DUMP: 7, GUARD: 8, RAID: 9, HOMING: 10,
  HEAL: 11,      // wounded: walking home to heal (like HOMING, but alarms and recruit calls leave it alone)
  COLLECT: 12,   // on a Collect order: walking to the next food in the player's circle (orders.js; A.str = order id)
  // nest
  N_IDLE: 20, N_GOTO: 21, N_DIG: 22, N_WORK: 23, N_HANG: 24, N_QUEEN: 25, N_RAID: 26,
  N_HEAL: 27,    // wounded: resting in the nest until healed
  N_MILL: 28,    // harvester majors grinding stored seed in the food store (species.js mills; this is them doing it)
  N_TRANSIT: 29, // walking a tunnel to another of the colony's nests (links.js): out of sight until it arrives
};
// what a nest ant does when it reaches the end of its flow field
AL.ACT = { NONE: 0, EXIT: 1, STORE: 2, DIG: 3, NURSE: 4, MIDDEN: 5, CORPSE: 6, REST: 7, HANG: 8, FUNGUS: 9, HEAL: 10, MILL: 11 };
// what an ant is carrying
AL.CARRY = { NONE: 0, SUGAR: 1, PROTEIN: 2, WATER: 3, SEED: 4, LEAF: 5, SOIL: 6, CORPSE: 7 };
AL.RES = ['', 'sugar', 'protein', 'water', 'seeds', 'leaves'];
AL.CARRY.BROOD = 8;   // a stolen pupa (slave-maker raids, see species.js)
AL.CARRY.APHID = 9;   // a live aphid carried home to the root-aphid chamber (aphids.js)
AL.LAYER = { SURFACE: 0, NEST: 1, INSIDE: 2 }; // INSIDE = abstract (an AI nest that isn't simulated tile by tile)

// ---- species ------------------------------------------------------------------------
// body/head/gaster colours feed the sprite atlas; multipliers tune the colony
// polygyne: how many laying queens the main nest can hold (life.js; AL.TUNE.POLY). Only fire ants: Atta leafcutters,
//   Camponotus, Eciton, Polyergus and Paraponera are single-queen; Myrmecocystus and Pogonomyrmex queens may found
//   together but the colony ends up with one queen in most species.
// fight: combat traits (combat.js): pin (grip), stun (grapple stun), pierce (ignores toughness/armour), armor,
//        vsBig (damage on creatures), swarm (bonus per extra nestmate on a target), nerve (retreat threshold, 0 = never),
//        castes { major: { dps, hp } } (a species twist on one caste)
AL.SPECIES = {
  fire: {
    key: 'fire', name: 'Fire ants', blurb: 'Fast breeders with stinging swarms. The baseline colony.', perks: ['Fast breeding', 'Painful stings (+15% damage), swarms that pin their prey', 'Many queens: keep winged queens at home, up to 6 lay in one nest'],
    body: '#9a3b1e', head: '#7e2c14', gaster: '#3a1a10', breed: 1.2, hp: 1, dps: 1.15, speed: 1.05, dig: 1, size: 1, start: 40,
    polygyne: 6,   // Solenopsis invicta's polygyne form: many laying queens share one nest (max queens, the first one included)
    fight: { pin: 1.2, vsBig: 1.3 },   // stinging swarms: they grip and sting together; venom wears big prey down
  },
  leafcutter: {
    key: 'leafcutter', name: 'Leafcutters', blurb: 'Cut leaves and farm fungus on them. Slow start, huge colonies.', perks: ['Fungus garden turns leaves into food', 'Laying speeds up as the colony grows', 'Slow breeders early on'],
    body: '#8c4a22', head: '#a35a2a', gaster: '#5a2e14', breed: 0.8, hp: 1.15, dps: 1.0, speed: 0.95, dig: 1, size: 1.05, start: 36, fungus: true,
    fight: { castes: { major: { dps: 1.3, hp: 1.3 } } },   // giant big-headed soldiers guard the garden
  },
  carpenter: {
    key: 'carpenter', name: 'Carpenter ants', blurb: 'Big workers that tunnel through wood. Fewer but tougher.', perks: ['Workers 25% bigger and armoured (35% tougher)', 'Dig wood 4x faster (a buried stump)', 'Slower breeders'],
    body: '#2a2220', head: '#1c1614', gaster: '#3a2a22', breed: 0.75, hp: 1.15, dps: 1.0, speed: 0.95, dig: 1.1, size: 1.25, start: 32, wood: true, appetite: 0.85,   /* balance (polish): big workers starved hands-off players */
    fight: { armor: 0.15 },   // thick cuticle
  },
  army: {
    key: 'army', name: 'Army ants', blurb: 'No fixed nest: a living bivouac that marches and raids.', perks: ['Can march the bivouac to a new spot', 'Raid swarms: every extra ant on a victim bites harder; fast, big start', 'Can\'t dig'],
    body: '#6a3a1c', head: '#4a2410', gaster: '#2a160c', breed: 1.4, hp: 1.0, dps: 0.98, speed: 1.15, dig: 0, size: 1.05, start: 60, nomad: true, broodMul: 0.5,   /* slow brood: one big batch per ~2.5 min cycle (bivouac.js) */
    fight: { swarm: 0.12, pin: 1.15 },   // raid swarms: every extra ant on a victim bites harder
  },
  // ---- added species (mechanics in species.js) ----
  // Myrmecocystus: workers swell into repletes (living honey jars) when sugar is plentiful
  honeypot: {
    key: 'honeypot', name: 'Honeypot ants', blurb: 'Desert nectar hoarders. Living jars of honey carry them through lean times.', perks: ['Workers swell into repletes for free when sugar is plentiful', 'Each replete holds 2.5x the honey; it never spoils', 'Weak fighters (-15% damage) that break off a losing fight early'],
    body: '#c58d4c', head: '#b07438', gaster: '#7a5230', breed: 1.05, hp: 0.95, dps: 0.85, speed: 1.1, dig: 1, size: 0.95, start: 40, look: 'honeypot',
    repletes: true, honeyStore: 2.5,
    fight: { nerve: 1.5 },   // break off a losing fight early
  },
  // Pogonomyrmex: seed harvesters with big-headed millers, a cleared disc round the mound and a fierce sting
  harvester: {
    key: 'harvester', name: 'Harvester ants', blurb: 'Seed farmers of the open ground: big-headed millers and a fierce sting.', perks: ['Seeds are their bread: majors mill stored seeds into sugar and protein', 'Eat 30% less and seeds never spoil: slow to starve', 'Strong sting (+30% damage), cleared warm ground round the mound'],
    body: '#a2401f', head: '#8e3416', gaster: '#5c2410', breed: 0.95, hp: 1.15, dps: 1.3, speed: 0.95, dig: 1.1, size: 1.05, start: 40, look: 'harvester',
    seeds: true, appetite: 0.7, broodMul: 1.08,
    fight: { pierce: 0.4, vsBig: 1.5 },   // the most toxic insect venom: gets through armour, deadly to big animals
  },
  // Polyergus: sickle-jawed raiders that can't keep house; stolen brood hatches as captive workers
  slavemaker: {
    key: 'slavemaker', name: 'Slave-makers', blurb: 'Raiders that can\'t keep house. They steal pupae; the captives do the work.', perks: ['Raid rival nests for pupae: send a Raid [I] onto a rival mound', 'Stolen brood hatches as captive workers of that species', 'Own workers barely forage or nurse; sickle jaws (2.2x damage, armour-piercing)'],
    body: '#a8421c', head: '#933614', gaster: '#401a0c', breed: 0.7, hp: 1.6, dps: 2.2, speed: 1.1, dig: 0.5, size: 1.0, start: 40, look: 'slavemaker',
    raider: true, appetite: 0.85,   /* balance (final pass): idle raiders burn less; hands-off players starved */
    fight: { pierce: 0.4, stun: 1.4 },   // sickle jaws pierce heads; propaganda pheromone is in species.js
  },
  // Paraponera: a few hundred huge, solitary hunters at most; every ant counts
  bullet: {
    key: 'bullet', name: 'Bullet ants', blurb: 'A handful of huge, solitary hunters with the most painful sting there is.', perks: ['Huge workers: 5x toughness, 3.8x damage and a paralysing sting; carry 3 crumbs', 'Tiny colonies that breed very slowly; workers live almost twice as long', 'Every ant matters: each one has a name, and a big swarm of small ants can drag one down'],
    body: '#3a2216', head: '#2c1910', gaster: '#24150e', breed: 0.2, hp: 5, dps: 3.8, speed: 1.0, dig: 1.2, size: 1.7, start: 14, look: 'bullet',
    solitary: true, carry: 3, broodCost: 3, broodMul: 0.55, life: 1.8,
    fight: { stun: 2.5, nerve: 0, pin: 0.8 },   // a paralysing sting; solitary hunters grip poorly but never back down
  },
};
AL.SPECIES_ORDER = ['fire', 'leafcutter', 'carpenter', 'army', 'honeypot', 'harvester', 'slavemaker', 'bullet'];
// playable for now (Nov 2026): the other five stay in the game but show as "Coming soon" on the species screen,
// are never picked as rivals, and the campaign missions and tutorials that use them are closed. Add a key here to open it.
AL.PLAYABLE = ['fire', 'carpenter', 'bullet'];
AL.isPlayable = k => AL.PLAYABLE.indexOf(k) >= 0;
AL.RIVAL_COLOURS = { body: '#c4291b', head: '#a51d12', gaster: '#46120c' }; // rival fire ants are a hot red

// ---- tuning ---------------------------------------------------------------------------
AL.TUNE = {
  DT: 1 / 30,               // fixed simulation step (seconds)
  DAY: 240,                 // seconds per in-game day at 1x
  SEASON_DAYS: 3,           // days per season
  PHER_CELL: 16,            // surface pheromone grid cell (world units)
  HASH_CELL: 24,            // spatial hash cell
  FOG_CELL: 32,             // fog of war cell
  FOOD_SMELL: 46,           // how far a forager smells food
  SEARCH_TIME: 70,          // seconds a forager searches before heading home
  SUGAR_PER_ANT: 0.0009,    // sugar eaten per second by a fire-ant worker; bigger ants eat more (UPKEEP_EXP)
  UPKEEP_EXP: 1.6,          // upkeep scales with (caste size x species size)^this: a major ~2.4x, a bullet ant ~2.3x, a nurse ~0.8x
  WATER_PER_ANT: 0.0004,
  QUEEN_SUGAR: 0.021,
  HONEYDEW_RATE: 0.13,      // honeydew per aphid per second (tended aphids give more; was 0.03 before FOOD_MUL, 0.09 before the Nov balance run)
  APHID_REGROW: 0.05,       // aphids per second a plant regains (none while a ladybug feeds)
  NECTAR_RATE: 0.14, NECTAR_MAX: 5, FLOWER_REGROW: 420,   // flowers refill nectar; mowed ones grow back
  LAY_INTERVAL: 2.6,        // seconds between eggs at full health (species breed divides it) (growth pass, Nov 2026: was 3.2)
  AI_LAY_INTERVAL: 3.2,     // AI rivals keep the old pace, so the boost is the players' (a hands-off check had rivals out-growing it)
  AI_BROOD_FOOD: 1,
  BROOD_FOOD: 0.75,         // share of a caste's food cost (prot, sug) a larva eats while it grows (growth pass: was all of it)
  STARTER: { piles: 3, sugar: 30, protein: 18, near: 170, far: 300 },   // food lying round every nest at the start (growth pass)
  // laying speeds up as the colony grows (every species; life.js and ai.js): x (1 + min(max, adults / per)).
  // Fungus growers (leafcutters) climb steeper: their gardens feed huge colonies.
  // Single-queen species (not sp.polygyne) add up to soloMax more, soloPer adults at a time, once past soloFrom
  // adults: one queen has to do the work of fire ants' many (the first ~10 minutes don't change). A lone queen that
  // fast lays up to two eggs a second (life.js layTick); every other queen lays at most one.
  // Rivals' abstract brood chambers hold aiBrood items, plus aiBroodPer per adult, up to aiBroodMax.
  GROW: { per: 700, max: 1, fungusPer: 220, fungusMax: 1.5, soloFrom: 250, soloPer: 250, soloMax: 3, aiBrood: 40, aiBroodPer: 0.03, aiBroodMax: 100 },
  // polygyny (sp.polygyne): extra laying queens in the main nest (life.js; rivals in ai.js)
  //   layMul: each extra queen lays this share of a lone queen's rate (queens in a crowded nest lay less)
  //   keep: a winged queen kept at home (Royal chamber); auto: the colony takes in a newly mated queen by itself
  //   every autoEvery s once it has autoPop adults (first one not before autoFirst s)
  POLY: { layMul: 0.6, hp: 0.6, autoPop: 300, autoEvery: 300, autoFirst: 900 },
  EGG_T: 18, LARVA_T: 26, PUPA_T: 22,
  CRUMB: 1,                 // one carried crumb = 1 unit of a resource
  FOOD_MUL: 3,              // every food source (sugar, protein, seeds) holds this much more than its listed amount, and
                            // honeydew, nectar and the key-point springs refill this much faster (big colonies starved)
  TRIP: 2,                  // food a forager takes from a source and brings home in one trip (sp.carry adds to it)
  LAY_BRAKE: { perAnt: 0.35, floor: 0.12, autumn: 3, winter: 0.3 },   // the queen lays slower as food runs short: full speed with perAnt
                            // food (sugar + protein) in store for every adult, down to floor x with an empty store
                            // (life.js layBrake). Without it colonies boomed, ate the yard bare and crashed mid-match.
                            // In autumn she wants `autumn` x as much: the colony goes into winter with a store, not a
                            // crowd (balance runs: a starvation wave right after every winter). In winter a queen with
                            // a well-stocked store (2x what full speed wants) keeps laying at `winter` x; slow breeders
                            // (breed under 1) are braked less: they never outgrow their food anyway
  LITTER: { every: 4.5, cap: 70, perAnts: 600, capPerAnts: 10, big: 0.12 },   // litter turns up every `every` s, faster
                            // with more ants in the yard (x1 per perAnts ants), mostly near the biggest colonies;
                            // `big` of it is a dead moth (surface.js spawnLitter)
  STORE_PER_TILE: 14,       // food store capacity per chamber tile
  APHID_PER_TILE: 3,        // root aphids a root-aphid chamber tile holds (aphids.js)
  WATER_PER_TILE: 12,
  NURSERY_PER_TILE: 3,      // brood items per nursery tile
  MIDDEN_PER_TILE: 8,
  HONEYPOT_STORE: 14,
  CARRY_SLOW: 0.8,          // speed of an ant hauling anything (food, water, soil, a body, brood) or dragging big prey
};
// wounded ants go home to heal (combat.js sends them, life.js rests and heals them, ai.js keeps rivals' wounds)
AL.HEAL = {
  AT: [0.5, 0.4, 0.35],     // hp fraction below which workers (all small castes) / soldiers / majors head home
  DRAG: 0.5,                // ants dragging big prey only let go below AT x this
  FULL: 0.97,               // a resting ant gets up again at this hp fraction
  RATE: 0.022,              // share of max hp healed per second in the nest (from 10% to full in ~40 s)
  SUGAR_PER_HP: 0.015,      // sugar from the colony store per hp healed (no healing while starving)
  MIN_SUGAR: 6,             // the wounded go home to heal only while the store has this much sugar: with less they can't
                            // heal anyway, so they keep foraging (else a starving colony's hurt ants shuttled in and out)
  SLOW: 0.4,                // hp per second (free) for the queen and ants in a fight in the nest, so raids still count
  RAID_HOLD: 8,             // seconds after a raid on the mound during which the wounded turn out to defend it
  CHECK: 15,                // surface ants check their wounds when (slot + tick) & CHECK is 0 (every 16 ticks, ~0.5 s)
};
// fight injuries (injury.js): bites can cost an ant a leg or, rarely, its head. Limbs never grow back.
// A bite worth share f of the target's max hp takes a leg with chance LEG x jaw x f and the head with
// HEAD x jaw^2 x (1 + PIERCE_HEAD x fight.pierce) x f, so big jaws do most of the maiming.
AL.INJURY = {
  LEG: 0.55,                // chance of losing a leg per full max hp of bites (x the biter's jaw)
  HEAD: 0.012,              // ... of losing the head (x jaw squared, x the piercing bonus)
  JAW: { soldier: 1.7, major: 2.4, queen: 1.6 },   // caste jaws (others 1)
  SPECIES_JAW: { bullet: 1.8 },                    // species whose every ant has big jaws
  PIERCE_HEAD: 5,           // fight.pierce helps take heads: slave-makers' sickle jaws pierce heads
  STING: { harvester: true },                      // ... unless the pierce is a sting, not jaws
  CREATURE_JAW: { spider: 2.4, beetle: 1.8, termites: 1.2, caterpillar: 0.6, ladybug: 0.6 },
  QUEEN_HEAD: 0,            // queens lose legs but are never decapitated (they don't walk anyway)
  LEG_SLOW: 0.2,            // speed lost per missing leg, multiplicative with everything else (5 lost: can't move)
  HEADLESS_SPEED: 0.35,     // a headless ant stumbles about at this share of its (leg) speed
  BLIND_TURN: 5,            // ... turning at random (rad/s spread)
  CIRCLE_TURN: 3,           // rad/s an ant with no legs left on one side turns (walks in a tight circle)
  STARVE_T: 180,            // seconds for a headless or stuck ant to starve from full hp without per-ant hunger
  ROLL: 0.04,               // bites add up these chances per ant; they are rolled once they reach this
  PULL: 0.5,                // an ant held by grip g (x its size, above 1) loses legs x 1 + PULL x (g - 1): a swarm pulls them off
};

if (NODE) module.exports = AL;
})(typeof window !== 'undefined' ? window : globalThis);
