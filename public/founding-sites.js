// Antlands founding sites: the 8 places a new queen can start a colony.
// - AL.SITES: pure data (pros, cons, numeric modifiers, nest soil variant) the colony sim reads
// - AL.Sites.place(): puts up to 8 sites on the backyard map, spread out and anchored to scenery
// - AL.Sites.modsFor(): site modifiers adjusted for a species (carpenters love wood, ...)
// - AL.Sites.buildSoil(): starting side-view soil grid variant for the nest generator
// - AL.Sites.drawDecor()/drawMarker(): code-drawn map art (browser only, never called in Node)
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
// in the lead's public/ folder al.js sits next to this file; standalone it lives in the lead's tree
const AL = NODE ? (() => { try { return require('./al.js'); } catch (_) { return require('../../_core/public/al.js'); } })() : root.AL;
const TAU = Math.PI * 2;

// ---- nest soil tiles (the founding stage's own enum; the nest module can map these) ---------
// dig: time multiplier to dig one tile (1 = topsoil, 0 = can't dig); hold: how well a tunnel
// in it stays up (1 = never caves, 0 = always); wet: how much water it soaks up from rain.
const TILE = { AIR: 0, TOPSOIL: 1, CLAY: 2, GRAVEL: 3, ROCK: 4, ROOT: 5, WATER: 6, SAND: 7, WOOD: 8, MULCH: 9, SLAB: 10, HUMUS: 11, GALLERY: 12 };
const TILE_INFO = [
  /* AIR     */ { key: 'air',     name: 'Open',          dig: 0,    hold: 1,    wet: 0,   col: '#1a120b' },
  /* TOPSOIL */ { key: 'topsoil', name: 'Topsoil',       dig: 1,    hold: 0.85, wet: 0.5, col: '#5a3d26' },
  /* CLAY    */ { key: 'clay',    name: 'Clay',          dig: 1.7,  hold: 1,    wet: 0.2, col: '#7a4f33' },
  /* GRAVEL  */ { key: 'gravel',  name: 'Gravel',        dig: 2.4,  hold: 0.7,  wet: 0.8, col: '#6e655a' },
  /* ROCK    */ { key: 'rock',    name: 'Rock',          dig: 0,    hold: 1,    wet: 0,   col: '#8a857a' },
  /* ROOT    */ { key: 'root',    name: 'Root',          dig: 0,    hold: 1,    wet: 0.1, col: '#6b4a2e' },
  /* WATER   */ { key: 'water',   name: 'Water table',   dig: 0,    hold: 1,    wet: 1,   col: '#2f5f74' },
  /* SAND    */ { key: 'sand',    name: 'Sand',          dig: 0.45, hold: 0.35, wet: 0.9, col: '#b89466' },
  /* WOOD    */ { key: 'wood',    name: 'Rotting wood',  dig: 0.6,  hold: 1,    wet: 0.7, col: '#7d5a36' },
  /* MULCH   */ { key: 'mulch',   name: 'Mulch',         dig: 0.6,  hold: 0.6,  wet: 0.6, col: '#3f2a1a' },
  /* SLAB    */ { key: 'slab',    name: 'Concrete',      dig: 0,    hold: 1,    wet: 0,   col: '#a7a194' },
  /* HUMUS   */ { key: 'humus',   name: 'Humus',         dig: 0.8,  hold: 0.8,  wet: 0.6, col: '#3b2718' },
  /* GALLERY */ { key: 'gallery', name: 'Beetle gallery', dig: 0,   hold: 1,    wet: 0.3, col: '#24170d' },
];

// ---- the 8 sites ---------------------------------------------------------------------------
// Modifier meanings (1 = an ordinary patch of lawn soil):
//   dig        multiplier on digging speed (2 = twice as fast)
//   caveIn     chance per in-game day that one unsupported tunnel tile collapses (lawn 0.02)
//   flood      share of rain that seeps into the nest; 0..1 (lawn 0.25)
//   food       multiplier on food density within FOOD_RADIUS of the entrance
//   warmth     multiplier on brood development speed (egg/larva/pupa timers divide by it)
//   defence    multiplier on defenders' damage and toughness at the entrance / in the nest
//   chamberMax largest single chamber, in nest tiles (lawn 40)
//   visibility multiplier on how far away rivals and predators notice the colony (lawn 1)
//   hazard     multiplier on random surface hazards near the nest per day (lawn 1)
//   entrances  how many entrances the nest can open (natural gaps)
const FOOD_RADIUS = 520;
const BASE = { dig: 1, caveIn: 0.02, flood: 0.25, food: 1, warmth: 1, defence: 1, chamberMax: 40, visibility: 1, hazard: 1, entrances: 3 };

const P = (tag, text) => ({ tag, text });
const SITES = {
  rock: {
    id: 'rock', name: 'Under a rock', glyph: 'R', colour: '#b9b2a3',
    blurb: 'A flat stone keeps the nest dry, warm and hidden. Digging around it is slow work.',
    pros: [P('Hidden', 'Rivals and birds rarely find it'), P('Sheltered', 'The stone roof never caves in or floods'), P('Warm', 'Sun-warmed stone speeds up brood a little')],
    cons: [P('Hard soil', 'Packed earth: slow digging'), P('Cramped', 'The rock caps how wide the nest can grow')],
    mods: { dig: 0.6, caveIn: 0.004, flood: 0.08, food: 0.9, warmth: 1.1, defence: 1.6, chamberMax: 32, visibility: 0.35, hazard: 0.4, entrances: 2 },
    soil: { kind: 'rock', base: TILE.CLAY, ceiling: 'rock', water: 0.9, note: 'A stone slab forms the roof beside the entrance; packed clay below.' },
  },
  log: {
    id: 'log', name: 'Rotting log', glyph: 'L', colour: '#9a7650',
    blurb: 'Soft, damp wood full of grubs. Fast to tunnel, food on the doorstep, but it soaks up rain.',
    pros: [P('Soft wood', 'Fast digging; carpenter ants twice as fast'), P('Grubs', 'Grubs and springtails nearby: early protein')],
    cons: [P('Floods', 'Soaks up rain: shallow chambers flood'), P('Damp', 'Cool and wet: brood grows a little slower')],
    mods: { dig: 1.6, caveIn: 0.01, flood: 0.75, food: 1.5, warmth: 0.9, defence: 1.15, chamberMax: 44, visibility: 0.7, hazard: 0.9, entrances: 3 },
    soil: { kind: 'log', base: TILE.HUMUS, ceiling: 'wood', water: 0.62, note: 'The sunken log fills the top rows (wood grain); wet humus and a high water table below.' },
  },
  sand: {
    id: 'sand', name: 'Sandy bank', glyph: 'S', colour: '#d8b47a',
    blurb: 'Loose, sun-warmed sand by the water. The fastest digging in the yard, if the walls hold.',
    pros: [P('Fast dig', 'The fastest digging anywhere'), P('Water', 'A puddle right next door')],
    cons: [P('Collapses', 'Tunnels cave in often'), P('Small rooms', 'Chambers must stay small to stay up')],
    mods: { dig: 2.2, caveIn: 0.09, flood: 0.35, food: 0.85, warmth: 1.15, defence: 0.85, chamberMax: 26, visibility: 1.05, hazard: 1, entrances: 4 },
    soil: { kind: 'sand', base: TILE.SAND, ceiling: null, water: 0.8, note: 'Deep sand with thin gravel lenses; a clay floor near the water table.' },
  },
  garden: {
    id: 'garden', name: 'Garden bed', glyph: 'G', colour: '#6aa646',
    blurb: 'Rich mulch, aphids on every stem, seeds and leaves for the taking. The gardener visits often.',
    pros: [P('Rich food', 'Aphids, seeds and leaves: the most food in the yard'), P('Soft mulch', 'Easy digging')],
    cons: [P('Gardener', 'Raking, watering and trowels: frequent hazards'), P('Busy', 'Other bugs come for the same food')],
    mods: { dig: 1.3, caveIn: 0.03, flood: 0.4, food: 2.2, warmth: 1, defence: 0.9, chamberMax: 40, visibility: 1.2, hazard: 2.6, entrances: 3 },
    soil: { kind: 'garden', base: TILE.HUMUS, ceiling: null, water: 0.85, note: 'A thick mulch layer over rich humus, with small plant roots.' },
  },
  roots: {
    id: 'roots', name: 'Root tangle', glyph: 'T', colour: '#7b5a3a',
    blurb: 'Between the roots at the foot of the apple tree. Easy to hold, hard to spread out.',
    pros: [P('Fortress', 'Roots wall off narrow tunnels: easy to defend'), P('Braced', 'Roots hold the tunnels: no collapses'), P('Apples', 'Fallen fruit under the tree')],
    cons: [P('Cramped', 'Small chambers between the roots'), P('Cool', 'Deep shade slows brood a little')],
    mods: { dig: 0.85, caveIn: 0.003, flood: 0.2, food: 1.15, warmth: 0.95, defence: 1.8, chamberMax: 18, visibility: 0.6, hazard: 0.8, entrances: 2 },
    soil: { kind: 'roots', base: TILE.TOPSOIL, ceiling: null, water: 0.88, note: 'Thick undiggable roots weave through the top rows and pinch chambers small.' },
  },
  crack: {
    id: 'crack', name: 'Pavement crack', glyph: 'P', colour: '#b2ab9c',
    blurb: 'A gap between patio slabs. Hot stone above makes brood grow fast, but the patio is a food desert.',
    pros: [P('Hot', 'Warm all day: the fastest brood'), P('Slab roof', 'One slit entrance that is hard to raid')],
    cons: [P('Food desert', 'Almost no food nearby'), P('Narrow', 'Little room to grow sideways')],
    mods: { dig: 0.75, caveIn: 0.015, flood: 0.08, food: 0.25, warmth: 1.55, defence: 1.35, chamberMax: 26, visibility: 0.8, hazard: 1.2, entrances: 1 },
    soil: { kind: 'crack', base: TILE.SAND, ceiling: 'slab', water: 0.92, note: 'Two rows of concrete with a crack, a gravel bed, then bedding sand.' },
  },
  stump: {
    id: 'stump', name: 'Old tree stump', glyph: 'O', colour: '#8a6a44',
    blurb: 'A huge hollowing stump with room for an empire. Beetles already live in it.',
    pros: [P('Huge', 'The biggest chambers; old beetle galleries are ready-made tunnels'), P('High ground', 'Hardly ever floods'), P('Wood mass', 'Carpenter ants dig twice as fast')],
    cons: [P('Beetles', 'Bark beetles live here and fight back'), P('Exposed', 'Easy to spot from across the yard')],
    mods: { dig: 1.2, caveIn: 0.006, flood: 0.06, food: 1, warmth: 1, defence: 1.2, chamberMax: 90, visibility: 1.3, hazard: 1, entrances: 4 },
    soil: { kind: 'stump', base: TILE.TOPSOIL, ceiling: 'wood', water: 0.9, note: 'A wide wooden core with old beetle galleries, roots spreading out below.' },
    residents: { kind: 'beetle', count: 3, hp: 40, dps: 3, note: 'Bark beetles in the galleries; they fight ants that dig into them.' },
  },
  meadow: {
    id: 'meadow', name: 'Open meadow', glyph: 'M', colour: '#9fc06a',
    blurb: 'Plain lawn in the middle of the yard: close to everything, hidden from nothing.',
    pros: [P('Central', 'Short trips to most food and key points'), P('Room', 'Space to expand in every direction')],
    cons: [P('No cover', 'Rivals and birds see it from far away'), P('Weather', 'Sun-baked or soaked, by turns')],
    mods: { dig: 1, caveIn: 0.02, flood: 0.3, food: 1.25, warmth: 1.05, defence: 0.75, chamberMax: 48, visibility: 1.7, hazard: 1.1, entrances: 4 },
    soil: { kind: 'meadow', base: TILE.TOPSOIL, ceiling: null, water: 0.88, note: 'Classic layers: grass roots in topsoil, clay, gravel, the water table.' },
  },
};
const ORDER = ['rock', 'log', 'sand', 'garden', 'roots', 'crack', 'stump', 'meadow'];
for (const k of ORDER) SITES[k].mods = Object.assign({}, BASE, SITES[k].mods);
AL.SITES = SITES;
AL.SITE_ORDER = ORDER;

// ---- species fit -----------------------------------------------------------------------------
// returns a fresh copy of the site's mods adjusted for the species
function modsFor(siteId, spKey) {
  const s = SITES[siteId]; if (!s) throw new Error('unknown site ' + siteId);
  const m = Object.assign({}, s.mods);
  const notes = [];
  if (spKey === 'carpenter' && (siteId === 'log' || siteId === 'stump')) { m.dig *= 2; m.chamberMax = Math.round(m.chamberMax * 1.2); notes.push('Carpenter ants chew through the wood twice as fast.'); }
  if (spKey === 'carpenter' && siteId === 'sand') { m.caveIn *= 1.3; notes.push('Big carpenter workers struggle in loose sand.'); }
  if (spKey === 'leafcutter' && siteId === 'garden') { m.food *= 1.15; notes.push('Endless leaves for the fungus garden.'); }
  if (spKey === 'leafcutter' && siteId === 'crack') { m.food *= 0.6; notes.push('No leaves anywhere near the patio.'); }
  if (spKey === 'fire' && (siteId === 'meadow' || siteId === 'sand')) { m.warmth *= 1.1; notes.push('Fire ants love open, sunny ground.'); }
  if (spKey === 'army') {
    // a bivouac is made of living ants, so soil barely matters; it moves on anyway
    m.dig = 1; m.caveIn = 0; m.flood *= 0.5; m.chamberMax = 999;
    notes.push('Army ants bivouac above ground: soil barely matters, cover and food do.');
  }
  m.notes = notes;
  return m;
}

// ---- placement --------------------------------------------------------------------------------
// place(S, opts): S is the lead's surface (W, H, rocks, logs, trees, patio, foods, pois, blocked)
// or any {W, H} for a bare map. Returns placed sites:
//   { id, x, y, r, rot, seed, def, mods, decor: {...}, anchor: 'what it sits on' }
// opts: { count (<=8), ids (subset), minDist, seed, clear (stamp entrances walkable) }
function place(S, opts) {
  opts = opts || {};
  const W = S.W || 4000, H = S.H || 3000;
  const R = AL.rng((opts.seed >>> 0) || 0x51735);
  const want = (opts.ids || ORDER).filter(id => SITES[id]).slice(0, Math.min(8, opts.count || 8));
  const minDist = opts.minDist || AL.hypot(W, H) * 0.13;
  const margin = 150;
  const rocks = S.rocks || [], logs = S.logs || [], trees = S.trees || [];
  const pools = (S.pois || []).filter(p => p.type === 'puddle');
  const blockedAt = (x, y) => (S.blocked && AL.Surface ? AL.Surface.isBlocked(S, x, y) : false);
  const inside = (x, y) => x > margin && y > margin && x < W - margin && y < H - margin;
  const clearAround = (x, y, rr) => { for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; if (blockedAt(x + AL.cos(a) * rr, y + AL.sin(a) * rr)) return false; } return !blockedAt(x, y); };
  const underCanopy = (x, y) => trees.some(t => AL.dist2(t.x, t.y, x, y) < (t.r * 0.8) * (t.r * 0.8));
  // open-ground search: grid of points scored by a function
  const openSpots = (box, score) => {
    const out = [];
    for (let y = box.y0; y <= box.y1; y += 60) for (let x = box.x0; x <= box.x1; x += 60) {
      if (!inside(x, y) || !clearAround(x, y, 70)) continue;
      if ((S.patio && x > S.patio.x - 60 && y > S.patio.y - 60)) continue;
      out.push({ x, y, s: score(x, y) });
    }
    return out.sort((a, b) => b.s - a.s);
  };

  // candidate positions per site, best first. Each candidate: { x, y, anchor, decor }
  const cands = {
    rock() {
      const list = rocks.slice().sort((a, b) => (b.shelter ? 1e6 : 0) + b.rx * b.ry - ((a.shelter ? 1e6 : 0) + a.rx * a.ry));
      const out = [];
      for (const r of list) for (const a of [Math.PI / 2, 0, Math.PI, -Math.PI / 2]) {
        const ang = r.rot + a, rx = r.rx, ry = r.ry;
        // a point just past the rock rim along that axis
        const ex = AL.cos(a) * (rx + 18), ey = AL.sin(a) * (ry + 18);
        out.push({ x: r.x + ex * AL.cos(r.rot) - ey * AL.sin(r.rot), y: r.y + ex * AL.sin(r.rot) + ey * AL.cos(r.rot), anchor: 'rock', decor: { rock: r, face: ang } });
      }
      if (!out.length) for (const p of fallbackRing()) out.push({ x: p.x, y: p.y, anchor: 'new rock', decor: { newRock: { rx: 70, ry: 52, rot: R() * 3 } } });
      return out;
    },
    log() {
      const out = [];
      for (const l of logs) for (const t of [0.15, -0.2, 0.35, -0.38]) for (const side of [1, -1]) {
        const ax = AL.cos(l.rot), ay = AL.sin(l.rot), nx = -ay, ny = ax, d = t * l.len;
        out.push({ x: l.x + ax * d + nx * (l.r + 16) * side, y: l.y + ay * d + ny * (l.r + 16) * side, anchor: 'log', decor: { log: l, side } });
      }
      if (!out.length) for (const p of fallbackRing()) out.push({ x: p.x, y: p.y, anchor: 'new log', decor: { newLog: { len: 300, r: 30, rot: R() * 3 } } });
      return out;
    },
    sand() {
      const out = [];
      const ps = pools.slice().sort((a, b) => a.x - b.x);
      for (const p of ps) for (const a of [Math.PI * 0.75, Math.PI * 0.25, -Math.PI * 0.75, -Math.PI * 0.25, Math.PI / 2]) {
        const d = p.baseR || p.r || 50;
        out.push({ x: p.x + AL.cos(a) * (d + 46), y: p.y + AL.sin(a) * (d * 0.8 + 46), anchor: 'puddle bank', decor: { pool: p, face: a + Math.PI } });
      }
      for (const p of fallbackRing()) out.push({ x: p.x, y: p.y, anchor: 'sand patch', decor: {} });
      return out;
    },
    garden() {
      const spots = openSpots({ x0: 0, y0: 0, x1: W * 0.45, y1: H * 0.35 }, (x, y) => -AL.hypot(x - W * 0.16, y - H * 0.14) - (underCanopy(x, y) ? 400 : 0));
      return spots.map(s => ({ x: s.x, y: s.y, anchor: 'garden bed', decor: { bed: { w: 300, h: 130, rot: -0.08 } } }));
    },
    roots() {
      const out = [];
      for (const t of trees.slice().sort((a, b) => (a.kind === 'apple' ? -1 : 1) - (b.kind === 'apple' ? -1 : 1))) for (const a of [0.9, 2.4, -0.6, -2.2]) {
        out.push({ x: t.x + AL.cos(a) * 46, y: t.y + AL.sin(a) * 46, anchor: t.kind + ' tree roots', decor: { tree: t, face: a } });
      }
      if (!out.length) for (const p of fallbackRing()) out.push({ x: p.x, y: p.y, anchor: 'root mat', decor: { tree: { x: p.x - 30, y: p.y - 30, r: 0 }, face: 0.8 } });
      return out;
    },
    crack() {
      const out = [], p = S.patio;
      if (p) {
        // far corner of the patio first: away from the picnic spill, which keeps "almost no food" honest
        const slab = 70;
        for (const [fx, fy] of [[0.8, 0.82], [0.62, 0.88], [0.86, 0.55], [0.5, 0.6]]) {
          const gx = p.x + Math.round(p.w * fx / slab) * slab, gy = p.y + p.h * fy;
          out.push({ x: gx, y: gy, anchor: 'patio', decor: { patio: p, grout: gx, vertical: true } });
        }
      } else for (const s of fallbackRing()) out.push({ x: s.x, y: s.y, anchor: 'paving slab', decor: { slabs: true } });
      return out;
    },
    stump() {
      const spots = openSpots({ x0: W * 0.55, y0: 0, x1: W, y1: H * 0.55 }, (x, y) => -AL.hypot(x - W * 0.78, y - H * 0.3) * 0.6 - (underCanopy(x, y) ? 600 : 0));
      return spots.map(s => ({ x: s.x, y: s.y, anchor: 'tree stump', decor: { stump: { r: 58, rot: R() * TAU } } }));
    },
    meadow() {
      // open lawn near the middle, as far from obstacles as possible
      const spots = openSpots({ x0: W * 0.3, y0: H * 0.3, x1: W * 0.75, y1: H * 0.8 }, (x, y) => {
        let near = 1e9;
        for (const r of rocks) near = Math.min(near, AL.hypot(r.x - x, r.y - y) - Math.max(r.rx, r.ry));
        for (const l of logs) near = Math.min(near, AL.hypot(l.x - x, l.y - y) - l.len / 2);
        return Math.min(near, 300) - AL.hypot(x - W / 2, y - H * 0.55) * 0.5 - (underCanopy(x, y) ? 800 : 0);
      });
      return spots.map(s => ({ x: s.x, y: s.y, anchor: 'lawn', decor: { tufts: 9 } }));
    },
  };
  function fallbackRing() {
    const out = [];
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU + R() * 0.2; out.push({ x: W / 2 + AL.cos(a) * W * 0.36, y: H / 2 + AL.sin(a) * H * 0.34 }); }
    return out;
  }

  // most constrained first so features get used before open-ground sites take the space
  const prio = ['crack', 'log', 'rock', 'roots', 'sand', 'stump', 'garden', 'meadow'].filter(id => want.includes(id));
  const placed = [];
  const fits = (c, d) => inside(c.x, c.y) && !blockedAt(c.x, c.y) && placed.every(p => AL.hypot(p.x - c.x, p.y - c.y) >= d);
  for (const id of prio) {
    const list = cands[id]();
    let pick = null;
    for (let relax = 1; relax >= 0.4 && !pick; relax -= 0.15) pick = list.find(c => fits(c, minDist * relax)) || null;
    if (!pick) pick = list[0] || { x: W / 2, y: H / 2, anchor: 'lawn', decor: {} };
    const def = SITES[id];
    placed.push({
      id, type: id, name: def.name, pros: def.pros, cons: def.cons, colour: def.colour,
      // rot/seed come from the position, so any seed places identical sites (flight and colony play agree)
      x: Math.round(pick.x), y: Math.round(pick.y), r: 46, rot: AL.hash2(Math.round(pick.x), Math.round(pick.y), 77) * TAU, seed: (AL.hash2(Math.round(pick.x), Math.round(pick.y), 91) * 1e6) | 0,
      anchor: pick.anchor, decor: pick.decor, def, mods: Object.assign({}, def.mods), taken: -1,
    });
  }
  placed.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  // new scenery that needs to block movement (stump, bed edges stay walkable)
  if (opts.clear !== false && S.blocked && AL.Surface) {
    for (const s of placed) {
      if (s.decor.stump) AL.Surface.stampEllipse(S, S.blocked, s.x, s.y, s.decor.stump.r * 0.8, s.decor.stump.r * 0.8, 0, 1);
      // keep the entrance itself reachable: a small ring next to the feature
      const e = entranceOf(s);
      AL.Surface.stampEllipse(S, S.blocked, e.x, e.y, 22, 22, 0, 0);
    }
  }
  S.foundingSites = placed;
  return placed;
}

// where the nest entrance sits for a placed site (the stump entrance is on its rim)
function entranceOf(s) {
  if (s.decor && s.decor.stump) { const a = s.rot; return { x: s.x + AL.cos(a) * (s.decor.stump.r + 10), y: s.y + AL.sin(a) * (s.decor.stump.r + 10) }; }
  return { x: s.x, y: s.y };
}

// adds food around sites to match their food modifier (call once after place(), before play)
// uses AL.Surface.addFood, so it only works on a real lead surface
function stockFood(S, sites, seed) {
  if (!AL.Surface || !AL.Surface.addFood) return 0;
  const R = AL.rng((seed >>> 0) || 77), K = AL.CARRY;
  let n = 0;
  for (const s of sites) {
    const extra = Math.round(Math.max(0, s.mods.food - 1) * 6);
    for (let k = 0; k < extra; k++) {
      const a = R() * TAU, d = 90 + R() * (FOOD_RADIUS * 0.7);
      const x = s.x + AL.cos(a) * d, y = s.y + AL.sin(a) * d;
      if (AL.Surface.isBlocked(S, x, y)) continue;
      const prot = s.id === 'log' ? R() < 0.75 : R() < 0.4;
      AL.Surface.addFood(S, { kind: prot ? K.PROTEIN : K.SUGAR, x, y, r: 7, amount: 6 + (R() * 8 | 0), visual: prot ? 'bug' : 'crumb', a: R() * TAU, site: s.id });
      n++;
    }
    if (s.id === 'garden') {
      // the bed's own aphid-covered plant and a seed drop
      const p = { type: 'aphids', x: s.x + 70, y: s.y - 10, r: 54, aphids: 24, maxAphids: 30, seed: R() * 100 };
      S.pois.push(p); p.src = AL.Surface.addFood(S, { kind: K.SUGAR, x: p.x, y: p.y, r: 30, amount: 30, max: 120, poi: p, visual: 'honeydew' });
      const q = { type: 'seeds', x: s.x - 90, y: s.y + 20, r: 28 };
      S.pois.push(q); q.src = AL.Surface.addFood(S, { kind: K.SEED, x: q.x, y: q.y, r: 26, amount: 70, poi: q, visual: 'seeds' });
      n += 2;
    }
  }
  if (n) S.foodDirty = true;
  return n;
}

// food score of a spot from what is actually on the map (for AI site choice and UI hints)
function nearbyFood(S, x, y) {
  let sugar = 0, protein = 0;
  for (const f of S.foods || []) {
    if (f.gone) continue;
    const d = AL.hypot(f.x - x, f.y - y); if (d > FOOD_RADIUS) continue;
    const w = 1 - d / FOOD_RADIUS;
    if (f.kind === 1 || f.kind === 3) sugar += f.amount * w; else if (f.kind === 2) protein += f.amount * w;
  }
  return { sugar, protein };
}

// a simple AI preference: safe or rich sites, species fit, not already taken
function pickForAI(sites, spKey, seed, taken) {
  const R = AL.rng((seed >>> 0) || 99);
  let best = null, bs = -1e9;
  for (const s of sites) {
    if (s.taken >= 0 || (taken && taken.includes(s.id))) continue;
    const m = modsFor(s.id, spKey);
    const sc = m.food * 1.2 + m.defence + m.dig * 0.6 + m.warmth - m.visibility * 0.6 - m.hazard * 0.25 - m.caveIn * 6 + R() * 0.5;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}

// ---- starting soil grid variant ---------------------------------------------------------------
// buildSoil(siteId, cols, rows, seed) -> { kind, site, cols, rows, tiles: Uint8Array, entrance: {c, r}, waterRow, seed }
// Sized for the lead's nest (90 x 60 tiles of 10 units, row 0 = first soil row) but works for any size:
// layers scale with the grid, features (rock slab, log, stump) keep a real-world size in tiles.
// The entrance column is where the queen starts digging.
function buildSoil(siteId, cols, rows, seed) {
  const s = SITES[siteId]; if (!s) throw new Error('unknown site ' + siteId);
  cols = cols | 0 || 90; rows = rows | 0 || 60;
  const R = AL.rng((seed >>> 0) || 1234), T = TILE;
  const tiles = new Uint8Array(cols * rows);
  const set = (c, r, v) => { if (c >= 0 && r >= 0 && c < cols && r < rows) tiles[r * cols + c] = v; };
  const get = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? tiles[r * cols + c] : T.ROCK);
  const sd = (seed | 0) + 17;
  const waterRow = Math.round(rows * s.soil.water);
  const ec = Math.round(cols * 0.5);
  // classic layers with a wobbly boundary
  for (let c = 0; c < cols; c++) {
    const w1 = (AL.fbm(c / 9, 1, sd, 3) - 0.5) * 4, w2 = (AL.fbm(c / 11, 7, sd, 3) - 0.5) * 5;
    const topEnd = Math.min(rows * 0.24, 16) + w1, clayEnd = rows * 0.62 + w2;
    for (let r = 0; r < rows; r++) {
      let v = r < topEnd ? T.TOPSOIL : r < clayEnd ? T.CLAY : T.GRAVEL;
      if (r >= waterRow + Math.round(w1 * 0.4)) v = T.WATER;
      tiles[r * cols + c] = v;
    }
  }
  const blob = (cx, cy, rx, ry, v, onlyOn) => {
    for (let r = Math.floor(cy - ry - 1); r <= cy + ry + 1; r++) for (let c = Math.floor(cx - rx - 1); c <= cx + rx + 1; c++) {
      const dx = (c - cx) / rx, dy = (r - cy) / ry, n = (AL.noise2(c * 0.6, r * 0.6, sd + v) - 0.5) * 0.5;
      if (dx * dx + dy * dy <= 1 + n && (!onlyOn || onlyOn.includes(get(c, r)))) set(c, r, v);
    }
  };
  const solids = [T.TOPSOIL, T.CLAY, T.GRAVEL, T.SAND, T.HUMUS, T.MULCH];
  // buried stones everywhere (none right under the entrance)
  const stones = 3 + Math.round(cols * rows / 450) + R.int(3);
  for (let k = 0; k < stones; k++) {
    const sc = R() * cols, sr = Math.min(rows * 0.85, 6 + R() * rows * 0.7);
    if (Math.abs(sc - ec) < 4 && sr < 14) continue;
    blob(sc, sr, 1 + R() * 2, 1 + R() * 1.4, T.ROCK, solids);
  }
  // a winding root from (c0, r0)
  const rootPaths = [];   // smooth polylines for drawing (the tiles are what gameplay uses)
  const root = (c0, r0, len, wob, thick) => {
    let c = c0, r = r0, a = Math.PI / 2 + (R() - 0.5) * 0.8;
    const pts = []; rootPaths.push({ w: thick == null ? 0.4 : thick, pts });
    for (let k = 0; k < len; k++) {
      pts.push([c + 0.5, r + 0.5]);
      set(Math.round(c), Math.round(r), T.ROOT);
      if (k < len * (thick || 0.4)) set(Math.round(c) + 1, Math.round(r), T.ROOT);
      a += (R() - 0.5) * wob; a = AL.clamp(a, 0.2, Math.PI - 0.2);
      c += AL.cos(a); r += AL.sin(a) * 0.8;
      if (r >= waterRow - 1) break;
    }
  };
  let entry = ec, open = 0, feature = null;
  switch (s.soil.kind) {
    case 'rock': {
      // a stone slab caps the top rows left of the entrance; the queen digs down beside it, then under
      const w = Math.min(Math.round(cols * 0.6), 20), c0 = ec - w, depth = Math.max(3, Math.min(5, Math.round(rows * 0.12)));
      for (let c = c0; c < c0 + w; c++) {
        const d = depth - Math.round(AL.pow(Math.abs((c - c0 - w / 2) / (w / 2)), 3) * (depth - 1));
        for (let r = 0; r < d; r++) set(c, r, T.ROCK);
      }
      for (let r = 2; r < Math.min(rows * 0.45, 20); r++) for (let c = 0; c < cols; c++) if (get(c, r) === T.TOPSOIL) set(c, r, T.CLAY);
      feature = { kind: 'rock', c0, w, depth };
      entry = ec; break;
    }
    case 'log': {
      const top = Math.max(3, Math.min(Math.round(rows * 0.3), 7)), half = Math.min(cols / 2, 22);
      for (let r = 0; r < top; r++) for (let c = 0; c < cols; c++) {
        const edge = Math.abs(c - ec) / half; if (edge > 1) continue;
        if (r < top * (1 - edge * edge * 0.7)) set(c, r, T.WOOD);
      }
      for (let r = top; r < waterRow; r++) for (let c = 0; c < cols; c++) if (get(c, r) === T.TOPSOIL || (get(c, r) === T.CLAY && R() < 0.5)) set(c, r, T.HUMUS);
      feature = { kind: 'log', c0: Math.round(ec - half), w: Math.round(half * 2), depth: top };
      break;
    }
    case 'sand': {
      for (let r = 0; r < waterRow; r++) for (let c = 0; c < cols; c++) { const v = get(c, r); if (v === T.TOPSOIL || v === T.CLAY || (v === T.GRAVEL && r < waterRow - 3)) set(c, r, T.SAND); }
      for (let k = 0; k < 2 + Math.round(cols / 25); k++) blob(R() * cols, rows * (0.25 + R() * 0.45), 4 + R() * 4, 0.8, T.GRAVEL, [T.SAND]);
      for (let c = 0; c < cols; c++) for (let r = waterRow - 3; r < waterRow; r++) set(c, r, T.CLAY);
      feature = { kind: 'sand' };
      break;
    }
    case 'garden': {
      for (let c = 0; c < cols; c++) { const m = 3 + Math.round(AL.noise2(c / 5, 3, sd) * 2); for (let r = 0; r < m; r++) set(c, r, T.MULCH); }
      for (let r = 3; r < Math.min(rows * 0.5, 24); r++) for (let c = 0; c < cols; c++) if (get(c, r) === T.TOPSOIL || get(c, r) === T.CLAY) set(c, r, T.HUMUS);
      for (let k = 0; k < Math.max(5, Math.round(cols / 7)); k++) root(R() * cols, 0, 6 + R() * 6, 1.4, 0.2);
      feature = { kind: 'garden' };
      break;
    }
    case 'roots': {
      const n = Math.max(6, Math.round(cols / 5)), len = Math.min(rows * 0.7, 32);
      for (let k = 0; k < n; k++) root((k + 0.5) / n * cols + (R() - 0.5) * 3, 0, len, 0.9);
      for (let k = 0; k < n; k++) root(R() * cols, 3 + R() * 10, len * 0.6, 1.3, 0.2);
      feature = { kind: 'roots', trunkC: Math.max(1, ec - 9) };
      open = 3; break;
    }
    case 'crack': {
      for (let c = 0; c < cols; c++) { set(c, 0, T.SLAB); set(c, 1, T.SLAB); }
      for (let r = 2; r < 6; r++) for (let c = 0; c < cols; c++) set(c, r, T.GRAVEL);
      for (let r = 6; r < waterRow; r++) for (let c = 0; c < cols; c++) if (get(c, r) === T.TOPSOIL || (get(c, r) === T.CLAY && r < rows * 0.5)) set(c, r, T.SAND);
      // the crack itself: a 1-tile gap through the slabs (slab joints every 7 tiles)
      set(ec, 0, T.AIR); set(ec, 1, T.AIR);
      feature = { kind: 'crack', joint: 7 };
      break;
    }
    case 'stump': {
      const w = Math.min(Math.round(cols * 0.56), 14), c0 = Math.round(ec - w / 2), depth = Math.min(Math.round(rows * 0.42), 10);
      for (let r = 0; r < depth; r++) for (let c = c0; c < c0 + w; c++) {
        const taper = r / depth, half = w / 2 * (1 - taper * taper * 0.55);
        if (Math.abs(c + 0.5 - ec) <= half) set(c, r, T.WOOD);
      }
      // old beetle galleries: winding open passages inside the wood
      for (let k = 0; k < 3; k++) {
        let c = c0 + 2 + R() * (w - 4), r = 2 + R() * (depth - 4), a = R() * TAU;
        for (let j = 0; j < 10; j++) { if (get(Math.round(c), Math.round(r)) === T.WOOD) set(Math.round(c), Math.round(r), T.GALLERY); a += (R() - 0.5) * 1.2; c += AL.cos(a); r += AL.sin(a) * 0.6; }
      }
      for (let k = 0; k < 6; k++) root(c0 + (k / 5) * w, depth - 2, Math.min(rows * 0.4, 16), 0.8);
      feature = { kind: 'stump', c0, w, depth };
      entry = c0 - 1; break;
    }
    default: { // meadow
      for (let k = 0; k < Math.max(10, Math.round(cols / 5)); k++) root(R() * cols, 0, 3 + R() * 4, 1.6, 0);
      feature = { kind: 'meadow' };
    }
  }
  entry = AL.clamp(entry | 0, 1, cols - 2);
  // the entrance column must be diggable from the surface down a few rows
  for (let r = 0; r < Math.max(open, 6); r++) {
    const v = get(entry, r);
    if (v === T.ROCK || v === T.ROOT || (v === T.SLAB && r > 1)) set(entry, r, r < 2 ? T.TOPSOIL : v === T.ROOT ? T.TOPSOIL : T.CLAY);
  }
  return { kind: s.soil.kind, site: siteId, cols, rows, tiles, entrance: { c: entry, r: 0 }, waterRow, seed: seed >>> 0, feature, rootPaths };
}
function tileAt(g, c, r) { return c >= 0 && r >= 0 && c < g.cols && r < g.rows ? g.tiles[r * g.cols + c] : TILE.ROCK; }

// ---- map art (browser only) -------------------------------------------------------------------
// drawDecor(ctx, site, frame): the site's own scenery in world units (call inside the surface
// transform, after the lead's scenery and before mounds). Features that already exist on the
// map (the rock, log, tree, puddle, patio) are not redrawn; only the extras are.
function drawDecor(ctx, s, frame) {
  const d = s.decor || {}, R = AL.rng(s.seed | 1);
  ctx.save();
  if (d.stump) drawStump(ctx, s.x, s.y, d.stump.r, s.rot, R);
  if (d.bed) drawBed(ctx, s.x, s.y, d.bed, R);
  if (d.pool || s.id === 'sand') drawSand(ctx, s.x, s.y, R, d.face || 0);
  if (d.tree) drawRoots(ctx, d.tree, d.face, R);
  if (d.patio) drawCrack(ctx, s.x, s.y, R);
  if (d.tufts) drawTufts(ctx, s.x, s.y, R);
  if (d.newRock) drawPlainRock(ctx, s.x, s.y - d.newRock.ry - 8, d.newRock, R);
  if (d.newLog) drawPlainLog(ctx, s.x, s.y - 40, d.newLog);
  // every site: a little dark entrance hole (a burrow-sized smudge)
  const e = entranceOf(s);
  ctx.fillStyle = 'rgba(40,26,14,0.55)'; ctx.beginPath(); ctx.ellipse(e.x, e.y, 6, 4.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(15,9,5,0.85)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 0.6, 3, 2.2, 0, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawStump(ctx, x, y, r, rot, R) {
  ctx.fillStyle = 'rgba(20,15,8,0.35)'; ctx.beginPath(); ctx.ellipse(x + 10, y + 14, r * 1.12, r * 1.0, 0, 0, TAU); ctx.fill();
  // flaring root buttresses
  for (let k = 0; k < 6; k++) {
    const a = rot + k / 6 * TAU + R() * 0.4, L = r * (1.25 + R() * 0.35);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    const g = ctx.createLinearGradient(0, -12, 0, 12); g.addColorStop(0, '#8a6844'); g.addColorStop(1, '#4e3620');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(r * 0.5, -14); ctx.quadraticCurveTo(L * 0.85, -6, L, 0); ctx.quadraticCurveTo(L * 0.85, 6, r * 0.5, 14); ctx.fill();
    ctx.restore();
  }
  // bark ring
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r * 1.05);
  g.addColorStop(0, '#7a5a38'); g.addColorStop(1, '#3e2a18');
  ctx.fillStyle = g; ctx.beginPath();
  for (let i = 0; i <= 26; i++) { const a = i / 26 * TAU, w = 1 + (AL.hash2(i % 26, 5, 7) - 0.5) * 0.1; ctx.lineTo(x + AL.cos(a) * r * w, y + AL.sin(a) * r * w); }
  ctx.fill();
  // cut top with growth rings, weathered grey-gold
  const top = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, 2, x, y, r * 0.86);
  top.addColorStop(0, '#d8b682'); top.addColorStop(0.7, '#b48e5c'); top.addColorStop(1, '#8a6a40');
  ctx.fillStyle = top; ctx.beginPath(); ctx.ellipse(x, y, r * 0.84, r * 0.82, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(110,72,38,0.5)'; ctx.lineWidth = 0.9;
  for (let k = 1; k <= 7; k++) { ctx.beginPath(); ctx.ellipse(x + 3, y + 2, r * 0.82 * k / 8, r * 0.8 * k / 8, 0.2, 0, TAU); ctx.stroke(); }
  // radial checks and a rotten heart
  ctx.strokeStyle = 'rgba(70,45,22,0.7)'; ctx.lineWidth = 1.4;
  for (let k = 0; k < 4; k++) { const a = R() * TAU; ctx.beginPath(); ctx.moveTo(x + AL.cos(a) * r * 0.15, y + AL.sin(a) * r * 0.15); ctx.lineTo(x + AL.cos(a) * r * 0.75, y + AL.sin(a) * r * 0.75); ctx.stroke(); }
  ctx.fillStyle = 'rgba(60,36,18,0.8)'; ctx.beginPath(); ctx.ellipse(x + 4, y + 3, r * 0.18, r * 0.13, 0.5, 0, TAU); ctx.fill();
  // beetle holes and moss
  ctx.fillStyle = 'rgba(25,15,8,0.9)';
  for (let k = 0; k < 7; k++) { const a = R() * TAU, d = r * (0.3 + R() * 0.45); ctx.beginPath(); ctx.arc(x + AL.cos(a) * d, y + AL.sin(a) * d, 1.6, 0, TAU); ctx.fill(); }
  ctx.fillStyle = 'rgba(110,150,60,0.6)';
  for (let k = 0; k < 5; k++) { const a = rot + 2 + R() * 1.6; ctx.beginPath(); ctx.ellipse(x + AL.cos(a) * r * 0.92, y + AL.sin(a) * r * 0.9, 9, 5, a, 0, TAU); ctx.fill(); }
}
function drawBed(ctx, x, y, b, R) {
  ctx.save(); ctx.translate(x, y - 10); ctx.rotate(b.rot);
  const w = b.w, h = b.h;
  // timber edging
  ctx.fillStyle = 'rgba(20,15,8,0.3)'; ctx.fillRect(-w / 2 + 6, -h / 2 + 8, w, h);
  ctx.fillStyle = '#8a6440'; ctx.fillRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12);
  ctx.fillStyle = 'rgba(255,230,190,0.18)'; ctx.fillRect(-w / 2 - 6, -h / 2 - 6, w + 12, 3);
  // dark mulch with chips
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, '#4a3220'); g.addColorStop(1, '#33210f');
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  for (let k = 0; k < 160; k++) { ctx.fillStyle = ['#6b4a2c', '#5a3c22', '#7c5a36', '#2a1a0c'][k % 4]; ctx.save(); ctx.translate(-w / 2 + R() * w, -h / 2 + R() * h); ctx.rotate(R() * 3); ctx.fillRect(-2.4, -0.9, 4.8, 1.8); ctx.restore(); }
  // plants: leafy rosettes and a couple of flowers
  for (let k = 0; k < 6; k++) {
    const px = -w / 2 + 30 + k * (w - 60) / 5 + (R() - 0.5) * 12, py = (R() - 0.5) * h * 0.5;
    for (let j = 0; j < 7; j++) {
      const a = j / 7 * TAU + R() * 0.3, L = 16 + R() * 8;
      ctx.save(); ctx.translate(px, py); ctx.rotate(a);
      const lg = ctx.createLinearGradient(0, -6, 0, 6); lg.addColorStop(0, '#86c55a'); lg.addColorStop(1, '#3f7a2c');
      ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(2, 0); ctx.quadraticCurveTo(L * 0.5, -L * 0.36, L, 0); ctx.quadraticCurveTo(L * 0.5, L * 0.36, 2, 0); ctx.fill();
      ctx.restore();
    }
    if (k % 2) { ctx.fillStyle = ['#e85a7a', '#f2c531', '#b47ae8'][k % 3]; for (let j = 0; j < 6; j++) { const a = j / 6 * TAU; ctx.beginPath(); ctx.ellipse(px + AL.cos(a) * 3.6, py + AL.sin(a) * 3.6, 3, 1.8, a, 0, TAU); ctx.fill(); } ctx.fillStyle = '#f6e7a0'; ctx.beginPath(); ctx.arc(px, py, 2, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
function drawSand(ctx, x, y, R, face) {
  const g = ctx.createRadialGradient(x, y, 4, x, y, 70);
  g.addColorStop(0, 'rgba(226,196,142,0.95)'); g.addColorStop(0.6, 'rgba(210,178,124,0.75)'); g.addColorStop(1, 'rgba(200,170,120,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 76, 56, face, 0, TAU); ctx.fill();
  // ripples and grains
  ctx.strokeStyle = 'rgba(160,124,80,0.45)'; ctx.lineWidth = 0.9;
  for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(x, y, 30 + k * 8, 18 + k * 6, face, 3.6, 5.6); ctx.stroke(); }
  for (let k = 0; k < 60; k++) { const a = R() * TAU, d = Math.sqrt(R()) * 55; ctx.fillStyle = ['#f0d9a8', '#b8946a', '#d6b884'][k % 3]; ctx.fillRect(x + AL.cos(a) * d, y + AL.sin(a) * d * 0.75, 1.3, 1.3); }
}
function drawRoots(ctx, t, face, R) {
  // thick surface roots running out from the trunk
  for (let k = 0; k < 5; k++) {
    const a = face + (k - 2) * 0.42 + (R() - 0.5) * 0.2, L = 90 + R() * 70;
    let x = t.x + AL.cos(a) * 18, y = t.y + AL.sin(a) * 18, w = 9 - k % 2 * 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(20,14,8,0.3)'; ctx.lineWidth = w + 3;
    const cx = t.x + AL.cos(a + 0.2) * L * 0.55, cy = t.y + AL.sin(a + 0.2) * L * 0.55, ex = t.x + AL.cos(a) * L, ey = t.y + AL.sin(a) * L;
    ctx.beginPath(); ctx.moveTo(x + 3, y + 4); ctx.quadraticCurveTo(cx + 3, cy + 4, ex + 3, ey + 4); ctx.stroke();
    const g = ctx.createLinearGradient(x, y, ex, ey); g.addColorStop(0, '#6e4e30'); g.addColorStop(1, '#8a6844');
    ctx.strokeStyle = g; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,190,0.2)'; ctx.lineWidth = w * 0.25;
    ctx.beginPath(); ctx.moveTo(x, y - w * 0.25); ctx.quadraticCurveTo(cx, cy - w * 0.25, ex, ey - w * 0.25); ctx.stroke();
  }
  // trunk base
  const g = ctx.createRadialGradient(t.x - 8, t.y - 8, 2, t.x, t.y, 30);
  g.addColorStop(0, '#8a6844'); g.addColorStop(1, '#4a321c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y, 28, 0, TAU); ctx.fill();
}
function drawCrack(ctx, x, y, R) {
  // a jagged dark line along the grout with tufts of weeds
  ctx.strokeStyle = 'rgba(40,34,26,0.85)'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
  ctx.beginPath(); let yy = y - 60; ctx.moveTo(x, yy);
  while (yy < y + 60) { yy += 6 + R() * 6; ctx.lineTo(x + (R() - 0.5) * 5, yy); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(40,34,26,0.5)'; ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) { const sy = y - 40 + R() * 80, dir = R() < 0.5 ? -1 : 1; ctx.beginPath(); ctx.moveTo(x, sy); ctx.lineTo(x + dir * (10 + R() * 14), sy + (R() - 0.5) * 12); ctx.stroke(); }
  for (let k = 0; k < 4; k++) {
    const wy = y - 50 + R() * 100;
    for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + (j - 2) * 0.45; ctx.strokeStyle = j % 2 ? '#6f9f45' : '#5a8b3a'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x, wy); ctx.lineTo(x + AL.cos(a) * 7, wy + AL.sin(a) * 7); ctx.stroke(); }
  }
  // heat shimmer tint
  const g = ctx.createRadialGradient(x, y, 2, x, y, 60); g.addColorStop(0, 'rgba(255,190,110,0.16)'); g.addColorStop(1, 'rgba(255,190,110,0)');
  ctx.fillStyle = g; ctx.fillRect(x - 60, y - 60, 120, 120);
}
function drawTufts(ctx, x, y, R) {
  // a slightly taller, sunlit patch of lawn with a few seed heads
  const g = ctx.createRadialGradient(x, y, 4, x, y, 90); g.addColorStop(0, 'rgba(190,220,120,0.35)'); g.addColorStop(1, 'rgba(190,220,120,0)');
  ctx.fillStyle = g; ctx.fillRect(x - 90, y - 90, 180, 180);
  for (let k = 0; k < 40; k++) {
    const a = R() * TAU, d = 20 + R() * 60, bx = x + AL.cos(a) * d, by = y + AL.sin(a) * d;
    ctx.strokeStyle = ['#7aa84c', '#8fbb58', '#6f9f45'][k % 3]; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + 2, by - 5, bx + (R() - 0.5) * 4, by - 9 - R() * 4); ctx.stroke();
    if (k % 8 === 0) { ctx.fillStyle = '#e6d9a0'; ctx.beginPath(); ctx.ellipse(bx, by - 12, 1.6, 3, 0, 0, TAU); ctx.fill(); }
  }
}
function drawPlainRock(ctx, x, y, r, R) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(r.rot);
  ctx.fillStyle = 'rgba(15,20,10,0.32)'; ctx.beginPath(); ctx.ellipse(7, 9, r.rx, r.ry, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(-r.rx * 0.35, -r.ry * 0.45, 2, 0, 0, Math.max(r.rx, r.ry) * 1.1);
  g.addColorStop(0, '#bdb7a8'); g.addColorStop(0.5, '#8f897c'); g.addColorStop(1, '#5d584e');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, r.rx, r.ry, 0, 0, TAU); ctx.fill();
  ctx.restore();
}
function drawPlainLog(ctx, x, y, l) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(l.rot);
  const g = ctx.createLinearGradient(0, -l.r, 0, l.r); g.addColorStop(0, '#9a7650'); g.addColorStop(1, '#4a3420');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-l.len / 2, -l.r, l.len, l.r * 2, l.r); ctx.fill();
  ctx.restore();
}

// drawMarker(ctx, site, t, opts): selection marker for the flight / site picker, in world units.
// opts: { z (camera zoom, keeps the label readable), hover, selected, taken (colony colour or null), label }
function drawMarker(ctx, s, t, opts) {
  opts = opts || {};
  const z = opts.z || 1, k = 1 / Math.max(0.25, z), e = entranceOf(s);
  const pulse = 0.5 + 0.5 * AL.sin(t * 3 + s.seed);
  const col = opts.taken || s.def.colour;
  ctx.save();
  // soft ground glow and a dashed ring
  const rr = (s.r + (opts.hover ? 10 : 0)) * (1 + pulse * 0.06);
  const g = ctx.createRadialGradient(e.x, e.y, 2, e.x, e.y, rr * 1.4);
  g.addColorStop(0, 'rgba(255,224,150,' + (0.22 + (opts.selected ? 0.2 : 0)) + ')'); g.addColorStop(1, 'rgba(255,224,150,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(e.x, e.y, rr * 1.4, 0, TAU); ctx.fill();
  ctx.setLineDash([8 * k, 6 * k]); ctx.lineDashOffset = -t * 20 * k;
  ctx.strokeStyle = opts.selected ? '#f2c14e' : 'rgba(255,244,214,0.85)'; ctx.lineWidth = (opts.selected ? 3 : 2) * k;
  ctx.beginPath(); ctx.arc(e.x, e.y, rr, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  // a little pin with the site badge
  const px = e.x, py = e.y - rr - 18 * k, br = 13 * k;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(px + 2 * k, py + 3 * k, br, br, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(28,20,12,0.92)'; ctx.beginPath(); ctx.arc(px, py, br, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2.4 * k; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(px - 4 * k, py + br - 1 * k); ctx.lineTo(px, py + br + 7 * k); ctx.lineTo(px + 4 * k, py + br - 1 * k); ctx.fillStyle = col; ctx.fill();
  drawBadge(ctx, s.id, px, py, br * 0.68, col);
  if (opts.label !== false) {
    ctx.font = '600 ' + (13 * k).toFixed(1) + 'px system-ui,"Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tw = ctx.measureText(s.name).width;
    ctx.fillStyle = 'rgba(24,17,11,0.82)'; ctx.beginPath(); ctx.roundRect(e.x - tw / 2 - 7 * k, e.y + rr + 6 * k, tw + 14 * k, 20 * k, 6 * k); ctx.fill();
    ctx.fillStyle = '#f3e9d2'; ctx.fillText(s.name, e.x, e.y + rr + 9.5 * k);
  }
  ctx.restore();
}
// tiny pictograms for each site (also used by the founding UI)
function drawBadge(ctx, id, x, y, r, col) {
  ctx.save(); ctx.translate(x, y); ctx.scale(r / 10, r / 10);
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (id) {
    case 'rock': ctx.beginPath(); ctx.ellipse(0, 1, 9, 6, 0, 0, TAU); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.ellipse(-3, -1.5, 3.5, 1.4, 0, 0, TAU); ctx.fill(); break;
    case 'log': ctx.beginPath(); ctx.roundRect(-9, -4, 16, 8, 4); ctx.fill(); ctx.fillStyle = '#e8c48c'; ctx.beginPath(); ctx.ellipse(7, 0, 3, 4, 0, 0, TAU); ctx.fill(); break;
    case 'sand': for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-9, -4 + k * 4); ctx.quadraticCurveTo(-4, -7 + k * 4, 0, -4 + k * 4); ctx.quadraticCurveTo(4, -1 + k * 4, 9, -4 + k * 4); ctx.stroke(); } break;
    case 'garden': for (let k = 0; k < 5; k++) { ctx.save(); ctx.rotate(k / 5 * TAU); ctx.beginPath(); ctx.ellipse(5, 0, 4.5, 2.2, 0, 0, TAU); ctx.fill(); ctx.restore(); } ctx.fillStyle = '#f6e7a0'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill(); break;
    case 'roots': ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, -1); ctx.moveTo(0, -1); ctx.quadraticCurveTo(-4, 3, -9, 8); ctx.moveTo(0, -1); ctx.quadraticCurveTo(1, 4, 1, 9); ctx.moveTo(0, -1); ctx.quadraticCurveTo(5, 2, 9, 6); ctx.stroke(); break;
    case 'crack': ctx.strokeRect(-9, -7, 18, 14); ctx.beginPath(); ctx.moveTo(-1, -7); ctx.lineTo(1, -2); ctx.lineTo(-2, 2); ctx.lineTo(1, 7); ctx.stroke(); break;
    case 'stump': ctx.beginPath(); ctx.ellipse(0, 0, 9, 8, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(20,14,8,0.7)'; ctx.lineWidth = 1.1; for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.arc(0, 0, k * 2.4, 0, TAU); ctx.stroke(); } break;
    default: for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 3.6, 8); ctx.quadraticCurveTo(k * 3.6 + 1.5, 0, k * 3.6 + (k % 2 ? 2 : -1), -8 + Math.abs(k) * 2); ctx.stroke(); }
  }
  ctx.restore();
}

// closest site to a world point within maxD (for clicks); returns the site or null
function siteAt(sites, x, y, maxD) {
  let best = null, bd = (maxD || 80) * (maxD || 80);
  for (const s of sites) { const e = entranceOf(s), d = AL.dist2(e.x, e.y, x, y); if (d < bd) { bd = d; best = s; } }
  return best;
}

// a placed site list without a world: generates the lead's backyard layout once (deterministic)
// ---- the stage map ----------------------------------------------------------------------------------
// The yard the nuptial flight and the founding play on, for the match's map (o: the match options: seed, biome,
// mapSize, colonies). The medium backyard is the hand-made one; any other biome or size is the World stage's fair map
// (world-poi.js plan) for that many colonies, the same one createWorld builds under the flight's nests (sim.js).
const stageBiome = o => (AL.BIOMES && o && AL.BIOMES[o.biome] ? o.biome : 'backyard');
const stageSize = o => (AL.MAP_SIZES && o && AL.MAP_SIZES[o.mapSize]) || (AL.MAP_SIZES && AL.MAP_SIZES.medium) || { key: 'medium', W: 4000, H: 3000 };
function stageCustom(o) { return stageBiome(o) !== 'backyard' || stageSize(o).key !== 'medium'; }
function stageMap(o) {
  if (!AL.Surface || !AL.Surface.generate) throw new Error('stageMap needs surface.js');
  o = o || {};
  const seed = (o.seed >>> 0) || 1, Z = stageSize(o), biome = stageBiome(o);
  const w = { R: AL.rng(seed), seed, biomeKey: biome, mapW: Z.W, mapH: Z.H, opts: {}, layout: null };
  AL.Surface.generate(w, { nests: [] });
  if (stageCustom(o) && AL.WorldPOI && AL.WorldPOI.plan) {
    const n = AL.Colonies && AL.Colonies.count ? AL.Colonies.count(o) : 2;
    w.layout = AL.WorldPOI.plan({ seed, n, W: Z.W, H: Z.H, biome });
    AL.WorldPOI.apply(w, w.layout);
  }
  if (AL.Terrain && AL.Terrain.generate) { try { AL.Terrain.generate(w); } catch (e) { /* plain ground */ } }
  w.surface.stageLayout = w.layout;
  return w.surface;
}
// the founding sites that fit a map: no patio cracks or garden beds where no people live
function stageIds(o) {
  const B = AL.BIOMES && AL.BIOMES[stageBiome(o)];
  return ORDER.filter(id => !(B && B.humans === false && (id === 'crack' || id === 'garden')));
}
// the founding sites of a map (o: match options as for stageMap; a plain seed for the medium backyard)
function placeDefault(seed, opts) {
  opts = opts || {};
  const o = opts.map || null;
  const S = stageMap(o ? Object.assign({}, o, { seed }) : { seed });
  const p = Object.assign({ seed, clear: false }, opts); delete p.map;
  if (o && !p.ids) p.ids = stageIds(o);
  return place(S, p);
}

AL.Sites = {
  TILE, TILE_INFO, BASE, FOOD_RADIUS, ORDER, SITES,
  list: () => ORDER.map(id => SITES[id]), get: id => SITES[id],
  modsFor, place, placeDefault, stageMap, stageCustom, stageIds, entranceOf, stockFood, nearbyFood, pickForAI, siteAt,
  buildSoil, tileAt, drawDecor, drawMarker, drawBadge,
};
if (NODE) module.exports = AL.Sites;
})(typeof window !== 'undefined' ? window : globalThis);
