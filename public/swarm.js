// Army ants: swarm raids (Eciton burchellii). Army ants don't forage one by one: once a day the colony pours
// out in one broad front that rolls slowly across the ground, flushing out every small animal in the leaf
// litter. Raiders grab what they catch and ferry it home along the raid's own trail. The front also overruns
// other ant nests in its way and eats their brood.
//  - When: every RAID_EVERY s, on the colony's own clock (bivouac.js): statary raids go out like spokes, each
//    one ~123 deg on from the last so ground is never stripped twice; nomadic raids head for fresh ground and
//    the colony then emigrates along that day's raid trail. Never while the colony is on the march.
//  - Where: a person aims the next raid with the Swarm raid tool (click a point; it starts at once if the
//    colony is ready). Otherwise the colony picks the direction itself.
//  - Prey: the ground holds a thin crop of small animals (world.litter, coarse cells); a passing front harvests
//    a cell and it grows back over REGROW s. Each catch is one crumb of protein carried home by one raider.
//  - Raiders are real surface ants in state ST.B_SWARM walking a slot on the front (A.tx = place across it,
//    A.str = how far back, A.ty = raid id). They fight what they meet (combat.js treats them like raiders)
//    and go back to the front after.
//   col.swarm = { id, t0, a, ox, oy, dist, h, n0, ants: Map(uid -> i), caught, brood }
//   AL.Swarm.start(world, col, x?, y?) -> { ok, why, n }   events: 'swarm' {col, x, y, n}, 'swarmEnd' {col, caught, brood}
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./life.js'); require('./bivouac.js'); }
const ST = AL.ST, C = AL.CASTE, K = AL.CARRY, L = AL.LAYER;
ST.B_SWARM = 71;

const SW = AL.SWARM_TUNE = Object.assign({
  EVERY_S: 42, EVERY_N: 30,   // seconds between raids: statary / nomadic (the larvae are hungry then)
  SHARE: 0.55,                // share of the ants at home that join a raid
  MIN: 10, MAX: 160,          // raiders per raid
  REINFORCE: 3,               // more ants stream out from the bivouac each second while the front is short of hands
  SPEED: 9,                   // the front's speed (units/s): a slow, thorough sweep
  DIST: [320, 640],           // how far a raid goes out (small colony .. big)
  W0: 22, WK: 0.42, WMAX: 150, // the front's half width: grows as it fans out
  DEPTH: 30,                  // rows of raiders reach this far back from the front
  CELL: 64,                   // the litter grid
  PREY: 2.2,                  // protein a cell of average ground holds
  TAKE: 0.4,                  // protein the front takes from each cell it covers, per second
  REGROW: 260,                // seconds for raided ground to recover most of its prey
  STEAL: 1,                   // brood a front eats from an overrun nest each second ...
  STEAL_ODDS: 2,              // ... if its raiders there outnumber the defenders this many to one
  BROOD_PROT: 3,              // protein one stolen brood is worth (crumbs, one raider each)
  AIM_KEEP: 240,              // a person's aim stands for this long (then the colony picks again)
}, AL.SWARM_TUNE || {});

const nomad = c => !!(c && c.sp && c.sp.nomad);

// ---- the litter: what there is to catch --------------------------------------------------------------
function litter(world) {
  if (world.litter) return world.litter;
  const S = world.surface, w = Math.ceil(S.W / SW.CELL), h = Math.ceil(S.H / SW.CELL);
  const rich = new Float32Array(w * h), dep = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = (x + 0.5) * SW.CELL, cy = (y + 0.5) * SW.CELL;
    rich[y * w + x] = AL.Surface.isBlocked(S, cx, cy) ? 0 : (0.45 + 1.1 * AL.fbm(x / 5, y / 5, world.seed + 77, 2)) * (AL.Terrain ? AL.Terrain.preyMul(S, cx, cy) : 1);   // leaf litter teems, sand is bare (terrain.js)
  }
  return (world.litter = { w, h, rich, dep });
}
const cellAt = (lt, x, y) => { const cx = (x / SW.CELL) | 0, cy = (y / SW.CELL) | 0; return cx < 0 || cy < 0 || cx >= lt.w || cy >= lt.h ? -1 : cy * lt.w + cx; };
// prey left near (x, y): 0 = stripped bare or nothing there
function preyAt(world, x, y) { const lt = litter(world), c = cellAt(lt, x, y); return c < 0 ? 0 : lt.rich[c] * (1 - lt.dep[c]); }

// ---- starting a raid -----------------------------------------------------------------------------------
function homeCount(col) {
  if (col.inside) { let n = 0; for (let k = 0; k < AL.NCASTE; k++) if (k !== C.QUEEN && k !== C.HONEYPOT) n += col.inside[k]; return n; }
  let n = 0; if (col.pop) for (let k = 0; k < col.pop.length; k++) if (k !== C.QUEEN && k !== C.NURSE && k !== C.HONEYPOT) n += col.pop[k];
  return n * 0.6;   // (a person's colony: about this share is home at any time)
}
function canRaid(world, col) {
  if (!nomad(col) || !col.alive || col.founding) return { ok: false, why: 'Only army ants raid in swarms.' };
  const b = col.biv;
  if (col.swarm) return { ok: false, why: 'A swarm raid is already out.' };
  if (b && b.march) return { ok: false, why: 'The colony is on the march: the next raid goes out from the new bivouac.' };
  if (world.env.winter) return { ok: false, why: 'Too cold to raid.' };
  return { ok: true };
}
// the direction the colony picks itself: statary spokes, nomadic toward the freshest ground
function autoAngle(world, col) {
  const b = col.biv;
  if (!b || b.phase !== 'nomadic') { b.fan = AL.wrap((b.fan == null ? world.R() * AL.TAU : b.fan) + AL.Bivouac.TUNE.FAN_TURN); return b.fan; }
  const S = world.surface, back = col.lastRaid ? AL.atan2(col.y - col.lastRaid.oy, col.x - col.lastRaid.ox) : null;
  let best = 0, bv = -1e9;
  for (let k = 0; k < 12; k++) {
    const a = k * AL.TAU / 12;
    let v = 0;
    for (let d = 120; d <= 560; d += 110) {
      const x = col.x + AL.cos(a) * d, y = col.y + AL.sin(a) * d;
      if (x < 60 || y < 60 || x > S.W - 60 || y > S.H - 60) { v -= 2; break; }
      v += preyAt(world, x, y);
    }
    if (back != null) v += 0.6 * AL.cos(AL.wrap(a - back));   // keep moving on, don't double back
    v += world.R() * 0.3;
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}
function start(world, col, x, y) {
  const can = canRaid(world, col); if (!can.ok) return can;
  const S = world.surface, R = world.R, A = world.ants;
  let a, dist;
  const big = AL.clamp(homeCount(col) / 120, 0, 1);
  if (x != null) { a = AL.atan2(y - col.y, x - col.x); dist = AL.clamp(AL.hypot(x - col.x, y - col.y), SW.DIST[0] * 0.6, SW.DIST[1]); }
  else { a = autoAngle(world, col); dist = SW.DIST[0] + (SW.DIST[1] - SW.DIST[0]) * big; }
  // keep the far end on the map
  for (let k = 0; k < 6; k++) { const ex = col.x + AL.cos(a) * dist, ey = col.y + AL.sin(a) * dist; if (ex > 60 && ey > 60 && ex < S.W - 60 && ey < S.H - 60) break; dist *= 0.8; }
  const want = Math.round(AL.clamp(homeCount(col) * SW.SHARE, SW.MIN, SW.MAX));
  const ids = muster(world, col, want);
  if (ids.length < SW.MIN * 0.5) return { ok: false, why: 'Not enough ants at home for a swarm raid.' };
  const b = col.biv || {};
  const s = col.swarm = { id: ((b.raids = (b.raids || 0) + 1) % 250) + 1, t0: world.t, a, ox: col.x, oy: col.y, dist, h: 10, n0: ids.length, sent: 0, ants: new Map(), caught: 0, brood: 0, acc: 0 };
  enlist(world, s, ids);
  AL.emit(world, 'swarm', { col: col.id, x: col.x + AL.cos(a) * dist, y: col.y + AL.sin(a) * dist, n: ids.length });
  return { ok: true, n: ids.length, swarm: s };
}
function enlist(world, s, ids) {
  const A = world.ants, R = world.R;
  for (const i of ids) {
    A.state[i] = ST.B_SWARM; A.prev[i] = ST.B_SWARM; A.timer[i] = 0; A.wf[i] = 0; A.ty[i] = s.id; A.tgt[i] = -1;
    const big = A.caste[i] === C.SOLDIER || A.caste[i] === C.MAJOR;
    A.tx[i] = big ? (R() < 0.5 ? -1 : 1) * (0.7 + R() * 0.3) : (R() * 2 - 1) * 0.9;   // soldiers on the flanks, like the real thing
    A.str[i] = big ? R() * 0.4 : R();
    s.ants.set(A.uid[i], i);
  }
  s.sent += ids.length;
}
// gather raiders: a person's colony sends ants up from the bivouac and calls in idle ones round it; a rival's
// numbers walk out as real ants (like a march column, bivouac.js)
function muster(world, col, want) {
  const A = world.ants, R = world.R, ids = [];
  if (col.nest) {
    const cand = [];
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.col[i] !== col.id) continue;
      const c = A.caste[i], s = A.state[i];
      if (c === C.QUEEN || c === C.HONEYPOT || c === C.NURSE || c === C.WINGED || A.headless[i] || A.hp[i] < A.maxhp[i] * 0.6) continue;
      if (A.layer[i] === L.NEST) { if (A.nest[i] === col.id && (s === ST.N_IDLE || s === ST.N_WORK || s === ST.N_GOTO)) cand.push(i); }
      else if ((s === ST.WANDER || s === ST.HOMING) && !A.carry[i] && AL.dist2(A.x[i], A.y[i], col.x, col.y) < 160 * 160) cand.push(i);
    }
    const n = Math.min(want, cand.length);
    for (let k = 0; k < n; k++) {
      const j = k + ((R() * (cand.length - k)) | 0), i = cand[j]; cand[j] = cand[k]; cand[k] = i;
      if (A.layer[i] === L.NEST) {
        if (A.carry[i] && AL.RES[A.carry[i]]) AL.Sim.addStock(col, A.carry[i], 1);
        A.carry[i] = 0; A.layer[i] = L.SURFACE; A.act[i] = 0; A.task[i] = 0;
        const a = R() * AL.TAU, r = 4 + R() * 14;
        A.x[i] = A.px[i] = col.x + AL.cos(a) * r; A.y[i] = A.py[i] = col.y + AL.sin(a) * r; A.a[i] = a;
      }
      ids.push(i);
    }
  } else if (col.inside) {
    const ins = col.inside;
    let tot = 0; for (let k = 0; k < AL.NCASTE; k++) if (k !== C.QUEEN && k !== C.HONEYPOT) tot += ins[k];
    const f = tot > 0 ? Math.min(1, want / tot) : 0;
    for (let c = 0; c < AL.NCASTE; c++) {
      if (c === C.QUEEN || c === C.HONEYPOT) continue;
      const n = Math.min(Math.floor(ins[c]), Math.round(ins[c] * f));
      for (let k = 0; k < n; k++) {
        const a = R() * AL.TAU, r = 4 + R() * 14;
        const i = A.spawn(col.id, c, L.SURFACE, col.x + AL.cos(a) * r, col.y + AL.sin(a) * r, a, R);
        if (i < 0) break;
        A.hp[i] = A.maxhp[i] = AL.CASTES[c].hp * (col.sp.hp || 1);
        if (AL.AI && AL.AI.walkOut) AL.AI.walkOut(col, c, A, i, R);
        ins[c]--; ids.push(i);
      }
    }
  }
  return ids;
}

// ---- the front -----------------------------------------------------------------------------------------
const halfW = s => Math.min(SW.WMAX, SW.W0 + s.h * SW.WK);
function swarmHandler(world, i, dt, sense) {
  const A = world.ants, col = world.colonies[A.col[i]], s = col.swarm;
  if (!s || A.ty[i] !== s.id || !col.alive) { A.state[i] = A.carry[i] ? ST.RETURN : ST.HOMING; A.timer[i] = 0; return 0; }
  const ca = AL.cos(s.a), sa = AL.sin(s.a), hw = halfW(s);
  const along = Math.max(6, s.h - A.str[i] * SW.DEPTH), lat = A.tx[i] * hw * Math.min(1, along / Math.max(1, s.h));
  const tx = s.ox + ca * along - sa * lat, ty = s.oy + sa * along + ca * lat;
  const dx = tx - A.x[i], dy = ty - A.y[i], d2 = dx * dx + dy * dy;
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 4, -6, 6) + (world.R() - 0.5) * (d2 < 100 ? 4 : 1.2);   // milling about at the front
  if (A.wf[i] > 0) A.wf[i] -= dt;
  world.handlerSpeed = d2 > 2500 ? 1.25 : d2 > 100 ? 0.85 : 0.35;
  return 0;
}
// one raider (not already laden) takes a crumb home: true if someone took it
function ferry(world, col, s, kind) {
  const A = world.ants;
  if (s.ants.size <= Math.ceil(s.n0 * 0.5)) return false;   // the core of the front keeps sweeping (what it can't send back is eaten on the spot)
  for (const [uid, i] of s.ants) {
    if (A.uid[i] !== uid || A.state[i] !== ST.B_SWARM) { s.ants.delete(uid); continue; }
    if (A.carry[i]) continue;
    A.carry[i] = kind; A.state[i] = ST.RETURN; A.str[i] = 1.6; A.timer[i] = 0; A.a[i] = AL.atan2(col.y - A.y[i], col.x - A.x[i]);
    s.ants.delete(uid);
    return true;
  }
  return false;
}
// once a second: advance the front, harvest the ground under it, overrun nests, end the raid
function tickRaid(world, col, s) {
  const A = world.ants, S = world.surface, lt = litter(world);
  for (const [uid, i] of s.ants) if (A.uid[i] !== uid || (A.state[i] !== ST.B_SWARM && A.state[i] !== ST.FIGHT)) s.ants.delete(uid);
  s.h = Math.min(s.dist, s.h + SW.SPEED);
  const ca = AL.cos(s.a), sa = AL.sin(s.a), hw = halfW(s), fx = s.ox + ca * s.h, fy = s.oy + sa * s.h;
  // the prey in the litter under the front (a few points across it)
  let got = 0;
  const steps = Math.max(1, Math.round(hw * 2 / SW.CELL));
  for (let k = 0; k <= steps; k++) {
    const l = -hw + (hw * 2) * k / steps, c = cellAt(lt, fx - sa * l, fy + ca * l);
    if (c < 0 || lt.rich[c] <= 0) continue;
    const have = lt.rich[c] * SW.PREY * (1 - lt.dep[c]), take = Math.min(have, SW.TAKE);
    if (take <= 0) continue;
    lt.dep[c] = Math.min(1, lt.dep[c] + take / (lt.rich[c] * SW.PREY));
    got += take;
  }
  // and anything dead or edible lying in its path
  for (const f of S.foods) {
    if (f.gone || f.big || f.kind !== K.PROTEIN || f.amount < 1) continue;
    const rx = f.x - s.ox, ry = f.y - s.oy, al = rx * ca + ry * sa, la = -rx * sa + ry * ca;
    if (al < s.h - SW.DEPTH - 10 || al > s.h + 12 || Math.abs(la) > hw + 10) continue;
    while (f.amount >= 1 && ferry(world, col, s, K.PROTEIN)) { f.amount -= 1; s.caught++; }
    if (f.amount < 1 && f.max <= 20) { f.gone = true; S.foodDirty = true; }
  }
  s.acc += got;
  while (s.acc >= 1 && ferry(world, col, s, K.PROTEIN)) { s.acc -= 1; s.caught++; }
  if (s.acc > 4) s.acc = 4;   // the front can't hold on to more than it can carry
  // the column from the bivouac keeps the front manned while raiders ferry the catch home
  if (s.ants.size < s.n0 * 0.8 && s.sent < s.n0 * 3) { const more = muster(world, col, Math.min(SW.REINFORCE, Math.ceil(s.n0 * 0.8 - s.ants.size))); if (more.length) enlist(world, s, more); }
  // an ant nest in the way: the swarm pours in and eats the brood, if it outnumbers the defenders
  for (const o of world.colonies) {
    if (o === col || o.alive === false || o.founding) continue;
    const r = (o.moundR || 20) + 50;
    if (AL.dist2(o.x, o.y, fx, fy) > r * r) continue;
    let mine = 0, theirs = 0;
    for (const [uid, i] of s.ants) if (A.uid[i] === uid && AL.dist2(A.x[i], A.y[i], o.x, o.y) < r * r) mine++;
    for (let j = 0; j < A.high; j++) if (A.state[j] && A.col[j] === o.id && A.layer[j] === L.SURFACE && AL.dist2(A.x[j], A.y[j], o.x, o.y) < r * r) theirs++;
    if (o.inside) theirs += (o.inside[C.SOLDIER] || 0) * 2 + (o.inside[C.MAJOR] || 0) * 3;
    if (mine < Math.max(4, theirs * SW.STEAL_ODDS)) continue;
    for (let k = 0; k < SW.STEAL; k++) {
      if (!eatBrood(world, o)) break;
      s.brood++;
      for (let q = 0; q < SW.BROOD_PROT; q++) if (!ferry(world, col, s, K.PROTEIN)) break;
    }
    if (s.brood && ((world.t | 0) % 4 === 0)) AL.emit(world, 'swarmRaid', { col: col.id, victim: o.id, x: o.x, y: o.y });
  }
  // the end: far enough, too few left, or out too long
  const live = s.ants.size;
  if (s.h >= s.dist || live < 3 || world.t - s.t0 > s.dist / SW.SPEED + 40) end(world, col, s);   // (raiders ferrying prey home leave the front)
}
// a nest's brood taken: a person's brood (larvae and pupae first), or a rival's queue
function eatBrood(world, o) {
  if (o.brood && o.brood.length) {
    let k = -1; for (let j = 0; j < o.brood.length; j++) if (o.brood[j].stage >= 1) { k = j; break; }
    if (k < 0) k = 0;
    o.brood.splice(k, 1);
    if (AL.Life && AL.Life.placeBrood) AL.Life.placeBrood(o);
    AL.emit(world, 'broodLost', { col: o.id, cause: 'swarm' });
    return true;
  }
  if (o.broodQ && o.broodQ.length) { o.broodQ.splice((world.R() * o.broodQ.length) | 0, 1); return true; }
  return false;
}
function end(world, col, s) {
  const A = world.ants;
  for (const [uid, i] of s.ants) if (A.uid[i] === uid && A.state[i] === ST.B_SWARM) { A.state[i] = ST.HOMING; A.timer[i] = 0; }
  col.lastRaid = { x: s.ox + AL.cos(s.a) * s.h, y: s.oy + AL.sin(s.a) * s.h, ox: s.ox, oy: s.oy, t: world.t, a: s.a };
  col.swarm = null;
  col.swarmNext = world.t + (col.biv && col.biv.phase === 'nomadic' ? SW.EVERY_N : SW.EVERY_S);
  AL.emit(world, 'swarmEnd', { col: col.id, caught: s.caught, brood: s.brood });
}

// ---- system ------------------------------------------------------------------------------------------
function second(world) {
  const lt = world.litter;
  if (lt) { const k = 1 - 2.5 / SW.REGROW; for (let c = 0; c < lt.dep.length; c++) if (lt.dep[c] > 0) lt.dep[c] *= k; }
  for (const col of world.colonies) {
    if (!nomad(col) || !col.alive || col.founding) continue;
    if (col.swarm) { tickRaid(world, col, col.swarm); continue; }
    if (col.swarmNext == null) col.swarmNext = world.t + 20;
    if (world.t < col.swarmNext || (col.biv && col.biv.march) || world.env.winter || world.env.rain > 0.5) continue;
    const aim = col.swarmAim && world.t - col.swarmAim.t < SW.AIM_KEEP ? col.swarmAim : null;
    const r = aim ? start(world, col, aim.x, aim.y) : start(world, col);
    if (!r.ok) col.swarmNext = world.t + 15;
  }
}
// a person aims the next raid (cmd.js 'swarmAim'): it goes at once if the colony is ready
function aim(world, col, x, y) {
  if (!nomad(col)) return { ok: false, why: 'Only army ants raid in swarms.' };
  col.swarmAim = { x, y, t: world.t };
  if (col.swarm) return { ok: true, later: true, why: 'The next swarm raid will head there.' };
  const can = canRaid(world, col);
  if (!can.ok) return { ok: true, later: true, why: can.why + ' The next raid will head there.' };
  return start(world, col, x, y);
}

AL.registerSystem({
  id: 'swarm', order: 7.55,   // after the bivouac clock
  enabled: opts => !opts.benchOnly,
  init(world) { world.surfaceHandlers[ST.B_SWARM] = swarmHandler; },
  second,
});
AL.Swarm = { TUNE: SW, start, aim, canRaid, litter, preyAt, end };
if (NODE) module.exports = AL.Swarm;
})(typeof window !== 'undefined' ? window : globalThis);
