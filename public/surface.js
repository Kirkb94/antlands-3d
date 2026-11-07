// The backyard surface: map layout, obstacles, food sources and points of interest.
// Food is physical: each source holds crumbs and every forager carries one crumb home.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');
const K = AL.CARRY;

const W0 = 4000, H0 = 3000, W = W0, H = H0;   // the medium yard (terrain.js AL.MAP_SIZES has the others)

function makeSurface(world) {
  const R = world.R, cell = AL.TUNE.PHER_CELL, W = world.mapW || W0, H = world.mapH || H0;
  const S = {
    W, H, cell,
    gw: Math.ceil(W / cell), gh: Math.ceil(H / cell),
    blocked: null,             // Uint8Array per pheromone cell: 1 rock/log/water
    shelter: null,             // Uint8Array per cell: 1 under the rock shelter (rain can't wash trails there)
    foods: [],                 // food sources {id, kind, x, y, r, amount, max, ...}
    pois: [],                  // drawable points of interest
    creatures: [],             // spider, ladybugs, caterpillars (filled by creatures.js)
    rocks: [], logs: [], stones: [], trees: [], flowers: [],
    foodGrid: null, fgCell: 32, fgW: 0, fgH: 0, foodDirty: true, byId: new Map(),
    nextFoodId: 1,
  };
  S.blocked = new Uint8Array(S.gw * S.gh);
  S.shelter = new Uint8Array(S.gw * S.gh);
  S.fgW = Math.ceil(W / S.fgCell); S.fgH = Math.ceil(H / S.fgCell);
  S.foodGrid = new Int16Array(S.fgW * S.fgH).fill(-1);
  return S;
}

// ---- obstacles -----------------------------------------------------------------------
function stampEllipse(S, arr, x, y, rx, ry, rot, val) {
  const c = S.cell, m = Math.max(rx, ry);
  const cx0 = Math.max(0, ((x - m) / c) | 0), cx1 = Math.min(S.gw - 1, ((x + m) / c) | 0);
  const cy0 = Math.max(0, ((y - m) / c) | 0), cy1 = Math.min(S.gh - 1, ((y + m) / c) | 0);
  const co = AL.cos(-rot), si = AL.sin(-rot);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const dx = (cx + 0.5) * c - x, dy = (cy + 0.5) * c - y;
    const u = dx * co - dy * si, v = dx * si + dy * co;
    if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) arr[cy * S.gw + cx] = val;
  }
}
function isBlocked(S, x, y) {
  if (x < 2 || y < 2 || x > S.W - 2 || y > S.H - 2) return true;
  return S.blocked[((y / S.cell) | 0) * S.gw + ((x / S.cell) | 0)] === 1;
}

// ---- food sources ---------------------------------------------------------------------
// (sugar, protein and seed sources hold AL.TUNE.FOOD_MUL x the amounts their callers list; f.noMul: already scaled)
const FOOD_KINDS = [K.SUGAR, K.PROTEIN, K.SEED];
function addFood(S, f) {
  const src = Object.assign({ id: S.nextFoodId++, r: 8, amount: 10, max: 10, regen: 0, big: false, needed: 0,
    pull: new Float32Array(8), carriers: 0, rot: 0, quality: 1, corpse: false, visual: 'crumbs', gone: false }, f);
  const mul = AL.TUNE.FOOD_MUL || 1;
  if (mul !== 1 && !src.noMul && FOOD_KINDS.indexOf(src.kind) >= 0) { src.amount *= mul; if (f.max != null) src.max *= mul; }
  if (src.max < src.amount) src.max = src.amount;
  S.foods.push(src); S.byId.set(src.id, src); S.foodDirty = true;
  return src;
}
// small protein items left by dead ants; merged into piles so the list stays short
function dropCorpse(S, x, y, col, amt) {
  amt *= AL.TUNE.FOOD_MUL || 1;
  for (let i = S.foods.length - 1; i >= 0 && i > S.foods.length - 40; i--) {
    const f = S.foods[i];
    if (f.corpse && !f.gone && AL.dist2(f.x, f.y, x, y) < 196) { f.amount += amt; f.max = Math.max(f.max, f.amount); f.r = Math.min(14, 4 + Math.sqrt(f.amount) * 1.6); f.n = (f.n || 1) + 1; return f; }
  }
  return addFood(S, { kind: K.PROTEIN, x, y, r: 5, amount: amt, max: amt, corpse: true, visual: 'corpse', col, n: 1, decay: 300, noMul: true });
}
// ---- renewable sugar: honeydew on aphid plants, nectar in flowers -----------------------
const renews = f => f.visual === 'honeydew' || f.visual === 'nectar' || !!f.spring;   // (key point springs refill: victory.js)
function addNectar(S, fl) {
  if (fl.kind === 'clover' || fl.nectar) return null;
  fl.nectar = addFood(S, { kind: K.SUGAR, x: fl.x, y: fl.y, r: 7, amount: AL.TUNE.NECTAR_MAX * 0.8, max: AL.TUNE.NECTAR_MAX, regen: 0, visual: 'nectar', flower: fl });
  return fl.nectar;
}
// nectar refills while the flower stands (not in winter); a mowed flower has none until it grows back
function tickNectar(world, f, dt) {
  const fl = f.flower, e = world.env || {};
  if (fl && fl.cut) { if (f.amount > 0) { f.amount = 0; world.surface.foodDirty = true; } return; }
  if (e.winter) return;
  const was = f.amount;
  f.amount = Math.min(f.max, f.amount + AL.TUNE.NECTAR_RATE * dt * (e.night > 0.6 ? 0.4 : 1));
  if (was < 1 && f.amount >= 1) world.surface.foodDirty = true;   // back on the smell grid
}

function rebuildFoodGrid(S) {
  const g = S.foodGrid, c = S.fgCell, smell = AL.TUNE.FOOD_SMELL;
  g.fill(-1);
  // compact the list now and then
  if (S.foods.length > 60 && S.foods.some(f => f.gone)) {
    for (const f of S.foods) if (f.gone) S.byId.delete(f.id);
    S.foods = S.foods.filter(f => !f.gone);
  }
  for (let k = 0; k < S.foods.length; k++) {
    const f = S.foods[k]; if (f.gone || f.amount < 1) continue;
    const rr = f.r + smell + (f.visual === 'honeydew' ? 50 : 0), x0 = Math.max(0, ((f.x - rr) / c) | 0), x1 = Math.min(S.fgW - 1, ((f.x + rr) / c) | 0);
    const y0 = Math.max(0, ((f.y - rr) / c) | 0), y1 = Math.min(S.fgH - 1, ((f.y + rr) / c) | 0);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const dx = (cx + 0.5) * c - f.x, dy = (cy + 0.5) * c - f.y;
      if (dx * dx + dy * dy > (rr + c * 0.7) * (rr + c * 0.7)) continue;
      const i = cy * S.fgW + cx, cur = g[i];
      // keep the closer / bigger source in shared cells
      if (cur < 0 || S.foods[cur].amount < f.amount || f.big) g[i] = k;
    }
  }
  S.foodDirty = false;
}
function foodAt(S, x, y) {
  if (S.foodDirty) rebuildFoodGrid(S);
  const cx = (x / S.fgCell) | 0, cy = (y / S.fgCell) | 0;
  if (cx < 0 || cy < 0 || cx >= S.fgW || cy >= S.fgH) return null;
  const k = S.foodGrid[cy * S.fgW + cx];
  if (k < 0) return null;
  const f = S.foods[k];
  return f && !f.gone && f.amount >= 1 ? f : null;
}

// ---- map generation ------------------------------------------------------------------
function generate(world, layout) {
  const S = makeSurface(world), R = world.R;
  world.surface = S;
  const L = layout || {};
  const nests = L.nests || [{ x: 760, y: 2240 }, { x: 3240, y: 760 }];
  S.nestSites = nests;
  const nearNest = (x, y, d) => nests.some(n => AL.dist2(n.x, n.y, x, y) < d * d);

  // decorative stepping-stone path from the patio (bottom right) toward the shed corner (top left)
  for (let k = 0; k < 15; k++) {
    const t = k / 14, x = AL.lerp(3700, 1500, t) + AL.sin(t * 5) * 120, y = AL.lerp(2700, 160, t) + AL.cos(t * 4) * 60;
    if (nearNest(x, y, 260)) continue;
    S.stones.push({ x, y, rx: 46 + R() * 14, ry: 34 + R() * 10, rot: R() * Math.PI, seed: R() * 1000 });
  }
  // patio (human zone) slabs in the bottom-right corner
  S.patio = { x: 3480, y: 2420, w: 520, h: 580 };
  // trees: canopies cast shade; apples fall under the apple tree
  S.trees.push({ x: 1560, y: 860, r: 330, kind: 'apple' });
  S.trees.push({ x: 3560, y: 1760, r: 260, kind: 'maple' });

  // rocks (impassable). One big flat rock is a shelter: the ground around it stays dry.
  const rockList = [
    { x: 2050, y: 1480, rx: 92, ry: 70, rot: 0.3, shelter: true },
    { x: 1180, y: 1660, rx: 40, ry: 28, rot: 1.1 }, { x: 1230, y: 1700, rx: 22, ry: 18, rot: 0.2 },
    { x: 2480, y: 1020, rx: 46, ry: 34, rot: 2.1 }, { x: 2860, y: 2240, rx: 52, ry: 36, rot: 0.8 },
    { x: 560, y: 1500, rx: 38, ry: 30, rot: 0.4 }, { x: 3200, y: 1300, rx: 44, ry: 30, rot: 1.9 },
    { x: 1700, y: 2140, rx: 34, ry: 26, rot: 0.6 }, { x: 2300, y: 2760, rx: 48, ry: 32, rot: 2.6 },
    { x: 3620, y: 520, rx: 40, ry: 30, rot: 1.2 }, { x: 900, y: 600, rx: 36, ry: 30, rot: 0.1 },
  ];
  for (const r of rockList) {
    r.seed = R() * 1000; S.rocks.push(r);
    stampEllipse(S, S.blocked, r.x, r.y, r.rx, r.ry, r.rot, 1);
    if (r.shelter) stampEllipse(S, S.shelter, r.x, r.y, r.rx + 70, r.ry + 60, r.rot, 1);
  }
  // fallen log (carpenter ants will love it)
  const log = { x: 1880, y: 2560, len: 360, r: 34, rot: -0.35, seed: R() * 1000 };
  S.logs.push(log);
  stampEllipse(S, S.blocked, log.x, log.y, log.len / 2, log.r, log.rot, 1);

  // flowers / clover tufts are decoration
  for (let k = 0; k < 70; k++) {
    const x = R() * S.W, y = R() * S.H;
    if (isBlocked(S, x, y) || nearNest(x, y, 200)) continue;
    S.flowers.push({ x, y, kind: R() < 0.55 ? 'clover' : (R() < 0.6 ? 'daisy' : 'dandelion'), s: 0.7 + R() * 0.6, rot: R() * 6.28 });
  }
  for (const fl of S.flowers) addNectar(S, fl);

  // ---- points of interest with food -------------------------------------------------
  const poi = (p) => { S.pois.push(p); return p; };
  // fallen apples under the apple tree (sugar; they rot)
  for (const [x, y] of [[1420, 1000], [1700, 760]]) {
    const p = poi({ type: 'fruit', x, y, r: 26, rot: 0, seed: R() * 100 });
    p.src = addFood(S, { kind: K.SUGAR, x, y, r: 26, amount: 260, poi: p, visual: 'fruit' });
  }
  // a dead beetle: big protein, needs several carriers to drag home (or gets cut up)
  {
    const p = poi({ type: 'beetle', x: 1340, y: 1960, r: 18, a: 0.7 });
    p.src = addFood(S, { kind: K.PROTEIN, x: p.x, y: p.y, r: 18, amount: 60, big: true, needed: 5, poi: p, visual: 'beetle', a: 0.7 });
  }
  {
    const p = poi({ type: 'beetle', x: 2620, y: 1580, r: 18, a: 2.2 });
    p.src = addFood(S, { kind: K.PROTEIN, x: p.x, y: p.y, r: 18, amount: 40, big: true, needed: 5, poi: p, visual: 'beetle', a: 2.2 });
  }
  // picnic spill by the patio: cookie crumbs (sugar) and a dropped bit of ham (protein)
  {
    const p = poi({ type: 'spill', x: 3240, y: 2480, r: 60 });
    p.srcs = [
      addFood(S, { kind: K.SUGAR, x: 3210, y: 2470, r: 30, amount: 420, poi: p, visual: 'cookie' }),
      addFood(S, { kind: K.PROTEIN, x: 3290, y: 2520, r: 18, amount: 110, poi: p, visual: 'ham' }),
    ];
  }
  // aphid colonies on plants: honeydew regrows while the aphids live
  for (const [x, y] of [[2280, 2260], [2140, 1100], [980, 1180]]) {
    const p = poi({ type: 'aphids', x, y, r: 54, aphids: 26, maxAphids: 30, seed: R() * 100 });
    p.src = addFood(S, { kind: K.SUGAR, x, y, r: 30, amount: 30, max: 120, regen: 0, poi: p, visual: 'honeydew' });
  }
  // and every nest gets its own aphid plant a short walk away: steady sugar to build the colony on
  // (honeydew smells sweet from further off than crumbs, see rebuildFoodGrid)
  for (const n of nests) {
    for (let tries = 0; tries < 60; tries++) {
      const a = R() * AL.TAU, d = 360 + R() * 70, x = n.x + AL.cos(a) * d, y = n.y + AL.sin(a) * d;
      if (x < 120 || y < 120 || x > S.W - 120 || y > S.H - 120 || isBlocked(S, x, y) || isBlocked(S, x + 40, y) || isBlocked(S, x - 40, y)) continue;
      if (nests.some(m => m !== n && AL.dist2(m.x, m.y, x, y) < 450 * 450) || S.pois.some(q => AL.dist2(q.x, q.y, x, y) < 110 * 110)) continue;
      const p = poi({ type: 'aphids', x, y, r: 54, aphids: 26, maxAphids: 30, seed: R() * 100, home: true });
      p.src = addFood(S, { kind: K.SUGAR, x, y, r: 30, amount: 40, max: 120, regen: 0, poi: p, visual: 'honeydew' });
      break;
    }
  }
  // puddles: water
  for (const [x, y, r] of [[1040, 1440, 60], [2720, 1880, 74], [3000, 520, 50]]) {
    const p = poi({ type: 'puddle', x, y, r, baseR: r, seed: R() * 100 });
    p.src = addFood(S, { kind: K.WATER, x, y, r: r + 4, amount: 400, max: 400, regen: 0.4, poi: p, visual: 'water' });
  }
  // seed heads under dandelions
  for (const [x, y] of [[560, 1160], [2560, 560], [1500, 2860]]) {
    const p = poi({ type: 'seeds', x, y, r: 28 });
    p.src = addFood(S, { kind: K.SEED, x, y, r: 26, amount: 90, poi: p, visual: 'seeds' });
  }
  // clover patch: leaves (leafcutters cut these for their fungus)
  for (const [x, y] of [[1150, 2620], [2860, 1060], [620, 1840], [1900, 700], [2500, 2050]]) {
    if (isBlocked(S, x, y) || nearNest(x, y, 160)) continue;
    const p = poi({ type: 'clover', x, y, r: 60, seed: R() * 100 });
    p.src = addFood(S, { kind: K.LEAF, x, y, r: 50, amount: 300, max: 300, regen: 0.3, poi: p, visual: 'leaves' });
  }
  // scattered small crumbs so early foraging finds something
  for (let k = 0; k < 26; k++) {
    const x = 200 + R() * (S.W - 400), y = 200 + R() * (S.H - 400);
    if (isBlocked(S, x, y) || nearNest(x, y, 160)) continue;
    const prot = R() < 0.45;
    addFood(S, { kind: prot ? K.PROTEIN : K.SUGAR, x, y, r: 7, amount: 6 + (R() * 8 | 0), visual: prot ? 'bug' : 'crumb', a: R() * 6.28 });
  }
  // every nest site has a little food nearby so the first foragers find something and lay trails
  for (const n of nests) {
    // a dead grasshopper within reach: big protein, a few carriers drag it home
    for (let tries = 0; tries < 30; tries++) {
      const a = R() * AL.TAU, d = 330 + R() * 70, x = n.x + AL.cos(a) * d, y = n.y + AL.sin(a) * d;
      if (x < 80 || y < 80 || x > S.W - 80 || y > S.H - 80 || isBlocked(S, x, y)) continue;
      const p = { type: 'beetle', x, y, r: 16, a: R() * 6.28 }; S.pois.push(p);
      p.src = addFood(S, { kind: K.PROTEIN, x, y, r: 16, amount: 50, big: true, needed: 4, poi: p, visual: 'beetle', a: p.a });
      break;
    }
    for (const [kind, d, amt, vis] of [[K.SUGAR, 300, 45, 'crumb'], [K.PROTEIN, 250, 18, 'bug'], [K.SUGAR, 430, 60, 'crumb'], [K.PROTEIN, 520, 14, 'bug']]) {
      for (let tries = 0; tries < 20; tries++) {
        const a = R() * AL.TAU, x = n.x + AL.cos(a) * d, y = n.y + AL.sin(a) * d;
        if (x < 60 || y < 60 || x > S.W - 60 || y > S.H - 60 || isBlocked(S, x, y)) continue;
        addFood(S, { kind, x, y, r: kind === K.SUGAR ? 10 : 7, amount: amt, visual: vis, a: R() * 6.28 });
        break;
      }
    }
  }
  // don't let anything block the nest entrances
  for (const n of nests) stampEllipse(S, S.blocked, n.x, n.y, 70, 70, 0, 0);
  rebuildFoodGrid(S);
  return S;
}

// ---- litter: insects die and crumbs blow in all the time, so there's always something to find ----
function spawnLitter(world, dt) {
  const S = world.surface, R = world.R;
  S.litterT = (S.litterT || 0) - dt;
  if (S.litterT > 0) return;
  // more ants in the yard, more litter (and room for more of it): insects come to where the colonies are
  const LT = AL.TUNE.LITTER || { every: 4.5, cap: 70, perAnts: 600, capPerAnts: 10, big: 0 }, ants = world.ants.count || 0;
  S.litterT = LT.every * (0.67 + R() * 0.66) / (1 + ants / LT.perAnts);
  let n = 0; for (const f of S.foods) if (f.litter && !f.gone) n++;
  if (n >= LT.cap + ants / LT.capPerAnts) return;
  // most litter turns up round the colonies, the bigger ones more (where insects come to forage); a third anywhere
  const r = R(), cols = world.colonies.filter(c => c.alive !== false && !c.out && c.x != null);
  let near = null;
  if (r < 0.67 && cols.length) {
    let tot = 0; for (const c of cols) tot += 20 + (c.popAll || (c.pop ? c.pop.reduce((a, b) => a + b, 0) : 0));
    let pick = R() * tot; for (const c of cols) { pick -= 20 + (c.popAll || (c.pop ? c.pop.reduce((a, b) => a + b, 0) : 0)); if (pick <= 0) { near = c; break; } }
    near = near || cols[cols.length - 1];
  }
  for (let tries = 0; tries < 10; tries++) {
    let x, y;
    if (near) { const a = R() * AL.TAU, d = 240 + R() * 700; x = near.x + AL.cos(a) * d; y = near.y + AL.sin(a) * d; }
    else { x = 80 + R() * (S.W - 160); y = 80 + R() * (S.H - 160); }
    if (x < 60 || y < 60 || x > S.W - 60 || y > S.H - 60 || isBlocked(S, x, y)) continue;
    // skip spots that already have litter close by, so it spreads into unforaged ground
    if (S.foods.some(f => f.litter && !f.gone && AL.dist2(f.x, f.y, x, y) < 150 * 150)) continue;
    if (R() < (LT.big || 0)) {   // a dead moth: big protein, a few carriers drag it home
      addFood(S, { kind: K.PROTEIN, x, y, r: 10, amount: 22, max: 22, big: true, needed: 3, visual: 'moth', a: R() * 6.28, carcass: true, litter: true });
      return;
    }
    const prot = R() < 0.5;
    addFood(S, { kind: prot ? K.PROTEIN : K.SUGAR, x, y, r: prot ? 6 : 8, amount: prot ? 5 + (R() * 9 | 0) : 6 + (R() * 10 | 0), visual: prot ? 'bug' : 'crumb', a: R() * 6.28, litter: true });
    return;
  }
}

// ---- slow updates for POIs (called a few times per second) ------------------------------
function updatePois(world, dt) {
  const S = world.surface, wx = world.env || {};
  spawnLitter(world, dt);
  for (const f of S.foods) {
    if (f.gone) continue;
    if (f.visual === 'fruit') {
      f.rot = Math.min(1, f.rot + dt / 520);          // fully rotten after ~9 minutes
      f.quality = 1 - f.rot * 0.6;
      if (f.rot >= 1 && f.amount > 0) f.amount -= dt * 0.3; // rots away
    }
    if (f.visual === 'honeydew' && f.poi) {
      const p = f.poi;
      f.amount = Math.min(f.max, f.amount + p.aphids * AL.TUNE.HONEYDEW_RATE * dt);
      if (!p.ladybug && p.aphids < p.maxAphids) p.aphids = Math.min(p.maxAphids, p.aphids + dt * AL.TUNE.APHID_REGROW);
    }
    if (f.visual === 'nectar') tickNectar(world, f, dt);
    if (f.visual === 'water' && f.poi) {
      const p = f.poi, rain = wx.rain || 0;
      if (rain > 0) { p.r = Math.min(p.baseR * 1.7, p.r + dt * rain * 0.9); f.amount = Math.min(f.max, f.amount + dt * 4 * rain); }
      else if (p.r > p.baseR) p.r = Math.max(p.baseR, p.r - dt * 0.05);
      if (wx.heat) p.r = Math.max(p.baseR * 0.6, p.r - dt * 0.08);
      f.r = p.r + 4;
    }
    if (f.regen && f.visual !== 'water') f.amount = Math.min(f.max, f.amount + f.regen * dt);
    if (f.corpse) { f.decay -= dt; if (f.decay <= 0) f.amount = 0; }
    if (f.amount < 1 && !f.regen && !renews(f)) { f.gone = true; S.foodDirty = true; }
  }
}

AL.Surface = { spawnLitter, W, H, generate, updatePois, isBlocked, addFood, dropCorpse, foodAt, rebuildFoodGrid, stampEllipse, addNectar, tickNectar, renews };
if (NODE) module.exports = AL.Surface;
})(typeof window !== 'undefined' ? window : globalThis);
