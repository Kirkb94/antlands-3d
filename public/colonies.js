// Antlands colonies per match: how many colonies (2-8, default 6), where their nests go when nothing
// (flight, founding) placed them, which species each rival gets and how rivals are tinted apart.
// Pure simulation helpers (no DOM). createWorld (sim.js) and the title screen (ui-screens.js) use them.
//   AL.Colonies.count(opts)            -> colonies in this match (opts.colonies, else 1 + rivalSites, else 2)
//   AL.Colonies.pickSpecies(seed, n)   -> n random rival species keys from whatever AL.SPECIES holds
//   AL.Colonies.fillSites(nests, n, W, H) -> nests topped up to n, spread on a ring round the yard
//   AL.Colonies.rivalColours(sp, k)    -> ant colours for rival k (tinted toward its team colour)
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');

const MIN = 2, MAX = 8, DEFAULT = 6;
const TEAM_FALLBACK = ['#f2c14e', '#e0503a', '#4aa3df', '#a678de', '#3fbfa0', '#f08a3c', '#e86fa8', '#9ccc4a'];
const team = k => ((AL.Flight && AL.Flight.TEAM_COLOURS) || TEAM_FALLBACK)[k % 8];

function clampN(n) { return AL.clamp(Math.round(+n || DEFAULT), MIN, MAX); }
function count(opts) {
  opts = opts || {};
  if (typeof opts.colonies === 'number' || typeof opts.colonies === 'string') return clampN(opts.colonies);
  if (Array.isArray(opts.colonies)) return clampN(opts.colonies.length);
  if (opts.rivalSites) return AL.clamp(1 + opts.rivalSites.length, 1, MAX);
  if (opts.layout && opts.layout.nests) return AL.clamp(opts.layout.nests.length, 1, MAX);
  return 2;
}
// species a rival can be: everything in AL.SPECIES at call time (the species agent adds more at load),
// minus anything flagged noRival / playerOnly, and anything not playable yet (data.js AL.PLAYABLE)
function rivalPool() {
  const keys = Object.keys(AL.SPECIES || {}).filter(k => { const s = AL.SPECIES[k]; return s && !s.noRival && !s.playerOnly && (!AL.isPlayable || AL.isPlayable(k)); });
  return keys.length ? keys : ['fire'];
}
// n rival species, deterministic for a seed; spreads picks so a 7-rival game isn't five fire ant nests
function pickSpecies(seed, n) {
  // hash the seed first: xorshift's first outputs follow small seeds closely
  const R = AL.rng(((AL.hash2(seed >>> 0, 0x5bec, 1e5) * 4294967296) >>> 0) || 11), pool = rivalPool(), out = [];
  let bag = [];
  for (let k = 0; k < n; k++) {
    if (!bag.length) { bag = pool.slice(); for (let j = bag.length - 1; j > 0; j--) { const t = (R() * (j + 1)) | 0; const x = bag[j]; bag[j] = bag[t]; bag[t] = x; } }
    out.push(bag.pop());
  }
  return out;
}
// top a nest list up to n: candidates on an ellipse round the yard centre, each pick as far as possible
// from every nest placed so far (farthest-point), nudged inside the margins
function fillSites(nests, n, W, H) {
  W = W || (AL.Surface && AL.Surface.W) || 4000; H = H || (AL.Surface && AL.Surface.H) || 3000;
  const out = nests.map(p => ({ x: p.x, y: p.y }));
  if (out.length >= n) return out.slice(0, n);
  const cx = W / 2, cy = H / 2, rx = W * 0.37, ry = H * 0.36, cand = [];
  const a0 = out.length ? AL.atan2((out[0].y - cy) / ry, (out[0].x - cx) / rx) : Math.PI * 0.75;
  for (let k = 0; k < 32; k++) { const a = a0 + k / 32 * AL.TAU; cand.push({ x: Math.round(cx + AL.cos(a) * rx), y: Math.round(cy + AL.sin(a) * ry) }); }
  while (out.length < n) {
    let best = null, bd = -1;
    for (const c of cand) { let d = 1e18; for (const p of out) d = Math.min(d, AL.dist2(p.x, p.y, c.x, c.y)); if (d > bd) { bd = d; best = c; } }
    out.push({ x: best.x, y: best.y });
  }
  return out;
}
// queens that landed on the same founding site would put two mounds side by side: keep every nest at
// least minD from the ones before it (the player's stays put), moving a crowded one to the nearest open
// spot on growing rings round where it landed
const SPREAD_MIN = 560;
function spreadNests(nests, W, H, minD) {
  W = W || (AL.Surface && AL.Surface.W) || 4000; H = H || (AL.Surface && AL.Surface.H) || 3000; minD = minD || SPREAD_MIN;
  const out = [];
  const ok = (x, y, d) => x > 180 && y > 180 && x < W - 180 && y < H - 180 && out.every(p => AL.dist2(p.x, p.y, x, y) >= d * d);
  for (const n of nests) {
    let q = { x: n.x, y: n.y };
    if (out.length && !ok(q.x, q.y, minD)) {
      let found = null;
      for (let d = minD; d >= minD * 0.6 && !found; d -= minD * 0.1)
        for (let r = 120; r <= 1800 && !found; r += 80)
          for (let k = 0; k < 24; k++) { const a = k / 24 * AL.TAU + r * 0.01, x = n.x + AL.cos(a) * r, y = n.y + AL.sin(a) * r; if (ok(x, y, d)) { found = { x: Math.round(x), y: Math.round(y) }; break; } }
      if (found) q = found;
    }
    out.push(Object.assign({}, n, q));
  }
  return out;
}
// mix two #rrggbb colours
function mix(a, b, t) {
  const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
// rival k's ants: its species colours pulled toward its team colour (so 3 fire ant rivals look different)
function rivalColours(sp, k) {
  if (k === 1 && sp.key === 'fire' && AL.RIVAL_COLOURS) return AL.RIVAL_COLOURS;
  const t = team(k), dark = mix(t, '#000000', 0.45);
  return { body: mix(sp.body, t, 0.42), head: mix(sp.head, dark, 0.42), gaster: mix(sp.gaster, mix(t, '#000000', 0.7), 0.35) };
}

AL.Colonies = { MIN, MAX, DEFAULT, clampN, count, rivalPool, pickSpecies, fillSites, spreadNests, SPREAD_MIN, rivalColours, team, mix };
if (NODE) module.exports = AL.Colonies;
})(typeof window !== 'undefined' ? window : globalThis);
