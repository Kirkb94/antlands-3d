// Antlands species mechanics for the four added species (data in data.js AL.SPECIES):
//   honeypot   (Myrmecocystus)  workers swell into repletes when sugar is plentiful; big, unspoiling honey store; weak fighters
//   harvester  (Pogonomyrmex)   seeds are the staple: majors mill stored seed into sugar + protein; eat less; strong sting;
//                               grass around the mound keeps shedding seed (they clear the disc around the mound)
//   slavemaker (Polyergus)      own workers barely forage, dig or nurse; they raid other nests for pupae, which hatch as
//                               CAPTIVE workers of the victim's species (drawn in that colony's colours) that do the work
//   bullet     (Paraponera)     tiny colonies of huge solitary hunters; heavy brood cost, slow laying, each ant has a name
// Everything hangs off AL.registerSystem / AL.on plus a few one-line hooks in life.js (decide, autoCaste, broodMul,
// appetite, broodCost, honeyStore) and the antBorn event carrying its brood item.
// Rival colonies use the abstract nest model (ai.js): AL.Species.aiSecond(world, col) runs once per second for each.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) {
  require('./data.js'); require('./sim.js'); require('./nest.js'); require('./life.js'); require('./combat.js'); require('./orders.js');
  try { require('./founding.js'); } catch (_) { /* founding is optional */ }
}
const ST = AL.ST, C = AL.CASTE, K = AL.CARRY, L = AL.LAYER, T = AL.TUNE;

// custom ant states (stage modules use ids >= 40; 44 and 52/53 are taken)
ST.S_BRAID = 60;    // surface: a slave-maker raider marching on a nest to steal brood (A.task = target colony)
ST.S_NBROOD = 61;   // nest: a raider inside the player's nest heading for the nursery

const CFG = {
  // honeypot ants
  HP_SHARE: 0.28,         // at most this share of adults become repletes
  HP_EVERY: 3,            // seconds between conversions
  HONEY_KEEP: 35, HONEY_LOW: 15, HONEY_RATE: 1.5,   // sugar kept loose / level where repletes feed the store / units per second
  // balance (Nov 2026), rivals only: with the honey bank full the foragers hunt (Myrmecocystus take termites and other
  // insects): protein short, banked honey above HUNT_KEEP buys protein at HUNT_COST honey each, up to HUNT_MAX a second.
  // Rival honeypots sat on 500+ honey with no protein for brood, shrank from 10 minutes on and never survived.
  HUNT_KEEP: 40, HUNT_COST: 2, HUNT_MAX: 0.5, HUNT_BELOW: 30,
  // harvester ants
  MILL_BASE: 0.2, MILL_MAJOR: 0.12, MILL_ANT: 0.003,   // seeds milled per second
  SEED_SUGAR: 0.8, SEED_PROT: 0.35,                     // what one milled seed yields
  MILL_AI: 0.75,          // ... in a rival's abstract nest (balance, Nov 2026: harvester rivals won 10 of 24 once the slave-makers were reined in)
  GRASS_PATCHES: 2, GRASS_REGEN: 0.05, GRASS_MAX: 60,   // renewing seed patches near a harvester mound
  // slave-makers
  SM_LAZY: 0.8,           // chance an own (non-soldier) worker just rests instead of working
  SM_CAPTIVE_START: 0.6,  // share of the starting workers that are captives
  SM_HOST_WORKERS: 8,     // after a founding: host workers adopted with the usurped nest
  SM_CARE: 6,             // brood items one captive can tend
  SM_AI_CARE: 4,          // ... in a rival's abstract nest (balance, Nov 2026: at 6 a dozen captives raised a whole soldier caste)
  SM_SHORT: 150,          // food is short below this many seconds of the colony's upkeep: captives and own workers forage
  RAID_FIRST: [240, 360], RAID_GAP: [150, 270], RAID_MIN: 6,
  // balance (Nov 2026): a rival's raiders at another rival's (abstract) nest only carry off pupae and big larvae
  // (fed brood at least this far along). Taking every egg and larva left the slave-makers' neighbours with no brood
  // at all (~150 items a match) and fed the slave-makers ~150 free captives; a raid that finds none turns home.
  SM_AI_PUPA: 0.5,
  // bullet ants
  BULLET_BROOD: 4,        // starting brood
  // army ants (rivals): a larva or pupa carried off in a raid on another nest is worth this much protein (preyIn)
  PREY_PROT: 3,
};

// per-ant host colony for captives (which colony's colours they wear); lazily sized to the ant store
function hosts(A) { if (!A.host || A.host.length < A.cap) { const h = new Uint8Array(A.cap); if (A.host) h.set(A.host); A.host = h; } return A.host; }
const sumIns = ins => { let n = 0; for (let k = 0; k < ins.length; k++) n += ins[k]; return n; };
const adultsOf = col => { let n = 0; for (let k = 0; k < col.pop.length; k++) n += col.pop[k]; return n; };
function nearestOther(world, col, test) {
  let best = null, bd = Infinity;
  for (const c of world.colonies) {
    if (c === col || !c.alive || (test && !test(c))) continue;
    const d = AL.dist2(c.x, c.y, col.x, col.y); if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// ---- bullet ant names: every ant matters ------------------------------------------------------
const SYL = ['ka', 'to', 'ri', 'na', 'ba', 'lu', 'ma', 'po', 'ti', 'ra', 'zé', 'qui', 'ya', 'ndi', 'ca', 'jú', 'pa', 'ro', 'ta', 'wa'];
function nameOf(uid) {
  let h = Math.imul(uid ^ 0x9e3779b9, 2654435761) >>> 0;
  const a = SYL[h % SYL.length], b = SYL[(h >>> 8) % SYL.length], c = (h >>> 16) % 3 === 0 ? SYL[(h >>> 20) % SYL.length] : '';
  const s = a + b + c; return s[0].toUpperCase() + s.slice(1);
}

// ---- helpers for the player's detailed nest ----------------------------------------------------
function nestSpawn(world, col, caste, host) {
  const A = world.ants, N = AL.Nest, nest = col.nest, R = world.R;
  const tiles = nest.tiles[N.CH.NURSERY].length ? nest.tiles[N.CH.NURSERY] : nest.tiles[N.CH.QUEEN].length ? nest.tiles[N.CH.QUEEN] : [N.idx(nest, nest.entrance.c, 2)];
  const [x, y] = N.centre(nest, tiles[(R() * tiles.length) | 0]);
  const i = A.spawn(col.id, caste, L.NEST, x + (R() - 0.5) * 4, y + (R() - 0.5) * 4, R() * AL.TAU, R);
  if (i < 0) return -1;
  A.hp[i] = A.maxhp[i] = AL.CASTES[caste].hp * (col.sp.hp || 1); A.tx[i] = x; A.ty[i] = y; A.timer[i] = 1 + R() * 3; A.age[i] = R() * 200;
  if (host != null) hosts(A)[i] = host;
  return i;
}
// turn a live ant into another caste in place (a worker swelling into a replete, a captive at the start)
function recaste(world, i, caste, col) {
  const A = world.ants, f = A.hp[i] / Math.max(1, A.maxhp[i]);
  A.caste[i] = caste; A.maxhp[i] = AL.CASTES[caste].hp * (col.sp.hp || 1); A.hp[i] = A.maxhp[i] * f;
  A.life[i] = Math.max(A.life[i], A.age[i] + AL.CASTES[caste].life * 0.6);
}
function colAnts(world, col, fn) { const A = world.ants; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col.id && A.caste[i] !== C.QUEEN) fn(i); }

// ---- starting colonies ---------------------------------------------------------------------------
function setupColony(world, col) {
  const sp = col.sp, A = world.ants, R = world.R;
  if (col._spSetup) return; col._spSetup = true;
  if (sp.repletes) {
    // a few workers already hang in the store as repletes
    if (col.nest) { let n = 3; colAnts(world, col, i => { if (n > 0 && A.layer[i] === L.NEST && A.caste[i] === C.WORKER) { recaste(world, i, C.HONEYPOT, col); AL.Life.goTo(world, i, AL.Nest.F.FOOD, AL.ACT.HANG); n--; } }); }
    else if (col.inside) { const n = Math.min(3, col.inside[C.WORKER]); col.inside[C.WORKER] -= n; col.inside[C.HONEYPOT] += n; }
    col.stock.sugar += 30;
  }
  if (sp.seeds) {
    col.stock.seeds += 40;
    if (col.nest) { let n = 2; colAnts(world, col, i => { if (n > 0 && A.layer[i] === L.NEST && A.caste[i] === C.WORKER) { recaste(world, i, C.MAJOR, col); n--; } }); }
    else if (col.inside) { const n = Math.min(2, col.inside[C.WORKER]); col.inside[C.WORKER] -= n; col.inside[C.MAJOR] += n; }
  }
  if (sp.raider) {
    // the queen took over a host nest: most of the workers are the host's
    const host = nearestOther(world, col), hid = host ? host.id : col.id;
    col.capHost = hid;
    // ... and the queen's own daughters are all sickle-jawed raiders
    if (col.nest) colAnts(world, col, i => { const k = A.caste[i]; if (k === C.WORKER || k === C.FORAGER || k === C.NURSE) { if (R() < CFG.SM_CAPTIVE_START / 0.8) { recaste(world, i, C.CAPTIVE, col); hosts(A)[i] = hid; } else recaste(world, i, C.SOLDIER, col); } });
    else if (col.inside) {
      let moved = 0;
      for (const k of [C.WORKER, C.FORAGER]) { const n = Math.floor(col.inside[k] * CFG.SM_CAPTIVE_START); col.inside[k] -= n; moved += n; col.inside[C.SOLDIER] += Math.floor(col.inside[k] * 0.7); col.inside[k] -= Math.floor(col.inside[k] * 0.7); }
      col.inside[C.CAPTIVE] += moved;
      colAnts(world, col, i => { if (A.layer[i] === L.SURFACE && R() < CFG.SM_CAPTIVE_START) { recaste(world, i, C.CAPTIVE, col); hosts(A)[i] = hid; } });
    }
  }
  if (sp.solitary) {
    // a tiny colony: keep sp.start ants (a mix of foragers and workers) and a little brood
    const keep = sp.start || 14;
    if (col.nest) {
      const mine = []; colAnts(world, col, i => mine.push(i));
      for (let k = keep; k < mine.length; k++) A.kill(mine[k]);
      col.brood.length = Math.min(col.brood.length, CFG.BULLET_BROOD); AL.Life.placeBrood(col);
      colAnts(world, col, i => { A.life[i] *= sp.life || 1; });
    } else if (col.inside) {
      const tot = sumIns(col.inside) + col.surf, f = Math.min(1, keep / Math.max(1, tot));
      for (let k = 0; k < col.inside.length; k++) if (k !== C.QUEEN) col.inside[k] = Math.round(col.inside[k] * f);
      colAnts(world, col, i => { if (A.layer[i] === L.SURFACE && R() > f) A.kill(i); });
      if (col.broodQ) col.broodQ.length = Math.min(col.broodQ.length, 3);
    }
  }
}

// after a founding: host workers adopt a slave-maker queen (Polyergus queens usurp a host nest)
AL.on('founded', (world, d) => {
  const col = world.colonies && world.colonies[d.col]; if (!col || !col.sp.raider) return;
  const host = nearestOther(world, col), hid = host ? host.id : col.id; col.capHost = hid;
  const n = CFG.SM_HOST_WORKERS;
  if (col.nest) for (let k = 0; k < n; k++) nestSpawn(world, col, C.CAPTIVE, hid);
  else if (col.inside) col.inside[C.CAPTIVE] += n;
});

// a new adult: captives take their host's colours; long-lived species live longer
AL.on('antBorn', (world, d) => {
  const col = world.colonies && world.colonies[d.col], A = world.ants; if (!col || !A.state[d.i]) return;
  if (d.brood && d.brood.host != null) hosts(A)[d.i] = d.brood.host;
  if (col.sp.life) A.life[d.i] *= col.sp.life;
});

// ---- the life.js hooks ---------------------------------------------------------------------------
// task choice for a nest ant; return true when handled
function decide(world, i, col, caste) {
  const sp = col.sp;
  // harvester majors mill: while the colony needs sugar or protein and there's seed in store, most go and grind it
  if (sp.seeds && caste === C.MAJOR && col.nest && col.stock.seeds >= 1 && (col.stock.sugar < 160 || col.stock.protein < 50) &&
      col.nest.tiles[AL.Nest.CH.FOOD].length && !(col.hotspots && col.hotspots.length) && world.R() < 0.65) { AL.Life.goTo(world, i, AL.Nest.F.FOOD, AL.ACT.MILL); return true; }
  if (!sp.raider || caste === C.SOLDIER || caste === C.SCOUT || caste === C.MAJOR || caste === C.HONEYPOT) return false;
  if (col.orders && col.orders.some(o => !o.done && !o.full && o.assigned < o.want)) return false;
  // hands-off fix (hunger pass): the food runs short when the store holds less than a couple of minutes of what the
  // colony eats (a fixed 12 sugar was nothing for a big colony of sickle-jawed soldiers), and then the captives and the
  // colony's own workers go out foraging first instead of mostly digging and resting (the generic worker mix)
  const env = world.env, short = col.starving || col.stock.sugar < Math.max(12, AL.Colony.upkeep(col) * CFG.SM_SHORT);
  if (short && !env.winter && env.rain < 0.35 && !col.recall && world.R() < 0.6) { AL.Life.exitAs(world, i, ST.WANDER); return true; }
  if (caste === C.CAPTIVE) return false;
  // Polyergus workers can't forage, dig or feed brood well: they groom and wait for the next raid
  // balance (final pass): a hungry colony's own workers do go out and forage, badly but enough to stave off
  // starvation, so a slave-maker player who hasn't raided yet isn't simply starved out
  if (short) return false;
  if (!env.winter && world.R() < CFG.SM_LAZY) { AL.Life.idle(world, i, 8 + world.R() * 10); return true; }
  return false;
}
// species egg plans for the queen's automatic mix; -1 = use the default plan
function autoCaste(col) {
  const sp = col.sp, p = col.pop; let tot = 0; for (let k = 0; k < p.length; k++) tot += p[k];
  col._spN = (col._spN || 0) + 1;
  if (sp.seeds && p[C.MAJOR] < Math.max(2, tot * 0.08) && col._spN % 4 === 0) return C.MAJOR;    // big-headed seed millers
  if (sp.raider) {
    const own = tot - p[C.CAPTIVE];
    if (p[C.SCOUT] < 2 && col._spN % 7 === 0) return C.SCOUT;
    if (col.starving || col.stock.sugar < Math.max(12, AL.Colony.upkeep(col) * CFG.SM_SHORT)) return C.WORKER;   // food short: no more mouths that can't forage
    return p[C.SOLDIER] < own * 0.6 ? C.SOLDIER : C.WORKER;                                     // raiders, never nurses
  }
  if (sp.solitary) {
    if (p[C.NURSE] * 4 < col.brood.length && col._spN % 3 === 0) return C.NURSE;
    return p[C.FORAGER] < tot * 0.55 ? C.FORAGER : C.WORKER;                                   // solitary hunters
  }
  return -1;
}

// ---- deliveries and break-ins (wrapped per colony) -------------------------------------------------
function enterWrap(orig) {
  const f = function (world, i) {
    const A = world.ants, col = world.colonies[A.col[i]], k = A.carry[i];
    // a defender fleeing a slave raid hides deep in an abstract nest until the raid is over
    if (A.panic && A.panic[i]) {
      A.panic[i] = 0;
      if (col.inside && col._panicT != null && world.t - col._panicT < 4 && !k) { const h = col._hid || (col._hid = new Float32Array(AL.NCASTE)); h[A.caste[i]]++; A.kill(i); return; }
    }
    if (k === K.BROOD) { captiveHome(world, col, i); A.carry[i] = 0; }
    else if (k === K.PROTEIN && !col.isPlayer && AL.AI && AL.AI.twist(col).prey > 1) AL.Sim.addStock(col, k, AL.AI.twist(col).prey - 1);   // (fire and army rivals: ai.js prey)
    else if (col.sp.carry > 1 && k >= K.SUGAR && k <= K.SEED) {
      // bullet ants haul big loads: a nectar droplet or a chunk of prey is worth several crumbs
      const extra = col.sp.carry - 1;
      AL.Sim.addStock(col, k, extra);
      if (col.isPlayer) AL.emit(world, 'foodDelivered', { col: col.id, kind: k, amt: extra });
    }
    return orig.call(this, world, i);
  };
  f._sp = true; f.orig = orig; return f;
}
function siegeWrap(orig) {
  const f = function (world, i) { if (raidIn(world, i, this) || preyIn(world, i, this)) return; return orig.call(this, world, i); };
  f._sp = true; f.orig = orig; return f;
}
function ensureWraps(world, col) {
  if (col.enter && !col.enter._sp) col.enter = enterWrap(col.enter);
  if (col.siegeIn && !col.siegeIn._sp) col.siegeIn = siegeWrap(col.siegeIn);
}
// a raider carried a stolen pupa home: it becomes captive brood
function captiveHome(world, col, i) {
  const A = world.ants, host = hosts(A)[i];
  if (col.nest && col.brood) { col.brood.push({ caste: C.CAPTIVE, stage: 2, t: 0.15, starve: 0, slot: -1, host }); AL.Life.placeBrood(col); }
  else if (col.broodQ) col.broodQ.push({ caste: C.CAPTIVE, t: 0.6, fed: true, host });
  else return;
  col.capHost = host;
  const s = col.spStats || (col.spStats = { captured: 0, stolenFrom: 0 }); s.captured++;
  AL.emit(world, 'broodCaptured', { col: col.id, host });
}
// a slave-maker ant at an abstract rival nest: grab a pupa if the defenders let it (propaganda pheromone:
// the more raiders arrive together, the more the defenders scatter). Returns true when it got one.
function raidIn(world, i, target) {
  const A = world.ants, me = world.colonies[A.col[i]];
  if (!me || !me.sp.raider || A.caste[i] === C.CAPTIVE || A.carry[i] || target === me) return false;
  const q = target.broodQ; if (!q || !q.length || !target.inside) return false;
  const best = pupaOf(q, me.isPlayer ? -1 : CFG.SM_AI_PUPA); if (best < 0) return false;
  const r = target._smRaid || (target._smRaid = { n: 0, t: world.t });
  r.n = r.n * AL.exp(-(world.t - r.t) / 20) + 1; r.t = world.t;
  // (a nest that is easy to hold - carpenters' wood galleries, ai.js nestDef - hides its brood better too)
  const ins = target.inside, def = (ins[C.SOLDIER] + ins[C.MAJOR] * 2 + ins[C.WORKER] * 0.25 + ins[C.FORAGER] * 0.15) * ((AL.AI && AL.AI.twist && AL.AI.twist(target).nestDef) || 1);
  const p = AL.clamp(r.n / (r.n + def * 0.35 / ((me.mods && me.mods.propaganda) || 1)), 0.1, 0.95);   // research/perk: mods.propaganda
  // the defenders notice either way
  target.hotspots = [{ x: target.x, y: target.y, t: world.t, life: 15 }];
  if (target.ai) target.ai.lastSeen = world.t;
  if (world.R() > p) return false;   // caught at the door: it goes in and fights instead
  const b = q.splice(best, 1)[0];
  grab(world, i, b.host != null ? b.host : target.id, target);
  return true;
}
// the most grown pupa (or big larva) in an abstract brood queue, -1 if there is none worth carrying off: a rival's
// raiders take fed brood at least minT along; a player's take the most grown item, fed or not, as before (minT < 0)
function pupaOf(q, minT) {
  if (minT == null) minT = CFG.SM_AI_PUPA;
  let best = -1, bv = -1;
  for (let k = 0; k < q.length; k++) { const v = (q[k].fed ? 1 : 0) + q[k].t; if (v > bv && (minT < 0 || (q[k].fed && q[k].t >= minT))) { bv = v; best = k; } }
  return best;
}
// a rival army ant raiding an abstract nest: Eciton raids are hunts, and other ants' brood is their main prey. If the
// defenders let it (odds like a slave raid's, without the propaganda), it carries off a larva or pupa as food
// (worth CFG.PREY_PROT protein to its colony). Returns true when it got one.
function preyIn(world, i, target) {
  const A = world.ants, me = world.colonies[A.col[i]];
  if (!me || !me.sp.nomad || me.isPlayer || A.carry[i] || target === me || A.state[i] !== ST.RAID) return false;
  const q = target.broodQ; if (!q || !q.length || !target.inside) return false;
  const r = target._prey || (target._prey = { n: 0, t: world.t });
  r.n = r.n * AL.exp(-(world.t - r.t) / 20) + 1; r.t = world.t;
  const ins = target.inside, def = (ins[C.SOLDIER] + ins[C.MAJOR] * 2 + ins[C.WORKER] * 0.25 + ins[C.FORAGER] * 0.15) * ((AL.AI && AL.AI.twist && AL.AI.twist(target).nestDef) || 1);
  const p = AL.clamp(r.n / (r.n + def * 0.5), 0.1, 0.9);
  if (world.R() > p) return false;   // caught at the door: it goes in and fights
  let best = 0; for (let k = 1; k < q.length; k++) if ((q[k].fed ? 1 : 0) + q[k].t > (q[best].fed ? 1 : 0) + q[best].t) best = k;
  q.splice(best, 1);
  me.stock.protein += CFG.PREY_PROT - 1;   // (it carries the last crumb home)
  A.carry[i] = K.PROTEIN; A.state[i] = ST.RETURN; A.str[i] = 1.2; A.timer[i] = 0; A.a[i] += Math.PI; A.tgt[i] = -1;
  const ts = target.spStats || (target.spStats = { captured: 0, stolenFrom: 0 }); ts.stolenFrom++;
  AL.emit(world, 'broodEaten', { col: me.id, from: target.id, x: target.x, y: target.y });
  return true;
}
function grab(world, i, host, target) {
  const A = world.ants, me = world.colonies[A.col[i]];
  A.carry[i] = K.BROOD; hosts(A)[i] = host;
  A.state[i] = ST.RETURN; A.str[i] = 1.6; A.timer[i] = 0; A.a[i] += Math.PI; A.tgt[i] = -1;
  const ts = target.spStats || (target.spStats = { captured: 0, stolenFrom: 0 }); ts.stolenFrom++;
  AL.emit(world, 'broodStolen', { col: me.id, from: target.id, x: target.x, y: target.y });
}
// a raider broke into the player's detailed nest: slave-makers go for the nursery instead of the queen
AL.on('breakIn', (world, d) => {
  const target = world.colonies && world.colonies[d.target], A = world.ants;
  if (!target || !target.nest || !target.brood) return;
  const me = world.colonies[d.col]; if (!me || !me.sp.raider) return;
  for (let i = 0; i < A.high; i++) if (A.state[i] === ST.N_RAID && A.col[i] === d.col && A.layer[i] === L.NEST && !A.carry[i] && A.caste[i] !== C.CAPTIVE && A.timer[i] === 0) { A.state[i] = ST.S_NBROOD; A.timer[i] = 0.001; }
});
function nestBroodHandler(world, i, dt) {
  const A = world.ants, N = AL.Nest, R = world.R, P = (world.homes || world.colonies)[A.nest[i]], nest = P && P.nest;
  if (!nest || !P.brood) return;
  A.px[i] = A.x[i]; A.py[i] = A.y[i];
  A.timer[i] += dt;
  const carrying = A.carry[i] === K.BROOD;
  const f = carrying ? N.F.ENTRANCE : (nest.tiles[N.CH.NURSERY].length ? N.F.NURSERY : N.F.QUEEN);
  const cur = N.tileOf(nest, A.x[i], A.y[i]);
  if (!carrying && (nest.fields[f][cur] === 0 || nest.chamber[cur] === N.CH.NURSERY)) {
    if (!P.brood.length) { A.state[i] = ST.N_RAID; return; }
    let best = 0; for (let k = 1; k < P.brood.length; k++) if (P.brood[k].stage * 2 + P.brood[k].t > P.brood[best].stage * 2 + P.brood[best].t) best = k;
    const b = P.brood.splice(best, 1)[0]; AL.Life.placeBrood(P);
    A.carry[i] = K.BROOD; hosts(A)[i] = b.host != null ? b.host : P.id;
    const ts = P.spStats || (P.spStats = { captured: 0, stolenFrom: 0 }); ts.stolenFrom++;
    AL.emit(world, 'broodStolen', { col: A.col[i], from: P.id, x: P.x, y: P.y });
    return;
  }
  if (carrying && nest.fields[f][cur] === 0) {
    const a = R() * AL.TAU;
    A.layer[i] = L.SURFACE; A.x[i] = A.px[i] = P.x + AL.cos(a) * 5; A.y[i] = A.py[i] = P.y + AL.sin(a) * 5; A.a[i] = a;
    A.state[i] = ST.RETURN; A.str[i] = 0.6; A.timer[i] = 0;
    return;
  }
  if (nest.fields[f][cur] === N.FAR || A.timer[i] > 90) { A.state[i] = ST.N_RAID; return; }
  let dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i], d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1.2) {
    const nt = N.nextTile(nest, f, cur, R);
    if (nt >= 0) { const [cx, cy] = N.centre(nest, nt); A.tx[i] = cx + (R() - 0.5) * 4; A.ty[i] = cy + (R() - 0.5) * 4; }
    dx = A.tx[i] - A.x[i]; dy = A.ty[i] - A.y[i]; d = Math.sqrt(dx * dx + dy * dy);
  }
  const sp = AL.CASTES[A.caste[i]].speed * 0.55 * (carrying ? AL.TUNE.CARRY_SLOW : 1) * (AL.Injury ? AL.Injury.mulOf(A, i) : 1), st = Math.min(d, sp * dt);   // (lost legs slow it)
  if (d > 0.001) { A.x[i] += dx / d * st; A.y[i] += dy / d * st; A.a[i] = AL.atan2(dy, dx); A.anim[i] += st * 0.3; }
}
// surface: a rival slave-maker raiding party marching on a nest (target colony in A.task)
function broodRaidHandler(world, i, dt, sense) {
  const A = world.ants, tgt = world.colonies[A.task[i]];
  if (!tgt || !tgt.alive || A.carry[i]) { A.state[i] = A.carry[i] ? ST.RETURN : ST.HOMING; return 0; }
  const dx = tgt.x - A.x[i], dy = tgt.y - A.y[i], d2 = dx * dx + dy * dy;
  world.pher.alarm[A.col[i]].deposit(A.x[i], A.y[i], 0.05 * dt * 30);
  if (d2 < AL.pow(tgt.moundR * 0.35 + 6, 2)) {
    if (tgt.nest) { AL.Orders.breakIn(world, i, tgt); return 2; }
    if (raidIn(world, i, tgt)) return 0;
    if (tgt.broodQ && pupaOf(tgt.broodQ) < 0) { A.state[i] = ST.HOMING; A.timer[i] = 0; return 0; }   // no pupae left: home
    const si = tgt.siegeIn && (tgt.siegeIn.orig || tgt.siegeIn);
    if (si) { si.call(tgt, world, i); return 2; }
    A.state[i] = ST.HOMING; return 0;
  }
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 3.5, -5, 5) + (world.R() - 0.5) * 1.2;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  world.handlerSpeed = 1.1;
  return 0;
}
// the player (or any detailed-nest slave-maker) draws a Recruit path: own raiders answer first, soldiers before
// workers, so the captives stay home and keep working. A path that ends on a rival mound is a slave raid.
AL.on('recruitOrder', (world, d) => {
  const col = world.colonies && world.colonies[d.col], o = d.order, A = world.ants;
  if (!col || !col.sp.raider || !col.nest || !o) return;
  const end = o.pts[o.pts.length - 1];
  const tgt = nearestOther(world, col, c => AL.dist2(c.x, c.y, end.x, end.y) < AL.pow(c.moundR + 120, 2));
  if (tgt) o.raidOn = tgt.id;
  for (const pass of [C.SOLDIER, -1]) for (let i = 0; i < A.high && o.assigned < o.want; i++) {
    if (!A.state[i] || A.col[i] !== col.id || A.layer[i] !== L.NEST) continue;
    const k = A.caste[i];
    if (k === C.CAPTIVE || k === C.QUEEN || k === C.HONEYPOT || k === C.NURSE || (pass >= 0 ? k !== pass : k === C.SOLDIER)) continue;
    const st = A.state[i]; if (st !== ST.N_IDLE && st !== ST.N_WORK && st !== ST.N_GOTO) continue;
    if (A.carry[i] || A.prev[i] === ST.RECRUIT) continue;
    o.assigned++; A.wp[i] = 0; A.str[i] = o.id; AL.Life.exitAs(world, i, ST.RECRUIT);
  }
  if (tgt) AL.emit(world, 'slaveRaid', { col: col.id, target: tgt.id, n: o.assigned });
});
// propaganda pheromone: when a slave-maker raiding party closes on a nest, many defenders panic and flee
// inside instead of fighting (Polyergus and Formica sanguinea really do this)
function propaganda(world) {
  const A = world.ants, cols = world.colonies, R = world.R;
  let any = false; for (const c of cols) if (c.alive && c.sp.raider) { any = true; break; }
  if (!any) return;
  const n = cols.length, cx = new Float32Array(n), cy = new Float32Array(n), cnt = new Uint16Array(n), pk = new Float32Array(n);
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== L.SURFACE || A.carry[i] || A.caste[i] === C.CAPTIVE) continue;
    const me = cols[A.col[i]]; if (!me.sp.raider) continue;
    const st = A.state[i]; if (st !== ST.RECRUIT && st !== ST.GUARD && st !== ST.RALLY && st !== ST.FIGHT && st !== ST.S_BRAID) continue;
    for (const t of cols) if (t !== me && t.alive && AL.dist2(A.x[i], A.y[i], t.x, t.y) < 420 * 420) { cx[t.id] += A.x[i]; cy[t.id] += A.y[i]; cnt[t.id]++; const pm = me.mods ? me.mods.propaganda : 1; if (pm > pk[t.id]) pk[t.id] = pm; }
  }
  for (const t of cols) {
    const k = cnt[t.id]; if (k < 3) continue;
    const x = cx[t.id] / k, y = cy[t.id] / k, r2 = 170 * 170, pp = Math.min(0.7, AL.clamp(0.1 + k * 0.02, 0, 0.45) * (pk[t.id] || 1));   // research/perk: mods.propaganda
    if (!A.panic || A.panic.length < A.cap) A.panic = new Uint8Array(A.cap);
    t._panicT = world.t;
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.col[i] !== t.id || A.layer[i] !== L.SURFACE || A.caste[i] === C.QUEEN) continue;
      const st = A.state[i]; if (st !== ST.FIGHT && st !== ST.RALLY && st !== ST.GUARD && st !== ST.RAID) continue;
      if (AL.dist2(A.x[i], A.y[i], x, y) > r2 || R() > pp) continue;
      if (st === ST.FIGHT && AL.Combat.disengage) AL.Combat.disengage(world, i);
      A.state[i] = ST.HOMING; A.timer[i] = 0; A.tgt[i] = -1; A.panic[i] = 1;
    }
  }
}
// fallback when the target colony has no siegeIn (abstract nests that don't take break-ins): the player's
// slave-maker ants on a recruit path / guard / rally right at a rival mound still try to grab a pupa
function tickRaids(world) {
  if (world.tick % 10 === 3) propaganda(world);
  if (world.tick % 5) return;
  for (const h of world.detailed || world.humans || [0]) tickRaidsOf(world, world.colonies[h]);
}
function tickRaidsOf(world, P) {
  const A = world.ants; if (!P) return;
  // slave-makers in the player's nest go back to the nursery after a scuffle in the tunnels (combat resets them to N_RAID)
  if (world.tick % 15 === 0 && P.nest && P.brood && P.brood.length && world.colonies.some(c => c !== P && c.alive && c.sp.raider)) {
    for (let i = 0; i < A.high; i++) if (A.state[i] === ST.N_RAID && A.layer[i] === L.NEST && A.nest[i] === P.id && !A.carry[i] && A.caste[i] !== C.CAPTIVE && world.colonies[A.col[i]].sp.raider) { A.state[i] = ST.S_NBROOD; A.timer[i] = 0.001; }
  }
  if (!P.sp.raider) return;
  for (const col of world.colonies) {
    if (col === P || !col.alive || !col.inside || col.siegeIn) continue;
    const r2 = AL.pow(col.moundR * 0.45 + 8, 2);
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.layer[i] !== L.SURFACE || A.col[i] !== P.id || A.carry[i]) continue;
      const st = A.state[i]; if (st !== ST.GUARD && st !== ST.RALLY && st !== ST.RECRUIT) continue;
      if (AL.dist2(A.x[i], A.y[i], col.x, col.y) < r2 && !raidIn(world, i, col)) { A.state[i] = ST.HOMING; A.timer[i] = 0; }
    }
  }
}

// ---- player colony, once per second -----------------------------------------------------------------
function playerSecond(world, col) {
  const sp = col.sp, s = col.stock, A = world.ants, R = world.R, nest = col.nest;
  col.broodMul = sp.broodMul || 1;
  if (sp.repletes) honeyFlow(col, col.pop[C.HONEYPOT], adultsOf(col), world.env.winter);
  if (sp.repletes && nest && (world.t | 0) % CFG.HP_EVERY === 0) {
    // a worker drinks its fill and becomes a replete when the repletes are full and sugar keeps coming in
    const hp = col.pop[C.HONEYPOT], ad = adultsOf(col);
    if (s.sugar > CFG.HONEY_KEEP && (col.honey || 0) >= honeyCap(col, hp) * 0.8 && hp < ad * CFG.HP_SHARE && nest.tiles[AL.Nest.CH.FOOD].length) {
      for (let i = 0; i < A.high; i++) {
        if (!A.state[i] || A.col[i] !== col.id || A.caste[i] !== C.WORKER || A.layer[i] !== L.NEST || A.carry[i]) continue;
        if (A.state[i] !== ST.N_IDLE && A.state[i] !== ST.N_WORK) continue;
        recaste(world, i, C.HONEYPOT, col); AL.Life.goTo(world, i, AL.Nest.F.FOOD, AL.ACT.HANG);
        col.pop[C.HONEYPOT]++; col.pop[C.WORKER]--;
        AL.emit(world, 'repleteMade', { col: col.id, i });
        break;
      }
    }
  }
  if (sp.seeds) mill(col, col.pop[C.MAJOR], adultsOf(col));
  if (sp.raider) {
    // captives tend the brood; without them it barely grows
    const cap = col.pop[C.CAPTIVE];
    col.broodMul = 0.35 + 0.65 * Math.min(1, cap * CFG.SM_CARE / (col.brood.length + 1));
    if (cap < 6 && !col._capWarn && world.t > 60) { col._capWarn = true; AL.emit(world, 'captivesLow', { col: col.id, n: cap }); }
    if (cap >= 10) col._capWarn = false;
  }
}
// honeypot repletes: sugar above HONEY_KEEP is banked in their crops (col.honey, out of reach of the queen's
// laying boost and of spoilage); when the store runs low the repletes feed it back
const honeyCap = (col, n) => n * T.HONEYPOT_STORE * (col.sp.honeyStore || 1);
function honeyFlow(col, repletes, adults, winter) {
  const s = col.stock, cap = honeyCap(col, repletes);
  col.honey = Math.min(col.honey || 0, cap);   // repletes that died took their honey with them
  if (s.sugar > CFG.HONEY_KEEP && col.honey < cap) { const m = Math.min(CFG.HONEY_RATE, s.sugar - CFG.HONEY_KEEP, cap - col.honey); s.sugar -= m; col.honey += m; }
  else if (s.sugar < CFG.HONEY_LOW && col.honey > 0) {
    // rationed: enough for the adults and the queen (with a little over), not for raising a big brood
    const need = (AL.Colony.upkeep ? AL.Colony.upkeep(col) : adults * T.SUGAR_PER_ANT * (col.sp.appetite || 1)) * (winter ? 0.35 : 1) + T.QUEEN_SUGAR;
    const m = Math.min(col.honey, need * 1.3 + (s.sugar < 5 ? 0.15 : 0)); col.honey -= m; s.sugar += m;
    // ... and the queen stops laying until food comes in again
    if (col.queen && col.queen.alive) col.queen.layT = Math.max(col.queen.layT || 0, 4);
    col.lean = true;
  } else col.lean = false;
}
// harvester millers: stored seed becomes sugar and protein when either runs short
function mill(col, majors, ants, yieldMul) {
  const y = yieldMul || 1;
  const s = col.stock;
  const needS = s.sugar < 160, needP = s.protein < 50;
  if (!needS && !needP) return 0;
  const m = Math.min(s.seeds, CFG.MILL_BASE + CFG.MILL_MAJOR * majors + CFG.MILL_ANT * ants);
  if (m <= 0) return 0;
  s.seeds -= m;
  if (needS && needP) { s.sugar += m * CFG.SEED_SUGAR * y; s.protein += m * CFG.SEED_PROT * y; }
  else if (needS) s.sugar += m * (CFG.SEED_SUGAR + CFG.SEED_PROT * 0.5) * y;
  else s.protein += m * (CFG.SEED_PROT + CFG.SEED_SUGAR * 0.3) * y;
  col.milled = (col.milled || 0) + m;
  return m;
}

// ---- rival colonies (abstract nest), once per second -----------------------------------------------------
const AI_BROOD_RATE = 0.8 / (T.EGG_T + T.LARVA_T + T.PUPA_T);   // what ai.js uses for its brood queue
function spawnOut(world, col, caste, state, n, host) {
  const A = world.ants, R = world.R, out = [];
  while (out.length < n && col.inside[caste] >= 1) {
    const a = R() * AL.TAU;
    const i = A.spawn(col.id, caste, L.SURFACE, col.x + AL.cos(a) * 5, col.y + AL.sin(a) * 5, a, R);
    if (i < 0) break;
    A.hp[i] = A.maxhp[i] = AL.CASTES[caste].hp * (col.sp.hp || 1);
    if (AL.AI && AL.AI.walkOut) AL.AI.walkOut(col, caste, A, i, R);   // unhealed wounds (and lost legs) come out too (ai.js)
    col.inside[caste]--; A.state[i] = state; A.timer[i] = 0;
    if (host != null) hosts(A)[i] = host;
    out.push(i);
  }
  return out;
}
// may this rival raid that colony? Colonies that must be scouted first can expose col.ai.knows (fn or array/Set of ids)
function knows(world, col, target) {
  if (AL.AI && AL.AI.knows) return AL.AI.knows(world, col.id, target.id);   // merge: the colonies stage's scouting
  const k = col.ai && col.ai.knows;
  if (!k) return true;
  if (typeof k === 'function') return !!k.call(col.ai, target.id, world);
  if (k.has) return k.has(target.id);
  if (Array.isArray(k)) return k.includes(target.id) || !!k[target.id];
  return !!k[target.id];
}
function aiSecond(world, col) {
  if (!col || col.isPlayer || !col.inside || !col.alive) return;
  col._spAiT = world.t;
  ensureWraps(world, col);
  const sp = col.sp, ins = col.inside, s = col.stock, R = world.R, env = world.env;
  const tot = sumIns(ins) + (col.surf || 0);
  const st = col.spAI || (col.spAI = { raidT: -1, wave: 0, n: 0 });
  st.n++;
  if (sp.repletes) {
    // workers swell into repletes while sugar is plentiful
    honeyFlow(col, ins[C.HONEYPOT], tot, env.winter);
    if (st.n % CFG.HP_EVERY === 0 && s.sugar > CFG.HONEY_KEEP && (col.honey || 0) >= honeyCap(col, ins[C.HONEYPOT]) * 0.8 && ins[C.WORKER] >= 2 && ins[C.HONEYPOT] < tot * CFG.HP_SHARE) { ins[C.WORKER]--; ins[C.HONEYPOT]++; }
    // the foragers hunt while the repletes hold the sugar
    if (s.protein < CFG.HUNT_BELOW && (col.honey || 0) > CFG.HUNT_KEEP) { const m = Math.min(CFG.HUNT_MAX, (col.honey - CFG.HUNT_KEEP) / CFG.HUNT_COST); col.honey -= m * CFG.HUNT_COST; s.protein += m; }
    // weak fighters: raid about a third less often
    if (col.ai && col.ai.raidT != null && st.n % 3 === 0) col.ai.raidT += 1;
  }
  if (sp.seeds) {
    mill(col, ins[C.MAJOR], tot, CFG.MILL_AI);
    if (!AL.Colony.upkeep) s.sugar += tot * T.SUGAR_PER_ANT * (1 - (sp.appetite || 1)) * (env.winter ? 0.35 : 1);   // eat less than the AI charged (ai.js now applies appetite itself)
    if (col.broodQ) for (const b of col.broodQ) if (!b._sp) { b._sp = 1; if (b.caste === C.WORKER && !b.fed && ins[C.MAJOR] < Math.max(2, tot * 0.08) && R() < 0.35) b.caste = C.MAJOR; }
  }
  if (sp.life > 1) for (let k = 0; k < ins.length; k++) if (k !== C.QUEEN && ins[k] > 0) ins[k] += ins[k] / AL.CASTES[k].life * (1 - 1 / sp.life);   // long-lived: undo part of the AI's aging
  if (sp.solitary && col.broodQ) {
    // big brood: each larva eats more protein than the AI charged
    for (const b of col.broodQ) if (b.fed && !b._sp) { b._sp = 1; s.protein = Math.max(0, s.protein - AL.CASTES[b.caste].prot * ((sp.broodCost || 1) - 1)); }
  }
  if (sp.raider) slaverAI(world, col, st, tot);
}
function slaverAI(world, col, st, tot) {
  const ins = col.inside, R = world.R, env = world.env, q = col.broodQ || [];
  // brood needs captive nurses
  const care = 0.35 + 0.65 * Math.min(1, ins[C.CAPTIVE] * CFG.SM_AI_CARE / (q.length + 1));
  for (const b of q) {
    if (b.fed) b.t = Math.max(0, b.t - AI_BROOD_RATE * (1 - care));
    if (!b._sp) { b._sp = 1; if (b.caste !== C.CAPTIVE && b.caste !== C.SOLDIER && R() < 0.7) b.caste = C.SOLDIER; }
  }
  // captives do the foraging
  const want = env.winter || env.rain > 0.35 ? 0 : 6 + tot * 0.35;
  if (ins[C.CAPTIVE] >= 1 && (col.surf || 0) < want) spawnOut(world, col, C.CAPTIVE, ST.WANDER, 2, col.capHost != null ? col.capHost : col.id);
  // brood raids on the nearest nest with brood that this colony knows about
  if (env.winter) return;
  if (st.raidT < 0) st.raidT = AL.lerp(CFG.RAID_FIRST[0], CFG.RAID_FIRST[1], R());
  st.raidT -= 1;
  if (st.raidT > 0) return;
  st.raidT = 30;
  if (ins[C.SOLDIER] < CFG.RAID_MIN) return;
  const target = nearestOther(world, col, c => knows(world, col, c) && (c.nest ? c.brood && c.brood.length >= 2 : c.broodQ && c.broodQ.length >= 2));
  if (!target) return;
  const n = Math.min(Math.floor(ins[C.SOLDIER]), 6 + st.wave * 3, 30);
  const party = spawnOut(world, col, C.SOLDIER, ST.S_BRAID, n);
  for (const i of party) { world.ants.task[i] = target.id; world.ants.tx[i] = target.x; world.ants.ty[i] = target.y; }
  st.wave++; st.raidT = AL.lerp(CFG.RAID_GAP[0], CFG.RAID_GAP[1], R());
  AL.emit(world, 'broodRaid', { col: col.id, target: target.id, n: party.length, wave: st.wave });
}

// ---- harvester grass: seed heads keep falling near the mound ----------------------------------------------
function plantGrass(world, col) {
  const S = world.surface, R = world.R;
  let placed = 0;
  for (let tries = 0; tries < 40 && placed < CFG.GRASS_PATCHES; tries++) {
    const a = R() * AL.TAU, d = 190 + R() * 200, x = col.x + AL.cos(a) * d, y = col.y + AL.sin(a) * d;
    if (x < 80 || y < 80 || x > S.W - 80 || y > S.H - 80 || AL.Surface.isBlocked(S, x, y)) continue;
    if (S.pois.some(p => AL.dist2(p.x, p.y, x, y) < 90 * 90)) continue;
    const p = { type: 'seeds', x, y, r: 22, grass: true, col: col.id }; S.pois.push(p);
    p.src = AL.Surface.addFood(S, { kind: K.SEED, x, y, r: 20, amount: 30, max: CFG.GRASS_MAX, regen: CFG.GRASS_REGEN, poi: p, visual: 'seeds' });
    placed++;
  }
  S.foodDirty = true;
}

// ---- the system ---------------------------------------------------------------------------------------------
AL.registerSystem({
  id: 'species', order: 7,     // after ai (6): rival nests exist; before fog (8)
  enabled: opts => !opts.benchOnly,
  init(world, opts) {
    hosts(world.ants);
    world.surfaceHandlers[ST.S_BRAID] = broodRaidHandler;
    world.nestHandlers = world.nestHandlers || {};
    world.nestHandlers[ST.S_NBROOD] = nestBroodHandler;
    const rf = {}; for (const ho of opts.rivalFoundings || []) rf[ho.col] = true;
    for (const c of world.colonies) {
      c.colours = Object.assign({}, c.colours, { look: c.sp.look || c.spKey });   // art.js draws species features from this
      c.broodMul = c.sp.broodMul || 1;
      ensureWraps(world, c);
      if (c.sp.seeds) plantGrass(world, c);
      // a founding hands over its own head count on the first tick; set up the rest now
      const founded = c.isPlayer ? !!opts.founding : !!rf[c.id];
      if (!founded || c.sp.repletes || c.sp.seeds) setupColony(world, c);
    }
  },
  tick: tickRaids,
  second(world) {
    for (const c of world.colonies) {
      if (!c.alive) continue;
      ensureWraps(world, c);
      // the raid is over: hidden defenders come back up
      if (c._hid && c.inside && world.t - (c._panicT || 0) > 8) { for (let k = 0; k < c._hid.length; k++) c.inside[k] += c._hid[k]; c._hid.fill(0); }
      if (c.nest) playerSecond(world, c);
      else if (c.inside && c._spAiT !== world.t) aiSecond(world, c);   // ai.js didn't call us this second
    }
  },
});

// founding profiles for the new species (founding.js reads AL.Founding.PROFILE[species])
const PROFILE = {
  honeypot:   { fat: 66, prot: 24, breed: 1.05, dev: 1,    nanitic: 0.7,  mode: 'claustral' },
  harvester:  { fat: 64, prot: 28, breed: 1.0,  dev: 0.95, nanitic: 0.74, mode: 'claustral' },
  slavemaker: { fat: 42, prot: 16, breed: 0.8,  dev: 1,    nanitic: 0.8,  mode: 'claustral', parasitic: true },   // + host workers on 'founded'
  bullet:     { fat: 80, prot: 40, breed: 0.45, dev: 0.75, nanitic: 0.92, mode: 'claustral' },
};
if (AL.Founding && AL.Founding.PROFILE) for (const k in PROFILE) if (!AL.Founding.PROFILE[k]) AL.Founding.PROFILE[k] = PROFILE[k];
// night behaviour (world-time.js reads AL.NIGHT_MODS[species])
AL.NIGHT_MODS = Object.assign({
  honeypot:   { speed: 0.9,  dps: 1.0,  vis: 0.65 },   // desert foragers work the cool of dusk
  harvester:  { speed: 0.7,  dps: 0.95, vis: 0.5 },    // strictly day foragers
  slavemaker: { speed: 0.85, dps: 1.0,  vis: 0.6 },
  bullet:     { speed: 1.1,  dps: 1.15, vis: 0.9 },    // hunt by night as well as day
}, AL.NIGHT_MODS || {});

AL.Species = { enterWrap, siegeWrap, CFG, PROFILE, decide, autoCaste, aiSecond, raidIn, preyIn, captiveHome, mill, nameOf, hosts, setupColony, spawnOut, knows };
if (NODE) module.exports = AL.Species;
})(typeof window !== 'undefined' ? window : globalThis);
