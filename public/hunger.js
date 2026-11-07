// Per-ant hunger for people's colonies (c.isPlayer with a detailed nest). AI rivals keep their colony-level upkeep (ai.js).
// Every ant has a stomach (A.gut, 0 empty .. 1 full) that empties at the rate its caste and species eat
// (AL.Colony.casteUpkeep x SUGAR_PER_ANT x appetite, so a full stomach holds FULL_T seconds of that).
// A hungry ant walks to a food store chamber and eats sugar from the colony stock; surface ants come home to eat;
// an ant that can't eat (empty stock, cut off, or AL.Injury.canEat false) starves: past empty it loses hp and dies.
// Nurses (and workers doing nurse work) carry food from the store: sugar to the queens' chamber (a queen lays only
// when fed) and sugar or protein to the nursery, where larvae eat from col.broodFood. Cheap: stomachs update once
// per second in life.js's per-ant loop; a nurse's load is one number per ant (A.load).
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); require('./colony.js'); }
const ST = AL.ST, K = AL.CARRY, C = AL.CASTE, ACT = AL.ACT, L = AL.LAYER, T = AL.TUNE;
const N = AL.Nest, F = N.F, CH = N.CH;

const HG = AL.HUNGER = Object.assign({
  FULL_T: 300,        // seconds a full stomach lasts at the ant's eating rate
  HUNGRY: 0.4,        // a nest ant below this goes to the food store to eat
  HOME: 0.3,          // a surface ant below this heads home to eat
  STARVE_HP: 0.004,   // share of max hp an ant with an empty stomach loses per second (~4 min from full hp)
  QUEEN_FULL_T: 240,  // a queen's stomach (eats QUEEN_SUGAR per second)
  QUEEN_FEED: 0.6,    // nurses bring her food below this
  QUEEN_LAY: 0.15,    // she lays only above this
  LOAD: 8,            // sugar or protein one nurse carries per trip
  BROOD_T: 25,        // seconds of larva food the nurses keep in the nursery (about one larval stage)
  PROT_EAT: 0.5,      // with the sugar gone, an adult eats protein at this worth (2 protein fill what 1 sugar would):
                      // balance runs had colonies starving to death on stores full of protein
  MEAL: 4,            // a hungry ant out on the surface walks home to eat only if the store has this much sugar (else it
                      // forages on and drinks at the sugar it finds: graze); without it a starving colony's ants just
                      // trooped in and out of the hill for crumbs
}, AL.HUNGER || {});
// nest errands (high ids so they stay clear of AL.ACT's own)
ACT.EAT = 30; ACT.FETCHQ = 31; ACT.FETCHB = 32; ACT.FEEDQ = 33; ACT.FEEDB = 34;

// per-ant stomach and nurse load live on the ant store (ants.js sets gut on spawn)
function arrays(A) {
  if (!A.gut || A.gut.length < A.cap) { const g = new Float32Array(A.cap).fill(1); if (A.gut) g.set(A.gut); A.gut = g; }
  if (!A.load || A.load.length < A.cap) { const l = new Float32Array(A.cap); if (A.load) l.set(A.load); A.load = l; }
  return A;
}
// sugar a full stomach holds
function capOf(col, caste) {
  if (caste === C.QUEEN) return T.QUEEN_SUGAR * HG.QUEEN_FULL_T;
  return AL.Colony.casteUpkeep(col.sp, caste) * T.SUGAR_PER_ANT * ((col.sp && col.sp.appetite) || 1) * HG.FULL_T;
}
// the injury module (when present) says whether this ant can eat at all (a headless ant can't)
function canEat(world, i) { return !(AL.Injury && AL.Injury.canEat) || AL.Injury.canEat(world, i) !== false; }
const detailed = col => !!(col && col.nest);
function state(col) { return col.hunger || (col.hunger = { hungry: 0, empty: 0, starved: 0, toQ: 0, toB: 0, larvaS: 0, larvaP: 0 }); }

// eat from the colony stock until full (or the stock runs out); returns the sugar eaten
// what adults can eat in a store: its sugar, and its protein at PROT_EAT once the sugar is gone
const edible = s => (s.sugar || 0) + (s.protein || 0) * HG.PROT_EAT;
function eat(world, i, col) {
  const A = arrays(world.ants);
  col = col || AL.homeOf(world, i);
  if (!canEat(world, i)) return 0;
  const cap = capOf(col, A.caste[i]), s = col.stock, want = (1 - A.gut[i]) * cap;
  let take = Math.min(want, s.sugar);
  if (take > 0) { s.sugar -= take; col._sugAte = (col._sugAte || 0) + take; } else take = 0;
  if (take < want - 1e-6 && s.protein > 0.05) {   // the sugar's gone: protein (worth less)
    const p = Math.min((want - take) / HG.PROT_EAT, s.protein);
    s.protein -= p; take += p * HG.PROT_EAT;
  }
  if (!(take > 0)) return 0;
  A.gut[i] = Math.min(1, A.gut[i] + take / cap);
  return take;
}
const hungry = (world, i) => arrays(world.ants).gut[i] < HG.HUNGRY;
// should this surface ant head home to eat? (behavior.js asks for people's colonies)
function needsToEat(world, i) {
  const A = arrays(world.ants), col = AL.homeOf(world, i);
  return A.gut[i] < HG.HOME && edible(col.stock) >= HG.MEAL && canEat(world, i);
}
// a hungry ant picking up sugar out on the surface (honeydew, nectar, fruit) drinks its fill there first
// (behavior.js pickup); returns the sugar it drank
function graze(world, i, f) {
  const A = arrays(world.ants);
  if (A.gut[i] >= HG.HUNGRY || !canEat(world, i) || !(f.amount > 1)) return 0;
  const col = AL.homeOf(world, i); if (!col || !col.nest) return 0;
  const cap = capOf(col, A.caste[i]), take = Math.min((1 - A.gut[i]) * cap, f.amount - 1);
  if (!(take > 0)) return 0;
  f.amount -= take; A.gut[i] = Math.min(1, A.gut[i] + take / cap);
  return take;
}

// ---- nest errands -----------------------------------------------------------------------
function goTo(world, i, f, act) { AL.Life.goTo(world, i, f, act); }
// life.js decide() asks first: hand back a nurse load it was carrying, and send a hungry ant to eat (a wounded one
// lies up first unless it is nearly empty). true = handled
function decide(world, i, col, wounded) {
  const A = arrays(world.ants);
  if (A.load[i] > 0) returnLoad(world, i, col);
  if (A.gut[i] < HG.HUNGRY * (wounded ? 0.5 : 1) && edible(col.stock) > 0.05 && canEat(world, i)) { goTo(world, i, F.FOOD, ACT.EAT); return true; }
  return false;
}
function returnLoad(world, i, col) {
  const A = world.ants, k = A.carry[i];
  if (k === K.SUGAR) col.stock.sugar += A.load[i]; else if (k === K.PROTEIN) col.stock.protein += A.load[i];
  A.load[i] = 0; if (k === K.SUGAR || k === K.PROTEIN) A.carry[i] = 0;
}
// queens alive in the chamber: the main one and any extra laying queens
function eachQueen(world, col, fn) {
  const A = world.ants, q = col.queen;
  if (q && q.alive && q.i >= 0 && A.state[q.i] && A.caste[q.i] === C.QUEEN) fn(q.i);
  if (col.queens2) for (const x of col.queens2) if (A.state[x.i] && A.uid[x.i] === x.uid) fn(x.i);
}
// how much food the nursery wants: BROOD_T seconds of what its larvae eat (a little at least)
function broodWant(col, kind) { const h = state(col), r = kind === K.PROTEIN ? h.larvaP : h.larvaS; return r > 0 ? Math.max(2, r * HG.BROOD_T) : 0; }
// what the queens are short of
function queenWant(world, col) { const A = world.ants, cap = capOf(col, C.QUEEN); let w = 0; eachQueen(world, col, q => { w += (1 - A.gut[q]) * cap; }); return w; }
// does the nursery need more than the nurses already on their way bring?
function broodShort(col) {
  const bf = col.broodFood, s = col.stock;
  const ds = s.sugar >= 0.5 ? Math.max(0, broodWant(col, K.SUGAR) - bf.sugar) : 0;
  const dp = s.protein >= 0.5 ? Math.max(0, broodWant(col, K.PROTEIN) - bf.protein) : 0;
  return ds + dp > state(col).toB * HG.LOAD * 0.5;
}
// what a nurse at the store takes for the nursery: the kind it holds least of (for what its larvae eat), 0 = nothing needed
function broodPick(col) {
  const bf = col.broodFood, s = col.stock, ws = broodWant(col, K.SUGAR), wp = broodWant(col, K.PROTEIN);
  const rs = s.sugar >= 0.5 && ws > 0 && bf.sugar < ws ? bf.sugar / ws : 9, rp = s.protein >= 0.5 && wp > 0 && bf.protein < wp ? bf.protein / wp : 9;
  return rs === 9 && rp === 9 ? 0 : rp <= rs ? K.PROTEIN : K.SUGAR;
}
function queenHungry(world, col) {
  if (col.stock.sugar < 0.5) return false;
  const A = world.ants; let n = 0;
  eachQueen(world, col, q => { if (A.gut[q] < HG.QUEEN_FEED) n++; });
  return n > state(col).toQ;
}
// is there feeding to do? (worker task weights)
function feedNeed(world, col) { arrays(world.ants); if (!col.broodFood) return false; return queenHungry(world, col) || broodShort(col); }
// a nurse (or a worker doing nurse work) takes a feeding run if one is needed: true = assigned
function feedJob(world, i, col) {
  arrays(world.ants);
  if (!col.broodFood) return false;
  const h = state(col);
  if (queenHungry(world, col)) { h.toQ++; goTo(world, i, F.FOOD, ACT.FETCHQ); return true; }
  if (broodShort(col)) { h.toB++; goTo(world, i, F.FOOD, ACT.FETCHB); return true; }
  return false;
}
// arrived (life.js arrive) at the end of one of the hunger errands; true = handled
function arrive(world, i, col) {
  const A = arrays(world.ants), act = A.act[i], R = world.R;
  if (act === ACT.EAT) { eat(world, i, col); AL.Life.idle(world, i, 1.5 + R() * 1.5); return true; }
  if (act === ACT.FETCHQ || act === ACT.FETCHB) {
    if (A.gut[i] < 0.8) eat(world, i, col);   // a bite for itself while at the store
    const s = col.stock;
    const kind = act === ACT.FETCHQ ? K.SUGAR : broodPick(col);
    const have = kind === K.PROTEIN ? s.protein : kind === K.SUGAR ? s.sugar : 0;
    // a full load at most, and no more than is wanted (the rest stays in the store for everyone)
    const want = act === ACT.FETCHQ ? queenWant(world, col) : broodWant(col, kind) - (kind === K.PROTEIN ? col.broodFood.protein : col.broodFood.sugar);
    const amt = Math.min(HG.LOAD, have, Math.max(1, want + 0.5));
    if (!(amt > 0.05)) { AL.Life.idle(world, i, 1 + R()); return true; }
    if (kind === K.SUGAR) s.sugar -= amt; else s.protein -= amt;   // (counted as eaten when the queen or larvae eat it)
    A.carry[i] = kind; A.load[i] = amt;
    if (act === ACT.FETCHQ) goTo(world, i, F.QUEEN, ACT.FEEDQ);
    else goTo(world, i, col.nest.tiles[CH.NURSERY].length ? F.NURSERY : F.QUEEN, ACT.FEEDB);
    return true;
  }
  if (act === ACT.FEEDQ) {
    // the hungriest queen first, the rest to the next one; whatever is left goes to the brood
    let left = A.load[i];
    while (left > 0.01) {
      let best = -1; eachQueen(world, col, q => { if (A.gut[q] < 0.999 && (best < 0 || A.gut[q] < A.gut[best])) best = q; });
      if (best < 0) break;
      const cap = capOf(col, C.QUEEN), m = Math.min(left, (1 - A.gut[best]) * cap);
      A.gut[best] += m / cap; left -= m;
    }
    if (left > 0.01) col.broodFood.sugar += left;
    A.load[i] = 0; A.carry[i] = 0;
    AL.Life.idle(world, i, 2 + R() * 2);
    return true;
  }
  if (act === ACT.FEEDB) {
    if (A.carry[i] === K.PROTEIN) col.broodFood.protein += A.load[i]; else col.broodFood.sugar += A.load[i];
    A.load[i] = 0; A.carry[i] = 0;
    A.state[i] = ST.N_WORK; A.timer[i] = 3 + R() * 4;   // and tends the brood a moment
    return true;
  }
  return false;
}
const isErrand = act => act >= ACT.EAT && act <= ACT.FEEDB;

// ---- once per second (life.js secondNestCore) --------------------------------------------
function secondStart(world, col) {
  arrays(world.ants);
  const h = state(col);
  h.hungry = 0; h.empty = 0; h.toQ = 0; h.toB = 0; h._qHungry = 0;
  if (!col.broodFood) col.broodFood = { sugar: 0, protein: 0 };
}
// one ant of this colony, once per second; returns true if it died
function secondAnt(world, col, i, winterK) {
  const A = world.ants, G = A.gut, h = col.hunger, caste = A.caste[i];
  if (caste === C.QUEEN) {
    if (G[i] > 0) col._sugUse = (col._sugUse || 0) + T.QUEEN_SUGAR * winterK;   // what she eats, for the HUD's sugar flow
    G[i] = Math.max(0, G[i] - winterK / HG.QUEEN_FULL_T);
    if (G[i] < HG.QUEEN_FEED) h._qHungry++;
    return false;   // an unfed queen stops laying (she isn't starved to death by her nurses)
  }
  const st = A.state[i], act = A.act[i];
  if (st === ST.N_GOTO) { if (act === ACT.FETCHQ || act === ACT.FEEDQ) h.toQ++; else if (act === ACT.FETCHB || act === ACT.FEEDB) h.toB++; }
  let g = G[i] - winterK / HG.FULL_T;
  // standing in a food store (a hanging replete, an ant passing through): it eats right there
  if (g < HG.HUNGRY && A.layer[i] === L.NEST && A.nest[i] === col.hid && st !== ST.FIGHT && col.nest.chamber[N.tileOf(col.nest, A.x[i], A.y[i])] === CH.FOOD) {
    G[i] = Math.max(0, g); eat(world, i, col); g = G[i];
  }
  // out on the surface and nearly empty, with food at home: whatever it is doing (a long fight with a beetle,
  // a guard post, a recruit path), it breaks off and goes home to eat
  if (g < HG.HOME * 0.5 && A.layer[i] === L.SURFACE && edible(col.stock) >= HG.MEAL && canEat(world, i)) {
    if (st === ST.FIGHT || st === ST.DRAG) { if (g <= 0.05 && AL.Combat.flee && !(world.praids && world.praids.length && AL.Raids.raiding(world, i))) AL.Combat.flee(world, i); }   // (a player's raiders don't turn back: raids.js)
    else if (st === ST.WANDER || st === ST.GUARD || st === ST.RALLY || st === ST.RECRUIT || st === ST.COLLECT) { A.state[i] = ST.HOMING; A.timer[i] = 0; }
  }
  if (g < HG.HUNGRY) h.hungry++;
  if (g <= 0) {
    G[i] = 0; h.empty++;
    if (AL.Combat.hitAnt(world, i, A.maxhp[i] * HG.STARVE_HP, 'starve')) { h.starved++; return true; }
    return false;
  }
  G[i] = g;
  return false;
}
// after the ant loop: the colony starves when the store is empty and ants go hungry
function secondEnd(world, col) {
  const h = col.hunger, s = col.stock;
  const starving = edible(s) < 0.5 && (h.hungry > 0 || h._qHungry > 0);
  if (starving !== !!col.starving) AL.emit(world, starving ? 'starving' : 'fed', { col: col.id });
  col.starving = starving;
}
// is this queen fed enough to lay?
function queenFed(world, i) { const A = arrays(world.ants); return i < 0 || !A.state[i] || A.gut[i] > HG.QUEEN_LAY; }

AL.Hunger = { HG, edible, arrays, capOf, canEat, eat, graze, hungry, needsToEat, decide, feedJob, feedNeed, arrive, isErrand, returnLoad,
  secondStart, secondAnt, secondEnd, queenFed, broodWant, detailed, state };
if (NODE) module.exports = AL.Hunger;
})(typeof window !== 'undefined' ? window : globalThis);
