// Player orders given with pheromones: alarm (rally soldiers to a spot), recruitment (pull N ants out of the nest
// along a path: AI rivals use it) and Collect (a circle of food the player picked: N ants fetch it until it is gone).
// Also the RAID state used by AI colonies.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./life.js'); }
const ST = AL.ST, C = AL.CASTE, L = AL.LAYER, K = AL.CARRY;

// An order can belong to one of a colony's nests (`hid`: the capital's id or a satellite's nest id, from the nest tab
// the player picked): only that nest's ants answer it, and a recruit path starts at that nest's mound. Orders with no
// hid (AI rivals, a colony with one nest) are answered by any of the colony's ants.
const forHome = (o, hid) => o.hid == null || o.hid === hid;
// the alarm hotspots an ant of home `hid` answers (newest first)
function hotFor(col, hid) { const hs = col.hotspots; if (!hs) return null; for (const h of hs) if (forHome(h, hid)) return h; return null; }
// ---- alarm: a hotspot that soldiers rally to ----
function addAlarm(world, col, x, y, hid) {
  const c = world.colonies[col];
  c.hotspots = c.hotspots || [];
  for (const h of c.hotspots) if ((hid == null || h.hid === hid) && AL.dist2(h.x, h.y, x, y) < 120 * 120) { h.x = (h.x + x) / 2; h.y = (h.y + y) / 2; h.t = world.t; h.life = Math.max(h.life, 45); return h; }
  const h = { x, y, t: world.t, life: 45, player: true };
  if (hid != null) h.hid = hid;
  c.hotspots.unshift(h);
  // soldiers already outside answer too (the wounded keep going home unless the mound itself is raided)
  const A = world.ants, raided = AL.Life && AL.Life.homeRaided(world, c);
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== col || A.layer[i] !== L.SURFACE) continue;
    if (hid != null && A.home[i] !== hid) continue;   // another nest's soldiers
    if ((A.caste[i] === C.SOLDIER || A.caste[i] === C.MAJOR) && A.state[i] !== ST.FIGHT && (A.state[i] !== ST.HEAL || raided)) { A.state[i] = ST.RALLY; A.task[i] = 0; A.tx[i] = x; A.ty[i] = y; A.timer[i] = 0; }
  }
  return h;
}
// RALLY: march to the hotspot, then guard it. Ants answering a nearby fight's alarm (A.task = Combat.LOCAL,
// set by combat.js) run to that fight instead and only stand guard there briefly.
function rallyHandler(world, i, dt, sense) {
  const A = world.ants, col = world.colonies[A.col[i]];
  const local = AL.Combat && A.task[i] === AL.Combat.LOCAL;
  // follow the freshest hotspot
  const h = !local && hotFor(col, A.home[i]);
  if (h) { A.tx[i] = h.x; A.ty[i] = h.y; }
  const dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i], d2 = dx * dx + dy * dy;
  if (local) { A.timer[i] += dt; if (A.timer[i] > 25) { A.state[i] = ST.HOMING; A.task[i] = 0; return 0; } }
  if (d2 < (local ? 30 * 30 : 45 * 45)) { A.state[i] = ST.GUARD; A.timer[i] = local ? 8 + world.R() * 6 : 30 + world.R() * 20; A.task[i] = 0; return 0; }
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 4, -5, 5) + (world.R() - 0.5) * 0.8;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  world.handlerSpeed = 1.15;
  return 0;
}

// ---- recruitment: an order with a path and a head count ----
function addRecruit(world, col, pts, want, hid) {
  const c = world.colonies[col], hm = hid != null && world.homes && world.homes[hid], from = hm && hm.id === col && !hm.gone ? hm : c;
  c.orders = c.orders || [];
  // thin the path to ~30-unit steps
  const path = [pts[0]];
  for (const p of pts) { const q = path[path.length - 1]; if (AL.dist2(p.x, p.y, q.x, q.y) > 900) path.push(p); }
  const last = pts[pts.length - 1]; if (path[path.length - 1] !== last) path.push(last);
  // a path that starts away from the mound gets a leg from the mound added
  if (AL.dist2(path[0].x, path[0].y, from.x, from.y) > 120 * 120) path.unshift({ x: from.x, y: from.y });
  const oid = world.nextOrder || 1; world.nextOrder = oid + 1;   // (per world: every PC numbers orders the same)
  const o = { id: oid, pts: path, want, assigned: 0, arrived: 0, t: world.t, done: false };
  if (hid != null) o.hid = hid;
  c.orders.push(o);
  AL.emit(world, 'recruitOrder', { col, order: o });
  return o;
}
// cancel a recruit order: stop pulling ants, send the ones on the path home, wipe the path's scent
function cancelRecruit(world, col, id) {
  const c = world.colonies[col], o = c.orders && c.orders.find(q => q.id === id);
  if (!o) return 0;
  o.done = true; o.cancelled = true;
  c.orders = c.orders.filter(q => q !== o);
  const A = world.ants; let n = 0;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== col) continue;
    if (A.state[i] === ST.RECRUIT && A.str[i] === id) { A.state[i] = ST.HOMING; A.timer[i] = 0; n++; }
    // ants still walking to the door inside the nest give up too
    else if (A.layer[i] === L.NEST && A.prev[i] === ST.RECRUIT && A.str[i] === id && A.state[i] === ST.N_GOTO) { A.prev[i] = 0; if (AL.Life) AL.Life.decide(world, i); n++; }
  }
  const rg = world.pher.recruitOf && world.pher.recruitOf[col]; if (rg) for (const p of o.pts) rg.erase(p.x, p.y, 26);
  AL.emit(world, 'recruitCancelled', { col, order: o, n });
  return n;
}
// orders whose path passes within r of (x,y)
function ordersNear(world, col, x, y, r) {
  const c = world.colonies[col]; if (!c.orders) return [];
  return c.orders.filter(o => o.pts.some((p, k) => {
    if (AL.dist2(p.x, p.y, x, y) < r * r) return true;
    const q = o.pts[k + 1]; if (!q) return false;
    const dx = q.x - p.x, dy = q.y - p.y, L2 = dx * dx + dy * dy || 1, t = AL.clamp(((x - p.x) * dx + (y - p.y) * dy) / L2, 0, 1);
    return AL.dist2(p.x + dx * t, p.y + dy * t, x, y) < r * r;
  }));
}
function recruitHandler(world, i, dt, sense) {
  const A = world.ants, col = world.colonies[A.col[i]];
  const o = col.orders && col.orders.find(q => q.id === A.str[i]);
  if (!o) { A.state[i] = ST.WANDER; A.timer[i] = 0; return 0; }
  if (!o.pts.length) { A.state[i] = ST.WANDER; A.timer[i] = 0; return 0; }
  let wp = A.wp[i]; if (!(wp >= 0)) { wp = 0; A.wp[i] = 0; }
  const p = o.pts[Math.min(wp, o.pts.length - 1)];
  const dx = p.x - A.x[i], dy = p.y - A.y[i];
  A.timer[i] += dt;
  // a waypoint it can't get close to (a rock in the way, a crowd on the spot): after a while take the next one
  if (dx * dx + dy * dy < 18 * 18 || (A.timer[i] > 10 && dx * dx + dy * dy < 90 * 90) || A.timer[i] > 25) {
    wp++; A.wp[i] = wp; A.timer[i] = 0;
    if (wp >= o.pts.length) {
      o.arrived++;
      const end = o.pts[o.pts.length - 1];
      if (o.raid != null && AL.AINest) { AL.AINest.charge(world, i, o); return 0; }   // an AI rival's raid party charges from here (ai-nest.js)
      if (A.caste[i] === C.SOLDIER || A.caste[i] === C.MAJOR) { A.state[i] = ST.GUARD; A.tx[i] = end.x; A.ty[i] = end.y; A.timer[i] = 60 + world.R() * 30; }
      else { A.state[i] = ST.WANDER; A.timer[i] = 0; }
      return 0;
    }
  }
  const rg = world.pher.recruitOf ? world.pher.recruitOf[A.col[i]] : world.pher.recruit; if (rg) rg.deposit(A.x[i], A.y[i], 0.06 * dt * 30);
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 4.5, -6, 6) + (world.R() - 0.5) * 0.6;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  return 0;
}

// ---- Collect: the player drags a circle over food; that many ants fetch everything in it until it is gone ----
// The order lists the food ids (the UI sends the ones this player has seen inside the circle) and its ants by slot +
// uid. Its ants walk to the nearest food left (COLLECT), pick up a load or take hold of a dead bug like any forager
// (behavior.js pickup), carry it home and come straight back out (life.js decide -> collectJob) until the list is empty.
const COLLECT = { MAX_FOODS: 300, STALE: 180, GIVE_UP: 60, KEEP: 4 };
const CAN_COLLECT = new Uint8Array(16); for (const k of [C.WORKER, C.FORAGER, C.SCOUT, C.SOLDIER, C.MAJOR, C.CAPTIVE]) if (k != null) CAN_COLLECT[k] = 1;
// can colony col's ants take food f home? (no water, leaves only for fungus growers, a key point's spring only its holder's)
function collectable(world, col, f) {
  if (!f || f.gone || !(f.amount >= 1)) return false;
  if (f.kind === K.LEAF) return !!col.sp.fungus;
  if (f.kind !== K.SUGAR && f.kind !== K.PROTEIN && f.kind !== K.SEED) return false;
  if (f.keyPoint != null && !(AL.Victory && AL.Victory.springOwner && AL.Victory.springOwner(world, f) === col.id)) return false;
  return true;
}
const loadsOf = f => (f.big ? (f.needed || 3) + 2 : Math.ceil(f.amount / ((AL.TUNE && AL.TUNE.TRIP) || 1)));
function addCollect(world, col, x, y, r, ids, n, hid) {
  const c = world.colonies[col], S = world.surface, foods = [];
  if (!c || !S) return { ok: false, why: 'No food there.' };
  let loads = 0;
  for (const id of ids || []) {
    if (foods.length >= COLLECT.MAX_FOODS) break;
    const f = S.byId.get(id | 0);
    if (!collectable(world, c, f) || foods.indexOf(f.id) >= 0) continue;
    if (AL.dist2(f.x, f.y, x, y) > AL.sq(r + f.r + 20)) continue;   // (it was inside when the circle was drawn)
    foods.push(f.id); loads += loadsOf(f);
  }
  if (!foods.length) return { ok: false, why: 'Nothing your ants can carry home inside that circle.' };
  const oid = world.nextOrder || 1; world.nextOrder = oid + 1;
  // never more ants than there are loads to carry
  const o = { id: oid, x, y, r, foods, n0: foods.length, want: Math.max(1, Math.min(n, loads)), mi: [], mu: [], t: world.t, last: world.t, done: false };
  if (hid != null) o.hid = hid;
  (c.collects || (c.collects = [])).push(o);
  // foragers already out searching nearby join first (closest first), the rest come out of the nest
  const A = world.ants, near = [];
  for (let i = 0; i < A.high; i++) {
    if (A.state[i] !== ST.WANDER || A.col[i] !== col || A.layer[i] !== L.SURFACE || A.carry[i] || !CAN_COLLECT[A.caste[i]]) continue;
    if (hid != null && A.home[i] !== hid) continue;
    const d = AL.dist2(A.x[i], A.y[i], x, y); if (d < AL.sq(r + 500)) near.push([d, i]);
  }
  near.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, i] of near) { if (o.mi.length >= o.want) break; join(o, A, i); A.state[i] = ST.COLLECT; A.str[i] = o.id; A.tgt[i] = -1; A.timer[i] = 0; }
  AL.emit(world, 'collectOrder', { col, order: o });
  return { ok: true, id: o.id, want: o.want, piles: foods.length, out: o.mi.length };
}
function join(o, A, i) { o.mi.push(i); o.mu.push(A.uid[i]); }
const collectById = (c, id) => { const cs = c.collects; if (cs) for (const o of cs) if (o.id === id) return o; return null; };
// the Collect order ant i is one of (null: none)
function collectOf(world, i) {
  const A = world.ants, cs = world.colonies[A.col[i]].collects; if (!cs) return null;
  const u = A.uid[i];
  for (const o of cs) if (!o.done) for (let k = 0; k < o.mi.length; k++) if (o.mi[k] === i && o.mu[k] === u) return o;
  return null;
}
// in the nest with nothing urgent (life.js decide): one of a Collect order's ants goes back out; an order still short of
// ants takes this one
function collectJob(world, i, home) {
  const A = world.ants, cs = world.colonies[A.col[i]].collects;
  if (!cs || !cs.length || !CAN_COLLECT[A.caste[i]]) return false;
  let o = collectOf(world, i);
  if (!o) for (const q of cs) if (!q.done && q.mi.length < q.want && (q.hid == null || q.hid === home.hid)) { o = q; join(q, A, i); break; }
  if (!o) return false;
  A.str[i] = o.id; A.tgt[i] = -1;
  AL.Life.exitAs(world, i, ST.COLLECT);
  return true;
}
function nearestFood(world, c, o, x, y) {
  const S = world.surface; let best = null, bd = Infinity;
  for (const id of o.foods) {
    const f = S.byId.get(id); if (!collectable(world, c, f)) continue;
    const d = AL.dist2(f.x, f.y, x, y); if (d < bd) { bd = d; best = f; }
  }
  return best;
}
function collectHandler(world, i, dt, sense) {
  const A = world.ants, c = world.colonies[A.col[i]], o = collectById(c, A.str[i]);
  if (!o || o.done) { A.state[i] = ST.HOMING; A.timer[i] = 0; A.tgt[i] = -1; return 0; }
  let f = A.tgt[i] >= 0 ? world.surface.byId.get(A.tgt[i]) : null;
  if (!collectable(world, c, f)) { f = nearestFood(world, c, o, A.x[i], A.y[i]); A.tgt[i] = f ? f.id : -1; A.timer[i] = 0; }
  if (!f) { A.state[i] = ST.HOMING; A.timer[i] = 0; return 0; }   // nothing left (the order closes within a second)
  const dx = f.x - A.x[i], dy = f.y - A.y[i];
  if (dx * dx + dy * dy < AL.sq(f.r + 3)) { A.tgt[i] = -1; o.last = world.t; AL.Behavior.pickup(world, i, f); return 0; }
  A.timer[i] += dt;
  if (A.timer[i] > COLLECT.GIVE_UP) { A.state[i] = ST.HOMING; A.timer[i] = 0; A.tgt[i] = -1; return 0; }   // can't get there: home, and out again
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 4.5, -6, 6) + (world.R() - 0.5) * 0.6;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  return 0;
}
// close an order: its ants still walking out go home (the ones carrying a load bring it in)
function endCollect(world, c, o, why) {
  if (o.done) return 0;
  o.done = true; o.doneT = world.t; o.why = why;
  const A = world.ants; let n = 0;
  for (let k = 0; k < o.mi.length; k++) {
    const i = o.mi[k]; if (!A.state[i] || A.uid[i] !== o.mu[k]) continue;
    if (A.state[i] === ST.COLLECT) { A.state[i] = ST.HOMING; A.timer[i] = 0; A.tgt[i] = -1; n++; }
    else if (A.layer[i] === L.NEST && A.prev[i] === ST.COLLECT && A.state[i] === ST.N_GOTO) { A.prev[i] = 0; if (AL.Life) AL.Life.decide(world, i); n++; }
  }
  AL.emit(world, 'collectDone', { col: c.id, order: o, why, n });
  return n;
}
function cancelCollect(world, col, id) { const c = world.colonies[col], o = c && collectById(c, id); return o && !o.done ? endCollect(world, c, o, 'cancelled') : 0; }
function collectsNear(world, col, x, y, r) { const cs = world.colonies[col].collects; return cs ? cs.filter(o => !o.done && AL.dist2(o.x, o.y, x, y) < r * r) : []; }
function tickCollects(world, c) {
  const A = world.ants, S = world.surface;
  for (const o of c.collects) {
    if (o.done) continue;
    o.foods = o.foods.filter(id => collectable(world, c, S.byId.get(id)));
    // ants that died (or moved away) leave the order; a new one takes their place
    let w = 0;
    for (let k = 0; k < o.mi.length; k++) { const i = o.mi[k]; if (A.state[i] && A.uid[i] === o.mu[k] && A.col[i] === c.id) { o.mi[w] = i; o.mu[w] = o.mu[k]; w++; } }
    o.mi.length = w; o.mu.length = w;
    if (!o.foods.length) endCollect(world, c, o, 'done');
    else if (world.t - o.last > COLLECT.STALE) endCollect(world, c, o, 'stale');   // nobody has got a load in minutes
  }
  c.collects = c.collects.filter(o => !o.done || world.t - o.doneT < COLLECT.KEEP);
  if (!c.collects.length) c.collects = null;
}

// ---- RAID (AI): march on the target colony's mound, fight on the way, break in ----
// a player's raid (raids.js): muster at its own mound, then march on the hill it was sent against, whatever happens
function playerRaid(world, i, dt, sense, r) {
  const A = world.ants, target = AL.Raids.target(world, r);
  if (!AL.Raids.alive(target)) { A.state[i] = ST.HOMING; A.timer[i] = 0; return 0; }
  const muster = world.t < r.go;
  const gx = muster ? r.mx : target.x, gy = muster ? r.my : target.y;
  const dx = gx - A.x[i], dy = gy - A.y[i], d2 = dx * dx + dy * dy;
  if (!muster) {
    world.pher.alarm[A.col[i]].deposit(A.x[i], A.y[i], 0.05 * dt * 30);
    if (d2 < AL.pow(target.moundR * 0.35 + 6, 2) && (!AL.Combat.doorOpen || AL.Combat.doorOpen(world, target))) {
      if (target.nest) { breakIn(world, i, target); return 2; }
      if (target.siegeIn) { target.siegeIn(world, i); return 2; }
    }
  } else if (d2 < 45 * 45) {   // gathered: mill about until the party sets off
    world.handlerSpeed = 0.35;
    if (sense) A.turn[i] = (world.R() - 0.5) * 4;
    return 0;
  }
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 3.5, -5, 5) + (world.R() - 0.5) * 1.2;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  return 0;
}
function raidHandler(world, i, dt, sense) {
  const A = world.ants, me = world.colonies[A.col[i]];
  const pr = AL.Raids && world.praids && world.praids.length ? AL.Raids.raidOf(world, i) : null;
  if (pr) return playerRaid(world, i, dt, sense, pr);
  const target = world.colonies[me.ai && me.ai.target != null ? me.ai.target : 0];
  if (!target || !target.alive) { A.state[i] = ST.HOMING; return 0; }
  const dx = target.x - A.x[i], dy = target.y - A.y[i], d2 = dx * dx + dy * dy;
  world.pher.alarm[A.col[i]].deposit(A.x[i], A.y[i], 0.05 * dt * 30);
  // at the door: get in only once the defenders standing on the mound are down (the fight happens here)
  if (d2 < AL.pow(target.moundR * 0.35 + 6, 2) && (!AL.Combat.doorOpen || AL.Combat.doorOpen(world, target))) {
    const r = me.ai && me.ai.raid; if (r) r.inside = true;
    if (target.nest) { breakIn(world, i, target); return 2; }
    if (target.siegeIn) { target.siegeIn(world, i); return 2; }
  }
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 3.5, -5, 5) + (world.R() - 0.5) * 1.2;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  // march as a party (ai.js raidParty): front-runners slow down, stragglers hurry, so the raid arrives together
  const r = me.ai && me.ai.raid;
  if (r && r.n > 3 && d2 > 250 * 250) {
    const ahead = (A.x[i] - me.x) * r.ux + (A.y[i] - me.y) * r.uy - r.front;
    world.handlerSpeed = ahead > 40 ? 0.6 : ahead < -40 ? 1.2 : 1;
  }
  return 0;
}
// a raider enters the player's nest
function breakIn(world, i, target) {
  if (AL.NestPlan && AL.NestPlan.blocks(world, i, target)) return false;   // the door is plugged: it chews at the plug (nestplan.js)
  const A = world.ants, nest = target.nest, [x, y] = AL.Nest.centre(nest, nest.entrance.r * nest.cols + nest.entrance.c);
  // (a satellite's nest has its own id)
  A.layer[i] = L.NEST; A.nest[i] = target.hid != null ? target.hid : target.id; A.x[i] = A.px[i] = x; A.y[i] = A.py[i] = y; A.tx[i] = x; A.ty[i] = y;
  A.state[i] = ST.N_RAID; A.task[i] = AL.Nest.F.QUEEN; A.timer[i] = 0;
  AL.emit(world, 'breakIn', { col: A.col[i], target: target.id });
  if (target.isPlayer && AL.UI && AL.UI.toast && (!target._lastBreak || world.t - target._lastBreak > 20)) { target._lastBreak = world.t; }
}
// N_RAID inside a person's nest: go for the queen, grab food from the store on the way, carry it home
function nestRaidHandler(world, i, dt) {
  const A = world.ants, N = AL.Nest, R = world.R, P = (world.homes || world.colonies)[A.nest[i]], nest = P && P.nest;
  if (!nest) return;
  A.px[i] = A.x[i]; A.py[i] = A.y[i];
  const carrying = A.carry[i] !== 0;
  // a player's raiders (raids.js) go for the queen and nothing else until she is dead; with no queen left there is
  // nothing to stay for: out, home
  const onRaid = world.praids && world.praids.length && AL.Raids && AL.Raids.raidOf(world, i);
  const queenless = !(P.queen && P.queen.alive) && !(P.queens2 && P.queens2.some(x => A.state[x.i] && A.uid[x.i] === x.uid));
  const f = carrying || (queenless && !onRaid) ? N.F.ENTRANCE : N.F.QUEEN;
  const cur = N.tileOf(nest, A.x[i], A.y[i]);
  // steal from the food store when passing through it
  if (!carrying && !onRaid && nest.chamber[cur] === N.CH.FOOD) {
    const s = P.stock, k = s.protein > 1 ? AL.CARRY.PROTEIN : s.sugar > 1 ? AL.CARRY.SUGAR : 0;
    if (k) { s[AL.RES[k]] -= 1; A.carry[i] = k; P.stats.stolen = (P.stats.stolen || 0) + 1; AL.emit(world, 'foodStolen', { col: A.col[i], kind: k, from: P.id }); }
  }
  if (nest.fields[f][cur] === 0) {
    if (carrying || f === N.F.ENTRANCE) {   // out and home with the loot (or empty-handed)
      const col = P, a = R() * AL.TAU;
      A.layer[i] = L.SURFACE; A.x[i] = A.px[i] = col.x + AL.cos(a) * 5; A.y[i] = A.py[i] = col.y + AL.sin(a) * 5;
      if (carrying) { A.state[i] = ST.RETURN; A.str[i] = 0.5; } else { A.state[i] = ST.HOMING; A.timer[i] = 0; A.str[i] = 0; }
      return;
    }
    // in the queen chamber: attack the nearest queen (polygyne colonies keep extra queens there too)
    const q = P.queen;
    let qi = q && q.alive && q.i >= 0 && A.state[q.i] ? q.i : -1;
    if (P.queens2) for (const x of P.queens2) if (A.state[x.i] && A.uid[x.i] === x.uid && (qi < 0 || AL.dist2(A.x[x.i], A.y[x.i], A.x[i], A.y[i]) < AL.dist2(A.x[qi], A.y[qi], A.x[i], A.y[i]))) qi = x.i;
    if (qi >= 0) { AL.Combat.engage(world, i, qi); return; }
  }
  // walk the field
  let dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i], d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1.2) {
    const nt = N.nextTile(nest, f, cur, R);
    if (nt >= 0) { const [cx, cy] = N.centre(nest, nt); A.tx[i] = cx + (R() - 0.5) * 4; A.ty[i] = cy + (R() - 0.5) * 4; }
    dx = A.tx[i] - A.x[i]; dy = A.ty[i] - A.y[i]; d = Math.sqrt(dx * dx + dy * dy);
  }
  const sp = AL.CASTES[A.caste[i]].speed * 0.55 * (carrying ? AL.TUNE.CARRY_SLOW : 1) * (AL.Injury ? AL.Injury.mulOf(A, i) : 1), st = Math.min(d, sp * dt);   // (lost legs slow it)
  if (d > 0.001) { A.x[i] += dx / d * st; A.y[i] += dy / d * st; A.a[i] = AL.atan2(dy, dx); A.anim[i] += st * 0.3; }
}

AL.registerSystem({
  id: 'orders', order: 3,
  init(world) {
    world.surfaceHandlers[ST.RALLY] = rallyHandler;
    world.surfaceHandlers[ST.RECRUIT] = recruitHandler;
    world.surfaceHandlers[ST.COLLECT] = collectHandler;
    world.surfaceHandlers[ST.RAID] = raidHandler;
    world.nestHandlers = world.nestHandlers || {};
    world.nestHandlers[ST.N_RAID] = nestRaidHandler;
  },
  second(world) {
    for (const c of world.colonies) {
      if (c.orders) {
        for (const o of c.orders) {
          if (o.assigned >= o.want) o.full = true;                       // stop pulling ants out
          if (o.arrived >= o.want || world.t - o.t > 180) o.done = true;  // everyone's there (or it's stale)
        }
        // keep a finished order on screen for a few seconds, then drop it
        for (const o of c.orders) if (o.done && !o.doneT) o.doneT = world.t;
        c.orders = c.orders.filter(o => !o.done || world.t - o.doneT < 6);
      }
      if (c.collects) tickCollects(world, c);
      if (c.hotspots && !c.nest) c.hotspots = c.hotspots.filter(h => world.t - h.t < h.life);
    }
  },
});
AL.Orders = { addAlarm, addRecruit, breakIn, cancelRecruit, ordersNear, forHome, hotFor, addCollect, cancelCollect, collectJob, collectOf, collectsNear, collectable, COLLECT };
if (NODE) module.exports = AL.Orders;
})(typeof window !== 'undefined' ? window : globalThis);
