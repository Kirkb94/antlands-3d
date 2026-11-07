// Player raids and moves: commands the Raid and Send tools issue (raids-ui.js), simulated the same on every PC.
//  - Raid: the chosen numbers of workers (workers, foragers, scouts), soldiers and majors of one of your nests muster
//    at its mound, then march on an enemy anthill (a colony's or a satellite's), break in once its door is clear
//    and go for the queen. They don't turn back: hunger, wounds and losing fights don't send them home. The raid is
//    over when that queen is dead (the survivors loot the store and carry it home) or you call it off.
//  - Send: the chosen ants of one of your nests walk to another of your hills and live there from then on.
// Raiders are ordinary RAID ants (orders.js raidHandler) with A.str = the raid's id, listed in world.praids.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./cmd.js');
const ST = AL.ST, C = AL.CASTE, L = AL.LAYER;
const MUSTER = 12;   // seconds the party gathers at its own mound before it marches
// the three groups the sliders pick from
const GROUP = new Int8Array(16).fill(-1);
GROUP[C.WORKER] = 0; GROUP[C.FORAGER] = 0; GROUP[C.SCOUT] = 0; GROUP[C.SOLDIER] = 1; GROUP[C.MAJOR] = 2;
const KEYS = ['w', 's', 'm'];

// one of colony col's homes (a.h: a satellite's nest id; else the capital)
function homeFor(world, col, h) { const hm = h != null && world.homes && world.homes[h | 0]; return hm && hm.id === col && !hm.gone ? hm : world.colonies[col]; }
// does ant i live in home `home`, and is it free to go (not already raiding, carrying brood, being a queen...)?
function lives(world, i, home) {
  const A = world.ants, st = A.state[i];
  if (!st || A.col[i] !== home.id || GROUP[A.caste[i]] < 0) return false;
  if (A.layer[i] === L.NEST ? A.nest[i] !== home.hid : A.home[i] !== home.hid) return false;
  if (st === ST.RAID || st === ST.N_RAID || st === ST.N_TRANSIT || st === ST.DEAD || st >= 40) return false;   // (40+: stage states that place ants themselves)
  if (st === ST.FIGHT && (A.prev[i] === ST.RAID || A.prev[i] === ST.N_RAID)) return false;
  if (A.layer[i] === L.NEST && A.prev[i] === ST.RAID) return false;   // already on its way out to a raid
  if (world.moves && world.moves.size && world.moves.has(A.uid[i])) return false;   // already sent to another hill
  return true;
}
// how many of each group a home could send: { w, s, m }
function counts(world, home) {
  const A = world.ants, n = [0, 0, 0];
  if (home) for (let i = 0; i < A.high; i++) if (lives(world, i, home)) n[GROUP[A.caste[i]]]++;
  return { w: n[0], s: n[1], m: n[2] };
}
// the ants to send: up to want.w / want.s / want.m of each group, the ones out on the surface first
function pick(world, home, want) {
  const A = world.ants, left = KEYS.map(k => Math.max(0, Math.floor(+want[k] || 0))), out = [];
  for (const layer of [L.SURFACE, L.NEST]) for (let i = 0; i < A.high; i++) {
    if (A.layer[i] !== layer || !lives(world, i, home)) continue;
    const g = GROUP[A.caste[i]]; if (left[g] > 0) { left[g]--; out.push(i); }
  }
  return out;
}
// the anthill (a colony's main mound or a satellite with its own nest) under (x, y)
function hillAt(world, x, y) {
  let best = null, bd = Infinity;
  for (const h of world.homes || world.colonies) {
    if (!h || h.gone || h.alive === false || h.out) continue;
    const r = (h.moundR || 16) * 2.5 + 40, d = AL.dist2(h.x, h.y, x, y);
    if (d < r * r && d < bd) { bd = d; best = h; }
  }
  return best;
}
const alive = h => !!h && !h.gone && h.alive !== false && !h.out && (!h.queen || h.queen.alive);
// send ant i out of its nest (or on its way on the surface) as `state`
function launch(world, i, state) {
  const A = world.ants;
  if (A.layer[i] === L.NEST) { if (AL.Life) AL.Life.exitAs(world, i, state); return; }
  if (A.state[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  A.state[i] = state; A.timer[i] = 0; A.tgt[i] = -1; A.task[i] = 0; A.wf[i] = 0;
}

// ---- raids ----
function raid(world, col, a) {
  const from = homeFor(world, col, a.h), tgt = hillAt(world, +a.x, +a.y);
  if (!tgt) return { ok: false, why: 'Click an enemy anthill.' };
  if (tgt.id === col) return { ok: false, why: 'That hill is yours: use Send to move ants there.' };
  if (!alive(tgt)) return { ok: false, why: 'That colony is finished.' };
  if (!tgt.nest && !tgt.siegeIn) return { ok: false, why: 'There is no way into that hill.' };
  const ants = pick(world, from, a);
  if (!ants.length) return { ok: false, why: 'No ants picked to send.' };
  world.praids = world.praids || []; world.raidSeq = (world.raidSeq || 0) + 1;
  const r = { id: world.raidSeq, col, hid: from.hid, tgt: tgt.hid != null ? tgt.hid : tgt.id, t0: world.t, go: world.t + MUSTER, n0: ants.length, n: ants.length, mx: from.x, my: from.y };
  world.praids.push(r);
  const A = world.ants;
  for (const i of ants) { A.str[i] = r.id; launch(world, i, ST.RAID); }
  AL.emit(world, 'playerRaid', { col, raid: r, tcol: tgt.id });
  return { ok: true, n: ants.length, id: r.id, sat: !!tgt.sat };
}
// the player raid ant i is on (null: none, or an AI raid)
function raidOf(world, i) {
  const P = world.praids; if (!P || !P.length) return null;
  const A = world.ants, id = A.str[i], col = A.col[i];
  for (const r of P) if (r.id === id && r.col === col) return r;
  return null;
}
// is ant i on a player raid (on the march, fighting on the way, or inside the enemy nest)?
function raiding(world, i) {
  const A = world.ants, st = A.state[i];
  if (st !== ST.RAID && st !== ST.N_RAID && !(st === ST.FIGHT && (A.prev[i] === ST.RAID || A.prev[i] === ST.N_RAID)) && !(A.layer[i] === L.NEST && A.prev[i] === ST.RAID)) return false;
  return !!raidOf(world, i);
}
// where a player raider heads: its own mound while the party musters, then the target hill
function target(world, r) { return (world.homes || world.colonies)[r.tgt]; }
// end a raid: on the surface the survivors go home; inside the enemy nest they loot the store and carry it out
function endRaid(world, r, why) {
  const A = world.ants;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== r.col || A.str[i] !== r.id) continue;
    const st = A.state[i];
    if (A.layer[i] === L.SURFACE && (st === ST.RAID || (st === ST.FIGHT && A.prev[i] === ST.RAID))) { if (st === ST.FIGHT && AL.Combat && AL.Combat.flee) AL.Combat.flee(world, i); else { A.state[i] = ST.HOMING; A.timer[i] = 0; } }
    else if (A.layer[i] === L.NEST && A.prev[i] === ST.RAID && st === ST.N_GOTO) { A.prev[i] = 0; if (AL.Life) AL.Life.decide(world, i); }   // still leaving its own nest
    if (A.str[i] === r.id) A.str[i] = 0;
  }
  world.praids = world.praids.filter(q => q !== r);
  AL.emit(world, 'playerRaidOver', { col: r.col, raid: r, why });
}
function endCmd(world, col, a) { const r = (world.praids || []).find(q => q.id === (a.id | 0) && q.col === col); if (!r) return false; endRaid(world, r, 'called off'); return true; }

// ---- moves ----
function send(world, col, a) {
  const from = homeFor(world, col, a.h), to = hillAt(world, +a.x, +a.y);
  if (!to || to.id !== col) return { ok: false, why: 'Click another of your hills.' };
  if (to === from) return { ok: false, why: 'Those ants already live there: pick another nest in the Nests tabs first.' };
  if (!to.nest && to !== world.colonies[col]) return { ok: false, why: 'That hill has no nest to live in.' };
  const ants = pick(world, from, a);
  if (!ants.length) return { ok: false, why: 'No ants picked to send.' };
  const A = world.ants, mv = world.moves || (world.moves = new Map());
  for (const i of ants) {
    if (A.layer[i] === L.NEST && AL.Links && AL.Links.send(world, i, to.hid)) continue;   // a nest tunnel joins the two nests: underground (links.js)
    if (A.layer[i] === L.NEST) { mv.set(A.uid[i], to.hid); launch(world, i, ST.HOMING); }   // life.js leaveNest reads world.moves
    else { A.home[i] = to.hid; if (A.state[i] !== ST.RETURN) launch(world, i, ST.HOMING); }
  }
  AL.emit(world, 'antsSent', { col, n: ants.length, from: from.hid, to: to.hid });
  return { ok: true, n: ants.length };
}

AL.registerSystem({
  id: 'raids', order: 4,
  second(world) {
    const P = world.praids; if (!P || !P.length) return;
    const A = world.ants;
    for (const r of P.slice()) {
      const c = world.colonies[r.col];
      if (!c || c.alive === false) { world.praids = world.praids.filter(q => q !== r); continue; }
      if (c.recall) { endRaid(world, r, 'recalled'); continue; }
      const t = target(world, r);
      if (!alive(t)) { endRaid(world, r, 'won'); continue; }
      let n = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === r.col && A.str[i] === r.id && raiding(world, i)) n++;
      r.n = n;
      if (!n && world.t > r.go + 5) { endRaid(world, r, 'lost'); continue; }
    }
  },
});
if (AL.Cmd) { AL.Cmd.def('raid', raid); AL.Cmd.def('raidEnd', endCmd); AL.Cmd.def('send', send); }
AL.Raids = { counts, pick, hillAt, homeFor, raid, send, endRaid, raidOf, raiding, target, alive, MUSTER, GROUP };
if (NODE) module.exports = AL.Raids;
})(typeof window !== 'undefined' ? window : globalThis);
