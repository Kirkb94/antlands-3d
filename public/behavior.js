// Ant behaviour on the surface: the per-tick state machine for every ant above ground.
// Hot loop: plain typed-array access, no allocation, sensing staggered over 3 ticks,
// and off-screen ants updated every other tick (sim LOD) when the colony gets huge.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./surface.js'); }
const ST = AL.ST, K = AL.CARRY, TAU = AL.TAU, PI = Math.PI;

// trail tuning (food trails). Ant-laid trails can build up to the grid max (12); the player's brush stops at
// PAINT_CAP, so a busy ant highway is both stronger and (with the grid's linear fade) much longer lived.
const TR = AL.TRAIL = Object.assign({
  ON: 0.05,          // weakest scent a forager follows
  LAY: 0.06,         // trail laid per tick by a laden forager at full strength
  LAY_DECAY: 75,     // seconds for a returning forager's mark strength to fall off (strongest near the food)
  LAY_FLOOR: 0.45,   // ... down to this, so the home end stays followable on long trips
  PAINT_CAP: 3,      // the player's food brush never raises a cell above this
  SENSE_D: 14, SENSE_A: 0.8,   // antenna reach and spread (lateral reach ~10 units, a trail is ~2-3 cells wide)
  TURN: 4.2,         // hardest turn toward a trail off to one side (rad/s)
  END_SEARCH: 9,     // seconds an ant searches around a trail end that led nowhere (ignoring trails)
  END_COST: 14,      // search seconds that costs (a few dead ends and it goes home)
  END_R: 30, END_FADE: 0.35,   // how much of the dead end that ant wipes
  FIDELITY: 180,     // seconds a forager remembers where it last found food and heads back there
}, AL.TRAIL || {});

let senseMax = 0;
// three-antenna trail steering: returns a turn rate (rad/s), senseMax = best reading.
// Bilinear sampling gives a smooth reading across a thin trail. The turn is proportional to how much stronger
// one side is (relative to the best reading), so on a busy, saturated highway the ant runs straight instead of
// spinning on tiny differences; only when it is crossing a trail (both sides beat the middle) does it turn hard.
function senseSteer(g, av, x, y, a, tie) {
  const D = TR.SENSE_D, s = TR.SENSE_A;
  const ca = AL.cos(a), sa = AL.sin(a), cl = AL.cos(a - s), sl = AL.sin(a - s), cr = AL.cos(a + s), sr = AL.sin(a + s);
  let l = g.sampleLin(x + cl * D, y + sl * D), m = g.sampleLin(x + ca * D, y + sa * D), r = g.sampleLin(x + cr * D, y + sr * D);
  if (av) { l -= 4 * av.sample(x + cl * D, y + sl * D); m -= 4 * av.sample(x + ca * D, y + sa * D); r -= 4 * av.sample(x + cr * D, y + sr * D); }
  senseMax = m > l ? (m > r ? m : r) : (l > r ? l : r);
  if (senseMax <= 0) return 0;
  const k = m * 1.25 + 0.02;
  if (l > k && r > k) return (r > l ? 1 : l > r ? -1 : (tie || 1)) * TR.TURN;
  const t = (r - l) / (senseMax + 0.05) * 5;
  return t > TR.TURN ? TR.TURN : t < -TR.TURN ? -TR.TURN : t;
}

// avoid trail check ahead: returns turn direction away from it, or 0
function avoidTurn(av, x, y, a) {
  const D = 18;
  const l = av.sample(x + AL.cos(a - 0.7) * D, y + AL.sin(a - 0.7) * D);
  const m = av.sample(x + AL.cos(a) * D, y + AL.sin(a) * D);
  const r = av.sample(x + AL.cos(a + 0.7) * D, y + AL.sin(a + 0.7) * D);
  if (m < 0.05 && l < 0.05 && r < 0.05) return 0;
  return l < r ? -1 : 1;
}
const steerTo = (a, ta, k) => { const d = AL.wrap(ta - a); return d * k; };

// what does this colony want to pick up?
function wants(colony, kind) {
  const s = colony.stock, cap = colony.cap || {};
  if (kind === K.WATER) return s.water < (cap.water || 60) * 0.9;
  if (kind === K.LEAF) return !!colony.sp.fungus;
  if (kind === K.SEED) return s.seeds < 200;
  // foragers favour what the colony is short of
  if (kind === K.PROTEIN) return !(s.protein > 70 && s.protein > s.sugar * 1.5);
  if (kind === K.SUGAR) return !(s.sugar > 150 && s.sugar > s.protein * 4 && s.protein < 20) || s.sugar < 400;
  return true;
}

// how badly the colony needs each food right now (0 = plenty, 1 = none in store): sugar against what the adults eat,
// protein against the larvae to raise. Worked out once a second per colony (Nov 2026: foragers favour what's short).
const NEED = { SUGAR_BASE: 40, SUGAR_PER: 0.9, PROT_BASE: 20, PROT_PER_LARVA: 1.2, PROT_PER: 0.25, GAP: 0.3, SKIP_MAX: 0.7 };
// (peek: the UI asking. It must not fill the once-a-second cache: the sim's first look each second has to be the
// one that counts on every PC, or one PC's HUD would freeze another moment's numbers in for its foragers)
function needs(world, colony, peek) {
  const sec = world.t | 0;
  if (colony._needT === sec && colony._need) return colony._need;
  const s = colony.stock;
  let adults = colony.surf || 0;
  if (colony.pop) { adults = 0; for (let k = 0; k < colony.pop.length; k++) adults += colony.pop[k]; }
  else if (colony.inside) for (let k = 0; k < colony.inside.length; k++) adults += colony.inside[k];
  let larvae = 0;
  if (colony.brood) { for (const b of colony.brood) if (b.stage <= 1) larvae++; } else if (colony.broodQ) for (const b of colony.broodQ) if (!b.fed) larvae++;
  const sugarHave = s.sugar + (colony.honey || 0) * 0.5 + (s.seeds || 0) * 0.5 + (s.fungus || 0) * 0.5;
  const protHave = s.protein + (s.seeds || 0) * 0.3 + (s.fungus || 0) * 0.3;
  const sugarWant = NEED.SUGAR_BASE + adults * NEED.SUGAR_PER, protWant = NEED.PROT_BASE + larvae * NEED.PROT_PER_LARVA + adults * NEED.PROT_PER;
  const n = peek ? { sugar: 0, protein: 0 } : colony._need || (colony._need = { sugar: 0, protein: 0 });
  n.sugar = AL.clamp(1 - sugarHave / sugarWant, 0, 1); n.protein = AL.clamp(1 - protHave / protWant, 0, 1);
  if (!peek) colony._needT = sec;
  return n;
}
// within reason: when one food is short and the other isn't, a share of the foragers (up to SKIP_MAX, each ant always
// the same about the same find) walk past the plentiful one to keep looking for what's short. Water and the rest go by wants()
function skips(world, colony, i, f) {
  if (f.kind !== K.SUGAR && f.kind !== K.PROTEIN) return false;
  const n = needs(world, colony), mine = f.kind === K.SUGAR ? n.sugar : n.protein, other = f.kind === K.SUGAR ? n.protein : n.sugar;
  if (mine > 0.25 || other < mine + NEED.GAP) return false;
  const p = Math.min(NEED.SKIP_MAX, other - mine);
  return AL.hash2(world.ants.uid[i], f.id, 991) < p;
}

function pickup(world, i, f) {
  const A = world.ants, S = world.surface, c = A.col[i], info = AL.CASTES[A.caste[i]];
  const dm = AL.Injury ? AL.Injury.dragMul(A, i) : 1;   // lame ants pull less (injury.js)
  if (f.big && info.drag > 0 && dm > 0 && f.carriers < f.needed + 4 && f.amount > 4) {
    A.state[i] = ST.DRAG; A.tgt[i] = f.id; A.timer[i] = 0;
    A.tx[i] = AL.atan2(A.y[i] - f.y, A.x[i] - f.x);      // slot angle around the carcass
    f.carriers++; f.pull[c] += info.drag * world.colonies[c].sp.size * dm;
    return;
  }
  if (f.kind === K.SUGAR && AL.Hunger && AL.Hunger.graze) AL.Hunger.graze(world, i, f);   // hungry: it drinks its fill here first (hunger.js)
  if (f.poi && AL.Aphids && AL.Aphids.catchAphid(world, i, f)) return;   // aphid farming: a live aphid for the root-aphid chamber instead
  f.amount -= AL.TUNE.CRUMB * (AL.TUNE.TRIP || 1);   // a trip's load (life.js stores TRIP at home)
  if (f.amount < 1) S.foodDirty = true;
  A.carry[i] = f.kind; A.state[i] = ST.RETURN; A.timer[i] = 0;
  // site fidelity: a forager remembers where it found food and heads back that way on its next trip
  if (A.tmFt) { trailMem(A); if (A.tmUid[i] !== A.uid[i]) resetMem(A, i); A.tmFx[i] = f.x; A.tmFy[i] = f.y; A.tmFt[i] = world.t; }
  A.str[i] = (f.quality || 1) * (f.kind === K.WATER ? 0.55 : 1);
  A.a[i] += PI;
  world.fxq && world.fxq.push(2, A.x[i], A.y[i], f.kind);
}
function releaseDrag(world, i) {
  const A = world.ants, f = world.surface.byId.get(A.tgt[i]);
  if (f) { f.carriers = Math.max(0, f.carriers - 1); f.pull[A.col[i]] = Math.max(0, f.pull[A.col[i]] - AL.CASTES[A.caste[i]].drag * world.colonies[A.col[i]].sp.size * (AL.Injury ? AL.Injury.dragMul(A, i) : 1)); }
  A.tgt[i] = -1;
}

// ---- obstacle detours -------------------------------------------------------------------------
// An ant that bumps into a log or rock picks a side and keeps it while it keeps bumping, sliding along
// the edge until it clears the end. Without a sticky side it would turn back into the obstacle every time
// it re-aimed for home and get stuck behind it.
function detour(A, i, x, y, a, look, blk, t) {
  // kept on the ant store so each world has its own (same seed stays deterministic)
  if (!A.dside || A.dside.length < A.cap) { A.dside = new Int8Array(A.cap); A.dlast = new Float32Array(A.cap).fill(-99); }
  const DSIDE = A.dside, DLAST = A.dlast;
  const ca = (k) => { for (let s = 1; s <= 10; s++) { const na = a + k * s * 0.3; if (!blk(x + AL.cos(na) * look, y + AL.sin(na) * look)) return s; } return 99; };
  let side = DSIDE[i];
  if (!side || t - DLAST[i] > 2.5) {
    const l = ca(-1), r = ca(1);
    side = DSIDE[i] = l < r ? -1 : r < l ? 1 : ((i & 1) ? 1 : -1);
  }
  DLAST[i] = t;
  const s = ca(side);
  return s < 99 ? a + side * s * 0.3 : a + PI;
}

// ---- per-ant trail memory (kept on the ant store, reset when a slot is reused) ----------------------
// on: last time on a trail, acq: when it picked this trail up, flip: last about-turn, ign: ignore trails until,
// door: last time it chose a way out at the mound, fx/fy/ft: where and when it last found food
function trailMem(A) {
  if (!A.tmOn || A.tmOn.length < A.cap) {
    A.tmUid = new Int32Array(A.cap).fill(-1);
    A.tmOn = new Float32Array(A.cap).fill(-99); A.tmAcq = new Float32Array(A.cap); A.tmFlip = new Float32Array(A.cap).fill(-99);
    A.tmIgn = new Float32Array(A.cap).fill(-99); A.tmDoor = new Float32Array(A.cap).fill(-99);
    A.tmFx = new Float32Array(A.cap); A.tmFy = new Float32Array(A.cap); A.tmFt = new Float32Array(A.cap).fill(-999);
  }
  return A;
}
function resetMem(A, i) {
  A.tmUid[i] = A.uid[i]; A.tmOn[i] = -99; A.tmFlip[i] = -99; A.tmIgn[i] = -99; A.tmDoor[i] = -99; A.tmFt[i] = -999;
}
// an ant stepping out of its mound chooses a way out once per trip: trails leaving the mound pull it in
// proportion to their strength (busy highways win most ants), with a share of ants striking out on fresh
// headings to scout. Without this, ants mill around the scent pooled at the door.
function pickExit(g, colony, R, a0) {
  let best = a0, tot = 0;
  const r1 = colony.moundR + 22, r2 = colony.moundR + 46, N = 16;
  const pick = R() * 1.15;     // weighted pick: about 1 ant in 8 ignores the trails and strikes out on its own
  const w = EXITW;
  for (let k = 0; k < N; k++) {
    const a = k * TAU / N, ca = AL.cos(a), sa = AL.sin(a);
    const v = g.sampleLin(colony.x + ca * r1, colony.y + sa * r1) + g.sampleLin(colony.x + ca * r2, colony.y + sa * r2);
    w[k] = v > TR.ON * 2 ? v * Math.sqrt(v) : 0; tot += w[k];
  }
  if (tot <= 0) return a0;
  let acc = pick * tot;
  if (acc > tot) return a0;    // this one strikes out on its own heading
  for (let k = 0; k < N; k++) { acc -= w[k]; if (acc <= 0) { best = k * TAU / N + (R() - 0.5) * 0.2; break; } }
  return best;
}
const EXITW = new Float32Array(16);

// ---- scouts: pathfinders, not haulers ----------------------------------------------------------
// A scout roams far, preferring ground its colony's scouts haven't covered lately, and spots food anywhere
// within its sight. It walks up to the find, does not pick anything up, and runs straight home laying a strong
// trail (foragers stepping out of the mound follow it), touches the mound and heads back out past the find to
// look further. It only comes home to report a find or to eat (needsToEat), and shelters from rain like anyone.
const SC = AL.SCOUT_TUNE = Object.assign({
  STR: 3,            // trail strength a reporting scout starts with (a laden forager starts at 1)
  FLOOR: 1.2,        // ... and the home end of a scout's trail never falls below this
  OUT: 180,          // a rival scout (abstract nest) goes home to eat after this many seconds (people's ants: hunger.js)
  CELL: 200,         // the colony's scouting map: world units per cell, holding when a scout last passed
  LEG: 400,          // how far ahead a scout aims each leg of its search
  LEG_T: 12,         // seconds before it rethinks a leg it couldn't finish (a rock in the way)
  KNOWN: 0.5,        // the colony's own trail this strong at a find means it is already known
  MIN_FOOD: 3,       // crumbs worth laying a trail to
  REDO: 300,         // seconds before a scout reports the same spot again
  BACK_R: 60,        // close enough to its last find: explore on from there
}, AL.SCOUT_TUNE || {});
const SCOUT = AL.CASTE.SCOUT;
// per-ant scout memory on the ant store (reset when a slot is reused): ate = when it last ate, mode = what it is
// heading for (0 nothing yet, 1 a find it spotted, 2 the end of a search leg, 3 back to its last find),
// tx/ty/tid/leg = that point, the food id and when it set off, rx/ry/rt = where and when it last reported a find
function scoutMem(A) {
  if (!A.scUid || A.scUid.length < A.cap) {
    A.scUid = new Int32Array(A.cap).fill(-1); A.scAte = new Float32Array(A.cap); A.scMode = new Uint8Array(A.cap);
    A.scTx = new Float32Array(A.cap); A.scTy = new Float32Array(A.cap); A.scTid = new Int32Array(A.cap); A.scLeg = new Float32Array(A.cap);
    A.scRx = new Float32Array(A.cap); A.scRy = new Float32Array(A.cap); A.scRt = new Float32Array(A.cap);
  }
  return A;
}
function scoutSeen(world, A, i) {
  scoutMem(A);
  if (A.scUid[i] !== A.uid[i]) { A.scUid[i] = A.uid[i]; A.scAte[i] = world.t; A.scMode[i] = 0; A.scRt[i] = -999; }
}
// Hunger hook. People's colonies (a detailed nest) use the real per-ant stomach (hunger.js): every surface ant
// asks this to decide to come home, and ate() is where it eats at the food store. Rival scouts (an abstract nest,
// whose colony pays one upkeep for everyone) keep a simple budget: home every SC.OUT seconds.
function needsToEat(world, i) {
  const A = world.ants, col = AL.homeOf ? AL.homeOf(world, i) : world.colonies[A.col[i]];
  if (col.nest && AL.Hunger) return AL.Hunger.needsToEat(world, i);
  if (A.caste[i] !== SCOUT || !A.scUid || A.scUid[i] !== A.uid[i]) return false;
  return world.t - A.scAte[i] > SC.OUT;
}
function ate(world, i) {
  const A = world.ants, col = AL.homeOf ? AL.homeOf(world, i) : world.colonies[A.col[i]];
  if (col.nest && AL.Hunger) { AL.Hunger.eat(world, i, col); return; }
  if (A.caste[i] !== SCOUT) return;
  scoutSeen(world, A, i); A.scAte[i] = world.t;
}
// the colony's scouting map: when one of its scouts last passed each cell (kept on the world, per colony)
function scoutMap(world, c) {
  const M = world.scoutMaps || (world.scoutMaps = []);
  if (!M[c]) { const S = world.surface, w = Math.ceil(S.W / SC.CELL), h = Math.ceil(S.H / SC.CELL); M[c] = { w, h, t: new Float32Array(w * h).fill(-1e4) }; }
  return M[c];
}
// the colony's own trail around a food source (a find the colony already knows about)
function trailAt(g, f) {
  const r = (f.r || 6) + 8;
  return Math.max(g.sample(f.x, f.y), g.sample(f.x + r, f.y), g.sample(f.x - r, f.y), g.sample(f.x, f.y + r), g.sample(f.x, f.y - r));
}
// is this food source worth a trail? (big prey too: foragers who follow the trail drag it)
function reportable(world, A, i, colony, f) {
  if (f.gone || f.amount < (f.big ? 1 : SC.MIN_FOOD) || !wants(colony, f.kind)) return false;
  if (world.t - A.scRt[i] < SC.REDO && AL.dist2(f.x, f.y, A.scRx[i], A.scRy[i]) < 80 * 80) return false;
  return trailAt(world.pher.food[A.col[i]], f) < SC.KNOWN;
}
// the nearest reportable food within sight (a plain squared-distance scan: scouts are few)
function spotFood(world, A, i, colony, x, y) {
  const foods = world.surface.foods, r = AL.CASTES[SCOUT].vis * AL.TUNE.FOG_CELL, r2 = r * r;
  let best = null, bd = r2;
  for (let k = 0; k < foods.length; k++) {
    const f = foods[k], dx = f.x - x, dy = f.y - y, d2 = dx * dx + dy * dy;
    if (d2 < bd && reportable(world, A, i, colony, f)) { bd = d2; best = f; }
  }
  return best;
}
// pick the next search leg: one of eight headings, toward the ground scouted longest ago, outward from the
// nest, and not too sharp a turn
function scoutLeg(world, A, i, colony, x, y) {
  const S = world.surface, R = world.R, m = scoutMap(world, A.col[i]), t = world.t, a0 = A.a[i];
  let best = -1e9, bx = x, by = y;
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + (R() - 0.5) * 0.5, px = x + AL.cos(a) * SC.LEG, py = y + AL.sin(a) * SC.LEG;
    if (px < 60 || py < 60 || px > S.W - 60 || py > S.H - 60) continue;
    const cx = (px / SC.CELL) | 0, cy = (py / SC.CELL) | 0;
    const age = Math.min(600, t - m.t[cy * m.w + cx]);
    const v = age + 0.08 * Math.sqrt(AL.dist2(px, py, colony.x, colony.y)) + 120 * AL.cos(a - a0) + R() * 150 - (AL.Surface.isBlocked(S, px, py) ? 300 : 0);
    if (v > best) { best = v; bx = px; by = py; }
  }
  A.scMode[i] = 2; A.scTx[i] = bx; A.scTy[i] = by; A.scLeg[i] = t;
}
// WANDER for a scout (sense ticks only): eat, spot, report, explore. Sets A.turn; returns nothing.
function scoutWander(world, i, colony, x, y, dt) {
  const A = world.ants, t = world.t, R = world.R, env = world.env || {};
  scoutSeen(world, A, i);
  A.timer[i] += dt * 3;
  if (needsToEat(world, i) || (env.rain > 0.3 && R() < 0.02)) { A.state[i] = ST.HOMING; A.timer[i] = 0; A.scMode[i] = 0; return; }
  // mark the ground it is covering on the colony's map
  const m = scoutMap(world, A.col[i]), cx = (x / SC.CELL) | 0, cy = (y / SC.CELL) | 0;
  if (cx >= 0 && cy >= 0 && cx < m.w && cy < m.h) m.t[cy * m.w + cx] = t;
  let mode = A.scMode[i];
  if (mode === 1) {
    const f = world.surface.byId.get(A.scTid[i]);
    if (!f || f.gone || f.amount < 1) mode = A.scMode[i] = 0;
    else if (t - A.scLeg[i] > 40) { A.scRx[i] = f.x; A.scRy[i] = f.y; A.scRt[i] = t; mode = A.scMode[i] = 0; }   // can't get there (water, rocks): leave it
    else {
      A.scTx[i] = f.x; A.scTy[i] = f.y;   // big prey can move
      const rr = f.r + 4;
      if (AL.dist2(f.x, f.y, x, y) < rr * rr) {
        // found: run home laying a strong trail (nothing carried)
        A.state[i] = ST.RETURN; A.carry[i] = 0; A.timer[i] = 0; A.wf[i] = 0;
        A.str[i] = SC.STR * (f.quality || 1) * (f.kind === K.WATER ? 0.55 : 1);
        A.scRx[i] = f.x; A.scRy[i] = f.y; A.scRt[i] = t; A.scMode[i] = 0;
        A.a[i] = AL.atan2(colony.y - y, colony.x - x); A.turn[i] = 0;
        AL.emit(world, 'scoutFound', { col: A.col[i], i, x: f.x, y: f.y, kind: f.kind, big: !!f.big });
        return;
      }
    }
  }
  if (mode !== 1) {
    const f = spotFood(world, A, i, colony, x, y);
    if (f) { mode = A.scMode[i] = 1; A.scTid[i] = f.id; A.scTx[i] = f.x; A.scTy[i] = f.y; A.scLeg[i] = t; }
  }
  if (mode === 3 && (AL.dist2(A.scTx[i], A.scTy[i], x, y) < SC.BACK_R * SC.BACK_R || t - A.scLeg[i] > 90)) mode = 0;
  if (mode === 2 && (AL.dist2(A.scTx[i], A.scTy[i], x, y) < 50 * 50 || t - A.scLeg[i] > SC.LEG_T)) mode = 0;
  if (mode === 0) scoutLeg(world, A, i, colony, x, y);
  if (A.wf[i] > 0) return;   // sliding round an obstacle: hold the detour heading
  A.turn[i] = AL.clamp(steerTo(A.a[i], AL.atan2(A.scTy[i] - y, A.scTx[i] - x), 3), -4, 4) + (R() - 0.5) * 1.2;
}
// a scout reached its own mound: true when it turned straight back out (no need to go in)
function scoutHome(world, i, colony, st) {
  const A = world.ants, env = world.env || {};
  if (A.carry[i]) return false;
  scoutSeen(world, A, i);
  if (env.winter || env.rain > 0.35 || colony.recall) return false;   // weather or the alarm: in like everyone else
  const reported = st === ST.RETURN;
  if (reported) { A.scMode[i] = 3; A.scTx[i] = A.scRx[i]; A.scTy[i] = A.scRy[i]; A.scLeg[i] = world.t; }
  if (needsToEat(world, i)) {
    if (colony.nest) return false;   // a detailed nest: in to the food store and back out (life.js)
    ate(world, i);                   // an abstract nest: the visit counts as a meal
  } else if (!reported) return false;
  A.state[i] = ST.WANDER; A.timer[i] = 0; A.wf[i] = 0; A.turn[i] = 0;
  A.a[i] = reported ? AL.atan2(A.scRy[i] - A.y[i], A.scRx[i] - A.x[i]) : A.a[i] + PI;
  return true;
}

// ---- the hot loop --------------------------------------------------------------------------
function updateSurface(world) {
  const A = world.ants, S = world.surface, T = AL.TUNE, DT = T.DT, R = world.R;
  const X = A.x, Y = A.y, PX = A.px, PY = A.py, ANG = A.a, TURN = A.turn, STATE = A.state, LAYER = A.layer;
  const COL = A.col, CASTE = A.caste, TIMER = A.timer, STR = A.str, WF = A.wf, ANIM = A.anim, HOME = A.home, HOMES = world.homes || world.colonies, NCOL = world.colonies.length;
  const blocked = S.blocked, gw = S.gw, inv = 1 / S.cell, SW = S.W - 2, SH = S.H - 2, TSP = S.tspeed, BRG = S.bridgeOwner;   // TSP: terrain walking speed per cell (terrain.js)
  // rocks, logs and stumps don't stop an ant: it climbs up and over them, slower (only the yard's edge turns it)
  const blk = (px, py) => px < 2 || py < 2 || px > SW || py > SH, CLIMB = T.CLIMB || 0.55;
  const food = world.pher.food, avoidOf = world.pher.avoidOf || [world.pher.avoid];
  const hash = world.hash; hash.clear();
  const tick = world.tick, view = world.mp ? world.mpView || AL.Sim.ALL : world.view, lod = world.lod;   // (multiplayer: the same view on every PC, sim.js mpView)
  const env = world.env || { night: 0, rain: 0 };
  const envSpeed = (1 - 0.22 * env.night) * (1 - 0.3 * env.rain);
  const sunSlow = env.sunSlow && world.shade ? env.sunSlow : 0, shade = world.shade;
  const cols = world.colonies, CASTES = AL.CASTES, CARRY = A.carry, SLOW = T.CARRY_SLOW || 1;
  const LEGS = A.legs, HEADLESS = A.headless, IJ = AL.Injury, IJA = IJ && IJ.mem ? IJ.mem(A).ijA : null, CIRT = AL.INJURY ? AL.INJURY.CIRCLE_TURN : 0;
  const GUT = A.gut, HOME_GUT = AL.HUNGER ? AL.HUNGER.HOME : -1;   // stomachs (hunger.js): cheap check before asking needsToEat
  const n = A.high;
  const BRS = AL.Bridges, BRN = !!(BRS && world.bridgesWhole > 0 && TSP);   // any finished living bridge to route over
  trailMem(A); scoutMem(A);
  let updated = 0;
  for (let i = 0; i < n; i++) {
    const st = STATE[i];
    if (st === 0 || LAYER[i] !== 0) continue;
    const c = COL[i];
    let dt = DT;
    if (lod) {
      const x = X[i], y = Y[i];
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) {
        if (((i + tick) & 1) !== 0) { hash.insert(i, x, y, c); continue; }
        dt = DT * 2;
      }
    }
    updated++;
    PX[i] = X[i]; PY[i] = Y[i];
    const hm = HOME[i], colony = hm >= NCOL && HOMES[hm] && HOMES[hm].id === c && !HOMES[hm].gone ? HOMES[hm] : cols[c], info = CASTES[CASTE[i]];   // its home: the colony's mound or a satellite's (own stock, own door)
    const mods = env.mods && env.mods[colony.spKey];
    let spd = info.speed * colony.sp.speed * (mods ? mods.speed * (1 - 0.3 * env.rain) : envSpeed);
    // heat waves slow ants caught in open sun (shade from canopy or shelters cancels it)
    if (sunSlow && !shade[((Y[i] * inv) | 0) * gw + ((X[i] * inv) | 0)]) spd *= 1 - sunSlow;
    if (CARRY[i]) spd *= SLOW;   // hauling anything slows an ant down
    if (TSP) {   // sand and gravel are quick, mud and leaf litter slow, streams are swum at a third (on its own
      // colony's living ant bridge an ant walks at full speed: enemies can't use it, bridges.js)
      const ci = ((Y[i] * inv) | 0) * gw + ((X[i] * inv) | 0); let k = TSP[ci] || 1;
      if (BRG && k < 0.5 && BRG[ci] === c + 1) k = 1;
      spd *= k;
    }
    if (blocked[((Y[i] * inv) | 0) * gw + ((X[i] * inv) | 0)] === 1) spd *= CLIMB;   // climbing a rock or log
    const sense = ((i + tick) % 3) === 0;
    // fight injuries (injury.js): lost legs slow it, one side gone sends it round in circles, a headless ant
    // stumbles about blind (its state machine is skipped)
    let circ = 0, blind = false;
    if ((LEGS[i] !== 63 || HEADLESS[i]) && IJ) {
      spd *= IJ.mulOf(A, i);
      if (HEADLESS[i]) blind = IJ.blindSurface(world, i, sense);
      else circ = IJ.circleOf(A, i);
    }
    const x = X[i], y = Y[i];
    const ndx = colony.x - x, ndy = colony.y - y;
    const av = avoidOf[c] || null;   // people's colonies steer round their own Avoid marks
    if (!blind) switch (st) {
      case ST.WANDER: {
        if (CASTE[i] === SCOUT) { if (WF[i] > 0) WF[i] -= dt; if (sense) scoutWander(world, i, colony, x, y, dt); break; }
        if (sense) {
          let f = AL.Surface.foodAt(S, x, y);
          // research: keener antennae (col.mods.smell) also sniff a point straight ahead
          const sm = colony.mods ? colony.mods.smell : 0;
          if (!f && sm > 0) f = AL.Surface.foodAt(S, x + AL.cos(ANG[i]) * sm, y + AL.sin(ANG[i]) * sm);
          if (f && wants(colony, f.kind) && !skips(world, colony, i, f) && (f.keyPoint == null || (AL.Victory && AL.Victory.springOwner(world, f) === c))) {   // (a key point's spring: its holder only)
            const fx = f.x - x, fy = f.y - y, rr = f.r + 3;
            if (fx * fx + fy * fy < rr * rr) { pickup(world, i, f); break; }
            TURN[i] = AL.clamp(steerTo(ANG[i], AL.atan2(fy, fx), 6), -6, 6);
          } else {
            const t = world.t;
            if (A.tmUid[i] !== A.uid[i]) resetMem(A, i);
            const d2 = ndx * ndx + ndy * ndy, doorR = colony.moundR + 12;
            if (d2 < doorR * doorR) {
              // stepping out of the mound: choose a way out once, then walk straight off the mound
              if (t - A.tmDoor[i] > 6) {
                A.tmDoor[i] = t;
                // back toward the last find (site fidelity), else pick a trail out of the mound
                if (t - A.tmFt[i] < TR.FIDELITY && R() < 0.9) ANG[i] = AL.atan2(A.tmFy[i] - colony.y, A.tmFx[i] - colony.x) + (R() - 0.5) * 0.3;
                else ANG[i] = pickExit(food[c], colony, R, AL.atan2(-ndy, -ndx) + (R() - 0.5) * 1.2);
              }
              TURN[i] = (R() - 0.5) * 0.5;
            } else {
              const ign = t < A.tmIgn[i];
              const s = ign ? 0 : senseSteer(food[c], av, x, y, ANG[i], (i & 1) ? 1 : -1);
              if (!ign && senseMax > TR.ON) {
                // on a food trail: follow it out, away from home. Only laden ants coming back lay trail,
                // so a trail to food that has run out fades instead of being walked alive forever.
                if (t - A.tmOn[i] > 0.6) A.tmAcq[i] = t;
                A.tmOn[i] = t;
                TURN[i] = s + (R() - 0.5) * 0.4;
                if (d2 > 900 && (AL.cos(ANG[i]) * ndx + AL.sin(ANG[i]) * ndy) > 0.5 * Math.sqrt(d2)) {
                  if (t - A.tmFlip[i] > 5) { ANG[i] += PI; TURN[i] = 0; A.tmFlip[i] = t; }
                  // turned homeward again straight after an about-turn: this scent loops back on itself
                  // (a smeared patch, a bend). Stop following it for a bit instead of ping-ponging.
                  else { A.tmIgn[i] = t + 3 + R() * 2; A.tmOn[i] = -99; }
                }
              } else {
                const lost = t - A.tmOn[i];
                if (lost < 0.5) TURN[i] *= 0.5;       // coast straight over a small gap in the trail
                else {
                  if (A.tmOn[i] > 0 && A.tmOn[i] - A.tmAcq[i] > 2) {
                    // walked a trail to its end and found nothing: search around here, not back down the trail
                    A.tmIgn[i] = t + TR.END_SEARCH * (0.7 + R() * 0.6); TIMER[i] += TR.END_COST; A.tmFt[i] = -999;
                    // and marks the dead end (real ants do: Pharaoh ants lay a 'no entry' signal), so a trail
                    // whose food is gone shrinks back from its far end as more ants find nothing there
                    food[c].fadeDisc(x - AL.cos(ANG[i]) * 18, y - AL.sin(ANG[i]) * 18, TR.END_R, TR.END_FADE);
                  }
                  A.tmOn[i] = -99;
                  TURN[i] = TURN[i] * 0.5 + (R() - 0.5) * 3.2;
                  // early in a search, spread out from the nest instead of milling around the door
                  if (d2 < 32000 && (AL.cos(ANG[i]) * ndx + AL.sin(ANG[i]) * ndy) > 0) TURN[i] += (R() < 0.5 ? -2 : 2);
                }
              }
            }
            if (av) { const tv = avoidTurn(av, x, y, ANG[i]); if (tv) TURN[i] = tv * 5; }
          }
          TIMER[i] += dt * 3;
          if (TIMER[i] > T.SEARCH_TIME * (colony.mods ? colony.mods.search : 1) || (env.rain > 0.3 && R() < 0.02) || (env.night > 0.7 && R() < 0.004) || (GUT[i] < HOME_GUT && colony.nest && needsToEat(world, i))) {   // or hungry: home to eat
            STATE[i] = ST.HOMING; TIMER[i] = 0;
          }
        }
        break;
      }
      case ST.RETURN:
      case ST.HOMING:
      case ST.HEAL: {
        if (WF[i] > 0) WF[i] -= dt;
        else if (sense) {
          const ta = AL.atan2(ndy, ndx);
          TURN[i] = AL.clamp(steerTo(ANG[i], ta, 3.5), -4.5, 4.5) + (R() - 0.5) * 1.6;
          if (av) { const t = avoidTurn(av, x, y, ANG[i]); if (t) { TURN[i] = t * 5; WF[i] = 0.4; } }
        }
        if (st === ST.RETURN) {
          // lay a food trail home; it's strongest near the food and fades as the ant walks.
          // Nothing is laid on the mound itself, so scent doesn't pool at the door.
          const mr = colony.moundR * 0.8;
          if (ndx * ndx + ndy * ndy > mr * mr) food[c].depositLin(x, y, STR[i] * TR.LAY * dt / DT * (colony.mods ? colony.mods.trail : 1));   // research: mods.trail
          STR[i] *= 1 - dt / TR.LAY_DECAY;
          const fl = CASTE[i] === SCOUT ? SC.FLOOR : TR.LAY_FLOOR;
          if (STR[i] < fl) STR[i] = fl;   // the home end stays strong enough to find on long trips
        }
        const rr = colony.moundR * 0.35 + 6;
        if (ndx * ndx + ndy * ndy < rr * rr) {
          if (CASTE[i] === SCOUT && scoutHome(world, i, colony, st)) break;   // reported a find (or ate at an abstract nest): back out
          world.arrive(world, i); continue;
        }
        break;
      }
      case ST.DRAG: {
        const f = S.byId.get(A.tgt[i]);
        if (!f || f.gone) { A.tgt[i] = -1; STATE[i] = ST.HOMING; break; }
        const sl = A.tx[i];
        X[i] = f.x + AL.cos(sl) * (f.r + 2); Y[i] = f.y + AL.sin(sl) * (f.r + 2);
        ANG[i] = sl + PI + AL.sin(tick * 0.3 + i) * 0.15;   // dragging backwards, tugging
        TIMER[i] += dt;
        if (f.moving) ANIM[i] += dt * 7;
        // not enough helpers for a while: cut off a piece and go home laying a strong recruit trail
        if (!f.moving && TIMER[i] > 7 + (i % 5)) {
          releaseDrag(world, i);
          f.amount -= 1; if (f.amount < 1) S.foodDirty = true;
          A.carry[i] = K.PROTEIN; STATE[i] = ST.RETURN; STR[i] = 1.8; TIMER[i] = 0; ANG[i] = AL.atan2(ndy, ndx);
        }
        hash.insert(i, X[i], Y[i], c);
        continue;
      }
      default: {
        // states owned by other systems (combat, recruit, raid ...) register their own handlers
        const h = world.surfaceHandlers && world.surfaceHandlers[st];
        world.handlerSpeed = 1;
        if (h) { const r = h(world, i, dt, sense); if (r === 1) { hash.insert(i, X[i], Y[i], c); continue; } if (r === 2) continue; spd *= world.handlerSpeed || 1; }
        break;
      }
    }
    if (STATE[i] === 0 || LAYER[i] !== 0) continue;
    // at the water's edge: the colony's own living bridge if one goes its way (bridges.js), else it swims
    if (BRN && !circ && !blind) { const ta = BRS.steer(world, i); if (ta === ta) TURN[i] = AL.clamp(steerTo(ANG[i], ta, 7), -9, 9); }
    // ---- movement with obstacle bumping ----
    // (an ant with no legs on one side keeps its own heading turning, whatever its state wanted)
    let a = circ ? IJA[i] + circ * CIRT * dt : ANG[i] + TURN[i] * dt;
    if (a > PI) a -= TAU; else if (a < -PI) a += TAU;
    if (circ) IJA[i] = a;
    const d = spd * dt;
    const nx = X[i] + AL.cos(a) * d, ny = Y[i] + AL.sin(a) * d;
    if (circ) { if (!blk(nx, ny)) { X[i] = nx; Y[i] = ny; ANIM[i] += d * 0.22; } }
    else if (blk(nx, ny)) {
      // slide along the obstacle on this ant's chosen side, and hold that heading for a moment
      a = detour(A, i, X[i], Y[i], a, Math.max(d * 2, 8), blk, world.t);
      TURN[i] = 0; WF[i] = 0.5 + R() * 0.3;
      const mx = X[i] + AL.cos(a) * d, my = Y[i] + AL.sin(a) * d;
      if (!blk(mx, my)) { X[i] = mx; Y[i] = my; ANIM[i] += d * 0.22; }
    } else { X[i] = nx; Y[i] = ny; ANIM[i] += d * 0.22; }
    ANG[i] = a;
    hash.insert(i, X[i], Y[i], c);
  }
  world.perf.updated = updated;
}

// where big prey is dragged: the nearest of the colony's hills. Its capital, a satellite with a nest of its own (the
// prey goes into that nest's store) or a satellite mound sharing the capital's store (expansion.js)
function dragHome(world, col, x, y) {
  let best = col, bd = AL.dist2(col.x, col.y, x, y);
  for (const s of col.satellites || []) {
    if (s.state !== 'active' && s.state !== 'orphan') continue;
    const h = s.home != null && world.homes ? world.homes[s.home] : null;
    if (s.home != null && (!h || h.gone || h.id !== col.id)) continue;
    const t = h || s, d = AL.dist2(t.x, t.y, x, y);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
// big prey: moves once enough carriers pull the same way (numbers win the tug of war)
function updateCarcasses(world, dt) {
  const S = world.surface;
  for (const f of S.foods) {
    if (!f.big || f.gone) { if (f.big) f.moving = false; continue; }
    f.moving = false;
    if (f.carriers <= 0) continue;
    // strongest colony minus the runner-up decides who drags it
    let win = 0, best = -1, second = 0;
    for (let k = 0; k < world.colonies.length; k++) { const p = f.pull[k]; if (p > best) { second = Math.max(second, best); best = p; win = k; } else if (p > second) second = p; }
    const net = best - Math.max(0, second);
    if (net < f.needed) continue;
    const col = world.colonies[win], to = dragHome(world, col, f.x, f.y);   // the nearest of its hills
    const dx = to.x - f.x, dy = to.y - f.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < (to.moundR || col.moundR) * 0.4 + 10) { world.deliverBig(world, win, f, to.stock && to !== col ? to : null); continue; }
    const v = Math.min(22, 6 + 3 * (net - f.needed)) * (AL.TUNE.CARRY_SLOW || 1);   // dragging is hauling too
    let a = AL.atan2(dy, dx);
    for (let k = 0; k < 5; k++) {
      const nx = f.x + AL.cos(a) * (f.r + 6), ny = f.y + AL.sin(a) * (f.r + 6);
      if (!AL.Surface.isBlocked(S, nx, ny)) break;
      a += (k & 1 ? -1 : 1) * 0.6 * (k + 1);
    }
    f.x += AL.cos(a) * v * dt; f.y += AL.sin(a) * v * dt;
    if (f.poi) { f.poi.x = f.x; f.poi.y = f.y; }
    f.heading = a; f.moving = true;
    S.foodDirty = true;
  }
}

// the World stage's heat fallback can switch off: we apply sun slowdown natively
if (AL.WORLD_TUNE) AL.WORLD_TUNE.SUN_SLOW_FALLBACK = false;
AL.Behavior = { nativeSun: true, updateSurface, updateCarcasses, dragHome, pickup, releaseDrag, senseSteer, wants, needs, skips, NEED, pickExit, needsToEat, ate, scoutMap, TRAIL: TR, SCOUT: SC };
if (NODE) module.exports = AL.Behavior;
})(typeof window !== 'undefined' ? window : globalThis);
