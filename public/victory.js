// Antlands win condition and key points (expansion stage):
//   Win: elimination - every rival queen dead, satellites included (a colony with no queen anywhere is out).
//   Key points: a few marked points of interest (picnic spill, termite mounds, shelter rocks, aphid plants, apple
//   groves). Ants standing on a point capture it (fighters count more). Once they wake (20 min) each point is a
//   renewable food spring - grubs (protein) and fallen fruit (sugar), protein-heavy, refilling faster as the match
//   goes on - and only the holder's ants can harvest it (behavior.js). The old "hold the majority and fill a meter
//   to win" rule is kept for campaign missions only (opts.keypointWin, on with opts.campaign).
// Pure simulation (no DOM).
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); require('./expansion.js'); }
const X = AL.Expansion;

const CFG = {
  holdTime: 300,          // seconds of holding a majority of the points to win (lead: 5 min, for 30-50 min matches)
  allBonus: 1.5,          // holding every point fills the meter this much faster
  activeAt: 1200,         // key points wake up after this many sim seconds (opts.keypointsAt overrides; lead: 20 min)
  radius: 95,
  minPresence: 3,         // weighted ants needed to capture
  dominance: 1.25,        // must outnumber the next colony by this factor
  rate: 1 / 18,           // capture progress per second (scaled up when you outnumber them a lot)
  count: 3,
  // the food springs: per point kind, what refills (per second at waking, x up to RICH as the match goes on)
  SOURCES: {
    mound:  [{ kind: 'protein', rate: 0.5, max: 160 }],                                     // a termite mound: swarms of grubs
    rock:   [{ kind: 'protein', rate: 0.35, max: 120 }, { kind: 'sugar', rate: 0.12, max: 50 }],   // beetle grubs under the shelter rock
    spill:  [{ kind: 'protein', rate: 0.4, max: 150 }, { kind: 'sugar', rate: 0.35, max: 140 }],   // scraps that keep coming
    aphids: [{ kind: 'sugar', rate: 0.3, max: 120 }, { kind: 'protein', rate: 0.2, max: 80 }],     // honeydew and the aphids themselves
    grove:  [{ kind: 'sugar', rate: 0.4, max: 150 }, { kind: 'protein', rate: 0.2, max: 80 }],     // windfall apples and the grubs in them
  },
  RICH: 2.5, RICH_T: 1500,   // the springs refill up to RICH x faster, RICH_T seconds after waking
};

// Pick the key points from the map's POIs: the picnic spill, the shelter rock and the aphid plant that keeps
// the set fairest (sum over points of the distance difference between the player's and the nearest rival nest).
// With 3+ colonies (colonies stage) see pickPointsN: the fair map's contested slots, or a greedy fair set.
function pickPoints(world) {
  const S = world.surface, cols = world.colonies, out = [];
  const nests = S.nestSites || cols.map(c => ({ x: c.x, y: c.y }));
  if (nests.length > 2) return pickPointsN(world, nests);
  const bias = (x, y) => {
    const dp = AL.hypot(nests[0].x - x, nests[0].y - y);
    let dr = 1e9; for (let k = 1; k < nests.length; k++) dr = Math.min(dr, AL.hypot(nests[k].x - x, nests[k].y - y));
    return dp - dr;
  };
  const add = (name, kind, x, y, r) => out.push({ id: out.length, name, kind, x, y, r: r || CFG.radius, owner: -1, capper: -1, prog: 0, pres: new Float32Array(cols.length), contested: false, heldFor: 0 });
  const spill = S.pois.find(p => p.type === 'spill');
  const rock = S.rocks.find(r => r.shelter);
  const aphids = S.pois.filter(p => p.type === 'aphids');
  if (spill) add(spill.label || 'Picnic spill', 'spill', spill.x, spill.y, CFG.radius + 10);
  if (rock) {
    // the point sits beside the rock (on open ground facing the map centre), not on top of it
    const a = AL.atan2(S.H / 2 - rock.y, S.W / 2 - rock.x) + 0.9, d = Math.max(rock.rx, rock.ry) + CFG.radius * 0.9;
    add('Shelter rock', 'rock', rock.x + AL.cos(a) * d, rock.y + AL.sin(a) * d, CFG.radius);
  }
  let sum = out.reduce((s, p) => s + bias(p.x, p.y), 0);
  const left = aphids.slice();
  while (out.length < CFG.count && left.length) {
    left.sort((a, b) => Math.abs(sum + bias(a.x, a.y)) - Math.abs(sum + bias(b.x, b.y)));
    const p = left.shift(); add('Aphid plant', 'aphids', p.x, p.y, CFG.radius); sum += bias(p.x, p.y);
  }
  return out;
}

// 3-8 colonies. Fair map: the picnic (dead centre) plus the contested slots between neighbours - every other
// slot when the colony count is even, so each colony borders exactly one, else all of them. Any other map:
// the spill plus shelter rocks / aphid plants / termite mounds picked greedily so that every colony's nearest
// key point is about as far away as everyone else's.
function pickPointsN(world, nests) {
  const S = world.surface, cols = world.colonies, out = [], N = nests.length;
  const add = (name, kind, x, y, r) => out.push({ id: out.length, name, kind, x, y, r: r || CFG.radius, owner: -1, capper: -1, prog: 0, pres: new Float32Array(cols.length), contested: false, heldFor: 0 });
  const spill = S.pois.find(p => p.type === 'spill');
  const L = world.layout && world.layout.fair && world.layout.slots && world.layout.slots.length === N ? world.layout : null;
  if (L) {
    const c = L.center || { x: S.W / 2, y: S.H / 2 };
    if (spill) add(spill.label || 'Picnic spill', 'spill', spill.x, spill.y, CFG.radius + 10);
    const odd = (world.seed & 1) === 1;
    L.slots.forEach((sl, k) => {
      if (N % 2 === 0 && (k % 2 === 0) === odd) return;
      // termite mounds: the point sits on the yard side of the mound (on the line from the centre, so still fair)
      const d = AL.hypot(sl.x - c.x, sl.y - c.y) || 1, off = sl.kind === 'mound' ? 110 : 0;
      add(sl.kind === 'mound' ? 'Termite mound' : 'Apple grove', sl.kind === 'mound' ? 'mound' : 'grove', sl.x + (c.x - sl.x) / d * off, sl.y + (c.y - sl.y) / d * off, CFG.radius);
    });
    return out;
  }
  const want = N <= 4 ? 4 : 5, cand = [];
  for (const r of S.rocks) if (r.shelter) {
    const a = AL.atan2(S.H / 2 - r.y, S.W / 2 - r.x) + 0.9, d = Math.max(r.rx, r.ry) + CFG.radius * 0.9;
    cand.push({ name: 'Shelter rock', kind: 'rock', x: r.x + AL.cos(a) * d, y: r.y + AL.sin(a) * d });
  }
  for (const p of S.pois) if (p.type === 'aphids' && !p.home && !p.gone) cand.push({ name: 'Aphid plant', kind: 'aphids', x: p.x, y: p.y });
  for (const t of (world.poi && world.poi.termites) || []) cand.push({ name: 'Termite mound', kind: 'mound', x: t.x, y: t.y });
  const ok = q => !AL.Surface.isBlocked(S, q.x, q.y) && nests.every(n => AL.hypot(n.x - q.x, n.y - q.y) > 420);
  const chosen = [];
  if (spill) chosen.push({ name: spill.label || 'Picnic spill', kind: 'spill', x: spill.x, y: spill.y, r: CFG.radius + 10 });
  const spread = set => {
    let lo = 1e9, hi = 0;
    for (const n of nests) { let d = 1e9; for (const q of set) d = Math.min(d, AL.hypot(n.x - q.x, n.y - q.y)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    return hi - lo + hi * 0.25;
  };
  const left = cand.filter(ok);
  while (chosen.length < want && left.length) {
    let bi = -1, bv = 1e18;
    left.forEach((q, k) => { if (chosen.some(p => AL.hypot(p.x - q.x, p.y - q.y) < 300)) return; const v = spread(chosen.concat([q])); if (v < bv) { bv = v; bi = k; } });
    if (bi < 0) break;
    chosen.push(left.splice(bi, 1)[0]);
  }
  for (const q of chosen) add(q.name, q.kind, q.x, q.y, q.r);
  return out;
}

function init(world, opts) {
  const at = opts.keypointsAt != null ? +opts.keypointsAt : CFG.activeAt;
  world.victory = { points: pickPoints(world), hold: new Float32Array(world.colonies.length), holdTime: CFG.holdTime, activeAt: at, cfg: CFG,
    holdWin: !!(opts.keypointWin || opts.campaign) };
  // the food springs: a little pile per resource beside the point's centre (empty until the points wake)
  const S = world.surface, K = AL.CARRY;
  for (const p of world.victory.points) {
    p.srcs = [];
    (CFG.SOURCES[p.kind] || CFG.SOURCES.spill).forEach((d, k, all) => {
      const a = (p.id * 2.1 + k * Math.PI * 2 / all.length), r = all.length > 1 ? 22 : 0;
      let x = p.x + AL.cos(a) * r, y = p.y + AL.sin(a) * r;
      if (AL.Surface.isBlocked(S, x, y)) { x = p.x; y = p.y; }
      const prot = d.kind === 'protein';
      p.srcs.push(AL.Surface.addFood(S, { kind: prot ? K.PROTEIN : K.SUGAR, x, y, r: 14, amount: 0, max: d.max, regen: 0, keyPoint: p.id, spring: d, visual: prot ? 'grubs' : 'fruit', rot: 0, a }));
    });
  }
}
// refill the springs (once the points are awake), richer as the match goes on
function springs(world, V) {
  if (world.t < V.activeAt) return;
  const rich = 1 + (CFG.RICH - 1) * Math.min(1, (world.t - V.activeAt) / CFG.RICH_T), S = world.surface;
  for (const p of V.points) for (const f of p.srcs || []) {
    const was = f.amount;
    f.amount = Math.min(f.max, f.amount + f.spring.rate * rich * (AL.TUNE.FOOD_MUL || 1));
    if (was < 1 && f.amount >= 1) S.foodDirty = true;
  }
}
// who may take food from a key point's spring: its holder only (-1: nobody yet)
function springOwner(world, f) { const V = world.victory, p = V && f && f.keyPoint != null ? V.points[f.keyPoint] : null; return p ? p.owner : -2; }

function second(world) {
  const V = world.victory, A = world.ants, cols = world.colonies, NC = cols.length, pts = V.points, W = X.WEIGHT;
  for (const p of pts) p.pres.fill(0);
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== 0) continue;
    const x = A.x[i], y = A.y[i];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k], dx = x - p.x, dy = y - p.y;
      if (dx > p.r || dx < -p.r || dy > p.r || dy < -p.r || dx * dx + dy * dy > p.r * p.r) continue;
      if (!cols[A.col[i]].out) p.pres[A.col[i]] += W[A.caste[i]];
    }
  }
  const active = world.t >= V.activeAt;
  for (const p of pts) {
    let best = -1, bv = 0, sv = 0;
    for (let c = 0; c < NC; c++) { const v = p.pres[c]; if (v > bv) { sv = bv; bv = v; best = c; } else if (v > sv) sv = v; }
    const dom = bv >= CFG.minPresence && bv >= sv * CFG.dominance ? best : -1;
    p.contested = bv > 0 && sv > 0 && dom < 0;
    if (!active) continue;
    if (p.owner >= 0 && cols[p.owner].out) { p.owner = -1; p.prog = 0; p.capper = -1; }
    if (dom >= 0) {
      const rate = CFG.rate * Math.min(2, 1 + (bv - sv) / 10);
      if (p.owner === dom) p.prog = Math.min(1, p.prog + rate);
      else if (p.owner >= 0) {
        p.prog -= rate;
        if (p.prog <= 0) { AL.emit(world, 'pointLost', { col: p.owner, by: dom, point: p.id, name: p.name, x: p.x, y: p.y }); p.owner = -1; p.prog = 0; p.capper = dom; }
      } else if (p.capper !== dom && p.prog > 0) { p.prog -= rate; if (p.prog <= 0) { p.prog = 0; p.capper = dom; } }
      else {
        p.capper = dom; p.prog += rate;
        if (p.prog >= 1) { p.prog = 1; p.owner = dom; AL.emit(world, 'pointCaptured', { col: dom, point: p.id, name: p.name, x: p.x, y: p.y }); }
      }
    } else if (bv === 0 && p.owner < 0 && p.prog > 0) p.prog = Math.max(0, p.prog - 0.01);   // abandoned half-capture fades
    if (p.owner >= 0) p.heldFor++;
  }
  springs(world, V);
  if (active && V.holdWin) {   // (campaign: hold the majority to fill the win meter)
    const n = pts.length;
    for (let c = 0; c < NC; c++) {
      if (cols[c].out) continue;
      let owned = 0; for (const p of pts) if (p.owner === c) owned++;
      if (owned * 2 > n) V.hold[c] = Math.min(V.holdTime, V.hold[c] + (owned === n ? CFG.allBonus : 1));
    }
  }
}

// ---- win checks (AL.WIN_CHECKS, once per sim second) --------------------------------------
function strongest(world, except) {
  let best = -1, bv = -1;
  for (const c of world.colonies) { if (c.id === except || c.out) continue; const v = X.totalPop(c) + X.livingQueens(world, c) * 50; if (v > bv) { bv = v; best = c.id; } }
  return best;
}
// multiplayer: names are the players' own; nobody is "you" in the shared result
const who = (world, c) => { const o = world.colonies[c]; return (o && o.name) || (o && o.isPlayer ? 'Player ' + (c + 1) : 'Rival ' + c + ' (' + o.sp.name.toLowerCase() + ')'); };
function checkMP(world) {
  const V = world.victory, cols = world.colonies;
  if (V.holdWin) for (let c = 0; c < cols.length; c++) if (V.hold[c] >= V.holdTime) {
    const names = V.points.filter(p => p.owner === c).map(p => p.name.toLowerCase());
    return { winner: c, reason: who(world, c) + ' held ' + listing(names) + ' and filled the hold meter.' };
  }
  const left = cols.filter(c => !c.out);
  if (left.length === 1) return { winner: left[0].id, reason: who(world, left[0].id) + ' is the last colony standing.' };
  if (!left.some(c => c.isPlayer)) return { winner: strongest(world, -1), reason: 'Every player\'s last queen is dead. The rivals keep the backyard.' };
  return null;
}
function check(world) {
  const V = world.victory; if (!V || !world.exp) return null;
  if (world.mp) return checkMP(world);
  const cols = world.colonies, me = cols[0];
  // hold the key points (campaign missions only)
  if (V.holdWin) for (let c = 0; c < cols.length; c++) if (V.hold[c] >= V.holdTime) {
    const names = V.points.filter(p => p.owner === c).map(p => p.name.toLowerCase());
    return { winner: c, reason: (c === 0 ? 'You held ' : (cols.length > 2 ? 'Rival ' + c + ' (' + cols[c].sp.name.toLowerCase() + ') held ' : 'The rival held ')) + listing(names) + ' and filled ' + (c === 0 ? 'your' : 'its') + ' hold meter.' };
  }
  // elimination
  if (me.out) return { winner: strongest(world, 0), reason: 'Your last queen is dead. The colony is gone.' };
  if (cols.length > 1 && cols.every(c => c.isPlayer || c.out)) return { winner: 0, reason: 'Every rival queen is dead, satellites and all.' };
  return null;
}
const clock = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const listing = a => !a.length ? 'the key points' : a.length === 1 ? 'the ' + a[0] : 'the ' + a.slice(0, -1).join(', the ') + ' and the ' + a[a.length - 1];

// per-colony summary for the victory / defeat screen
function summary(world) {
  const V = world.victory;
  return {
    t: world.t, time: clock(world.t), winner: world.over ? world.over.winner : -1,
    rows: world.colonies.map(c => ({
      id: c.id, name: world.mp && c.isPlayer ? (c.id === world.me ? 'You (' + (c.name || 'Player ' + (c.id + 1)) + ')' : c.name || 'Player ' + (c.id + 1)) : c.isPlayer ? 'Your colony' : world.colonies.length === 2 ? 'Rival colony' : 'Rival ' + c.id, species: c.sp.name,
      colour: X.TEAM[c.id % X.TEAM.length], out: !!c.out,
      peakPop: Math.max(c.expStats ? c.expStats.peakPop : 0, X.totalPop(c)), pop: X.totalPop(c),
      food: Math.round(c.stats.foodIn), queensRaised: c.expStats ? c.expStats.queensRaised : 0,
      satellites: c.expStats ? c.expStats.satFounded : 0, nestsRazed: c.expStats ? c.expStats.nestsRazed : 0,
      kills: c.stats.kills || 0, hold: V ? Math.round(V.hold[c.id]) : 0,
      points: V ? V.points.filter(p => p.owner === c.id).length : 0,
    })),
  };
}

AL.registerSystem({
  id: 'victory', order: 31,
  enabled(opts) { return !opts.benchOnly && opts.expansion !== false; },
  init, second,
});
AL.WIN_CHECKS.push(check);
// the end screen wants the summary frozen at the moment the game ended
AL.on('gameOver', (world) => { if (world && world.victory && world.over && !world.over.summary) world.over.summary = summary(world); });

AL.Victory = { CFG, pickPoints, pickPointsN, check, summary, clock, springOwner };
if (NODE) module.exports = AL.Victory;
})(typeof window !== 'undefined' ? window : globalThis);
