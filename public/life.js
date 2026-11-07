// Colony life for the player's nest: ants inside the nest (dig, store food, nurse, carry the dead),
// the queen and her egg queue, brood (egg -> larva -> pupa -> adult), food storage and spoilage,
// aging and death, disease, and the mound growing from excavated soil. Polygyne species (sp.polygyne) can keep
// extra laying queens in the queen chamber: col.queens2 = [{ i, uid, layT, alive }] (col.queen stays the main one).
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); require('./surface.js'); require('./colony.js'); require('./hunger.js'); require('./nestclimate.js'); }
const ST = AL.ST, K = AL.CARRY, C = AL.CASTE, ACT = AL.ACT, L = AL.LAYER, T = AL.TUNE;
const N = AL.Nest, F = N.F, CH = N.CH, TILE = N.TILE;
const NEST_SPEED = 0.55;    // nest units are tighter than the yard; ants walk slower inside
const HL = AL.HEAL;
const HU = AL.Hunger;   // per-ant hunger (hunger.js)

// ---- wounds (tuning: data.js AL.HEAL) -----------------------------------------------------
// hp fraction below which an ant of this caste goes home to heal (0 = never)
function healAt(caste) { return caste === C.QUEEN || caste === C.HONEYPOT ? 0 : caste === C.MAJOR ? HL.AT[2] : caste === C.SOLDIER ? HL.AT[1] : HL.AT[0]; }
function wounded(A, i) { return A.hp[i] < A.maxhp[i] * healAt(A.caste[i]); }
// healing costs sugar: a starving colony (or an AI rival with an empty store) can't
function canHeal(col) { return col.nest ? !col.starving && col.stock.sugar > (HL.MIN_SUGAR || 0) : col.stock.sugar > 1; }
// the colony's own mound is being raided (combat.js / ai.js set col._raidT): the wounded defend it too
function homeRaided(world, col) { return col._raidT != null && world.t - col._raidT < HL.RAID_HOLD; }
// a wounded ant in its own nest lies up until healed and turns down orders meanwhile
function needsRest(world, i, col) { return wounded(world.ants, i) && world.ants.nest[i] === col.hid && canHeal(col) && !homeRaided(world, col); }

// ---- deaths (shared with combat) ---------------------------------------------------------
const Combat = AL.Combat = AL.Combat || {};
Combat.killAnt = function (world, i, cause) {
  const A = world.ants;
  if (!A.state[i]) return;
  const col = AL.homeOf(world, i), caste = A.caste[i], x = A.x[i], y = A.y[i], layer = A.layer[i];   // (a satellite's queen dies for her satellite)
  const xq = caste === C.QUEEN ? extraOf(world, col, i) : -1;   // one of the extra queens (polygyne), not the main one
  if (A.state[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  if (A.act[i] === ACT.DIG || A.state[i] === ST.N_DIG) { /* nothing held */ }
  // whatever it carried drops with it
  if (layer === L.SURFACE) AL.Surface.dropCorpse(world.surface, x, y, A.col[i], 1 + (A.carry[i] === K.PROTEIN ? 1 : 0));
  else if (layer === L.NEST && col.nest) col.nest.corpses.push({ i: N.tileOf(col.nest, x, y), x, y, a: A.a[i], col: A.col[i], t: world.t }), col.nest.corpseDirty = true;
  A.kill(i);
  col.stats.died++;
  if (xq >= 0) col.queens2.splice(xq, 1);
  else if (caste === C.QUEEN && col.queen) { col.queen.alive = false; col.queen.hp = 0; }
  AL.emit(world, 'antDied', { col: col.id, i, caste, x, y, layer, cause: cause || 'unknown', extra: xq >= 0 });
  if (caste === C.QUEEN && xq < 0) {
    if (promoteQueen(world, col)) return;   // another queen in the chamber carries on
    if (col.sat) { AL.emit(world, 'homeQueenDied', { col: col.id, hid: col.hid, sat: col.sat.id, cause: cause || 'unknown' }); return; }   // a satellite's queen (expansion.js)
    const data = { handled: false };
    AL.emit(world, 'queenDied', { col: col.id, colony: col, data });
    if (!data.handled) queenLost(world, col);
  }
};
Combat.hitAnt = function (world, i, dmg, cause) {
  const A = world.ants;
  if (!A.state[i]) return false;
  A.hp[i] -= dmg;
  if (A.caste[i] === C.QUEEN) { const q = AL.homeOf(world, i).queen; if (q && (q.i === i || q.i < 0)) q.hp = Math.max(0, A.hp[i]); }
  if (A.hp[i] <= 0) { Combat.killAnt(world, i, cause); return true; }
  return false;
};
function queenLost(world, col) {
  col.alive = false;
  if (world.mp) { mpQueenLost(world, col); return; }
  if (col.isPlayer) AL.Sim.endGame(world, -1, 'Your queen is dead. Without her the colony fades away.');
  else if (world.colonies.every(c => c.isPlayer || !c.alive)) AL.Sim.endGame(world, 0, 'Every rival queen is dead. The backyard is yours.');
}
// multiplayer: a person whose queen dies is out (and watches); the last colony standing wins
function mpQueenLost(world, col) {
  if (col.isPlayer && !col.outT) { col.outT = world.t; AL.emit(world, 'playerOut', { col: col.id, name: col.name }); }
  const left = world.colonies.filter(c => c.alive);
  const people = left.filter(c => c.isPlayer);
  if (left.length === 1) AL.Sim.endGame(world, left[0].id, (left[0].name || 'Colony ' + (left[0].id + 1)) + ' is the last colony standing.');
  else if (!people.length) AL.Sim.endGame(world, -1, 'Every player\'s queen is dead. The rivals keep the backyard.');
}

// ---- queens: laying, colony size, polygyny ---------------------------------------------------
const GR = T.GROW, PQ = T.POLY;
// laying speeds up as the colony grows (all species); leafcutters' fungus gardens make theirs climb steeper
// the queen lays slower as food runs short (AL.TUNE.LAY_BRAKE): full speed with perAnt food in store per adult
function layBrake(col, adults, world) {
  const B = T.LAY_BRAKE; if (!B) return 1;
  const s = col.stock, food = (s.sugar || 0) + (s.protein || 0) + (s.seeds || 0) * 0.5;
  const per = B.perAnt * (world && world.env && world.env.season === 'autumn' ? B.autumn || 1 : 1);
  const r = food / Math.max(15, adults * per);
  const floor = Math.max(B.floor, 1 - ((col.sp && col.sp.breed) || 1));   // slow breeders: hardly braked
  return AL.clamp(floor + (1 - floor) * r, floor, 1);
}
// winter: a queen with a well-stocked store keeps laying slowly (0 if it isn't: 2x what full speed wants)
function winterLay(col, adults) {
  const B = T.LAY_BRAKE; if (!B || !B.winter) return 0;
  const s = col.stock, food = (s.sugar || 0) + (s.protein || 0) + (s.seeds || 0) * 0.5;
  const r = food / Math.max(15, adults * B.perAnt);
  return B.winter * AL.clamp(r - 1, 0, 1);
}
function sizeBonus(sp, adults) {
  let g = 1 + Math.min(GR.max, adults / GR.per);
  // single-queen species: past soloFrom adults the one queen keeps speeding up (AL.TUNE.GROW solo*)
  if (sp && !sp.polygyne && GR.soloMax) g += Math.min(GR.soloMax, Math.max(0, adults - GR.soloFrom) / GR.soloPer);
  return sp && sp.fungus ? Math.max(g, 1 + Math.min(GR.fungusMax, adults / GR.fungusPer)) : g;
}
const maxQueens = col => Math.max(1, (col.sp && col.sp.polygyne) | 0);
// extra queens alive (detailed nest: real ants in col.queens2; rival AI: a number, col.queenX)
function extraQueens(col) { return col.queens2 ? col.queens2.length : (col.queenX || 0); }
function queenCount(col) { return (col.queen && col.queen.alive ? 1 : 0) + extraQueens(col); }
function extraOf(world, col, i) {
  const L2 = col && col.queens2; if (!L2) return -1;
  for (let k = 0; k < L2.length; k++) if (L2[k].i === i && L2[k].uid === world.ants.uid[i]) return k;
  return -1;
}
// drop records of extra queens whose ant is gone (killed without killAnt, e.g. a fading colony)
function syncQueens(world, col) {
  const L2 = col.queens2, A = world.ants; if (!L2) return;
  for (let k = L2.length - 1; k >= 0; k--) { const x = L2[k]; if (!A.state[x.i] || A.uid[x.i] !== x.uid || A.caste[x.i] !== C.QUEEN) L2.splice(k, 1); }
}
// can this colony take another laying queen? how: 'royal' (a winged queen waiting on the mound) or 'auto'
function canAdopt(world, col, how) {
  if (!col || !col.sp.polygyne) return { ok: false, why: 'Only species with many queens (fire ants) keep extra queens' };
  if (col.out || (col.alive === false && !col.queen.alive)) return { ok: false, why: 'Colony is gone' };
  if (queenCount(col) >= maxQueens(col)) return { ok: false, why: 'Queen chamber full (' + maxQueens(col) + ' queens)' };
  if (how === 'royal' && !(col.royal && col.royal.queens > 0)) return { ok: false, why: 'Raise a winged queen first' };
  if (how === 'royal' && !col.nest) return { ok: false, why: 'No nest' };
  return { ok: true };
}
// a mated queen settles in the queen chamber and starts laying. With no living main queen she becomes it.
function adoptQueen(world, col, how) {
  if (!canAdopt(world, col, how).ok) return false;
  if (how === 'royal') col.royal.queens--;
  const tr = (col.queen && col.queen.traits) || {};
  if (col.nest) {
    const A = world.ants, R = world.R, nest = col.nest;
    if (nest.fieldDirty) N.rebuild(nest);
    const qt = nest.tiles[CH.QUEEN];
    const tile = qt.length ? qt[(R() * qt.length) | 0] : N.idx(nest, nest.entrance.c, Math.min(nest.rows - 1, 6));
    const [x, y] = N.centre(nest, tile);
    const i = A.spawn(col.id, C.QUEEN, L.NEST, x + (R() - 0.5) * 6, y + (R() - 0.5) * 3, 0, R);
    if (i < 0) { if (how === 'royal') col.royal.queens++; return false; }
    A.hp[i] = A.maxhp[i] = AL.CASTES[C.QUEEN].hp * (tr.hpMul || 1) * PQ.hp;   // a young queen: smaller than the founder
    A.state[i] = ST.N_QUEEN; A.life[i] = 1e9;
    (col.queens2 || (col.queens2 = [])).push({ i, uid: A.uid[i], layT: 2 + R() * 2, alive: true });
  } else col.queenX = (col.queenX || 0) + 1;
  col.queenStats = col.queenStats || { adopted: 0, promoted: 0 }; col.queenStats.adopted++;
  AL.emit(world, 'queenAdopted', { col: col.id, how, n: queenCount(col) });
  if (!col.queen.alive) promoteQueen(world, col);
  return true;
}
// the main queen is dead: the strongest extra queen takes her place (in place, so col.queen keeps its fields)
function promoteQueen(world, col) {
  if (!col || col.out) return false;
  const q = col.queen;
  if (col.queens2) {
    syncQueens(world, col);
    if (!col.queens2.length) return false;
    const A = world.ants;
    let b = 0; for (let k = 1; k < col.queens2.length; k++) if (A.hp[col.queens2[k].i] > A.hp[col.queens2[b].i]) b = k;
    const x = col.queens2.splice(b, 1)[0];
    Object.assign(q, { alive: true, i: x.i, hp: A.hp[x.i], maxHp: A.maxhp[x.i], layT: x.layT });
  } else if (col.queenX >= 1) {
    col.queenX--;
    Object.assign(q, { alive: true, hp: (q.maxHp || 600) * PQ.hp });
  } else return false;
  col.interregnum = false; col.alive = true;
  col.queenStats = col.queenStats || { adopted: 0, promoted: 0 }; col.queenStats.promoted++;
  AL.emit(world, 'queenPromoted', { col: col.id, n: queenCount(col) });
  return true;
}
// a big polygyne colony now and then takes in a newly mated queen by itself (hands-off players and rivals too)
function autoQueen(world, col, adults) {
  if (!col.sp.polygyne || !col.queen || !col.queen.alive || col.starving || world.env.winter) return false;
  if (world.t < PQ.autoFirst || adults < PQ.autoPop || world.t - (col._qAutoT || 0) < PQ.autoEvery) return false;
  if (!canAdopt(world, col, 'auto').ok) return false;
  col._qAutoT = world.t;
  return adoptQueen(world, col, 'auto');
}
// one queen's laying clock; rate = how fast it runs this second
function layTick(world, col, q, rate) {
  if (!HU.queenFed(world, q.i)) return;   // a hungry queen waits for her nurses
  q.layT -= rate;
  if (q.layT > 0) return;
  const two = !col.sp.polygyne && q.layT <= -T.LAY_INTERVAL;   // a lone queen running past two eggs' worth this second lays a second one
  q.layT = T.LAY_INTERVAL;
  // army ants lay in batches (bivouac.js): between batches the eggs she would have laid build up for the next one
  if (col.biv && AL.Bivouac && AL.Bivouac.banks(world, col)) { q.bank = Math.min(AL.Bivouac.TUNE.BANK_MAX, (q.bank || 0) + (two ? 2 : 1) * AL.Bivouac.TUNE.BATCH_BONUS); return; }
  layEgg(world, col);
  if (two) layTick(world, col, q, T.LAY_INTERVAL);
}
const adultsOf = col => { let n = 0; for (let k = 0; k < col.pop.length; k++) n += col.pop[k]; return n; };
// one egg into the nursery if there's room, sugar and (in auto mode) protein to raise it. true = laid
function layEgg(world, col, batch) {
  const s = col.stock;
  const roomy = col.brood.length < col.cap.nursery + 6;
  // auto mode doesn't lay more eggs than the protein in store can raise; a queued egg is always laid
  let hungry = 0; for (const b of col.brood) if (b.stage <= 1) hungry += AL.CASTES[b.caste].prot * T.BROOD_FOOD;
  // (a batch counts on the raids to come: about a crumb of protein per ant in the colony)
  const fed = col.eggQueue.length || hungry < s.protein + (col.broodFood ? col.broodFood.protein : 0) + 6 + (batch ? adultsOf(col) * 0.8 : 0);
  if (roomy && s.sugar >= (batch ? 8 : 4) && fed && (col.eggQueue.length || col.auto || batch)) {
    const caste = col.eggQueue.length ? col.eggQueue.shift() : autoCaste(col);
    s.sugar -= 0.25;
    col.brood.push({ caste, stage: 0, t: 0, starve: 0, slot: -1 });
    placeBrood(col);
    AL.emit(world, 'eggLaid', { col: col.id, caste });
    return true;
  }
  return false;
}

// ---- setup ------------------------------------------------------------------------------
function init(world, opts) {
  if (opts.bench && opts.benchOnly) return;
  for (const h of world.detailed || world.humans || [0]) { const c = world.colonies[h]; initColony(world, c, c.bot ? botOpts(c, opts) : opts); }
  world.nest = world.player.nest;   // this PC's nest (the side view); every person's colony has its own
}
// an AI rival's own start (the match options are the player's: flight result, mission stock, founding preset...)
function botOpts(col, opts) {
  const st = opts.start || {};
  return { start: { workers: st.rivalWorkers || Math.round(44 * (col.sp.start || 40) / 40), stock: { sugar: 80, protein: 30, water: 30 } }, aiLevel: opts.aiLevel };
}
function initColony(world, col, opts) {
  const A = world.ants, R = world.R;
  const nest = N.createNest(world, col, opts);
  col.nest = nest;
  col.enter = enterNest;
  col.queen = { alive: true, hp: 0, maxHp: 0, i: -1, layT: 2, traits: opts.queenTraits || {} };
  col.brood = []; col.eggQueue = []; col.auto = true; col.autoN = 0;
  col.disease = 0; col.spoiled = 0; col.starving = false; col.orders = col.orders || []; col.hotspots = col.hotspots || [];
  col.cap = { food: 40, water: 20 };
  col.siteTraits = opts.siteTraits || null;
  const st = opts.start || {};
  Object.assign(col.stock, { sugar: 70, protein: 30, water: 30 }, st.stock || {});
  // the nuptial flight's result: first queen down brings more reserves, a tired one fewer
  const rb = (opts.queenTraits && opts.queenTraits.reserveBonus) || 0;
  if (rb) { col.stock.sugar *= 1 + rb; col.stock.protein *= 1 + rb; }
  // the nursery's larva food (nurses carry it from the store, hunger.js)
  const bs = Math.min(4, col.stock.sugar), bp = Math.min(4, col.stock.protein);
  col.broodFood = { sugar: bs, protein: bp }; col.stock.sugar -= bs; col.stock.protein -= bp;
  // the queen in her chamber
  const qt = nest.tiles[CH.QUEEN];
  const qtile = qt.length ? qt[(qt.length / 2) | 0] : N.idx(nest, nest.entrance.c, 6);
  const [qx, qy] = N.centre(nest, qtile);
  const qi = A.spawn(col.id, C.QUEEN, L.NEST, qx, qy, 0, R);
  A.nest[qi] = A.home[qi] = col.hid != null ? col.hid : col.id;   // (a satellite's nest has its own id)
  const tr = col.queen.traits;
  A.hp[qi] = A.maxhp[qi] = AL.CASTES[C.QUEEN].hp * (tr.hpMul || 1);
  A.state[qi] = ST.N_QUEEN; A.life[qi] = 1e9;
  col.queen.i = qi; col.queen.hp = col.queen.maxHp = A.hp[qi];
  if (st.queen === false) { A.kill(qi); col.queen.alive = false; }
  // starting workers: a mix of castes, some already out foraging
  const nW = st.workers == null ? 40 : st.workers;
  const mixPattern = [C.WORKER, C.WORKER, C.FORAGER, C.WORKER, C.NURSE, C.FORAGER, C.WORKER, C.SOLDIER, C.WORKER, C.FORAGER];
  const open = [];
  for (let i = 0; i < nest.n; i++) if (nest.kind[i] === TILE.OPEN) open.push(i);
  for (let k = 0; k < nW; k++) {
    const caste = k === nW - 1 && nW > 20 ? C.SCOUT : mixPattern[k % mixPattern.length];
    if (caste === C.FORAGER && k % 3 !== 0) {
      const a = R() * AL.TAU, d = 20 + R() * 120;
      const i = A.spawn(col.id, caste, L.SURFACE, col.x + AL.cos(a) * d, col.y + AL.sin(a) * d, a, R);
      A.home[i] = col.hid != null ? col.hid : col.id;
      A.timer[i] = R() * 20; A.age[i] = R() * 200;
    } else {
      const t = open[(R() * open.length) | 0], [x, y] = N.centre(nest, t);
      const i = A.spawn(col.id, caste, L.NEST, x + (R() - 0.5) * 4, y + (R() - 0.5) * 4, R() * AL.TAU, R);
      A.nest[i] = A.home[i] = col.hid != null ? col.hid : col.id;
      A.timer[i] = R() * 3; A.age[i] = R() * 200; A.tx[i] = x; A.ty[i] = y;
    }
  }
  const brood = st.brood || [].concat(Array(6).fill(0), Array(4).fill(1), Array(3).fill(2)).map((s, k) => ({ caste: k % 5 === 4 ? C.NURSE : C.WORKER, stage: s }));
  for (const b of brood) col.brood.push({ caste: b.caste, stage: b.stage, t: R() * 0.8, starve: 0, slot: -1 });
  placeBrood(col);
  updateCaps(col);
}

// ---- entering the nest from the surface ----------------------------------------------------
enterNest._snap = 'life.enterNest';
function enterNest(world, i) {
  const A = world.ants, col = AL.homeOf(world, i), nest = col.nest;
  const e = nest.entrance, [x, y] = N.centre(nest, e.r * nest.cols + e.c);
  A.layer[i] = L.NEST; A.nest[i] = col.hid; A.home[i] = col.hid; A.x[i] = A.px[i] = x; A.y[i] = A.py[i] = y - 4; A.tx[i] = x; A.ty[i] = y;
  const k = A.carry[i];
  if (k === K.SUGAR || k === K.PROTEIN || k === K.SEED) goTo(world, i, F.FOOD, ACT.STORE);
  else if (k === K.WATER) goTo(world, i, nest.tiles[CH.WATER].length ? F.WATER : F.FOOD, ACT.STORE);
  else if (k === K.LEAF) goTo(world, i, nest.tiles[CH.FUNGUS].length ? F.FUNGUS : F.FOOD, ACT.STORE);
  else if (k === K.APHID) goTo(world, i, nest.tiles[CH.APHID].length ? F.APHID : F.FOOD, ACT.STORE);   // aphids.js
  else if (AL.Behavior && AL.Behavior.needsToEat(world, i)) { A.carry[i] = 0; goTo(world, i, F.FOOD, ACT.STORE); }   // home to eat: via the food store
  else { A.carry[i] = 0; decide(world, i); }
}

function goTo(world, i, field, act) {
  const A = world.ants;
  A.state[i] = ST.N_GOTO; A.task[i] = field; A.act[i] = act; A.timer[i] = 0;
}
function idle(world, i, secs) { const A = world.ants; A.state[i] = ST.N_IDLE; A.timer[i] = secs; A.act[i] = 0; }
// leave the nest; `intent` is the surface state to take up outside
function exitAs(world, i, intent) { const A = world.ants; goTo(world, i, F.ENTRANCE, ACT.EXIT); A.prev[i] = intent; }
// lie up until healed: fighters in the barracks, the others in the nursery, else right where it is
function rest(world, i) {
  const A = world.ants, nest = AL.homeOf(world, i).nest, ca = A.caste[i];
  let f = -1;
  if ((ca === C.SOLDIER || ca === C.MAJOR) && nest.tiles[CH.BARRACKS].length) f = F.BARRACKS;
  else if (nest.tiles[CH.NURSERY].length) f = F.NURSERY;
  if (f >= 0) {
    const v = nest.fields[f][N.tileOf(nest, A.x[i], A.y[i])];
    if (v !== N.FAR && v !== 0) { goTo(world, i, f, ACT.HEAL); return; }
  }
  A.state[i] = ST.N_HEAL; A.timer[i] = 0; A.act[i] = 0;
}

// ---- task choice --------------------------------------------------------------------------
function decide(world, i) {
  const A = world.ants, col = AL.homeOf(world, i), nest = col.nest, R = world.R, env = world.env, caste = A.caste[i];
  const out = !env.winter && env.rain < 0.35 && !col.recall;   // weather (or the mower alarm) keeps foragers home
  const nightK = env.night || 0;
  if (caste === C.QUEEN) { A.state[i] = ST.N_QUEEN; return; }
  const sore = needsRest(world, i, col);
  if (HU.decide(world, i, col, sore)) return;   // hungry: to the food store first (the wounded only when nearly empty); a nurse load in hand goes back
  if (sore) { rest(world, i); return; }   // wounded: heal first (no orders, no alarms) unless home is raided
  if (AL.Species && AL.Species.decide && AL.Species.decide(world, i, col, caste)) return;   // species hook (species.js): slave-makers idle, etc.
  if (caste === C.HONEYPOT) { if (nest.tiles[CH.FOOD].length) goTo(world, i, F.FOOD, ACT.HANG); else idle(world, i, 10); return; }
  if (env.winter) { idle(world, i, 15 + R() * 15); return; }
  // Collect orders (orders.js): its ants go back out for the next load until the food in the circle is gone
  if (!col.recall && AL.Orders && AL.Orders.collectJob && AL.Orders.collectJob(world, i, col)) return;
  // recruitment orders pull ants out
  if (col.orders && caste !== C.NURSE && !col.recall) {
    for (const o of col.orders) if (o.assigned < o.want && !o.done && !o.full && (!o.castes || o.castes.indexOf(caste) >= 0) && (o.hid == null || o.hid === col.hid)) { o.assigned++; A.wp[i] = 0; A.str[i] = o.id; exitAs(world, i, ST.RECRUIT); return; }
  }
  if (caste === C.SOLDIER || caste === C.MAJOR) {
    // raiders inside: guard the queen; trouble outside: rally to it
    if (col.hotspots && col.hotspots.some(h => h.nest && (h.hid == null || h.hid === col.hid))) { goTo(world, i, F.QUEEN, ACT.REST); return; }
    if (col.hotspots && col.hotspots.length && !col.recall && col.hotspots.some(h => h.hid == null || h.hid === col.hid)) { exitAs(world, i, ST.RALLY); return; }   // (another nest's alarm is not ours)
    if (R() < 0.25 && out) { exitAs(world, i, ST.GUARD); return; }
    if (nest.tiles[CH.BARRACKS].length) goTo(world, i, F.BARRACKS, ACT.REST); else idle(world, i, 6 + R() * 8);
    return;
  }
  if (caste === C.NURSE) { if (HU.feedJob(world, i, col)) return; if (AL.NestClimate && AL.NestClimate.moveJob(world, i, col)) return; if (nest.tiles[CH.NURSERY].length) goTo(world, i, F.NURSERY, ACT.NURSE); else idle(world, i, 5); return; }
  if (caste === C.FORAGER || caste === C.SCOUT) {
    if (out && R() < 0.9 - nightK * 0.5) exitAs(world, i, ST.WANDER); else idle(world, i, 6 + R() * 6);
    return;
  }
  // generalist workers: weighted by what the colony needs right now
  const corpses = nest.corpses.some(k => !k.taken);
  const brood = col.brood.length, carers = col.pop[C.NURSE] * 6 + (nest.nursing || 0) * 4;
  const feed = HU.feedNeed(world, col);   // the queen or the larvae need food carried (more so with no nurses)
  const w = [
    nest.frontier > 0 && col.sp.dig > 0 && (nest.diggers || 0) < 6 + nest.digCount * 0.6 ? 4 : 0,         // dig
    corpses ? 5 : 0,                                                                     // undertake
    feed ? (col.pop[C.NURSE] ? 2.5 : 4) : brood > carers && nest.tiles[CH.NURSERY].length ? 2.5 : 0,   // nurse
    out ? 2.2 * (1 - nightK * 0.6) * (col.starving ? 2 : 1) : 0,                         // forage (twice as keen with an empty store)
    1,                                                                                   // rest
  ];
  let sum = 0; for (const v of w) sum += v;
  let pick = R() * sum, k = 0; while (k < w.length - 1 && (pick -= w[k]) > 0) k++;
  if (k === 0) goTo(world, i, F.DIG, ACT.DIG);
  else if (k === 1) goTo(world, i, F.CORPSE, ACT.CORPSE);
  else if (k === 2) { if (!HU.feedJob(world, i, col)) { if (nest.tiles[CH.NURSERY].length) goTo(world, i, F.NURSERY, ACT.NURSE); else idle(world, i, 3); } }
  else if (k === 3) exitAs(world, i, ST.WANDER);
  else if (!(AL.NestClimate && AL.NestClimate.moveJob(world, i, col)) && !(AL.NestClimate && AL.NestClimate.lineJob(world, i, col))) idle(world, i, 4 + R() * 6);   // resting: brood runs with hardly any nurses, else line the walls (nestclimate.js)
}

// arrived at the end of a flow field
function arrive(world, i, tile) {
  const A = world.ants, col = AL.homeOf(world, i), nest = col.nest, R = world.R;
  if (HU.isErrand(A.act[i]) && HU.arrive(world, i, col)) return;   // eat, fetch or deliver food (hunger.js)
  if (A.act[i] >= 40 && AL.NestClimate && AL.NestClimate.arrive(world, i, col, tile)) return;   // move brood, line walls (nestclimate.js)
  switch (A.act[i]) {
    case ACT.EXIT: leaveNest(world, i); return;
    case ACT.STORE: {
      const k = A.carry[i];
      if (k) { const amt = k === K.SUGAR || k === K.PROTEIN || k === K.SEED ? AL.TUNE.TRIP || 1 : 1; AL.Sim.addStock(col, k, amt); AL.emit(world, 'foodDelivered', { col: col.id, hid: col.hid, kind: k, amt }); if (k === K.WATER) AL.emit(world, 'waterDropped', { col: col.id, x: A.x[i], y: A.y[i] }); A.carry[i] = 0; }   // (water: dropped into the reservoir)
      if (AL.Behavior) AL.Behavior.ate(world, i);   // at the food store: it eats (hunger.js)
      if (!needsRest(world, i, col) && (A.caste[i] === C.FORAGER || A.caste[i] === C.SCOUT || R() < 0.6)) exitAs(world, i, ST.WANDER); else decide(world, i);
      return;
    }
    case ACT.DIG: {
      const t = N.adjacentMark(nest, tile);
      if (t < 0) { decide(world, i); return; }
      A.state[i] = ST.N_DIG; A.tgt[i] = t; A.timer[i] = 0;
      return;
    }
    case ACT.NURSE: A.state[i] = ST.N_WORK; A.timer[i] = 8 + R() * 6; return;
    case ACT.MILL: { const ft = nest.tiles[CH.FOOD]; A.state[i] = ST.N_MILL; A.timer[i] = 9 + R() * 7; A.tgt[i] = ft.length ? ft[(R() * ft.length) | 0] : -1; return; }   // a harvester major finds a spot in the store to grind seed
    case ACT.REST: idle(world, i, 8 + R() * 10); return;
    case ACT.HEAL: A.state[i] = ST.N_HEAL; A.timer[i] = 0; A.act[i] = 0; return;
    case ACT.HANG: A.state[i] = ST.N_HANG; return;
    case ACT.CORPSE: {
      const k = nest.corpses.find(c => !c.taken && c.i === tile);
      if (!k) { nest.corpseDirty = true; decide(world, i); return; }
      k.taken = true; nest.corpses.splice(nest.corpses.indexOf(k), 1); nest.corpseDirty = true;
      A.carry[i] = K.CORPSE;
      if (nest.tiles[CH.MIDDEN].length) goTo(world, i, F.MIDDEN, ACT.MIDDEN); else exitAs(world, i, ST.DUMP);
      return;
    }
    case ACT.MIDDEN: A.carry[i] = 0; nest.middenFill++; decide(world, i); return;
    default: decide(world, i);
  }
}

// out through the entrance onto the surface
function leaveNest(world, i) {
  const A = world.ants, col = AL.homeOf(world, i), R = world.R;
  // out of this nest's door: it lives here (or, sent to another of the colony's hills, there: raids.js send)
  const mv = world.moves && world.moves.size ? world.moves.get(A.uid[i]) : undefined;
  if (mv != null) { world.moves.delete(A.uid[i]); const to = world.homes && world.homes[mv]; A.home[i] = to && !to.gone && to.id === A.col[i] ? mv : col.hid; }
  else A.home[i] = col.hid;
  // mower alarm: nobody goes out; wait by the door and think again
  if (col.recall) { idle(world, i, 3 + R() * 3); return; }
  const a = R() * AL.TAU;
  A.layer[i] = L.SURFACE;
  A.x[i] = A.px[i] = col.x + AL.cos(a) * 4; A.y[i] = A.py[i] = col.y + AL.sin(a) * 4; A.a[i] = a;
  A.timer[i] = 0; A.str[i] = A.prev[i] === ST.RECRUIT || A.prev[i] === ST.RAID || A.prev[i] === ST.COLLECT ? A.str[i] : 0; A.wf[i] = 0; A.turn[i] = 0;   // (the order or raid it goes out for)
  const intent = A.prev[i] || ST.WANDER;
  A.state[i] = intent;
  if (intent === ST.DUMP) {
    // carry the soil (or a body) out onto the mound and drop it there
    const d = col.moundR * (A.carry[i] === K.CORPSE ? 1.5 + R() * 0.6 : 0.45 + R() * 0.6);
    A.tx[i] = col.x + AL.cos(a) * d; A.ty[i] = col.y + AL.sin(a) * d;
  } else if (intent === ST.GUARD) {
    const d = col.moundR + 20 + R() * 50; A.tx[i] = col.x + AL.cos(a) * d; A.ty[i] = col.y + AL.sin(a) * d; A.timer[i] = 40 + R() * 40;
  } else if (intent === ST.RALLY) {
    const h = AL.Orders ? AL.Orders.hotFor(col, col.hid) : col.hotspots && col.hotspots[0];
    if (h) { A.tx[i] = h.x; A.ty[i] = h.y; } else A.state[i] = ST.WANDER;
  }
}

// DUMP state on the surface: walk to the drop point, drop soil (mound grows) or the body, go back in
function dumpHandler(world, i, dt) {
  const A = world.ants, col = AL.homeOf(world, i);
  const dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i];
  if (dx * dx + dy * dy < 16 || A.timer[i] > 12) {
    if (A.carry[i] === K.SOIL) { col.moundSoil += 1; AL.Colony.updateMound(col); world.fxq.push(1, A.x[i], A.y[i], K.SOIL); }
    else if (A.carry[i] === K.CORPSE) AL.Surface.dropCorpse(world.surface, A.x[i], A.y[i], col.id, 1);
    A.carry[i] = 0; A.state[i] = ST.HOMING; A.timer[i] = 0;
    return 0;
  }
  A.timer[i] += dt;
  A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 5, -6, 6);
  return 0;
}
// GUARD: patrol around a point, then go home
function guardHandler(world, i, dt, sense) {
  const A = world.ants, R = world.R;
  A.timer[i] -= dt;
  if (A.timer[i] <= 0 || (sense && AL.Behavior && AL.Behavior.needsToEat(world, i))) { A.state[i] = ST.HOMING; return 0; }   // done, or hungry
  if (sense) {
    const dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i];
    if (dx * dx + dy * dy > 50 * 50) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 4, -5, 5);
    else A.turn[i] = A.turn[i] * 0.5 + (R() - 0.5) * 3;
  }
  return 0;
}

// ---- nest ants, every tick ------------------------------------------------------------
function walk(world, i, nest, sp, dt, nextTileFn) {
  // move toward the current waypoint; at the waypoint ask for the next tile
  const A = world.ants;
  let dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i];
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1.2) {
    const cur = N.tileOf(nest, A.x[i], A.y[i]);
    const nt = nextTileFn(cur);
    if (nt < 0) return cur;
    const [cx, cy] = N.centre(nest, nt), R = world.R;
    A.tx[i] = cx + (R() - 0.5) * 4.5; A.ty[i] = cy + (R() - 0.5) * 4.5;
    dx = A.tx[i] - A.x[i]; dy = A.ty[i] - A.y[i]; d = Math.sqrt(dx * dx + dy * dy);
  }
  const wet = nest.water[N.tileOf(nest, A.x[i], A.y[i])] > 0.5 ? 0.45 : 1;
  const step = Math.min(d, sp * wet * dt);
  if (d > 0.001) {
    A.x[i] += dx / d * step; A.y[i] += dy / d * step;
    const ta = AL.atan2(dy, dx); A.a[i] += AL.wrap(ta - A.a[i]) * Math.min(1, dt * 12);
    A.anim[i] += step * 0.3;
  }
  return -1;
}

const NOWHERE = () => -1;
function tickNest(world, dt) {
  const cols = world.homes || world.colonies;   // every nest by id (colonies' own and satellites')
  let any = false;
  for (const c of cols) {
    if (!c) continue;
    const nest = c.nest; if (!nest) continue;
    any = true;
    if (nest.fieldDirty) N.rebuild(nest);
    if (nest.corpseDirty) N.rebuildCorpseField(nest);
    nest._dig = 0; nest._nurse = 0;
  }
  if (!any) return;
  const A = world.ants, R = world.R, n = A.high, HOST = A.nest;
  for (let i = 0; i < n; i++) {
    const st = A.state[i];
    if (!st || A.layer[i] !== L.NEST) continue;
    const host = cols[HOST[i]], nest = host && host.nest;
    if (!nest) continue;
    A.px[i] = A.x[i]; A.py[i] = A.y[i];
    const info = AL.CASTES[A.caste[i]];
    let sp = info.speed * world.colonies[A.col[i]].sp.speed * NEST_SPEED * (A.carry[i] ? T.CARRY_SLOW : 1);   // hauling slows it
    // fight injuries (injury.js): lost legs slow it; a headless ant just stumbles about the tunnels
    if ((A.legs[i] !== 63 || A.headless[i]) && AL.Injury) {
      sp *= AL.Injury.mulOf(A, i);
      if (A.headless[i] && st !== ST.N_QUEEN) {
        if (st !== ST.N_IDLE) { A.state[i] = ST.N_IDLE; A.carry[i] = 0; A.tgt[i] = -1; A.act[i] = 0; }
        walk(world, i, nest, sp, dt, cur => R() < 0.5 ? N.wanderTile(nest, cur, R) : -1);
        continue;
      }
    }
    switch (st) {
      case ST.N_QUEEN: A.a[i] = AL.sin(world.t * 0.3 + i) * 0.25; A.anim[i] += dt * 0.6; break;
      case ST.N_HANG: break;
      case ST.N_IDLE: {
        A.timer[i] -= dt;
        walk(world, i, nest, sp * 0.4, dt, cur => R() < 0.5 ? N.wanderTile(nest, cur, R) : -1);
        if (A.timer[i] <= 0) decide(world, i);
        break;
      }
      case ST.N_GOTO: {
        if (A.act[i] === ACT.DIG) nest._dig++;
        A.timer[i] += dt;
        const f = A.task[i];
        const cur = N.tileOf(nest, A.x[i], A.y[i]);
        const fv = nest.fields[f][cur];
        if (fv === N.FAR) {
          // can't get there (no such chamber, or cut off): store food where we stand, otherwise rethink
          if (A.act[i] === ACT.STORE || HU.isErrand(A.act[i])) { arrive(world, i, cur); break; }   // food errands too: eat / fetch / feed here
          if (A.act[i] === ACT.EXIT && A.timer[i] > 1) { idle(world, i, 3); break; }
          if (A.act[i] === ACT.CORPSE || A.act[i] === ACT.MIDDEN) { if (A.carry[i] === K.CORPSE) exitAs(world, i, ST.DUMP); else decide(world, i); break; }
          idle(world, i, 2 + R() * 2); break;
        }
        const res = walk(world, i, nest, sp, dt, c => fv === 0 ? -1 : N.nextTile(nest, f, c, R));
        if (res >= 0 && nest.fields[f][res] === 0) arrive(world, i, res);
        else if (A.timer[i] > 60) decide(world, i);
        break;
      }
      case ST.N_DIG: {
        nest._dig++;
        const t = A.tgt[i];
        if (!nest.mark[t] || nest.kind[t] === TILE.OPEN) { decide(world, i); break; }
        const [tx, ty] = N.centre(nest, t);
        A.a[i] = AL.atan2(ty - A.y[i], tx - A.x[i]);
        A.anim[i] += dt * 6;
        const dcol = world.colonies[A.col[i]], rate = dcol.sp.dig * (info.drag >= 2 ? 1.5 : 1) * (A.caste[i] === C.WORKER ? 1 : 0.6) * ((dcol.siteTraits && dcol.siteTraits.dig) || 1);
        const wood = nest.kind[t] === TILE.WOOD && world.colonies[A.col[i]].sp.wood ? 4 : 1;
        nest.prog[t] += dt * rate * wood / (N.DIG_BASE * N.HARD[nest.kind[t]]);
        if (R() < dt * 3) world.fxq.push(10, tx, ty, nest.kind[t]);
        if (nest.prog[t] >= 1) {
          N.excavate(nest, t, world);
          A.carry[i] = K.SOIL; exitAs(world, i, ST.DUMP);
        }
        break;
      }
      case ST.N_HEAL: {
        // lying up: settle on the spot and get up once healed (or when healing stops: hunger, or a raid for fighters)
        A.timer[i] += dt;
        walk(world, i, nest, sp * 0.3, dt, NOWHERE);
        const ca = A.caste[i];
        if (A.hp[i] >= A.maxhp[i] * HL.FULL || !canHeal(host) || (A.gut[i] < AL.HUNGER.HUNGRY * 0.5 && host.stock.sugar > 0.05 && HU.canEat(world, i)) || host.id !== A.col[i] || ((ca === C.SOLDIER || ca === C.MAJOR) && homeRaided(world, host))) decide(world, i);
        break;
      }
      case ST.N_MILL: {   // grinding: walks to its spot in the store, stays put, then sees what else needs doing
        A.timer[i] -= dt; A.anim[i] += dt * 2;
        const t = A.tgt[i];
        if (t >= 0 && nest && nest.kind[t] === N.TILE.OPEN) {
          const [tx, ty] = N.centre(nest, t), dx = tx - A.x[i], dy = ty + 2 - A.y[i], d = AL.hypot(dx, dy);
          if (d > 1.5) { const v = Math.min(d, info.speed * 0.4 * dt); A.x[i] += dx / d * v; A.y[i] += dy / d * v; A.a[i] = AL.atan2(dy, dx); A.anim[i] += dt * 8; }
        }
        if (A.timer[i] <= 0 || homeRaided(world, host)) decide(world, i);
        break;
      }
      case ST.N_WORK: {
        nest._nurse++;
        A.timer[i] -= dt;
        walk(world, i, nest, sp * 0.3, dt, cur => R() < 0.4 ? N.wanderTile(nest, cur, R) : -1);
        if (A.timer[i] <= 0) decide(world, i);
        break;
      }
      default: {
        const h = world.nestHandlers && world.nestHandlers[st];
        if (h) h(world, i, dt);
      }
    }
  }
  for (const c of cols) if (c.nest) { c.nest.diggers = c.nest._dig; c.nest.nursing = c.nest._nurse; }
}

// ---- economy, once per second -------------------------------------------------------------
function updateCaps(col) {
  const nest = col.nest;
  if (!nest) return;
  const hp = col.pop[C.HONEYPOT] || 0, per = T.HONEYPOT_STORE * (col.sp.honeyStore || 1);   // honeyStore: honeypot ants' big repletes
  col.cap.food = 60 + nest.caps.food + hp * per;
  col.cap.water = 20 + nest.caps.water;
  col.cap.nursery = Math.max(6, Math.round(nest.caps.nursery * (col.mods ? col.mods.nursery : 1)));   // research: bigger nursery
  col.cap.honey = hp * per;
}
function placeBrood(col) {
  if (AL.NestClimate && !col.nest.bivouac) { AL.NestClimate.place(col); return; }   // by room: nestclimate.js
  const nest = col.nest, tiles = nest.tiles[CH.NURSERY].length ? nest.tiles[CH.NURSERY] : nest.tiles[CH.QUEEN];
  if (!tiles.length) return;
  col.brood.forEach((b, k) => { b.slot = tiles[k % tiles.length]; b.sub = (k / tiles.length) | 0; });
  col.broodLayout = nest.layoutVersion;
}
function broodRate(world, col) {
  const nest = col.nest, temp = nest.nurseryTemp;
  const md = col.mods;   // research: brood speed and cold tolerance (research.js)
  const ncF = AL.NestClimate && !nest.bivouac ? AL.NestClimate.broodTempF(col) : null;   // (nestclimate.js: each in its own room)
  col._broodTf = ncF;
  const tempF = ncF != null ? ncF : AL.clamp(1 - Math.abs(temp - 27) / (18 * (md ? md.cold : 1)), 0.25, 1.05);
  const carers = col.pop[C.NURSE] * 8 + (nest.nursing || 0) * 3 + 2;
  const nurseF = 0.5 + 0.5 * Math.min(1, carers / Math.max(1, col.brood.length));
  const waterF = col.stock.water > 1 ? 1 : 0.7;
  const disF = col.disease > 50 ? 0.6 : 1;
  const nurseryF = nest.tiles[CH.NURSERY].length ? 1 : 0.6;
  col.broodF = { temp: tempF, nurse: nurseF, water: waterF, disease: disF, total: tempF * nurseF * waterF * disF * nurseryF * ((col.siteTraits && col.siteTraits.warmth) || 1) * (col.broodMul || 1) * (md ? md.brood : 1) * (col.layout ? col.layout.brood : 1) };   // broodMul: species.js; layout: nestplan.js (nursery by the queen)
  return col.broodF.total;
}
function autoCaste(col) {
  if (AL.Species && AL.Species.autoCaste) { const k = AL.Species.autoCaste(col); if (k >= 0) return k; }   // species egg plans (species.js)
  const p = col.pop, tot = Math.max(1, p.reduce((a, b) => a + b, 0));
  col.autoN++;
  if (p[C.NURSE] * 8 < col.brood.length && col.autoN % 3 === 0) return C.NURSE;
  if (p[C.SOLDIER] < tot * 0.1 && col.autoN % 4 === 0) return C.SOLDIER;
  if (tot >= 30 && col.autoN % 5 === 0 && p[C.SCOUT] + col.brood.filter(b => b.caste === C.SCOUT).length < Math.min(10, Math.max(2, Math.round(tot / 40)))) return C.SCOUT;   // a few pathfinders: ~1 per 40 adults
  if (p[C.FORAGER] < tot * 0.3 && col.autoN % 2 === 0) return C.FORAGER;
  return C.WORKER;
}
// sugar flow for the HUD: per-minute income and use, smoothed over ~30 s
function secondNest(world) {
  for (const h of world.detailed || world.humans || [0]) secondNestOf(world, world.colonies[h]);
  // satellites with their own nest (expansion.js addHome)
  const H = world.homes; if (H) for (let k = world.colonies.length; k < H.length; k++) if (H[k] && H[k].nest && !H[k].gone) secondNestOf(world, H[k]);
}
function secondNestOf(world, col) {
  if (!col || !col.nest || !col.queen) return;
  const s = col.stock, before = s.sugar, ate0 = col._sugAte || 0; col._sugConv = 0;
  secondNestCore(world, col);
  // eaten: by ants at the store since last second (col._sugAte) and by the queens and larvae from what nurses
  // brought them (col._sugUse, hunger.js), plus the rest (laying, healing, spoilage)
  const ateNow = (col._sugAte || 0) - ate0;
  const used = Math.max(0, before + col._sugConv - s.sugar - ateNow) + (col._sugAte || 0) + (col._sugUse || 0), got = (col._sugIn || 0) + col._sugConv; col._sugIn = 0; col._sugAte = 0; col._sugUse = 0;
  const F = col.sugarFlow || (col.sugarFlow = { inMin: 0, outMin: 0, n: 0 }), k = F.n < 30 ? 1 / ++F.n : 1 / 30;
  F.inMin += (got * 60 - F.inMin) * k; F.outMin += (used * 60 - F.outMin) * k;
}
AL.on('foodDelivered', (world, d) => { const c = d.hid != null && world.homes ? world.homes[d.hid] : world.colonies && world.colonies[d.col]; if (c && c.isPlayer && d.kind === K.SUGAR) c._sugIn = (c._sugIn || 0) + (d.amt || 1); });
function secondNestCore(world, col) {
  const nest = col && col.nest;
  if (!nest) return;
  const A = world.ants, R = world.R, env = world.env, s = col.stock;
  N.second(nest, world);
  if (col.broodLayout !== nest.layoutVersion) placeBrood(col);
  updateCaps(col);
  // ---- eating: every ant has its own stomach and eats at the food store (hunger.js; stomachs empty in the
  // per-ant loop below). Seeds keep: when sugar runs low some are eaten as sugar. ----
  let adults = 0; for (let k = 0; k < AL.NCASTE; k++) adults += col.pop[k];
  const winterK = env.winter ? 0.35 : 1;
  if (col.queens2) syncQueens(world, col);
  HU.secondStart(world, col);
  if (s.sugar < 10 && s.seeds > 0) { const m = Math.min(s.seeds, 0.6); s.seeds -= m; s.sugar += m * 0.7; col._sugConv = (col._sugConv || 0) + m * 0.7; }
  s.water = Math.max(0, s.water - adults * T.WATER_PER_ANT);
  // ---- spoilage: protein goes off, sugar keeps; honeypots hold sugar that never spoils ----
  const lay = col.layout ? col.layout.spoil : 1;   // (nestplan.js: a food store by the water reservoir keeps food fresh)
  const spoilP = s.protein * 0.0007 * lay, honey = col.cap.honey || 0;
  const spoilS = Math.max(0, s.sugar - honey) * 0.00015 * lay;
  s.protein -= spoilP; s.sugar -= spoilS;
  const food = s.sugar + s.protein + s.seeds;
  let over = 0;
  if (food > col.cap.food) { over = (food - col.cap.food) * 0.02; const k = 1 - over / food; s.sugar *= k; s.protein *= k; s.seeds *= k; }
  if (s.water > col.cap.water) s.water -= (s.water - col.cap.water) * 0.05;
  col.spoiled += spoilP + spoilS + over;
  col.spoilRate = spoilP + spoilS + over;
  // ---- leafcutters: cut leaves feed the fungus garden; the fungus feeds the colony ----
  if (col.sp.fungus) {
    const ft = nest.tiles[CH.FUNGUS].length;
    const conv = Math.min(s.leaves, ft * 0.09);
    s.leaves -= conv; s.fungus += conv * 1.6;
    const toP = Math.min(s.fungus, s.protein < 40 ? 1.5 : 0.15), toS = Math.min(s.fungus - toP, s.sugar < 80 ? 2 : 0.2);
    s.fungus -= toP + toS; s.protein += toP; s.sugar += toS; col._sugConv = (col._sugConv || 0) + toS;
  }
  // ---- brood: larvae eat what nurses carried to the nursery (col.broodFood) ----
  const rate0 = broodRate(world, col), bf = col.broodFood, hu = col.hunger, NCm = AL.NestClimate;
  hu.larvaP = 0; hu.larvaS = 0;
  for (let k = col.brood.length - 1; k >= 0; k--) {
    const b = col.brood[k], info = AL.CASTES[b.caste], rate = NCm ? rate0 * NCm.broodMul(col, b) : rate0;   // (its own room: nestclimate.js)
    // brood survives a short soaking; long under water it drowns
    if (b.slot >= 0 && nest.water[b.slot] > 0.5) { b.wet = (b.wet || 0) + 1; if (b.wet > 25) { col.brood.splice(k, 1); AL.emit(world, 'broodLost', { col: col.id, cause: 'flood' }); continue; } } else b.wet = 0;
    if (b.stage === 1) {
      const p = info.prot * (col.sp.broodCost || 1) * T.BROOD_FOOD / T.LARVA_T * rate, sg = info.sug * T.BROOD_FOOD / T.LARVA_T * rate;
      hu.larvaP += p; hu.larvaS += sg;
      if (bf.protein >= p && bf.sugar >= sg) { bf.protein -= p; bf.sugar -= sg; col._sugUse = (col._sugUse || 0) + sg; b.t += rate / T.LARVA_T; b.starve = 0; }
      else if (++b.starve > 90) { col.brood.splice(k, 1); AL.emit(world, 'broodLost', { col: col.id, cause: 'starve' }); continue; }
    } else b.t += rate / (b.stage === 0 ? T.EGG_T : T.PUPA_T) * (env.winter ? 0.2 : 1);
    if (b.t >= 1) {
      b.t = 0; b.stage++;
      if (b.stage >= 3) { emerge(world, col, b); col.brood.splice(k, 1); }
      else if (NCm && !nest.bivouac && !b.carry) { b.slot = -1; b.room = -1; col.broodLayout = -1; }   // laid in the best room for its new stage (a pupa: the dryer)
    }
  }
  // ---- the queens lay ----
  // laying climbs with colony size (sizeBonus); every extra queen (polygyne species) lays into the same brood
  const q = col.queen, wl = env.winter ? winterLay(col, adults) : 1;
  if (wl > 0) {
    const f = (col.sp.breed || 1) * sizeBonus(col.sp, adults) * (1 + Math.min(2, s.sugar / 250)) * (env.winter ? wl : layBrake(col, adults, world)) * ((col.layout && col.layout.lay) || 1);   // (lay: a bigger queen chamber, nestclimate.js)
    col.layBrake = env.winter ? wl : layBrake(col, adults, world);   // (the HUD shows it when it bites)
    if (q.alive) layTick(world, col, q, f * (q.traits.layMul || 1));
    if (col.queens2) for (const x of col.queens2) layTick(world, col, x, f * PQ.layMul);
  }
  if (col.sp.polygyne) autoQueen(world, col, adults);
  // ---- aging, hunger, sickness ----
  const sick = col.disease > 75;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== col.id) continue;
    A.age[i] += 1;
    if (A.age[i] > A.life[i]) { Combat.killAnt(world, i, 'age'); continue; }
    if (HU.secondAnt(world, col, i, winterK)) continue;   // the stomach empties; an empty one starves
    if (A.layer[i] === L.NEST && nest.water[N.tileOf(nest, A.x[i], A.y[i])] > 0.8 && A.caste[i] !== C.QUEEN) {
      if (Combat.hitAnt(world, i, 0.2, 'drown')) continue;   // (balance runs: 0.45 drowned whole nurseries in one storm)
      // swim for it: head up toward the entrance, whatever it was doing (raiders and fighters fight on)
      const s0 = A.state[i];
      if (s0 !== ST.N_RAID && s0 !== ST.FIGHT && s0 !== ST.N_TRANSIT && !(s0 === ST.N_GOTO && A.act[i] === ACT.REST)) goTo(world, i, F.ENTRANCE, ACT.REST);
    }
    if (sick && R() < 0.002) Combat.hitAnt(world, i, 4, 'disease');
    // wounds heal at home in the nest, not out on the surface (AL.HEAL): quickly, for a little sugar per hp,
    // and not at all while the colony starves; the queen and ants in a fight heal slowly (for free)
    if (A.hp[i] < A.maxhp[i] && !col.starving && (A.gut[i] > 0 || A.caste[i] === C.QUEEN) && A.layer[i] === L.NEST && A.nest[i] === col.id && !A.headless[i]) {   // (nothing heals a headless ant)
      if (A.caste[i] === C.QUEEN || A.state[i] === ST.FIGHT) A.hp[i] = Math.min(A.maxhp[i], A.hp[i] + HL.SLOW);
      else if (s.sugar > 0) {
        const h = Math.min(A.maxhp[i] * HL.RATE, A.maxhp[i] - A.hp[i], s.sugar / HL.SUGAR_PER_HP);
        A.hp[i] += h; s.sugar -= h * HL.SUGAR_PER_HP;
      }
    }
  }
  HU.secondEnd(world, col);
  // ---- disease from bodies lying in the tunnels and an overfull midden ----
  const bodies = nest.corpses.length, overM = Math.max(0, nest.middenFill - nest.caps.midden);
  // (nestplan.js: a midden far from the nursery halves its share, one right next to it doubles it and smells)
  const mF = col.layout ? col.layout.middenF : 1;
  col.disease = AL.clamp(col.disease + bodies * 0.22 + overM * 0.03 * mF + (mF > 1 && nest.middenFill > 2 ? 0.45 : 0) - 0.35, 0, 100);
  nest.middenFill = Math.max(0, nest.middenFill - 0.02);
  // bodies left too long rot away
  for (const k of nest.corpses) if (world.t - k.t > 400) k.rotten = true;
  if (nest.corpses.some(k => k.rotten)) { nest.corpses = nest.corpses.filter(k => !k.rotten); nest.corpseDirty = true; }
  // recruit orders that are filled and done get cleaned up elsewhere; alarm hotspots fade
  if (col.hotspots && !col.sat) col.hotspots = col.hotspots.filter(h => world.t - h.t < h.life);   // (a satellite's are the colony's list)
}
function emerge(world, col, b) {
  const A = world.ants, nest = col.nest, R = world.R;
  const [x, y] = N.centre(nest, b.slot >= 0 ? b.slot : N.idx(nest, nest.entrance.c, 2));
  const i = A.spawn(col.id, b.caste, L.NEST, x, y, R() * AL.TAU, R);
  if (i < 0) return;
  A.nest[i] = A.home[i] = col.hid;   // born in this nest (a satellite's own)
  A.hp[i] = A.maxhp[i] = AL.CASTES[b.caste].hp * (col.sp.hp || 1);
  A.tx[i] = x; A.ty[i] = y; idle(world, i, 1 + R() * 2);
  col.stats.born++;
  AL.emit(world, 'antBorn', { col: col.id, i, caste: b.caste, brood: b });
}

// after a founding the leftover reserves can be very lean: keep a small floor so colony play can start
AL.on('founded', (world, d) => {
  const c = world.colonies[d.col]; if (!c || !c.isPlayer) return;
  c.stock.sugar = Math.max(c.stock.sugar, 35); c.stock.protein = Math.max(c.stock.protein, 15); c.stock.water = Math.max(c.stock.water || 0, 15);
});
AL.registerSystem({
  id: 'life', order: 2,
  init(world, opts) {
    init(world, opts);
    world.surfaceHandlers[ST.DUMP] = dumpHandler;
    world.surfaceHandlers[ST.GUARD] = guardHandler;
  },
  tick: tickNest,
  second: secondNest,
});

AL.Life = { enterNest, initColony, botOpts, layEgg, queenLost, enterNest, decide, goTo, idle, exitAs, leaveNest, broodRate, updateCaps, placeBrood, emerge, autoCaste, healAt, wounded, canHeal, homeRaided, needsRest, rest,
  sizeBonus, layBrake, winterLay, maxQueens, extraQueens, queenCount, canAdopt, adoptQueen, promoteQueen, autoQueen };
if (NODE) module.exports = AL.Life;
})(typeof window !== 'undefined' ? window : globalThis);
