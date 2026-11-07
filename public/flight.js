// Antlands nuptial flight: the opening race. Pure logic, no DOM, so it runs in Node tests.
// All queens (player + AI) take off from the yard edges at once and race to the founding sites.
// No hazards: it is just travel. Speed comes from a flap/glide stamina rhythm and riding breeze lanes.
// The scene (flight-scene.js) drives this with AL.Flight.step() and draws it.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? (root.AL || require('./al.js')) : root.AL;

// ---- tuning --------------------------------------------------------------------------
const F = {
  DURATION: 50,        // seconds of flight before the gentle auto-land
  GLIDE: 150,          // world units/s while gliding
  FLAP: 255,           // world units/s while flapping
  AUTO: 200,           // autopilot speed after time runs out
  ACCEL: 2.6,          // how quickly velocity follows the wanted velocity (1/s)
  DRAIN: 0.30,         // stamina per second while flapping (full bar ~3.3 s of flapping)
  RECOVER: 0.10,       // stamina per second while gliding
  LANE_RECOVER: 0.26,  // extra stamina per second while riding a breeze
  UNWIND: 0.3,         // a winded queen can flap again once stamina is back to this
  WIND: 120,           // breeze lane push at the lane centre (units/s)
  LANE_W: 150,         // breeze lane half width
  LAND_HOLD: 0.5,      // seconds of holding "land" over a site to commit
  LAND_ANIM: 1.1,      // seconds of the spiral down to the ground
  SLOT: 58,            // spacing of queens sharing a site (flight visuals)
  NEST_SPLIT: 130,     // spacing of nests sharing a site in the suggested layout
  FIRST_BONUS: 0.25,   // first queen down: +25% starting reserves
  TIRED: -0.10,        // auto-landed after the timer: -10% reserves
  STEP: 1 / 60,
};

// ---- founding site types (pros and cons are shown in full while flying) ----------------
// fit: how much each species likes the site (0..1); AI queens use it, the card shows it as stars.
// The Founding stage owns the gameplay effect of each type; these texts describe it.
const SITE_TYPES = {
  rock: {
    key: 'rock', name: 'Under a rock', short: 'Rock', colour: '#b9b2a2',
    pros: [{ tag: 'Sheltered', text: 'Rain never floods the chamber' }, { tag: 'Warm', text: 'Sun-warmed stone speeds up brood' }],
    cons: [{ tag: 'Cramped', text: 'The rock caps how wide the nest can grow' }, { tag: 'Hard soil', text: 'Packed earth, slow first dig' }],
    fit: { fire: 0.9, leafcutter: 0.45, carpenter: 0.4, army: 0.55 },
  },
  log: {
    key: 'log', name: 'Rotting log', short: 'Log', colour: '#a07a50',
    pros: [{ tag: 'Soft wood', text: 'Carpenter ants tunnel through it fast' }, { tag: 'Grubs', text: 'Beetle grubs nearby: early protein' }],
    cons: [{ tag: 'Damp', text: 'Mould spreads in long rains' }, { tag: 'Contested', text: 'Beetles and woodlice live here too' }],
    fit: { fire: 0.45, leafcutter: 0.55, carpenter: 1.0, army: 0.5 },
  },
  sand: {
    key: 'sand', name: 'Sandy bank', short: 'Sand bank', colour: '#e2c88e',
    pros: [{ tag: 'Fast dig', text: 'Loose sand digs very quickly' }, { tag: 'Water', text: 'A puddle right next door' }],
    cons: [{ tag: 'Collapses', text: 'Tunnels can cave in' }, { tag: 'Floods', text: 'Heavy rain fills the low chambers' }],
    fit: { fire: 0.8, leafcutter: 0.4, carpenter: 0.2, army: 0.7 },
  },
  garden: {
    key: 'garden', name: 'Garden bed', short: 'Garden', colour: '#8a5f3a',
    pros: [{ tag: 'Leaves', text: 'Rich soil and plenty of leaves to cut' }, { tag: 'Aphids', text: 'Aphids on the plants: steady sugar' }],
    cons: [{ tag: 'Gardener', text: 'Gets dug over now and then' }, { tag: 'Busy', text: 'Lots of other bugs pass through' }],
    fit: { fire: 0.6, leafcutter: 1.0, carpenter: 0.3, army: 0.5 },
  },
  roots: {
    key: 'roots', name: 'Root tangle', short: 'Roots', colour: '#7a5a3c',
    pros: [{ tag: 'Braced', text: 'Roots hold the tunnels: no collapses' }, { tag: 'Apples', text: 'Fallen fruit under the tree' }],
    cons: [{ tag: 'Slow dig', text: 'Digging between roots is slow' }, { tag: 'Cool', text: 'Deep shade slows brood a little' }],
    fit: { fire: 0.5, leafcutter: 0.7, carpenter: 0.65, army: 0.55 },
  },
  crack: {
    key: 'crack', name: 'Pavement crack', short: 'Crack', colour: '#c9c1b2',
    pros: [{ tag: 'Hot', text: 'Warm all day: the fastest brood' }, { tag: 'Fortress', text: 'A slit entrance that is hard to raid' }],
    cons: [{ tag: 'Narrow', text: 'Little room to grow sideways' }, { tag: 'Dry', text: 'Water is a long walk away' }],
    fit: { fire: 0.9, leafcutter: 0.2, carpenter: 0.3, army: 0.4 },
  },
  stump: {
    key: 'stump', name: 'Old tree stump', short: 'Stump', colour: '#9a7048',
    pros: [{ tag: 'High ground', text: 'Never floods' }, { tag: 'Wood mass', text: 'Endless wood for carpenters' }],
    cons: [{ tag: 'Hard start', text: 'Sound wood is slow to open' }, { tag: 'Exposed', text: 'Easy to spot from across the yard' }],
    fit: { fire: 0.5, leafcutter: 0.4, carpenter: 0.95, army: 0.5 },
  },
  meadow: {
    key: 'meadow', name: 'Open meadow', short: 'Meadow', colour: '#8fbf5a',
    pros: [{ tag: 'Room', text: 'Space to expand in every direction' }, { tag: 'Forage', text: 'Seeds and small bugs all around' }],
    cons: [{ tag: 'No cover', text: 'Easy to find and raid' }, { tag: 'Weather', text: 'Sun-baked or soaked, by turns' }],
    fit: { fire: 0.7, leafcutter: 0.6, carpenter: 0.2, army: 0.95 },
  },
};
const TYPE_ALIASES = {
  'under a rock': 'rock', 'rotting log': 'log', 'sandy bank': 'sand', 'garden bed': 'garden', 'root tangle': 'roots',
  'pavement crack': 'crack', 'old tree stump': 'stump', 'tree stump': 'stump', 'open meadow': 'meadow',
};

// default site placement on the lead's 4000 x 3000 backyard, next to the matching features
const DEFAULT_SITES = [
  { id: 'rock-flat', type: 'rock', name: 'Under the flat rock', x: 2150, y: 1580, r: 70 },        // the big flat shelter rock
  { id: 'rock-small', type: 'rock', name: 'Under a small rock', x: 640, y: 1560, r: 62 },        // small rock on the west side
  { id: 'log', type: 'log', x: 2080, y: 2430, r: 72 },               // end of the fallen log
  { id: 'sand', type: 'sand', x: 2840, y: 1990, r: 70 },             // bank of the big puddle
  { id: 'garden', type: 'garden', x: 560, y: 420, r: 78 },           // shed corner bed
  { id: 'roots', type: 'roots', x: 1610, y: 930, r: 74 },            // under the apple tree
  { id: 'crack', type: 'crack', x: 3600, y: 2560, r: 60 },           // patio slabs
  { id: 'stump', type: 'stump', x: 3360, y: 820, r: 68 },            // old stump, north-east
  { id: 'meadow-sw', type: 'meadow', name: 'West meadow', x: 800, y: 2260, r: 84 },       // open lawn, south-west
  { id: 'meadow-s', type: 'meadow', name: 'South meadow', x: 2720, y: 2660, r: 80 },       // open lawn, south
];

const TEAM_COLOURS = ['#f2c14e', '#e0503a', '#4aa3df', '#a678de', '#3fbfa0', '#f08a3c', '#e86fa8', '#9ccc4a'];
const SPECIES_KEYS = AL.SPECIES_ORDER || ['fire', 'leafcutter', 'carpenter', 'army'];   // all eight once species are loaded

// ---- helpers -----------------------------------------------------------------------------
function typeOf(t) {
  if (!t) return SITE_TYPES.meadow;
  if (SITE_TYPES[t]) return SITE_TYPES[t];
  const k = TYPE_ALIASES[String(t).toLowerCase()];
  return SITE_TYPES[k] || SITE_TYPES.meadow;
}
// accept the Founding stage's site list (AL.Sites.place output, any extra fields are kept) and
// fill in display data. x, y stay the site centre (Founding's decor draws there); ex, ey is the
// landing point / nest entrance (AL.Sites.entranceOf when available).
function foundingFit(id) {
  // same scoring as AL.Sites.pickForAI (minus its noise), normalised over the 8 types per species
  if (!AL.Sites || !AL.Sites.modsFor || !AL.SITES || !AL.SITES[id]) return null;
  const order = AL.SITE_ORDER || Object.keys(AL.SITES), out = {};
  for (const sp of SPECIES_KEYS) {
    const sc = k => { const m = AL.Sites.modsFor(k, sp); return m.food * 1.2 + m.defence + m.dig * 0.6 + m.warmth - m.visibility * 0.6 - m.hazard * 0.25 - m.caveIn * 6; };
    const all = order.map(sc), lo = Math.min(...all), hi = Math.max(...all);
    out[sp] = hi > lo ? (sc(id) - lo) / (hi - lo) : 0.5;
  }
  return out;
}
function normalizeSites(list, W, H) {
  const sx = (W || 4000) / 4000, sy = (H || 3000) / 3000;
  const src = list && list.length ? list : DEFAULT_SITES.map(s => Object.assign({}, s, { x: s.x * sx, y: s.y * sy }));
  return src.map((s, i) => {
    const ty = typeOf(s.type || s.kind || (AL.SITES && AL.SITES[s.id] ? s.id : null) || s.name);
    const ff = foundingFit(ty.key), fit = Object.assign({}, ty.fit);
    if (ff) for (const k in ff) fit[k] = (fit[k] != null ? fit[k] : 0.5) * 0.5 + ff[k] * 0.5;
    const e = AL.Sites && AL.Sites.entranceOf && s.decor ? AL.Sites.entranceOf(s) : { x: s.x, y: s.y };
    return Object.assign({}, s, {
      id: s.id != null ? s.id : 'site' + i,
      type: ty.key, typeName: ty.name, name: s.name || ty.name, short: s.short || ty.short,
      x: +s.x, y: +s.y, ex: +e.x, ey: +e.y, r: Math.max(s.r || 70, 64), drawR: s.r || 70,
      pros: s.pros || ty.pros, cons: s.cons || ty.cons, fit: Object.assign(fit, s.fit || {}),
      colour: s.colour || ty.colour,
      occupants: [], shared: false,
    });
  });
}

// three breeze lanes crossing the yard; each is a polyline of points with a flow direction
function makeLanes(W, H, R) {
  const j = (v, a) => v + (R() - 0.5) * a;
  const lanes = [
    [[-150, j(H * 0.86, 120)], [W * 0.3, j(H * 0.74, 160)], [W * 0.62, j(H * 0.58, 160)], [W + 150, j(H * 0.44, 140)]],
    [[W + 150, j(H * 0.12, 120)], [W * 0.66, j(H * 0.24, 160)], [W * 0.34, j(H * 0.3, 160)], [-150, j(H * 0.42, 140)]],
    [[j(W * 0.3, 160), -150], [j(W * 0.38, 200), H * 0.4], [j(W * 0.5, 200), H * 0.7], [j(W * 0.56, 160), H + 150]],
  ];
  return lanes.map(pts => {
    const segs = [];
    let len = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1], l = AL.hypot(bx - ax, by - ay);
      segs.push({ ax, ay, bx, by, l, tx: (bx - ax) / l, ty: (by - ay) / l, s0: len });
      len += l;
    }
    return { pts, segs, len, w: F.LANE_W, str: F.WIND };
  });
}
// wind vector at a point (sum over lanes, smooth falloff to the lane edge)
function windAt(fl, x, y) {
  let wx = 0, wy = 0;
  for (const L of fl.lanes) {
    let best = 1e9, bt = null;
    for (const s of L.segs) {
      const t = AL.clamp(((x - s.ax) * s.tx + (y - s.ay) * s.ty) / s.l, 0, 1);
      const px = s.ax + (s.bx - s.ax) * t, py = s.ay + (s.by - s.ay) * t;
      const d = AL.hypot(x - px, y - py);
      if (d < best) { best = d; bt = s; }
    }
    if (best < L.w) { const f = 1 - (best / L.w) * (best / L.w); wx += bt.tx * L.str * f; wy += bt.ty * L.str * f; }
  }
  // where lanes cross they don't stack past one lane's push, so a headwind is never a wall
  const m = AL.hypot(wx, wy);
  if (m > F.WIND) { wx *= F.WIND / m; wy *= F.WIND / m; }
  return { x: wx, y: wy };
}
// a point along a lane at distance s (for the drifting fluff the scene draws)
function lanePoint(L, s) {
  s = ((s % L.len) + L.len) % L.len;
  for (const g of L.segs) if (s <= g.s0 + g.l) { const t = (s - g.s0) / g.l; return { x: g.ax + (g.bx - g.ax) * t, y: g.ay + (g.by - g.ay) * t, tx: g.tx, ty: g.ty }; }
  const g = L.segs[L.segs.length - 1]; return { x: g.bx, y: g.by, tx: g.tx, ty: g.ty };
}
function siteAt(fl, x, y, extra) {
  let best = null, bd = 1e18;
  for (const s of fl.sites) { const d = AL.dist2(s.x, s.y, x, y), r = s.r + (extra || 0); if (d < r * r && d < bd) { bd = d; best = s; } }
  return best;
}
function nearestSite(fl, x, y) {
  let best = null, bd = 1e18;
  for (const s of fl.sites) { const d = AL.dist2(s.x, s.y, x, y); if (d < bd) { bd = d; best = s; } }
  return best;
}
function siteById(fl, id) { return fl.sites.find(s => s.id === id) || null; }

// queens start spread round the yard edges (8 slots so up to 8 queens never overlap)
function edgeSlots(W, H, n, R) {
  const per = 2 * (W + H), off = R() * per, inset = 70, out = [];
  for (let k = 0; k < n; k++) {
    let d = (off + (k / n) * per) % per, x, y;
    if (d < W) { x = d; y = inset; } else if ((d -= W) < H) { x = W - inset; y = d; } else if ((d -= H) < W) { x = W - d; y = H - inset; } else { d -= W; x = inset; y = H - d; }
    x = AL.clamp(x, inset, W - inset); y = AL.clamp(y, inset, H - inset);
    out.push({ x, y });
  }
  return out;
}

// ---- creation ------------------------------------------------------------------------------
// opts: { seed, W, H, duration, sites, colonies: [{ colonyId, species, isPlayer, colours, name }] }
//   or the shorthand { species, rivals: n | [species...] }
function create(opts) {
  opts = opts || {};
  const W = opts.W || (AL.Surface && AL.Surface.W) || 4000, H = opts.H || (AL.Surface && AL.Surface.H) || 3000;
  const seed = (opts.seed >>> 0) || 1;
  const R = AL.rng(seed ^ 0xF1167);
  const fl = {
    seed, R, W, H, t: 0, phase: 'ready', duration: opts.duration || F.DURATION,
    sites: normalizeSites(opts.sites, W, H), lanes: makeLanes(W, H, R),
    queens: [], order: 0, firstLanded: -1, events: [], timeUp: false, acc: 0,
  };
  let cols = Array.isArray(opts.colonies) ? opts.colonies : null;   // colonies stage: a number is the match size
  if (!cols || !cols.length) {
    cols = [{ colonyId: 0, species: opts.species || 'fire', isPlayer: true }];
    const rv = opts.rivals == null ? (typeof opts.colonies === 'number' ? Math.max(1, opts.colonies - 1) : 1) : opts.rivals;   // colonies stage: match size
    const list = Array.isArray(rv) ? rv : Array.from({ length: rv }, (_, k) => { const keys = AL.PLAYABLE || SPECIES_KEYS; return k === 0 ? 'fire' : keys[R.int(keys.length)]; });
    list.forEach((sp, k) => cols.push({ colonyId: k + 1, species: sp }));
  }
  cols = cols.slice(0, 8);
  const slots = edgeSlots(W, H, cols.length, R);
  cols.forEach((c, k) => {
    const p = slots[k], a = AL.atan2(H / 2 - p.y, W / 2 - p.x);
    const sp = (AL.SPECIES && AL.SPECIES[c.species]) || null;
    fl.queens.push({
      colonyId: c.colonyId != null ? c.colonyId : k, species: c.species || 'fire', isPlayer: !!c.isPlayer,
      name: c.name || (c.isPlayer ? 'You' : 'Rival ' + k), team: c.team || TEAM_COLOURS[k % TEAM_COLOURS.length],
      pal: c.colours || (sp ? { body: sp.body, head: sp.head, gaster: sp.gaster } : { body: '#9a3b1e', head: '#7e2c14', gaster: '#3a1a10' }),
      x: p.x, y: p.y, vx: 0, vy: 0, heading: a, alt: 0.75, stamina: 1, winded: false, flapping: false, inWind: 0,
      state: 'wait', hold: 0, holdSite: null, over: null, aim: null,
      site: null, landedAt: null, order: 0, auto: false, autoSite: null, lx: 0, ly: 0, sx: 0, sy: 0, alt0: 0, landT: 0,
      phase: R() * 6, input: { tx: null, ty: null, kx: 0, ky: 0, flap: false, land: false },
      ai: c.isPlayer ? null : { siteId: null, delay: 0.9 + R() * 1.4, flapping: false },
    });
  });
  for (const q of fl.queens) if (q.ai) aiChoose(fl, q);
  return fl;
}

// ---- AI ------------------------------------------------------------------------------------
// score = species fit - distance + a pinch of noise - crowding (others heading there / already landed)
function siteScore(fl, q, s) {
  const fit = s.fit[q.species] != null ? s.fit[q.species] : 0.5;
  const d = AL.hypot(s.x - q.x, s.y - q.y) / AL.hypot(fl.W, fl.H);
  let crowd = 0;
  for (const o of fl.queens) if (o !== q && o.ai && o.ai.siteId === s.id && !o.site) crowd += 0.22;
  for (const id of s.occupants) if (id !== q.colonyId) crowd += 0.35;
  return fit - d * 0.9 - crowd + hashNoise(fl.seed, q.colonyId, s.id) * 0.14;
}
function hashNoise(seed, a, id) { let h = 0; const str = String(id); for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return AL.hash2(a + 1, h, seed); }
function aiChoose(fl, q) {
  let best = null, bs = -1e9;
  for (const s of fl.sites) { const sc = siteScore(fl, q, s); if (sc > bs) { bs = sc; best = s; } }
  q.ai.siteId = best ? best.id : null;
  return best;
}
function aiInput(fl, q) {
  const ai = q.ai, s = siteById(fl, ai.siteId);
  if (fl.t < ai.delay || !s) return { tx: q.x + AL.cos(q.heading) * 30, ty: q.y + AL.sin(q.heading) * 30, flap: false, land: false };
  const d = AL.hypot(s.x - q.x, s.y - q.y);
  // flap on long legs, and to punch through a headwind
  const w = windAt(fl, q.x, q.y), head = d > 1 ? -(w.x * (s.x - q.x) + w.y * (s.y - q.y)) / d : 0;
  if (ai.flapping && (q.stamina < 0.18 || q.winded)) ai.flapping = false;
  else if (!ai.flapping && !q.winded && ((q.stamina > 0.75 && d > 300) || (head > 60 && q.stamina > 0.3))) ai.flapping = true;
  return { tx: s.x, ty: s.y, flap: ai.flapping, land: d < s.r * 0.55 };
}

// ---- simulation ------------------------------------------------------------------------------
function start(fl) { if (fl.phase !== 'ready') return; fl.phase = 'fly'; for (const q of fl.queens) q.state = 'fly'; emit(fl, 'takeoff', {}); }
function emit(fl, type, d) { if (fl.events.length < 200) fl.events.push(Object.assign({ type, t: fl.t }, d)); }
function setInput(fl, inp) { const q = player(fl); if (q) Object.assign(q.input, inp); }
function player(fl) { return fl.queens.find(q => q.isPlayer) || null; }

function step(fl, dt) {
  fl.acc += Math.min(dt, 5);
  while (fl.acc >= F.STEP - 1e-9) { fl.acc -= F.STEP; stepOnce(fl, F.STEP); }
}
function stepOnce(fl, h) {
  if (fl.phase === 'ready' || fl.phase === 'done') { for (const q of fl.queens) q.phase += h * 9; return; }
  fl.t += h;
  if (fl.phase === 'fly' && fl.t >= fl.duration) {
    fl.phase = 'timeup'; fl.timeUp = true;
    for (const q of fl.queens) if (q.state === 'fly') { q.auto = true; q.autoSite = nearestSite(fl, q.x, q.y).id; q.hold = 0; }
    emit(fl, 'timeup', {});
  }
  let all = true;
  for (const q of fl.queens) { updateQueen(fl, q, h); if (q.state !== 'landed') all = false; }
  if (all) { fl.phase = 'done'; emit(fl, 'done', {}); }
}

function updateQueen(fl, q, h) {
  if (q.state === 'landed') return;
  if (q.state === 'landing') {
    q.landT = Math.min(1, q.landT + h / F.LAND_ANIM);
    const e = AL.easeInOut(q.landT), sw = (1 - e) * 46;
    q.x = AL.lerp(q.sx, q.lx, e) + AL.cos(q.landT * 9 + q.phase) * sw;
    q.y = AL.lerp(q.sy, q.ly, e) + AL.sin(q.landT * 9 + q.phase) * sw * 0.7;
    q.heading += h * 4 * (1 - e);
    q.alt = q.alt0 * (1 - e); q.phase += h * (14 - 10 * e);
    if (q.landT >= 1) { q.state = 'landed'; q.x = q.lx; q.y = q.ly; q.alt = 0; emit(fl, 'touchdown', { colonyId: q.colonyId, siteId: q.site, x: q.x, y: q.y }); }
    return;
  }
  if (q.state !== 'fly') return;
  let inp;
  if (q.auto) { const s = siteById(fl, q.autoSite); inp = { tx: s.x, ty: s.y, flap: false, land: AL.hypot(s.x - q.x, s.y - q.y) < s.r * 0.6 }; }
  else inp = q.ai ? aiInput(fl, q) : q.input;

  // wanted direction: keyboard vector wins, else fly toward the target point
  let dx = 0, dy = 0, arrive = 1;
  if (inp.kx || inp.ky) { const l = AL.hypot(inp.kx, inp.ky); dx = inp.kx / l; dy = inp.ky / l; }
  else if (inp.tx != null) {
    const ex = inp.tx - q.x, ey = inp.ty - q.y, d = AL.hypot(ex, ey);
    if (d > 1) { dx = ex / d; dy = ey / d; }
    arrive = AL.clamp(d / 120, 0, 1);
  }
  const holding = q.hold > 0;
  const canFlap = !q.auto && !!inp.flap && !q.winded && q.stamina > 0 && !holding;
  let speed = q.auto ? F.AUTO : canFlap ? F.FLAP : F.GLIDE;
  speed *= q.auto ? Math.max(arrive, 0.35) : arrive;
  if (holding) speed *= 0.12;
  const k = Math.min(1, F.ACCEL * h * (holding ? 3 : 1));
  const w = windAt(fl, q.x, q.y), wm = AL.hypot(w.x, w.y), wk = holding ? 0.15 : 1;
  // close to the target she leans into the breeze so she can hover over a site in a lane
  const comp = (1 - arrive) * wk;
  q.vx += (dx * speed - w.x * comp - q.vx) * k; q.vy += (dy * speed - w.y * comp - q.vy) * k;
  q.x += (q.vx + w.x * wk) * h; q.y += (q.vy + w.y * wk) * h;
  q.x = AL.clamp(q.x, -120, fl.W + 120); q.y = AL.clamp(q.y, -120, fl.H + 120);
  const gx = q.vx + w.x * wk, gy = q.vy + w.y * wk;
  if (gx * gx + gy * gy > 100) q.heading += AL.wrap(AL.atan2(gy, gx) - q.heading) * Math.min(1, h * 6);
  else q.heading += h * 0.8; // lazy hover circle
  // stamina: flapping drains, gliding rests; a breeze you fly with rests you faster
  const vm = AL.hypot(q.vx, q.vy) || 1, along = wm ? (q.vx * w.x + q.vy * w.y) / (vm * F.WIND) : 0;
  q.inWind = AL.clamp(wm / F.WIND, 0, 1);
  if (canFlap) { q.stamina -= F.DRAIN * h; if (q.stamina <= 0) { q.stamina = 0; q.winded = true; } }
  else q.stamina = Math.min(1, q.stamina + (F.RECOVER + Math.max(0, along) * F.LANE_RECOVER) * h);
  if (q.winded && q.stamina >= F.UNWIND) q.winded = false;
  q.flapping = canFlap;
  q.alt += ((canFlap ? 1 : 0.7) - q.alt) * Math.min(1, h * 1.5);
  q.phase += h * (canFlap ? 28 : 7);
  // the site under her, and where the player seems to be heading (for the "heading here" pips)
  const over = siteAt(fl, q.x, q.y);
  q.over = over ? over.id : null;
  if (q.ai) q.aim = q.auto ? q.autoSite : q.ai.siteId;
  else if (q.auto) q.aim = q.autoSite;
  else { const t = inp.tx != null ? siteAt(fl, inp.tx, inp.ty, 60) : null; q.aim = t ? t.id : q.over; }
  // landing: hold "land" over a site; the autopilot commits as soon as it is there
  if (inp.land && over && (!q.holdSite || q.holdSite === over.id)) {
    q.holdSite = over.id; q.hold += h;
    if (q.auto || q.hold >= F.LAND_HOLD - 1e-6) commitLanding(fl, q, over);
  } else { q.hold = 0; q.holdSite = null; }
}

function slotOffset(k, dist) { if (!k) return { x: 0, y: 0 }; const a = -0.6 + (k - 1) * 2.1; return { x: AL.cos(a) * dist, y: AL.sin(a) * dist }; }
function commitLanding(fl, q, s) {
  const slot = s.occupants.length;
  s.occupants.push(q.colonyId);
  if (s.occupants.length > 1) s.shared = true;
  const o = slotOffset(slot, F.SLOT);
  q.site = s.id; q.landedAt = Math.round(fl.t * 100) / 100; q.order = ++fl.order;
  if (q.order === 1) fl.firstLanded = q.colonyId;
  q.state = 'landing'; q.landT = 0; q.sx = q.x; q.sy = q.y; q.alt0 = q.alt; q.lx = s.ex + o.x; q.ly = s.ey + o.y;
  q.hold = 0; q.holdSite = null; q.flapping = false; q.slot = slot;
  emit(fl, 'land', { colonyId: q.colonyId, siteId: s.id, shared: s.shared, order: q.order, auto: q.auto });
  // AI queens heading here think again (they may still come: sharing is allowed)
  for (const o2 of fl.queens) if (o2.ai && !o2.site && !o2.auto && o2.ai.siteId === s.id) aiChoose(fl, o2);
}

// run the rest of the flight instantly (skip once the player has landed)
function finish(fl) {
  if (fl.phase === 'ready') start(fl);
  let guard = 0;
  while (fl.phase !== 'done' && guard++ < 60 * 400) stepOnce(fl, F.STEP);
  return result(fl);
}

// ---- output for the next stage -----------------------------------------------------------------
function bonusOf(fl, q) {
  if (q.auto) return { reserves: F.TIRED, tags: ['Tired wings'] };
  if (q.order === 1) return { reserves: F.FIRST_BONUS, tags: ['First to land'] };
  return { reserves: 0, tags: [] };
}
function result(fl) {
  const queens = fl.queens.map(q => {
    const s = siteById(fl, q.site);
    return {
      colonyId: q.colonyId, species: q.species, isPlayer: q.isPlayer, team: q.team,
      siteId: q.site, siteType: s ? s.type : null, siteName: s ? s.name : null,
      x: Math.round(q.lx), y: Math.round(q.ly), landedAt: q.landedAt, order: q.order, auto: q.auto,
      shared: !!(s && s.shared), neighbours: s ? s.occupants.filter(id => id !== q.colonyId) : [],
      bonus: bonusOf(fl, q),
    };
  });
  return {
    queens,
    // x, y = the entrance (landing point); cx, cy = the site centre
    sites: fl.sites.map(s => ({ id: s.id, type: s.type, name: s.name, x: Math.round(s.ex), y: Math.round(s.ey), cx: s.x, cy: s.y, r: s.r, occupants: s.occupants.slice(), shared: s.shared })),
    firstLanded: fl.firstLanded, duration: Math.round(fl.t * 100) / 100, timeUp: fl.timeUp,
  };
}
// nest position for each queen: the site entrance, queens sharing a site split NEST_SPLIT apart
function nestOf(res, q) {
  const s = res.sites.find(z => z.id === q.siteId);
  if (!s) return { x: q.x, y: q.y };
  const o = slotOffset(s.occupants.indexOf(q.colonyId), F.NEST_SPLIT);
  return { x: Math.round(s.x + o.x), y: Math.round(s.y + o.y) };
}
// the patch handed to ctx.done(): merged into the options of the next scene and createWorld
function toPatch(fl) {
  const res = result(fl);
  const byId = [...res.queens].sort((a, b) => a.colonyId - b.colonyId);
  const me = byId.find(q => q.isPlayer) || byId[0], rivals = byId.filter(q => q !== me);
  return {
    flight: res,
    landings: res.queens.map(q => ({ colonyId: q.colonyId, species: q.species, siteId: q.siteId, siteType: q.siteType, landedAt: q.landedAt, bonus: q.bonus, shared: q.shared, nest: nestOf(res, q) })),
    playerSite: nestOf(res, me),
    rivalSites: rivals.map(q => nestOf(res, q)),
    rivalSpecies: rivals.map(q => q.species),
    queenTraits: { reserveBonus: me.bonus.reserves, firstDown: me.order === 1, tired: me.auto, flightTime: me.landedAt, sharedWith: me.neighbours.length },
  };
}
function drainEvents(fl) { const e = fl.events; fl.events = []; return e; }

AL.Flight = {
  TUNE: F, SITE_TYPES, DEFAULT_SITES, TEAM_COLOURS, typeOf, normalizeSites,
  create, start, step, setInput, player, finish, result, toPatch, nestOf, drainEvents,
  windAt, lanePoint, siteAt, nearestSite, siteById, aiChoose, siteScore, commitLanding, edgeSlots,
};
if (NODE) module.exports = AL.Flight;
})(typeof window !== 'undefined' ? window : globalThis);
