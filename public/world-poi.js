// Antlands World stage: points of interest and the human zone.
// - plan(): a seeded, rotation-fair backyard for 1-8 colonies (pass it as createWorld opts.layout)
// - on the core map (or founding sites) it adds what the core lacks: termite mound, spider lair,
//   shelters, sprinklers, storm-puddle hollows, the picnic blanket and the foot path
// - dynamic POIs: fallen fruit (rots, faster in heat, freezes in winter), dead insects (spawned
//   mirrored for every colony), storm puddles that dry in the sun, aphids (tending, ladybugs,
//   winter dieback, herding to a new plant), the picnic event
// - human zone: footsteps along the path (telegraphed shoe shadows that stomp), a lawnmower pass
//   (warned, mirrored lanes), sprinklers that switch on in heat waves and flood nearby nests
// Replaces AL.Surface.updatePois for worlds that run this system. Sim only: no DOM.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); require('./world-time.js'); }
const K = AL.CARRY, TAU = AL.TAU, PI = Math.PI;
const BUF = new Int32Array(4096), CNT = new Int16Array(8);
const Wd = () => AL.World;

const PT = AL.POI_TUNE = Object.assign({
  STEP_TELE: 1.1,           // seconds a shoe shadow shows before it lands
  WALK_SPEED: 210, STRIDE: 120,
  SHOE_L: 84, SHOE_W: 34,   // shoe sole size (stylized: about 8 ants long)
  // the mower does the whole yard: back-and-forth strips, ~2 min, about every 3 days (in mowing season and hours)
  MOWER_SPEED: 440, MOWER_LEN: 110, MOWER_W: 250, MOWER_WARN: 30,
  MOWER_FIRST: 600, MOWER_EVERY: [720, 840], MOWER_KILL: 0.5,   // share of exposed ants the blades kill
  SPRINKLER_R: 300, SPRINKLER_TIME: 45,
  DEAD_EVERY: [55, 95],
}, AL.POI_TUNE || {});

// people (footsteps, the mower, sprinklers, the picnic) only live in the backyard biome (terrain.js)
const humansHere = world => { const B = AL.BIOMES && AL.BIOMES[world.biomeKey]; return !B || B.humans; };
// ---- frames: each colony's local axes (u toward the map centre, v to its left) -------------------
function frameOf(nx, ny, cx, cy) {
  const dx = cx - nx, dy = cy - ny, d = AL.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  return { x: nx, y: ny, ux, uy, vx: -uy, vy: ux, ang: AL.atan2(uy, ux), d };
}
const toW = (f, a, b) => ({ x: f.x + f.ux * a + f.vx * b, y: f.y + f.uy * a + f.vy * b });

// ---- the fair map ---------------------------------------------------------------------------------
// Rotational symmetry: every colony gets the same sector (nest, shelter rock, log, aphid plant, puddle,
// seeds, clover, a dead beetle, crumbs, a sprinkler) rotated into its own frame. Contested POIs sit on
// the slots between neighbours (apple grove + spider lair, termite mound) and the picnic is dead centre.
function plan(o) {
  o = o || {};
  const W = o.W || AL.Surface.W, H = o.H || AL.Surface.H, n = AL.clamp(o.n || 2, 1, 8) | 0, cx = W / 2, cy = H / 2;
  const R = AL.rng((((o.seed >>> 0) ^ 0x51a7e) >>> 0) || 7);
  const j = s => (R() - 0.5) * s;
  let nests, rad = 0, t0 = 0;
  // map sizes (terrain.js): the nest ring and the two-colony diagonal scale with the yard; each colony's own sector
  // of rocks, plants and food stays the same size
  const k = Math.min(W / 4000, H / 3000), B = (AL.BIOMES && AL.BIOMES[o.biome]) || null, humans = !B || B.humans;
  const sx = x => cx + (x - 2000) * W / 4000, sy = y => cy + (y - 1500) * H / 3000;
  if (n <= 2) nests = n === 1 ? [{ x: sx(760), y: sy(2240) }] : [{ x: sx(760), y: sy(2240) }, { x: sx(3240), y: sy(760) }];
  else {
    rad = (n <= 4 ? 1150 : 1200) * k; t0 = PI / 2 + PI / n; nests = [];
    for (let k = 0; k < n; k++) nests.push({ x: Math.round(cx + AL.cos(t0 + k * TAU / n) * rad), y: Math.round(cy + AL.sin(t0 + k * TAU / n) * rad) });
  }
  const frames = nests.map(p => frameOf(p.x, p.y, cx, cy));
  // sector template (local a along u, b along v), jittered once by the seed and shared by every colony
  const bs = n >= 7 ? 0.82 : n >= 5 ? 0.9 : 1;         // narrow the sector when wedges get thin
  const tpl = {
    shelter: { a: 210 + j(30), b: (-230 + j(30)) * bs, rx: 66 + j(8), ry: 50 + j(6), rot: R() * PI },
    rocks: [{ a: -150 + j(20), b: (-90 + j(20)) * bs, rx: 30, ry: 24, rot: R() * PI }, { a: 500 + j(30), b: (240 + j(20)) * bs, rx: 36, ry: 28, rot: R() * PI }],
    log: { a: -60, b: (-300 + j(20)) * bs, len: 270, r: 30, rot: 0.35 + j(0.3) },
    aphids: { a: 300 + j(30), b: (210 + j(20)) * bs },
    puddle: { a: 420 + j(30), b: (-40 + j(30)) * bs, r: 56 },
    seeds: { a: -140, b: 260 * bs },
    clover: { a: 110 + j(20), b: (300 + j(10)) * bs },
    beetle: { a: 540 + j(30), b: (-210 + j(30)) * bs, ang: R() * TAU },
    sprinkler: { a: 230, b: 60 * bs },
    storm: [{ a: 380, b: -270 * bs }, { a: -20, b: 200 * bs }],
    crumbs: [], flowers: [],
  };
  // the biome's mix (terrain.js AL.BIOMES): more puddles in the wetland, seed instead of plants in the desert,
  // trees and logs on the forest floor. Every sector gets the same, so it stays fair.
  tpl.extra = [];
  if (B) {
    const add = (type, a, b, extra) => tpl.extra.push(Object.assign({ type, a, b: b * bs }, extra || {}));
    if (B.puddles >= 2) { add('puddle', 160 + j(20), -330 + j(20), { r: 46 }); add('puddle', 560 + j(20), 90 + j(20), { r: 40 }); }
    if (B.clover > 1) add('clover', 360 + j(20), 330 + j(20));
    if (B.seeds >= 2) { add('seeds', 260 + j(20), -120 + j(20)); add('seeds', 470 + j(20), 300 + j(20)); }
    if (B.trees) for (let q = 0; q < B.trees; q++) add('tree', 260 + q * 170 + j(40), (q % 2 ? 1 : -1) * (300 + j(60)), { r: 170 + j(40) });
    if (B.logs) for (let q = 0; q < B.logs; q++) add('log', 380 + q * 160 + j(30), (q % 2 ? -1 : 1) * (170 + j(40)), { len: 180 + j(40), rot: R() * PI });
  }
  const taken = [[0, 0, 150], [tpl.shelter.a, tpl.shelter.b, 120], [tpl.aphids.a, tpl.aphids.b, 80], [tpl.puddle.a, tpl.puddle.b, 90], [tpl.seeds.a, tpl.seeds.b, 50],
    [tpl.clover.a, tpl.clover.b, 80], [tpl.beetle.a, tpl.beetle.b, 50], [tpl.rocks[0].a, tpl.rocks[0].b, 50], [tpl.rocks[1].a, tpl.rocks[1].b, 56], [-60, tpl.log.b, 150],
    [tpl.storm[0].a, tpl.storm[0].b, 70], [tpl.storm[1].a, tpl.storm[1].b, 70], [tpl.sprinkler.a, tpl.sprinkler.b, 30]];
  const free = (a, b, m) => taken.every(t => (t[0] - a) * (t[0] - a) + (t[1] - b) * (t[1] - b) > (t[2] + m) * (t[2] + m));
  for (let k = 0, g = 0; k < 6 && g < 300; g++) {
    const a = 80 + R() * 480, b = (R() - 0.5) * 560 * bs;
    if (!free(a, b, 20)) continue;
    taken.push([a, b, 30]); tpl.crumbs.push({ a, b, prot: k % 2 === 0, amt: 7 + ((R() * 6) | 0), ang: R() * TAU }); k++;
  }
  for (let k = 0, g = 0; k < 10 && g < 300; g++) {
    const a = -120 + R() * 640, b = (R() - 0.5) * 600 * bs;
    if (!free(a, b, 0)) continue;
    tpl.flowers.push({ a, b, kind: R() < 0.55 ? 'clover' : (R() < 0.6 ? 'daisy' : 'dandelion'), s: 0.7 + R() * 0.6, rot: R() * TAU }); k++;
  }
  const L = { fair: true, n, W, H, nests, frames, center: { x: cx, y: cy }, rocks: [], logs: [], trees: [], stones: [], flowers: [], pois: [],
    lairs: [], beetleHomes: [], termites: [], sprinklers: [], stormSpots: [], appleTrees: [], slots: [], path: [] };
  L.patio = !humans ? null : n <= 2 ? { x: W - 520, y: H - 580, w: 520, h: 580 } : { x: W - 300, y: H - 340, w: 300, h: 340 };
  L.biome = B ? B.key : 'backyard';
  frames.forEach((f, ci) => {
    const P = (it) => toW(f, it.a, it.b);
    const sh = P(tpl.shelter); L.rocks.push({ x: sh.x, y: sh.y, rx: tpl.shelter.rx, ry: tpl.shelter.ry, rot: tpl.shelter.rot + f.ang, shelter: true, seed: 11 + ci });
    for (const r of tpl.rocks) { const p = P(r); L.rocks.push({ x: p.x, y: p.y, rx: r.rx, ry: r.ry, rot: r.rot + f.ang, seed: 31 + ci }); }
    const lg = P(tpl.log); L.logs.push({ x: lg.x, y: lg.y, len: tpl.log.len, r: tpl.log.r, rot: tpl.log.rot + f.ang, seed: 51 + ci });
    L.beetleHomes.push(toW(f, -60 + 0, tpl.log.b + tpl.log.r + 18));
    const ap = P(tpl.aphids); if (!(B && B.noAphids)) L.pois.push({ type: 'aphids', x: ap.x, y: ap.y, col: ci });
    const pd = P(tpl.puddle); L.pois.push({ type: 'puddle', x: pd.x, y: pd.y, r: B && B.puddles < 1 ? 36 : tpl.puddle.r, col: ci });
    const sd = P(tpl.seeds); L.pois.push({ type: 'seeds', x: sd.x, y: sd.y, col: ci });
    const cl = P(tpl.clover); if (!(B && B.noClover)) L.pois.push({ type: 'clover', x: cl.x, y: cl.y, col: ci });
    for (const e of tpl.extra) {
      const p = P(e);
      if (e.type === 'tree') L.trees.push({ x: p.x, y: p.y, r: e.r, kind: 'maple' });
      else if (e.type === 'log') { L.logs.push({ x: p.x, y: p.y, len: e.len, r: 24, rot: e.rot + f.ang, seed: 61 + ci }); L.beetleHomes.push({ x: p.x + AL.cos(e.rot + f.ang + PI / 2) * 40, y: p.y + AL.sin(e.rot + f.ang + PI / 2) * 40 }); }
      else L.pois.push(Object.assign({ type: e.type, x: p.x, y: p.y, col: ci }, e.r ? { r: e.r } : {}));
    }
    const bt = P(tpl.beetle); L.pois.push({ type: 'beetle', x: bt.x, y: bt.y, a: tpl.beetle.ang + f.ang, col: ci });
    for (const c of tpl.crumbs) { const p = P(c); L.pois.push({ type: 'crumb', x: p.x, y: p.y, prot: c.prot, amount: c.amt, a: c.ang + f.ang, col: ci }); }
    for (const fl of tpl.flowers) { const p = P(fl); L.flowers.push({ x: p.x, y: p.y, kind: fl.kind, s: fl.s, rot: fl.rot + f.ang }); }
    const sp = P(tpl.sprinkler); if (humans) L.sprinklers.push({ x: sp.x, y: sp.y, r: PT.SPRINKLER_R, col: ci });
    for (const s of tpl.storm) { const p = P(s); L.stormSpots.push({ x: p.x, y: p.y, col: ci }); }
  });
  // contested slots between neighbours
  const slotPos = [];
  if (n === 2) { const f = frames[0]; slotPos.push({ x: cx + f.vx * 1000, y: cy + f.vy * 1000 }, { x: cx - f.vx * 1000, y: cy - f.vy * 1000 }); }
  else if (n >= 3) for (let k = 0; k < n; k++) { const t = t0 + (k + 0.5) * TAU / n; slotPos.push({ x: cx + AL.cos(t) * rad * 0.86, y: cy + AL.sin(t) * rad * 0.86 }); }
  slotPos.forEach((s, k) => {
    const kind = n === 2 ? (k === 0 ? 'grove' : 'mound') : (n % 2 === 0 ? (k % 2 === 0 ? 'grove' : 'mound') : 'mound');
    const f = frameOf(s.x, s.y, cx, cy), P = (a, b) => toW(f, a, b);
    L.slots.push({ x: s.x, y: s.y, kind });
    if (kind === 'grove') {
      const tr = { x: s.x, y: s.y, r: n <= 4 ? 280 : 210, kind: 'apple' };
      L.trees.push(tr); L.appleTrees.push(tr);
      for (const [a, b] of [[60, -90], [-50, 110]]) { const p = P(a, b); L.pois.push({ type: 'fruit', x: p.x, y: p.y }); }
      const lr = P(-70, -10); L.rocks.push({ x: lr.x, y: lr.y, rx: 44, ry: 34, rot: f.ang, shelter: true, seed: 71 + k });
      const lp = P(-70 + 62, -10); L.lairs.push({ x: lp.x, y: lp.y });
    } else {
      L.termites.push({ x: s.x, y: s.y });
      const lg = P(-150, 40); L.logs.push({ x: lg.x, y: lg.y, len: 200, r: 26, rot: f.ang + PI / 2, seed: 91 + k });
      L.beetleHomes.push(P(-150 + 44, 40));
      if (n % 2 === 1) { const lr = P(110, 120); L.rocks.push({ x: lr.x, y: lr.y, rx: 40, ry: 32, rot: f.ang, shelter: true, seed: 81 + k }); L.lairs.push(P(110 - 56, 120)); }
    }
  });
  // centre: the picnic blanket with the big spill on it (other biomes: their own prize, terrain.js centre)
  L.blanket = humans ? { x: cx, y: cy, w: 230, h: 160, rot: n === 2 ? frames[0].ang + PI / 2 : 0 } : null;
  L.pois.push({ type: 'spill', x: cx, y: cy, centre: B ? B.centre : 'spill' });
  if (!humans) return L;
  // stepping-stone path from the patio to the blanket (the people walk it)
  const p0 = { x: L.patio.x + 60, y: L.patio.y + 70 }, p1 = { x: cx + 120, y: cy + 90 };
  for (let k = 0; k <= 12; k++) {
    const t = k / 12, x = AL.lerp(p0.x, p1.x, t) + AL.sin(t * PI * 2) * 90, y = AL.lerp(p0.y, p1.y, t) + AL.cos(t * PI * 1.5) * 50;
    L.path.push({ x, y });
    L.stones.push({ x, y, rx: 42 + j(12), ry: 32 + j(8), rot: R() * PI, seed: R() * 1000 });
  }
  return L;
}

// ---- building foods for a POI ----------------------------------------------------------------------
function makePoi(S, R, q) {
  const add = AL.Surface.addFood, poi = p => { S.pois.push(p); return p; };
  switch (q.type) {
    case 'fruit': { const p = poi({ type: 'fruit', x: q.x, y: q.y, r: 26, rot: 0, seed: R() * 100 }); p.src = add(S, { kind: K.SUGAR, x: q.x, y: q.y, r: 26, amount: 260, poi: p, visual: 'fruit' }); return p; }
    case 'beetle': { const p = poi({ type: 'beetle', x: q.x, y: q.y, r: 18, a: q.a || 0 }); p.src = add(S, { kind: K.PROTEIN, x: q.x, y: q.y, r: 18, amount: 40, big: true, needed: 5, poi: p, visual: 'beetle', a: q.a || 0 }); return p; }
    case 'spill': {
      const p = poi({ type: 'spill', x: q.x, y: q.y, r: 70, centre: q.centre || 'spill' });
      // the big prize in the middle of the map: a picnic spill in the backyard, something else elsewhere
      if (p.centre === 'nest') { p.label = 'Fallen bird\'s nest'; p.srcs = [add(S, { kind: K.PROTEIN, x: q.x - 30, y: q.y - 8, r: 26, amount: 300, poi: p, visual: 'larvae' }), add(S, { kind: K.SUGAR, x: q.x + 40, y: q.y + 20, r: 24, amount: 220, poi: p, visual: 'fruit', rot: 0 })]; }
      else if (p.centre === 'cactus') { p.label = 'Cactus fruit'; p.srcs = [add(S, { kind: K.SUGAR, x: q.x - 30, y: q.y - 10, r: 28, amount: 460, poi: p, visual: 'fruit', rot: 0 }), add(S, { kind: K.WATER, x: q.x + 42, y: q.y + 18, r: 22, amount: 220, max: 220, regen: 0.15, poi: { type: 'puddle', x: q.x + 42, y: q.y + 18, r: 18, baseR: 18, seed: 7 }, visual: 'water' })]; }   // (its own little pool: the water code sizes it by its poi)
      else if (p.centre === 'frog') { p.label = 'Dead frog'; p.srcs = [add(S, { kind: K.PROTEIN, x: q.x - 20, y: q.y, r: 30, amount: 380, poi: p, visual: 'ham' }), add(S, { kind: K.SUGAR, x: q.x + 46, y: q.y + 24, r: 18, amount: 160, poi: { type: 'aphids', x: q.x + 46, y: q.y + 24, r: 30, aphids: 12, maxAphids: 16, seed: 5 }, visual: 'honeydew' })]; }   // (its own aphid plant)
      else { p.label = 'Picnic spill'; p.srcs = [add(S, { kind: K.SUGAR, x: q.x - 38, y: q.y - 12, r: 30, amount: 420, poi: p, visual: 'cookie' }), add(S, { kind: K.PROTEIN, x: q.x + 44, y: q.y + 22, r: 18, amount: 110, poi: p, visual: 'ham' })]; }
      return p;
    }
    case 'aphids': { const p = poi({ type: 'aphids', x: q.x, y: q.y, r: 54, aphids: 26, maxAphids: 30, seed: R() * 100 }); p.src = add(S, { kind: K.SUGAR, x: q.x, y: q.y, r: 30, amount: 30, max: 120, regen: 0, poi: p, visual: 'honeydew' }); return p; }
    case 'puddle': { const r = q.r || 56, p = poi({ type: 'puddle', x: q.x, y: q.y, r, baseR: r, seed: R() * 100 }); p.src = add(S, { kind: K.WATER, x: q.x, y: q.y, r: r + 4, amount: 400, max: 400, regen: 0.4, poi: p, visual: 'water' }); return p; }
    case 'seeds': { const p = poi({ type: 'seeds', x: q.x, y: q.y, r: 28 }); p.src = add(S, { kind: K.SEED, x: q.x, y: q.y, r: 26, amount: 90, poi: p, visual: 'seeds' }); return p; }
    case 'clover': { const p = poi({ type: 'clover', x: q.x, y: q.y, r: 60, seed: R() * 100 }); p.src = add(S, { kind: K.LEAF, x: q.x, y: q.y, r: 50, amount: 300, max: 300, regen: 0.3, poi: p, visual: 'leaves' }); return p; }
    case 'crumb': return add(S, { kind: q.prot ? K.PROTEIN : K.SUGAR, x: q.x, y: q.y, r: 7, amount: q.amount || 8, visual: q.prot ? 'bug' : 'crumb', a: q.a || 0 });
  }
  return null;
}

// ---- apply a planned layout to a freshly generated surface -------------------------------------------
function apply(world, L) {
  const S = world.surface, R = world.R;
  S.rocks = []; S.logs = []; S.trees = []; S.stones = []; S.flowers = []; S.pois = []; S.foods = []; S.byId.clear();
  S.blocked.fill(0); S.shelter.fill(0); S.foodDirty = true;
  S.patio = L.patio ? Object.assign({}, L.patio) : null;
  for (const r of L.rocks) {
    const rr = Object.assign({ seed: R() * 1000 }, r); S.rocks.push(rr);
    AL.Surface.stampEllipse(S, S.blocked, rr.x, rr.y, rr.rx, rr.ry, rr.rot, 1);
    if (rr.shelter) AL.Surface.stampEllipse(S, S.shelter, rr.x, rr.y, rr.rx + 70, rr.ry + 60, rr.rot, 1);
  }
  for (const l of L.logs) { const ll = Object.assign({ seed: R() * 1000 }, l); S.logs.push(ll); AL.Surface.stampEllipse(S, S.blocked, ll.x, ll.y, ll.len / 2, ll.r, ll.rot, 1); }
  for (const t of L.trees) S.trees.push(Object.assign({}, t));
  for (const s of L.stones) S.stones.push(Object.assign({}, s));
  for (const f of L.flowers) if (!AL.Surface.isBlocked(S, f.x, f.y)) { const fl = Object.assign({}, f); delete fl.nectar; S.flowers.push(fl); AL.Surface.addNectar(S, fl); }
  for (const q of L.pois) makePoi(S, R, q);
  for (const n of S.nestSites) AL.Surface.stampEllipse(S, S.blocked, n.x, n.y, 70, 70, 0, 0);
  AL.Surface.rebuildFoodGrid(S);
}

// ---- adding the world POIs to the core map (or a founding layout) -------------------------------------
function okSpot(S, x, y, r, keep) {
  if (x < 150 || y < 150 || x > S.W - 150 || y > S.H - 150) return false;
  for (let a = 0; a < 6; a++) if (AL.Surface.isBlocked(S, x + AL.cos(a) * r, y + AL.sin(a) * r)) return false;
  if (AL.Surface.isBlocked(S, x, y)) return false;
  for (const f of S.foods) if (!f.gone && f.visual !== 'nectar' && AL.dist2(f.x, f.y, x, y) < keep * keep) return false;   // flowers don't count
  for (const n of S.nestSites) if (AL.dist2(n.x, n.y, x, y) < 300 * 300) return false;
  if (S.patio && x > S.patio.x - 60 && y > S.patio.y - 60) return false;
  return true;
}
function nudge(S, x, y) {
  if (!AL.Surface.isBlocked(S, x, y)) return { x, y };
  for (let r = 16; r < 200; r += 16) for (let a = 0; a < 8; a++) { const px = x + AL.cos(a * PI / 4) * r, py = y + AL.sin(a * PI / 4) * r; if (!AL.Surface.isBlocked(S, px, py)) return { x: px, y: py }; }
  return { x, y };
}
function augment(world) {
  const S = world.surface, cx = S.W / 2, cy = S.H / 2, out = { lairs: [], beetleHomes: [], termites: [], sprinklers: [], stormSpots: [], appleTrees: [], path: [] };
  const frames = S.nestSites.map(n => frameOf(n.x, n.y, cx, cy));
  out.frames = frames;
  // spider lair beside each shelter rock, beetles under the logs
  for (const r of S.rocks) if (r.shelter) out.lairs.push(nudge(S, r.x + AL.cos(0.6) * (r.rx + 16), r.y + AL.sin(0.6) * (r.ry + 16)));
  for (const l of S.logs) out.beetleHomes.push(nudge(S, l.x - AL.sin(l.rot) * (l.r + 16), l.y + AL.cos(l.rot) * (l.r + 16)));
  // termite mound: on the line of points equally far from the player and the first rival (2 colonies);
  // with more colonies, the open spot whose distances to all the nests are the most even
  if (S.nestSites.length >= 3) {
    const ns = S.nestSites;
    let spot = null, bv = 1e18;
    for (let y = 250; y < S.H - 200; y += 50) for (let x = 250; x < S.W - 200; x += 50) {
      let lo = 1e9, hi = 0; for (const n of ns) { const d = AL.hypot(n.x - x, n.y - y); if (d < lo) lo = d; if (d > hi) hi = d; }
      if (lo < 500) continue;
      const v = hi - lo + AL.hypot(x - cx, y - cy) * 0.05;   // ties go to the middle
      if (v < bv && okSpot(S, x, y, 50, 250)) { bv = v; spot = { x, y }; }
    }
    if (spot) out.termites.push(spot);
  } else if (S.nestSites.length >= 2) {
    const a = S.nestSites[0], b = S.nestSites[1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let px = -(b.y - a.y), py = b.x - a.x; const pl = AL.hypot(px, py) || 1; px /= pl; py /= pl;
    const pc = S.patio ? { x: S.patio.x + S.patio.w / 2, y: S.patio.y + S.patio.h / 2 } : { x: S.W, y: S.H };
    if (AL.dist2(mx + px * 900, my + py * 900, pc.x, pc.y) < AL.dist2(mx - px * 900, my - py * 900, pc.x, pc.y)) { px = -px; py = -py; }
    let spot = null;
    for (const side of [1, -1]) { for (const d of [900, 1000, 800, 1100, 700, 1200, 600]) { const x = mx + px * d * side, y = my + py * d * side; if (okSpot(S, x, y, 50, 250)) { spot = { x, y }; break; } } if (spot) break; }
    if (spot) out.termites.push(spot);
  }
  frames.forEach((f, ci) => {
    const sp = nudge(S, toW(f, 230, 60).x, toW(f, 230, 60).y); out.sprinklers.push({ x: sp.x, y: sp.y, r: PT.SPRINKLER_R, col: ci });
    for (const [a, b] of [[380, -270], [-20, 200]]) { const p = nudge(S, toW(f, a, b).x, toW(f, a, b).y); out.stormSpots.push({ x: p.x, y: p.y, col: ci }); }
  });
  for (const t of S.trees) if (t.kind === 'apple') out.appleTrees.push(t);
  for (const s of S.stones) out.path.push({ x: s.x, y: s.y });
  const spill = S.pois.find(p => p.type === 'spill');
  out.center = spill ? { x: spill.x, y: spill.y } : { x: cx, y: cy };
  out.blanket = { x: out.center.x, y: out.center.y + 6, w: 210, h: 150, rot: -0.25 };
  return out;
}

// ---- dynamic POIs ------------------------------------------------------------------------------------
function spawnMirrored(world, kind) {
  const P = world.poi, S = world.surface, R = world.R;
  let live = 0; for (const f of P.spawned) if (!f.gone) live++;
  if (live > P.frames.length * 3) return 0;
  P.spawned = P.spawned.filter(f => !f.gone);
  for (let t = 0; t < 8; t++) {
    const a = 120 + R() * 560, b = (R() - 0.5) * 680, ang = R() * TAU;
    const pts = P.frames.map(f => toW(f, a, b));
    if (!pts.every(p => p.x > 60 && p.y > 60 && p.x < S.W - 60 && p.y < S.H - 60 && !AL.Surface.isBlocked(S, p.x, p.y) && S.nestSites.every(n => AL.dist2(n.x, n.y, p.x, p.y) > 140 * 140))) continue;
    pts.forEach((p, k) => {
      const a2 = ang + P.frames[k].ang;
      const f = kind === 'moth'
        ? AL.Surface.addFood(S, { kind: K.PROTEIN, x: p.x, y: p.y, r: 10, amount: 22, max: 22, big: true, needed: 3, visual: 'moth', a: a2, carcass: true, decay: 300 })
        : AL.Surface.addFood(S, { kind: K.PROTEIN, x: p.x, y: p.y, r: 7, amount: 8, visual: 'bug', a: a2 });
      P.spawned.push(f);
    });
    AL.emit(world, 'deadInsect', { kind, n: pts.length });
    return pts.length;
  }
  return 0;
}
function addTempPuddle(world, x, y, maxR) {
  const S = world.surface, p = { type: 'puddle', temp: true, x, y, r: 6, baseR: (maxR || 46) / 1.7, maxR: maxR || 46, seed: world.R() * 100 };
  S.pois.push(p);
  p.src = AL.Surface.addFood(S, { kind: K.WATER, x, y, r: 10, amount: 20, max: 160, regen: 0, poi: p, visual: 'water' });
  return p;
}
// aphids arriving with a herd settle here (merging with a colony already on the plant)
function settleAphids(world, x, y, n, col) {
  const S = world.surface;
  for (const p of S.pois) if (p.type === 'aphids' && !p.gone && AL.dist2(p.x, p.y, x, y) < 70 * 70) { p.aphids = Math.min(p.maxAphids, p.aphids + n); return p; }
  const p = { type: 'aphids', x, y, r: 44, aphids: n, maxAphids: 30, seed: world.R() * 100, owner: col, herded: true };
  S.pois.push(p);
  p.src = AL.Surface.addFood(S, { kind: K.SUGAR, x, y, r: 26, amount: 0, max: 120, regen: 0, poi: p, visual: 'honeydew' });
  return p;
}
// herd aphids from a plant to (x,y): the colony's nearby ants escort them; returns the herd creature
function herd(world, from, col, x, y, n) {
  if (!from || from.type !== 'aphids' || !AL.WorldCreatures) return null;
  n = Math.min(n || 10, Math.floor(from.aphids) - 2);
  if (n < 2 || !world.creatures) return null;
  const a = AL.atan2(y - from.y, x - from.x);
  const cr = AL.WorldCreatures.spawn(world, 'herd', from.x + AL.cos(a) * (from.r * 0.6), from.y + AL.sin(a) * (from.r * 0.6), { state: 'walk', tx: x, ty: y, col, count: n, prey: false, a, recruitR: from.r + 40 });
  if (cr) { from.aphids -= n; AL.emit(world, 'aphidsHerded', { col, n, x, y }); }
  return cr;
}
function aphidsNear(world, x, y, r) {
  let best = null, bd = (r || 120) * (r || 120);
  for (const p of world.surface.pois) if (p.type === 'aphids' && !p.gone) { const d = AL.dist2(p.x, p.y, x, y); if (d < bd) { bd = d; best = p; } }
  return best;
}

// ---- updatePois (replaces the core one for worlds running this system) -------------------------------------
function updatePois(world, dt) {
  const S = world.surface, e = world.env, W = world.weather || {}, rain = W.rain || 0, heat = e.heat || 0;
  let dropPoi = false;
  for (const f of S.foods) {
    if (f.gone) continue;
    switch (f.visual) {
      case 'fruit':
        if (!e.winter) f.rot = Math.min(1, (f.rot || 0) + dt / 520 * (1 + 1.6 * heat + 0.6 * (e.wet || 0)));   // heat and damp speed rot, frost stops it
        f.quality = 1 - f.rot * 0.6;
        if (f.rot >= 1 && f.amount > 0) f.amount -= dt * 0.3;
        break;
      case 'honeydew': {
        const p = f.poi; if (!p) break;
        if (!e.winter) {
          f.amount = Math.min(f.max, f.amount + p.aphids * AL.TUNE.HONEYDEW_RATE * dt * (1 + 0.08 * Math.min(6, p.tended || 0)));   // tended aphids give more
          if (!p.ladybug && p.aphids < p.maxAphids) p.aphids = Math.min(p.maxAphids, p.aphids + dt * AL.TUNE.APHID_REGROW);
        }
        break;
      }
      case 'nectar': AL.Surface.tickNectar(world, f, dt); break;
      case 'water': {
        const p = f.poi; if (!p) break;
        const maxR = p.maxR || p.baseR * 1.7;
        if (rain > 0 || p.spray) { const g = Math.max(rain, p.spray ? 0.8 : 0); p.r = Math.min(maxR, p.r + dt * g * 0.9); f.amount = Math.min(f.max, f.amount + dt * 4 * g); }
        else if (heat > 0.05) p.r = Math.max(p.temp ? 0 : p.baseR * 0.45, p.r - dt * (0.04 + heat * 0.32 + (p.temp ? 0.1 : 0)));
        else if (p.r > p.baseR || p.temp) p.r = Math.max(p.temp ? 0 : p.baseR, p.r - dt * (p.temp ? 0.12 : 0.05));
        p.spray = false;
        p.frozen = (e.frost || 0) > 0.6;
        const cap = f.max * Math.min(1, (p.r / p.baseR) * (p.r / p.baseR));
        if (f.amount > cap) f.amount = cap;
        f.r = p.r + 4;
        if (Math.abs(f.r - (p.gridR || 0)) > 6) { p.gridR = f.r; S.foodDirty = true; }
        if (p.temp && p.r < 6) { f.gone = true; p.gone = true; S.foodDirty = true; dropPoi = true; }
        break;
      }
    }
    if (f.regen && f.visual !== 'water') f.amount = Math.min(f.max, f.amount + f.regen * dt);
    if (f.corpse || f.carcass) { if (f.decay != null) { f.decay -= dt; if (f.decay <= 0) f.amount = 0; } }
    if (f.amount < 1 && !f.regen && !AL.Surface.renews(f)) { f.gone = true; S.foodDirty = true; }
  }
  if (dropPoi) S.pois = S.pois.filter(p => !p.gone);
}
const coreUpdatePois = AL.Surface.updatePois;
AL.Surface.updatePois = function (world, dt) { return world.poi ? updatePois(world, dt) : coreUpdatePois(world, dt); };

// ---- human zone --------------------------------------------------------------------------------------
function pathInfo(path) {
  const cum = [0];
  for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + AL.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y));
  return cum;
}
function pointAt(P, s) {
  const path = P.path, cum = P.pathCum;
  if (path.length < 2) return { x: path[0] ? path[0].x : 0, y: path[0] ? path[0].y : 0, a: 0 };
  s = AL.clamp(s, 0, cum[cum.length - 1]);
  let k = 1; while (k < cum.length - 1 && cum[k] < s) k++;
  const a = path[k - 1], b = path[k], t = (s - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
  return { x: AL.lerp(a.x, b.x, t), y: AL.lerp(a.y, b.y, t), a: AL.atan2(b.y - a.y, b.x - a.x) };
}
function startWalk(world, dir) {
  const F = world.poi.human.foot, P = world.poi;
  if (P.path.length < 2) return false;
  F.walking = true; F.dir = dir || (world.R() < 0.5 ? 1 : -1); F.s = F.dir > 0 ? 0 : P.pathCum[P.pathCum.length - 1]; F.acc = PT.STRIDE; F.side = 1;
  AL.emit(world, 'footsteps', { on: true });
  return true;
}
// is (x,y) under a shoe sole centred at st (forefoot ahead, heel behind)?
function inSole(st, x, y) {
  const dx = x - st.x, dy = y - st.y, c = AL.cos(st.a), s = AL.sin(st.a);
  const lx = dx * c + dy * s, ly = -dx * s + dy * c, L = PT.SHOE_L, Wd2 = PT.SHOE_W / 2;
  const fx = (lx - L * 0.17) / (L * 0.33), fy = ly / Wd2, hx = (lx + L * 0.31) / (L * 0.2), hy = ly / (Wd2 * 0.85);
  return fx * fx + fy * fy <= 1 || hx * hx + hy * hy <= 1;
}
function stomp(world, st) {
  const A = world.ants, n = Wd().antsIn(world, st.x, st.y, PT.SHOE_L * 0.55, BUF);
  let kills = 0;
  for (let k = 0; k < n; k++) {
    const i = BUF[k];
    if (A.caste[i] === AL.CASTE.QUEEN || Wd().shadeAt(world, A.x[i], A.y[i]) === 2 || !inSole(st, A.x[i], A.y[i])) continue;
    Wd().killAnt(world, i, 'crushed'); kills++;
  }
  st.kills = kills;
  AL.emit(world, 'stomp', { x: st.x, y: st.y, kills });
}
function tickHuman(world, dt) {
  const P = world.poi, H = P.human, F = H.foot, M = H.mower, S = world.surface;
  // footsteps
  if (F.walking) {
    F.s += F.dir * PT.WALK_SPEED * dt; F.acc += PT.WALK_SPEED * dt;
    if (F.acc >= PT.STRIDE) {
      F.acc -= PT.STRIDE; F.side = -F.side;
      const p = pointAt(P, F.s), a = p.a + (F.dir < 0 ? PI : 0);
      H.steps.push({ x: p.x - AL.sin(a) * 22 * F.side, y: p.y + AL.cos(a) * 22 * F.side, a, side: F.side, t: 0, stomped: false, kills: 0 });
    }
    const end = P.pathCum[P.pathCum.length - 1];
    if (F.s >= end || F.s <= 0) { F.walking = false; F.next = 45 + world.R() * 50; AL.emit(world, 'footsteps', { on: false }); if (F.back) { F.back = false; F.next = 30; F.nextDir = -1; } }
  }
  for (let k = H.steps.length - 1; k >= 0; k--) {
    const st = H.steps[k]; st.t += dt;
    if (!st.stomped && st.t >= PT.STEP_TELE) { st.stomped = true; stomp(world, st); }
    if (st.t > PT.STEP_TELE + 14) H.steps.splice(k, 1);
  }
  // the lawnmower: strip after strip until the whole yard is done
  if (M.state === 'warn') { M.t -= dt; if (M.t <= 0) { M.state = 'mow'; M.x = M.dir > 0 ? -PT.MOWER_LEN : S.W + PT.MOWER_LEN; M.hit = new Uint8Array(world.colonies.length); AL.emit(world, 'mower', { phase: 'start', y: M.y }); } }
  else if (M.state === 'mow') {
    // the blades' front edge sweeps (lo, hi] this tick; each ant it crosses gets one roll
    const half = PT.MOWER_LEN / 2, f0 = M.x + M.dir * half;
    M.x += M.dir * PT.MOWER_SPEED * dt;
    const f1 = M.x + M.dir * half, lo = Math.min(f0, f1), hi = Math.max(f0, f1), hw = PT.MOWER_W / 2;
    const A = world.ants, n = Wd().antsIn(world, (lo + hi) / 2, M.y, AL.hypot((hi - lo) / 2, hw) + 4, BUF);
    for (let k = 0; k < n; k++) {
      const i = BUF[k];
      if (A.x[i] <= lo || A.x[i] > hi || Math.abs(A.y[i] - M.y) > hw) continue;
      if (A.caste[i] === AL.CASTE.QUEEN || Wd().shadeAt(world, A.x[i], A.y[i]) === 2) continue;
      if (world.R() < PT.MOWER_KILL) Wd().killAnt(world, i, 'crushed');
    }
    // mounds get flattened a bit (once per mow)
    world.colonies.forEach((c, k) => {
      if (M.hit[k] || Math.abs(c.y - M.y) > hw + c.moundR * 0.4 || c.x <= lo || c.x > hi) return;
      M.hit[k] = 1; c.moundSoil = Math.max(20, c.moundSoil * 0.8); if (AL.Colony.updateMound) AL.Colony.updateMound(c);
      AL.emit(world, 'mowerHit', { col: k });
    });
    for (const f of S.foods) if (f.visual === 'leaves' && !f.mowed && Math.abs(f.y - M.y) < hw && f.x > lo && f.x <= hi) { f.mowed = true; f.amount *= 0.5; }
    if ((M.dir > 0 && M.x > S.W + half) || (M.dir < 0 && M.x < -half)) {
      M.stripes.push({ y: M.y, age: 0 }); M.lane++;
      if (M.lane >= M.lanes) {
        M.state = 'off'; M.next = PT.MOWER_EVERY[0] + world.R() * (PT.MOWER_EVERY[1] - PT.MOWER_EVERY[0]);
        for (const f of S.foods) f.mowed = false;
        AL.emit(world, 'mower', { phase: 'end', y: M.y });
      } else {
        // turn round at the edge and take the next strip
        M.y = M.y0 + M.lane * M.ystep; M.dir = -M.dir;
        AL.emit(world, 'mower', { phase: 'lane', y: M.y, lane: M.lane, lanes: M.lanes });
      }
    }
  }
  for (const s of P.sprinklers) s.ang = (s.ang || 0) + dt * (H.sprink.on ? 1.7 : 0);
}
function startMower(world) {
  const M = world.poi.human.mower, S = world.surface;
  if (M.state !== 'off') return false;
  // strips across the whole yard, starting at the top or the bottom edge
  const down = world.R() < 0.5;
  M.lanes = Math.ceil(S.H / PT.MOWER_W); M.lane = 0;
  M.ystep = down ? PT.MOWER_W : -PT.MOWER_W; M.y0 = down ? PT.MOWER_W / 2 : S.H - PT.MOWER_W / 2;
  M.y = M.y0; M.dir = world.R() < 0.5 ? 1 : -1;
  M.state = 'warn'; M.t = PT.MOWER_WARN;
  AL.emit(world, 'mower', { phase: 'warn', y: M.y, dir: M.dir, in: M.t, whole: true });
  return true;
}

// ---- mower alarm: every ant of a colony on the surface runs home and the nest keeps them in ---------
// The player sounds it by hand. Sounded while the mower is coming or mowing, it clears itself once the
// mower is done; otherwise it lasts until it is sounded off. Rival colonies sound theirs when warned.
const RECALL_STATES = [AL.ST.WANDER, AL.ST.RECRUIT, AL.ST.COLLECT, AL.ST.RALLY, AL.ST.FIGHT, AL.ST.DUMP, AL.ST.GUARD, AL.ST.RAID];
function recallSweep(world, ci) {
  const A = world.ants, ST = AL.ST;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== 0 || A.col[i] !== ci || A.caste[i] === AL.CASTE.QUEEN) continue;
    const st = A.state[i];
    if (st === ST.DRAG) { if (AL.Behavior && AL.Behavior.releaseDrag) AL.Behavior.releaseDrag(world, i); A.state[i] = ST.HOMING; A.timer[i] = 0; }
    else if (RECALL_STATES.indexOf(st) >= 0) { A.state[i] = ST.HOMING; A.timer[i] = 0; A.tgt[i] = -1; }
  }
}
function setRecall(world, ci, on) {
  const c = world.colonies[ci]; on = !!on;
  if (!c || !!c.recall === on) return false;
  const M = world.poi && world.poi.human.mower;
  c.recall = on; c.recallMow = on && !!M && M.state !== 'off';
  if (on) {
    // recruit orders end: those ants are coming home anyway
    if (c.orders && AL.Orders) for (const o of c.orders.slice()) if (!o.done) AL.Orders.cancelRecruit(world, ci, o.id);
    recallSweep(world, ci);
  }
  AL.emit(world, 'recall', { col: ci, on, auto: !!world._recallAuto });
  return true;
}
function secondRecall(world) {
  const M = world.poi.human.mower, mowing = M.state === 'warn' || M.state === 'mow';
  for (const c of world.colonies) {
    if (c.recall) {
      if (c.recallMow && !mowing) { world._recallAuto = true; setRecall(world, c.id, false); world._recallAuto = false; continue; }
      recallSweep(world, c.id);
    }
    // rivals react to the warning a few seconds late
    if (!c.isPlayer && c.alive !== false) {
      if (!mowing) c.aiRecallAt = null;
      else if (!c.recall) {
        if (c.aiRecallAt == null) c.aiRecallAt = world.t + 3 + world.R() * 9;
        else if (world.t >= c.aiRecallAt) setRecall(world, c.id, true);
      }
    }
  }
}
function setSprinklers(world, on, secs) {
  const SP = world.poi.human.sprink;
  if (SP.on === on) return;
  SP.on = on; SP.t = secs || PT.SPRINKLER_TIME; if (!on) SP.cool = 120;
  AL.emit(world, 'sprinkler', { on });
}
function secondHuman(world) {
  const P = world.poi, H = P.human, e = world.env, c = world.clock || { hour: 12, daylight: 1, day: 0, seasonT: 0 }, W = world.weather || {}, R = world.R, S = world.surface;
  const F = H.foot, M = H.mower, SP = H.sprink;
  const outdoors = !e.winter && e.rain < 0.25 && c.daylight > 0.5;
  if (!F.walking) { F.next -= 1; if (F.next <= 0 && outdoors) { startWalk(world, F.nextDir); F.nextDir = 0; } }
  if (M.state === 'off') {
    M.next -= 1;
    const mowSeason = e.season === 'spring' || e.season === 'summer' || (e.season === 'autumn' && c.seasonT < 0.5);
    if (M.next <= 0 && mowSeason && c.hour > 9 && c.hour < 17 && e.rain < 0.1) startMower(world);
  }
  secondRecall(world);
  for (let k = M.stripes.length - 1; k >= 0; k--) { M.stripes[k].age += 1; if (M.stripes[k].age > 150) M.stripes.splice(k, 1); }
  // mowed flowers lose their heads (and nectar) and grow back a couple of days later
  if (M.state === 'mow') for (const f of S.flowers) if (!f.cut && Math.abs(f.y - M.y) <= PT.MOWER_W / 2 && (M.dir > 0 ? f.x <= M.x : f.x >= M.x)) f.cut = world.t;
  for (const f of S.flowers) if (f.cut && world.t - f.cut > AL.TUNE.FLOWER_REGROW) f.cut = 0;
  // sprinklers: the people switch them on in a heat wave, and some summer evenings
  if (!SP.on) {
    SP.cool -= 1;
    let want = W.kind === 'heat' && W.heatFor > 25;
    if (!want && e.season === 'summer' && c.hour >= 19 && c.hour < 19.6 && SP.day !== c.day) { SP.day = c.day; want = R() < 0.35; }
    if (want && SP.cool <= 0 && !e.winter && e.rain < 0.1) setSprinklers(world, true);
  } else {
    SP.t -= 1;
    for (const sp of P.sprinklers) {
      Wd().washDisc(world, sp.x, sp.y, sp.r, 0.82);
      world.colonies.forEach((col, k) => { const d = AL.hypot(col.x - sp.x, col.y - sp.y); if (d < sp.r + col.moundR * 0.5) Wd().addWater(world, k, 2 * (1 - 0.5 * d / sp.r)); });
      let wet = false;
      for (const p of S.pois) if (p.type === 'puddle' && !p.gone && AL.dist2(p.x, p.y, sp.x, sp.y) < sp.r * sp.r) { p.spray = true; wet = true; }
      if (!wet) addTempPuddle(world, sp.x + 40, sp.y + 50, 40);
    }
    if (SP.t <= 0) setSprinklers(world, false);
  }
  // picnic: a summer lunchtime refills the blanket (if the last spill is mostly eaten) and people walk out to it
  if (e.season === 'summer' && c.hour >= 12 && c.hour < 13 && H.picnic.day !== c.day) {
    H.picnic.day = c.day;
    let left = 0; for (const f of S.foods) if (!f.gone && f.picnic) left += f.amount;
    const spill = S.pois.find(p => p.type === 'spill');
    if (spill && spill.srcs) for (const f of spill.srcs) if (!f.gone) left += f.amount;
    if (left < 200) { H.picnic.soon = 25; AL.emit(world, 'picnicSoon', { x: P.center.x, y: P.center.y, in: 25 }); }
  }
  if (H.picnic.soon > 0 && --H.picnic.soon <= 0) {
    const x = P.center.x, y = P.center.y;
    AL.Surface.addFood(S, { kind: K.SUGAR, x: x - 40, y: y - 14, r: 28, amount: 360, visual: 'cookie', picnic: true });
    AL.Surface.addFood(S, { kind: K.PROTEIN, x: x + 46, y: y + 20, r: 18, amount: 90, visual: 'ham', picnic: true });
    AL.Surface.addFood(S, { kind: K.SUGAR, x: x + 6, y: y + 44, r: 20, amount: 140, visual: 'fruit', rot: 0, picnic: true });
    AL.emit(world, 'picnic', { x, y });
    if (!F.walking) { startWalk(world, 1); F.back = true; }
  }
}

function secondPois(world) {
  const P = world.poi, S = world.surface, e = world.env, W = world.weather || {}, c = world.clock || { seasonT: 0 }, R = world.R, A = world.ants;
  // dead insects drop, mirrored for every colony
  P.deadT -= 1;
  if (P.deadT <= 0 && !e.winter) { P.deadT = AL.lerp(PT.DEAD_EVERY[0], PT.DEAD_EVERY[1], R()); spawnMirrored(world, R() < 0.5 ? 'moth' : 'bug'); }
  // apples fall from late summer into autumn
  if ((e.season === 'summer' && c.seasonT > 0.4) || e.season === 'autumn') {
    for (const t of P.appleTrees) {
      t.appleT = (t.appleT == null ? 40 : t.appleT) - 1;
      if (t.appleT > 0) continue;
      t.appleT = 70 + R() * 50;
      let n = 0; for (const f of S.foods) if (!f.gone && f.visual === 'fruit' && AL.dist2(f.x, f.y, t.x, t.y) < t.r * t.r) n++;
      if (n >= 3) continue;
      const a = R() * TAU, d = Math.sqrt(R()) * t.r * 0.7, x = t.x + AL.cos(a) * d, y = t.y + AL.sin(a) * d;
      if (AL.Surface.isBlocked(S, x, y)) continue;
      const p = { type: 'fruit', x, y, r: 24, rot: 0, seed: R() * 100 }; S.pois.push(p);
      p.src = AL.Surface.addFood(S, { kind: K.SUGAR, x, y, r: 24, amount: 200, poi: p, visual: 'fruit', rot: 0 });
      AL.emit(world, 'appleFell', { x, y });
    }
  }
  // storm puddles fill the hollows
  if (W.rain > 0.35) for (const s of P.stormSpots) if (!s.p || s.p.gone) s.p = addTempPuddle(world, s.x, s.y, 48);
  // aphids: tending ants (counted for honeydew), winter dieback
  const tendNow = (world.tick / 30 | 0) % 2 === 0;
  for (const p of S.pois) {
    if (p.type !== 'aphids' || p.gone) continue;
    if (e.winter) { if (!p.wintered) { p.wintered = true; p.aphids = Math.max(3, p.aphids * 0.35); } continue; }
    p.wintered = false;
    if (tendNow) {
      const n = Wd().antsIn(world, p.x, p.y, p.r + 16, BUF); CNT.fill(0);
      for (let k = 0; k < n; k++) { const c2 = A.col[BUF[k]]; if (c2 < 8) CNT[c2]++; }
      let best = -1, bv = 0; for (let k = 0; k < 8; k++) if (CNT[k] > bv) { bv = CNT[k]; best = k; }
      p.tended = n; if (best >= 0) p.owner = best;
    }
  }
}

AL.WorldPOI = { PT, plan, apply, augment, frameOf, toW, makePoi, spawnMirrored, addTempPuddle, settleAphids, herd, aphidsNear, updatePois,
  startWalk, startMower, setRecall, setSprinklers, inSole, pointAt, coreUpdatePois };

AL.registerSystem({
  id: 'world-poi', order: 11,
  enabled(opts) { return opts.world !== false; },
  init(world, opts) {
    // createWorld picks the layout (world.layout) and already applied a fair one; older callers pass opts.layout
    const L = world.layout !== undefined ? world.layout : opts.layout && opts.layout.fair ? opts.layout : null;
    let P;
    if (L) {
      if (!world.surface.fairApplied) apply(world, L);
      P = { fair: true, frames: L.frames, lairs: L.lairs.slice(), beetleHomes: L.beetleHomes.slice(), termites: L.termites.slice(), sprinklers: L.sprinklers.map(s => Object.assign({}, s)),
        stormSpots: L.stormSpots.map(s => Object.assign({}, s)), appleTrees: world.surface.trees.filter(t => t.kind === 'apple'), path: L.path.slice(), center: L.center, blanket: L.blanket, slots: L.slots };
    } else P = Object.assign({ fair: false }, augment(world));
    P.pathCum = pathInfo(P.path);
    P.spawned = []; P.deadT = 50; P.layout = L;
    P.human = { foot: { walking: false, next: 80, s: 0, dir: 1, acc: 0, side: 1, back: false, nextDir: 0 }, steps: [],
      mower: { state: 'off', next: PT.MOWER_FIRST, t: 0, x: 0, y: 0, dir: 1, lane: 0, lanes: 0, y0: 0, ystep: 0, stripes: [], hit: null },
      sprink: { on: false, t: 0, cool: 0, day: -1 }, picnic: { day: -1, soon: 0 } };
    world.poi = P;
    if (AL.World && AL.World.buildShade) AL.World.buildShade(world);
  },
  tick(world, dt) { if (humansHere(world)) tickHuman(world, dt); },
  second(world) { secondPois(world); if (humansHere(world)) secondHuman(world); },
});

if (NODE) module.exports = AL.WorldPOI;
})(typeof window !== 'undefined' ? window : globalThis);
