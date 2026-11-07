// Antlands World stage: neutral creatures on the backyard surface (threats and prey).
// spider (hunts lone ants, big protein if a swarm kills it), ground beetle (tough, slow, bites back),
// ladybug (flies in and eats aphids), caterpillar (slow prey, big payoff; cocoons in autumn),
// robin (telegraphed shadow, dives on exposed ants), termite mound (raidable), aphid herds (escorted).
// Creatures live in world.surface.creatures in the CONTRACT section 7 shape. Until core combat (M3)
// grapples creatures, this module makes ants grapple them itself (ant state AL.ST.W_GRAPPLE = 44).
// Sim only: no DOM.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); require('./world-time.js'); }
const ST = AL.ST, K = AL.CARRY, CA = AL.CASTE, TAU = AL.TAU, PI = Math.PI;
const GRAPPLE = ST.W_GRAPPLE = ST.W_GRAPPLE || 44;
const ESCORT = ST.W_ESCORT = ST.W_ESCORT || 45;
const MAX = 96;

const TYPES = AL.CREATURE_TYPES = Object.assign({
  spider:      { name: 'Wolf spider',   hp: 150, r: 10, speed: 24, lunge: 82, sense: 100, bite: 7,   biteEvery: 0.55, armor: 0,    latchMax: 16, protein: 60, needed: 6, hostile: true, prey: true, night: 'spider', respawn: 160 },
  beetle:      { name: 'Ground beetle', hp: 120, r: 12, speed: 13,             sense: 0,   bite: 4,   biteEvery: 1.1,  armor: 0.5,  latchMax: 14, protein: 45, needed: 5, prey: true, night: 'beetle', respawn: 120 },
  ladybug:     { name: 'Ladybug',       hp: 30,  r: 6,  speed: 14, fly: 75,              bite: 1.2, biteEvery: 1.4,  armor: 0.3,  latchMax: 8,  protein: 8,  needed: 0, prey: true },
  caterpillar: { name: 'Caterpillar',   hp: 70,  r: 9,  speed: 6,                        bite: 2,   biteEvery: 1.6,  armor: 0,    latchMax: 16, protein: 70, needed: 6, prey: true },
  cocoon:      { name: 'Cocoon',        hp: 40,  r: 8,  speed: 0,                        bite: 0,   biteEvery: 9,    armor: 0.2,  latchMax: 10, protein: 28, needed: 2, prey: true },
  termites:    { name: 'Termite mound', hp: 300, r: 34, speed: 0,                        bite: 5,   biteEvery: 0.4,  armor: 0.2,  latchMax: 34, protein: 0,  needed: 0, prey: true, hostile: true, breachFood: 90, breachTime: 150, rebuild: 1.4 },
  bird:        { name: 'Robin',         hp: 1,   r: 0,  speed: 0, kills: 5, strikeR: 30 },
  herd:        { name: 'Aphid herd',    hp: 1,   r: 8,  speed: 9 },
  butterfly:   { name: 'Butterfly',     hp: 1,   r: 0,  speed: 60 },
  // the ecosystem's young (eco.js): spider egg sacs at the lair, ladybug larvae on aphid plants, and hidden clutches
  // (beetle eggs in the soil, ladybug and butterfly eggs on leaves) that hatch on a timer
  eggsac:      { name: 'Spider egg sac', hp: 25, r: 5,  speed: 0,                        bite: 0,   biteEvery: 9,    armor: 0.3,  latchMax: 6,  protein: 10, needed: 0, prey: true },
  lblarva:     { name: 'Ladybug larva', hp: 14,  r: 4,  speed: 6,                        bite: 0.6, biteEvery: 1.6,  armor: 0.1,  latchMax: 5,  protein: 5,  needed: 0, prey: true },
  clutch:      { name: 'Eggs',          hp: 1,   r: 0,  speed: 0 },
}, AL.CREATURE_TYPES || {});
// carcass visual per creature (drawn by world-art.js through AL.Art.foodDrawers)
const CARCASS = { spider: 'spider', beetle: 'beetle', ladybug: 'ladybug', caterpillar: 'caterpillar', cocoon: 'cocoon' };

const BUF = new Int32Array(2048), CNT = new Int16Array(8);
const W = () => AL.World;

// ---- creation / removal -------------------------------------------------------------------------
function spawn(world, type, x, y, o) {
  const C = world.creatures, d = TYPES[type];
  if (!C || !d) return null;
  o = o || {};
  let slot = C.slots.indexOf(null);
  if (slot < 0) { if (C.slots.length >= MAX) return null; slot = C.slots.length; C.slots.push(null); }
  const cr = Object.assign({
    id: C.nextId, serial: C.nextId, slot, type, def: d, name: d.name,
    x, y, px: x, py: y, a: o.a != null ? o.a : world.R() * TAU, r: d.r,
    hp: d.hp, maxHp: d.hp, alive: true, hostile: !!d.hostile, prey: !!d.prey, armor: d.armor || 0, attackers: 0,
    protein: d.protein || 0, needed: d.needed || 0,
    state: 'idle', st: 0, home: { x, y }, tx: x, ty: y, victim: -1, victimUid: 0, biteT: 0, anim: world.R() * 10,
    flying: false, hidden: false, alt: 0, latchAcc: 0, hurtBy: new Float32Array(Math.max(1, world.colonies.length)), nm: {},
    food: 0.7, born: world.t, fedT: 0, scale: 1,   // ecosystem (eco.js): how full it is, when it was born, how long it's been well fed
  }, o);
  C.nextId++;
  bindDeath(cr);
  C.slots[slot] = cr;
  world.surface.creatures.push(cr);
  return cr;
}
function remove(world, cr) {
  const C = world.creatures, L = world.surface.creatures;
  cr.alive = false;
  if (C.slots[cr.slot] === cr) C.slots[cr.slot] = null;
  const k = L.indexOf(cr); if (k >= 0) L.splice(k, 1);
  if (cr.plant && cr.plant.ladybugCr === cr) { cr.plant.ladybugCr = null; cr.plant.ladybug = false; }
}
function topAttacker(cr) { let b = -1, v = 0; for (let k = 0; k < cr.hurtBy.length; k++) if (cr.hurtBy[k] > v) { v = cr.hurtBy[k]; b = k; } return b; }
// called by core combat (AL.Combat.creatureDied, which has already set alive = false) or by our own grapple
// a creature's death hook (a closure per creature; a world snapshot rebuilds it: snap.js)
function bindDeath(cr) { cr.onDeath = (w, col) => onDeath(w, cr, col); return cr; }
function onDeath(world, cr, colArg) {
  if (cr.dead) return;
  const S = world.surface, col = colArg != null ? colArg : topAttacker(cr), own = world.creatures && world.creatures.ownGrapple;
  if (cr.type === 'termites') {
    // the soldiers are beaten: the mound cracks open and its larvae spill out for anyone to carry.
    // It stays on the map but counts as not alive while breached, so fighters let go of it.
    if (cr.state === 'breached') return;
    cr.alive = false; cr.state = 'breached'; cr.st = cr.def.breachTime; cr.prey = cr.hostile = false; cr.attacking = false; cr.hp = 1;
    cr.food = AL.Surface.addFood(S, { kind: K.PROTEIN, x: cr.x, y: cr.y + 4, r: 20, amount: cr.def.breachFood, max: cr.def.breachFood, visual: 'larvae' });
    AL.emit(world, 'termitesBreached', { x: cr.x, y: cr.y, col });
    return;
  }
  cr.dead = true;
  remove(world, cr);
  if (cr.protein > 0) {
    const big = cr.needed > 0;
    AL.Surface.addFood(S, { kind: K.PROTEIN, x: cr.x, y: cr.y, r: big ? cr.r + 3 : 5, amount: cr.protein, max: cr.protein,
      big, needed: cr.needed, visual: CARCASS[cr.type] || cr.def.carcass || 'bug', a: cr.a, carcass: true, decay: 360 });
  }
  if (own) AL.emit(world, 'creatureDied', { kind: cr.type, creature: cr, x: cr.x, y: cr.y, col });   // core combat emits its own
}

// ---- movement -------------------------------------------------------------------------------------
function slowOf(cr) { return Math.max(0, 1 - cr.attackers * 0.1); }
function steer(world, cr, tx, ty, spd, dt, free) {
  const dx = tx - cr.x, dy = ty - cr.y, d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.5 || spd <= 0) return d;
  const want = AL.atan2(dy, dx), turn = AL.wrap(want - cr.a), maxT = (free ? 6 : 3.2) * dt;
  cr.a = AL.wrap(cr.a + AL.clamp(turn, -maxT, maxT));
  const step = Math.min(d, spd * dt), S = world.surface;
  for (let k = 0; k < 5; k++) {
    const a = cr.a + (k === 0 ? 0 : (k & 1 ? 1 : -1) * 0.7 * ((k + 1) >> 1));
    const nx = cr.x + AL.cos(a) * step, ny = cr.y + AL.sin(a) * step;
    if (free || !AL.Surface.isBlocked(S, nx, ny)) { cr.x = AL.clamp(nx, 4, S.W - 4); cr.y = AL.clamp(ny, 4, S.H - 4); if (k) cr.a = a; break; }
  }
  cr.anim += step * 0.25;
  return d - step;
}
const dist2 = (cr, x, y) => (cr.x - x) * (cr.x - x) + (cr.y - y) * (cr.y - y);
function antValid(A, i, uid) { return i >= 0 && A.state[i] && A.uid[i] === uid && A.layer[i] === 0; }

// grab an ant: it is pinned to the creature's side and bites it (released by the handler when it ends)
function grab(world, cr, i) {
  const A = world.ants, st = A.state[i];
  if (st === ST.DRAG) AL.Behavior.releaseDrag(world, i);
  A.prev[i] = (st === ST.RETURN || st === ST.HOMING) ? st : ST.WANDER;
  A.state[i] = GRAPPLE; A.tgt[i] = cr.slot; A.tuid[i] = cr.serial; A.timer[i] = 0;
  A.tx[i] = AL.atan2(A.y[i] - cr.y, A.x[i] - cr.x);
}
function release(A, i) {
  const p = A.prev[i];
  A.state[i] = (p === ST.RETURN || p === ST.HOMING) ? p : ST.WANDER;
  A.tgt[i] = -1; A.timer[i] = 0;
}
// the per-ant surface handler for grappling ants (called from behavior.js updateSurface)
function grappleHandler(world, i, dt) {
  const A = world.ants, C = world.creatures, s = A.tgt[i];
  const cr = C && s >= 0 && s < C.slots.length ? C.slots[s] : null;
  if (!cr || cr.serial !== A.tuid[i] || !cr.alive || cr.hidden || cr.flying || (!cr.prey && cr.victim !== i)) { release(A, i); return 0; }
  const caste = A.caste[i], info = AL.CASTES[caste], sl = A.tx[i], rr = cr.r + 3.5 * info.size;
  A.x[i] = cr.x + AL.cos(sl) * rr; A.y[i] = cr.y + AL.sin(sl) * rr;
  A.a[i] = sl + PI + AL.sin(world.tick * 0.5 + i) * 0.3;
  A.anim[i] += dt * 9;
  cr.latchAcc++;
  if (C.ownGrapple && cr.prey) {
    const c = A.col[i], col = world.colonies[c], m = world.env.mods && world.env.mods[col.spKey];
    const dmg = info.dps * col.sp.dps * (m ? m.dps : 1) * dt * (1 - cr.armor);
    cr.hp -= dmg; if (c < cr.hurtBy.length) cr.hurtBy[c] += dmg;
  }
  return 1;
}

// ants near a prey/hostile creature smell it, swarm and grab on; lone ants run from spiders
// with core combat (M3) the grabbing is core's: we only add the smell pull and the lone-ant flight from spiders
function engage(world, cr) {
  if (!cr.prey || cr.flying || cr.hidden || world.env.truce) return;
  const A = world.ants, d = cr.def, reach = cr.r + 8, own = world.creatures.ownGrapple;
  const smell = cr.r + (cr.type === 'ladybug' ? 56 : cr.type === 'termites' ? 20 : 44);
  const n = W().antsIn(world, cr.x, cr.y, smell, BUF);
  CNT.fill(0);
  for (let k = 0; k < n; k++) { const c = A.col[BUF[k]]; if (c < 8) CNT[c]++; }
  let latched = cr.attackers;
  for (let k = 0; k < n; k++) {
    const i = BUF[k], st = A.state[i], caste = A.caste[i], fighter = caste === CA.SOLDIER || caste === CA.MAJOR;
    // busy ants ignore it; ants carrying food only turn on it if they are soldiers or it is eating their aphids
    if (st !== ST.WANDER && st !== ST.HOMING && !(st === ST.RETURN && (fighter || cr.type === 'ladybug'))) continue;
    if (caste === CA.QUEEN || caste === CA.WINGED) continue;
    const dx = A.x[i] - cr.x, dy = A.y[i] - cr.y, d2 = dx * dx + dy * dy;
    if (cr.hostile && cr.type === 'spider' && !fighter && CNT[A.col[i]] < 4) {
      if (d2 < (cr.r + 34) * (cr.r + 34)) { A.a[i] = AL.atan2(dy, dx); A.state[i] = ST.HOMING; A.timer[i] = 0; }
      continue;
    }
    if (d2 <= reach * reach) { if (own && latched < d.latchMax) { grab(world, cr, i); latched++; } }
    else if (st === ST.WANDER) A.a[i] = AL.atan2(-dy, -dx);
  }
  // a fight calls for help: alarm scent for every colony biting it (soldiers answer alarm)
  if (own && cr.attackers > 0) for (let c = 0; c < world.pher.alarm.length && c < 8; c++) if (CNT[c]) world.pher.alarm[c].deposit(cr.x, cr.y, 0.5);
}
// a creature bites ant i: hp, and maybe a leg or the head (injury.js; spiders' fangs maim most). true = killed
function bite(world, cr, i, dmg) {
  if (W().hurtAnt(world, i, dmg, 'creature')) return true;
  if (AL.Injury && dmg > 0) { const j = AL.Injury.creatureJaw(cr.type); AL.Injury.bite(world, i, dmg, j, j * j); }
  return false;
}
// bite one of the ants grappling it (keeps biting the same one until it drops: readable and deadly)
function biteBack(world, cr, dmg) {
  const A = world.ants, C = world.creatures, f = cr.focus;
  if (f >= 0 && A.state[f] && A.uid[f] === cr.focusUid && A.layer[f] === 0 && ((A.state[f] === GRAPPLE && A.tgt[f] === cr.slot) || (!C.ownGrapple && A.state[f] === ST.FIGHT && A.tuid[f] === cr.id))) {
    bite(world, cr, f, dmg); return f;
  }
  cr.focus = -1;
  const n = W().antsIn(world, cr.x, cr.y, cr.r + 10, BUF);
  let pick = -1, seen = 0;
  for (let k = 0; k < n; k++) {
    const i = BUF[k];
    const mine = (A.state[i] === GRAPPLE && A.tgt[i] === cr.slot) || (!C.ownGrapple && A.state[i] === ST.FIGHT && A.tuid[i] === cr.id);
    if (mine) { seen++; if (world.R() * seen < 1) pick = i; }
  }
  if (pick >= 0) { cr.focus = pick; cr.focusUid = A.uid[pick]; bite(world, cr, pick, dmg); return pick; }
  return -1;
}
function fightBack(world, cr, dt, mul) {
  const d = cr.def;
  if (!d.bite || cr.attackers <= 0) return;
  cr.biteT -= dt;
  if (cr.biteT <= 0) { cr.biteT = d.biteEvery * (0.8 + world.R() * 0.4); biteBack(world, cr, d.bite * (mul || 1)); }
}

// ---- behaviours ----------------------------------------------------------------------------------
const SPIDER_GRACE = 360;   // s
function spider(world, cr, dt) {
  const A = world.ants, d = cr.def, e = world.env, nm = AL.World.nightMod('spider', e.night, cr.nm), slow = slowOf(cr);
  if (e.winter && cr.state !== 'hide') { cr.state = 'return'; cr.wintering = true; }
  switch (cr.state) {
    case 'idle': case 'lurk': {
      cr.state = 'lurk';
      if (cr.hp < cr.maxHp && cr.attackers === 0) cr.hp = Math.min(cr.maxHp, cr.hp + 1.5 * dt);
      if (((world.tick + cr.slot) % 6) === 0) {
        const EC = AL.Eco, hungry = EC && cr.food < EC.TUNE.HUNGRY, drive = EC ? AL.clamp(1 - cr.food, 0, 1) : 0.5;
        if (hungry && EC.spiderHunt(world, cr)) break;   // a hungry spider takes a ladybug or a caterpillar too (eco.js)
        if (EC && cr.food > 0.85) break;   // just fed: she sits in her lair (the hunger meter decides how hard she hunts)
        // young colonies get a quiet start: spiders leave ants alone for the first few minutes (growth pass, Nov 2026)
        if (world.t < (AL.WorldCreatures.TUNE_GRACE != null ? AL.WorldCreatures.TUNE_GRACE : SPIDER_GRACE) && !(world.opts && world.opts.campaign)) break;
        const range = d.sense * nm.vis * (e.night > 0.5 ? 1 : 0.7) * (0.6 + 0.9 * drive) * (cr.scale || 1);   // the hungrier, the further
        const n = W().antsIn(world, cr.home.x, cr.home.y, range, BUF);
        let best = -1, bd = 1e18;
        for (let k = 0; k < n; k++) {
          const i = BUF[k], st = A.state[i];
          if (st !== ST.WANDER && st !== ST.RETURN && st !== ST.HOMING) continue;
          if (A.caste[i] === CA.QUEEN) continue;
          const dd = dist2(cr, A.x[i], A.y[i]); if (dd < bd) { bd = dd; best = i; }
        }
        // only hunts ants walking alone: a crowd keeps it in its lair
        if (best >= 0) {
          const crowd = W().antsIn(world, A.x[best], A.y[best], 40, BUF);
          if (crowd <= 2 + Math.round(drive * 3)) { cr.victim = best; cr.victimUid = A.uid[best]; cr.state = 'stalk'; AL.emit(world, 'spiderHunt', { x: cr.x, y: cr.y, col: A.col[best] }); }   // (the hungrier, the bolder)
        }
      }
      fightBack(world, cr, dt, nm.dps);
      break;
    }
    case 'stalk': {
      const i = cr.victim;
      if (!antValid(A, i, cr.victimUid) || dist2(cr, cr.home.x, cr.home.y) > (d.sense * 2.4) * (d.sense * 2.4)) { cr.state = 'return'; break; }
      const dd = Math.sqrt(dist2(cr, A.x[i], A.y[i]));
      const spd = (dd < 42 ? d.lunge : d.speed) * nm.speed * slow;
      steer(world, cr, A.x[i], A.y[i], spd, dt);
      if (dd < cr.r + 7) { grab(world, cr, i); cr.state = 'bite'; cr.biteT = 0.25; }
      fightBack(world, cr, dt, nm.dps);
      break;
    }
    case 'bite': {
      const i = cr.victim;
      if (!antValid(A, i, cr.victimUid) || A.state[i] !== GRAPPLE || A.tgt[i] !== cr.slot) {
        // victim gone: keep fighting whoever is biting, else head home
        cr.victim = -1; cr.state = cr.attackers > 0 ? 'bite' : 'return';
        if (cr.attackers > 0) { const j = biteBack(world, cr, 0); if (j >= 0) { cr.victim = j; cr.victimUid = A.uid[j]; } else cr.state = 'return'; }
        break;
      }
      cr.biteT -= dt;
      if (cr.biteT <= 0) {
        cr.biteT = d.biteEvery;
        if (bite(world, cr, i, d.bite * nm.dps * (cr.scale || 1))) { cr.victim = -1; cr.state = 'feed'; cr.st = 3.5; cr.hp = Math.min(cr.maxHp, cr.hp + 12); cr.food = Math.min(1, cr.food + (AL.Eco ? AL.Eco.TUNE.FEED.ant : 0)); }
      }
      if (cr.attackers >= 4 && cr.hp < cr.maxHp * 0.45) cr.state = 'flee';
      break;
    }
    case 'feed':
      cr.st -= dt; fightBack(world, cr, dt, nm.dps);
      if (cr.st <= 0) cr.state = 'return';
      if (cr.attackers >= 4 && cr.hp < cr.maxHp * 0.45) cr.state = 'flee';
      break;
    case 'flee': case 'return': {
      const fast = cr.state === 'flee' ? 1.3 : 0.8;
      fightBack(world, cr, dt, nm.dps);
      if (steer(world, cr, cr.home.x, cr.home.y, d.speed * fast * nm.speed * slow, dt) < 4) {
        cr.state = cr.wintering || e.winter ? 'hide' : 'lurk';
        if (cr.state === 'hide') cr.hidden = true;
      }
      break;
    }
    case 'hide':
      cr.hidden = true;
      if (!e.winter) { cr.hidden = false; cr.wintering = false; cr.state = 'lurk'; }
      break;
    case 'hunt':   // after another creature (eco.js)
      if (AL.Eco) AL.Eco.huntTick(world, cr, dt, d.lunge * nm.speed * slow); else cr.state = 'return';
      fightBack(world, cr, dt, nm.dps);
      break;
  }
}

function beetle(world, cr, dt) {
  const d = cr.def, e = world.env, nm = AL.World.nightMod('beetle', e.night, cr.nm);
  if (e.winter && cr.state !== 'hide' && cr.state !== 'burrow') cr.state = 'burrow';
  switch (cr.state) {
    case 'idle': case 'wander': {
      cr.state = 'wander';
      if (cr.attackers > 0) { cr.state = 'defend'; cr.st = 0; break; }
      if (cr.st > 0) { cr.st -= dt; if (cr.st <= 0 && AL.Eco) AL.Eco.beetleLook(world, cr); break; }   // a hungry beetle looks for something dead, or slow
      if (cr.eat && AL.Eco && AL.Eco.beetleEat(world, cr, dt)) break;
      if (steer(world, cr, cr.tx, cr.ty, d.speed * nm.speed, dt) < 6) {
        const a = world.R() * TAU, r = 60 + world.R() * 180;
        cr.tx = AL.clamp(cr.home.x + AL.cos(a) * r, 20, world.surface.W - 20); cr.ty = AL.clamp(cr.home.y + AL.sin(a) * r, 20, world.surface.H - 20);
        cr.st = 1 + world.R() * 3;
      }
      break;
    }
    case 'defend':
      fightBack(world, cr, dt, nm.dps);
      // a big swarm makes it try to plod away, slower the more ants hang on
      if (cr.attackers >= 6) steer(world, cr, cr.home.x, cr.home.y, d.speed * 0.4 * slowOf(cr) + 2, dt);
      if (cr.attackers === 0) { cr.st += dt; if (cr.st > 2) { cr.state = 'wander'; cr.st = 0; } } else cr.st = 0;
      break;
    case 'stalk': case 'bite': case 'feed':   // a hungry beetle after an ant (eco-hunters.js)
      if (AL.EcoHunters) AL.EcoHunters.antAttack(world, cr, dt, d.speed * 1.3 * nm.speed, d.speed * 2.2 * nm.speed, nm.dps, 'wander'); else cr.state = 'wander';
      break;
    case 'hunt':   // after a caterpillar or a cocoon (eco.js)
      if (cr.attackers > 0) { cr.state = 'defend'; cr.st = 0; cr.quarry = null; break; }
      if (AL.Eco) AL.Eco.huntTick(world, cr, dt, d.speed * 1.2 * nm.speed); else cr.state = 'wander';
      break;
    case 'burrow':
      if (steer(world, cr, cr.home.x, cr.home.y, d.speed, dt) < 6) { cr.state = 'hide'; cr.hidden = true; }
      break;
    case 'hide':
      cr.hidden = true;
      if (!e.winter) { cr.hidden = false; cr.state = 'wander'; }
      break;
  }
}

function ladybug(world, cr, dt) {
  const d = cr.def, e = world.env, p = cr.plant, S = world.surface;
  switch (cr.state) {
    case 'idle': case 'flyin': {
      cr.state = 'flyin'; cr.flying = true; cr.prey = false; cr.alt = Math.min(1, cr.alt + dt);
      if (!p || p.gone || e.winter) { cr.state = 'flyoff'; break; }
      if (steer(world, cr, p.x + cr.ox, p.y + cr.oy, d.fly, dt, true) < 3) { cr.state = 'eat'; cr.st = 60; cr.flying = false; cr.prey = true; cr.alt = 0; p.ladybug = true; AL.emit(world, 'ladybug', { x: cr.x, y: cr.y }); }
      break;
    }
    case 'eat':
      cr.st -= dt; cr.biteT2 = (cr.biteT2 || 3) - dt;
      if (cr.biteT2 <= 0 && cr.attackers === 0) { cr.biteT2 = 3; if (p && p.aphids >= 1) { p.aphids = Math.max(0, p.aphids - 1); cr.food = Math.min(1, cr.food + (AL.Eco ? AL.Eco.TUNE.FEED.aphid : 0)); cr.st = Math.max(cr.st, 6); } cr.a += (world.R() - 0.5) * 1.2; }
      fightBack(world, cr, dt);
      if (cr.attackers >= 3 || cr.hp < cr.maxHp * 0.5 || cr.st <= 0 || !p || p.aphids < 2 || e.winter) {   // (st is kept up while she finds aphids)
        cr.state = 'flyoff'; cr.flying = true; cr.prey = false;
        if (p) { p.ladybug = false; if (p.ladybugCr === cr) p.ladybugCr = null; }
        const a = AL.atan2(cr.y - S.H / 2, cr.x - S.W / 2) + (world.R() - 0.5);
        cr.tx = cr.x + AL.cos(a) * 3000; cr.ty = cr.y + AL.sin(a) * 3000;
      }
      break;
    case 'flyoff':
      cr.flying = true; cr.prey = false; cr.alt = Math.min(1, cr.alt + dt);
      if (cr.tx === cr.x && cr.ty === cr.y) { cr.tx = cr.x + 3000; }
      steer(world, cr, cr.tx, cr.ty, d.fly, dt, true);
      if (cr.x <= 5 || cr.y <= 5 || cr.x >= S.W - 5 || cr.y >= S.H - 5) remove(world, cr);
      break;
  }
}

function plantsFor(world) { return world.surface.pois.filter(p => (p.type === 'clover' || p.type === 'aphids') && !p.gone); }
function caterpillar(world, cr, dt) {
  const d = cr.def, e = world.env, c = world.clock;
  // autumn's end (or a winter surprise): spin a cocoon where it stands
  // ... or once it has eaten its fill (eco.js): pupates in any warm season
  const full = AL.Eco && cr.food >= AL.Eco.TUNE.PUPATE_FOOD && world.t - cr.born >= AL.Eco.TUNE.PUPATE_AGE;
  if (e.winter || full || (e.season === 'autumn' && c && c.seasonT > 0.55)) {
    remove(world, cr);
    spawn(world, 'cocoon', cr.x, cr.y, { a: cr.a, state: 'still' });
    if (full) AL.emit(world, 'ecoPupate', { kind: 'caterpillar', x: cr.x, y: cr.y });
    return;
  }
  if (cr.attackers > 0) {
    cr.state = 'thrash'; cr.anim += dt * 6;
    cr.biteT -= dt;
    if (cr.biteT <= 0) {
      cr.biteT = d.biteEvery;
      const j = biteBack(world, cr, d.bite);
      // a hard thrash can fling an ant off
      if (j >= 0 && world.ants.state[j] === GRAPPLE && world.R() < 0.18) {
        const A = world.ants, a = AL.atan2(A.y[j] - cr.y, A.x[j] - cr.x);
        release(A, j); A.x[j] += AL.cos(a) * 14; A.y[j] += AL.sin(a) * 14; A.a[j] = a;
      }
    }
    steer(world, cr, cr.tx, cr.ty, d.speed * 0.3 * slowOf(cr), dt);
    return;
  }
  switch (cr.state) {
    case 'idle': case 'thrash': case 'crawl': {
      cr.state = 'crawl';
      if (!cr.target || cr.target.gone) {
        const ps = plantsFor(world).filter(p => dist2(cr, p.x, p.y) < 700 * 700);
        cr.target = ps.length ? ps[(world.R() * ps.length) | 0] : null;
        if (cr.target) { cr.tx = cr.target.x + (world.R() - 0.5) * 30; cr.ty = cr.target.y + (world.R() - 0.5) * 30; }
        else { cr.tx = cr.x + (world.R() - 0.5) * 300; cr.ty = cr.y + (world.R() - 0.5) * 300; }
      }
      if (steer(world, cr, cr.tx, cr.ty, d.speed, dt) < 6) { cr.state = 'eat'; cr.st = 18 + world.R() * 10; }
      break;
    }
    case 'eat': {
      cr.st -= dt; cr.anim += dt * 0.6;
      const t = cr.target;
      if (t && t.src && t.type === 'clover') { const bite = Math.min(t.src.amount, 0.4 * dt); t.src.amount -= bite; if (bite > 0 && AL.Eco) cr.food = Math.min(1, cr.food + AL.Eco.TUNE.FEED.clover * bite / (0.4 * dt) * dt); }
      if (cr.st <= 0) { cr.target = null; cr.state = 'crawl'; }
      break;
    }
  }
}
function cocoon(world, cr, dt) {
  // spring (or, once old enough, any warm day: eco.js): it splits and a butterfly flutters away
  const ripe = AL.Eco && world.t - cr.born >= AL.Eco.TUNE.COCOON_T;
  if (!world.env.winter && (world.env.season === 'spring' || ripe) && world.R() < dt / 20) {
    remove(world, cr);
    const b = spawn(world, 'butterfly', cr.x, cr.y, { flying: true, prey: false, alt: 0, state: 'fly' });
    if (b) { b.tx = cr.x + (world.R() - 0.5) * 6000; b.ty = cr.y - 3000; }
  }
}
function butterfly(world, cr, dt) {
  cr.alt = Math.min(1, cr.alt + dt * 0.5); cr.anim += dt * 14;
  if (!cr.laid && AL.Eco && AL.Eco.butterflyLay(world, cr, dt)) return;   // first she lays her eggs on clover (eco.js)
  steer(world, cr, cr.tx, cr.ty + AL.sin(cr.anim * 0.2) * 200, cr.def.speed, dt, true);
  const S = world.surface;
  if (cr.x <= 5 || cr.y <= 5 || cr.x >= S.W - 5 || cr.y >= S.H - 5) remove(world, cr);
}
function termites(world, cr, dt) {
  const d = cr.def, e = world.env;
  cr.anim += dt;
  if (cr.state === 'breached') {
    cr.st -= dt;
    if (cr.st <= 0) { cr.state = 'rebuild'; cr.alive = true; cr.hp = 1; cr.prey = cr.hostile = true; if (cr.food) { cr.food.gone = true; world.surface.foodDirty = true; cr.food = null; } }
    return;
  }
  // winter truce: the mound shuts and nobody raids it
  if (e.truce) { cr.prey = cr.hostile = false; cr.hp = Math.min(cr.maxHp, cr.hp + d.rebuild * dt); return; }
  cr.prey = cr.hostile = true;
  if (cr.state === 'rebuild' || cr.state === 'idle') { cr.state = cr.hp >= cr.maxHp ? 'armed' : 'rebuild'; }
  if (cr.attackers === 0 && cr.hp < cr.maxHp) cr.hp = Math.min(cr.maxHp, cr.hp + (cr.state === 'rebuild' ? d.rebuild : 0.3) * dt);
  // soldier termites: they bite faster while the mound is strong
  if (cr.attackers > 0) {
    cr.biteT -= dt;
    if (cr.biteT <= 0) { cr.biteT = d.biteEvery / (0.3 + cr.hp / cr.maxHp); biteBack(world, cr, d.bite); }
  }
}
function herd(world, cr, dt) {
  const A = world.ants, e = world.env;
  cr.anim += dt;
  if (e.winter || dist2(cr, cr.tx, cr.ty) < 18 * 18) {
    if (AL.WorldPOI) AL.WorldPOI.settleAphids(world, cr.x, cr.y, cr.count, cr.col);
    remove(world, cr); AL.emit(world, 'aphidsSettled', { x: cr.x, y: cr.y, col: cr.col, n: cr.count });
    return;
  }
  // aphids only shuffle along while their own ants escort them; idle ants of that colony nearby join in
  if (((world.tick + cr.slot) % 5) === 0) {
    cr.escort = Math.round((cr.escortAcc || 0) / 5); cr.escortAcc = 0;
    if (cr.escort < 4) {
      const n = W().antsIn(world, cr.x, cr.y, cr.recruitR || 60, BUF);
      for (let k = 0; k < n && cr.escort < 4; k++) {
        const i = BUF[k];
        if (A.col[i] !== cr.col || (A.state[i] !== ST.WANDER && A.state[i] !== ST.HOMING) || A.caste[i] === CA.QUEEN) continue;
        A.prev[i] = ST.WANDER; A.state[i] = ESCORT; A.tgt[i] = cr.slot; A.tuid[i] = cr.serial; A.tx[i] = world.R() * TAU; cr.escort++;
      }
    }
  }
  if (cr.escort >= 2) steer(world, cr, cr.tx, cr.ty, cr.def.speed, dt);
}
// escorting ants circle their aphid herd and nudge it along (released when the herd settles)
function escortHandler(world, i, dt) {
  const A = world.ants, C = world.creatures, s = A.tgt[i];
  const cr = C && s >= 0 && s < C.slots.length ? C.slots[s] : null;
  if (!cr || cr.serial !== A.tuid[i] || !cr.alive) { release(A, i); return 0; }
  A.tx[i] += dt * 0.9;
  const sl = A.tx[i], rr = 15 + AL.sin(sl * 2.3 + i) * 3;
  const nx = cr.x + AL.cos(sl) * rr, ny = cr.y + AL.sin(sl) * rr;
  A.a[i] = AL.atan2(ny - A.y[i], nx - A.x[i]);
  A.x[i] = nx; A.y[i] = ny; A.anim[i] += dt * 7;
  cr.escortAcc = (cr.escortAcc || 0) + 1;   // escort-ticks, read every 5 ticks
  return 1;
}
function bird(world, cr, dt) {
  const d = cr.def, C = world.creatures;
  cr.st -= dt;
  if (cr.state === 'circle') {
    const k = Math.max(0, cr.st / 4.5);
    cr.ang += dt * 1.3; const rad = 60 + 130 * k;
    cr.x = cr.tx + AL.cos(cr.ang) * rad; cr.y = cr.ty + AL.sin(cr.ang) * rad * 0.8; cr.alt = 0.6 + 0.4 * k; cr.a = cr.ang + PI / 2;
    if (cr.quarry && cr.quarry.alive) { cr.tx = cr.quarry.x; cr.ty = cr.quarry.y; }   // following a creature
    if (cr.st <= 0) { cr.state = 'dive'; cr.st = 1.6; cr.dx0 = cr.x; cr.dy0 = cr.y; AL.emit(world, 'birdDive', { x: cr.tx, y: cr.ty }); }
  } else if (cr.state === 'dive') {
    const k = AL.easeInOut(1 - Math.max(0, cr.st / 1.6));
    cr.x = AL.lerp(cr.dx0, cr.tx, k); cr.y = AL.lerp(cr.dy0, cr.ty, k); cr.alt = 0.6 * (1 - k);
    cr.a = AL.atan2(cr.ty - cr.dy0, cr.tx - cr.dx0);
    if (cr.st <= 0) {
      // strike: snatches exposed ants; tree canopy and shelters keep them safe
      const A = world.ants, n = W().antsIn(world, cr.tx, cr.ty, d.strikeR, BUF);
      let kills = 0, col = -1;
      for (let j = 0; j < n && kills < d.kills; j++) {
        const i = BUF[j];
        if (A.caste[i] === CA.QUEEN || !W().isExposed(world, A.x[i], A.y[i])) continue;
        col = A.col[i]; W().killAnt(world, i, 'creature', false); kills++;
      }
      if (cr.quarry && cr.quarry.alive && cr.quarry.id === cr.quarryId && AL.Eco) AL.Eco.eaten(world, cr.quarry, 'bird');
      AL.emit(world, 'birdStrike', { x: cr.tx, y: cr.ty, kills, col });
      cr.kills = kills; cr.state = 'leave'; cr.st = 2.2;
    }
  } else if (cr.state === 'leave') {
    cr.alt = Math.min(1, cr.alt + dt * 0.8);
    cr.x += AL.cos(cr.a) * 260 * dt; cr.y += AL.sin(cr.a) * 260 * dt;
    if (cr.st <= 0) { remove(world, cr); C.bird = null; }
  }
}

// ---- bird scheduling: one pass at a time, aimed at the densest exposed cluster, colonies take turns ----
function exposedClusterOf(world, col) {
  const A = world.ants, n = A.high;
  if (!n) return null;
  let best = null, bc = 3;
  const start = (world.R() * n) | 0, stride = 7;
  let looked = 0;
  for (let k = 0; k < n && looked < 40; k++) {
    const i = (start + k * stride) % n;
    if (!A.state[i] || A.layer[i] !== 0 || A.col[i] !== col || !W().isExposed(world, A.x[i], A.y[i])) continue;
    looked++;
    const m = W().antsIn(world, A.x[i], A.y[i], 40, BUF);
    let c = 0; for (let j = 0; j < m; j++) if (W().isExposed(world, A.x[BUF[j]], A.y[BUF[j]])) c++;
    if (c > bc) { bc = c; best = { x: A.x[i], y: A.y[i], n: c }; }
  }
  return best;
}
function trySendBird(world, force) {
  const C = world.creatures, e = world.env, cl = world.clock;
  if (C.bird) return null;
  if (!force && (e.winter || e.rain > 0.2 || e.snow > 0.1 || !cl || cl.daylight < 0.6)) return null;
  const nc = world.colonies.length;
  const prey = AL.Eco && world.R() < AL.Eco.TUNE.BIRD_CREATURE ? AL.Eco.birdPrey(world) : null;   // a robin takes a caterpillar or a spider in the open too
  if (prey) {
    const cr = spawn(world, 'bird', prey.x, prey.y, { state: 'circle', st: 4.5, tx: prey.x, ty: prey.y, ang: world.R() * TAU, alt: 1, prey: false, hostile: false, flying: true, col: -1, quarry: prey, quarryId: prey.id });
    C.bird = cr;
    if (cr) AL.emit(world, 'bird', { x: prey.x, y: prey.y, col: -1, creature: prey.type });
    return cr;
  }
  for (let k = 0; k < nc; k++) {
    const col = (C.birdTurn + k) % nc;
    if (world.colonies[col].alive === false) continue;
    const t = exposedClusterOf(world, col);
    if (!t) continue;
    C.birdTurn = col + 1;
    const cr = spawn(world, 'bird', t.x, t.y, { state: 'circle', st: 4.5, tx: t.x, ty: t.y, ang: world.R() * TAU, alt: 1, prey: false, hostile: false, flying: true, col });
    C.bird = cr;
    if (cr) AL.emit(world, 'bird', { x: t.x, y: t.y, col });
    return cr;
  }
  return null;
}

// ---- spawning (once per second) ------------------------------------------------------------------
function edgePoint(world, near) {
  const S = world.surface, a = AL.atan2(near.y - S.H / 2, near.x - S.W / 2) + (world.R() - 0.5) * 0.8;
  return { x: AL.clamp(S.W / 2 + AL.cos(a) * S.W, 6, S.W - 6), y: AL.clamp(S.H / 2 + AL.sin(a) * S.H, 6, S.H - 6) };
}
function spawner(world) {
  const C = world.creatures, e = world.env, R = world.R, P = world.poi || {};
  const warm = e.season === 'spring' || e.season === 'summer';
  for (const L of C.lairs) {
    if (L.cr && L.cr.alive) continue;
    if (L.used && AL.Eco) continue;   // the ecosystem breeds (or brings in) the next one
    L.t -= 1;
    if (L.t <= 0 && !e.winter) {
      L.used = true;
      L.cr = spawn(world, L.type, L.x, L.y, { state: L.type === 'spider' ? 'lurk' : 'wander', tx: L.x, ty: L.y });
      L.t = TYPES[L.type].respawn || 150;
    }
  }
  if (!e.winter) {
    // ladybugs fly in to aphid plants that are doing well
    for (const p of world.surface.pois) {
      if (p.type !== 'aphids' || p.gone || (p.ladybugCr && p.ladybugCr.alive) || p.aphids < 10) continue;
      if (AL.Eco && !AL.Eco.room(world, 'ladybug')) continue;
      if (R() < (warm ? 1 / 75 : 1 / 150) * (AL.Eco ? 0.5 : 1)) {   // (with the ecosystem, local ladybugs breed: fewer fly in)
        const s = edgePoint(world, p), a = R() * TAU;
        const cr = spawn(world, 'ladybug', s.x, s.y, { state: 'flyin', flying: true, prey: false, alt: 1, plant: p, ox: AL.cos(a) * 14, oy: AL.sin(a) * 14 });
        if (cr) p.ladybugCr = cr;
      }
    }
    // caterpillars hatch on plants in spring and summer, sector by sector
    if (warm) {
      let n = 0; for (const cr of world.surface.creatures) if (cr.type === 'caterpillar') n++;
      if (n < (AL.Eco ? 2 : Math.max(2, world.colonies.length)) && R() < 1 / 40) {   // (with the ecosystem, caterpillars mostly come from butterfly eggs; a few wander in)
        const ps = plantsFor(world);
        if (ps.length) { const p = ps[C.catTurn++ % ps.length]; spawn(world, 'caterpillar', p.x + (R() - 0.5) * 40, p.y + (R() - 0.5) * 40, { state: 'crawl' }); }
      }
    }
  }
  C.birdT -= 1;
  if (C.birdT <= 0) { C.birdT = trySendBird(world) ? 70 + R() * 70 : 20; }
}

// ---- system --------------------------------------------------------------------------------------
const BEHAVE = { spider, beetle, ladybug, caterpillar, cocoon, butterfly, termites, herd, bird };
AL.WorldCreatures = { bindDeath, TYPES, BEHAVE, GRAPPLE, ESCORT, escortHandler, spawn, remove, onDeath, grab, release, grappleHandler, engage, trySendBird, exposedClusterOf, steer, biteBack, fightBack, slowOf, plantsFor, bite, antValid, edgePoint, SPIDER_GRACE };

AL.registerSystem({
  id: 'world-creatures', order: 12,
  enabled(opts) { return opts.world !== false && opts.creatures !== false; },
  init(world, opts) {
    const S = world.surface;
    S.creatures = S.creatures || [];
    // own grapple only when core combat (M3, AL.Combat.creatureDied) is not loaded
    const own = opts.worldGrapple != null ? !!opts.worldGrapple : !(AL.Combat && (AL.Combat.creatureDied || AL.Combat.creatures));
    world.creatures = { slots: [], nextId: 1, ownGrapple: own, lairs: [], bird: null, birdT: 100 + world.R() * 60, birdTurn: (world.R() * world.colonies.length) | 0, catTurn: 0 };
    world.surfaceHandlers[GRAPPLE] = grappleHandler;
    world.surfaceHandlers[ESCORT] = escortHandler;
    const P = world.poi || {};
    for (const l of P.lairs || []) world.creatures.lairs.push({ type: 'spider', x: l.x, y: l.y, t: 0, cr: null });
    for (const b of P.beetleHomes || []) world.creatures.lairs.push({ type: 'beetle', x: b.x, y: b.y, t: 0, cr: null });
    for (const t of P.termites || []) spawn(world, 'termites', t.x, t.y, { state: 'armed', a: 0 });
    spawner(world);
  },
  tick(world, dt) {
    const L = world.surface.creatures, C = world.creatures;
    for (let k = L.length - 1; k >= 0; k--) {
      const cr = L[k];
      if (!cr || (!cr.alive && cr.state !== 'breached')) continue;
      cr.px = cr.x; cr.py = cr.y;
      if (C.ownGrapple) { cr.attackers = cr.latchAcc; cr.latchAcc = 0; if (cr.alive && cr.prey && cr.hp <= 0) { cr.onDeath(world); continue; } }
      const f = BEHAVE[cr.type]; if (f) f(world, cr, dt);
      // core combat engages ants near a hostile creature while it is attacking
      cr.attacking = (cr.hostile && (cr.state === 'stalk' || cr.state === 'bite' || cr.attackers > 0)) || (cr.type === 'beetle' && cr.state === 'defend') || cr.state === 'thrash';
      if (cr.alive && ((world.tick + cr.slot) & 3) === 0) engage(world, cr);
    }
  },
  second(world) { spawner(world); },
});

if (NODE) { module.exports = AL.WorldCreatures; require('./eco.js'); }
})(typeof window !== 'undefined' ? window : globalThis);
