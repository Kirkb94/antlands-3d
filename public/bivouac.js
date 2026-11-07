// Army ants: a nomadic bivouac (Eciton). The colony runs on its brood's clock, like the real thing:
//   statary  - the bivouac stays put while last cycle's brood are pupae. The queen lays her whole batch early on
//              (the eggs she'd have laid since the last batch, banked in q.bank). Raids go out like spokes, each
//              swing ~123 deg on from the last, so the same ground isn't stripped twice.
//   nomadic  - begins when the new eggs hatch: hungry larvae. The colony raids hard and every MOVE_EVERY s
//              emigrates: the whole colony streams along a route carrying brood and the queen, and a new
//              bivouac forms at the far end. Ants in the column can be picked off, and a killed carrier loses its
//              brood. Ends when the larvae pupate: statary again.
// The player can't stop the cycle, only steer it: in the nomadic phase the March tool (B) sends the next move
// where they click; if they don't, the colony follows its strongest food trail (or richer ground).
// Rival army colonies do the same on their own. Cheap and deterministic: a march is a route + a clock; column
// ants are real surface ants in state ST.B_MARCH that walk to their slot on the route; the colony's home point
// (col.x/y, where ants go in and come out) is the queen, walking in the column.
//
//   col.biv = { phase: 'statary'|'nomadic', since, march, n, moveAt, laying, layEnd, fan, fanT, marches }
//   col.biv.march = { id, t0, dur, route, from, to, qAt, carriers: Map(uid -> slot), column, lost, arrived }
//   AL.Bivouac.start(world, col, x, y) -> { ok, why }      events: 'march' {col, x, y, dur}, 'marchEnd' {col, x, y, lost},
//   'bivPhase' {col, phase}; AL.Bivouac.banks(world, col): true while the queen saves her eggs for the next batch
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./life.js'); require('./ai.js'); }
const ST = AL.ST, C = AL.CASTE, K = AL.CARRY, L = AL.LAYER;
ST.B_MARCH = 70;   // surface: an army ant walking its slot of the emigration column (A.str = slot 0..1, A.tx = side offset, A.ty = march id)

const BT = AL.BIV_TUNE = Object.assign({
  SPEED: 13,              // route units per second of march (sets the march length)
  DUR: [40, 80],          // an emigration takes 40-80 s (a night's move of 100-200 m in the forest)
  MIN_D: 150, MAX_D: 900,
  MOVE_MIN: 20,           // at least this long between the end of one march and the next
  MOVE_EVERY: 35,         // nomadic: raiding time between moves (the colony moves along the day's raid trail)
  STAT_MIN: 60, STAT_MAX: 200,    // statary: lasts until the new eggs hatch (HATCH), within these bounds (s)
  NOM_MIN: 45, NOM_MAX: 160,      // nomadic: lasts until the larvae pupate (PUPATE), within these bounds
  HATCH: 0.4,             // statary ends once this share of the brood are larvae
  PUPATE: 0.15,           // nomadic ends once fewer than this share are larvae
  LAY_DELAY: 12,          // statary: the queen starts her batch this long in (so the eggs hatch as the pupae emerge)
  LAY_WIN: 25,            // ... and lays for at least this long, until the bank is spent
  LAY_RATE: 3,            // eggs per second at most while she lays the batch
  BANK_MAX: 600,          // most eggs saved up for one batch
  BATCH_BONUS: 1.1,       // army queens are the most fertile there are: each egg saved counts this much in the batch
  COLUMN_FRAC: 0.75,      // share of the ants at home that walk the column (the rest is the bivouac itself)
  COLUMN_MAX: 150,
  CARRY_FRAC: 0.45,       // at most this share of the column carries brood
  QUEEN_SLOT: 0.6,        // where in the column the queen walks (0 vanguard .. 1 rearguard)
  SPREAD: 0.4,            // the rearguard sets off this far into the march after the vanguard
  FAN_TURN: 2.15,         // statary raids: each new swing points ~123 degrees on from the last
  FAN_EVERY: 80,
  MEAT_SUGAR: 25,         // army ants live on their prey: below this much sugar they eat stored protein instead
  AI_FORGET: 700,         // rivals forget where a rival bivouac is once it marches (unless it settles this close to them)
}, AL.BIV_TUNE || {});

const nomad = c => !!(c && c.sp && c.sp.nomad);
function state(col) {
  if (!col.biv) col.biv = { phase: 'statary', since: 0, march: null, n: 0, moveAt: 0, end: -1e9, laying: false, layEnd: 0, fan: 0, fanT: 0, marches: 0 };
  return col.biv;
}
// the brood by stage: player colonies keep real brood (stage 0 egg, 1 larva, 2 pupa), rivals a queue (t 0..1 through all three)
function broodStages(col) {
  let e = 0, l = 0, p = 0;
  if (col.brood) for (const b of col.brood) { if (b.stage === 0) e++; else if (b.stage === 1) l++; else p++; }
  else if (col.broodQ) {
    const T = AL.TUNE, tot = T.EGG_T + T.LARVA_T + T.PUPA_T, a = T.EGG_T / tot, b = (T.EGG_T + T.LARVA_T) / tot;
    for (const x of col.broodQ) { if (x.t < a) e++; else if (x.t < b) l++; else p++; }
  }
  return { e, l, p, n: e + l + p };
}
// is the queen saving her eggs for the next batch? (life.js / ai.js layTick: true = bank the egg, don't lay it)
function banks(world, col) { const b = col.biv; return !!(b && nomad(col) && !b.laying); }
function setPhase(world, col, b, phase) {
  b.phase = phase; b.since = world.t; b.laying = false; b.laid = false;
  if (phase === 'nomadic') b.moveAt = Math.max(b.end + BT.MOVE_MIN, world.t + BT.MOVE_EVERY * 0.5);
  AL.emit(world, 'bivPhase', { col: col.id, phase });
}
// how far along the route a column slot is at march time tau (0..1 of the duration)
const slotP = (s, tau) => AL.clamp((tau - s * BT.SPREAD) / (1 - BT.SPREAD), 0, 1);

// ---- routes ------------------------------------------------------------------------------------
function makeRoute(pts) {
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + AL.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  return { pts, cum, len: cum[cum.length - 1] };
}
function pointAt(r, p, out) {
  out = out || {};
  const d = AL.clamp(p, 0, 1) * r.len, P = r.pts, cum = r.cum;
  let k = 1; while (k < P.length - 1 && cum[k] < d) k++;
  const a = P[k - 1], b = P[k], seg = Math.max(1e-6, cum[k] - cum[k - 1]), t = AL.clamp((d - cum[k - 1]) / seg, 0, 1);
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t;
  const l = AL.hypot(b.x - a.x, b.y - a.y) || 1; out.nx = -(b.y - a.y) / l; out.ny = (b.x - a.x) / l;
  return out;
}
// blocked samples along a polyline (every 24 units)
function blockedOn(S, pts) {
  let n = 0;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], d = AL.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.ceil(d / 24));
    for (let j = 1; j <= m; j++) if (AL.Surface.isBlocked(S, a.x + (b.x - a.x) * j / m, a.y + (b.y - a.y) * j / m)) n++;
  }
  return n;
}
// straight if it's clear, else a detour round the side (a rock, the patio); null if nothing works
function planRoute(world, x0, y0, x1, y1) {
  const S = world.surface, a = { x: x0, y: y0 }, b = { x: x1, y: y1 };
  if (blockedOn(S, [a, b]) <= 1) return makeRoute([a, b]);
  const d = AL.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / d, ny = (x1 - x0) / d, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let best = null, bn = 1e9;
  for (const f of [0.25, -0.25, 0.45, -0.45, 0.7, -0.7]) {
    const m = { x: AL.clamp(mx + nx * d * f, 60, S.W - 60), y: AL.clamp(my + ny * d * f, 60, S.H - 60) };
    if (AL.Surface.isBlocked(S, m.x, m.y)) continue;
    const n = blockedOn(S, [a, m, b]);
    if (n <= 1) return makeRoute([a, m, b]);
    if (n < bn) { bn = n; best = [a, m, b]; }
  }
  return best && bn <= 3 ? makeRoute(best) : null;
}

// ---- starting a march --------------------------------------------------------------------------
function canMarch(world, col) {
  if (!nomad(col) || !col.alive || col.founding) return { ok: false, why: 'Only army ants can march.' };
  const b = state(col);
  if (b.march) return { ok: false, why: 'The bivouac is already on the march.' };
  if (b.phase !== 'nomadic') return { ok: false, why: 'The bivouac is settled while the pupae mature and the queen lays. It moves again once the new larvae hatch.', settled: true };
  const rest = BT.MOVE_MIN - (world.t - b.end);
  if (rest > 0) return { ok: false, why: 'The colony needs ' + Math.ceil(rest) + ' s before it moves again.', wait: rest };
  return { ok: true };
}
function start(world, col, x, y) {
  const can = canMarch(world, col); if (!can.ok) return can;
  const S = world.surface, b = state(col);
  x = AL.clamp(x, 80, S.W - 80); y = AL.clamp(y, 80, S.H - 80);
  let d = AL.hypot(x - col.x, y - col.y);
  if (d < BT.MIN_D) return { ok: false, why: 'Pick open ground further away.' };
  if (d > BT.MAX_D) { x = col.x + (x - col.x) * BT.MAX_D / d; y = col.y + (y - col.y) * BT.MAX_D / d; d = BT.MAX_D; }
  if (AL.Surface.isBlocked(S, x, y)) return { ok: false, why: 'Pick open ground: the bivouac can\'t hang there.' };
  const route = planRoute(world, col.x, col.y, x, y);
  if (!route) return { ok: false, why: 'Something big is in the way. Pick a spot with an open path.' };
  const dur = AL.clamp(route.len / BT.SPEED, BT.DUR[0], BT.DUR[1]);
  const m = b.march = { id: ++b.n % 250 + 1, t0: world.t, dur, route, from: { x: col.x, y: col.y }, to: { x, y }, qAt: false, carriers: new Map(), column: 0, lost: 0, arrived: 0, killed: 0 };
  b.marches++;
  formColumn(world, col, m);
  AL.emit(world, 'march', { col: col.id, x, y, dur, n: m.column });
  return { ok: true, march: m };
}
// pull ants out of the bivouac into the column
function formColumn(world, col, m) {
  const A = world.ants, R = world.R, ids = [];
  if (col.nest) {
    // the player's detailed nest: real ants leave the side view and line up at the old bivouac
    const cand = [];
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.col[i] !== col.id || A.layer[i] !== L.NEST) continue;
      const c = A.caste[i], s = A.state[i];
      if (c === C.QUEEN || c === C.HONEYPOT || s === ST.FIGHT || s === ST.N_QUEEN || s === ST.N_HANG || s >= 40) continue;
      cand.push(i);
    }
    const n = Math.min(BT.COLUMN_MAX, Math.round(cand.length * BT.COLUMN_FRAC));
    for (let k = 0; k < n; k++) {
      const j = k + ((R() * (cand.length - k)) | 0), i = cand[j]; cand[j] = cand[k]; cand[k] = i;
      if (A.carry[i] && AL.RES[A.carry[i]]) AL.Sim.addStock(col, A.carry[i], 1);
      A.carry[i] = 0; A.layer[i] = L.SURFACE; A.act[i] = 0; A.task[i] = 0; A.tgt[i] = -1;
      const a = R() * AL.TAU, r = 6 + R() * 22;
      A.x[i] = A.px[i] = col.x + AL.cos(a) * r; A.y[i] = A.py[i] = col.y + AL.sin(a) * r; A.a[i] = a;
      ids.push(i);
    }
  } else if (col.inside) {
    // an abstract rival nest: numbers walk out
    const ins = col.inside;
    let tot = 0; for (let k = 0; k < AL.NCASTE; k++) if (k !== C.QUEEN && k !== C.HONEYPOT) tot += ins[k];
    const want = Math.min(BT.COLUMN_MAX, Math.round(tot * BT.COLUMN_FRAC)), f = tot > 0 ? want / tot : 0;
    for (let c = 0; c < AL.NCASTE; c++) {
      if (c === C.QUEEN || c === C.HONEYPOT) continue;
      const n = Math.min(Math.floor(ins[c]), Math.round(ins[c] * f));
      for (let k = 0; k < n; k++) {
        const a = R() * AL.TAU, r = 6 + R() * 22;
        const i = A.spawn(col.id, c, L.SURFACE, col.x + AL.cos(a) * r, col.y + AL.sin(a) * r, a, R);
        if (i < 0) break;
        A.hp[i] = A.maxhp[i] = AL.CASTES[c].hp * (col.sp.hp || 1);
        if (AL.AI && AL.AI.walkOut) AL.AI.walkOut(col, c, A, i, R);   // unhealed wounds (and lost legs) come out too (ai.js)
        ins[c]--; ids.push(i);
      }
    }
  }
  // slots: brood carriers walk in the middle of the column with the queen, soldiers on the flanks
  const brood = col.brood ? col.brood.length : col.broodQ ? col.broodQ.length : 0;
  let carriers = Math.min(brood, Math.floor(ids.length * BT.CARRY_FRAC));
  for (const i of ids) {
    const c = A.caste[i], big = c === C.SOLDIER || c === C.MAJOR;
    A.state[i] = ST.B_MARCH; A.prev[i] = ST.B_MARCH; A.timer[i] = 0; A.wf[i] = 0; A.ty[i] = m.id;
    if (!big && carriers > 0) { carriers--; A.carry[i] = K.BROOD; m.carriers.set(A.uid[i], i); A.str[i] = 0.25 + R() * 0.65; A.tx[i] = (R() - 0.5) * 8; }
    else if (big) { A.str[i] = R(); A.tx[i] = (R() < 0.5 ? -1 : 1) * (12 + R() * 12); }
    else { A.str[i] = R(); A.tx[i] = (R() - 0.5) * 14; }
  }
  m.column = ids.length;
}

// ---- the column ---------------------------------------------------------------------------------
const PT = {};
function leaveColumn(A, i) {
  if (A.carry[i] === K.BROOD) A.carry[i] = 0;
  A.state[i] = ST.HOMING; A.timer[i] = 0;
}
function marchHandler(world, i, dt, sense) {
  const A = world.ants, col = world.colonies[A.col[i]], b = col.biv, m = b && b.march;
  if (!m || A.ty[i] !== m.id || !col.alive) { leaveColumn(A, i); return 0; }
  const tau = (world.t - m.t0) / m.dur, s = A.str[i], p = slotP(s, tau);
  let tx, ty;
  if (p >= 1) {
    // at the new site: hang on as the new bivouac until the queen is in, then go inside
    const dx = m.to.x - A.x[i], dy = m.to.y - A.y[i];
    if ((m.qAt || tau >= 1) && dx * dx + dy * dy < 40 * 40) {
      if (A.carry[i] === K.BROOD) { m.carriers.delete(A.uid[i]); A.carry[i] = 0; }
      m.arrived++;
      A.state[i] = ST.HOMING;
      world.arrive(world, i);
      return A.state[i] && A.layer[i] === L.SURFACE ? 0 : 2;
    }
    const u = A.uid[i], ang = (u * 2.399) % AL.TAU, rr = 8 + (u % 23);
    tx = m.to.x + AL.cos(ang) * rr; ty = m.to.y + AL.sin(ang) * rr;
  } else {
    const q = pointAt(m.route, p, PT), lat = p > 0 ? A.tx[i] : A.tx[i] * 0.3;
    tx = q.x + q.nx * lat; ty = q.y + q.ny * lat;
  }
  const dx = tx - A.x[i], dy = ty - A.y[i], d2 = dx * dx + dy * dy;
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 4, -6, 6) + (world.R() - 0.5) * (d2 < 144 ? 3 : 0.8);
  if (A.wf[i] > 0) A.wf[i] -= dt;
  world.handlerSpeed = d2 > 1600 ? 1.3 : d2 > 144 ? 1 : 0.3;
  return 0;
}

// the home point is the queen, walking in the column
function heart(col, m, tau) {
  const p = slotP(BT.QUEEN_SLOT, tau);
  pointAt(m.route, p, PT);
  col.x = PT.x; col.y = PT.y;
  if (p >= 1 && !m.qAt) { m.qAt = true; col.x = m.to.x; col.y = m.to.y; }
}
function finish(world, col, b) {
  const m = b.march;
  col.x = m.to.x; col.y = m.to.y;
  b.march = null; b.end = world.t; b.moveAt = world.t + BT.MOVE_EVERY;
  reshape(world, col, true);   // the new bivouac forms round the queen
  if (col.ai) forget(world, col);
  AL.emit(world, 'marchEnd', { col: col.id, x: col.x, y: col.y, lost: m.lost, killed: m.killed, column: m.column });
}
// a brood carrier died: the brood it held is gone
function loseBrood(world, col) {
  const R = world.R;
  if (col.brood && col.brood.length) { col.brood.splice((R() * col.brood.length) | 0, 1); if (AL.Life && AL.Life.placeBrood) AL.Life.placeBrood(col); }
  else if (col.broodQ && col.broodQ.length) col.broodQ.splice((R() * col.broodQ.length) | 0, 1);
  else return;
  AL.emit(world, 'broodLost', { col: col.id, cause: 'march' });
}

// ---- a person's bivouac view: the cluster grows with the colony and re-forms at each new site (nest.js) --------
function adults(col) { let n = 0; if (col.pop) for (let k = 0; k < col.pop.length; k++) if (k !== C.QUEEN) n += col.pop[k]; return n; }
function reshape(world, col, fresh) {
  const nest = col.nest; if (!nest || !nest.bivouac || !AL.Nest.shapeBivouac) return;
  if (!AL.Nest.shapeBivouac(nest, adults(col), fresh) && !fresh) return;
  // anyone left standing where the cluster no longer is climbs back in; bodies that fell out are gone
  const A = world.ants, open = nest.tiles[AL.Nest.CH.NURSERY].length ? nest.tiles[AL.Nest.CH.NURSERY] : nest.tiles[AL.Nest.CH.QUEEN];
  if (open.length) for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== L.NEST || A.nest[i] !== col.id) continue;
    const t = AL.Nest.tileOf(nest, A.x[i], A.y[i]);
    if (nest.kind[t] === AL.Nest.TILE.OPEN) continue;
    const j = open[(world.R() * open.length) | 0], [x, y] = AL.Nest.centre(nest, j);
    A.x[i] = A.px[i] = x; A.y[i] = A.py[i] = y;
  }
  nest.corpses = nest.corpses.filter(k => nest.kind[k.i] === AL.Nest.TILE.OPEN);
  nest.corpseDirty = true;
}

// ---- rivals: when and where to march -------------------------------------------------------------
// balance (Nov 2026): a rival bivouac that has marched on is lost to the other rivals: they have to find it again
// (ai.js sense) before they can raid it. No fixed nest is the army ants' defence; rival army colonies hardly
// survived without it (4% of 24 hands-off matches). The player's bivouac is left as it was.
function forget(world, col) {
  if (col.isPlayer || !BT.AI_FORGET) return;
  for (const o of world.colonies) if (o !== col && o.ai && o.ai.known && o.ai.known[col.id]) {
    if (AL.dist2(o.x, o.y, col.x, col.y) < BT.AI_FORGET * BT.AI_FORGET) continue;   // ... unless it settled on their doorstep
    o.ai.known[col.id] = 0;
  }
}
// richer ground: food within reach of a candidate spot, away from other nests and from where we are now
function scoreSpot(world, col, x, y) {
  const S = world.surface;
  let v = 0;
  for (const f of S.foods) {
    if (f.gone || f.amount < 1) continue;
    const d2 = AL.dist2(f.x, f.y, x, y);
    if (d2 > 450 * 450) continue;
    const w = f.kind === K.PROTEIN ? 1.3 : f.kind === K.SUGAR ? 1 : 0.3;
    v += Math.min(60, f.amount) * w * (1 - Math.sqrt(d2) / 450);
  }
  for (const o of world.colonies) {
    if (o === col || o.alive === false) continue;
    const d = AL.hypot(o.x - x, o.y - y);
    if (d < 650) v -= (650 - d) * 0.6;
  }
  return v;
}
function aiPickSpot(world, col) {
  const S = world.surface, R = world.R;
  const here = scoreSpot(world, col, col.x, col.y);
  let best = null, bv = here + 40;
  const a0 = R() * AL.TAU;
  for (let k = 0; k < 12; k++) {
    const a = a0 + k * AL.TAU / 12;
    for (const d of [450, 750, 1050]) {
      const x = col.x + AL.cos(a) * d, y = col.y + AL.sin(a) * d;
      if (x < 150 || y < 150 || x > S.W - 150 || y > S.H - 150 || AL.Surface.isBlocked(S, x, y)) continue;
      const v = scoreSpot(world, col, x, y) - d * 0.02 + R() * 20;
      if (v > bv) { bv = v; best = { x, y }; }
    }
  }
  return best;
}
// the colony's strongest food trail: where its raids have been finding food (the day's raid trail)
function trailPick(world, col) {
  const g = world.pher.food && world.pher.food[col.id], S = world.surface;
  if (!g) return null;
  let best = null, bv = 4;
  for (let k = 0; k < 16; k++) {
    const a = k * AL.TAU / 16, ca = AL.cos(a), sa = AL.sin(a);
    let v = 0, far = 0;
    for (let d = 90; d <= BT.MAX_D; d += 60) {
      const x = col.x + ca * d, y = col.y + sa * d;
      if (x < 80 || y < 80 || x > S.W - 80 || y > S.H - 80) break;
      const f = g.sample(x, y); v += f; if (f > 0.3) far = d;
    }
    if (v > bv && far >= BT.MIN_D) { bv = v; best = { x: col.x + ca * Math.min(far, 600), y: col.y + sa * Math.min(far, 600) }; }
  }
  return best && !AL.Surface.isBlocked(S, best.x, best.y) ? best : null;
}
// nomadic: time for the next move? the player's colony follows its raid trail unless they marched it already
function autoMove(world, col, b) {
  if (b.march || b.phase !== 'nomadic' || world.t < b.moveAt) return;
  const env = world.env;
  let n = 0; if (col.inside) for (let k = 0; k < AL.NCASTE; k++) n += col.inside[k];
  if (col.sieging || env.rain > 0.35 || (col.inside && n < 16)) { b.moveAt = world.t + 20; return; }   // sit out a storm or a siege
  // the colony moves out along the day's raid trail (swarm.js), else its strongest food trail, else richer ground
  const lr = col.lastRaid, raidEnd = lr && world.t - lr.t < 150 && AL.hypot(lr.x - col.x, lr.y - col.y) >= BT.MIN_D && !AL.Surface.isBlocked(world.surface, lr.x, lr.y) ? lr : null;
  const p = raidEnd || (col.isPlayer ? trailPick(world, col) : null) || aiPickSpot(world, col) || anyPick(world, col);
  const r = p ? start(world, col, p.x, p.y) : { ok: false };
  if (!r.ok) b.moveAt = world.t + 15;
  else if (col.isPlayer) AL.emit(world, 'autoMarch', { col: col.id, x: p.x, y: p.y });
}
// nowhere better: just move on (army ants never stay put in the nomadic phase)
function anyPick(world, col) {
  const S = world.surface, a0 = world.R() * AL.TAU;
  for (let k = 0; k < 8; k++) {
    const a = a0 + k * AL.TAU / 8, x = col.x + AL.cos(a) * 400, y = col.y + AL.sin(a) * 400;
    if (x > 150 && y > 150 && x < S.W - 150 && y < S.H - 150 && !AL.Surface.isBlocked(S, x, y)) return { x, y };
  }
  return null;
}
// the brood clock: settle while pupae mature and the batch is laid, wander while the larvae are hungry
function cycle(world, col, b) {
  const t = world.t - b.since, st = broodStages(col), q = col.queen;
  if (b.phase === 'statary') {
    if (!b.laying && !b.laid && t >= BT.LAY_DELAY && !world.env.winter) { b.laying = true; b.laid = true; b.layEnd = world.t + BT.LAY_WIN; AL.emit(world, 'bivBatch', { col: col.id, n: Math.round((q && q.bank) || 0) }); }
    if (b.laying && q && q.alive) {
      // the batch: what she saved up, a few a second (the normal laying goes on too while the window is open)
      for (let k = 0; k < BT.LAY_RATE && q.bank >= 1; k++) {
        const ok = col.isPlayer ? AL.Life.layEgg(world, col, true) : AL.AI.layEgg(world, col, true);
        if (!ok) break;
        q.bank -= 1;
      }
      if (world.t >= b.layEnd && !(q.bank >= 1)) b.laying = false;
    }
    const hatched = st.n < 4 || st.l >= st.n * BT.HATCH;
    if ((t >= BT.STAT_MIN && hatched && !b.laying) || t >= BT.STAT_MAX) setPhase(world, col, b, 'nomadic');
  } else if (!b.march) {
    const pupated = st.n < 4 || st.l < st.n * BT.PUPATE;
    if ((t >= BT.NOM_MIN && pupated) || t >= BT.NOM_MAX) setPhase(world, col, b, 'statary');
    else autoMove(world, col, b);
  }
}

// statary raids fan out: rival army foragers stepping out head along the current swing
function fanOut(world, list) {
  const A = world.ants, R = world.R;
  if (!A.tmUid) return;
  for (let i = 0; i < A.high; i++) {
    if (A.state[i] !== ST.WANDER || A.layer[i] !== L.SURFACE || A.timer[i] > 1.2) continue;
    const col = world.colonies[A.col[i]];
    if (list.indexOf(col) < 0) continue;
    if (AL.dist2(A.x[i], A.y[i], col.x, col.y) > 30 * 30) continue;
    A.a[i] = col.biv.fan + (R() - 0.5) * 1.1;
    A.tmUid[i] = A.uid[i]; A.tmDoor[i] = world.t;   // behaviour.js: don't re-pick a way out at the door
  }
}

// ---- system ------------------------------------------------------------------------------------
function pre(world) {
  for (const col of world.colonies) {
    const b = col.biv, m = b && b.march;
    if (!m) continue;
    if (!col.alive) { b.march = null; b.phase = 'statary'; continue; }
    const tau = (world.t - m.t0) / m.dur;
    heart(col, m, tau);
  }
}
function second(world) {
  const fans = [];
  for (const col of world.colonies) {
    if (!nomad(col) || !col.alive || col.founding) continue;
    const b = state(col), m = b.march;
    if (m) {
      // the column is out in the open: count carriers that didn't make it
      const A = world.ants;
      for (const [uid, i] of m.carriers) if (A.uid[i] !== uid || A.carry[i] !== K.BROOD) { m.carriers.delete(uid); if (A.uid[i] !== uid) { m.lost++; loseBrood(world, col); } }
      // no raids leave while the colony is on the move
      if (col.ai) col.ai.raidT = Math.max(col.ai.raidT, 8);
      const tau = (world.t - m.t0) / m.dur;
      let left = 0;
      if (tau >= 1) for (let i = 0; i < A.high; i++) if (A.state[i] === ST.B_MARCH && A.col[i] === col.id && A.ty[i] === m.id) { left++; break; }
      if (tau >= 1.3 || (tau >= 1 && !left)) finish(world, col, b);
    } else {
      if (col.nest && ((world.t | 0) % 5 === 0)) reshape(world, col, false);
    }
    cycle(world, col, b);
    // hunters, not sippers: when the sugar runs short the colony eats into its prey (1 protein for 1 sugar)
    const st = col.stock;
    if (st.sugar < BT.MEAT_SUGAR && st.protein > 6) { const k = Math.min(st.protein - 6, BT.MEAT_SUGAR - st.sugar, 2 + adults(col.inside ? { pop: col.inside } : col) * 0.03); st.protein -= k; st.sugar += k; }
    // statary raids go out like spokes (rivals; the player aims their own)
    if (col.ai && !b.march && b.phase === 'statary') {
      if (world.t - b.fanT > BT.FAN_EVERY) { b.fanT = world.t; b.fan = AL.wrap((b.fan || world.R() * AL.TAU) + BT.FAN_TURN); }
      fans.push(col);
    }
  }
  if (fans.length) fanOut(world, fans);
}

AL.registerSystem({
  id: 'bivouac', order: 7.5,   // after ai (6) and species (7): may hold back laying/raids for marching colonies
  enabled: opts => !opts.benchOnly,
  init(world) {
    world.surfaceHandlers[ST.B_MARCH] = marchHandler;
    for (const c of world.colonies) if (nomad(c)) state(c);
  },
  pre, second,
});
AL.Bivouac = { TUNE: BT, start, canMarch, planRoute, pointAt, slotP, state, aiPickSpot, scoreSpot, nomad, banks, broodStages, trailPick };
if (NODE) { module.exports = AL.Bivouac; require('./swarm.js'); }
})(typeof window !== 'undefined' ? window : globalThis);
