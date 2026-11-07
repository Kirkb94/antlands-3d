// Fight injuries: ants lose legs in fights and, rarely, their heads (tuning: data.js AL.INJURY). Every colony.
// Per ant (ants.js): A.legs, a bitmask of the legs left (bits 0-2 left front/mid/hind, 3-5 right front/mid/hind,
// 63 = all six; reset on spawn) and A.headless. Limbs never grow back: healing restores hp only.
//  - Where: combat.js rolls for every ant bitten in a tick (applyBites, with the biggest jaw that bit it and how
//    hard it is held: a swarm pulls legs off),
//    world-creatures.js for creature bites, expansion.js for tunnel raids (legs only).
//  - Each lost leg costs 20% speed (multiplicative): speedMul = max(0, 1 - 0.2 x lost), so 5 or 6 lost = stuck.
//    behavior.js (surface walking, fights closing in), life.js (nest walking), orders.js / species.js /
//    expansion.js / combat.js (other nest walkers) all apply it; dragging pulls with drag x speedMul.
//  - No legs left on one side (some on the other): the ant turns constantly toward its legs and walks in a
//    tight circle (a steering override in behavior.js, whatever state it is in). It never gets anywhere.
//  - Headless: wanders blindly and slowly (HEADLESS_SPEED, random turns), ignores scent, orders and enemies,
//    can't fight, eat, carry or drag. On the surface it stays in WANDER, in a nest in N_IDLE.
//  - Starvation: per-ant hunger (A.gut, people's colonies) asks canEat(); stuck ants can't reach food anyway.
//    Otherwise (AI rivals, or no per-ant hunger) headless, circling and stuck ants lose hp slowly (cause 'starve',
//    STARVE_T from full hp). Crippled ants lying in their own nest are fed by nestmates; headless ones are not,
//    and nothing heals a headless ant.
//  - Queens: legs can be lost (cosmetic, they don't walk), never the head (QUEEN_HEAD = 0).
//  - Abstract AI nests (ai.js): a lame ant walking in adds its lost legs to a per-caste pool (col.crip) and ants
//    walking out take a share, so rivals keep their cripples roughly. Headless and stuck ants never get home.
// Events: 'antInjured' { col, i, kind: 'leg' | 'head', x, y, layer, lost }.
// Deterministic: world.R() only, and only for ants that were actually bitten.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');
const IJ = AL.INJURY, ST = AL.ST, C = AL.CASTE, L = AL.LAYER;
const ALL = 63;
const LOST = new Uint8Array(64);   // legs missing for each mask
for (let m = 0; m < 64; m++) { let n = 0; for (let b = 0; b < 6; b++) if (!(m >> b & 1)) n++; LOST[m] = n; }
const LEGMUL = []; for (let n = 0; n <= 6; n++) LEGMUL.push(Math.max(0, 1 - IJ.LEG_SLOW * n));

// ---- reading an ant ----------------------------------------------------------------------------------
const lostOf = (A, i) => LOST[A.legs[i]];
// -1 / +1: no legs left on the right / left side (it turns toward the side that still has legs), else 0
function circleOf(A, i) {
  const m = A.legs[i], l = m & 7, r = m >> 3;
  return l === 0 && r ? 1 : r === 0 && l ? -1 : 0;
}
function mulOf(A, i) {
  const k = LEGMUL[LOST[A.legs[i]]];
  return A.headless[i] ? k * IJ.HEADLESS_SPEED : k;
}
// can't get anywhere on its own: headless, too few legs to walk, or walking in circles
function stuckOf(A, i) { return A.headless[i] === 1 || LOST[A.legs[i]] >= 5 || circleOf(A, i) !== 0; }
const hurt = (A, i) => A.legs[i] !== ALL || A.headless[i] !== 0;

// ---- jaws ----------------------------------------------------------------------------------------------
// how big the jaws of colony col's caste are (1 = a worker's), and how well they take heads
function jawOf(col, caste) {
  const k = AL.CASTES[caste].key;
  return (IJ.JAW[k] || 1) * ((col && IJ.SPECIES_JAW[col.spKey]) || 1);
}
function headOf(col, caste) {
  const j = jawOf(col, caste), f = (col && col.sp && col.sp.fight) || {};
  const pierce = col && IJ.STING[col.spKey] ? 0 : (f.pierce || 0);
  return j * j * (1 + IJ.PIERCE_HEAD * pierce);
}
const creatureJaw = type => IJ.CREATURE_JAW[type] || 1;

// ---- getting hurt ------------------------------------------------------------------------------------
// per-ant scratch (sized lazily): the heading of a circling ant (behavior.js keeps it turning), and the chances
// of losing a leg / the head built up by bites since its last roll (ijU: whose they are, slots get reused)
function mem(A) {
  if (!A.ijA || A.ijA.length < A.cap) { A.ijA = new Float32Array(A.cap); A.ijL = new Float32Array(A.cap); A.ijH = new Float32Array(A.cap); A.ijU = new Int32Array(A.cap); }
  return A;
}
// how hard an ant pulls on big prey it drags (behavior.js pickup / releaseDrag): its legs pull, a circling or
// headless one can't drag at all
function dragMul(A, i) { return A.headless[i] || circleOf(A, i) ? 0 : LEGMUL[LOST[A.legs[i]]]; }
// an ant that is dragging lets go before its legs change (releaseDrag takes back what it pulled), then takes
// hold again with what it has left
function regrip(world, i, f, had) {
  const A = world.ants;
  if (!f || f.gone) return;
  const m = dragMul(A, i);
  if (m > 0) { A.state[i] = ST.DRAG; A.tgt[i] = had; f.carriers++; f.pull[A.col[i]] += AL.CASTES[A.caste[i]].drag * world.colonies[A.col[i]].sp.size * m; }
  else { A.state[i] = ST.HOMING; A.timer[i] = 0; }
}
function loseLeg(world, i) {
  const A = mem(world.ants), m = A.legs[i];
  if (!m) return;
  let n = 0; for (let b = 0; b < 6; b++) if (m >> b & 1) n++;
  let k = (world.R() * n) | 0, bit = 0;
  for (let b = 0; b < 6; b++) if (m >> b & 1) { if (k === 0) { bit = b; break; } k--; }
  const drag = A.state[i] === ST.DRAG && A.layer[i] === L.SURFACE, had = A.tgt[i], f = drag ? world.surface.byId.get(had) : null;
  if (drag && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  const wasCircle = circleOf(A, i);
  A.legs[i] = m & ~(1 << bit);
  if (!wasCircle && circleOf(A, i)) A.ijA[i] = A.a[i];
  if (drag) regrip(world, i, f, had);
  AL.emit(world, 'antInjured', { col: A.col[i], i, kind: 'leg', x: A.x[i], y: A.y[i], layer: A.layer[i], lost: LOST[A.legs[i]] });
}
function behead(world, i) {
  const A = world.ants;
  if (A.headless[i] || A.caste[i] === C.QUEEN) return;
  if (A.state[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  A.headless[i] = 1;
  A.carry[i] = 0;   // whatever was in its jaws drops and is lost
  A.tgt[i] = -1; A.timer[i] = 0; A.task[i] = 0; A.str[i] = 0;
  const grabbed = ST.W_GRAPPLE != null && A.state[i] === ST.W_GRAPPLE;   // a creature still has it
  if (!grabbed) A.state[i] = A.layer[i] === L.SURFACE ? ST.WANDER : ST.N_IDLE;
  AL.emit(world, 'antInjured', { col: A.col[i], i, kind: 'head', x: A.x[i], y: A.y[i], layer: A.layer[i], lost: LOST[A.legs[i]] });
}
// ant i (still alive) took a bite of dmg hp from jaws of size jaw; head = head-taking factor (0 = legs only);
// held = grip on it / its size (combat.js): held down by a swarm, its legs get pulled as well as bitten (PULL).
// Bites come every tick in a fight, so the chances add up per ant and are rolled once they reach ROLL (one
// world.R() per roll, not per bite; the expected number of injuries is the same), and many small bites add up too.
function bite(world, i, dmg, jaw, head, held) {
  const A = mem(world.ants);
  if (!A.state[i] || dmg <= 0) return;
  if (A.ijU[i] !== A.uid[i]) { A.ijU[i] = A.uid[i]; A.ijL[i] = 0; A.ijH[i] = 0; }
  const f = dmg / A.maxhp[i];
  if (A.legs[i]) A.ijL[i] += IJ.LEG * (jaw || 1) * f * (held > 1 ? 1 + (IJ.PULL || 0) * (held - 1) : 1);
  if (head > 0 && !A.headless[i]) A.ijH[i] += IJ.HEAD * head * f * (A.caste[i] === C.QUEEN ? IJ.QUEEN_HEAD : 1);
  const pl = A.ijL[i], ph = A.ijH[i];
  if (pl + ph < IJ.ROLL) return;
  A.ijL[i] = 0; A.ijH[i] = 0;
  const r = world.R();
  if (r < Math.min(0.5, ph)) behead(world, i);
  else if (r < Math.min(0.5, ph) + Math.min(0.9, pl)) loseLeg(world, i);
}

// an ant walking out of an abstract AI nest takes one leg from its caste's pool of lost legs (ai.js walkOut):
// a random leg, but it keeps at least one on each side (the circlers and the stuck never made it home)
function lameOut(A, i, R) {
  const m = A.legs[i];
  let n = 0;
  for (let b = 0; b < 6; b++) if ((m >> b & 1) && ((b < 3 ? m & 7 : m >> 3) & ~(1 << (b % 3)))) n++;
  if (!n) return;
  let k = (R() * n) | 0;
  for (let b = 0; b < 6; b++) if ((m >> b & 1) && ((b < 3 ? m & 7 : m >> 3) & ~(1 << (b % 3)))) { if (k === 0) { A.legs[i] = m & ~(1 << b); return; } k--; }
}

// ---- headless ants on the surface (behavior.js): blind, slow stumbling --------------------------------------
// returns true when the ant is handled here (its state machine is skipped this tick)
function blindSurface(world, i, sense) {
  const A = world.ants, st = A.state[i];
  if (ST.W_GRAPPLE != null && st === ST.W_GRAPPLE) return false;   // held by a creature: its handler places it
  if (st !== ST.WANDER) {
    if (st === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
    A.state[i] = ST.WANDER; A.tgt[i] = -1; A.carry[i] = 0; A.timer[i] = 0;
  }
  if (sense) A.turn[i] = A.turn[i] * 0.5 + (world.R() - 0.5) * IJ.BLIND_TURN;
  return true;
}

// ---- starvation where there is no per-ant hunger -----------------------------------------------------
function second(world) {
  const A = world.ants, gut = !!A.gut, cols = world.colonies, CB = AL.Combat;
  if (!CB || !CB.hitAnt) return;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || (A.legs[i] === ALL && !A.headless[i]) || A.caste[i] === C.QUEEN || !stuckOf(A, i)) continue;
    const col = cols[A.col[i]];
    if (gut && col && col.nest) continue;   // per-ant hunger (people's colonies) starves it the normal way
    // a cripple lying in its own nest is fed by its nestmates; a headless ant can't eat at all
    if (!A.headless[i] && A.layer[i] === L.NEST && AL.inOwnNest(world, i)) continue;
    CB.hitAnt(world, i, A.maxhp[i] / IJ.STARVE_T, 'starve');
  }
}

// ---- text for the Look tool -----------------------------------------------------------------------------
function describe(world, i) {
  const A = world.ants, n = LOST[A.legs[i]], out = [];
  if (A.headless[i]) out.push('headless');
  if (n) out.push('missing ' + (n === 1 ? 'a leg' : n + ' legs'));
  if (!A.headless[i] && A.caste[i] !== C.QUEEN) { if (n >= 5) out.push('can\'t walk'); else if (circleOf(A, i)) out.push('walking in circles'); }
  return out.join(', ');
}

AL.registerSystem({ id: 'injury', order: 4.5, init(world) { mem(world.ants); }, second });

AL.Injury = {
  LEGMUL, LOST,
  speedMul: (world, i) => mulOf(world.ants, i),
  canEat: (world, i) => !world.ants.headless[i],
  lost: (world, i) => lostOf(world.ants, i),
  circling: (world, i) => circleOf(world.ants, i),
  stuck: (world, i) => stuckOf(world.ants, i),
  injured: (world, i) => hurt(world.ants, i),
  mulOf, circleOf, stuckOf, dragMul, mem,
  jawOf, headOf, creatureJaw, bite, loseLeg, behead, lameOut, blindSurface, describe,
};
if (NODE) module.exports = AL.Injury;
})(typeof window !== 'undefined' ? window : globalThis);
