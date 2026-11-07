// Biomes, map sizes and terrain.
//  - AL.MAP_SIZES: small / medium / large yards (the fair map scales its nest ring to fit).
//  - AL.BIOMES: Backyard (the original: lawn, people, the picnic), Forest floor (leaf litter under trees, more
//    spiders and beetles), Desert (sand and gravel, little rain, hot), Wetland (mud, puddles, streams, floods).
//    Each changes the terrain mix, the weather, the creatures, what's lying about, and gives a few species a small
//    edge (folded into the colony's research mods, research.js).
//  - Terrain, one type per pheromone cell (S.terrain): grass, sand, gravel, mud, leaf litter, stream (water: ants
//    can't cross it) and twig bridges over streams. It changes walking speed (S.tspeed, read per ant in
//    behavior.js), how fast trails fade (sand and gravel don't hold scent), how much small prey the leaf litter
//    holds (eco.js, swarm.js), and how badly a nest floods (mud).
//  - Fair: on the fair map the terrain is drawn with the same symmetry as the colonies (a kaleidoscope round the
//    map centre), so every colony's sector gets the same ground.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');

const T = AL.TERRAIN = { GRASS: 0, SAND: 1, GRAVEL: 2, MUD: 3, LITTER: 4, STREAM: 5, BRIDGE: 6 };
// speed: walking speed x; fade: trail kept per second (1 = normal); prey: small prey in the litter x
const INFO = AL.TERRAIN_INFO = [
  { key: 'grass',  name: 'Grass',       speed: 1.0,  fade: 1,     prey: 1.0,  col: '#5b8a3b', tip: 'Ordinary ground.' },
  { key: 'sand',   name: 'Sand',        speed: 1.08, fade: 0.965, prey: 0.35, col: '#d8c08a', tip: 'Fast walking, but scent trails fade quickly and it burns in a heat wave. Little to hunt.' },
  { key: 'gravel', name: 'Gravel',      speed: 1.12, fade: 0.965, prey: 0.3,  col: '#a39a8a', tip: 'Fast, firm footing; trails fade quickly; almost nothing lives in it.' },
  { key: 'mud',    name: 'Mud',         speed: 0.72, fade: 1,     prey: 1.2,  col: '#6b5236', tip: 'Slow going. Nests on mud flood first when it rains.' },
  { key: 'litter', name: 'Leaf litter', speed: 0.85, fade: 1,     prey: 1.8,  col: '#7a5a2e', tip: 'Cluttered and slow, but full of small prey for hunters and army ant swarms.' },
  { key: 'stream', name: 'Stream',      speed: 1 / 3, fade: 0,    prey: 0,    col: '#4a86b8', tip: 'Running water: ants swim it at a third of their walking speed, or cross on a living ant bridge (the Bridge tool).' },
  { key: 'bridge', name: 'Twig bridge', speed: 0.8,  fade: 1,     prey: 0,    col: '#8a6a3e', tip: 'A twig across the stream.' },
];

AL.MAP_SIZES = {
  small:  { key: 'small',  name: 'Small',  W: 3000, H: 2250, best: '2-3 colonies' },
  medium: { key: 'medium', name: 'Medium', W: 4000, H: 3000, best: '3-5 colonies' },
  large:  { key: 'large',  name: 'Large',  W: 5200, H: 3900, best: '5-8 colonies' },
};
// a terrain picker per biome: a, b, c are smooth noise fields (0..1) at this spot, r its distance from the map centre
const BIOMES = AL.BIOMES = {
  backyard: {
    key: 'backyard', name: 'Backyard', blurb: 'The lawn behind the house: people walk through, the mower comes round, and there\'s a picnic in the middle.',
    humans: true, centre: 'spill', ground: '#5b8a3b',
    pick: (a, b, c) => (b > 0.68 ? T.SAND : a < 0.36 ? T.MUD : a > 0.66 ? T.LITTER : c > 0.72 ? T.GRAVEL : T.GRASS),
    weather: { rain: 1, heat: 1, temp: 0 }, flood: 1, streams: 0.5,
    terrain: ['grass', 'sand', 'gravel', 'mud', 'litter', 'stream'],
  },
  forest: {
    key: 'forest', name: 'Forest floor', blurb: 'Deep leaf litter under the trees: shady, slow going, and crawling with prey. More spiders and beetles.',
    humans: false, centre: 'nest', ground: '#4f5a2a', trees: 3, logs: 2,
    pick: (a, b, c) => (a < 0.36 ? T.MUD : b > 0.64 ? T.GRASS : c > 0.75 ? T.GRAVEL : T.LITTER),
    weather: { rain: 1.2, heat: 0.4, temp: -3 }, flood: 1, streams: 0.6,
    creatures: { spider: 1.5, beetle: 1.5, ladybug: 0.8 },
    edge: { army: { lay: 1.08 }, bullet: { hp: { all: 1.08 } }, carpenter: { dig: 1.25, life: 1.05 } },
    terrain: ['litter', 'grass', 'mud', 'gravel', 'stream'],
  },
  desert: {
    key: 'desert', name: 'Desert', blurb: 'Sand and gravel under a hard sun. Little rain, few plants, lots of seed.',
    humans: false, centre: 'cactus', ground: '#c9ad74', noAphids: 0.5, noClover: 0.6, seeds: 2, puddles: 0.4,
    pick: (a, b, c) => (b > 0.6 ? T.GRAVEL : a < 0.34 ? T.GRASS : T.SAND),
    weather: { rain: 0.3, heat: 2.2, temp: 7 }, flood: 0.6,
    creatures: { ladybug: 0.4, caterpillar: 0.5 },
    edge: { honeypot: { lay: 1.1, appetite: 0.92 }, harvester: { lay: 1.08, speed: 1.05 }, leafcutter: { fungus: 0.85 } },
    terrain: ['sand', 'gravel', 'grass'],
  },
  wetland: {
    key: 'wetland', name: 'Wetland', blurb: 'Mud, puddles and slow streams. It rains a lot and nests flood. Carpenter ants and fire ants cope best.',
    humans: false, centre: 'frog', ground: '#4b6a3a', puddles: 2.5, clover: 1.5,
    pick: (a, b, c) => (a < 0.47 ? T.MUD : b > 0.66 ? T.LITTER : c > 0.76 ? T.SAND : T.GRASS),
    weather: { rain: 1.8, heat: 0.6, temp: -1 }, flood: 1.4, streams: 1, waterTable: -8,
    creatures: { caterpillar: 1.3, ladybug: 1.2 },
    edge: { carpenter: { hp: { all: 1.08 }, life: 1.08 }, fire: { lay: 1.05 }, leafcutter: { fungus: 1.08 } },
    terrain: ['mud', 'grass', 'litter', 'sand', 'stream'],
  },
};
AL.BIOME_ORDER = ['backyard', 'forest', 'desert', 'wetland'];
const biomeOf = world => BIOMES[(world && world.biomeKey) || 'backyard'] || BIOMES.backyard;

// ---- the terrain grid --------------------------------------------------------------------------------
// symmetric coordinates: fold (x, y) round the centre into one wedge of a kaleidoscope with the colonies' symmetry
function folder(world) {
  const S = world.surface, L = world.layout, cx = S.W / 2, cy = S.H / 2;
  // (a fair map folds round its planned nests: under a flight's nests the ground stays the one the flight showed)
  const nests = (L && L.fair && L.nests) || S.nestSites || [], n = L && L.fair ? nests.length : 0;
  if (n < 2) return (x, y) => [x - cx, y - cy];
  const t0 = AL.atan2(nests[0].y - cy, nests[0].x - cx), w = AL.TAU / n, half = w / 2;
  return (x, y) => {
    const dx = x - cx, dy = y - cy, r = AL.hypot(dx, dy);
    let f = ((AL.atan2(dy, dx) - t0) % w + w) % w; if (f > half) f = w - f;   // mirror at the wedge's edges: no seams
    return [r * AL.cos(f), r * AL.sin(f)];
  };
}
const STREAM_W = 0.022;   // half-width of a stream's noise band (about 3 cells across)
function generate(world) {
  const S = world.surface, B = biomeOf(world), seed = world.seed | 0, gw = S.gw, gh = S.gh, cell = S.cell;
  const ter = S.terrain = new Uint8Array(gw * gh), fold = folder(world);
  const flat = !!(world.opts && world.opts.flatGround);   // (all grass: tests of plain movement and fights)
  const pois = S.pois.filter(p => !p.gone), nests = S.nestSites || [];
  const nearAny = (x, y, list, r) => { for (const p of list) if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < r * r) return true; return false; };
  const keepClear = (x, y) => nearAny(x, y, nests, 330) || nearAny(x, y, pois, 110) || (AL.sq(x - S.W / 2) + AL.sq(y - S.H / 2) < 260 * 260);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const x = (gx + 0.5) * cell, y = (gy + 0.5) * cell, i = gy * gw + gx;
    if (S.blocked[i]) { ter[i] = T.GRASS; continue; }
    const [u, v] = fold(x, y);
    const a = AL.fbm(u / 620 + 7.3, v / 620 + 1.9, seed + 101, 3), b = AL.fbm(u / 380 + 3.1, v / 380 - 2.2, seed + 202, 3), c = AL.fbm(u / 240 - 5.5, v / 240 + 4.4, seed + 303, 2);
    let t = flat ? T.GRASS : B.pick(a, b, c);
    // round each nest the ground is worn to plain earth/grass: nobody starts on a swamp or a sand dune
    if (nearAny(x, y, nests, 120)) t = T.GRASS;
    // streams: a thin meandering band of a large-scale noise field, kept off nests, food and the middle; twig bridges
    // where another field is high
    if (B.streams && !flat) {
      const s = AL.fbm(u / 980 - 1.7, v / 980 + 6.1, seed + 404, 3);
      if (Math.abs(s - 0.5) < STREAM_W * B.streams && !keepClear(x, y)) t = T.STREAM;   // (swimmable: no twig bridges, ants build living ones)
    }
    ter[i] = t;
  }
  if (!flat) connect(S, nests.length ? nests : [{ x: S.W / 2, y: S.H / 2 }], pois);
  S.biome = B.key;
  finish(S);
}
// per-cell walking speed and trail keep, read every tick and every second
function finish(S) {
  const ter = S.terrain, gw = S.gw, gh = S.gh;
  S.tspeed = new Float32Array(gw * gh); S.tfade = [];
  for (let i = 0; i < ter.length; i++) { const f = INFO[ter[i]]; S.tspeed[i] = f.speed; if (f.fade < 1 && f.fade > 0) S.tfade.push(i); }
  S.tfadeK = INFO[T.SAND].fade;
  S.terrainCounts = INFO.map((_, k) => 0); for (const t of ter) S.terrainCounts[t]++;
}
// every bit of open ground must be reachable from the nests: little pockets cut off by streams fill in as water,
// bigger ones (or any with food or a creature's home in them) get a twig bridge over the shortest crossing
function connect(S, starts, pois) {
  const gw = S.gw, gh = S.gh, n = gw * gh, ter = S.terrain, blk = S.blocked, cell = S.cell;
  const cellOf = (x, y) => Math.max(0, Math.min(gh - 1, (y / cell) | 0)) * gw + Math.max(0, Math.min(gw - 1, (x / cell) | 0));
  const want = new Uint8Array(n); for (const p of pois) want[cellOf(p.x, p.y)] = 1; for (const f of S.foods || []) want[cellOf(f.x, f.y)] = 1; for (const s0 of starts) want[cellOf(s0.x, s0.y)] = 1;
  const seen = new Uint8Array(n), comp = new Int32Array(n), q = new Int32Array(n), par = new Int32Array(n);
  const nb = (i, f) => { const gx = i % gw, gy = (i / gw) | 0; if (gx > 0) f(i - 1); if (gx < gw - 1) f(i + 1); if (gy > 0) f(i - gw); if (gy < gh - 1) f(i + gw); };
  for (let pass = 0; pass < 60; pass++) {
    seen.fill(0); let h = 0, t = 0;
    { const i = cellOf(starts[0].x, starts[0].y); seen[i] = 1; q[t++] = i; }   // (from one nest: the others must be reachable from it)
    while (h < t) { const i = q[h++]; nb(i, j => { if (!seen[j] && !blk[j]) { seen[j] = 1; q[t++] = j; } }); }
    // the cut-off pockets (open, not reached): tiny empty ones become water
    let left = 0; comp.fill(-1);
    for (let i0 = 0; i0 < n; i0++) {
      if (seen[i0] || blk[i0] || comp[i0] >= 0) continue;
      let ch = 0, ct = 0, has = 0; q[ct++] = i0; comp[i0] = i0;
      while (ch < ct) { const i = q[ch++]; if (want[i]) has = 1; nb(i, j => { if (comp[j] < 0 && !blk[j] && !seen[j]) { comp[j] = i0; q[ct++] = j; } }); }
      if (!has && ct < 25) { for (let k = 0; k < ct; k++) { ter[q[k]] = T.STREAM; blk[q[k]] = 1; } } else left++;
    }
    if (!left) return;
    // the shortest way over the water from the reached ground to any pocket: those stream cells become a bridge
    h = 0; t = 0; par.fill(-1);
    for (let i = 0; i < n; i++) if (seen[i]) q[t++] = i;
    let hit = -1;
    while (h < t && hit < 0) { const i = q[h++]; nb(i, j => { if (hit >= 0 || seen[j]) return; if (ter[j] === T.STREAM) { seen[j] = 1; par[j] = i; q[t++] = j; } else if (!blk[j]) { hit = i; } }); }
    if (hit < 0) return;
    for (let i = hit; i >= 0 && ter[i] === T.STREAM; i = par[i]) {
      // two cells wide, so the crossing is easy to see and to walk
      for (const j of [i, (i % gw) < gw - 1 ? i + 1 : i - 1]) if (ter[j] === T.STREAM) { ter[j] = T.BRIDGE; blk[j] = 0; }
    }
  }
}
const at = (S, x, y) => { if (!S.terrain) return T.GRASS; const c = S.cell; const gx = (x / c) | 0, gy = (y / c) | 0; return gx < 0 || gy < 0 || gx >= S.gw || gy >= S.gh ? T.GRASS : S.terrain[gy * S.gw + gx]; };
// share of mud round a spot (a nest floods more on mud)
function mudShare(S, x, y, r) {
  if (!S.terrain) return 0;
  let n = 0, m = 0;
  for (let dy = -r; dy <= r; dy += S.cell) for (let dx = -r; dx <= r; dx += S.cell) { if (dx * dx + dy * dy > r * r) continue; n++; if (at(S, x + dx, y + dy) === T.MUD) m++; }
  return n ? m / n : 0;
}
// prey in the leaf litter by terrain (swarm.js's litter grid samples this)
function preyMul(S, x, y) { return INFO[at(S, x, y)].prey; }

// ---- once a second: sand and gravel don't hold scent; sand bakes in a heat wave ---------------------------
function second(world) {
  const S = world.surface; if (!S.terrain) return;
  const k = S.tfadeK, list = S.tfade;
  if (list.length) for (const grids of [world.pher.food, world.pher.alarm]) for (const g of grids) { const d = g.data; for (let j = 0; j < list.length; j++) { const c = list[j]; if (d[c] > 0) d[c] *= k; } }
  // hot sand: in a heat wave the sand bonus turns into a slog (and back when it cools)
  const hot = (world.env.heat || 0) > 0.5, want = hot ? 0.85 : INFO[T.SAND].speed;
  if (S._sandSpeed !== want) { S._sandSpeed = want; for (let i = 0; i < S.terrain.length; i++) if (S.terrain[i] === T.SAND) S.tspeed[i] = want; }
}

AL.registerSystem({
  id: 'terrain', order: 1.5,
  enabled: opts => opts.world !== false && !opts.benchOnly,
  init(world) { generate(world); },
  second,
});
// after the nests exist (life.js, order 2): mud round a nest floods it more (nest.js reads col.floodMul); wetland
// water tables are shallow
// after the yard's things are placed (world-poi.js, order 11: trees, logs, rocks block ground too): check again that
// nothing is cut off, and bridge it if it is
AL.registerSystem({
  id: 'terrain-connect', order: 11.5,
  enabled: opts => opts.world !== false && !opts.benchOnly,
  init(world) {
    const S = world.surface; if (!S.terrain || (world.opts && world.opts.flatGround)) return;
    const starts = world.colonies.map(c => ({ x: c.x, y: c.y }));
    connect(S, starts.length ? starts : [{ x: S.W / 2, y: S.H / 2 }], S.pois.filter(p => !p.gone));
    finish(S);
  },
});
AL.registerSystem({
  id: 'terrain-nests', order: 2.1,
  enabled: opts => opts.world !== false && !opts.benchOnly,
  init(world) {
    const B = biomeOf(world);
    for (const c of world.colonies) {
      c.floodMul = (B.flood || 1) * (1 + 1.2 * mudShare(world.surface, c.x, c.y, 150));
      if (c.nest && B.waterTable) c.nest.waterTable = Math.max(20, c.nest.waterTable + B.waterTable);
    }
  },
});
AL.Terrain = { STREAM_W, T, INFO, BIOMES, generate, at, mudShare, preyMul, biomeOf, folder };
if (NODE) module.exports = AL.Terrain;
})(typeof window !== 'undefined' ? window : globalThis);
