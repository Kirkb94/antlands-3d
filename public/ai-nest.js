// AI rivals with a real nest (sim opts.rivalNests; colonies with c.bot): the colony lives exactly like a person's
// (life.js, hunger.js, nest.js: every ant is simulated, above ground and in the tunnels). This module plays it,
// using the same levers a person has:
//   - digging: plans new rooms (food store, nursery, barracks, water, midden) as the colony fills what it has, and
//     marks a tunnel to each one; the workers dig them
//   - eggs: auto mix, with soldiers queued while enemies are about
//   - defence: an alarm at the mound when enemies come close (soldiers come up and fight)
//   - scouting: small recruit parties to where the rivals might be (ai.js knowledge: leads, explored ground)
//   - raids: a recruit order down a path to a known rival's mound; at the end the party charges (orders.js RAID)
//     and breaks into the nest, where the fight goes on in the tunnels
// What the AI knows and whom it raids comes from ai.js (sense, pickTarget, levels). Pure sim (no DOM), deterministic.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); require('./life.js'); require('./orders.js'); require('./ai.js'); }
const ST = AL.ST, C = AL.CASTE, N = AL.Nest, CH = N.CH, TILE = N.TILE;

const BT = {
  PLAN_EVERY: 6,          // s between dig plans
  PENDING_MAX: 6,         // don't plan more while this many tiles are still marked to dig
  FOOD_FULL: 0.65,        // plan a food store when the stores are this full
  NURSERY_FULL: 0.8,      // ... a nursery when the brood fills this much of it
  WATER_MIN: 35,          // ... a water chamber while the colony holds less water than this
  BARRACKS_AT: 12,        // soldiers + majors before the colony wants a barracks
  ALARM_AT: 2,            // enemies near the mound before an alarm
  ALARM_EVERY: 8,
  SCOUT_N: 3,
  RAID_STOP: 70,          // the raid path ends this far short of the target mound; from there the party charges
  SOLDIER_SHARE: 0.18,    // while threatened: queue soldiers until this share of adults
};
// room shapes per chamber type: half-width, half-height (tiles), preferred depth (rows below ground)
const ROOM = {
  [CH.FOOD]: { hw: 3.2, hh: 1.5, depth: 10 },
  [CH.NURSERY]: { hw: 3.4, hh: 1.6, depth: 14 },
  [CH.BARRACKS]: { hw: 3, hh: 1.4, depth: 6 },
  [CH.WATER]: { hw: 2.6, hh: 1.3, depth: 22 },
  [CH.MIDDEN]: { hw: 2.4, hh: 1.2, depth: 8 },
};

const adultsOf = col => { let n = 0; for (let k = 0; k < col.pop.length; k++) if (k !== C.QUEEN) n += col.pop[k]; return n; };
const roomTiles = (cc, rc, hw, hh) => {
  const out = [];
  for (let r = Math.floor(rc - hh); r <= Math.ceil(rc + hh); r++) for (let c = Math.floor(cc - hw); c <= Math.ceil(cc + hw); c++) {
    const dx = (c - cc) / (hw + 0.5), dy = (r - rc) / (hh + 0.5);
    if (dx * dx + dy * dy <= 1) out.push([c, r]);
  }
  return out;
};

// ---- digging ------------------------------------------------------------------------------------------
// what the colony is short of, most pressing first
function roomNeed(col) {
  const nest = col.nest, s = col.stock, cap = col.cap, has = ch => nest.tiles[ch].length > 0;
  const food = s.sugar + s.protein + (s.seeds || 0);
  if (!has(CH.FOOD) || food > (cap.food || 1) * BT.FOOD_FULL) return CH.FOOD;
  if (!has(CH.NURSERY) || col.brood.length > (cap.nursery || 1) * BT.NURSERY_FULL) return CH.NURSERY;
  if ((col.pop[C.SOLDIER] + col.pop[C.MAJOR]) >= BT.BARRACKS_AT && !has(CH.BARRACKS)) return CH.BARRACKS;
  if (!has(CH.MIDDEN) && adultsOf(col) > 60) return CH.MIDDEN;
  if ((s.water || 0) < BT.WATER_MIN && !has(CH.WATER) && adultsOf(col) > 40) return CH.WATER;
  return 0;
}
// the best free spot for a room: whole room in diggable soil, near the tunnels, near its preferred depth.
// Returns { tiles, path } (path: soil tiles to mark from the nearest open tile to the room) or null.
function placeRoom(nest, ch) {
  const R = ROOM[ch], cols = nest.cols, rows = nest.rows, kind = nest.kind;
  const open = [];
  for (let i = 0; i < nest.n; i++) if (kind[i] === TILE.OPEN) open.push(i);
  if (!open.length) return null;
  let best = null, bs = Infinity;
  for (let rc = 4; rc < Math.min(rows - 4, nest.waterTable - 3); rc += 2) {
    for (let cc = 5; cc < cols - 5; cc += 3) {
      const tiles = roomTiles(cc, rc, R.hw, R.hh);
      let ok = true;
      for (const [c, r] of tiles) {
        const i = N.idx(nest, c, r);
        if (i < 0 || kind[i] === TILE.OPEN || !N.diggable(nest, i) || nest.mark[i]) { ok = false; break; }
        // keep a wall of soil between rooms: no open tile right next to the room (except where the tunnel joins)
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = N.idx(nest, c + dc, r + dr); if (j >= 0 && kind[j] === TILE.OPEN) { ok = false; break; } }
        if (!ok) break;
      }
      if (!ok) continue;
      // nearest open tile (Manhattan), then an L-shaped tunnel to it
      let oi = -1, od = Infinity;
      for (const i of open) { const d = Math.abs((i % cols) - cc) + Math.abs(((i / cols) | 0) - rc); if (d < od) { od = d; oi = i; } }
      const path = tunnel(nest, oi % cols, (oi / cols) | 0, Math.round(cc), Math.round(rc), tiles);
      if (!path) continue;
      const score = path.length * 1.5 + Math.abs(rc - R.depth) * 1.2 + (ch === CH.NURSERY ? Math.abs(cc - nest.entrance.c) * 0.15 : 0);
      if (score < bs) { bs = score; best = { tiles, path }; }
    }
  }
  return best;
}
// soil tiles from an open tile (c0, r0) to the room centre: down/up first, then across. null if rock or roots block it.
function tunnel(nest, c0, r0, c1, r1, room) {
  const inRoom = new Set(room.map(([c, r]) => r * nest.cols + c)), out = [];
  let c = c0, r = r0;
  const step = () => {
    const i = N.idx(nest, c, r);
    if (i < 0) return false;
    if (inRoom.has(i)) return 'in';
    if (nest.kind[i] === TILE.OPEN) return true;
    if (!N.diggable(nest, i)) return false;
    out.push([c, r]); return true;
  };
  while (r !== r1) { r += r1 > r ? 1 : -1; const s = step(); if (!s) return null; if (s === 'in') return out; }
  while (c !== c1) { c += c1 > c ? 1 : -1; const s = step(); if (!s) return null; if (s === 'in') return out; }
  return out;
}
function plan(world, col) {
  const nest = col.nest, b = col.bot;
  if (nest.digCount > BT.PENDING_MAX || world.t < b.planT) return;
  b.planT = world.t + BT.PLAN_EVERY;
  const ch = roomNeed(col); if (!ch) return;
  const spot = placeRoom(nest, ch); if (!spot) { b.planT = world.t + BT.PLAN_EVERY * 4; return; }
  for (const [c, r] of spot.path) N.mark(nest, c, r);
  for (const [c, r] of spot.tiles) N.designate(nest, c, r, ch);
  b.rooms = (b.rooms || 0) + 1;
  AL.emit(world, 'botRoom', { col: col.id, ch, n: spot.tiles.length });
}

// ---- eggs, defence, scouting, raids --------------------------------------------------------------------
function eggs(world, col) {
  const ai = col.ai, threatened = ai.lastSeen > 0 && world.t - ai.lastSeen < 150, ad = Math.max(1, adultsOf(col));
  if (threatened && col.eggQueue.length < 2 && (col.pop[C.SOLDIER] + col.pop[C.MAJOR]) < ad * BT.SOLDIER_SHARE) col.eggQueue.push(C.SOLDIER);
  if (world.t > 900 && col.eggQueue.length < 2 && col.pop[C.MAJOR] < ad * 0.04 && (world.t | 0) % 60 === 0) col.eggQueue.push(C.MAJOR);
}
function defend(world, col) {
  const ai = col.ai, n = col._int || 0;
  if (n) ai.lastSeen = world.t;
  if (n >= BT.ALARM_AT && world.t - (col.bot.alarmT || -99) > BT.ALARM_EVERY) {
    col.bot.alarmT = world.t;
    AL.Orders.addAlarm(world, col.id, col._ix, col._iy, col.hid);
  }
}
function busyOrders(col) { return (col.orders || []).filter(o => !o.done && !o.full).length; }
function scout(world, col) {
  const ai = col.ai;
  if (!ai.unknown || world.env.winter || world.env.rain > 0.35) return;
  ai.scoutT -= ai.leads.length ? 2 : 1;
  if (ai.scoutT > 0 || busyOrders(col)) return;
  const AT = AL.AI.TUNE; ai.scoutT = AT.SCOUT_EVERY[0] + world.R() * (AT.SCOUT_EVERY[1] - AT.SCOUT_EVERY[0]);
  const p = AL.AI.scoutPoint(world, col);
  const o = AL.Orders.addRecruit(world, col.id, [{ x: col.x, y: col.y }, { x: p.x, y: p.y }], BT.SCOUT_N, col.hid);   // (the capital's ants: orders.js hid)
  o.castes = [C.SCOUT, C.FORAGER, C.WORKER]; o.bot = 'scout';
  ai.scouts += BT.SCOUT_N;
}
function raid(world, col) {
  const ai = col.ai, p = col.pop, lv = AL.AI.levelOf(col), R = world.R;
  ai.raidT -= 1;
  if (ai.raidT > 0 || world.env.winter) return;
  const army = p[C.SOLDIER] + p[C.MAJOR] * 2;
  const tgt = army + p[C.WORKER] * 0.3 >= 10 && !busyOrders(col) ? AL.AI.pickTarget(world, col) : -1;
  if (tgt < 0) { ai.raidT = army + p[C.WORKER] * 0.3 >= 10 ? 20 : 40; if (ai.unknown) ai.scoutT = Math.min(ai.scoutT, 4); return; }
  ai.wave++; ai.target = tgt;
  const nS = Math.min(p[C.SOLDIER], Math.round((5 + ai.wave * 5) * lv.raidSize)), nM = Math.min(p[C.MAJOR], Math.floor(ai.wave / 2 * lv.raidSize)), nW = Math.min(p[C.WORKER], Math.floor(p[C.WORKER] * 0.3 * lv.raidSize));
  const T_ = world.colonies[tgt], d = AL.hypot(T_.x - col.x, T_.y - col.y) || 1, ux = (T_.x - col.x) / d, uy = (T_.y - col.y) / d;
  const stop = Math.max(0, d - BT.RAID_STOP);
  const o = AL.Orders.addRecruit(world, col.id, [{ x: col.x, y: col.y }, { x: col.x + ux * stop * 0.5, y: col.y + uy * stop * 0.5 }, { x: col.x + ux * stop, y: col.y + uy * stop }], nS + nM + nW, col.hid);
  o.castes = [C.SOLDIER, C.MAJOR, C.WORKER]; o.bot = 'raid'; o.raid = tgt;
  ai.raid = null;   // the party forms at the end of the path (orders.js turns the recruits into raiders there)
  AL.emit(world, 'raid', { col: col.id, target: tgt, n: nS + nM + nW, wave: ai.wave });
  ai.raidT = (150 + R() * 90 - Math.min(60, ai.wave * 8)) * (AL.AI.twist(col).raidEvery || 1) * lv.raidEvery;
}
// a recruit of a bot's raid order reached the end of the path: it charges (orders.js calls this)
function charge(world, i, o) {
  const A = world.ants, col = world.colonies[A.col[i]], ai = col.ai, T_ = world.colonies[o.raid];
  if (!T_ || !T_.alive || T_.out) { A.state[i] = ST.HOMING; return; }
  ai.target = o.raid;
  if (!ai.raid || ai.raid.target !== o.raid || ai.raid.order !== o.id) {
    const d = AL.hypot(T_.x - col.x, T_.y - col.y) || 1;
    ai.raid = { target: o.raid, order: o.id, n0: o.want, t0: world.t, ux: (T_.x - col.x) / d, uy: (T_.y - col.y) / d, front: 0, n: 1 };
  }
  A.state[i] = ST.RAID; A.timer[i] = 0;
}

// a rival that was still founding when the match began (founding-race.js, numbers model) gets its real nest when it
// opens: its head count becomes ants in a fresh nest, its queen a queen ant; what its AI knows carries over
function toBot(world, col) {
  if (col.nest || col.out || !col.inside || col.sp.nomad) return false;
  const ins = col.inside; let n = 0; for (let k = 0; k < ins.length; k++) if (k !== C.QUEEN) n += ins[k];
  const qFrac = col.queen && col.queen.maxHp ? AL.clamp(col.queen.hp / col.queen.maxHp, 0.2, 1) : 1, stock = Object.assign({}, col.stock);
  delete col.inside; delete col.broodQ; delete col.siege; col.sieging = false;
  const o = AL.Life.botOpts(col, world.opts || {}); o.start.workers = Math.max(4, Math.round(n)); o.start.stock = { sugar: stock.sugar, protein: stock.protein, water: stock.water || 20 };
  AL.Life.initColony(world, col, o);
  const A = world.ants, qi = col.queen.i; if (qi >= 0) { A.hp[qi] = A.maxhp[qi] * qFrac; col.queen.hp = A.hp[qi]; }
  col.bot = true; if (world.detailed && world.detailed.indexOf(col.id) < 0) world.detailed.push(col.id);
  if (col.ai) col.ai.bot = true;
  col.siegeIn = AL.Sim.siegeInHere;
  AL.emit(world, 'botNest', { col: col.id });
  return true;
}

function second(world) {
  for (const col of world.colonies) {
    if (!col.bot || !col.nest || !col.ai || !col.alive || col.out || col.founding) continue;
    if (col.bot === true) col.bot = { planT: 4 + col.id, alarmT: -99, rooms: 0 };
    try {
      plan(world, col);
      eggs(world, col);
      defend(world, col);
      scout(world, col);
      raid(world, col);
      if (col.ai.raid) AL.AI.raidParty(world, col);
    } catch (e) { if (AL.reportError) AL.reportError(e, 'ai-nest', world); else throw e; }
  }
}

AL.registerSystem({ id: 'ai-nest', order: 6.5, enabled: opts => !!opts.rivalNests && !opts.benchOnly, second });
AL.on('foundingDone', (world, d) => { const c = world && world.colonies && world.colonies[d.col]; if (c && !c.isPlayer && world.opts && world.opts.rivalNests) toBot(world, c); });
AL.AINest = { BT, ROOM, roomNeed, placeRoom, plan, charge, second, toBot };
if (NODE) module.exports = AL.AINest;
})(typeof window !== 'undefined' ? window : globalThis);
