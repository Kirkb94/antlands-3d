// Combat: ants grapple and bite, and numbers win locally. How a fight goes:
//  - An ant in reach of an enemy grapples it; the target bites back unless it is running away. Jumping an
//    ant that is busy with someone else (or caught off guard) stuns it for a moment (then a short immunity).
//  - Every ant holding a target adds its grip. A target held by several enemies is pinned and bites much
//    less (workers hold the legs while others bite), so three workers really can take down a soldier; big
//    ants take more holding, and only so many jaws fit round one body (crowded-out attackers wait).
//  - Swarms drag big ants down: on an ant of a much bigger species every extra grip lets the others bite
//    harder (GANG), a newcomer's grab stuns an ant already held down in full (PILE), a held ant loses legs
//    faster (injury.js PULL), and a fight's alarm counts a big enemy by its bulk (BULK_MAX). So a bullet ant
//    wins one on one and in even fights, and a group of them loses to fire ants three or four times their number.
//  - An ant grabbed on its way to its target turns on whoever holds it. Soldiers and majors go for enemy
//    soldiers first; surplus attackers intercept free enemies still coming in. After a kill the next scan
//    looks further for another enemy before the ant goes back to what it was doing.
//  - Bites are summed over the tick and applied together in post(), so slot order gives no side an edge.
//  - Fighters lay alarm pheromone. Every fight is tracked as a battle (world.cb.battles): its alarm pulls
//    nearby nestmates in (soldiers from further away), a battle or a raid party near a detailed nest calls
//    the nest out, and raiders only get in once the defenders standing on the mound are down (doorOpen).
//  - Workers that smell a stronger enemy group away from home and off alarm scent run home; badly hurt ants
//    that aren't pinned retreat when they are losing. Wounded ants out of a fight walk home to heal (ST.HEAL,
//    tuning in data.js AL.HEAL; life.js rests and heals them, ai.js pools rivals' wounds), and alarms leave
//    them alone unless their own mound is raided.
//  - Species traits: data.js AL.SPECIES[k].fight (pin, stun, pierce, armor, vsBig, swarm, nerve, castes).
// Stats come from one place, Combat.stat(col, caste): caste x species x col.mods (research hooks in there).
// Ants vs creatures too (World stage creatures plug in via world.surface.creatures). Deterministic: world.R().
// Bites can cost legs or heads (injury.js, AL.INJURY): applyBites rolls with the biggest jaws that bit an ant.
// Events: 'fight' {x,y,cols,n,battle} (3/s per battle, audio), 'battle' {id,x,y,start|end}, 'losingFight',
// 'nestDefends'; ai.js adds 'siegeBroken', 'siegeRepelled', 'raidRepelled'. Visuals: combat-fx.js.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./life.js'); require('./injury.js'); }
const ST = AL.ST, C = AL.CASTE, K = AL.CARRY, L = AL.LAYER;
const Combat = AL.Combat = AL.Combat || {};

// ---- tuning (one place) ------------------------------------------------------------------------
const CT = AL.COMBAT_TUNE = Object.assign({
  PIN: 0.45,          // a target held with total grip g bites at 1 / (1 + PIN * (g - 1))
  STUN: 0.35,         // seconds a fresh grapple stuns the target (x attacker/target size, x species stun)
  STUN_IMMUNE: 1.6,   // seconds after a stun before the next one can land
  PILE: 1,            // held with at least this grip x its size, a target is stunned in full by any newcomer
  SPREAD: 3.2,        // grip on a target above which extra attackers look for a free enemy instead
  ROOM: 4,            // most grip that fits round one body (x its size): crowded-out attackers wait for a gap
  GANG: 0.6,          // ganging up on a bigger species: bites x 1 + GANG x big^2 x the others' grip on it, where big =
                      // (its caste size / ours) x (its species size / ours - GANG_FROM)
  GANG_FROM: 1.15,    // ... from this size ratio up (carpenters, 1.25, barely feel it)
  GANG_MAX: 2,        // ... at most this much extra
  BULK_MAX: 3,        // a fight's alarm counts a big enemy as up to this many of our own ants (by size squared)
  LOSE: 46,           // a fighter loses its target beyond this distance
  PURSUE: 40,         // after a kill: look this far for the next enemy (fighting castes; others 26)
  REACH_ORDER: 32,    // engage radius of soldiers/majors on guard, rallying or raiding (others 20)
  REACH_IDLE: 18,     // ... going about their business (others 10)
  FLEE_ODDS: 1.6,     // a worker flees when enemies near it outnumber friends by this (and by 2+)
  BRAVE_ALARM: 0.9,   // own alarm scent at least this strong: workers fight instead of fleeing
  HOME_R: 160,        // within moundR + this of home, workers defend instead of fleeing
  RETREAT: [0.35, 0.2, 0.12],   // hp fraction where workers / soldiers / majors give up a losing fight
  FLEE_T: 6,          // seconds a fleeing ant ignores fights (unless it gets caught)
  BATTLE_CELL: 128,   // battle bookkeeping grid
  PULL_R: 110,        // alarm reach of a small fight; grows with the fight (cap PULL_R + 130)
  PULL_MAX: 10,       // nestmates one battle pulls in per pass (3 passes a second)
  DOOR_R: 300,        // a battle this close to a detailed nest's door calls workers out of the nest
  WATCH_R: 420,       // ... and so does a raid party coming within this of it
  NEST_HOME: 1.25,    // bites of a nest's owners inside their own tunnels
  NEST_AWAY: 0.85,    // ... and of raiders in there
  QUEEN_DPS: 10,      // the queen bites a raider in her chamber (one at a time: the first on her, till it's dead)
  QUEEN_TOUGH: 1.5,   // ... and is hard to hurt (damage divided by this)
}, AL.COMBAT_TUNE || {});
const HL = AL.HEAL;
const IJ = AL.Injury;
const LOCAL = 201;    // A.task marker: an ant answering a nearby fight's alarm (orders.js rallyHandler)
Combat.LOCAL = LOCAL;

// ---- stats: caste x species x colony mods (research) --------------------------------------------
// col.mods (optional, set by research): { dps, hp, castes: { soldier: { dps, hp }, ... } }  (keys or caste ids)
//   dps multiplies bites; hp multiplies toughness (damage taken is divided by it, so an upgrade also helps
//   ants already alive). Call Combat.refresh(col) after changing col.mods (it also refreshes every second).
// species: sp.dps / sp.hp (hp is applied when ants are born) and sp.fight traits:
//   pin    grip strength (how hard its ants pin what they hold)   stun   grapple stun multiplier
//   pierce share of the target's toughness/armour ignored          armor  share of damage its ants shrug off
//   vsBig  damage multiplier on creatures                          swarm  bonus per extra nestmate on one target
//   nerve  multiplies the retreat threshold (0 = never retreats)  castes { soldier: { dps, hp } } species twist per caste
const FIGHT0 = { pin: 1, stun: 1, pierce: 0, armor: 0, vsBig: 1, swarm: 0, nerve: 1 };
const GRIP = AL.CASTES.map(c => c.key === 'major' ? 1.6 : c.key === 'soldier' ? 1.4 : c.key === 'queen' ? 0 : 1);
function build(col) {
  const sp = col.sp || {}, f = Object.assign({}, FIGHT0, sp.fight || {}), m = col.mods || {};
  const out = [];
  for (let k = 0; k < AL.NCASTE; k++) {
    const c = AL.CASTES[k], cm = (m.castes && (m.castes[c.key] || m.castes[k])) || {}, sc = (f.castes && f.castes[c.key]) || {};
    // research (research.js) keeps per-caste arrays in col.mods.dps / col.mods.hp and applies hp to the ants
    // itself, so here only its dps counts; plain numbers (tests, scripted mods) still work as global multipliers
    const num = v => typeof v === 'number' ? v : 1;
    const rdps = AL.Research && AL.Research.dpsMul && m.dps && typeof m.dps !== 'number' ? AL.Research.dpsMul(col, k) : num(m.dps);
    const dps = c.dps * (sp.dps || 1) * rdps * (cm.dps || 1) * (sc.dps || 1);
    const tough = num(m.hp) * (cm.hp || 1) * (sc.hp || 1) / (1 - Math.min(0.8, f.armor || 0)) * (k === C.QUEEN ? CT.QUEEN_TOUGH : 1);
    const hp = c.hp * (sp.hp || 1);
    out.push({ dps, hp, tough, grip: GRIP[k] * f.pin, size: c.size * (sp.size || 1), body: sp.size || 1, stun: f.stun, pierce: f.pierce, vsBig: f.vsBig, swarm: f.swarm, nerve: f.nerve,
      power: dps * hp * tough,   // fighting value of one ant (square law: an army is worth n^2 x power)
      jaw: IJ ? IJ.jawOf(col, k) : 1, head: IJ ? IJ.headOf(col, k) : 0 });   // how it maims (injury.js)
  }
  col._cs = out; col._csMods = col.mods; return out;
}
const statsOf = col => (col._cs && col._csMods === col.mods) ? col._cs : build(col);
Combat.stat = (col, caste) => statsOf(col)[caste];
Combat.refresh = col => build(col);
Combat.maxHp = (col, caste) => statsOf(col)[caste].hp;          // hit points an ant of this caste is born with
Combat.power = (col, caste) => statsOf(col)[caste].power;
const aggressive = caste => caste === C.SOLDIER || caste === C.MAJOR;

// ---- per-ant combat memory (kept on the ant store, sized lazily; uid-checked where it lasts) ----------
function mem(A) {
  if (!A.cbHold || A.cbHold.length < A.cap) {
    A.cbHold = new Float32Array(A.cap);   // grip on this ant during the current tick
    A.cbHeld = new Float32Array(A.cap);   // ... during the last tick (what pins it now)
    A.cbStun = new Float32Array(A.cap);   // seconds of stun left
    A.cbFlee = new Float32Array(A.cap);   // world time until which it is running away
    A.cbUid = new Int32Array(A.cap);      // whose stun/flee these are (slots get reused)
    A.cbDmg = new Float32Array(A.cap);    // bites landed on it this tick (applied together after everyone moved)
    A.cbBy = new Uint8Array(A.cap);       // colony that bit it last (gets the kill)
    A.cbLost = new Float32Array(A.cap);   // when it last lost its target (looks further for the next one)
    A.cbStunT = new Float32Array(A.cap);  // when it was last stunned
    A.cbBy2 = new Int32Array(A.cap).fill(-1); A.cbByU = new Int32Array(A.cap);   // an enemy holding it (slot + uid)
    A.cbJaw = new Float32Array(A.cap); A.cbHead = new Float32Array(A.cap);   // biggest jaws that bit it this tick (injury.js)
    A.cbList = new Int32Array(A.cap); A.cbN = 0;
  }
  return A;
}
// bites are summed during the tick and applied in post(), so neither colony gains from being updated first
// (s: the biter's stats, for its jaws)
function queueBite(A, i, t, dmg, s) {
  if (A.cbDmg[t] === 0 && A.cbN < A.cbList.length) A.cbList[A.cbN++] = t;
  A.cbDmg[t] += dmg; A.cbBy[t] = A.col[i];
  if (s.jaw > A.cbJaw[t]) A.cbJaw[t] = s.jaw;
  if (s.head > A.cbHead[t]) A.cbHead[t] = s.head;
}
function applyBites(world) {
  const A = world.ants, L_ = A.cbList, n = A.cbN;
  A.cbN = 0;
  for (let k = 0; k < n; k++) {
    const t = L_[k], d = A.cbDmg[t], jaw = A.cbJaw[t], head = A.cbHead[t]; A.cbDmg[t] = 0; A.cbJaw[t] = 0; A.cbHead[t] = 0;
    if (d > 0 && A.state[t] && Combat.hitAnt(world, t, d, 'fight')) { const c = world.colonies[A.cbBy[t]]; if (c) c.stats.kills++; }
    else if (d > 0 && A.state[t] && IJ) IJ.bite(world, t, d, jaw, head, A.cbHeld[t] / statsOf(world.colonies[A.col[t]])[A.caste[t]].size);   // survived: maybe lost a leg or its head
  }
}
const fleeing = (world, A, i) => A.cbUid[i] === A.uid[i] && A.cbFlee[i] > world.t;
function stunned(A, i, dt) {
  if (A.cbUid[i] !== A.uid[i] || A.cbStun[i] <= 0) return false;
  A.cbStun[i] -= dt; return true;
}
function own(A, i) { if (A.cbUid[i] !== A.uid[i]) { A.cbUid[i] = A.uid[i]; A.cbStun[i] = 0; A.cbFlee[i] = 0; A.cbLost[i] = -99; A.cbStunT[i] = -99; } }

// engage radius by caste and state; 0 = won't start a fight
function reach(A, i, world) {
  const st = A.state[i], caste = A.caste[i];
  if (caste === C.QUEEN || caste === C.HONEYPOT || A.headless[i]) return 0;   // (headless: blind, can't fight)
  if (st === ST.DRAG || st === ST.HEAL) return 0;   // (a wounded ant going home still bites back when jumped)
  if (world && A.cbFlee && fleeing(world, A, i)) return 0;
  const ag = aggressive(caste);
  if (st === ST.RAID || st === ST.RALLY || st === ST.GUARD || st === ST.RECRUIT || st === ST.B_SWARM) return ag ? CT.REACH_ORDER : CT.REACH_ORDER * 0.62;   // (B_SWARM: an army swarm raid, swarm.js)
  if (A.carry[i] && !ag) return 0;          // laden foragers keep walking
  return ag ? CT.REACH_IDLE : CT.REACH_IDLE * 0.56;
}
// damage i deals to ant t this tick
function biteDmg(world, i, t, dt) {
  const A = world.ants, ci = world.colonies[A.col[i]], ct = world.colonies[A.col[t]];
  const s = statsOf(ci)[A.caste[i]], ts = statsOf(ct)[A.caste[t]];
  let d = s.dps * dt;
  // pinned: held by several enemies, it can hardly bite back (big ants take more holding down)
  const g = A.cbHeld[i] / s.size; if (g > 1.05) d /= 1 + CT.PIN * (g - 1);
  const h = A.cbHeld[t];
  // ganging up on a bigger species: while others hold it, each extra grip on it lets this one bite somewhere soft.
  // Grows with the square of how much bigger its species is (nothing between equals, little on carpenters, a lot on
  // bullet ants), x the caste size ratio (their soldiers feel it more); within a species castes keep their worth.
  const big = (ts.size / ts.body) / (s.size / s.body) * (ts.body / s.body - CT.GANG_FROM);
  if (big > 0.01 && h > s.grip && A.caste[t] !== C.QUEEN) d *= 1 + Math.min(CT.GANG_MAX, CT.GANG * big * big * (h - s.grip));   // (a queen has her own toughness)
  // swarming species: every extra nestmate on the same target hits a little harder (whatever its size)
  if (s.swarm && h > 1) d *= 1 + Math.min(0.4, s.swarm * (h - 1));
  // in the tunnels the owners know every turn and raiders come at them one or two at a time
  if (A.layer[i] === L.NEST) d *= ci.nest ? CT.NEST_HOME : CT.NEST_AWAY;
  // a defensible founding site helps its owners fight at home
  const st = ci.siteTraits;
  if (st && st.defence && (A.layer[i] === L.NEST || AL.dist2(A.x[i], A.y[i], ci.x, ci.y) < 120 * 120)) d *= st.defence;
  return d / (1 + (ts.tough - 1) * (1 - s.pierce));
}

Combat.engage = function (world, i, j, noStun) {
  const A = mem(world.ants);
  if (A.state[i] !== ST.FIGHT) A.prev[i] = A.state[i];
  if (A.state[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  A.state[i] = ST.FIGHT; A.tgt[i] = j; A.tuid[i] = A.uid[j]; A.timer[i] = 0;
  // jumped while already busy with another enemy, or caught off guard: the grapple stuns it for a moment
  // (two ants squaring up grab each other at once, so a plain one-on-one start has no stun)
  const sj = A.state[j];
  if (!noStun && ((sj === ST.FIGHT && A.tgt[j] !== i) || sj === ST.WANDER || sj === ST.RETURN || sj === ST.HOMING || sj === ST.HEAL || sj === ST.DRAG || sj === ST.DUMP || A.layer[j] === L.NEST)) {
    const si = statsOf(world.colonies[A.col[i]])[A.caste[i]], zj = statsOf(world.colonies[A.col[j]])[A.caste[j]].size;
    // a small ant barely rocks a big one, unless others already hold it down: then the new grab lands in full
    let sz = si.size / Math.max(0.5, zj);
    if (A.cbHeld[j] >= zj * CT.PILE) sz = Math.max(sz, 1);
    own(A, j);
    // one stun at a time, then a moment to recover before the next can land (no stun-lock by a crowd)
    if (A.cbStun[j] <= 0 && world.t - A.cbStunT[j] > CT.STUN_IMMUNE) {
      A.cbStun[j] = CT.STUN * si.stun * AL.clamp(sz, 0.5, 2) * (A.caste[j] === C.QUEEN ? 0.2 : 1); A.cbStunT[j] = world.t;
    }
  }
  // the target bites back if it isn't already busy (a fleeing ant keeps running until it is caught)
  if (A.state[j] !== ST.FIGHT && A.caste[j] !== C.HONEYPOT && A.state[j] !== ST.N_QUEEN && !A.headless[j] && !fleeing(world, A, j)) {
    if (A.state[j] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, j);
    A.prev[j] = A.state[j]; A.state[j] = ST.FIGHT; A.tgt[j] = i; A.tuid[j] = A.uid[i]; A.timer[j] = 0;
  }
};
// what a fighter goes back to when its fight is over
function disengage(world, i) {
  const A = world.ants, p = A.prev[i];
  A.tgt[i] = -1;
  if (A.layer[i] === L.NEST) {
    if (!AL.inOwnNest(world, i)) { A.state[i] = ST.N_RAID; return; }   // a raider in someone else's nest
    if (AL.Life) AL.Life.decide(world, i); else A.state[i] = ST.N_IDLE;
    return;
  }
  A.state[i] = (p && p !== ST.FIGHT && p !== ST.DRAG) ? p : (A.carry[i] ? ST.RETURN : ST.WANDER);
  if (A.state[i] === ST.GUARD && A.timer[i] <= 0) A.timer[i] = 8;
}
Combat.disengage = disengage;
// run for home: drop the fight, ignore enemies for a few seconds unless caught
function flee(world, i) {
  const A = mem(world.ants);
  if (A.state[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  A.tgt[i] = -1; own(A, i); A.cbFlee[i] = world.t + CT.FLEE_T;
  if (A.layer[i] === L.NEST) { if (AL.inOwnNest(world, i) && AL.Life) AL.Life.decide(world, i); else A.state[i] = ST.N_RAID; return; }
  A.state[i] = A.carry[i] ? ST.RETURN : ST.HOMING; A.timer[i] = 0;
  const c = AL.homeOf ? AL.homeOf(world, i) : world.colonies[A.col[i]]; A.a[i] = AL.atan2(c.y - A.y[i], c.x - A.x[i]);
}
Combat.flee = flee;
// out of a fight and badly hurt: drop what it is doing and walk home to heal (returns true if it did).
// Carriers finish their delivery first (RETURN goes home anyway), draggers only let go when very badly hurt,
// and a defender near its own mound while it is raided stays put. Fights are combat's: think() retreats.
function goHeal(world, i) {
  const A = world.ants, st = A.state[i], th = AL.Life.healAt(A.caste[i]);
  if (!th || A.headless[i]) return false;   // a headless ant can't find home
  const f = A.hp[i] / A.maxhp[i];
  if (f >= th) return false;
  if (st !== ST.WANDER && st !== ST.HOMING && st !== ST.COLLECT && st !== ST.GUARD && st !== ST.RALLY && st !== ST.RECRUIT && st !== ST.RAID && st !== ST.B_SWARM && st !== ST.AI_SCOUT && !(st === ST.DRAG && f < th * HL.DRAG)) return false;
  if (st === ST.RAID && world.praids && world.praids.length && AL.Raids.raidOf(world, i)) return false;   // a player's raiders don't turn back to heal
  const c = AL.homeOf ? AL.homeOf(world, i) : world.colonies[A.col[i]];   // (the nest it lives in: a satellite's own store)
  if (!c.enter || c.alive === false || !AL.Life.canHeal(c)) return false;   // nowhere to heal (or nothing to heal with)
  if ((st === ST.RALLY || st === ST.GUARD) && AL.Life.homeRaided(world, c)) { const r = c.moundR + CT.HOME_R; if (AL.dist2(A.x[i], A.y[i], c.x, c.y) < r * r) return false; }
  if (st === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  A.state[i] = ST.HEAL; A.timer[i] = 0; A.tgt[i] = -1; A.task[i] = 0; A.str[i] = 0; A.wf[i] = 0;
  return true;
}
Combat.goHeal = goHeal;
// nearest enemy within r of ant i on the surface (prefers soldiers for fighting castes, free targets for all)
function bestEnemy(world, i, r) {
  const A = world.ants, x = A.x[i], y = A.y[i], col = A.col[i], ag = aggressive(A.caste[i]), H = A.cbHeld;
  let best = -1, bv = r * r;
  world.hash.each(x, y, j => {
    if (A.col[j] === col || !A.state[j] || A.layer[j] !== 0) return false;
    const dx = A.x[j] - x, dy = A.y[j] - y; let v = dx * dx + dy * dy;
    if (v >= r * r) return false;
    if (ag && aggressive(A.caste[j])) v *= 0.45;
    if (H[j] > CT.SPREAD) v *= 2.5;
    if (v < bv) { bv = v; best = j; }
    return false;
  });
  return best;
}

// ---- alarm hotspots (call the soldiers out of a nest) -----------------------------------------------
function raiseAlarm(world, col, x, y) {
  // a hotspot near home calls the soldiers out (rate limited per colony)
  const c = world.colonies[col];
  if (!c.hotspots) c.hotspots = [];
  const lastHot = world.lastHot || (world.lastHot = []);   // (per world)
  if (lastHot[col] && world.t - lastHot[col] < 1.5) return;
  const home = AL.dist2(c.x, c.y, x, y) < 650 * 650;
  if (!home && !c.isPlayer) return;
  for (const h of c.hotspots) if (AL.dist2(h.x, h.y, x, y) < 90 * 90) { h.t = world.t; h.n = (h.n || 1) + 1; lastHot[col] = world.t; return; }
  if (home) { c.hotspots.push({ x, y, t: world.t, life: 25, auto: true, hid: c.hid }); lastHot[col] = world.t; AL.emit(world, 'fight', { x, y, cols: [col] }); }
}
Combat.raiseAlarm = raiseAlarm;

// ---- battles: fights grouped on a coarse grid (alarm pull, door call, minimap, sound, the losing toast) ----
function cbWorld(world) {
  if (world.cb) return world.cb;
  const S = world.surface, gw = Math.ceil(S.W / CT.BATTLE_CELL), gh = Math.ceil(S.H / CT.BATTLE_CELL), NC = world.colonies.length;
  world.cb = { gw, gh, NC, n: new Float32Array(gw * gh * NC), m: new Float32Array(gw * gh * NC), sx: new Float32Array(gw * gh), sy: new Float32Array(gw * gh), sn: new Float32Array(gw * gh),
    touched: [], mark: new Uint8Array(gw * gh), battles: [], nextId: 1, ticks: 0 };
  return world.cb;
}
// how much of a fighter there is (size squared, 1 = a worker of a size-1 species): big enemies ring a bigger alarm
const bulkOf = (world, i) => { const z = statsOf(world.colonies[world.ants.col[i]])[world.ants.caste[i]].size; return z * z; };
function note(world, i, w) {
  const cb = world.cb || cbWorld(world), A = world.ants;
  const cx = (A.x[i] / CT.BATTLE_CELL) | 0, cy = (A.y[i] / CT.BATTLE_CELL) | 0;
  if (cx < 0 || cy < 0 || cx >= cb.gw || cy >= cb.gh) return;
  const c = cy * cb.gw + cx;
  if (!cb.mark[c]) { cb.mark[c] = 1; cb.touched.push(c); }
  cb.n[c * cb.NC + A.col[i]] += w; cb.m[c * cb.NC + A.col[i]] += w * bulkOf(world, i); cb.sx[c] += A.x[i] * w; cb.sy[c] += A.y[i] * w; cb.sn[c] += w;
}
const BUF = new Int32Array(8192);
function battlePass(world) {
  const cb = world.cb || cbWorld(world), NC = cb.NC, ticks = Math.max(1, cb.ticks), t = world.t;
  cb.ticks = 0;
  // cells -> fresh clusters
  const found = [];
  for (const c of cb.touched) {
    let sides = 0; for (let k = 0; k < NC; k++) if (cb.n[c * NC + k] > 0) sides++;
    if (sides >= 2 && cb.sn[c] > 0) {
      const x = cb.sx[c] / cb.sn[c], y = cb.sy[c] / cb.sn[c];
      let f = null; for (const q of found) if (AL.dist2(q.x, q.y, x, y) < 170 * 170) { f = q; break; }
      if (!f) { f = { x: 0, y: 0, w: 0, n: new Float32Array(NC), m: new Float32Array(NC) }; found.push(f); }
      f.x = (f.x * f.w + x * cb.sn[c]) / (f.w + cb.sn[c]); f.y = (f.y * f.w + y * cb.sn[c]) / (f.w + cb.sn[c]); f.w += cb.sn[c];
      for (let k = 0; k < NC; k++) { f.n[k] += cb.n[c * NC + k] / ticks; f.m[k] += cb.m[c * NC + k] / ticks; }
    }
    for (let k = 0; k < NC; k++) cb.n[c * NC + k] = cb.m[c * NC + k] = 0;
    cb.sx[c] = cb.sy[c] = cb.sn[c] = 0; cb.mark[c] = 0;
  }
  cb.touched.length = 0;
  // match to the running battles
  for (const f of found) {
    let b = null, bd = 220 * 220;
    for (const q of cb.battles) { const d = AL.dist2(q.x, q.y, f.x, f.y); if (d < bd && q.seen !== t) { bd = d; b = q; } }
    if (!b) { b = { id: cb.nextId++, x: f.x, y: f.y, t0: t, n: new Float32Array(NC), m: new Float32Array(NC), pk: new Float32Array(NC), lost: new Float32Array(NC), peak: 0, losingT: -1e9, pulled: new Float32Array(NC) }; cb.battles.push(b); AL.emit(world, 'battle', { id: b.id, x: b.x, y: b.y, start: true }); }
    b.x += (f.x - b.x) * 0.5; b.y += (f.y - b.y) * 0.5; b.seen = t; b.last = t;
    let tot = 0; for (let k = 0; k < NC; k++) { b.n[k] = f.n[k]; b.m[k] = f.m[k]; tot += f.n[k]; b.pk[k] = Math.max(b.pk[k] * 0.98, f.n[k]); }
    b.size = tot; if (tot > b.peak) b.peak = tot;
  }
  for (const b of cb.battles) {
    for (let k = 0; k < NC; k++) { b.lost[k] *= 0.97; b.pulled[k] *= 0.93; }   // ~10 s memory of losses, ~5 s of calls
    if (b.seen !== t) for (let k = 0; k < NC; k++) { b.n[k] *= 0.6; b.m[k] *= 0.6; }
  }
  cb.battles = cb.battles.filter(b => {
    if (t - b.last < 3) return true;
    AL.emit(world, 'battle', { id: b.id, x: b.x, y: b.y, end: true, lost: b.lost }); return false;
  });
  for (const b of cb.battles) if (b.seen === t) {
    const cols = []; for (let k = 0; k < NC; k++) if (b.n[k] > 0.3) cols.push(k);
    AL.emit(world, 'fight', { x: b.x, y: b.y, cols, n: b.size, battle: b.id });
    callIn(world, b);
    if (b.n[0] > 0.3 || b.lost[0] > 0.5) losing(world, b);
  }
}
// alarm: nearby nestmates of each side come to the fight (soldiers from further, workers if it's winnable or home).
// Enemies are counted in ants of our own build: a bullet ant fighting fire ants calls ~3 fire ants' worth of help.
function callIn(world, b) {
  const A = world.ants, NC = world.cb.NC, hash = world.hash, R = world.R;
  for (let k = 0; k < NC; k++) {
    const mine = b.n[k]; if (mine <= 0.3) continue;
    let heads = 0, bulk = 0; for (let o = 0; o < NC; o++) if (o !== k) { heads += b.n[o]; bulk += b.m[o]; }
    const foes = Math.max(heads, Math.min(heads * CT.BULK_MAX, bulk * mine / Math.max(0.01, b.m[k])));
    const want = Math.ceil(foes * 1.5 + 2 - mine - b.pulled[k]);
    if (want <= 0) continue;
    const c = world.colonies[k], nearHome = AL.dist2(c.x, c.y, b.x, b.y) < 520 * 520;
    const workersToo = nearHome || mine * 2 >= heads;
    const raided = nearHome && AL.Life.homeRaided(world, c);   // the wounded only answer when home itself is attacked
    const r = CT.PULL_R + Math.min(130, 5 * (mine + foes)), rw = r * 0.6;
    let got = 0;
    const cs = hash.cell, x0 = Math.max(0, ((b.x - r) / cs) | 0), x1 = Math.min(hash.w - 1, ((b.x + r) / cs) | 0), y0 = Math.max(0, ((b.y - r) / cs) | 0), y1 = Math.min(hash.h - 1, ((b.y + r) / cs) | 0);
    for (let cy = y0; cy <= y1 && got < want && got < CT.PULL_MAX; cy++) for (let cx = x0; cx <= x1 && got < want && got < CT.PULL_MAX; cx++) {
      const cell = cy * hash.w + cx; if (!hash.cnt[cell * hash.ncol + k]) continue;
      for (let j = hash.head[cell]; j !== -1 && got < want && got < CT.PULL_MAX; j = hash.next[j]) {
        if (A.col[j] !== k || A.layer[j] !== 0 || A.carry[j] || A.headless[j]) continue;
        const st = A.state[j], ca = A.caste[j];
        if (st !== ST.WANDER && st !== ST.HOMING && st !== ST.GUARD && !(st === ST.RALLY && A.task[j] !== LOCAL) && !(st === ST.HEAL && raided)) continue;
        if (st === ST.HOMING && fleeing(world, A, j)) continue;
        const ag = aggressive(ca);
        if (!ag && (!workersToo || ca === C.SCOUT || ca === C.HONEYPOT || ca === C.QUEEN || ca === C.CAPTIVE && !nearHome)) continue;
        const d2 = AL.dist2(A.x[j], A.y[j], b.x, b.y);
        if (d2 > (ag ? r * r : rw * rw)) continue;
        A.state[j] = ST.RALLY; A.task[j] = LOCAL; A.tx[j] = b.x + (R() - 0.5) * 20; A.ty[j] = b.y + (R() - 0.5) * 20; A.timer[j] = 0;
        got++;
      }
    }
    b.pulled[k] += got;
    // the nest pours out: a battle by a detailed nest's door calls workers up from the tunnels
    if (c.nest && AL.Life && AL.Life.exitAs && AL.dist2(c.x, c.y, b.x, b.y) < CT.DOOR_R * CT.DOOR_R && foes > mine) doorCall(world, c, mine * 2 >= heads ? Math.min(8, Math.ceil((foes - mine) / 2)) : 0, b.x, b.y);   // workers only into a fight that can be won
  }
}
// a raid party closing on a detailed nest: the colony smells it coming and turns out at the door
function raidWatch(world) {
  const A = world.ants;
  for (const c of world.colonies) {
    if (!c.nest || c.alive === false || !AL.Life || !AL.Life.exitAs) continue;
    let n = 0, sx = 0, sy = 0; const R2 = CT.WATCH_R * CT.WATCH_R;
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.col[i] === c.id || A.layer[i] !== 0) continue;
      const st = A.state[i];
      if (st !== ST.RAID && !(st === ST.FIGHT && A.prev[i] === ST.RAID) && st !== ST.S_BRAID) continue;
      if (AL.dist2(A.x[i], A.y[i], c.x, c.y) > R2) continue;
      n++; sx += A.x[i]; sy += A.y[i];
    }
    if (n < 3) continue;
    c._raidT = world.t;   // home is raided: the wounded turn out too (life.js homeRaided)
    // hold the ground just out from the door, on the side they come from
    const mx = sx / n, my = sy / n, d = AL.hypot(mx - c.x, my - c.y) || 1, k = Math.min(1, (c.moundR + 30) / d);
    const hx = c.x + (mx - c.x) * k, hy = c.y + (my - c.y) * k;
    doorCall(world, c, 0, hx, hy);   // the soldiers and majors turn out; workers stay in to hold the tunnels
    // the soldiers already out close ranks there (a ring of lone guards would be eaten one by one)
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.col[i] !== c.id || A.layer[i] !== 0 || A.carry[i]) continue;
      const st = A.state[i], ag = A.caste[i] === C.SOLDIER || A.caste[i] === C.MAJOR;
      if (st !== ST.GUARD && st !== ST.WANDER && !((st === ST.HOMING || st === ST.HEAL) && ag)) continue;
      if (!ag) continue;
      if (AL.dist2(A.x[i], A.y[i], c.x, c.y) > 360 * 360) continue;
      A.state[i] = ST.RALLY; A.task[i] = 0; A.tx[i] = hx; A.ty[i] = hy; A.timer[i] = 0;
    }
  }
}
// every soldier and major at home turns out; workers only up to wWant over ~10 s (sending the whole nest
// out in a trickle just feeds it to the raiders, and the tunnels are easier to hold)
function doorCall(world, c, wWant, x, y) {
  const A = world.ants;
  if (!c.hotspots) c.hotspots = [];
  const h = c.hotspots.find(q => q.door && q.hid === c.hid);   // (one list per colony: each nest's door call is its own)
  if (h) { h.x = x; h.y = y; h.t = world.t; } else c.hotspots.unshift({ x, y, t: world.t, life: 20, auto: true, door: true, hid: c.hid });
  c._doorW = (c._doorW || 0) * AL.exp(-(world.t - (c._doorWt || 0)) / 10); c._doorWt = world.t;
  let got = 0;
  const raided = AL.Life.homeRaided(world, c);   // ants lying up wounded only turn out for a raid on the mound
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== c.id || A.layer[i] !== L.NEST || A.carry[i]) continue;
    const ca = A.caste[i], fighter = ca === C.SOLDIER || ca === C.MAJOR;
    if (!fighter && (ca !== C.WORKER && ca !== C.FORAGER || c._doorW >= wWant)) continue;
    const st = A.state[i], resting = st === ST.N_HEAL || (st === ST.N_GOTO && A.act[i] === AL.ACT.HEAL);
    if (resting ? !raided : st !== ST.N_IDLE && st !== ST.N_WORK && !(st === ST.N_GOTO && A.prev[i] !== ST.RALLY && A.act[i] !== AL.ACT.EXIT)) continue;
    AL.Life.exitAs(world, i, ST.RALLY); got++; if (!fighter) c._doorW++;
  }
  if (got && (!c._doorT || world.t - c._doorT > 20)) { c._doorT = world.t; AL.emit(world, 'nestDefends', { col: c.id, n: got, x, y }); }
}
// the player's side is getting beaten and can't win as things stand
function losing(world, b) {
  // (peaks: a lopsided fight is often over before the counts settle)
  const NC = world.cb.NC, mine = b.pk[0];
  let foes = 0, foeLost = 0; for (let o = 1; o < NC; o++) { foes += b.pk[o]; foeLost += b.lost[o]; }
  // trading badly (several of ours for each of theirs) against at least as many: it can't be won as it stands
  if (b.lost[0] < 4 || b.lost[0] < foeLost * 2.5 + 1 || foes < mine * 0.8) return;
  if (world.t - b.losingT < 45 || world.t - (world.cb.losingT || -1e9) < 25) return;
  b.losingT = world.cb.losingT = world.t;
  let by = 1, bv = 0; for (let o = 1; o < NC; o++) if (b.n[o] > bv) { bv = b.n[o]; by = o; }
  const p = world.colonies[0], home = AL.dist2(p.x, p.y, b.x, b.y) < 400 * 400;
  AL.emit(world, 'losingFight', { x: b.x, y: b.y, battle: b.id, lost: Math.round(b.lost[0]), theirs: Math.round(foeLost), mine: Math.round(mine), foes: Math.round(foes), by, home });
}

// ---- the door: a colony's ants standing on their mound hold it (orders.js / ai.js check before a break-in) ----
function doorWatch(world) {
  const cb = world.cb || cbWorld(world), A = world.ants, hash = world.hash, cols = world.colonies;
  if (!cb.door || cb.door.length !== cols.length) cb.door = new Uint16Array(cols.length);
  for (const c of cols) {
    let n = 0;
    if (c.alive !== false) {
      const r = c.moundR * 0.6 + 26, r2 = r * r, cs = hash.cell;
      const x0 = Math.max(0, ((c.x - r) / cs) | 0), x1 = Math.min(hash.w - 1, ((c.x + r) / cs) | 0), y0 = Math.max(0, ((c.y - r) / cs) | 0), y1 = Math.min(hash.h - 1, ((c.y + r) / cs) | 0);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        const cell = cy * hash.w + cx; if (!hash.cnt[cell * hash.ncol + c.id]) continue;
        for (let j = hash.head[cell]; j !== -1; j = hash.next[j]) {
          if (A.col[j] !== c.id || A.layer[j] !== 0 || A.carry[j] || A.caste[j] === C.SCOUT || fleeing(world, A, j)) continue;
          const st = A.state[j]; if (st !== ST.FIGHT && st !== ST.GUARD && st !== ST.RALLY && st !== ST.WANDER) continue;
          if (AL.dist2(A.x[j], A.y[j], c.x, c.y) < r2) n++;
        }
      }
    }
    cb.door[c.id] = Math.min(65535, n);
  }
}
// can an enemy get in at colony c's door right now? (two or more defenders standing on the mound: not yet)
Combat.doorOpen = (world, c) => !world.cb || !world.cb.door || (world.cb.door[c.id] || 0) < 2;

// ---- FIGHT on the surface (handler: returns 1 when it positioned the ant itself) ----
function fightSurface(world, i, dt) {
  const A = world.ants, t = A.tgt[i];
  if (t < 0) return fightCreature(world, i, dt);
  if (!A.targetValid(i) || A.layer[t] !== A.layer[i]) { lost(world, i); return 0; }
  const dx = A.x[t] - A.x[i], dy = A.y[t] - A.y[i], d2 = dx * dx + dy * dy;
  if (d2 > CT.LOSE * CT.LOSE) { lost(world, i); return 0; }
  const close = 4 + 3.2 * (AL.CASTES[A.caste[i]].size + AL.CASTES[A.caste[t]].size);
  if (d2 > close * close) {
    // grabbed on the way: turn on whoever is holding it instead of dragging them along
    const h = A.cbBy2[i];
    if (A.cbHeld[i] > 0.5 && h >= 0 && h !== t && A.state[h] && A.uid[h] === A.cbByU[i] && A.layer[h] === 0 && AL.dist2(A.x[h], A.y[h], A.x[i], A.y[i]) < (close + 4) * (close + 4)) {
      A.tgt[i] = h; A.tuid[i] = A.uid[h]; return 1;
    }
    A.a[i] = AL.atan2(dy, dx); A.turn[i] = 0; world.handlerSpeed = 1.25; return 0;   // close in
  }
  A.a[i] = AL.atan2(dy, dx);
  world.handlerSpeed = 1;
  const col = A.col[i], w = dt / AL.TUNE.DT, ci = world.colonies[col], s = statsOf(ci)[A.caste[i]];
  // only so many jaws fit round one body: crowded out, it circles and waits for a gap (think() finds it another)
  const room = CT.ROOM * statsOf(world.colonies[A.col[t]])[A.caste[t]].size;
  if (A.cbHold[t] >= room * w) { A.turn[i] = 0; world.handlerSpeed = 0.3; A.a[i] += 1.2; return 0; }
  // grapple: hold on (pins the target), a little tussle animation, mark the spot with alarm
  A.cbHold[t] += s.grip * w; A.cbBy2[t] = i; A.cbByU[t] = A.uid[i];
  A.anim[i] += dt * 9; A.a[i] += AL.sin(world.t * 23 + i) * 0.25;
  A.timer[i] += dt;
  // a fleeing ant held by two is caught: it turns and fights
  if (A.cbHeld[t] >= 2 && A.state[t] !== ST.FIGHT && fleeing(world, A, t)) { A.cbFlee[t] = 0; A.prev[t] = A.state[t]; A.state[t] = ST.FIGHT; A.tgt[t] = i; A.tuid[t] = A.uid[i]; A.timer[t] = 0; }
  world.pher.alarm[col].deposit(A.x[i], A.y[i], 0.5 * w);
  if ((i & 7) === (world.tick & 7)) raiseAlarm(world, col, A.x[i], A.y[i]);
  note(world, i, w);
  if (world.R() < dt * 2) world.fxq.push(4, (A.x[i] + A.x[t]) / 2, (A.y[i] + A.y[t]) / 2, 0);
  if (!stunned(A, i, dt)) queueBite(A, i, t, biteDmg(world, i, t, dt), s);
  return 1;
}
// every 1/4 s for each fighter (from tick(), when the spatial hash is complete): give up a hopeless fight,
// or spread out to a free enemy if this one is already well held
function think(world, i) {
  const A = world.ants, t = A.tgt[i];
  if (t < 0 || !A.targetValid(i)) return;
  const s = statsOf(world.colonies[A.col[i]])[A.caste[i]];
  const frac = A.hp[i] / A.maxhp[i], ca = A.caste[i];
  const th = (ca === C.MAJOR ? CT.RETREAT[2] : ca === C.SOLDIER ? CT.RETREAT[1] : CT.RETREAT[0]) * s.nerve;
  // (a pinned ant can't get away; one held by a single enemy can wrench free if it is losing)
  if (frac < th && A.cbHeld[i] < 1.7 && (outnumbered(world, i, 1.3) || A.hp[t] / A.maxhp[t] > frac * 2.5) && !(world.praids && world.praids.length && AL.Raids.raiding(world, i))) { flee(world, i); return; }   // (a player's raiders fight on: raids.js)
  if (A.cbHeld[t] > CT.SPREAD + s.grip) {
    // only to an enemy within a step: running off after a far one costs more bites than it saves
    const j = bestEnemy(world, i, 10 + 3.2 * AL.CASTES[A.caste[i]].size * 2);
    // a free enemy still on its way in gets intercepted (switching between enemies already locked in a fight
    // only wastes bites: the harness showed the side that kept switching lost)
    if (j >= 0 && j !== t && A.cbHeld[j] < 1 && A.state[j] !== ST.FIGHT) Combat.engage(world, i, j, true);
  }
}
// target dead or gone: back to what it was doing, but the next scan looks further for another enemy
function lost(world, i) {
  const A = world.ants;
  disengage(world, i); own(A, i); A.cbLost[i] = world.t;
}
// enemies around ant i outnumber its nestmates by `odds` (3x3 hash block head counts)
function outnumbered(world, i, odds) {
  const A = world.ants, hash = world.hash, c = hash.cellOf(A.x[i], A.y[i]), col = A.col[i];
  const foes = hash.enemiesNear(c, col);
  if (foes < 2) return false;
  let mine = 0; const w = hash.w, nc = hash.ncol, cx = c % w, cy = (c / w) | 0;
  for (let dy = -1; dy <= 1; dy++) { const yy = cy + dy; if (yy < 0 || yy >= hash.h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = cx + dx; if (xx < 0 || xx >= w) continue; mine += hash.cnt[(yy * w + xx) * nc + col]; } }
  return foes >= mine * odds + 1;
}
// a wall (log, rock, stone) on the straight line from an ant toward its target, within gap px
function wallBetween(S, x, y, ux, uy, gap) { for (let t = 3; t <= gap; t += 3) if (AL.Surface.isBlocked(S, x + ux * t, y + uy * t)) return true; return AL.Surface.isBlocked(S, x + ux * gap, y + uy * gap); }
function fightCreature(world, i, dt) {
  const A = world.ants, crs = world.surface.creatures;
  // (looked up by id: A.wp holds a recruit's waypoint, which it goes back to after the fight)
  let cr = null; for (let k = 0; k < crs.length; k++) if (crs[k].id === A.tuid[i]) { cr = crs[k]; break; }
  if (!cr || !cr.alive || cr.hp <= 0 || cr.hidden || cr.flying) { lost(world, i); return 0; }   // (gone under the sand or into the air: out of reach)
  const dx = cr.x - A.x[i], dy = cr.y - A.y[i], d = Math.sqrt(dx * dx + dy * dy);
  if (d > cr.r + 60) { disengage(world, i); return 0; }
  A.a[i] = AL.atan2(dy, dx);
  // close in to bite, unless a log or rock is in the way: then bite from where it stands (a beetle resting against
  // a log used to be out of reach from that side, and the ants walked into the wood for ever)
  if (d > cr.r + 4 && !(d < cr.r + 14 && wallBetween(world.surface, A.x[i], A.y[i], dx / d, dy / d, d - cr.r))) {
    // (and if it can't get to it at all, it gives up after a while instead of pushing at a wall)
    A.timer[i] += dt; if (A.timer[i] > 8) { disengage(world, i); return 0; }
    A.turn[i] = 0; world.handlerSpeed = 1.2; return 0;
  }
  A.timer[i] = 0;
  world.handlerSpeed = 1;
  A.anim[i] += dt * 9;
  cr._hits = (cr._hits || 0) + 1;
  const s = statsOf(world.colonies[A.col[i]])[A.caste[i]];
  cr.hp -= s.dps * s.vsBig * dt * (1 - (cr.armor || 0) * (1 - s.pierce));
  world.pher.alarm[A.col[i]].deposit(A.x[i], A.y[i], 0.3 * dt * 30);
  if (world.R() < dt * 1.5) world.fxq.push(4, A.x[i] + dx / d * 3, A.y[i] + dy / d * 3, 0);
  if (cr.hp <= 0) creatureDied(world, cr, A.col[i]);
  return 1;
}
function creatureDied(world, cr, col) {
  if (!cr.alive) return;
  cr.alive = false; cr.hp = 0;
  if (cr.onDeath) cr.onDeath(world, col);
  else AL.Surface.addFood(world.surface, { kind: K.PROTEIN, x: cr.x, y: cr.y, r: cr.r * 0.8, amount: cr.protein || 30, big: true, needed: cr.needed || 5, visual: cr.carcassVisual || 'beetle', a: cr.a || 0 });
  AL.emit(world, 'creatureDied', { creature: cr, col });
}
Combat.creatureDied = creatureDied;

// ---- the per-tick scan: who starts a fight with whom (and who runs) ----
function tick(world, dt) {
  const A = mem(world.ants), hash = world.hash, n = A.high, tick = world.tick;
  const X = A.x, Y = A.y, ST_ = A.state, LY = A.layer, COL = A.col, HN = hash.next, HH = hash.head, HW = hash.w, HHt = hash.h, H = A.cbHeld;
  const alarm = world.pher.alarm, cols = world.colonies;
  // scan order flips every other tick pair so neither colony always picks its targets first
  const rev = (tick >> 1) & 1, HC = HL.CHECK;
  for (let q = 0; q < n; q++) {
    const i = rev ? n - 1 - q : q;
    const st = ST_[i];
    if (!st || LY[i] !== 0) continue;
    if (st === ST.FIGHT) { if (((i + tick) & 7) === 0) think(world, i); continue; }
    // wounded and out of the fight: home to heal
    if (((i + tick) & HC) === 0 && A.hp[i] < A.maxhp[i] && goHeal(world, i)) continue;
    if ((i + tick) & 1) continue;
    let r = reach(A, i, world);
    if (!r) continue;
    if (A.cbUid[i] === A.uid[i] && world.t - A.cbLost[i] < 1.2) r = Math.max(r, aggressive(A.caste[i]) ? CT.PURSUE : CT.PURSUE * 0.65);
    const c = hash.cellOf(X[i], Y[i]), col = COL[i];
    if (!hash.enemiesNear(c, col)) continue;
    const ag = aggressive(A.caste[i]);
    // workers caught by a stronger group away from home, off alarm scent, run for it (before it is on them)
    if (!ag && st !== ST.RALLY && st !== ST.GUARD && st !== ST.RECRUIT && st !== ST.RAID && st !== ST.B_SWARM) {
      const home = cols[col], hr = home.moundR + CT.HOME_R;
      if (AL.dist2(X[i], Y[i], home.x, home.y) > hr * hr && alarm[col].sample(X[i], Y[i]) < CT.BRAVE_ALARM && outnumbered(world, i, CT.FLEE_ODDS)) { flee(world, i); continue; }
    }
    // nearest enemy within reach (fighting castes prefer enemy soldiers; everyone prefers enemies not yet well held)
    const cx = c % HW, cy = (c / HW) | 0;
    let best = -1, bd = r * r;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = cy + dy; if (yy < 0 || yy >= HHt) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = cx + dx; if (xx < 0 || xx >= HW) continue;
        for (let j = HH[yy * HW + xx]; j !== -1; j = HN[j]) {
          if (COL[j] === col || !ST_[j] || LY[j] !== 0) continue;
          const ex = X[j] - X[i], ey = Y[j] - Y[i];
          let d2 = ex * ex + ey * ey;
          if (d2 >= r * r) continue;
          if (ag && aggressive(A.caste[j])) d2 *= 0.45;
          if (H[j] > CT.SPREAD) d2 *= 2.5;
          if (d2 < bd) { bd = d2; best = j; }
        }
      }
    }
    if (best < 0) continue;
    Combat.engage(world, i, best);
  }
  // who holds each door (raiders only get in once the defenders there are down), every 1/6 s
  if (tick % 5 === 0) doorWatch(world);
  // battles: every 1/3 s
  const cb = world.cb || cbWorld(world);
  cb.ticks++;
  if (tick % 10 === 0) battlePass(world);
  // creatures: nearby ants latch on (soldiers always; anyone if it's prey or it's attacking)
  const crs = world.surface.creatures;
  for (let k = 0; k < crs.length; k++) {
    const cr = crs[k];
    if (!cr.alive || (!cr.prey && !cr.hostile)) continue;
    cr.attackers = cr._hits || 0; cr._hits = 0;
    if ((tick + k) % 3) continue;
    const rr = cr.r + 14;
    const near = BUF, nn = AL.World && AL.World.antsIn ? AL.World.antsIn(world, cr.x, cr.y, rr, near) : -1;
    for (let q = 0, end = nn >= 0 ? nn : n; q < end; q++) {
      const i = nn >= 0 ? near[q] : q;
      if (!ST_[i] || LY[i] !== 0 || ST_[i] === ST.FIGHT) continue;
      const ex = X[i] - cr.x, ey = Y[i] - cr.y;
      if (ex * ex + ey * ey > rr * rr) continue;
      const ag = aggressive(A.caste[i]) || cr.prey || (cr.hostile && cr.attacking);
      if (!ag || !reach(A, i, world)) continue;
      if (ST_[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
      A.prev[i] = ST_[i]; ST_[i] = ST.FIGHT; A.tgt[i] = -1; A.tuid[i] = cr.id; A.timer[i] = 0;
    }
  }
  // nest: raiders vs defenders (few raiders, so a direct scan is cheap)
  if ((tick % 3) === 0) {
    const HOST = A.nest, cols = world.homes || world.colonies;   // nests by id: colonies' own and satellites'
    const bit = [];   // queens that have bitten someone this pass (a queen bites one raider at a time)
    for (let i = 0; i < n; i++) {
      if (!ST_[i] || LY[i] !== L.NEST) continue;
      const hn = HOST[i], pc = cols[hn]; if (!pc || COL[i] === pc.id) continue;   // only raiders: ants inside a nest that isn't theirs
      const home = pc.id, q = pc.queen;
      if (!pc.nest) continue;
      pc._raidT = world.t;   // raiders in the tunnels: the wounded defend too
      // a fight in the nest calls the guards
      if (pc.hotspots && !pc.hotspots.some(h => h.nest && h.hid === pc.hid)) pc.hotspots.push({ x: pc.x, y: pc.y, t: world.t, life: 20, nest: true, auto: true, hid: pc.hid });
      // defenders nearby swarm the raider (numbers win in the tunnels too)
      for (let j = 0; j < n; j++) {
        if (!ST_[j] || LY[j] !== L.NEST || COL[j] !== home || HOST[j] !== hn || ST_[j] === ST.FIGHT || ST_[j] === ST.N_QUEEN || ST_[j] === ST.N_HANG || A.caste[j] === C.HONEYPOT || A.headless[j]) continue;
        const ex = X[j] - X[i], ey = Y[j] - Y[i];
        if (ex * ex + ey * ey < 30 * 30) { A.prev[j] = ST_[j]; ST_[j] = ST.FIGHT; A.tgt[j] = i; A.tuid[j] = A.uid[i]; A.timer[j] = 0; }
      }
      // the queen (or an extra queen of a polygyne colony) bites back at anyone attacking her
      const qt = A.tgt[i];
      if (ST_[i] === ST.FIGHT && q && qt >= 0 && ST_[qt] && A.caste[qt] === C.QUEEN && COL[qt] === home) {
        if (AL.dist2(X[i], Y[i], X[qt], Y[qt]) < 12 * 12 && bit.indexOf(qt) < 0) { bit.push(qt); queueBite(A, qt, i, CT.QUEEN_DPS * (statsOf(pc)[C.QUEEN].dps / AL.CASTES[C.QUEEN].dps) * dt * 3, statsOf(pc)[C.QUEEN]); }
        continue;
      }
      if (ST_[i] === ST.FIGHT || A.headless[i]) continue;
      let best = -1, bd = 12 * 12;
      for (let j = 0; j < n; j++) {
        if (!ST_[j] || LY[j] !== L.NEST || COL[j] !== home || HOST[j] !== hn) continue;
        const ex = X[j] - X[i], ey = Y[j] - Y[i], d2 = ex * ex + ey * ey;
        if (d2 < bd) { bd = d2; best = j; }
      }
      if (best >= 0) Combat.engage(world, i, best);
    }
  }
}
// FIGHT inside the nest
function fightNest(world, i, dt) {
  const A = mem(world.ants), t = A.tgt[i];
  if (!A.targetValid(i) || A.layer[t] !== L.NEST) { disengage(world, i); return; }
  const dx = A.x[t] - A.x[i], dy = A.y[t] - A.y[i], d = Math.sqrt(dx * dx + dy * dy);
  const queen = A.caste[t] === C.QUEEN, close = queen ? 10 : 7;
  if (d > (queen ? 80 : 24)) { disengage(world, i); return; }
  A.a[i] = AL.atan2(dy, dx);
  A.px[i] = A.x[i]; A.py[i] = A.y[i];
  if (d > close) { const s = Math.min(d - close + 1, 14 * dt * (IJ ? IJ.mulOf(A, i) : 1)); A.x[i] += dx / d * s; A.y[i] += dy / d * s; return; }   // (lame ants close in slower)
  A.anim[i] += dt * 9;
  const s = statsOf(world.colonies[A.col[i]])[A.caste[i]];
  A.cbHold[t] += s.grip;
  if (world.R() < dt * 2) world.fxq.push(10, (A.x[i] + A.x[t]) / 2, (A.y[i] + A.y[t]) / 2, 0);
  if (!stunned(A, i, dt)) queueBite(A, i, t, biteDmg(world, i, t, dt), s);
}

// ant deaths in a fight count against that side in the battle there
AL.on('antDied', (world, d) => {
  if (d.cause !== 'fight' || d.layer || !world.cb) return;
  let b = null, bd = 260 * 260;
  for (const q of world.cb.battles) { const v = AL.dist2(q.x, q.y, d.x, d.y); if (v < bd) { bd = v; b = q; } }
  if (b && d.col < b.lost.length) b.lost[d.col] += 1;
});

AL.registerSystem({
  id: 'combat', order: 4,
  init(world) {
    world.surfaceHandlers[ST.FIGHT] = fightSurface;
    world.nestHandlers = world.nestHandlers || {};
    world.nestHandlers[ST.FIGHT] = fightNest;
    world.lastHot = [];
    world.cb = null; cbWorld(world); mem(world.ants);
    for (const c of world.colonies) build(c);
  },
  // grip from the last tick pins its targets during this one
  pre(world) {
    const A = mem(world.ants), n = A.high;
    A.cbHeld.set(A.cbHold.subarray(0, n)); A.cbHold.fill(0, 0, n);
  },
  tick,
  post: applyBites,
  second(world) { for (const c of world.colonies) build(c); raidWatch(world); },   // research may change col.mods in place
});
Combat.reach = (A, i) => reach(A, i, null);
Combat.bestEnemy = bestEnemy;
Combat.TUNE = CT;
if (NODE) module.exports = Combat;
})(typeof window !== 'undefined' ? window : globalThis);
