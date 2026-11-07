// Nest climate and rooms (the deeper nest building set):
//  - Rooms: every connected patch of one chamber type is a room. A room levels up as it grows (LEVELS tiles for
//    levels 2, 3 and 4): more capacity per tile, and a bonus of its own (nursery: brood speed, queen chamber: laying,
//    food store: less spoilage, midden: less disease, pupa dryer: faster cocoons).
//  - Temperature layers: shallow rooms follow the surface (sun by day, cold at night, the mound's warmth), deep ones
//    stay near 20 C (nest.js second). Each nursery and dryer has its own temperature, brood grows by the room it lies
//    in, and the nurses carry brood to whichever room suits it better: eggs and larvae to the best nursery, pupae
//    to the pupa dryer.
//  - Pupa dryer: a warm, dry room; pupae there hatch DRYER x faster (DRYER_DEEP x when it is dug deeper than
//    DRYER_ROWS rows).
//  - Spit-lined walls: workers with nothing better to do line the tunnels and rooms, a tile at a time, for a little
//    sugar. Lined tiles never cave in and water never stands deep in them (nest.js), so floods drown less.
// Brood the nurses move (F.BROOD_FROM, to the room in F.BROOD_TO) and walls left to line (F.LINE) are nest fields.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); }
const N = AL.Nest, CH = N.CH, F = N.F, TILE = N.TILE, C = AL.CASTE, K = AL.CARRY, ST = AL.ST, ACT = AL.ACT;
ACT.BROOD_GET = 40; ACT.BROOD_PUT = 41; ACT.LINE = 42;
const NC = AL.NESTCLIMATE = Object.assign({
  LEVELS: [30, 60, 100],     // tiles a room needs for levels 2, 3 and 4 (the starter rooms, 17 to 29 tiles, are level 1)
  CAP: 0.1,                  // + capacity per level above 1 (food store, nursery, reservoir, barracks, midden, gardens)
  BROOD: 0.05,               // nursery: + brood speed per level
  LAY: 0.05,                 // queen chamber: + laying per level
  SPOIL: 0.08,               // food store: - spoilage per level
  DISEASE: 0.08,             // midden: - disease from it per level
  BEST_T: 27,                // brood grows fastest at this temperature
  GAIN: 0.08,                // nurses move brood only to a room this much better (no shuffling back and forth)
  CARRIERS: 0.6,             // ants on brood runs at once: this share of the nurses plus a fifth of the workers (at least 2)
  DRYER: 1.3, DRYER_DEEP: 1.12, DRYER_ROWS: 8,
  LINE_T: 5,                 // seconds a worker spends lining a tile
  LINE_SUGAR: 0.04,          // sugar a lined tile costs
  LINE_KEEP: 15,             // workers don't line walls with less sugar than this in store
  LINE_CHANCE: 1,            // share of resting workers that line walls instead (when there is sugar to spare)
}, AL.NESTCLIMATE || {});

// ---- rooms ---------------------------------------------------------------------------------------
const levelOf = n => { let l = 1; for (const t of NC.LEVELS) if (n >= t) l++; return l; };
function ensureRooms(nest) {
  if (nest._roomV === nest.version && nest.rooms) return nest.rooms;
  const n = nest.n, cols = nest.cols, kind = nest.kind, ch = nest.chamber;
  const of = nest.roomOf && nest.roomOf.length === n ? nest.roomOf : (nest.roomOf = new Int16Array(n));
  of.fill(-1);
  const rooms = [], q = [];
  for (let i = 0; i < n; i++) {
    if (kind[i] !== TILE.OPEN || !ch[i] || of[i] >= 0) continue;
    const c0 = ch[i], id = rooms.length, room = { id, ch: c0, tiles: [], row: 0, level: 1, temp: 22, warm: false, brood: 0 };
    q.length = 0; q.push(i); of[i] = id;
    while (q.length) {
      const j = q.pop(); room.tiles.push(j); room.row += (j / cols) | 0;
      const c = j % cols;
      for (const k of [c > 0 ? j - 1 : -1, c < cols - 1 ? j + 1 : -1, j - cols, j + cols]) {
        if (k < 0 || k >= n || of[k] >= 0 || kind[k] !== TILE.OPEN || ch[k] !== c0) continue;
        of[k] = id; q.push(k);
      }
    }
    room.tiles.sort((a, b) => a - b);
    room.row /= room.tiles.length; room.level = levelOf(room.tiles.length);
    rooms.push(room);
  }
  // new rooms know their temperature at once (as of the nest's last second), not only after the next one
  if (nest.tempAt) for (const r of rooms) if (r.ch === CH.NURSERY || r.ch === CH.DRYER) { r.temp = nest.tempAt(r.row); r.warm = true; }
  nest.rooms = rooms; nest._roomV = nest.version;
  return rooms;
}
// tiles of chamber type ch counted for capacity (each room's tiles times its level bonus)
function capMul(nest, ch) {
  let s = 0; for (const r of ensureRooms(nest)) if (r.ch === ch) s += r.tiles.length * (1 + NC.CAP * (r.level - 1));
  return s;
}
// the best level of chamber type ch (0: none dug)
function best(nest, ch) { let l = 0; for (const r of ensureRooms(nest)) if (r.ch === ch && r.level > l) l = r.level; return l; }
// layout multipliers from room levels (nestplan.js layout folds them in)
function layoutMul(nest) {
  const q = best(nest, CH.QUEEN), f = best(nest, CH.FOOD), m = best(nest, CH.MIDDEN);
  return { lay: 1 + NC.LAY * Math.max(0, q - 1), spoil: 1 - NC.SPOIL * Math.max(0, f - 1), midden: 1 - NC.DISEASE * Math.max(0, m - 1) };
}

// ---- temperature ---------------------------------------------------------------------------------
const tempF = (col, t) => AL.clamp(1 - Math.abs(t - NC.BEST_T) / (18 * ((col.mods && col.mods.cold) || 1)), 0.25, 1.05);
const holds = (room, b) => !!room && (room.ch === CH.NURSERY || (room.ch === CH.DRYER && b.stage === 2));
// how well brood b does in room r (temperature, level, the dryer for pupae)
function score(col, room, b) {
  if (!room) return 0;
  let s = tempF(col, room.temp);
  if (room.ch === CH.NURSERY) s *= 1 + NC.BROOD * (room.level - 1);
  else if (room.ch === CH.DRYER && b.stage === 2) s *= (room.row <= NC.DRYER_ROWS ? NC.DRYER : NC.DRYER_DEEP) * (1 + NC.BROOD * (room.level - 1));
  return s;
}
// the best room for brood b (-1: no nursery or dryer)
function target(col, b) {
  const rooms = col.nest.rooms || []; let bi = -1, bs = -1;
  for (const r of rooms) if (holds(r, b)) { const s = score(col, r, b); if (s > bs + 1e-9) { bs = s; bi = r.id; } }
  return bi;
}
// nest.js second: each nursery's and dryer's temperature, and the brood's average (the HUD's nursery temperature)
function temps(nest) {
  const col = nest.colony; if (!col || nest.bivouac || !nest.tempAt) return;
  const rooms = ensureRooms(nest);
  for (const r of rooms) if (r.ch === CH.NURSERY || r.ch === CH.DRYER) { r.temp = nest.tempAt(r.row); r.warm = true; r.brood = 0; }
  let n = 0, t = 0;
  for (const b of col.brood || []) { const r = b.room >= 0 ? rooms[b.room] : null; if (r && r.warm) { r.brood++; n++; t += r.temp; } }
  if (n) nest.nurseryTemp = t / n;
  else { let bt = null; for (const r of rooms) if (r.ch === CH.NURSERY && (bt == null || tempF(col, r.temp) > tempF(col, bt))) bt = r.temp; if (bt != null) nest.nurseryTemp = bt; }
}
// life.js broodRate: the brood's average temperature factor, each in its own room (null: no brood in a room yet)
function broodTempF(col) {
  const nest = col.nest; if (!nest || nest.bivouac || !nest.rooms) return null;
  let n = 0, f = 0;
  for (const b of col.brood) { const r = b.room >= 0 ? nest.rooms[b.room] : null; if (r && r.warm) { n++; f += tempF(col, r.temp); } }
  return n ? f / n : null;
}
// life.js brood loop: brood b grows this much faster than the colony's rate (its own room vs the brood's average)
function broodMul(col, b) {
  const nest = col.nest; if (!nest || nest.bivouac || !nest.rooms) return 1;
  const r = b.room >= 0 ? nest.rooms[b.room] : null; if (!r || !r.warm) return 1;
  const avg = col._broodTf || tempF(col, r.temp);
  return score(col, r, b) / Math.max(0.05, avg);
}

// ---- where the brood lies ----------------------------------------------------------------------------
// life.js placeBrood: brood stays in its room while the room is there (the nurses move it); new or homeless brood
// goes to the best room for it; with no nursery at all it lies in the queen's chamber
function place(col) {
  const nest = col.nest, rooms = ensureRooms(nest), groups = new Map();
  for (const b of col.brood) {
    if (b.carry) { b.slot = -1; continue; }   // in a nurse's jaws
    let r = b.slot >= 0 ? nest.roomOf[b.slot] : (b.room != null && b.room >= 0 && rooms[b.room] && b._rv === nest._roomV ? b.room : -1);
    if (r < 0 || !holds(rooms[r], b)) r = target(col, b);
    b.room = r; b._rv = nest._roomV;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(b);
  }
  for (const [r, list] of groups) {
    const tiles = r >= 0 ? rooms[r].tiles : nest.tiles[CH.QUEEN];
    list.forEach((b, k) => { if (!tiles.length) { b.slot = -1; return; } b.slot = tiles[k % tiles.length]; b.sub = (k / tiles.length) | 0; });
  }
  col.broodLayout = nest.layoutVersion;
}

// ---- the nurses move brood ---------------------------------------------------------------------------
// once a second per nest: which brood wants moving (one destination room at a time), fields for the nurses
function plan(world, col) {
  const nest = col.nest, rooms = ensureRooms(nest), cl = col.climate || (col.climate = { to: -1, left: 0, going: 0, sig: '' });
  let to = -1, gain = 0;
  const want = [];
  for (const b of col.brood) {
    if (b.carry || b.room == null || b.room < 0 || b.slot < 0) continue;
    const t = target(col, b); if (t < 0 || t === b.room) continue;
    const g = score(col, rooms[t], b) / Math.max(0.05, score(col, rooms[b.room], b));
    if (g < 1 + NC.GAIN) continue;
    want.push([b, t]);
    if (g > gain) { gain = g; to = t; }
  }
  const from = [];
  for (const [b, t] of want) if (t === to) from.push(b.slot);
  cl.to = to; cl.left = from.length;
  // nurses already on a run
  const A = world.ants; let going = 0;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col.id && A.layer[i] === AL.LAYER.NEST && A.nest[i] === col.hid && (A.act[i] === ACT.BROOD_GET || A.act[i] === ACT.BROOD_PUT)) going++;
  cl.going = going;
  // brood dropped by a nurse that died or got pulled away: back where it was
  let lost = false;
  for (const b of col.brood) if (b.carry && !carrier(world, col, b)) { b.carry = 0; lost = true; }
  if (lost) col.broodLayout = -1;
  const sig = to + ':' + from.slice().sort((a, b) => a - b).join(',');
  if (sig !== cl.sig) {
    cl.sig = sig;
    const fs = new Set(from);
    N.bfs(nest, nest.fields[F.BROOD_FROM], i => fs.has(i));
    N.bfs(nest, nest.fields[F.BROOD_TO], i => to >= 0 && nest.roomOf[i] === to);
  }
}
function carrier(world, col, b) {
  const A = world.ants, i = b.ci;
  return i >= 0 && A.state[i] && A.uid[i] === b.carry && A.carry[i] === K.BROOD && (A.act[i] === ACT.BROOD_PUT);
}
// life.js decide: a nurse (or, with hardly any nurses, a worker) takes a brood run if one is wanted
function moveJob(world, i, col) {
  const cl = col.climate, nest = col.nest; if (!cl || cl.to < 0 || cl.left <= 0 || nest.bivouac) return false;
  const cap = Math.max(2, Math.round((col.pop[C.NURSE] + col.pop[C.WORKER] * 0.2) * NC.CARRIERS));
  if (cl.going >= Math.min(cl.left, cap)) return false;
  const A = world.ants, v = nest.fields[F.BROOD_FROM][N.tileOf(nest, A.x[i], A.y[i])];
  if (v === N.FAR) return false;
  cl.going++;
  AL.Life.goTo(world, i, F.BROOD_FROM, ACT.BROOD_GET);
  return true;
}

// ---- lining the walls ----------------------------------------------------------------------------------
function lineField(nest) {
  const lined = nest.lined, kind = nest.kind; let left = 0, open = 0;
  for (let i = nest.cols; i < nest.n; i++) if (kind[i] === TILE.OPEN) { open++; if (!lined[i]) left++; }
  nest.lineLeft = left; nest.lineOpen = open; nest.lineDirty = false;
  N.bfs(nest, nest.fields[F.LINE], i => i >= nest.cols && kind[i] === TILE.OPEN && !lined[i]);
}
// life.js decide: a resting worker lines walls instead (needs sugar to spare)
function lineJob(world, i, col) {
  const nest = col.nest; if (!nest || nest.bivouac || !nest.lineLeft || world.env.winter) return false;
  if ((col.stock.sugar || 0) < NC.LINE_KEEP || world.R() >= NC.LINE_CHANCE) return false;
  const A = world.ants, v = nest.fields[F.LINE][N.tileOf(nest, A.x[i], A.y[i])];
  if (v === N.FAR) return false;
  AL.Life.goTo(world, i, F.LINE, ACT.LINE);
  return true;
}

// ---- life.js arrive -------------------------------------------------------------------------------------
function arrive(world, i, col, tile) {
  const A = world.ants, act = A.act[i], nest = col.nest, R = world.R;
  if (act === ACT.LINE) {
    if (nest.kind[tile] === TILE.OPEN && !nest.lined[tile] && col.stock.sugar >= NC.LINE_SUGAR) {
      nest.lined[tile] = 1; col.stock.sugar -= NC.LINE_SUGAR; nest.lineDirty = true; nest.lineLeft = Math.max(0, (nest.lineLeft || 1) - 1);
      A.state[i] = ST.N_WORK; A.timer[i] = NC.LINE_T * (0.8 + R() * 0.4); A.act[i] = 0;
      if (!nest.lineLeft) AL.emit(world, 'nestLined', { col: col.id, hid: col.hid });
    } else AL.Life.decide(world, i);
    return true;
  }
  if (act === ACT.BROOD_GET) {
    const cl = col.climate, to = cl ? cl.to : -1;
    let b = null;
    if (to >= 0) for (const x of col.brood) if (!x.carry && x.slot === tile && x.room !== to && target(col, x) === to) { b = x; break; }
    if (!b) { AL.Life.decide(world, i); return true; }
    b.carry = A.uid[i]; b.ci = i; b.slot = -1;
    A.carry[i] = K.BROOD; A.load[i] = 0;
    if (cl) { cl.left--; cl.sig = ''; }   // (the fields are rebuilt next second)
    AL.Life.goTo(world, i, F.BROOD_TO, ACT.BROOD_PUT);
    return true;
  }
  if (act === ACT.BROOD_PUT) {
    const b = col.brood.find(x => x.carry === A.uid[i] && x.ci === i);
    A.carry[i] = 0;
    if (b) {
      const r = nest.roomOf[tile];
      b.carry = 0; b.ci = -1;
      if (r >= 0 && holds(nest.rooms[r], b)) { b.room = r; b.slot = tile; } else b.slot = -1;
      col.broodLayout = -1;   // spread it out in its new room (life.js placeBrood)
      AL.emit(world, 'broodMoved', { col: col.id, hid: col.hid, room: b.room });
    }
    A.state[i] = ST.N_WORK; A.timer[i] = 1.5 + R() * 2; A.act[i] = 0;
    return true;
  }
  return false;
}

// nest.js rebuild: the rooms and the lining field after any change to the nest
function rebuilt(nest) {
  if (nest.bivouac) return;
  ensureRooms(nest);
  lineField(nest);
  if (nest.colony && nest.colony.climate) nest.colony.climate.sig = '';   // rooms moved: rebuild the brood fields
}

AL.registerSystem({
  id: 'nestclimate', order: 2.05,
  second(world) {
    const H = world.homes || world.colonies;
    for (const h of H) {
      if (!h || h.gone || !h.nest || h.alive === false || h.nest.bivouac || !h.brood || (h.sp && h.sp.nomad)) continue;
      ensureRooms(h.nest);
      if (h.nest.lineDirty) lineField(h.nest);
      plan(world, h);
    }
  },
});

AL.NestClimate = { NC, levelOf, ensureRooms, capMul, best, layoutMul, tempF, holds, score, target, temps, broodTempF, broodMul, place, plan, moveJob, lineJob, lineField, arrive, rebuilt };
if (NODE) module.exports = AL.NestClimate;
})(typeof window !== 'undefined' ? window : globalThis);
