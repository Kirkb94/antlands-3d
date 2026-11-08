// The backyard's ant hunters (on top of world-creatures.js and eco.js): centipedes, antlions, assassin bugs and
// praying mantises, plus the hunger-driven ant hunting they share with the spiders and ground beetles.
//  - Every hunter has a hunger meter (cr.food, 1 = full, drains at ECO.BURN). The emptier it is, the further it
//    looks for an ant, the bigger a crowd it dares and the longer it keeps after one; a hunter that has just eaten
//    leaves ants alone. Ladybugs and caterpillars never hunt ants.
//  - Centipede: hides under the litter by day and runs ants down in the open at night (a starving one comes out
//    in daylight too). Antlion: sits at the bottom of a sand pit; ants that step in slide down to its jaws, and a
//    hungry antlion digs a wider, steeper pit. Assassin bug: picks a spot by a busy ant trail and waits, then stabs
//    whatever walks past; a hungry one creeps up on ants. Praying mantis: perches on a plant (aphid plants that ants
//    tend most of all) and snatches ants and other insects that come within reach.
//  - They breed when well fed (eggs in the soil or sand, a mantis egg case on her plant), their young grow up, and
//    each kind first wanders in from outside the yard a few minutes into a match (never in the campaign, never in
//    winter), then again whenever it has died out. Ants can kill them all: a carcass full of protein.
// Sim only, deterministic (world.R), no DOM.
//   AL.EcoHunters = { TUNE, KINDS, drive, nearestAnt, antAttack, beetleAnts, arrive, pitOf }
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./world-creatures.js'); require('./eco.js'); }
const ST = AL.ST, CA = AL.CASTE, TAU = AL.TAU;
const WC = () => AL.WorldCreatures, EC = () => AL.Eco, W = () => AL.World;
const BUF = new Int32Array(256);

// ---- the creatures ---------------------------------------------------------------------------------------------
Object.assign(AL.CREATURE_TYPES, {
  centipede: { name: 'Centipede',      hp: 90,  r: 9,  speed: 30, lunge: 66, sense: 110, bite: 5.5, biteEvery: 0.6, armor: 0.15, latchMax: 12, protein: 40, needed: 4, hostile: true, prey: true, carcass: 'centipede' },
  antlion:   { name: 'Antlion',        hp: 50,  r: 6,  speed: 4,              pit: 22,   bite: 5,   biteEvery: 0.7, armor: 0.3,  latchMax: 6,  protein: 22, needed: 2, hostile: true, prey: true, carcass: 'antlion' },
  assassin:  { name: 'Assassin bug',   hp: 60,  r: 7,  speed: 9,              sense: 60, bite: 9,   biteEvery: 1.4, armor: 0.35, latchMax: 8,  protein: 26, needed: 3, hostile: true, prey: true, carcass: 'assassin' },
  mantis:    { name: 'Praying mantis', hp: 110, r: 11, speed: 10, lunge: 55, sense: 70,  bite: 8,   biteEvery: 0.8, armor: 0.1,  latchMax: 12, protein: 55, needed: 5, hostile: true, prey: true, carcass: 'mantis' },
});
const KINDS = ['centipede', 'antlion', 'assassin', 'mantis'];
const TUNE = AL.HUNTER_TUNE = Object.assign({
  BURN: { centipede: 1 / 420, antlion: 1 / 900, assassin: 1 / 600, mantis: 1 / 480 },   // share of a full belly used per second
  CAP: { centipede: 2, antlion: 3, assassin: 3, mantis: 2 },                             // most of each in the yard (eggs and young count)
  HATCH: { centipede: 120, antlion: 100, assassin: 100, mantis: 150 },                   // seconds until eggs hatch
  FIRST: { antlion: 300, assassin: 420, centipede: 540, mantis: 600 },                   // first one wanders in after this long
  FED: { centipede: 0.85, antlion: 0.95, assassin: 0.9, mantis: 0.8 },                   // above this belly it leaves ants alone
  FLEE: { centipede: [3, 0.7], assassin: [3, 0.7], mantis: [4, 0.6], antlion: [3, 0.6], beetle: [4, 0.45] },   // [attackers, hp share] at which it gives up a fight
  STALK_T: 12,             // seconds a hunter keeps after one ant before giving up (x2 when starving)
  PIT_PULL: [25, 40, 20],  // how fast an ant slides down a pit (px/s): at the rim, + more the deeper it is, + more when the antlion is starving
                           // (an ant walks ~34 px/s: one at the rim can scramble out, one halfway down can't)
  MIN_MOUND: 220,          // no hunter settles this close to an ant mound
}, AL.HUNTER_TUNE || {});
// teach the ecosystem about them (hunger, caps, hatching)
const ECO = EC().TUNE;
Object.assign(ECO.BURN, TUNE.BURN); Object.assign(ECO.CAP, TUNE.CAP); Object.assign(ECO.HATCH, TUNE.HATCH);
for (const k of KINDS) { EC().HOOKS.kinds[k] = true; EC().CAPKEY[k] = k; }
if (AL.NIGHT_MODS) AL.NIGHT_MODS.centipede = AL.NIGHT_MODS.centipede || { speed: 1.2, dps: 1.3, vis: 1.5 };   // a night hunter

// ---- shared ant hunting ------------------------------------------------------------------------------------------
// how hungry: 0 full .. 1 empty (the hunger meter, turned round)
const drive = cr => AL.clamp(1 - cr.food, 0, 1);
const graceT = world => (WC().TUNE_GRACE != null ? WC().TUNE_GRACE : WC().SPIDER_GRACE);
// may it hunt ants now? not in a young colony's first minutes, not when it has just eaten
function huntsAnts(world, cr) {
  if (world.env.truce) return false;
  if (world.t < graceT(world) && !(world.opts && world.opts.campaign)) return false;
  return cr.food < (TUNE.FED[cr.type] != null ? TUNE.FED[cr.type] : 0.6);
}
// the nearest surface ant within range of (x, y) walking with at most crowdMax others close by (-1: none). Ambushers
// (any) take ants on the move whatever they're doing; chasers only ants out walking on their own.
function nearestAnt(world, x, y, range, crowdMax, any) {
  const A = world.ants, n = W().antsIn(world, x, y, range, BUF);
  let best = -1, bd = range * range + 1;
  for (let k = 0; k < n; k++) {
    const i = BUF[k], st = A.state[i], ca = A.caste[i];
    if (ca === CA.QUEEN || ca === CA.WINGED) continue;
    if (st !== ST.WANDER && st !== ST.RETURN && st !== ST.HOMING && st !== ST.COLLECT && !(any && (st === ST.RECRUIT || st === ST.GUARD || st === ST.RALLY))) continue;
    const dd = (A.x[i] - x) * (A.x[i] - x) + (A.y[i] - y) * (A.y[i] - y);
    if (dd < bd) { bd = dd; best = i; }
  }
  if (best < 0) return -1;
  // a crowd round the ant keeps the hunter off (BUF is reused here: the loop above is done with it)
  const crowd = W().antsIn(world, A.x[best], A.y[best], 40, BUF);
  return crowd <= crowdMax + 1 ? best : -1;
}
const fleeing = cr => { const f = TUNE.FLEE[cr.type] || [4, 0.45]; return cr.attackers >= f[0] && cr.hp < cr.maxHp * f[1]; };
function target(cr, i, world) { cr.victim = i; cr.victimUid = world.ants.uid[i]; cr.state = 'stalk'; cr.st = TUNE.STALK_T * (1 + drive(cr)); }
// stalk -> grab -> bite -> feed, for any hunter (spiders have their own). spd: walking pace, lunge: the last dash,
// mul: bite multiplier (night), done: the state to go back to
function antAttack(world, cr, dt, spd, lunge, mul, done) {
  const A = world.ants, d = cr.def, w = WC(), slow = w.slowOf(cr), sc = cr.scale || 1;
  if (cr.state === 'stalk') {
    const i = cr.victim;
    cr.st -= dt;
    if (!w.antValid(A, i, cr.victimUid) || cr.st <= 0 || A.state[i] === w.GRAPPLE) { cr.victim = -1; cr.state = done; return; }
    const dd = Math.sqrt(AL.sq(A.x[i] - cr.x) + AL.sq(A.y[i] - cr.y));
    if (spd > 0) w.steer(world, cr, A.x[i], A.y[i], (dd < 40 ? lunge : spd) * slow, dt);
    if (dd < cr.r + 7) { w.grab(world, cr, i); cr.state = 'bite'; cr.biteT = 0.25; }
    w.fightBack(world, cr, dt, mul);
    return;
  }
  if (cr.state === 'bite') {
    const i = cr.victim;
    // (held in its grip, or biting back at it: core combat turns a grabbed ant into a fighter)
    const held = w.antValid(A, i, cr.victimUid) && ((A.state[i] === w.GRAPPLE && A.tgt[i] === cr.slot) || (A.state[i] === ST.FIGHT && A.tuid[i] === cr.id));
    if (!held) {
      cr.victim = -1;
      if (cr.attackers > 0) { w.fightBack(world, cr, dt, mul); if (fleeing(cr)) cr.state = 'flee'; return; }
      cr.state = done; return;
    }
    cr.biteT -= dt;
    if (cr.biteT <= 0) {
      cr.biteT = d.biteEvery;
      if (w.bite(world, cr, i, d.bite * (mul || 1) * sc)) {
        cr.victim = -1; cr.state = 'feed'; cr.st = 3 + 3 * (1 - drive(cr));
        cr.food = Math.min(1, cr.food + ECO.FEED.ant); cr.hp = Math.min(cr.maxHp, cr.hp + 8);
        AL.emit(world, 'hunterKill', { kind: cr.type, col: A.col[i], x: cr.x, y: cr.y });
      }
    }
    if (fleeing(cr)) cr.state = 'flee';
    return;
  }
  if (cr.state === 'feed') {
    cr.st -= dt; w.fightBack(world, cr, dt, mul);
    if (cr.st <= 0) cr.state = done;
    if (fleeing(cr)) cr.state = 'flee';
  }
}
// a hungry ground beetle with nothing dead to eat: a lone ant close by (eco.js beetleLook)
function beetleAnts(world, cr) {
  if (!huntsAnts(world, cr) || cr.attackers) return false;
  if (world.env.night < 0.45 && drive(cr) < 0.6) return false;   // by day only a really hungry one (they hunt after dark)
  const dv = drive(cr), i = nearestAnt(world, cr.x, cr.y, 50 + 110 * dv, 1 + Math.round(dv * 3), false);
  if (i < 0) return false;
  target(cr, i, world);
  return true;
}
// walk somewhere in reach of home (not into a blocked cell: steer() slides round)
function wanderPoint(world, cr, rad) {
  const S = world.surface, a = world.R() * TAU, r = rad * (0.3 + world.R() * 0.7);
  cr.tx = AL.clamp(cr.home.x + AL.cos(a) * r, 20, S.W - 20); cr.ty = AL.clamp(cr.home.y + AL.sin(a) * r, 20, S.H - 20);
}
// Centipedes (Chilopoda) keep to cover even when out hunting: they run along the edges of things (logs, stones, the
// leaf litter) rather than across open lawn. Of a few points in reach of home, the one with most cover.
function coverPoint(world, cr, rad) {
  const S = world.surface, T = AL.Terrain;
  let best = null, bv = -1;
  for (let k = 0; k < 6; k++) {
    wanderPoint(world, cr, rad);
    const x = cr.tx, y = cr.ty;
    if (AL.Surface.isBlocked(S, x, y)) continue;
    let v = world.R() * 0.5;
    if (T && S.terrain) { const t = T.at(S, x, y); if (t === T.T.LITTER) v += 2; else if (t === T.T.MUD) v += 0.8; }
    for (let j = 0; j < 4; j++) { const a = j * Math.PI / 2; if (AL.Surface.isBlocked(S, x + AL.cos(a) * 26, y + AL.sin(a) * 26)) { v += 1.2; break; } }   // by a log or a stone
    if (v > bv) { bv = v; best = { x, y }; }
  }
  if (best) { cr.tx = best.x; cr.ty = best.y; } else wanderPoint(world, cr, rad);
}
function goHide(cr) { cr.hidden = true; cr.prey = false; cr.hostile = false; }
function unhide(cr) { cr.hidden = false; cr.prey = true; cr.hostile = true; }
// Ambushers are camouflaged while they wait (an antlion under the sand, a bug or a mantis still as a twig): ants
// walk past without noticing, so they don't swarm it. A strike gives it away for a while, and so does a fight.
function camo(cr, dt) {
  if (cr.attackers > 0 || cr._hits > 0 || cr.victim >= 0) { cr.revealT = Math.max(cr.revealT || 0, 4); }
  cr.revealT = (cr.revealT || 0) - dt;
  const seen = cr.revealT > 0;
  cr.prey = seen; cr.hostile = seen; cr.camo = !seen;
}
function reveal(cr, secs) { cr.revealT = Math.max(cr.revealT || 0, secs); cr.prey = true; cr.hostile = true; cr.camo = false; }

// ---- centipede: a night runner -----------------------------------------------------------------------------------
function centipede(world, cr, dt) {
  const d = cr.def, e = world.env, nm = AL.World.nightMod('centipede', e.night, cr.nm), slow = WC().slowOf(cr);
  const dark = e.night > 0.45, starving = cr.food < 0.2;
  if (e.winter && !cr.hidden && cr.state !== 'return') cr.state = 'return';
  switch (cr.state) {
    case 'idle': case 'hide':
      goHide(cr); cr.state = 'hide';
      if (cr.hp < cr.maxHp && cr.food > 0.2) cr.hp = Math.min(cr.maxHp, cr.hp + 1 * dt);   // (resting heals, unless it's starving)
      if (!e.winter && (dark || starving)) { unhide(cr); cr.state = 'roam'; coverPoint(world, cr, 320); }
      break;
    case 'roam': {
      if (cr.attackers > 0) { WC().fightBack(world, cr, dt, nm.dps); if (fleeing(cr)) cr.state = 'flee'; break; }
      if (!dark && !starving) { cr.state = 'return'; break; }
      if (WC().steer(world, cr, cr.tx, cr.ty, d.speed * 0.6 * nm.speed * slow, dt) < 8 || (cr.wt = (cr.wt || 0) + dt) > 30) { coverPoint(world, cr, 320); cr.wt = 0; }
      if (((world.tick + cr.slot) % 6) === 0 && huntsAnts(world, cr)) {
        const dv = drive(cr), i = nearestAnt(world, cr.x, cr.y, d.sense * nm.vis * (0.6 + dv) * (cr.scale || 1), 2 + Math.round(dv * 4), false);
        if (i >= 0) { target(cr, i, world); AL.emit(world, 'hunterStalk', { kind: 'centipede', col: world.ants.col[i], x: cr.x, y: cr.y }); }
      }
      break;
    }
    case 'stalk': case 'bite': case 'feed':
      antAttack(world, cr, dt, d.speed * nm.speed, d.lunge * nm.speed, nm.dps, 'roam');
      break;
    case 'flee': case 'return':
      WC().fightBack(world, cr, dt, nm.dps);
      if (WC().goHome(world, cr, d.speed * (cr.state === 'flee' ? 1.6 : 0.9) * nm.speed * Math.max(0.5, slow), dt) < 6) { cr.state = 'hide'; goHide(cr); }
      break;
  }
}

// ---- antlion: a pit in the sand ----------------------------------------------------------------------------------
// the pit's radius right now: dug out over the first 20 s, wider when the antlion is hungry
function pitOf(cr) { const full = cr.def.pit * (0.75 + 0.6 * drive(cr)) * (cr.scale || 1); return full * AL.clamp(cr.dug || 0, 0, 1); }
function antlion(world, cr, dt) {
  const A = world.ants, d = cr.def, e = world.env;
  if (e.winter) { if (!cr.hidden) { goHide(cr); cr.state = 'hide'; } return; }
  if (cr.state === 'hide' && cr.st <= 0) { unhide(cr); cr.state = 'dig'; }
  switch (cr.state) {
    case 'idle': case 'dig':
      cr.state = 'dig'; camo(cr, dt); cr.dug = Math.min(1, (cr.dug || 0) + dt / 20); cr.anim += dt * 3;
      if (cr.dug >= 1) { cr.state = 'wait'; cr.st = 0; }
      break;
    case 'wait': {
      cr.st += dt; camo(cr, dt);
      if (fleeing(cr)) { goHide(cr); cr.state = 'hide'; cr.st = 15; break; }   // it burrows under the sand
      WC().fightBack(world, cr, dt);
      if (cr.hp < cr.maxHp && cr.attackers === 0 && cr.food > 0.2) cr.hp = Math.min(cr.maxHp, cr.hp + 0.4 * dt);
      if (!huntsAnts(world, cr)) break;
      // ants on the pit's slope slide down toward the jaws (they can climb out if they're quick)
      const pr = pitOf(cr), dv = drive(cr), PP = TUNE.PIT_PULL;
      const n = W().antsIn(world, cr.x, cr.y, pr, BUF);
      let caught = -1;
      for (let k = 0; k < n; k++) {
        const i = BUF[k], st = A.state[i];
        if (A.caste[i] === CA.QUEEN || A.caste[i] === CA.WINGED || st === WC().GRAPPLE || st === ST.FIGHT || st === ST.DRAG) continue;
        const dx = cr.x - A.x[i], dy = cr.y - A.y[i], dd = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dd < cr.r + 4) { if (caught < 0) caught = i; continue; }
        const deep = 1 - dd / pr, m = Math.min((PP[0] + PP[1] * deep + PP[2] * dv) * dt, dd - cr.r - 2); A.x[i] += dx / dd * m; A.y[i] += dy / dd * m;
      }
      if (caught >= 0 && cr.victim < 0) { cr.victim = caught; cr.victimUid = A.uid[caught]; WC().grab(world, cr, caught); cr.state = 'bite'; cr.biteT = 0.2; cr.st = 0; reveal(cr, 10); }
      // a long hungry wait: move the pit somewhere busier
      if (cr.st > 240 && cr.food < 0.3) { const p = sandSpot(world, cr.x, cr.y, 200); if (p) { cr.tx = p.x; cr.ty = p.y; cr.state = 'move'; cr.dug = 0; } else cr.st = 0; }
      break;
    }
    case 'bite': case 'feed':
      antAttack(world, cr, dt, 0, 0, 1, 'wait');
      if (cr.state === 'flee') { goHide(cr); cr.state = 'hide'; cr.st = 15; }
      break;
    case 'move':
      if (WC().steer(world, cr, cr.tx, cr.ty, d.speed, dt) < 3) { cr.home = { x: cr.x, y: cr.y }; cr.state = 'dig'; }
      break;
    case 'hide':
      cr.st -= dt; if (cr.hp < cr.maxHp && cr.food > 0.2) cr.hp = Math.min(cr.maxHp, cr.hp + 1.5 * dt);
      break;
  }
}

// ---- assassin bug: waits by a trail -------------------------------------------------------------------------------
// a spot near home with the strongest ant trail scent (any colony's), away from the mounds
function trailSpot(world, x, y, rad) {
  const S = world.surface, F = world.pher && world.pher.food, R = world.R;
  let best = null, bv = -1;
  for (let k = 0; k < 10; k++) {
    const a = R() * TAU, r = rad * Math.sqrt(R()), px = AL.clamp(x + AL.cos(a) * r, 30, S.W - 30), py = AL.clamp(y + AL.sin(a) * r, 30, S.H - 30);
    if (AL.Surface.isBlocked(S, px, py) || nearMound(world, px, py, 150)) continue;
    let v = 0; if (F) for (const g of F) v += g.sample(px, py);
    if (v > bv) { bv = v; best = { x: px, y: py }; }
  }
  return best;
}
function assassin(world, cr, dt) {
  const A = world.ants, d = cr.def, e = world.env, slow = WC().slowOf(cr);
  if (e.winter) { if (!cr.hidden) { goHide(cr); cr.state = 'hide'; } return; }
  if (cr.state === 'hide') { unhide(cr); cr.state = 'idle'; }
  switch (cr.state) {
    case 'idle': case 'pick': {
      const p = trailSpot(world, cr.x, cr.y, 220);
      if (p) { cr.tx = p.x; cr.ty = p.y; } else wanderPoint(world, cr, 150);
      cr.state = 'walk';
      break;
    }
    case 'walk':
      reveal(cr, 0.5); WC().fightBack(world, cr, dt);
      if (WC().steer(world, cr, cr.tx, cr.ty, d.speed * slow, dt) < 4) { cr.state = 'wait'; cr.st = 0; }
      break;
    case 'wait': {
      cr.st += dt; camo(cr, dt); WC().fightBack(world, cr, dt);
      if (fleeing(cr)) { cr.state = 'flee'; reveal(cr, 3); break; }
      if (cr.st > 70 && cr.attackers === 0) { cr.home = { x: cr.x, y: cr.y }; cr.state = 'pick'; break; }   // nobody comes by: somewhere busier
      if (((world.tick + cr.slot) % 4) !== 0 || !huntsAnts(world, cr) || cr.attackers > 1) break;
      const dv = drive(cr), i = nearestAnt(world, cr.x, cr.y, cr.r + 8 + 12 * dv, 3 + Math.round(dv * 3), true);
      if (i >= 0) { cr.victim = i; cr.victimUid = A.uid[i]; WC().grab(world, cr, i); cr.state = 'bite'; cr.biteT = 0.15; cr.st = 0; reveal(cr, 10); break; }   // the stab
      if (dv > 0.6) {   // a hungry one creeps up on an ant
        const j = nearestAnt(world, cr.x, cr.y, 50, 2, true);
        if (j >= 0) { target(cr, j, world); cr.st = 10; reveal(cr, 12); }
      }
      break;
    }
    case 'stalk': case 'bite': case 'feed':
      antAttack(world, cr, dt, d.speed * 1.4, d.speed * 2.4, 1, 'wait');
      break;
    case 'flee':
      if (WC().steer(world, cr, cr.home.x + (cr.x - cr.home.x) * 2 + 80, cr.home.y + 60, d.speed * 2.5 * Math.max(0.5, slow), dt) < 6 || cr.attackers === 0) { cr.home = { x: cr.x, y: cr.y }; cr.state = 'pick'; }
      break;
  }
}

// ---- praying mantis: on a plant ----
// mobbed: she opens her wings and flies to another plant (the ants holding on drop off). A mantis is a poor flier:
// a short, low hop to the nearest other plant, never across the yard.
function flyOff(world, cr) {
  const ps = WC().plantsFor(world).filter(p => p !== cr.plant && AL.sq(p.x - cr.x) + AL.sq(p.y - cr.y) < 420 * 420 && AL.sq(p.x - cr.x) + AL.sq(p.y - cr.y) > 120 * 120);
  ps.sort((a, b) => (AL.sq(a.x - cr.x) + AL.sq(a.y - cr.y)) - (AL.sq(b.x - cr.x) + AL.sq(b.y - cr.y))); ps.length = Math.min(ps.length, 2);
  const p = ps.length ? ps[(world.R() * ps.length) | 0] : null;
  cr.plant = p; cr.victim = -1;
  if (p) { cr.tx = p.x + 12; cr.ty = p.y; } else { const a = world.R() * TAU; cr.tx = AL.clamp(cr.x + AL.cos(a) * 160, 30, world.surface.W - 30); cr.ty = AL.clamp(cr.y + AL.sin(a) * 160, 30, world.surface.H - 30); }
  cr.state = 'fly'; cr.flying = true; cr.alt = 0.6; cr.prey = false; cr.hostile = false;
}
// ---- praying mantis: on a plant ----------------------------------------------------------------------------------
const MANTIS_PREY = { ladybug: 1, lblarva: 1, butterfly: 1, caterpillar: 0.5 };
function mantis(world, cr, dt) {
  const A = world.ants, d = cr.def, e = world.env, slow = WC().slowOf(cr);
  if (e.winter) { if (!cr.hidden) { goHide(cr); cr.state = 'hide'; } return; }
  if (cr.state === 'hide') { unhide(cr); cr.state = 'idle'; }
  switch (cr.state) {
    case 'idle': case 'pick': {
      // aphid plants first: that's where the ants come
      const ps = WC().plantsFor(world).filter(p => AL.sq(p.x - cr.x) + AL.sq(p.y - cr.y) < 700 * 700 && p !== cr.plant);
      ps.sort((a, b) => (b.type === 'aphids' ? 1 : 0) - (a.type === 'aphids' ? 1 : 0) || (AL.sq(a.x - cr.x) + AL.sq(a.y - cr.y)) - (AL.sq(b.x - cr.x) + AL.sq(b.y - cr.y)));
      const p = ps.length ? ps[Math.min(ps.length - 1, (world.R() * Math.min(3, ps.length)) | 0)] : null;
      cr.plant = p;
      if (p) { const a = world.R() * TAU; cr.tx = p.x + AL.cos(a) * 12; cr.ty = p.y + AL.sin(a) * 12; } else wanderPoint(world, cr, 200);
      cr.state = 'walk';
      break;
    }
    case 'walk':
      reveal(cr, 0.5); WC().fightBack(world, cr, dt);
      if (WC().steer(world, cr, cr.tx, cr.ty, d.speed * slow, dt) < 5) { cr.state = 'perch'; cr.st = 0; cr.home = { x: cr.x, y: cr.y }; }
      break;
    case 'perch': {
      cr.st += dt; camo(cr, dt); WC().fightBack(world, cr, dt);
      if (fleeing(cr)) { flyOff(world, cr); break; }
      if (((world.tick + cr.slot) % 4) !== 0 || cr.attackers > 1) break;
      const dv = drive(cr), reach = (24 + 22 * dv) * (cr.scale || 1);
      // other insects first (a ladybug on the plant, a butterfly landing, a larva)
      if (cr.food < 0.9) {
        for (const o of world.surface.creatures) {
          if (!o.alive || o === cr || o.flying || o.hidden || !MANTIS_PREY[o.type] || o.attackers > 0) continue;
          if (AL.sq(o.x - cr.x) + AL.sq(o.y - cr.y) > AL.sq(reach + o.r) || world.R() > MANTIS_PREY[o.type]) continue;
          EC().eaten(world, o, 'mantis'); cr.food = Math.min(1, cr.food + ECO.FEED.creature); cr.state = 'feed'; cr.st = 8;
          return;
        }
      }
      if (huntsAnts(world, cr)) {
        const i = nearestAnt(world, cr.x, cr.y, reach, 3 + Math.round(dv * 4), true);
        if (i >= 0) { cr.victim = i; cr.victimUid = A.uid[i]; WC().grab(world, cr, i); cr.state = 'bite'; cr.biteT = 0.1; reveal(cr, 10); break; }   // the strike
      }
      if (cr.st > 180 && cr.food < 0.4) cr.state = 'pick';   // nothing comes to this plant: try another
      break;
    }
    case 'stalk': case 'bite': case 'feed':
      antAttack(world, cr, dt, 0, 0, 1, 'perch');
      if (cr.state === 'flee') flyOff(world, cr);
      break;
    case 'fly':   // a short flight to another plant: out of the ants' reach
      cr.anim += dt * 12;
      if (WC().steer(world, cr, cr.tx, cr.ty, 60, dt, true) < 4) { cr.flying = false; cr.alt = 0; cr.state = 'perch'; cr.st = 0; cr.home = { x: cr.x, y: cr.y }; }
      break;
  }
}

// ---- where they live ----------------------------------------------------------------------------------------------
function nearMound(world, x, y, r) {
  for (const h of world.homes || world.colonies) if (h && !h.gone && h.alive !== false && AL.sq(h.x - x) + AL.sq(h.y - y) < r * r) return true;
  return false;
}
// a sand cell (else gravel) somewhere round (x, y) within rad, away from the mounds (null: none found)
function sandSpot(world, x, y, rad) {
  const S = world.surface, T = AL.Terrain, R = world.R;
  if (!T || !S.terrain) return null;
  let gravel = null;
  for (let k = 0; k < 40; k++) {
    const a = R() * TAU, r = rad * Math.sqrt(R()), px = AL.clamp(x + AL.cos(a) * r, 40, S.W - 40), py = AL.clamp(y + AL.sin(a) * r, 40, S.H - 40);
    if (AL.Surface.isBlocked(S, px, py) || nearMound(world, px, py, TUNE.MIN_MOUND)) continue;
    const t = T.at(S, px, py);
    if (t === T.T.SAND) return { x: px, y: py };
    if (!gravel && t === T.T.GRAVEL) gravel = { x: px, y: py };
  }
  return gravel;
}
// anywhere open, away from the mounds
function openSpot(world) {
  const S = world.surface, R = world.R;
  for (let k = 0; k < 30; k++) {
    const x = 80 + R() * (S.W - 160), y = 80 + R() * (S.H - 160);
    if (!AL.Surface.isBlocked(S, x, y) && !nearMound(world, x, y, TUNE.MIN_MOUND + 80)) return { x, y };
  }
  return null;
}
function placeFor(world, kind) {
  const S = world.surface, R = world.R;
  if (kind === 'antlion') return sandSpot(world, S.W / 2, S.H / 2, Math.max(S.W, S.H) * 0.7);
  if (kind === 'mantis') {
    const ps = WC().plantsFor(world).filter(p => !nearMound(world, p.x, p.y, 120));
    if (!ps.length) return null;
    const p = ps[(R() * ps.length) | 0]; return { x: p.x + 14, y: p.y };
  }
  if (kind === 'centipede') {   // under a log or in the litter
    const homes = (world.poi && world.poi.beetleHomes) || [];
    const ok = homes.filter(h => !nearMound(world, h.x, h.y, TUNE.MIN_MOUND));
    if (ok.length) { const h = ok[(R() * ok.length) | 0]; return { x: h.x + (R() - 0.5) * 30, y: h.y + (R() - 0.5) * 30 }; }
  }
  return openSpot(world);
}
const START = { centipede: 'hide', antlion: 'dig', assassin: 'pick', mantis: 'pick' };
function make(world, kind, x, y, o) {
  const cr = WC().spawn(world, kind, x, y, Object.assign({ state: START[kind], tx: x, ty: y, food: 0.5 }, o || {}));
  if (cr && kind === 'centipede') goHide(cr);
  return cr;
}
// one wanders in: a few minutes into a match the first time, then whenever the kind has died out (eco.js second)
function arrive(world, kind, cs, eco) {
  if (world.opts && (world.opts.campaign || world.opts.hunters === false || world.opts.demo)) return;
  const have = (cs[kind] || 0) + (cs.clutch[kind] || 0);
  const key = 'h_' + kind;
  if (have > 0) { eco.gone[key] = 0; eco.seen = eco.seen || {}; eco.seen[kind] = 1; return; }
  eco.gone[key] = (eco.gone[key] || 0) + 1;
  const wait = eco.seen && eco.seen[kind] ? ECO.IMMIGRATE : TUNE.FIRST[kind];
  if (eco.gone[key] < wait) return;
  const p = placeFor(world, kind);
  if (!p) { eco.gone[key] = wait - 60; return; }   // nowhere for it (a yard without sand): look again in a minute
  const cr = make(world, kind, p.x, p.y, { food: 0.7 });
  if (cr) { eco.gone[key] = 0; eco.seen = eco.seen || {}; eco.seen[kind] = 1; AL.emit(world, 'ecoArrive', { kind, x: p.x, y: p.y }); }
}
// eggs hatch: young hunters, small at first (eco.js grows them up)
function hatch(world, x, y, cl) {
  const kind = cl.hatch, d = AL.CREATURE_TYPES[kind];
  let p = { x, y };
  if (kind === 'antlion') p = sandSpot(world, cl.x, cl.y, 120) || p;
  const cr = make(world, kind, p.x, p.y, { young: true, scale: 0.6, hp: d.hp * 0.5, maxHp: d.hp * 0.5, r: Math.max(4, d.r * 0.7) });
  if (cr && kind === 'mantis' && cl.plant) cr.plant = cl.plant;
}
function breed(world, cr) {
  if (cr.attackers || cr.victim >= 0) return false;
  const ok = cr.type === 'centipede' ? cr.state === 'hide' : cr.type === 'antlion' ? cr.state === 'wait' : cr.type === 'assassin' ? cr.state === 'wait' : cr.state === 'perch';
  if (!ok) return false;
  EC().layClutch(world, cr.type, cr.x + 6, cr.y + 4, cr.type === 'mantis' ? 2 : 1 + ((world.R() * 2) | 0), cr.type === 'mantis' ? { plant: cr.plant } : null);
  AL.emit(world, 'ecoLay', { kind: cr.type, x: cr.x, y: cr.y });
  return true;
}
for (const k of KINDS) {
  EC().HOOKS.hatch[k] = hatch; EC().HOOKS.breed[k] = breed;
  EC().HOOKS.arrive[k] = (world, cs, eco) => arrive(world, k, cs, eco);
}

AL.registerSystem({
  id: 'eco-hunters', order: 12.6,
  enabled(opts) { return opts.world !== false && opts.creatures !== false && opts.eco !== false; },
  init() { const B = WC() && WC().BEHAVE; if (B) { B.centipede = centipede; B.antlion = antlion; B.assassin = assassin; B.mantis = mantis; } },
  // a roaming centipede snaps up springtails and mites in the litter too (like spiders and beetles: eco.js)
  second(world) {
    for (const cr of world.surface.creatures) if (cr.alive && cr.type === 'centipede' && cr.state === 'roam') cr.food = Math.min(1, cr.food + ECO.FEED.litter * 1.5 * (AL.Swarm ? AL.Swarm.preyAt(world, cr.x, cr.y) : 1) * (cr.scale || 1));
  },
});
AL.EcoHunters = { TUNE, KINDS, drive, huntsAnts, nearestAnt, antAttack, beetleAnts, arrive, pitOf, sandSpot, make };
if (NODE) module.exports = AL.EcoHunters;
})(typeof window !== 'undefined' ? window : globalThis);
