// Antlands simulation: world creation and the fixed-timestep step().
// No DOM here, so it runs the same in the browser and in Node tests.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./pheromone.js'); require('./ants.js'); require('./surface.js'); require('./colony.js'); require('./colonies.js'); require('./behavior.js'); require('./terrain.js'); }
const ST = AL.ST, K = AL.CARRY, C = AL.CASTE, T = AL.TUNE;

const CAP = 20000;

function createWorld(opts) {
  opts = opts || {};
  const seed = (opts.seed >>> 0) || ((Math.random() * 1e9) | 0);
  const world = {
    seed, R: AL.rng(seed), t: 0, tick: 0, speed: 1, paused: false, over: null,
    ants: new AL.AntStore(opts.cap || CAP),
    view: { x0: 0, y0: 0, x1: 1e9, y1: 1e9 }, lod: false, autoLod: true,
    // environment, owned by the World stage system when present (defaults = mild spring day)
    env: { day: 1, timeOfDay: 0.35, night: 0, light: 1, rain: 0, heat: 0, temp: 22, season: 'spring', winter: false },
    perf: { updated: 0 },
    events: [], surfaceHandlers: {}, systems: [], opts,
  };
  // particle requests for the renderer: flat queue of (type, x, y, extra)
  world.fxq = { a: [], push(t, x, y, e) { if (this.a.length < 4000) this.a.push(t, x, y, e || 0); } };
  // ---- colonies: how many, where, which species (see colonies.js) ----
  // Founding / flight results place the player's nest (opts.playerSite) and the rivals (opts.rivalSites);
  // missing rivals (opts.colonies more than the sites given) are spread round the yard. With nothing placed
  // and opts.colonies set, the match gets a fair World-stage map: every colony an identical sector.
  const N = AL.Colonies.count(opts), placed = !!(opts.playerSite || opts.rivalSites);
  // biome and map size (terrain.js). The flight and founding stages play on the same map (founding-sites.js stageMap)
  world.biomeKey = AL.BIOMES && AL.BIOMES[opts.biome] ? opts.biome : 'backyard';
  const size = AL.MAP_SIZES && !(opts.layout && opts.layout.nests) && AL.MAP_SIZES[opts.mapSize] || null;
  world.mapSize = size ? size.key : 'medium';
  world.mapW = size ? size.W : AL.Surface.W; world.mapH = size ? size.H : AL.Surface.H;
  const layout = Object.assign({}, opts.layout || {});
  let fair = !placed && layout.fair ? opts.layout : null;
  if (placed) {
    const kx = world.mapW / 4000, ky = world.mapH / 3000;
    const def = [{ x: Math.round(760 * kx), y: Math.round(2240 * ky) }, { x: Math.round(3240 * kx), y: Math.round(760 * ky) }];
    let nests = [opts.playerSite || def[0]].concat(opts.rivalSites || (opts.colonies != null ? [] : [def[1]]));
    if (opts.colonies != null) nests = AL.Colonies.fillSites(nests, N, world.mapW, world.mapH);
    nests = AL.Colonies.spreadNests ? AL.Colonies.spreadNests(nests, world.mapW, world.mapH) : nests;   // no mounds side by side
    // any map but the medium backyard: the flight's nests sit on that map's fair scenery (what the flight showed)
    if (AL.Sites && AL.Sites.stageCustom && AL.Sites.stageCustom(opts) && !opts.bench && opts.world !== false && AL.WorldPOI && AL.WorldPOI.plan) {
      fair = AL.WorldPOI.plan({ seed, n: N, W: world.mapW, H: world.mapH, biome: world.biomeKey });
      Object.assign(layout, fair);
    }
    layout.nests = nests;
  } else if (!layout.nests && opts.colonies != null && !opts.bench && opts.world !== false && AL.WorldPOI && AL.WorldPOI.plan) {
    fair = AL.WorldPOI.plan({ seed, n: N, W: world.mapW, H: world.mapH, biome: world.biomeKey });
    Object.assign(layout, fair);
  } else if (!layout.nests && N !== 2) layout.nests = AL.Colonies.fillSites([{ x: 760, y: 2240 }], N);
  AL.Surface.generate(world, layout);
  // the fair map replaces the core scenery now, before any system (founding sites, AI) looks at the yard
  world.layout = fair;
  if (fair && opts.world !== false && AL.WorldPOI && AL.WorldPOI.apply) { AL.WorldPOI.apply(world, fair); world.surface.fairApplied = true; }
  const S = world.surface, gw = S.gw, gh = S.gh, cell = S.cell;
  const sites = S.nestSites, NC = sites.length;
  const per = (o) => { const a = []; for (let k = 0; k < NC; k++) a.push(new AL.PheromoneGrid(gw, gh, cell, o)); return a; };
  // per colony: food trail + alarm. Player-only: avoid + recruit.
  world.pher = {
    // food trails: slow spread (ants lay them 2 cells wide with sub-cell deposits), long half-life plus a small linear
    // fade so weak scent goes quickly and strong ant highways last. max 12: ants can build far past the brush cap.
    food: per({ halfLife: 100, diffuse: 0.08, fade: 0.0005, max: 12 }),
    alarm: per({ halfLife: 7, diffuse: 0.9, max: 6 }),
    avoid: new AL.PheromoneGrid(gw, gh, cell, { halfLife: 45, diffuse: 0.15 }),
    recruit: new AL.PheromoneGrid(gw, gh, cell, { halfLife: 14, diffuse: 0.3 }),
  };
  world.pherList = world.pher.food.concat(world.pher.alarm, [world.pher.avoid, world.pher.recruit]);
  world.hash = new AL.SpatialHash(S.W, S.H, T.HASH_CELL, world.ants.cap, NC);
  // multiplayer (opts.mp = { humans, me, species[], names[], perks[] }): colonies 0..humans-1 are people, each
  // with the full player model (detailed nest, orders, research); the rest are AI rivals. world.me is this PC's colony.
  const mp = opts.mp || null, H = mp ? Math.max(1, Math.min(NC, mp.humans | 0)) : 1;
  const humanSp = k => { const sp = k === 0 && !mp ? opts.species : mp && mp.species && mp.species[k]; return AL.SPECIES[sp] ? sp : 'fire'; };
  world.colonies = [];
  for (let k = 0; k < H; k++) {
    const c = AL.Colony.create(world, k, { player: true, species: humanSp(k), x: sites[k].x, y: sites[k].y });
    if (mp && mp.names) c.name = mp.names[k];
    world.colonies.push(c);
  }
  world.humans = world.colonies.map(c => c.id);
  world.mp = mp;
  // rival species: given (flight patch / title screen), else random per rival when the match size was chosen, else fire
  const NR = NC - H;
  let rivalSp = (opts.rivalSpecies || []).slice(0, NR);
  if (rivalSp.length < NR && (opts.colonies != null || opts.rivalSpecies)) rivalSp = rivalSp.concat(AL.Colonies.pickSpecies(seed, NR).slice(rivalSp.length));
  for (let k = H; k < sites.length; k++) {
    let sp = rivalSp[k - H] || 'fire';
    if (!AL.SPECIES[sp]) sp = 'fire';
    const c = AL.Colony.create(world, k, { species: sp, x: sites[k].x, y: sites[k].y, colours: AL.Colonies.rivalColours(AL.SPECIES[sp], k) });
    // opts.rivalNests: AI rivals run the same detailed nest as people (real tunnels and ants underground, ai-nest.js
    // plays them); otherwise ai.js keeps them as numbers. Army ants (no nest) stay the old way.
    if (opts.rivalNests && !AL.SPECIES[sp].nomad && !(opts.rivalFoundings || []).some(h => h && h.col === k && h.race && h.race.stillFounding)) c.bot = true;   // (a rival still founding gets its nest when it opens: ai-nest.js toBot)
    world.colonies.push(c);
  }
  // every nest an ant can live in, by nest id (A.nest, A.home): colony k's own nest is id k; satellites with their
  // own nest (expansion.js addHome) get the next ids. A home is the colony itself or a satellite's home object.
  for (const c of world.colonies) c.hid = c.id;
  world.homes = world.colonies.slice();
  // every colony with a detailed nest: the people's, and the AI rivals that have one
  world.detailed = world.colonies.filter(c => c.isPlayer || c.bot).map(c => c.id);
  // player-only scent marks (avoid, recruit): one grid per human; world.pher.avoid / recruit stay colony 0's
  world.pher.avoidOf = [world.pher.avoid]; world.pher.recruitOf = [world.pher.recruit];
  for (let k = 1; k < H; k++) {
    world.pher.avoidOf.push(new AL.PheromoneGrid(gw, gh, cell, { halfLife: 45, diffuse: 0.15 }));
    world.pher.recruitOf.push(new AL.PheromoneGrid(gw, gh, cell, { halfLife: 14, diffuse: 0.3 }));
    world.pherList.push(world.pher.avoidOf[k], world.pher.recruitOf[k]);
  }
  world.me = mp ? Math.max(0, Math.min(H - 1, mp.me | 0)) : 0;
  world.player = world.colonies[world.me];
  // each PC sees its own colony in its species colours and the other people tinted like rivals (look only)
  if (mp) for (let k = 0; k < H; k++) { const c = world.colonies[k]; c.colours = k === world.me ? c.sp : AL.Colonies.rivalColours(c.sp, k); }
  world.arrive = arrive;
  world.deliverBig = deliverBig;
  // registered systems (nest, AI, combat, fog, and the stage modules) hook in here
  world.systems = AL.SYSTEMS.filter(s => !s.enabled || s.enabled(opts));
  for (const s of world.systems) if (s.init) s.init(world, opts);
  if (!opts.bench && !opts.campaign && !opts.demo && !opts.noStarter) starterFood(world);
  AL.emit(world, 'worldCreated', { opts });
  if (opts.bench) spawnBench(world, opts.bench);
  else {
    // colonies without a nest model (no nest system, or not yet an AI nest) start with their workers out foraging
    const n = (opts.start && opts.start.workers) || 40;
    for (const c of world.colonies) if (!c.nest && !c.inside) for (let k = 0; k < n; k++) {
      const a = world.R() * AL.TAU;
      world.ants.spawn(c.id, k % 4 ? C.FORAGER : C.WORKER, AL.LAYER.SURFACE, c.x + AL.cos(a) * 8, c.y + AL.sin(a) * 8, a, world.R);
    }
  }
  return world;
}

// a little food lying round every nest at the start, the same for each (growth pass, Nov 2026): placed by a hash of the
// seed, not world.R, so the rest of the match plays out as before
function starterFood(world) {
  const S = world.surface, ST_ = AL.TUNE.STARTER, seed = world.seed | 0; if (!ST_ || !S) return;
  for (const c of world.colonies) for (let k = 0; k < ST_.piles; k++) {
    let placed = false;
    for (let tryN = 0; tryN < 12 && !placed; tryN++) {
      const a = (k + AL.hash2(seed, c.id * 31 + k, 7 + tryN)) / ST_.piles * AL.TAU, d = ST_.near + AL.hash2(seed, c.id * 17 + k, 11 + tryN) * (ST_.far - ST_.near);
      const x = c.x + AL.cos(a) * d, y = c.y + AL.sin(a) * d;
      if (x < 20 || y < 20 || x > S.W - 20 || y > S.H - 20 || AL.Surface.isBlocked(S, x, y)) continue;
      const sugar = k % 3 !== 1;
      AL.Surface.addFood(S, { kind: sugar ? K.SUGAR : K.PROTEIN, x, y, r: sugar ? 12 : 9, amount: sugar ? ST_.sugar : ST_.protein, visual: sugar ? 'crumbs' : 'bug', a: a });
      placed = true;
    }
  }
}
// benchmark: N foragers already out on the surface
function spawnBench(world, n) {
  const A = world.ants, c = world.colonies[0], R = world.R;
  for (let k = 0; k < n; k++) {
    const a = R() * AL.TAU, d = 30 + R() * 900;
    let x = c.x + AL.cos(a) * d, y = c.y + AL.sin(a) * d;
    x = AL.clamp(x, 10, world.surface.W - 10); y = AL.clamp(y, 10, world.surface.H - 10);
    if (AL.Surface.isBlocked(world.surface, x, y)) { x = c.x; y = c.y; }
    const i = A.spawn(0, R() < 0.8 ? C.FORAGER : C.WORKER, AL.LAYER.SURFACE, x, y, R() * AL.TAU, R);
    A.timer[i] = R() * 40;
  }
}

// an ant reached its own mound entrance
function arrive(world, i) {
  const A = world.ants, col = homeOf(world, i);
  if (col.enter) return col.enter(world, i);
  // no nest model: drop the crumb into the colony stock and head back out
  if (A.carry[i]) { addStock(col, A.carry[i], 1); AL.emit(world, 'foodDelivered', { col: col.id, kind: A.carry[i], amt: 1 }); A.carry[i] = 0; }
  A.state[i] = ST.WANDER; A.timer[i] = 0; A.a[i] += Math.PI;
  const o = AL.Orders && AL.Orders.collectOf && AL.Orders.collectOf(world, i);   // on a Collect order: straight back out for the next load
  if (o) { A.state[i] = ST.COLLECT; A.str[i] = o.id; A.tgt[i] = -1; }
}
function addStock(col, kind, amt) {
  if (kind === AL.CARRY.APHID) { if (AL.Aphids) AL.Aphids.arrive(col); return; }   // a live aphid for the root-aphid chamber
  const key = AL.RES[kind]; if (!key) return;
  col.stock[key] += amt; col.stats.foodIn += amt;
}
// dest: a satellite home with its own nest and store it was dragged to (behavior.js dragHome); else the capital
// a real nest's door (ai.js, ai-nest.js, expansion.js): enemies arriving there go down and fight in its tunnels.
// One shared, named function rather than a closure per colony, so a world snapshot can name it (snap.js)
function siegeInHere(w, i) { AL.Orders.breakIn(w, i, this); }
siegeInHere._snap = 'sim.siegeIn';
function deliverBig(world, ci, f, dest) {
  const col = dest && dest.stock && dest.id === ci ? dest : world.colonies[ci], A = world.ants;
  if (world.storeBig) world.storeBig(world, col, f); else addStock(col, f.kind, Math.floor(f.amount));
  f.amount = 0; f.gone = true; world.surface.foodDirty = true;
  // let go
  for (let i = 0; i < A.high; i++) if (A.state[i] === ST.DRAG && A.tgt[i] === f.id) { A.tgt[i] = -1; A.state[i] = ST.HOMING; }
  f.carriers = 0; f.pull.fill(0);
  AL.emit(world, 'bigFood', { col: ci, hid: col.hid != null ? col.hid : ci, x: f.x, y: f.y, kind: f.kind, food: f });
}

// In the browser (AL.SAFE, set by main.js) one system throwing must not freeze the whole game: the error is
// reported once (AL.reportError shows it on screen) and the rest of the tick still runs. Tests run unguarded.
function guarded(world, s, k, DT) {
  if (!AL.SAFE) { s[k](world, DT); return; }
  try { s[k](world, DT); } catch (e) { if (AL.reportError) AL.reportError(e, 'sim ' + (s.id || '?') + '.' + k, world); else throw e; }
}
const CORE = [
  { id: 'behavior', tick: w => AL.Behavior.updateSurface(w) },
  { id: 'carcasses', tick: (w, dt) => AL.Behavior.updateCarcasses(w, dt) },
];
// one fixed simulation tick
function step(world) {
  if (world.over && world.over.frozen) return;
  const DT = T.DT;
  world.tick++; world.t += DT;
  for (const s of world.systems) if (s.pre) guarded(world, s, 'pre', DT);
  for (const s of CORE) guarded(world, s, 'tick', DT);
  for (const s of world.systems) if (s.tick) guarded(world, s, 'tick', DT);
  for (const s of world.systems) if (s.post) guarded(world, s, 'post', DT);
  // pheromones evaporate/diffuse every 4 ticks (staggered so not all on one tick)
  const pl = world.pherList;
  for (let k = 0; k < pl.length; k++) if (((world.tick + k) & 3) === 0) pl[k].update(DT * 4);
  if (world.tick % 15 === 0) { AL.Surface.updatePois(world, DT * 15); cutSpentTrails(world); }
  if (world.tick % 30 === 0) {
    for (const s of world.systems) if (s.second) guarded(world, s, 'second', 1);
    countPop(world);
    if (!world.over) for (const chk of AL.WIN_CHECKS) { const r = chk(world); if (r) { endGame(world, r.winner, r.reason); break; } }
  }
}

// once a food source runs out, wipe the trail ends around it so followers stop finding a scent there
function cutSpentTrails(world) {
  const foods = world.surface.foods, fp = world.pher.food;
  for (let k = 0; k < foods.length; k++) {
    const f = foods[k];
    if (f.trailCut || !(f.gone || (f.amount < 1 && !f.regen && !AL.Surface.renews(f)))) continue;
    f.trailCut = true;
    for (let c = 0; c < fp.length; c++) fp[c].erase(f.x, f.y, (f.r || 6) + 48);
  }
}

// the home (colony or satellite) an ant belongs to: the nest it is in, else the one it lives in
function homeOf(world, i) {
  const A = world.ants, H = world.homes, col = A.col[i];
  if (!H || H.length === world.colonies.length) return world.colonies[col];
  const h = H[A.layer[i] === AL.LAYER.NEST ? A.nest[i] : A.home[i]];
  return h && h.id === col ? h : world.colonies[col];
}
AL.homeOf = homeOf;
// an ant on the NEST layer is in one of its own colony's nests (not raiding someone else's)
AL.inOwnNest = (world, i) => { const A = world.ants, h = (world.homes || world.colonies)[A.nest[i]]; return !!h && h.id === A.col[i]; };
function countPop(world) {
  const A = world.ants, H = world.homes, NC = world.colonies.length;
  for (const c of world.colonies) { c.pop.fill(0); c.surf = 0; c.inNest = 0; c.popAll = 0; }
  for (let k = NC; H && k < H.length; k++) if (H[k]) { H[k].pop.fill(0); H[k].surf = 0; H[k].inNest = 0; }
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i]) continue;
    const col = A.col[i], c = world.colonies[col], h = A.home[i];
    // an ant counts for the nest it lives in (a satellite's own ants for the satellite); popAll is the whole colony
    const at = h >= NC && H[h] && H[h].id === col ? H[h] : c;
    at.pop[A.caste[i]]++; c.popAll++;
    if (A.layer[i] === 0) at.surf++; else at.inNest++;
  }
  for (const c of world.colonies) if (c.inside) for (let k = 0; k < AL.NCASTE; k++) { const n = Math.round(c.inside[k]); c.pop[k] += n; c.popAll += n; }
  // automatic sim LOD once the surface gets crowded
  if (world.autoLod) world.lod = A.count > 2500;
  // The LOD updates ants away from the view every other tick. In single player that's the camera (render.js sets
  // world.view); in multiplayer every PC has its own camera, so the sim uses a view that's the same on every PC: the
  // area round every person's nests (else the PCs' backyards drift apart once the LOD kicks in)
  if (world.mp) world.mpView = mpView(world);
}

// multiplayer LOD view: the box round every person's capital and satellites, plus a margin
function mpView(world) {
  const M = 900, H = world.mp.humans | 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const h of world.homes || world.colonies) {
    if (!h || h.gone || h.id >= H || h.alive === false) continue;
    x0 = Math.min(x0, h.x - M); y0 = Math.min(y0, h.y - M); x1 = Math.max(x1, h.x + M); y1 = Math.max(y1, h.y + M);
  }
  return x0 <= x1 ? { x0, y0, x1, y1 } : { x0: 0, y0: 0, x1: 1e9, y1: 1e9 };
}
// game over: winner colony id (or -1 for nobody), reason text. First call wins.
function endGame(world, winner, reason) {
  if (world.over) return;
  world.over = { winner, win: winner === world.me, reason, t: world.t };
  AL.emit(world, 'gameOver', world.over);
}
// rain: wash trails away everywhere except under shelters (f = fraction kept, e.g. 0.97 per call)
function washTrails(world, f) {
  const sh = world.surface.shelter;
  for (const g of world.pherList) {
    if (g.x1 < 0) continue;
    const d = g.data, w = g.w;
    for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) { const i = y * w + x; if (!sh[i]) d[i] *= f; }
  }
}
// visit live ants on a layer near a point (uses the spatial hash for the surface)
function antsNear(world, x, y, r, fn, layer) {
  const A = world.ants, r2 = r * r;
  if (!layer && r <= world.hash.cell) {
    world.hash.each(x, y, j => { if (A.state[j] && A.layer[j] === 0 && AL.dist2(A.x[j], A.y[j], x, y) <= r2) return fn(j); });
    return;
  }
  for (let j = 0; j < A.high; j++) if (A.state[j] && A.layer[j] === (layer || 0) && AL.dist2(A.x[j], A.y[j], x, y) <= r2) if (fn(j)) return;
}

AL.Sim = { siegeInHere, createWorld, step, addStock, countPop, endGame, antsNear, washTrails, spawnBench, ALL: { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 } };
// extra win/lose rules: fn(world) -> { winner, reason } | null, checked once per second
AL.WIN_CHECKS = AL.WIN_CHECKS || [];
if (NODE) module.exports = AL.Sim;
})(typeof window !== 'undefined' ? window : globalThis);
