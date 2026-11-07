// Nest tunnels (the late 'nestlink' research, mods.nestlink): link two of your own nests underground.
//  - The Link tool [P] (deepnest-ui.js) issues the 'link' command with two of your hills. A crew of diggers leaves
//    the first one and digs towards the other (like a raid tunnel: abstract, by time); it costs a little food.
//  - Once open, ants move between the two nests through it instead of over the lawn: an ant sent to the other hill
//    (raids.js Send) or a hauler walks to its nest's door and is out of sight (ST.N_TRANSIT) for the walk, then comes
//    out inside the other nest.
//  - Haulers: every few seconds each open tunnel looks at the two food stores and, if one is much fuller in sugar or
//    protein, a worker from the fuller nest carries a load across and walks back.
// world.links: [{ id, col, a, b (nest ids), x0, y0, x1, y1, len, prog, state: 'dig' | 'open', crew, t0, flow }]
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); require('./cmd.js'); }
const ST = AL.ST, C = AL.CASTE, L = AL.LAYER, K = AL.CARRY;
const LK = AL.LINK_TUNE = Object.assign({
  COST: { sugar: 30, protein: 30 },
  DIGGERS: 6,         // workers that go down to dig (they come out at the far end when it is done)
  DIG_SPEED: 10,      // units a second with a full crew (x the species' digging)
  MAX_LEN: 2600,      // longest tunnel
  WALK: 45,           // units a second an ant covers inside a finished tunnel (they know the way)
  HAUL_EVERY: 4,      // seconds between hauling checks per tunnel
  HAUL_MAX: 4,        // haulers on the way at once per tunnel
  LOAD: 5,            // food a hauler carries
  GAP: 0.15,          // fill difference (stock / store size) that starts hauling
  MIN_KEEP: 15,       // the sender keeps at least this much of the food
}, AL.LINK_TUNE || {});

const known = col => !!(col && col.mods && col.mods.nestlink);
const homes = world => world.homes || world.colonies;
const home = (world, hid) => { const h = homes(world)[hid]; return h && !h.gone && h.nest && h.alive !== false ? h : null; };
const ends = (l, hid) => l.a === hid ? l.b : l.b === hid ? l.a : -1;
// the open tunnel between nests a and b (either way round)
function between(world, a, b) { for (const l of world.links || []) if (l.state === 'open' && ((l.a === a && l.b === b) || (l.a === b && l.b === a))) return l; return null; }
// the colony's own hill under (x, y) with a nest
function hillAt(world, col, x, y) {
  let best = null, bd = Infinity;
  for (const h of homes(world)) {
    if (!h || h.gone || h.id !== col || !h.nest) continue;
    const r = (h.moundR || 16) * 2.5 + 40, d = AL.dist2(h.x, h.y, x, y);
    if (d < r * r && d < bd) { bd = d; best = h; }
  }
  return best;
}
function plan(world, col, a, b) {
  const c = world.colonies[col], A0 = home(world, a), B0 = home(world, b);
  if (!known(c)) return { ok: false, why: 'Research nest tunnels first' };
  if (!A0 || !B0 || A0.id !== col || B0.id !== col) return { ok: false, why: 'Pick two of your own nests' };
  if (A0 === B0) return { ok: false, why: 'Pick a different nest for the other end' };
  if ((world.links || []).some(l => l.state !== 'lost' && ((l.a === a && l.b === b) || (l.a === b && l.b === a)))) return { ok: false, why: 'Those nests are already linked' };
  const len = AL.hypot(B0.x - A0.x, B0.y - A0.y);
  if (len > LK.MAX_LEN) return { ok: false, why: 'Too far to dig' };
  const s = A0.stock;
  if (s.sugar < LK.COST.sugar || s.protein < LK.COST.protein) return { ok: false, why: 'Needs ' + LK.COST.sugar + ' sugar and ' + LK.COST.protein + ' protein in the first nest' };
  return { ok: true, A0, B0, len, eta: len / (LK.DIG_SPEED * ((c.sp && c.sp.dig) || 1) * ((c.mods && c.mods.dig) || 1)) };
}
// the 'link' command: start digging from nest a to nest b
function link(world, col, args) {
  const a = args.a | 0, b = args.b | 0, p = plan(world, col, a, b);
  if (!p.ok) return p;
  const A = world.ants;
  p.A0.stock.sugar -= LK.COST.sugar; p.A0.stock.protein -= LK.COST.protein;
  // the crew: workers living in the first nest, the ones inside it first
  const crew = [];
  for (const layer of [L.NEST, L.SURFACE]) for (let i = 0; i < A.high && crew.length < LK.DIGGERS; i++) {
    if (!A.state[i] || A.col[i] !== col || A.layer[i] !== layer || A.caste[i] !== C.WORKER) continue;
    if (layer === L.NEST ? A.nest[i] !== a : A.home[i] !== a) continue;
    if (A.state[i] === ST.N_TRANSIT || A.state[i] === ST.DRAG || A.state[i] === ST.N_RAID) continue;
    crew.push(i);
  }
  for (const i of crew) A.kill(i);
  world.links = world.links || []; world.linkSeq = (world.linkSeq || 0) + 1;
  const l = { id: world.linkSeq, col, a, b, x0: p.A0.x, y0: p.A0.y, x1: p.B0.x, y1: p.B0.y, len: p.len, prog: 0, state: 'dig', crew: crew.length, t0: world.t, haul: 0, flow: 0, hT: 0 };
  world.links.push(l);
  AL.Sim.countPop(world);
  AL.emit(world, 'linkStarted', { col, link: l, eta: p.eta });
  return { ok: true, id: l.id, eta: p.eta, crew: crew.length };
}

// ---- moving through a tunnel -----------------------------------------------------------------------
// ant i (inside nest `from`) goes through the open tunnel to nest `to`: to its door first, then out of sight
// A.tgt = the tunnel, A.task = where it goes (+1000 when it carries a haul and comes back after)
function send(world, i, to) {
  const A = world.ants, from = A.nest[i], l = between(world, from, to);
  if (!l || A.layer[i] !== L.NEST) return false;
  if (AL.Life) AL.Life.goTo(world, i, AL.Nest.F.ENTRANCE, AL.ACT.NONE);
  A.state[i] = ST.N_TRANSIT; A.tgt[i] = l.id; A.task[i] = to; A.timer[i] = l.len / LK.WALK;
  return true;
}
// N_TRANSIT: walking the tunnel; when the time is up it comes out inside the other nest
function transitHandler(world, i, dt) {
  const A = world.ants;
  A.px[i] = A.x[i]; A.py[i] = A.y[i];
  A.timer[i] -= dt;
  if (A.timer[i] > 0) return;
  const back = A.task[i] >= 1000, to = back ? A.task[i] - 1000 : A.task[i], h = home(world, to);
  const l = (world.links || []).find(q => q.id === A.tgt[i]);
  if (!h || !l || l.state !== 'open') {   // the tunnel or the far nest is gone: back out where it went in
    A.state[i] = ST.N_IDLE; A.timer[i] = 1; A.tgt[i] = -1; A.task[i] = 0;
    if (A.carry[i] === K.SUGAR || A.carry[i] === K.PROTEIN) { const o = home(world, A.nest[i]); if (o) o.stock[AL.RES[A.carry[i]]] += A.load[i] || 0; A.carry[i] = 0; A.load[i] = 0; }
    return;
  }
  const nest = h.nest, e = nest.entrance, [x, y] = AL.Nest.centre(nest, e.r * nest.cols + e.c);
  const from = A.nest[i];
  A.nest[i] = to; A.x[i] = A.px[i] = x; A.y[i] = A.py[i] = y; A.tx[i] = x; A.ty[i] = y; A.tgt[i] = -1; A.task[i] = 0;
  if (!back && (A.carry[i] === K.SUGAR || A.carry[i] === K.PROTEIN) && A.load[i] > 0) {
    // a hauler: unload into this nest's store, then walk back home
    h.stock[AL.RES[A.carry[i]]] += A.load[i]; l.flow += A.load[i];
    AL.emit(world, 'linkHaul', { col: h.id, link: l.id, kind: A.carry[i], amt: A.load[i], to: h.hid });
    A.carry[i] = 0; A.load[i] = 0;
    A.state[i] = ST.N_TRANSIT; A.tgt[i] = l.id; A.task[i] = 1000 + from; A.timer[i] = l.len / LK.WALK;
    return;
  }
  if (!back) A.home[i] = to;   // (sent to live there)
  if (back) l.haul = Math.max(0, l.haul - 1);
  A.state[i] = ST.N_IDLE; A.timer[i] = 0.5;
}
// a hauler: a worker from nest `from` takes `amt` of `kind` across to nest `to`
function haul(world, l, from, to, kind, amt) {
  const A = world.ants, src = home(world, from);
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== l.col || A.layer[i] !== L.NEST || A.nest[i] !== from || A.home[i] !== from) continue;
    if (A.caste[i] !== C.WORKER || A.carry[i] || (A.state[i] !== ST.N_IDLE && A.state[i] !== ST.N_WORK)) continue;
    src.stock[AL.RES[kind]] -= amt;
    A.carry[i] = kind; A.load[i] = amt;
    send(world, i, to);
    l.haul++;
    return true;
  }
  return false;
}
// is a store much fuller than the other in this food? (fill = stock / store size)
function balance(world, l) {
  const A0 = home(world, l.a), B0 = home(world, l.b); if (!A0 || !B0) return;
  if (l.haul >= LK.HAUL_MAX) return;
  for (const kind of [K.SUGAR, K.PROTEIN]) {
    const key = AL.RES[kind], fa = A0.stock[key] / Math.max(1, A0.cap ? A0.cap.food : 100), fb = B0.stock[key] / Math.max(1, B0.cap ? B0.cap.food : 100);
    const [from, to, src] = fa > fb ? [l.a, l.b, A0] : [l.b, l.a, B0];
    if (Math.abs(fa - fb) < LK.GAP || src.stock[key] < LK.MIN_KEEP + LK.LOAD) continue;
    if (haul(world, l, from, to, kind, LK.LOAD)) return;   // one a check
  }
}

AL.registerSystem({
  id: 'links', order: 5,
  init(world) { world.nestHandlers = world.nestHandlers || {}; world.nestHandlers[ST.N_TRANSIT] = transitHandler; },
  second(world) {
    const Ls = world.links; if (!Ls || !Ls.length) return;
    for (const l of Ls) {
      if (l.state === 'lost') continue;
      const c = world.colonies[l.col], A0 = home(world, l.a), B0 = home(world, l.b);
      if (!A0 || !B0 || !c || c.alive === false) {   // one end is gone: the tunnel caves in (a crew still digging comes out at the end that is left)
        if (l.state === 'dig') { const h = A0 || B0; if (h) for (let k = 0; k < l.crew; k++) spawnIn(world, h); }
        l.state = 'lost'; AL.emit(world, 'linkLost', { col: l.col, link: l.id });
        continue;
      }
      l.x0 = A0.x; l.y0 = A0.y; l.x1 = B0.x; l.y1 = B0.y;
      if (l.state === 'dig') {
        l.prog += LK.DIG_SPEED * Math.sqrt(Math.max(1, l.crew) / LK.DIGGERS) * ((c.sp && c.sp.dig) || 1) * ((c.mods && c.mods.dig) || 1) / Math.max(1, l.len);
        if (l.prog >= 1) {
          l.prog = 1; l.state = 'open'; l.tOpen = world.t;
          for (let k = 0; k < l.crew; k++) spawnIn(world, B0);   // the diggers come out at the far end and live there
          AL.emit(world, 'linkOpen', { col: l.col, link: l });
        }
        continue;
      }
      l.hT = (l.hT || 0) + 1;
      if (l.hT >= LK.HAUL_EVERY) { l.hT = 0; balance(world, l); }
    }
    if (Ls.length > 16) world.links = Ls.filter(l => l.state !== 'lost');
  },
});
// a worker appears inside nest h (diggers coming out of a tunnel)
function spawnIn(world, h) {
  const A = world.ants, nest = h.nest, e = nest.entrance, [x, y] = AL.Nest.centre(nest, e.r * nest.cols + e.c);
  const i = A.spawn(h.id, C.WORKER, L.NEST, x, y + 4, 0, world.R);
  if (i < 0) return -1;
  A.nest[i] = h.hid; A.home[i] = h.hid;
  if (AL.Life) AL.Life.decide(world, i);
  return i;
}
if (AL.Cmd) AL.Cmd.def('link', link);
AL.Links = { LK, known, between, hillAt, plan, link, send, ends };
if (NODE) module.exports = AL.Links;
})(typeof window !== 'undefined' ? window : globalThis);
