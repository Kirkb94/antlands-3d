// Antlands founding phase: the new queen sheds her wings, digs and seals a small chamber, lays
// eggs and raises the first (nanitic) workers on her own body reserves. Pure logic, no DOM:
// it runs the same in the browser vignette, in a headless AI founding, and in Node tests.
//
//   const fs = AL.Founding.create({ site, species: 'fire', seed })
//   AL.Founding.update(fs, realSeconds)     // sped-up clock: DAYS_PER_SEC founding days per second
//   player choices: shedWings, chooseDepth('shallow'|'deep'), setClutch(n), eatEgg, openEntrance
//   AL.Founding.target(fs)                  // what rival AI / combat sees ("founding colony")
//   AL.Founding.attack(fs, power)           // rivals can attack at any time (no safe period)
//   AL.Founding.handoff(fs)                 // everything colony play needs
//   AL.Founding.colonyReady(fs) / race(fs)  // colony stage reached? / { phase, progress 0..1 } for the race panel
//   AL.Founding.profileFor(spKey)           // species pace (PROFILE is open: other modules add species to it)
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? (() => { try { return require('./al.js'); } catch (_) { return require('../../_core/public/al.js'); } })() : root.AL;
if (NODE && !AL.Sites) require('./founding-sites.js');
const TILE = AL.Sites.TILE, TINFO = AL.Sites.TILE_INFO;

// ---- tuning (founding days; one founding day is a few real seconds) ---------------------------
const F = {
  DAYS_PER_SEC: 0.45,     // at 1x the whole founding takes about a minute
  AUTO_SHED: 1.2,         // days before she sheds her wings on her own
  SHED_T: 0.35,           // the wing-shedding moment
  DIG_DAYS: 0.09,         // days per tile of topsoil at dig speed 1
  SEAL_T: 0.3,
  LAY_PER_DAY: 2.6,       // eggs per day at breed 1
  EGG_FAT: 1.4,           // fat spent per egg laid
  EGG_D: 6, LARVA_D: 8, PUPA_D: 6,
  LARVA_PROT: 2.6,        // protein a larva needs over its whole stage
  LARVA_FAT: 0.8,
  STARVE_D: 2.5,          // days a larva survives without food
  UPKEEP: 0.5,            // queen fat per day at rest
  DIG_UPKEEP: 2.2,        // queen fat per day while digging
  EAT_FAT: 0.5, EAT_PROT: 1.1,   // eating one egg gives back
  AUTO_OPEN: 2,           // days after the first worker before it opens the entrance by itself
  AUTO_END: 3,            // days after the last brood hatches before colony play starts by itself
  COLONY_WAIT: 8,         // days after reaching colony stage before the player's colony leaves by itself
  FORAGE_SUG: 0.9, FORAGE_PROT: 0.45, // per nanitic per day once the entrance is open, x site food
  QUEEN_KEEP: 0.7,        // foraged food tops the queen up to this share of her reserve; the rest goes to the larder
  GROW_LAY: 0.55,         // once workers forage she keeps laying (x her lay rate) while fat and protein allow
  SHALLOW_WARM: 1.06, DEEP_WARM: 0.95,   // a shallow chamber is warmer (faster brood), a deep one cooler
  THREAT: 0.035,          // rival scout finds the nest, per day, x exposure
  HAZARD: 0.03, RAIN: 0.06, BEETLE: 0.07,
  CLUTCHES: [6, 10, 16],
  SHALLOW: 5, DEEP: 10,   // chamber depth in nest tiles (10 units each)
  QUEEN_HP: 100,
};
// nanitics: the first, undersized workers (multipliers on a normal worker)
const NANITIC = { size: 0.72, hp: 0.6, dps: 0.6, speed: 0.9, carry: 0.6, life: 0.5 };
// species founding profiles: reserves, laying, and the founding PACE
//   fat/prot   the queen's reserves (fat feeds her and her eggs, protein feeds larvae)
//   breed      eggs per day multiplier          dev     brood development speed (x site warmth)
//   digMul     digging speed multiplier         nanitic size of the first workers
//   colonyAt   nanitics (army: callow workers) needed for COLONY STAGE (with the nest open)
//   leave      when an AI queen starts her colony: 'ready' = at colony stage, 'full' = once the first clutch is out
//   pace       one-line label for the race panel
// Other modules may add species: AL.Founding.PROFILE.honeypot = { dev: 0.9, ... } (missing keys fall back to DEFAULT).
const PROFILE_DEFAULT = { fat: 60, prot: 30, breed: 1.2, dev: 1, digMul: 1, nanitic: 0.72, mode: 'claustral', colonyAt: 4, leave: 'ready', pace: 'steady' };
const PROFILE = {
  fire:       { fat: 60, prot: 30, breed: 1.3,  dev: 1.15, digMul: 1.1, nanitic: 0.72, mode: 'claustral', colonyAt: 4, leave: 'ready', pace: 'fast: out first, small start' },
  leafcutter: { fat: 58, prot: 18, breed: 0.85, dev: 0.9,  digMul: 1,   nanitic: 0.7,  mode: 'fungus', fungusRate: 1.1, colonyAt: 5, leave: 'full', pace: 'slow start, strong later' },
  carpenter:  { fat: 74, prot: 34, breed: 0.8,  dev: 0.8,  digMul: 0.9, nanitic: 0.78, mode: 'claustral', colonyAt: 4, leave: 'ready', pace: 'slow, tough nanitics' },
  army:       { fat: 40, prot: 14, breed: 1.6,  dev: 1.25, digMul: 1,   nanitic: 1,    mode: 'bivouac', escort: 14, colonyAt: 6, leave: 'ready', pace: 'quick, but in the open' },
};
function profileFor(spKey) { return Object.assign({ key: spKey }, PROFILE_DEFAULT, PROFILE[spKey] || {}); }
const TOTAL_D = F.EGG_D + F.LARVA_D + F.PUPA_D;
const PHASES = ['land', 'shed', 'choose', 'dig', 'seal', 'brood', 'open', 'done', 'dead'];

function create(opts) {
  opts = opts || {};
  const site = opts.site || { id: opts.siteId || 'meadow', x: 0, y: 0 };
  const siteId = site.id;
  const spKey = opts.species || 'fire';
  const prof = profileFor(spKey);
  const seed = (opts.seed >>> 0) || 4242;
  const mods = AL.Sites.modsFor(siteId, spKey);
  const cols = opts.cols || 90, rows = opts.rows || 60;   // the lead's nest grid (tile = 10 units)
  const bonus = 1 + (opts.reserveBonus || 0);                 // flight result: +25% first down, -10% tired
  const grid = AL.Sites.buildSoil(siteId, cols, rows, seed);
  const fs = {
    v: 1, seed, R: AL.rng(seed ^ 0xf00d), siteId, site, spKey, prof, mods,
    col: opts.col == null ? 0 : opts.col, ai: !!opts.ai,
    autoThreats: opts.autoThreats !== false, autoHazards: opts.autoHazards !== false,
    day: 0, phase: 'land', phaseT: 0, speed: 1, paused: false,
    grid, cols, rows,
    queen: {
      hp: F.QUEEN_HP, maxHp: F.QUEEN_HP, fat: prof.fat * bonus, fatMax: prof.fat * bonus, prot: 0, protMax: prof.prot * bonus,
      wings: 1, c: grid.entrance.c + 0.5, r: -0.6, face: 1, act: 'stand', starving: 0,
    },
    depth: null, path: [], chamber: [], digQ: [], digT: 0, dug: 0, entrance: { c: grid.entrance.c, r: 0 },
    sealed: false, opened: false, found: false,
    clutch: opts.clutch || F.CLUTCHES[1], laid: 0, layT: 0,
    eggs: [], larvae: [], pupae: [], workers: [],
    larder: { sugar: 0, protein: 0 },   // food the nanitics bring in beyond what the queen needs (becomes colony stock)
    plugged: false, growT: 0,
    escort: prof.mode === 'bivouac' ? prof.escort : 0,
    fungus: 0,
    nextId: 1,
    threatMul: opts.threatMul || 1,   // more rivals nearby (a shared site) means more raids
    stats: { laid: 0, eaten: 0, lost: 0, hatched: 0, attacks: 0, repelled: 0, caveIns: 0, floods: 0, foraged: 0 },
    marks: {},        // day of key moments for the timeline: shed, sealed, egg, larva, pupa, worker, opened
    events: [],       // { day, kind, text, good } newest last (UI shows them as toasts)
    fx: [],           // transient visual requests for the scene: { kind, c, r, t }
    forecast: 0,      // projected day of the first worker
    end: null,
  };
  if (prof.mode === 'bivouac') {
    // army ants: a wingless queen walks in with an escort; no digging, no seal
    fs.queen.wings = 0; fs.queen.prot = prof.prot; fs.marks.shed = 0;
    fs.phase = 'brood'; fs.sealed = false; fs.opened = true; fs.depth = 'bivouac';
    fs.clutch = opts.clutch || 16;
    makeBivouac(fs);
  }
  forecast(fs);
  return fs;
}

function ev(fs, kind, text, good) { fs.evN = (fs.evN || 0) + 1; fs.events.push({ n: fs.evN, day: fs.day, kind, text, good: !!good }); if (fs.events.length > 40) fs.events.shift(); }
function fx(fs, kind, c, r) { fs.fx.push({ kind, c, r, t: 0, day: fs.day }); if (fs.fx.length > 60) fs.fx.shift(); }
function setPhase(fs, p) { fs.phase = p; fs.phaseT = 0; }

// ---- player choices ------------------------------------------------------------------------------
function shedWings(fs) {
  if (fs.phase !== 'land') return false;
  setPhase(fs, 'shed'); fs.queen.act = 'shed';
  return true;
}
function chooseDepth(fs, depth) {
  if (fs.phase !== 'choose' && fs.phase !== 'land' && fs.phase !== 'shed') return false;
  fs.depth = depth === 'deep' ? 'deep' : 'shallow';
  if (fs.phase === 'choose') startDig(fs);
  return true;
}
function setClutch(fs, n) {
  n = Math.max(1, Math.min(30, n | 0));
  if (fs.laid > n) n = fs.laid;     // can't un-lay eggs
  fs.clutch = n; forecast(fs);
  return n;
}
// she eats the youngest egg: a little fat and protein back (less than the egg cost)
function eatEgg(fs) {
  if (fs.phase === 'done' || fs.phase === 'dead' || !fs.eggs.length) return false;
  let k = 0; for (let i = 1; i < fs.eggs.length; i++) if (fs.eggs[i].age < fs.eggs[k].age) k = i;
  const e = fs.eggs.splice(k, 1)[0];
  const q = fs.queen;
  q.fat = Math.min(q.fatMax * 1.2, q.fat + F.EAT_FAT); q.prot = Math.min(q.protMax * 1.4, q.prot + F.EAT_PROT);
  fs.stats.eaten++; q.act = 'eat'; q.actT = 0.4;
  fx(fs, 'eat', e.c, e.r);
  forecast(fs);
  return true;
}
// the first worker opens the sealed entrance: food can come in, but the nest can be seen
function openEntrance(fs) {
  if (fs.opened || !fs.workers.length || fs.phase === 'done' || fs.phase === 'dead') return false;
  const re = fs.plugged;
  fs.opened = true; fs.sealed = false; fs.plugged = false; if (fs.marks.opened == null) fs.marks.opened = fs.day;
  if (fs.phase === 'brood') setPhase(fs, 'open');
  ev(fs, 'open', re ? 'The nanitics dig the plug out. Food comes in again, and so can rivals.' : 'A worker breaks the seal. Food can come in now, and rivals can see the entrance.', true);
  fx(fs, 'open', fs.entrance.c, 0);
  return true;
}
// the nanitics plug the opened entrance again: hidden like a sealed nest, but no food comes in
function plugEntrance(fs) {
  if (!fs.opened || fs.prof.mode === 'bivouac' || fs.phase === 'done' || fs.phase === 'dead') return false;
  fs.opened = false; fs.sealed = true; fs.plugged = true;
  ev(fs, 'plug', 'The nanitics plug the entrance with soil. Hidden again, but no food comes in.', true);
  fx(fs, 'seal', fs.entrance.c, 0);
  return true;
}
// COLONY STAGE: enough first workers out and a working entrance (the player may start the colony now)
function colonyReady(fs) {
  if (fs.phase === 'dead') return false;
  if (fs.phase === 'done') return true;
  return fs.workers.length >= fs.prof.colonyAt && (fs.opened || fs.plugged || fs.prof.mode === 'bivouac');
}
// ends founding and moves to colony play (the UI button; also automatic later)
function finish(fs) {
  if (fs.phase === 'dead' || fs.phase === 'done') return false;
  if (!fs.workers.length && fs.prof.mode !== 'bivouac') return false;
  if (!fs.opened) openEntrance(fs);
  if (fs.marks.colony == null && colonyReady(fs)) fs.marks.colony = fs.day;
  setPhase(fs, 'done'); fs.end = 'colony';
  return true;
}

// ---- digging ---------------------------------------------------------------------------------------
const diggable = v => TINFO[v] && (TINFO[v].dig > 0 || v === TILE.AIR || v === TILE.GALLERY);
function startDig(fs) {
  const g = fs.grid, d = fs.depth || 'shallow';
  let depthRows = Math.min(g.waterRow - 4, d === 'deep' ? F.DEEP : F.SHALLOW);
  const rockSide = g.feature && g.feature.kind === 'rock' ? g.feature : null;
  const woodCore = g.feature && g.feature.kind === 'stump';
  if (woodCore) depthRows = Math.min(depthRows, d === 'deep' ? g.feature.depth - 3 : 3);   // stay inside the stump's wood
  const cap = Math.max(6, Math.min(10, Math.floor(fs.mods.chamberMax * 0.45)));
  const cw = Math.max(3, Math.min(5, Math.round(cap / 2))), ch = cap >= 8 ? 2 : 2;
  // best chamber spot: fully diggable box near the entrance column at the target depth
  let best = null, bs = 1e9;
  for (let r0 = Math.max(2, depthRows - 2); r0 <= depthRows + 3; r0++) for (let c0 = Math.max(1, fs.entrance.c - 12); c0 + cw < Math.min(fs.cols - 1, fs.entrance.c + 12); c0++) {
    let ok = true, cost = 0;
    for (let r = r0; r < r0 + ch && ok; r++) for (let c = c0; c < c0 + cw; c++) { const v = AL.Sites.tileAt(g, c, r); if (!diggable(v) || v === TILE.WATER) { ok = false; break; } cost += TINFO[v].dig; }
    if (!ok || r0 + ch >= g.waterRow) continue;
    let s = Math.abs(c0 + cw / 2 - fs.entrance.c) * 1.4 + Math.abs(r0 - depthRows) * 2 + cost * 0.3;
    if (rockSide && c0 + cw > fs.entrance.c + 1) s += 12;      // under a rock: tuck the chamber under the stone
    if (woodCore) { let wood = 0; for (let c = c0; c < c0 + cw; c++) if (AL.Sites.tileAt(g, c, r0) === TILE.WOOD || AL.Sites.tileAt(g, c, r0) === TILE.GALLERY) wood++; s += (cw - wood) * 3; }  // stump: inside the wood
    if (s < bs) { bs = s; best = { c0, r0 }; }
  }
  if (!best) best = { c0: Math.max(1, fs.entrance.c - 2), r0: Math.min(depthRows, g.waterRow - 4) };
  const goal = { c: best.c0 + (cw >> 1), r: best.r0 };
  fs.path = shaftPath(fs, fs.entrance, goal);
  fs.chamber = [];
  for (let r = best.r0; r < best.r0 + ch; r++) for (let c = best.c0; c < best.c0 + cw; c++) fs.chamber.push({ c, r });
  // chamber cells dug from the shaft outward
  fs.chamber.sort((a, b) => (Math.abs(a.c - goal.c) + (a.r - goal.r) * 0.6) - (Math.abs(b.c - goal.c) + (b.r - goal.r) * 0.6));
  const seen = new Set();
  fs.digQ = [];
  for (const p of fs.path.concat(fs.chamber)) { const k = p.r * fs.cols + p.c; if (seen.has(k)) continue; seen.add(k); fs.digQ.push(p); }
  fs.chamberBox = { c0: best.c0, r0: best.r0, w: cw, h: ch };
  fs.digT = 0; setPhase(fs, 'dig'); fs.queen.act = 'dig';
}
// cheapest diggable route (Dijkstra over the little grid; rock/roots/slab/water are walls)
function shaftPath(fs, from, to) {
  const g = fs.grid, W = fs.cols, H = fs.rows, N = W * H;
  // search only a box around the two points (the nest grid is big, the founding dig is small)
  const bx0 = Math.max(0, Math.min(from.c, to.c) - 14), bx1 = Math.min(W - 1, Math.max(from.c, to.c) + 14);
  const by1 = Math.min(H - 1, Math.max(from.r, to.r) + 6);
  const dist = new Float32Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const start = from.r * W + from.c, goal = to.r * W + to.c;
  dist[start] = 0;
  for (;;) {
    let u = -1, bd = 1e9;
    for (let r = 0; r <= by1; r++) for (let c = bx0, i = r * W + bx0; c <= bx1; c++, i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0 || u === goal) break;
    done[u] = 1;
    const uc = u % W, ur = (u / W) | 0;
    for (const [dc, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const c = uc + dc, r = ur + dr; if (c < bx0 || r < 0 || c > bx1 || r > by1) continue;
      const v = g.tiles[r * W + c]; if (!diggable(v) || v === TILE.WATER) continue;
      // prefer going down; open tiles (galleries, the crack) are nearly free
      const w = (v === TILE.AIR || v === TILE.GALLERY ? 0.1 : TINFO[v].dig) + (dr === 0 ? 0.6 : 0) + (dr < 0 ? 2 : 0);
      const nd = dist[u] + w, i = r * W + c;
      if (nd < dist[i]) { dist[i] = nd; prev[i] = u; }
    }
  }
  const out = [];
  if (prev[goal] < 0 && goal !== start) { for (let r = from.r; r <= to.r; r++) out.push({ c: from.c, r }); return out; }
  for (let i = goal; i >= 0; i = prev[i]) { out.push({ c: i % W, r: (i / W) | 0 }); if (i === start) break; }
  return out.reverse();
}
function tileDays(fs, v) { return v === TILE.AIR || v === TILE.GALLERY ? 0.02 : F.DIG_DAYS * TINFO[v].dig / Math.max(0.2, fs.mods.dig * (fs.prof.digMul || 1)); }
function updateDig(fs, dd) {
  const q = fs.queen, g = fs.grid;
  q.fat -= F.DIG_UPKEEP * dd;
  if (!fs.digQ.length) { setPhase(fs, 'seal'); q.act = 'seal'; return; }
  const p = fs.digQ[0], v = g.tiles[p.r * fs.cols + p.c];
  // walk the queen to the face she is digging
  q.c = AL.lerp(q.c, p.c + 0.5, Math.min(1, dd * 8)); q.r = AL.lerp(q.r, p.r + 0.5, Math.min(1, dd * 8));
  q.face = p.c + 0.5 >= q.c ? 1 : -1;
  fs.digT += dd;
  if (fs.digT >= tileDays(fs, v)) {
    fs.digT = 0;
    g.tiles[p.r * fs.cols + p.c] = TILE.AIR;
    fs.digQ.shift(); fs.dug++;
    fx(fs, 'dig', p.c, p.r);
    // loose ground can slump back in: re-dig the tile behind her
    const hold = TINFO[v] ? TINFO[v].hold : 1;
    if (fs.R() < fs.mods.caveIn * 1.6 * (1.4 - hold) && fs.dug > 2) {
      g.tiles[p.r * fs.cols + p.c] = v === TILE.SAND ? TILE.SAND : TILE.TOPSOIL;
      fs.digQ.unshift(p); fs.stats.caveIns++; q.hp -= 2;
      fx(fs, 'cave', p.c, p.r);
      ev(fs, 'cave', 'The ' + (TINFO[v] ? TINFO[v].name.toLowerCase() : 'soil') + ' caved in. She digs it out again.', false);
    }
  }
}
function updateSeal(fs, dd) {
  const q = fs.queen;
  q.fat -= F.UPKEEP * dd;
  // she climbs back up the shaft to plug the top with soil, then settles in the chamber
  const top = fs.path[1] || fs.path[0] || fs.entrance;
  if (fs.phaseT < F.SEAL_T * 0.6) { q.c = AL.lerp(q.c, top.c + 0.5, Math.min(1, dd * 10)); q.r = AL.lerp(q.r, top.r + 0.5, Math.min(1, dd * 10)); }
  if (fs.phaseT >= F.SEAL_T) {
    fs.sealed = true; fs.marks.sealed = fs.day;
    fx(fs, 'seal', fs.entrance.c, 0);
    ev(fs, 'seal', 'Sealed in. Nobody can see the nest until a worker opens it.', true);
    setPhase(fs, 'brood'); q.act = 'tend';
    const b = fs.chamberBox; q.c = b.c0 + b.w - 0.95; q.r = b.r0 + b.h - 0.5;
  }
}
// army ants: the escort forms a living ball; a pretend chamber just to place brood in the vignette
function makeBivouac(fs) {
  const c0 = Math.max(1, fs.entrance.c - 3), w = 6;
  fs.chamberBox = { c0, r0: -2, w, h: 2, bivouac: true };
  fs.chamber = [];
  for (let c = c0; c < c0 + w; c++) fs.chamber.push({ c, r: -1 });
  fs.queen.c = c0 + w / 2; fs.queen.r = -0.6;
}

// brood slots inside the chamber: the queen rests at the right end, eggs in a pile before her head,
// larvae and pupae in rows along the left
function broodSpot(fs, kind, k) {
  const b = fs.chamberBox;
  const floor = b.r0 + b.h - 0.12;
  const eggC = b.c0 + b.w - 2.35;
  if (kind === 'egg') { const row = k < 5 ? 0 : k < 9 ? 1 : k < 12 ? 2 : 3, i = k - [0, 5, 9, 12][row]; return { c: eggC + (i - (row === 0 ? 2 : row === 1 ? 1.5 : 1)) * 0.13, r: floor - row * 0.1 }; }
  const per = Math.max(3, Math.floor((eggC - 0.5 - b.c0) / 0.3));
  const i = k % per, row = Math.floor(k / per);
  return { c: b.c0 + 0.32 + i * 0.3 + (row % 2) * 0.15, r: floor - row * 0.26 };
}
function relayout(fs) {
  fs.eggs.forEach((e, k) => Object.assign(e, broodSpot(fs, 'egg', k)));
  fs.larvae.forEach((e, k) => Object.assign(e, broodSpot(fs, 'larva', k)));
  fs.pupae.forEach((e, k) => Object.assign(e, broodSpot(fs, 'pupa', k)));
}

// ---- brood ---------------------------------------------------------------------------------------
function devRate(fs) { return fs.mods.warmth * fs.prof.dev * (fs.depth === 'deep' ? F.DEEP_WARM : fs.depth === 'shallow' ? F.SHALLOW_WARM : 1); }
function updateBrood(fs, dd) {
  const q = fs.queen, warm = devRate(fs);
  // the queen's own upkeep
  q.fat -= F.UPKEEP * dd;
  // laying
  if (fs.laid < fs.clutch && q.fat > 2) {
    fs.layT += dd * F.LAY_PER_DAY * fs.prof.breed;
    while (fs.layT >= 1 && fs.laid < fs.clutch) {
      fs.layT -= 1; fs.laid++; fs.stats.laid++;
      q.fat -= F.EGG_FAT;
      const e = { id: fs.nextId++, age: 0, c: 0, r: 0 };
      fs.eggs.push(e); relayout(fs);
      if (fs.marks.egg == null) { fs.marks.egg = fs.day; ev(fs, 'egg', 'The first egg.', true); }
      fx(fs, 'lay', e.c, e.r); q.act = 'lay'; q.actT = 0.3;
    }
  }
  // once nanitics forage she keeps laying, as long as reserves stay healthy: brood that comes along into colony play
  if (fs.laid >= fs.clutch && fs.opened && fs.workers.length && q.fat > q.fatMax * 0.55 && q.prot > fs.larvae.length * F.LARVA_PROT * 0.5 + 2) {
    if (fs.firstClutch == null) fs.firstClutch = fs.laid;
    fs.growT += dd * F.LAY_PER_DAY * fs.prof.breed * F.GROW_LAY * Math.min(1, fs.workers.length / 4);
    while (fs.growT >= 1) {
      fs.growT -= 1; fs.laid++; fs.clutch++; fs.stats.laid++; q.fat -= F.EGG_FAT;
      const e = { id: fs.nextId++, age: 0, c: 0, r: 0, grow: true };
      fs.eggs.push(e); relayout(fs); fx(fs, 'lay', e.c, e.r);
    }
  }
  // fungus gardeners: leafcutter queens tend a fungus pellet that slowly makes protein
  if (fs.prof.mode === 'fungus' && fs.marks.sealed != null) {
    fs.fungus = Math.min(1, fs.fungus + dd * 0.12);
    const cost = 0.25 * dd; if (q.fat > cost) { q.fat -= cost; q.prot += fs.prof.fungusRate * fs.fungus * dd; }
  }
  // eggs -> larvae
  for (let i = fs.eggs.length - 1; i >= 0; i--) {
    const e = fs.eggs[i]; e.age += dd * warm;
    if (e.age >= F.EGG_D) {
      fs.eggs.splice(i, 1);
      fs.larvae.push({ id: e.id, age: 0, fed: 0, hunger: 0, c: e.c, r: e.r, grow: e.grow });
      if (fs.marks.larva == null) { fs.marks.larva = fs.day; ev(fs, 'larva', 'The first larva hatched. Larvae eat protein from her reserves.', true); }
    }
  }
  // larvae eat, oldest first (she feeds the ones closest to pupating); without protein they stall and starve
  // when protein can't carry them all to pupation she rations: the youngest go without
  const fed = fs.larvae.slice();
  let budget = Math.max(0, q.prot);
  for (let i = 0; i < fed.length; i++) {
    const l = fed[i];
    const rem = (1 - l.age / F.LARVA_D) * F.LARVA_PROT;
    l.rationed = budget < rem * 0.85 && i > 0;
    budget -= rem;
    const needP = F.LARVA_PROT / F.LARVA_D * warm * dd, needF = F.LARVA_FAT / F.LARVA_D * warm * dd;
    const giveP = l.rationed ? 0 : Math.min(needP, Math.max(0, q.prot)), giveF = l.rationed ? 0 : Math.min(needF, Math.max(0, q.fat - 0.5));
    q.prot -= giveP; q.fat -= giveF;
    const frac = needP > 0 ? Math.min(giveP / needP, giveF / Math.max(1e-9, needF)) : 1;
    l.age += dd * warm * frac; l.fed += giveP;
    if (frac < 0.5) l.hunger += dd; else l.hunger = Math.max(0, l.hunger - dd * 0.5);
    if (l.hunger > F.STARVE_D) {
      fs.larvae.splice(fs.larvae.indexOf(l), 1); fs.stats.lost++;
      if (!(fs.day - (fs._starveMsg || -9) < 2)) { fs._starveMsg = fs.day; ev(fs, 'starve', 'A larva starved. Eat an egg to turn it into protein, or lay fewer.', false); }
      continue;
    }
    if (l.age >= F.LARVA_D) {
      fs.larvae.splice(fs.larvae.indexOf(l), 1);
      fs.pupae.push({ id: l.id, age: 0, c: l.c, r: l.r, grow: l.grow });
      if (fs.marks.pupa == null) { fs.marks.pupa = fs.day; ev(fs, 'pupa', 'The first pupa. It needs no food.', true); }
    }
  }
  // pupae -> workers
  for (let i = fs.pupae.length - 1; i >= 0; i--) {
    const p = fs.pupae[i]; p.age += dd * warm;
    if (p.age >= F.PUPA_D) {
      fs.pupae.splice(i, 1); fs.stats.hatched++;
      const nan = fs.prof.mode !== 'bivouac';
      fs.workers.push({ id: p.id, hp: 1, c: p.c, r: p.r, nanitic: nan, t: 0 });
      fx(fs, 'hatch', p.c, p.r);
      if (fs.marks.worker == null) {
        fs.marks.worker = fs.day;
        ev(fs, 'worker', nan ? 'The first worker! A nanitic: small and weak, but she can open the nest and forage.' : 'The first callow workers join the escort.', true);
      }
    }
  }
  relayout(fs);
  // nanitics forage once the entrance is open
  if (fs.opened && fs.workers.length) {
    const n = fs.workers.length * (fs.prof.mode === 'bivouac' ? 1 : NANITIC.carry);
    const s = F.FORAGE_SUG * fs.mods.food * n * dd, p = F.FORAGE_PROT * fs.mods.food * n * dd;
    // the queen is topped up first; the rest is stored (it becomes the colony's starting stock)
    const fIn = Math.min(s, Math.max(0, q.fatMax * F.QUEEN_KEEP - q.fat)), pIn = Math.min(p, Math.max(0, q.protMax * F.QUEEN_KEEP - q.prot));
    q.fat += fIn; q.prot += pIn;
    fs.larder.sugar += s - fIn; fs.larder.protein += p - pIn;
    fs.stats.foraged += s + p;
  }
  // army escort raids for protein and eats sugar
  if (fs.prof.mode === 'bivouac' && fs.escort > 0) {
    q.prot = Math.min(q.protMax * 1.6, q.prot + 0.22 * fs.escort * fs.mods.food * dd);
    q.fat = Math.min(q.fatMax * 1.2, q.fat + 0.08 * fs.escort * fs.mods.food * dd - 0.04 * fs.escort * dd);
  }
  // auto-open after the first worker has rested a while, and auto-end once all brood has hatched
  if (!fs.opened && !fs.plugged && fs.marks.worker != null && fs.day - fs.marks.worker >= F.AUTO_OPEN) openEntrance(fs);
  const broodLeft = fs.eggs.length + fs.larvae.length + fs.pupae.length;
  if (fs.workers.length && !broodLeft && fs.laid >= fs.clutch) {
    fs.allDone = fs.allDone == null ? fs.day : fs.allDone;
    if (fs.day - fs.allDone >= F.AUTO_END) finish(fs);
  }
  // colony stage: the player can leave now (rivals still founding stay small and exposed in colony play)
  if (fs.marks.colony == null && colonyReady(fs)) {
    fs.marks.colony = fs.day;
    ev(fs, 'colony', 'Colony stage: ' + fs.workers.length + (fs.prof.mode === 'bivouac' ? ' callow workers' : ' nanitics') + ' and a working nest. Start the colony now, or wait for a bigger start.', true);
  }
  if (!fs.ai && fs.phase !== 'done' && fs.marks.colony != null && fs.day - fs.marks.colony >= F.COLONY_WAIT) finish(fs);
}

// ---- the founding race: where a queen is and how close she is to colony stage --------------------
// progress 0..1: digging 0..0.15, then the development of her `colonyAt` most advanced brood 0.15..0.9,
// the entrance 0.9..1; exactly 1 at colony stage.
function devOf(kind, age) { return kind === 'egg' ? age / TOTAL_D : kind === 'larva' ? (F.EGG_D + age) / TOTAL_D : kind === 'pupa' ? (F.EGG_D + F.LARVA_D + age) / TOTAL_D : 1; }
function broodDevs(fs) {
  const d = [];
  for (const w of fs.workers) d.push(1);
  for (const p of fs.pupae) d.push(devOf('pupa', p.age));
  for (const l of fs.larvae) d.push(devOf('larva', l.age));
  for (const e of fs.eggs) d.push(devOf('egg', e.age));
  return d.sort((a, b) => b - a);
}
// the shared progress formula (also used by founding-race.js for nests still founding in colony play)
function progressOf(digFrac, devs, colonyAt, opened) {
  let top = 0; const k = Math.max(1, colonyAt);
  for (let i = 0; i < k && i < devs.length; i++) top += Math.min(1, devs[i]);
  return AL.clamp(0.15 * AL.clamp(digFrac, 0, 1) + 0.75 * top / k + (opened ? 0.1 : 0), 0, 1);
}
function race(fs) {
  const ready = colonyReady(fs), ph = fs.phase, biv = fs.prof.mode === 'bivouac';
  let phase, progress;
  if (ph === 'dead') { phase = 'dead'; progress = 0; }
  else if (ph === 'done') { phase = 'out'; progress = 1; }
  else if (ready) { phase = 'colony'; progress = 1; }
  else {
    const digFrac = biv || ph === 'brood' || ph === 'open' ? 1 : ph === 'dig' ? fs.dug / Math.max(1, fs.dug + fs.digQ.length) : ph === 'seal' ? 1 : 0;
    progress = Math.min(0.99, progressOf(digFrac, broodDevs(fs), fs.prof.colonyAt, fs.opened && !biv));
    phase = ph === 'land' || ph === 'shed' || ph === 'choose' ? 'landed' : ph === 'dig' || ph === 'seal' ? 'digging'
      : fs.workers.length ? (fs.opened ? 'open' : 'nanitics') : fs.pupae.length ? 'pupae' : fs.larvae.length ? 'larvae' : fs.eggs.length ? 'eggs' : biv ? 'bivouac' : 'sealed';
  }
  return { phase, progress, ready, workers: fs.workers.length, escort: fs.escort, colonyAt: fs.prof.colonyAt, exposure: exposure(fs), sealed: fs.sealed, opened: fs.opened, day: fs.day };
}
const PHASE_LABEL = { landed: 'landed', digging: 'digging', sealed: 'sealed in', bivouac: 'bivouac', eggs: 'eggs', larvae: 'larvae', pupae: 'pupae', nanitics: 'first nanitics', open: 'nest open', colony: 'colony stage', out: 'colony: out', dead: 'dead' };

// projected day of the first worker (for the timeline)
function forecast(fs) {
  const w = devRate(fs) || 1;
  let d;
  if (fs.workers.length) d = fs.marks.worker;
  else if (fs.pupae.length) d = fs.day + (F.PUPA_D - Math.max(...fs.pupae.map(p => p.age))) / w;
  else if (fs.larvae.length) d = fs.day + (F.LARVA_D - Math.max(...fs.larvae.map(l => l.age)) + F.PUPA_D) / w;
  else if (fs.eggs.length) d = fs.day + (F.EGG_D - Math.max(...fs.eggs.map(e => e.age)) + F.LARVA_D + F.PUPA_D) / w;
  else {
    const digLeft = fs.phase === 'brood' || fs.phase === 'open' ? 0 : estimateDig(fs);
    d = fs.day + digLeft + F.SEAL_T + 1 / (F.LAY_PER_DAY * fs.prof.breed) + (F.EGG_D + F.LARVA_D + F.PUPA_D) / w;
  }
  fs.forecast = d;
  return d;
}
function estimateDig(fs) {
  if (fs.digQ.length) return fs.digQ.reduce((s, p) => s + tileDays(fs, fs.grid.tiles[p.r * fs.cols + p.c]), 0);
  return (fs.depth === 'deep' ? F.DEEP + 12 : F.SHALLOW + 12) * F.DIG_DAYS * 1.2 / Math.max(0.2, fs.mods.dig) + (fs.phase === 'land' ? F.SHED_T : 0);
}

// ---- threats: rivals and the backyard ----------------------------------------------------------
// how noticeable the founding colony is right now (1 = an open lawn nest)
function exposure(fs) {
  if (fs.phase === 'done' || fs.phase === 'dead') return 0;
  let e = fs.mods.visibility;
  if (fs.prof.mode === 'bivouac') e *= 1.3;
  else if (fs.sealed) e *= 0.25;
  else if (!fs.opened && fs.phase !== 'land' && fs.phase !== 'shed' && fs.phase !== 'choose') e *= 0.8;  // digging: a fresh spoil heap
  if (fs.depth === 'deep') e *= 0.85;
  return e;
}
// the "founding colony" target that rival AI / combat reads
function target(fs) {
  const s = fs.site || {}, e = s.decor ? AL.Sites.entranceOf(s) : { x: s.x || 0, y: s.y || 0 };
  return {
    kind: 'founding', col: fs.col, site: fs.siteId, x: e.x, y: e.y,
    sealed: fs.sealed, hidden: fs.sealed && fs.prof.mode !== 'bivouac', exposure: exposure(fs),
    // the radius at which a rival ant notices it (world units)
    noticeR: 40 + 90 * exposure(fs),
    queenHp: fs.queen.hp, defence: defencePower(fs), brood: fs.eggs.length + fs.larvae.length + fs.pupae.length,
    workers: fs.workers.length, escort: fs.escort, alive: fs.phase !== 'dead', founding: fs.phase !== 'done',
  };
}
function defencePower(fs) {
  const q = fs.queen;
  return (4 * (q.hp / q.maxHp) + fs.workers.length * (fs.workers[0] && fs.workers[0].nanitic ? 0.7 : 1.2) + fs.escort * 1.2) * fs.mods.defence * (fs.depth === 'deep' ? 1.15 : 1);
}
// a rival raid on the founding colony. power ~ number of attacking workers.
// returns { repelled, queenDmg, broodLost, workersLost }
function attack(fs, power, who) {
  if (fs.phase === 'done' || fs.phase === 'dead') return null;
  fs.stats.attacks++; fs.found = true;
  const R = fs.R, def = defencePower(fs);
  const roll = def * (0.6 + R() * 0.8);
  const out = { repelled: roll >= power, queenDmg: 0, broodLost: 0, workersLost: 0 };
  if (out.repelled) {
    out.queenDmg = Math.round(power * 1.6 / fs.mods.defence);
    fs.stats.repelled++;
    ev(fs, 'attack', (who || 'A rival scout') + ' broke in. The queen drove it off.', true);
  } else {
    out.queenDmg = Math.round(power * 3.2 / fs.mods.defence);
    out.broodLost = Math.min(fs.eggs.length + fs.larvae.length, 1 + R.int(Math.ceil(power / 3) + 1));
    for (let k = 0; k < out.broodLost; k++) { if (fs.eggs.length) fs.eggs.pop(); else fs.larvae.pop(); }
    if (fs.workers.length && R() < 0.5) { fs.workers.pop(); out.workersLost = 1; }
    if (fs.escort && R() < 0.6) { fs.escort--; out.workersLost++; }
    fs.stats.lost += out.broodLost;
    ev(fs, 'attack', (who || 'Rival ants') + ' raided the chamber and carried off ' + out.broodLost + ' brood.', false);
  }
  fs.queen.hp -= out.queenDmg; fs.queen.act = 'fight'; fs.queen.actT = 0.6;
  fx(fs, 'fight', fs.queen.c, fs.queen.r);
  relayout(fs);
  if (fs.queen.hp <= 0) die(fs, 'The queen was killed by raiders.');
  return out;
}
function brood1(fs, frac, why) {
  // lose a fraction of eggs/larvae (floods, trowels)
  const n = Math.min(fs.eggs.length + fs.larvae.length, Math.round((fs.eggs.length + fs.larvae.length) * frac));
  for (let k = 0; k < n; k++) { if (fs.eggs.length && (k % 2 === 0 || !fs.larvae.length)) fs.eggs.pop(); else fs.larvae.pop(); }
  fs.stats.lost += n; relayout(fs);
  return n;
}
function randomEvents(fs, dd) {
  const R = fs.R, m = fs.mods, deep = fs.depth === 'deep';
  if (fs.phase === 'land' || fs.phase === 'shed' || fs.phase === 'choose') return;
  // rival scouts (in the lead's game the AI drives this instead: autoThreats = false)
  if (fs.autoThreats && R() < F.THREAT * exposure(fs) * (fs.threatMul || 1) * dd * (1 + fs.day / 30)) {
    attack(fs, 2 + R() * 3 + fs.day * 0.12, R() < 0.5 ? 'A rival scout' : 'A rival worker');
  }
  if (!fs.autoHazards || fs.phase === 'dig' || fs.phase === 'seal') return;
  // rain: some sites flood
  if (R() < F.RAIN * dd) {
    const wet = m.flood * (deep ? 0.35 : 1) * (fs.prof.mode === 'bivouac' ? 0.4 : 1);
    if (wet > 0.3) {
      const lost = brood1(fs, (wet - 0.25) * 0.5);
      fs.stats.floods++; fs.queen.fat -= 1.5 * wet; fx(fs, 'flood', fs.queen.c, fs.queen.r);
      ev(fs, 'flood', 'Rain soaked into the chamber' + (lost ? ' and ' + lost + ' brood drowned.' : '. Everyone survived.'), false);
    } else ev(fs, 'rain', 'Rain overhead. The chamber stays dry' + (deep ? ' (deep chamber).' : '.'), true);
  }
  // surface hazards: rakes, watering cans, footsteps, birds pecking at the spoil
  if (R() < F.HAZARD * m.hazard * dd) {
    const what = { garden: 'The gardener raked the bed', crack: 'Footsteps thudded over the slab', meadow: 'A bird pecked at the lawn', sand: 'A paw scraped the bank', log: 'A woodlouse herd shuffled past', rock: 'Something nosed around the rock', roots: 'A squirrel dug among the roots', stump: 'A woodpecker hammered the stump' }[fs.siteId] || 'Something disturbed the ground';
    if (!deep && fs.siteId !== 'rock' && fs.siteId !== 'crack') { const lost = brood1(fs, 0.2); fs.queen.hp -= 4; ev(fs, 'hazard', what + (lost ? ': ' + lost + ' brood lost.' : '.'), false); }
    else ev(fs, 'hazard', what + '. The chamber is deep enough to be safe.', true);
  }
  // stump residents: beetles chew into the chamber
  if (fs.site && fs.site.def && fs.site.def.residents && R() < F.BEETLE * dd) {
    fs.queen.hp -= 5; const lost = R() < 0.4 ? brood1(fs, 0.1) : 0;
    fx(fs, 'fight', fs.queen.c, fs.queen.r);
    ev(fs, 'beetle', 'A bark beetle chewed into the chamber. The queen bit it back' + (lost ? ', but it crushed an egg.' : '.'), false);
  }
  // loose sand settles
  if (R() < m.caveIn * 2 * dd * (deep ? 1.2 : 1)) {
    fs.queen.fat -= 1.2; fs.stats.caveIns++; fx(fs, 'cave', fs.queen.c, fs.queen.r - 1);
    ev(fs, 'cave', 'Part of the ceiling slumped. She spent energy shoring it up.', false);
  }
}

function die(fs, why) {
  if (fs.phase === 'dead') return;
  setPhase(fs, 'dead'); fs.end = 'dead'; fs.deathReason = why; fs.queen.hp = 0; fs.queen.act = 'dead';
  ev(fs, 'dead', why, false);
}

// ---- clock ---------------------------------------------------------------------------------------
// advance by realSec seconds of real time (scaled by fs.speed); fixed small sub-steps keep it stable
function update(fs, realSec) {
  if (fs.paused || fs.phase === 'done' || fs.phase === 'dead') { ageFx(fs, realSec); return; }
  let days = realSec * F.DAYS_PER_SEC * fs.speed;
  while (days > 1e-9) { const d = Math.min(days, 0.05); advance(fs, d); days -= d; if (fs.phase === 'done' || fs.phase === 'dead') break; }
  ageFx(fs, realSec);
}
function ageFx(fs, s) {
  fs.fx = fs.fx || []; for (const f of fs.fx) f.t += s; while (fs.fx.length && fs.fx[0].t > 3) fs.fx.shift(); }
function advance(fs, dd) {
  const q = fs.queen;
  fs.day += dd; fs.phaseT += dd;
  if (q.actT > 0) { q.actT -= dd; if (q.actT <= 0) q.act = fs.phase === 'dig' ? 'dig' : 'tend'; }
  switch (fs.phase) {
    case 'land':
      q.r = Math.min(-0.45, q.r + dd);
      if (fs.phaseT >= F.AUTO_SHED || fs.ai) shedWings(fs);
      break;
    case 'shed':
      q.wings = Math.max(0, 1 - fs.phaseT / F.SHED_T);
      if (fs.phaseT >= F.SHED_T) {
        q.wings = 0; q.prot = q.protMax; fs.marks.shed = fs.day;
        ev(fs, 'shed', 'She tears off her wings. Her flight muscles become a protein reserve.', true);
        fx(fs, 'wings', q.c, q.r);
        setPhase(fs, 'choose'); q.act = 'stand';
        if (fs.depth || fs.ai) { if (!fs.depth) fs.depth = aiDepth(fs); startDig(fs); }
      }
      break;
    case 'choose':
      // waits for the player; the AI (or a long wait) picks for her
      if (fs.ai || fs.phaseT > 4) { fs.depth = fs.depth || aiDepth(fs); startDig(fs); }
      break;
    case 'dig': updateDig(fs, dd); break;
    case 'seal': updateSeal(fs, dd); break;
    case 'brood': case 'open': updateBrood(fs, dd); break;
  }
  randomEvents(fs, dd);
  if (fs.ai) aiThink(fs);
  // starvation: once fat is gone she burns her own body
  if (q.fat <= 0) {
    q.fat = 0; q.starving += dd; q.hp -= 9 * dd;
    if (!fs._warnedStarve) { fs._warnedStarve = true; ev(fs, 'hungry', 'Her fat reserve is gone. She is starving: eat eggs now.', false); }
  } else { q.starving = 0; fs._warnedStarve = false; }
  if (q.hp <= 0) die(fs, q.fat <= 0 ? 'The queen starved before her workers could feed her.' : 'The queen died.');
  if ((fs._fc = (fs._fc || 0) + 1) % 10 === 0) forecast(fs);
}

// ---- headless AI founding (the rival queen) ------------------------------------------------------
function aiDepth(fs) { return fs.mods.flood > 0.35 || fs.mods.hazard > 1.5 || fs.mods.visibility > 1.4 ? 'deep' : 'shallow'; }
function aiThink(fs) {
  const q = fs.queen;
  if (fs.phase === 'brood' && fs.laid === 0) fs.clutch = fs.prof.fat > 65 ? 12 : 10;
  // eat eggs when protein can't cover the larvae coming up, or fat runs low
  const need = fs.larvae.length * F.LARVA_PROT * 0.6 + fs.eggs.length * F.LARVA_PROT;
  if (fs.eggs.length > 1 && (q.prot < need * 0.55 || q.fat < 6)) eatEgg(fs);
  if (fs.workers.length && !fs.opened && !fs.plugged && fs.day - fs.marks.worker > 0.5) openEntrance(fs);
  if (aiWantsOut(fs)) finish(fs);
}
// when an AI queen starts her colony: right at colony stage, or (leave: 'full') once her first clutch is out
function aiWantsOut(fs) {
  if (!colonyReady(fs) || fs.phase === 'done') return false;
  const since = fs.day - (fs.marks.colony == null ? fs.day : fs.marks.colony);
  if (fs.prof.leave === 'full') return !fs.eggs.concat(fs.larvae, fs.pupae).some(b => !b.grow) || since > 6;
  return since >= 0.3;
}
// run a whole founding headless (rival AI, tests). Returns the handoff.
function simulate(opts, maxDays) {
  const fs = create(Object.assign({ ai: true }, opts));
  const lim = maxDays || 80;
  while (fs.phase !== 'done' && fs.phase !== 'dead' && fs.day < lim) advance(fs, 0.05);
  if (fs.phase !== 'dead' && fs.phase !== 'done') finish(fs);
  return handoff(fs);
}

// ---- hand-off to colony play ----------------------------------------------------------------------
function handoff(fs) {
  const q = fs.queen, b = fs.chamberBox || { c0: fs.entrance.c, r0: 0, w: 1, h: 1 };
  const tunnel = (fs.path || []).filter(p => fs.grid.tiles[p.r * fs.cols + p.c] === TILE.AIR || fs.grid.tiles[p.r * fs.cols + p.c] === TILE.GALLERY);
  const site = fs.site || {};
  const ent = site.decor ? AL.Sites.entranceOf(site) : { x: site.x || 0, y: site.y || 0 };
  return {
    ok: fs.phase !== 'dead', reason: fs.deathReason || null,
    species: fs.spKey, siteId: fs.siteId, site: fs.site, mods: fs.mods, col: fs.col,
    x: ent.x, y: ent.y,
    day: Math.round(fs.day * 10) / 10,
    queen: { hp: Math.max(0, q.hp), maxHp: q.maxHp, hpFrac: Math.max(0, q.hp) / q.maxHp, fat: q.fat, prot: q.prot },
    // what the colony starts with in the lead's stock units (the queen's leftover reserves)
    // (plus the larder the nanitics filled: waiting longer at an open nest means a bigger start)
    stock: { sugar: Math.round(q.fat * 0.6 + fs.larder.sugar), protein: Math.round(q.prot * 0.6 + fs.larder.protein) },
    larder: { sugar: Math.round(fs.larder.sugar), protein: Math.round(fs.larder.protein) },
    race: race(fs),
    reserves: { fat: q.fat, protein: q.prot, fatMax: q.fatMax, protMax: q.protMax },
    nanitics: fs.prof.mode === 'bivouac' ? 0 : fs.workers.length,
    workers: fs.prof.mode === 'bivouac' ? fs.workers.length + fs.escort : 0,
    escort: fs.escort,
    naniticStats: Object.assign({}, NANITIC, { size: fs.prof.nanitic }),
    brood: {
      // ages are 0..1 through their stage, so the nest module can keep them growing
      eggs: fs.eggs.map(e => e.age / F.EGG_D),
      larvae: fs.larvae.map(l => l.age / F.LARVA_D),
      pupae: fs.pupae.map(p => p.age / F.PUPA_D),
    },
    nest: {
      mode: fs.prof.mode, depth: fs.depth, cols: fs.cols, rows: fs.rows, seed: fs.seed, kind: fs.grid.kind,
      entrance: { c: fs.entrance.c, r: 0 }, waterRow: fs.grid.waterRow,
      chamber: { c0: b.c0, r0: b.r0, w: b.w, h: b.h, cells: fs.chamber.map(p => [p.c, p.r]) },
      tunnel: tunnel.map(p => [p.c, p.r]),
      tiles: fs.grid.tiles,      // the grid as dug (Uint8Array, AL.Sites.TILE kinds)
    },
    sealed: fs.sealed, opened: fs.opened, found: fs.found,
    marks: Object.assign({}, fs.marks), stats: Object.assign({}, fs.stats),
  };
}

// apply a handoff to the lead's world (defensive: uses whatever the lead has today)
//   - colony stock, position and site modifiers
//   - the colony's workers become the founding's workers: the first `nanitics` are smaller and weaker
//     (hp, dps and life scaled; flagged when AntStore has `nanitic` / `size` arrays)
//   - brood/queen state left on colony.founded for the nest module to pick up
function applyToWorld(world, ho) {
  const c = world.colonies[ho.col]; if (!c) return null;
  c.site = { id: ho.siteId, mods: ho.mods };
  c.siteTraits = Object.assign({}, ho.mods, { site: ho.siteId, nanitics: ho.nanitics });
  if (ho.stock) { c.stock.sugar = ho.stock.sugar; c.stock.protein = ho.stock.protein; }
  c.founded = ho;
  c.nanitics = ho.nanitics;
  if (c.queen && ho.queen) {
    c.queen.hp = (c.queen.maxHp || c.queen.hp || 1) * Math.max(0.05, ho.queen.hpFrac);
    const qi = c.queen.i; if (qi != null && qi >= 0 && world.ants.state[qi]) world.ants.hp[qi] = world.ants.maxhp[qi] * Math.max(0.05, ho.queen.hpFrac);
  }
  const A = world.ants, R = world.R, C = AL.CASTE, ns = ho.naniticStats;
  const want = ho.nanitics + ho.workers;
  if (c.inside) {
    // an AI colony with an abstract nest: its founding result becomes its head count and brood queue
    for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === ho.col && A.caste[i] !== C.QUEEN) A.kill(i);
    c.inside.fill(0); c.inside[C.WORKER] = want;
    if (c.broodQ) { c.broodQ.length = 0; for (const t of ho.brood.eggs.concat(ho.brood.larvae, ho.brood.pupae)) c.broodQ.push({ caste: C.WORKER, t: t * 0.5 }); }
    if (AL.emit) AL.emit(world, 'founded', { col: ho.col, x: c.x, y: c.y, nanitics: ho.nanitics, site: ho.siteId });
    return [];
  }
  const mine = [];
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === ho.col && A.caste[i] !== C.QUEEN) mine.push(i);
  // match the head count the founding produced
  for (let k = want; k < mine.length; k++) A.kill(mine[k]);
  mine.length = Math.min(mine.length, want);
  while (mine.length < want) {
    const a = R() * AL.TAU;
    const i = A.spawn(ho.col, C.WORKER, AL.LAYER.SURFACE, c.x + AL.cos(a) * 6, c.y + AL.sin(a) * 6, a, R);
    if (i < 0) break; mine.push(i);
  }
  for (let k = 0; k < mine.length && k < ho.nanitics; k++) {
    const i = mine[k];
    A.caste[i] = C.WORKER;
    A.maxhp[i] = AL.CASTES[C.WORKER].hp * ns.hp; A.hp[i] = A.maxhp[i]; A.life[i] = AL.CASTES[C.WORKER].life * ns.life * (0.8 + R() * 0.4);
    if (A.nanitic) A.nanitic[i] = 1;
    if (A.size) A.size[i] = ns.size;
  }
  if (AL.emit) AL.emit(world, 'founded', { col: ho.col, x: c.x, y: c.y, nanitics: ho.nanitics, site: ho.siteId });
  return mine;
}

// ---- in-game system: site scenery on the map and the founding results applied to colonies -----
// opts.foundingSites: the site list the flight used (else placed fresh from the seed)
// opts.founding: the player's handoff; opts.rivalFoundings: [handoff] keyed by .col
if (AL.registerSystem) AL.registerSystem({
  id: 'founding', order: 3,
  enabled(opts) { return !opts.bench; },
  init(world, opts) {
    const S = world.surface;
    let sites = opts.foundingSites;
    if (sites && sites.length) {
      // re-attach definitions (patches may have been serialised) and re-stamp the stump
      sites = sites.map(s => Object.assign({}, s, { def: AL.SITES[s.type || s.id], mods: Object.assign({}, (AL.SITES[s.type || s.id] || {}).mods), decor: s.decor || {} }));
      S.foundingSites = sites;
      for (const s of sites) if (s.decor.stump) AL.Surface.stampEllipse(S, S.blocked, s.x, s.y, s.decor.stump.r * 0.8, s.decor.stump.r * 0.8, 0, 1);
    } else sites = AL.Sites.place(S, { seed: world.seed });
    // keep nests reachable even if one sits on the stump's rim
    for (const n of S.nestSites) AL.Surface.stampEllipse(S, S.blocked, n.x, n.y, 26, 26, 0, 0);
    AL.Sites.stockFood(S, sites, world.seed);
    world.founding = { sites, applied: false };
  },
  pre(world) {
    const f = world.founding; if (!f || f.applied) return;
    f.applied = true;    // first tick: the core has spawned its start workers by now
    const o = world.opts || {};
    if (o.founding) applyToWorld(world, Object.assign({}, o.founding, { col: 0 }));
    for (const ho of o.rivalFoundings || []) if (world.colonies[ho.col]) applyToWorld(world, ho);
  },
  render: {
    ground(ctx, view, r) {
      const w = r && r.world; if (!w || !w.founding) return;
      for (const s of w.founding.sites) {
        if (s.x + 200 < view.x0 || s.x - 200 > view.x1 || s.y + 200 < view.y0 || s.y - 200 > view.y1) continue;
        AL.Sites.drawDecor(ctx, s, view.frame || 0);
      }
    },
  },
});

// createWorld({ nestPreset: AL.Founding.nestPreset(handoff) }): the lead's nest (AL.Nest, 90 x 60) gets the
// site's soil variant and the chamber + shaft the queen dug. Tile kinds map onto AL.Nest.TILE.
function nestPreset(ho) {
  return function (nest, R) {
    const NT = AL.Nest && AL.Nest.TILE; if (!NT || !ho || !ho.nest || ho.nest.mode === 'bivouac') return AL.Nest && AL.Nest.carve ? defaultFounding(nest) : undefined;
    const g = AL.Sites.buildSoil(ho.siteId, nest.cols, nest.rows, ho.nest.seed);   // the undug variant (deterministic)
    const map = [NT.OPEN, NT.TOPSOIL, NT.CLAY, NT.GRAVEL, NT.ROCK, NT.ROOT, NT.GRAVEL, NT.TOPSOIL, NT.WOOD, NT.TOPSOIL, NT.ROCK, NT.TOPSOIL, NT.WOOD];
    for (let i = 0; i < nest.n && i < g.tiles.length; i++) nest.kind[i] = map[g.tiles[i]];
    nest.waterTable = Math.min(nest.rows - 2, g.waterRow);
    nest.entrance = { c: ho.nest.entrance.c, r: 0 };
    nest.roots = (g.rootPaths || []).map(p => p.pts.map(([c, r], k) => [c * nest.tile, r * nest.tile, (1 - k / p.pts.length) * (0.4 + p.w)]));
    nest.siteKind = g.kind; nest.siteFeature = g.feature;
    nest.base.set(nest.kind);
    // what the queen dug
    for (const [c, r] of ho.nest.tunnel) AL.Nest.carve(nest, c, r, c, r);
    for (const [c, r] of ho.nest.chamber.cells) AL.Nest.carve(nest, c, r, c, r, AL.Nest.CH.QUEEN);
    AL.Nest.carve(nest, nest.entrance.c, 0, nest.entrance.c, 0);
  };
}
function defaultFounding(nest) { const e = nest.entrance.c; AL.Nest.carve(nest, e, 0, e, 9); AL.Nest.carveRoom(nest, e, 11, 1.6, 1, AL.Nest.CH.QUEEN); }

AL.Founding = {
  F, NANITIC, PROFILE, PROFILE_DEFAULT, PHASES, PHASE_LABEL, TOTAL_D,
  create, update, advance, ageFx, shedWings, chooseDepth, setClutch, eatEgg, openEntrance, plugEntrance, finish,
  target, attack, exposure, defencePower, forecast, handoff, applyToWorld, nestPreset, simulate, devRate,
  profileFor, colonyReady, race, progressOf, broodDevs, devOf, aiWantsOut,
};
if (NODE) module.exports = AL.Founding;
})(typeof window !== 'undefined' ? window : globalThis);
