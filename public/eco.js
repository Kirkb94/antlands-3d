// The backyard ecosystem: every creature eats, starves and breeds (on top of world-creatures.js).
//  - Hunger: cr.food 0..1 drains all the time (BURN). Spiders eat ants and, when hungry, ladybugs, larvae and
//    caterpillars; ground beetles scavenge the dead (they compete with ants for carcasses) and attack caterpillars
//    and cocoons; ladybugs and their larvae eat aphids; caterpillars eat clover. A creature with nothing in it
//    loses hp and dies, leaving a carcass for the ants.
//  - Life cycles instead of respawn timers: a well-fed spider guards an egg sac at her lair, and spiderlings
//    hatch, grow up and settle a new lair; a well-fed beetle lays eggs in the soil that hatch as a new beetle;
//    ladybugs lay on aphid plants, the larvae eat aphids and turn into ladybugs; caterpillars that eat their fill
//    pupate, the butterfly lays on clover and the eggs hatch into caterpillars. Aphids multiply on their plant
//    (world-poi.js) until something eats them.
//  - Robins take caterpillars, spiders and beetles out in the open as well as ants.
//  - If a kind dies out, one wanders in from outside the yard after a while (never in winter).
//  - world.eco keeps the census the Wildlife panel shows (eco-ui.js).
//   AL.Eco = { TUNE, census(world), room(world, type), spiderHunt, huntTick, beetleLook, beetleEat, butterflyLay, birdPrey, eaten }
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./world-creatures.js'); }
const K = AL.CARRY, TAU = Math.PI * 2;

const ECO = AL.ECO_TUNE = Object.assign({
  BURN: { spider: 1 / 480, beetle: 1 / 600, ladybug: 1 / 240, caterpillar: 1 / 200, lblarva: 1 / 220 },   // share of a full belly used per second
  HUNGRY: 0.35,               // below this a creature hunts harder and further
  STARVE: 1 / 70,             // share of max hp lost per second with an empty belly
  FEED: { ant: 0.3, aphid: 0.1, clover: 0.02, carcass: 0.05, creature: 0.45, litter: 0.003 },   // belly per ant / aphid / s of grazing / crumb / kill / s of hunting the litter
  BREED_FOOD: 0.75, BREED_HOLD: 50, BREED_COST: 0.45,   // well fed this long -> breed, which costs this much belly
  CAP: { spider: 6, beetle: 8, ladybug: 6, lblarva: 10, caterpillar: 8 },   // most of each kind in the yard (counting young and eggs)
  HATCH: { eggsac: 110, beetle: 120, ladybug: 55, caterpillar: 80 },        // seconds until eggs hatch
  YOUNG_T: 180,               // spiderlings grow up in this long (if they eat)
  LARVA_T: 90,                // ladybug larvae turn into ladybugs after this long, if fed
  PUPATE_FOOD: 0.95, PUPATE_AGE: 120,   // a caterpillar pupates once this full and this old
  COCOON_T: 90,               // ... and the butterfly comes out after this long on a warm day
  IMMIGRATE: 240,             // seconds a kind has been missing before one wanders in
  BIRD_CREATURE: 0.35,        // chance a robin's pass goes after a creature in the open (if there is one)
  SCAVENGE_R: 240, HUNT_R: 150,
  ANT_HUNT: 0.008,            // chance per second a searching forager catches something small in the litter (x the prey there)
}, AL.ECO_TUNE || {});
const WC = () => AL.WorldCreatures, BUF = new Int32Array(64);
const CAPKEY = { spider: 'spider', eggsac: 'spider', beetle: 'beetle', ladybug: 'ladybug', lblarva: 'lblarva', caterpillar: 'caterpillar', cocoon: 'caterpillar' };
// other modules' creatures plug in here (eco-hunters.js: centipedes, antlions, assassin bugs, mantises):
//   kinds[k] = true counts it in the census; hatch[k](world, x, y, clutch) hatches its eggs; breed[k](world, cr) lays
//   (true = laid); arrive[k](world) brings one in from outside the yard when there are none
const HOOKS = { kinds: {}, hatch: {}, breed: {}, arrive: {} };

// ---- census ---------------------------------------------------------------------------------------
function census(world) {
  const n = { spider: 0, eggsac: 0, beetle: 0, ladybug: 0, lblarva: 0, caterpillar: 0, cocoon: 0, butterfly: 0, clutch: {} }, fed = {}, fn = {};
  for (const k in HOOKS.kinds) n[k] = 0;
  for (const cr of world.surface.creatures) {
    if (!cr.alive) continue;
    if (cr.type === 'clutch') { n.clutch[cr.hatch] = (n.clutch[cr.hatch] || 0) + cr.n; continue; }
    if (n[cr.type] == null) continue;
    n[cr.type]++;
    if (ECO.BURN[cr.type]) { fed[cr.type] = (fed[cr.type] || 0) + cr.food; fn[cr.type] = (fn[cr.type] || 0) + 1; }
  }
  for (const k in fed) fed[k] /= fn[k];
  let aphids = 0; for (const p of world.surface.pois) if (p.type === 'aphids' && !p.gone) aphids += p.aphids;
  return { n, fed, aphids: Math.round(aphids) };
}
// room for one more of this kind (its young and eggs count)
function room(world, type) {
  const key = CAPKEY[type] || type, B = AL.BIOMES && AL.BIOMES[world.biomeKey], bm = (B && B.creatures && B.creatures[key]) || 1;   // the biome: more spiders in the forest, few ladybugs in the desert
  const cap = ECO.CAP[key] && Math.max(1, Math.round(ECO.CAP[key] * bm)); if (!cap) return true;
  let have = 0;
  for (const cr of world.surface.creatures) {
    if (!cr.alive) continue;
    if (cr.type === 'clutch') { if (cr.hatch === key) have += cr.n; continue; }
    if (CAPKEY[cr.type] === key) have++;
  }
  return have < cap;
}

// ---- creature eats creature -------------------------------------------------------------------------
// prey taken by a predator: gone without a carcass (it was eaten)
function eaten(world, prey, by) {
  if (!prey.alive || prey.dead) return;
  prey.dead = true;
  WC().remove(world, prey);
  const e = world.eco; if (e) { e.eaten++; e.log.push([world.t | 0, 'eaten', prey.type, by]); if (e.log.length > 40) e.log.shift(); }
  AL.emit(world, 'creatureEaten', { kind: prey.type, by, x: prey.x, y: prey.y });
}
const SPIDER_PREY = { ladybug: 1, lblarva: 1, caterpillar: 1, cocoon: 0.6 };
// a hungry spider at her lair: anything small enough nearby? (a person can see her leave the web for it)
function spiderHunt(world, cr) {
  let best = null, bd = AL.sq(ECO.HUNT_R * (cr.scale || 1));
  for (const o of world.surface.creatures) {
    if (!o.alive || o === cr || o.flying || o.hidden || !SPIDER_PREY[o.type]) continue;
    const d = AL.sq(o.x - cr.home.x) + AL.sq(o.y - cr.home.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return false;
  cr.state = 'hunt'; cr.quarry = best; cr.quarryId = best.id; cr.st = 25;
  return true;
}
// any predator after a creature: close in, bite, eat it (spiders; beetles use it for caterpillars and cocoons)
function huntTick(world, cr, dt, spd) {
  const q = cr.quarry;
  cr.st -= dt;
  if (!q || !q.alive || q.id !== cr.quarryId || q.flying || q.hidden || cr.st <= 0 || cr.attackers >= 3) { cr.quarry = null; cr.state = cr.type === 'spider' ? 'return' : 'wander'; return; }
  const d = WC().steer(world, cr, q.x, q.y, spd, dt);
  if (d > cr.r + q.r + 2) return;
  cr.biteT -= dt;
  if (cr.biteT > 0) return;
  cr.biteT = cr.def.biteEvery;
  q.hp -= (cr.def.bite || 3) * 1.6 * (cr.scale || 1) * (1 - (q.armor || 0));
  if (q.hp <= 0) { eaten(world, q, cr.type); cr.food = Math.min(1, cr.food + ECO.FEED.creature); cr.quarry = null; cr.state = cr.type === 'spider' ? 'feed' : 'wander'; cr.st = 4; }
}
// a hungry ground beetle: the nearest carcass or crumbs of protein (competing with the ants), else a caterpillar
function beetleLook(world, cr) {
  if (cr.food >= 0.6 || cr.attackers) return;
  const S = world.surface;
  let best = null, bd = ECO.SCAVENGE_R * ECO.SCAVENGE_R;
  for (const f of S.foods) {
    if (f.gone || f.kind !== K.PROTEIN || f.amount < 1 || !(f.carcass || f.corpse)) continue;
    const d = AL.sq(f.x - cr.x) + AL.sq(f.y - cr.y);
    if (d < bd) { bd = d; best = f; }
  }
  if (best) { cr.eat = best; cr.tx = best.x; cr.ty = best.y; return; }
  for (const o of S.creatures) {
    if (!o.alive || (o.type !== 'caterpillar' && o.type !== 'cocoon' && o.type !== 'lblarva') || o.hidden) continue;
    if (AL.sq(o.x - cr.x) + AL.sq(o.y - cr.y) < ECO.HUNT_R * ECO.HUNT_R) { cr.state = 'hunt'; cr.quarry = o; cr.quarryId = o.id; cr.st = 30; return; }
  }
  // nothing dead and nothing slow: a hungry beetle goes for an ant (eco-hunters.js)
  if (cr.food < ECO.HUNGRY && AL.EcoHunters) AL.EcoHunters.beetleAnts(world, cr);
}
function beetleEat(world, cr, dt) {
  const f = cr.eat;
  if (!f || f.gone || f.amount < 0.5 || cr.food >= 0.98) { cr.eat = null; return false; }
  const d = WC().steer(world, cr, f.x, f.y, cr.def.speed, dt);
  if (d > (f.r || 5) + cr.r) return true;
  const take = Math.min(f.amount, 0.6 * dt);
  f.amount -= take; cr.food = Math.min(1, cr.food + ECO.FEED.carcass * take);
  if (f.amount < 0.5) { f.gone = true; world.surface.foodDirty = true; cr.eat = null; }
  return true;
}
// a butterfly out of her cocoon looks for clover to lay on (if there's room for caterpillars), then flies off
function butterflyLay(world, cr, dt) {
  if (world.env.winter || !room(world, 'caterpillar')) { cr.laid = true; return false; }
  if (!cr.plant) {
    let best = null, bd = 1e18;
    for (const p of world.surface.pois) if (p.type === 'clover' && !p.gone) { const d = AL.sq(p.x - cr.x) + AL.sq(p.y - cr.y); if (d < bd) { bd = d; best = p; } }
    if (!best) { cr.laid = true; return false; }
    cr.plant = best;
  }
  cr.alt = Math.max(0.35, cr.alt - dt * 0.3); cr.anim += dt * 14;
  if (WC().steer(world, cr, cr.plant.x, cr.plant.y, cr.def.speed * 0.6, dt, true) > 8) return true;
  layClutch(world, 'caterpillar', cr.plant.x, cr.plant.y, 2 + ((world.R() * 2) | 0), { plant: cr.plant });
  cr.laid = true;
  return true;
}
// a robin's pass: a creature out in the open
function birdPrey(world) {
  const cl = world.clock; if (!cl || cl.daylight < 0.6) return null;
  const list = [];
  for (const cr of world.surface.creatures) {
    if (!cr.alive || cr.hidden || cr.flying || cr.attackers > 0) continue;
    if (cr.type !== 'caterpillar' && cr.type !== 'spider' && cr.type !== 'beetle' && cr.type !== 'lblarva' && cr.type !== 'centipede' && cr.type !== 'assassin' && cr.type !== 'mantis') continue;
    if (AL.World.isExposed(world, cr.x, cr.y)) list.push(cr);
  }
  return list.length ? list[(world.R() * list.length) | 0] : null;
}

// ---- young ------------------------------------------------------------------------------------------
// eggs: one hidden creature that hatches n of a kind after a while
function layClutch(world, hatch, x, y, n, o) {
  const cr = WC().spawn(world, 'clutch', x, y, Object.assign({ hatch, n, st: ECO.HATCH[hatch] || 90, hidden: true, prey: false, state: 'still' }, o || {}));
  if (cr && world.eco) world.eco.laid++;
  return cr;
}
function clutch(world, cr, dt) {
  if (world.env.winter) return;   // eggs wait out the cold
  cr.st -= dt;
  if (cr.st > 0) return;
  const R = world.R;
  for (let k = 0; k < cr.n; k++) {
    if (!room(world, cr.hatch === 'ladybug' ? 'lblarva' : cr.hatch) && k > 0) break;
    const a = R() * TAU, x = cr.x + AL.cos(a) * 10, y = cr.y + AL.sin(a) * 10;
    if (cr.hatch === 'ladybug') WC().spawn(world, 'lblarva', x, y, { plant: cr.plant, state: 'crawl', food: 0.5 });
    else if (cr.hatch === 'caterpillar') WC().spawn(world, 'caterpillar', x, y, { state: 'crawl', food: 0.4 });
    else if (cr.hatch === 'beetle') { const b = WC().spawn(world, 'beetle', x, y, { state: 'wander', tx: x, ty: y, food: 0.5 }); if (b) b.home = { x: cr.x, y: cr.y }; }
    else if (HOOKS.hatch[cr.hatch]) HOOKS.hatch[cr.hatch](world, x, y, cr);
    if (world.eco) world.eco.born++;
  }
  WC().remove(world, cr);
  AL.emit(world, 'ecoHatch', { kind: cr.hatch, x: cr.x, y: cr.y, n: cr.n });
}
// a spider's egg sac: sits at her lair (ants can raid it for a little protein), hatches into spiderlings
function eggsac(world, cr, dt) {
  if (world.env.winter) return;
  cr.st -= dt;
  if (cr.st > 0) return;
  const R = world.R, C = world.creatures, n = 1 + (R() < 0.5 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    if (!room(world, 'spider') && k > 0) break;
    const lair = newLair(world, cr);
    const s = WC().spawn(world, 'spider', cr.x, cr.y, { state: 'return', young: true, scale: 0.55, food: 0.5, hp: 70, maxHp: 70, r: 6 });
    if (!s) break;
    s.home = { x: lair.x, y: lair.y }; lair.cr = s; lair.used = true;
    if (world.eco) world.eco.born++;
  }
  WC().remove(world, cr);
  AL.emit(world, 'ecoHatch', { kind: 'spider', x: cr.x, y: cr.y, n });
}
// spiderlings move out: an empty lair, or a new spot away from other spiders and from ant mounds
function newLair(world, from) {
  const C = world.creatures, S = world.surface, R = world.R;
  for (const l of C.lairs) if (l.type === 'spider' && !(l.cr && l.cr.alive) && AL.sq(l.x - from.x) + AL.sq(l.y - from.y) > 60 * 60) return l;
  for (let k = 0; k < 12; k++) {
    const a = R() * TAU, d = 250 + R() * 450, x = AL.clamp(from.x + AL.cos(a) * d, 80, S.W - 80), y = AL.clamp(from.y + AL.sin(a) * d, 80, S.H - 80);
    if (AL.Surface.isBlocked(S, x, y)) continue;
    let ok = true;
    for (const l of C.lairs) if (l.type === 'spider' && AL.sq(l.x - x) + AL.sq(l.y - y) < 220 * 220) { ok = false; break; }
    for (const c of world.colonies) if (c.alive !== false && AL.sq(c.x - x) + AL.sq(c.y - y) < 260 * 260) { ok = false; break; }
    if (!ok) continue;
    const l = { type: 'spider', x, y, t: 0, cr: null, used: true };
    C.lairs.push(l);
    return l;
  }
  return C.lairs.find(l => l.type === 'spider') || { x: from.x, y: from.y };
}
// ladybug larvae: crawl about their aphid plant eating aphids; grow into ladybugs
function lblarva(world, cr, dt) {
  const p = cr.plant, W = WC();
  if (cr.attackers > 0) { W.fightBack(world, cr, dt); return; }
  if (world.t - cr.born >= ECO.LARVA_T && cr.food >= 0.5) {
    W.remove(world, cr);
    const b = W.spawn(world, 'ladybug', cr.x, cr.y, { state: 'eat', st: 40, flying: false, prey: true, alt: 0, plant: p && !p.gone ? p : null, ox: 0, oy: 0, food: cr.food });
    if (b && p && !(p.ladybugCr && p.ladybugCr.alive)) { p.ladybugCr = b; p.ladybug = true; }
    if (b && !b.plant) { b.state = 'flyoff'; b.flying = true; }
    AL.emit(world, 'ecoGrown', { kind: 'ladybug', x: cr.x, y: cr.y });
    return;
  }
  if (!p || p.gone) { cr.tx = cr.x + (world.R() - 0.5) * 60; cr.ty = cr.y + (world.R() - 0.5) * 60; }
  else if ((cr.st -= dt) <= 0) {
    cr.st = 4;
    const a = world.R() * TAU; cr.tx = p.x + AL.cos(a) * 24; cr.ty = p.y + AL.sin(a) * 24;
    if (p.aphids >= 1 && cr.food < 0.98) { p.aphids -= 1; cr.food = Math.min(1, cr.food + ECO.FEED.aphid); }
  }
  W.steer(world, cr, cr.tx, cr.ty, cr.def.speed, dt);
}

// ---- once a second ---------------------------------------------------------------------------------------
function second(world) {
  const e = world.env, R = world.R, W = WC(), L = world.surface.creatures;
  const eco = world.eco || (world.eco = { born: 0, starved: 0, eaten: 0, laid: 0, gone: {}, log: [] });
  for (let k = L.length - 1; k >= 0; k--) {
    const cr = L[k];
    if (!cr || !cr.alive) continue;
    // spiderlings grow up
    if (cr.young && world.t - cr.born >= ECO.YOUNG_T && cr.food > 0.4) { cr.young = false; cr.scale = 1; cr.maxHp = cr.def.hp; cr.hp = Math.min(cr.maxHp, cr.hp + 60); cr.r = cr.def.r; }
    const burn = ECO.BURN[cr.type];
    if (!burn) continue;
    // hunger: a creature hiding out the winter burns little
    cr.food = Math.max(0, cr.food - burn * (cr.hidden || e.winter ? 0.25 : 1));
    // spiders and beetles also catch the small things in the leaf litter (springtails, mites, grubs): less where an
    // army ant swarm has just stripped the ground (swarm.js world.litter)
    if ((cr.type === 'spider' && (cr.state === 'lurk' || cr.state === 'prowl')) || (cr.type === 'beetle' && cr.state === 'wander')) cr.food = Math.min(1, cr.food + ECO.FEED.litter * (cr.type === 'beetle' ? 2.5 : 1) * (AL.Swarm ? AL.Swarm.preyAt(world, cr.x, cr.y) : 1) * (cr.scale || 1));   // (beetles cover more ground)
    if (cr.food <= 0) {
      cr.hp -= cr.maxHp * ECO.STARVE;
      if (cr.hp <= 0) { eco.starved++; eco.log.push([world.t | 0, 'starved', cr.type]); if (eco.log.length > 40) eco.log.shift(); AL.emit(world, 'creatureStarved', { kind: cr.type, x: cr.x, y: cr.y }); cr.alive = false; cr.onDeath(world, -1); continue; }
    }
    // well fed for a while, in the warm, with room: breed
    if (cr.food >= ECO.BREED_FOOD && !e.winter && !cr.young) cr.fedT += 1; else cr.fedT = 0;
    if (cr.fedT < ECO.BREED_HOLD) continue;
    if (cr.type === 'spider' && cr.state === 'lurk' && room(world, 'spider')) {
      W.spawn(world, 'eggsac', cr.home.x + 6, cr.home.y + 4, { state: 'still', st: ECO.HATCH.eggsac, food: 1 });
      cr.food -= ECO.BREED_COST; cr.fedT = 0; eco.laid++;
      AL.emit(world, 'ecoLay', { kind: 'spider', x: cr.x, y: cr.y });
    } else if (cr.type === 'beetle' && cr.state === 'wander' && room(world, 'beetle')) {
      layClutch(world, 'beetle', cr.x, cr.y, 2);
      cr.food -= ECO.BREED_COST; cr.fedT = 0;
    } else if (cr.type === 'ladybug' && cr.state === 'eat' && cr.plant && room(world, 'lblarva')) {
      layClutch(world, 'ladybug', cr.plant.x, cr.plant.y, 2 + ((R() * 2) | 0), { plant: cr.plant });
      cr.food -= ECO.BREED_COST; cr.fedT = 0;
    } else if (HOOKS.breed[cr.type] && room(world, cr.type) && HOOKS.breed[cr.type](world, cr)) {
      cr.food -= ECO.BREED_COST; cr.fedT = 0;
    }
  }
  // foragers hunt the litter too: springtails, mites and grubs are most ants' protein. Leafcutters farm instead and
  // army ants sweep it in swarms (swarm.js); everyone takes from the same ground as the spiders and beetles
  if (!e.winter && AL.Swarm) {
    const A = world.ants, ST = AL.ST, lt = AL.Swarm.litter(world), cell = AL.Swarm.TUNE.CELL;
    for (let i = 0; i < A.high; i++) {
      if (A.state[i] !== ST.WANDER || A.layer[i] !== 0 || A.carry[i]) continue;
      const col = world.colonies[A.col[i]];
      if (!col || col.sp.fungus || col.sp.nomad || A.caste[i] === AL.CASTE.QUEEN) continue;
      if (col.spKey === 'slavemaker' && A.caste[i] !== AL.CASTE.CAPTIVE) continue;   // slave-makers can't feed themselves: only their captives hunt
      const cx = (A.x[i] / cell) | 0, cy = (A.y[i] / cell) | 0; if (cx < 0 || cy < 0 || cx >= lt.w || cy >= lt.h) continue;
      const c = cy * lt.w + cx, prey = lt.rich[c] * (1 - lt.dep[c]);
      if (prey <= 0 || R() >= ECO.ANT_HUNT * prey) continue;
      lt.dep[c] = Math.min(1, lt.dep[c] + 1 / (lt.rich[c] * AL.Swarm.TUNE.PREY));
      A.carry[i] = K.PROTEIN; A.state[i] = ST.RETURN; A.str[i] = 0.5; A.timer[i] = 0; A.a[i] = AL.atan2(col.y - A.y[i], col.x - A.x[i]);
    }
  }
  // a kind that died out wanders back in from outside the yard, after a while
  if (!e.winter) {
    const cs = census(world).n;
    const C = world.creatures;
    for (const kind of ['spider', 'beetle']) {
      const have = cs[kind] + (kind === 'spider' ? cs.eggsac : 0) + (cs.clutch[kind] || 0);
      if (have > 0) { eco.gone[kind] = 0; continue; }
      eco.gone[kind] = (eco.gone[kind] || 0) + 1;
      if (eco.gone[kind] < ECO.IMMIGRATE) continue;
      const homes = C.lairs.filter(l => l.type === kind);
      if (!homes.length) continue;
      const l = homes[(R() * homes.length) | 0], cr = W.spawn(world, kind, l.x, l.y, { state: kind === 'spider' ? 'lurk' : 'wander', tx: l.x, ty: l.y, food: 0.5 });
      if (cr) { l.cr = cr; l.used = true; eco.gone[kind] = 0; AL.emit(world, 'ecoArrive', { kind, x: l.x, y: l.y }); }
    }
    for (const kind in HOOKS.arrive) HOOKS.arrive[kind](world, cs, eco);
  }
}

AL.registerSystem({
  id: 'eco', order: 12.5,   // after world-creatures
  enabled(opts) { return opts.world !== false && opts.creatures !== false && opts.eco !== false; },
  init(world) {
    world.eco = { born: 0, starved: 0, eaten: 0, laid: 0, gone: {}, log: [] };
    const B = WC() && WC().BEHAVE;
    if (B) { B.clutch = clutch; B.eggsac = eggsac; B.lblarva = lblarva; }
  },
  second,
});
AL.Eco = { TUNE: ECO, HOOKS, CAPKEY, census, room, spiderHunt, huntTick, beetleLook, beetleEat, butterflyLay, birdPrey, eaten, layClutch };
if (NODE) { module.exports = AL.Eco; require('./eco-hunters.js'); }
})(typeof window !== 'undefined' ? window : globalThis);
