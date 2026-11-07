// Antlands expansion stage (late game): winged reproductives, satellite nests, queen takeover,
// raid tunnels and the expansion side of the rival AI. Pure simulation (no DOM), runs in node --test.
//
//   colony.royal       royal brood queue + winged queens/males waiting on the mound
//   colony.satellites  [{ id, x, y, hp, maxHp, queen, state, ... }]  (contract section 8)
//   colony.queen       { alive, hp, maxHp, i, traits }  (created here if the core has not made one yet)
//   world.exp          { flights, tunnels, ... }
//
// Satellites share the colony stockpile: a forager that reaches any of its colony's entrances drops the
// crumb into colony.stock (the satellite's porters carry it along the linked trail, abstracted).
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./sim.js'); require('./research.js'); }   // research.js: deep tunnelling is a node of the research tree
const ST = AL.ST, C = AL.CASTE, K = AL.CARRY;

// custom surface state (contract: stage ids >= 40): walk to a spot and hold it (rally, garrison, raiders)
ST.X_GARRISON = 52;
// custom nest state: a raid-tunnel party inside a rival's nest grid (moved by this system's tick)
ST.X_NRAID = 53;

// ---- tuning (one place) -----------------------------------------------------------------
const CFG = {
  royal: {
    queen: { protein: 45, sugar: 35, time: 100 },   // a winged queen: lots of protein and time
    male: { protein: 10, sugar: 10, time: 45 },
    minPop: 70,              // royal brood unlocks once the colony is this big (late game)
    queueMax: 3, readyMax: 4,
  },
  flight: { emerge: 1.6, takeoff: 1.4, speed: 240, minCruise: 2.5, descend: 1.9, spiral: 46 },
  sat: {
    max: 3,                  // satellites per colony (founding + flying count)
    minGap: 150,             // no closer than this to any other nest entrance
    foundT: 22,              // quick founding (seconds); each escorting male cuts 20%
    maleBonus: 0.2, maxMales: 2,
    hp: 120, queenHp: 140,
    nanitics: 4,             // first workers the queen raises from her own reserves
    homeWorkers: 12,         // a satellite with its own nest (people's colonies, AI rivals with real nests) starts with these too: workers that went with the queen
    broodEvery: 9,           // seconds per new ant once active (times species breed)
    cost: { protein: 1, sugar: 1.2 },
    cap0: 22, capMax: 70, growEvery: 20,   // living-ant cap grows +1 every growEvery s
    terr0: 210, terrMax: 380,
    ruinTime: 90, orphanLife: 240,
  },
  main: { hp: 400, terr: 430 },
  siege: { pad: 50, structDmg: 0.35, queenDmg: 0.8, regen: 1.5, foundingDmg: 4, warnEvery: 20 },
  out: { fadeDelay: 30, fadeRate: 0.08 },
  tunnel: {
    research: { protein: 60, sugar: 70, time: 150 },   // the 'tunnel' node of the research tree (research.js) costs this
    minPop: 100,             // or at least one active satellite
    cost: { protein: 20, sugar: 10 },
    diggers: 8, party: 12,
    speed: 9,                // units per second with 8 diggers
    maxLen: 2200, warnAt: 0.7, undermine: 0.4,
  },
  // army ants (sp.nomad): queens have no wings and there's no mating flight. A big colony raises a new
  // (wingless) queen and splits: about SHARE of the ants walk off with her to a spot and form a second bivouac.
  split: { minPop: 140, share: 0.4, max: 120, foundT: 12 },
  ai: { every: 4, minProtein: 1.25, rally: 14 },
  siegeMain: 'auto',         // 'auto': siege fallback on a capital only when that colony has no detailed nest (colony.nest)
  aiAuto: true,              // run aiPolicy for rival colonies from this system (lead's AI may turn this off and call it)
};
// team colours for markers, territory tint and meters: the same palette as the Flight stage
const TEAM = (AL.Flight && AL.Flight.TEAM_COLOURS) || ['#f2c14e', '#e0503a', '#4aa3df', '#a678de', '#3fbfa0', '#f08a3c', '#e86fa8', '#9ccc4a'];
// fighting weight of a caste on a key point / at a nest (soldier 3, major ~5, worker 1)
const WEIGHT = AL.CASTES.map((c, k) => (k === C.QUEEN || k === C.WINGED) ? 0 : Math.max(0.3, c.dps / 3));

const hooks = {
  breach: null,       // (world, tunnel, crew[castes]) -> true if the nest model spawned the raiders inside the target nest grid
  broodTheft: null,   // (world, attackerColony, targetColony, sat|null) for slave-maker species (sp.slaver); not a starting species
};

const totalPop = c => { let n = 0; for (let k = 0; k < c.pop.length; k++) n += c.pop[k]; return n; };
const hasStock = (c, cost) => c.stock.protein >= (cost.protein || 0) && c.stock.sugar >= (cost.sugar || 0);
const pay = (c, cost) => { c.stock.protein -= cost.protein || 0; c.stock.sugar -= cost.sugar || 0; };
const satR = s => 14 + Math.sqrt(s.soil) * 2;

// ---- setup -------------------------------------------------------------------------------
function setupColony(world, c) {
  const qhp = AL.CASTES[C.QUEEN].hp * ((c.queen && c.queen.traits && c.queen.traits.hpMul) || 1);
  if (!c.queen) c.queen = { alive: true, hp: qhp, maxHp: qhp, i: -1, traits: {} };
  if (c.queen.maxHp == null) c.queen.maxHp = c.queen.hp || qhp;
  c.satellites = c.satellites || [];
  c.royal = { queue: [], queens: 0, males: 0 };
  if (!c.research) c.research = { tunnel: 0, busy: false, t: 0 };   // research.js owns it (the tree); tunnel = 1 once deep tunnelling is known
  c.expStats = { peakPop: 0, queensRaised: 0, malesRaised: 0, satFounded: 0, satLost: 0, nestsRazed: 0, tunnels: 0, takeovers: 0 };
  c.mainHp = c.mainMaxHp = CFG.main.hp;
  c.out = null; c.interregnum = false; c.underAttack = 0;
  c.terrR = CFG.main.terr;
  c._warn = -99; c._ai = 0;
}
function init(world, opts) {
  world.exp = { uid: 1, flights: [], tunnels: [], raids: [], cfg: CFG, aiPhase: 0 };
  for (const c of world.colonies) setupColony(world, c);
  world.surfaceHandlers[ST.X_GARRISON] = garrisonHandler;
  world.nestHandlers = world.nestHandlers || {};
  world.nestHandlers[ST.X_NRAID] = () => {};   // raiders are moved in tick() (they need the whole party's view)
}

// ---- royal brood (winged queens and males) -----------------------------------------------
function canRaise(world, ci, sex) {
  const c = world.colonies[ci], R = CFG.royal, cost = R[sex];
  if (!cost) return { ok: false, why: 'Unknown caste' };
  if (c.out || !c.queen.alive) return { ok: false, why: 'No queen to lay royal eggs' };
  if (c.sp.nomad && sex === 'male') return { ok: false, why: 'Army ant colonies split: no males needed' };
  const minPop = c.sp.nomad ? CFG.split.minPop : R.minPop;
  if (totalPop(c) < minPop) return { ok: false, why: 'Needs ' + minPop + ' ants' };
  if (c.royal.queue.length >= R.queueMax) return { ok: false, why: 'Royal cells full' };
  if (c.royal.queens + c.royal.males + c.royal.queue.length >= R.readyMax + R.queueMax) return { ok: false, why: 'Too many royals waiting' };
  if (!hasStock(c, cost)) return { ok: false, why: 'Needs ' + cost.protein + ' protein, ' + cost.sugar + ' sugar' };
  return { ok: true };
}
function orderRoyal(world, ci, sex) {
  if (!canRaise(world, ci, sex).ok) return false;
  const c = world.colonies[ci], cost = CFG.royal[sex];
  pay(c, cost);
  c.royal.queue.push({ sex, t: 0, dur: cost.time });
  AL.emit(world, 'royalOrdered', { col: ci, sex });
  return true;
}
// also the entry point if the nest model raises WINGED eggs in its own brood pipeline
function onRoyalEmerged(world, ci, sex) {
  const c = world.colonies[ci];
  if (sex === 'male') { c.royal.males++; c.expStats.malesRaised++; } else { c.royal.queens++; c.expStats.queensRaised++; }
  AL.emit(world, 'royalEmerged', { col: ci, sex, x: c.x, y: c.y });
}
function updateRoyal(world, c, dt) {
  const q = c.royal.queue[0];
  if (!q || !c.queen.alive || c.out) return;
  // nurses speed up royal brood a little (up to +50%)
  q.t += dt * (1 + Math.min(0.5, c.pop[C.NURSE] * 0.02));
  if (q.t >= q.dur) { c.royal.queue.shift(); onRoyalEmerged(world, c.id, q.sex); }
}

// ---- homes: capital + satellites -----------------------------------------------------------
// every place a colony's forager can drop food (capital, active and orphaned satellites)
function homes(c) {
  const out = [c];
  for (const s of c.satellites) if ((s.state === 'active' || s.state === 'orphan') && s.home == null) out.push(s);   // (a satellite with its own nest keeps its own store)
  return out;
}
// nearest entrance of the colony to (x,y): the colony object itself (capital) or a satellite
function homeOf(c, x, y) {
  const sats = c.satellites;
  if (!sats || !sats.length) return c;
  let best = c, bd = AL.dist2(c.x, c.y, x, y);
  for (let k = 0; k < sats.length; k++) {
    const s = sats[k]; if ((s.state !== 'active' && s.state !== 'orphan') || s.home != null) continue;
    const d = AL.dist2(s.x, s.y, x, y); if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// an ant reached a satellite entrance: shared stockpile, then back out (same as the core's no-nest arrive)
function arriveAt(world, i, home) {
  const A = world.ants, c = world.colonies[A.col[i]];
  if (home === c) return world.arrive(world, i);
  if (A.carry[i]) {
    AL.Sim.addStock(c, A.carry[i], 1);
    AL.emit(world, 'foodDelivered', { col: c.id, kind: A.carry[i], amt: 1, sat: home.id });
    A.carry[i] = 0;
  }
  if (AL.Behavior && AL.Behavior.ate) AL.Behavior.ate(world, i);   // a meal from the shared store (people's ants have stomachs, hunger.js)
  A.state[i] = ST.WANDER; A.timer[i] = 0; A.a[i] += Math.PI;
}
// fallback when behavior.js has no nearest-home hook: after the core moved the ants, turn RETURN/HOMING
// ants whose nearest entrance is a satellite toward it, and deliver when they get there.
function homeSteerFallback(world) {
  if (world.exp.homeHook || (AL.Behavior && AL.Behavior.nearestHome)) return;   // behavior.js does it natively
  let any = false;
  for (const c of world.colonies) if (c.satellites.length) { any = true; break; }
  if (!any) return;
  const A = world.ants, n = A.high, cols = world.colonies;
  for (let i = 0; i < n; i++) {
    const st = A.state[i];
    if ((st !== ST.RETURN && st !== ST.HOMING) || A.layer[i] !== 0) continue;
    const c = cols[A.col[i]]; if (!c.satellites.length) continue;
    const h = homeOf(c, A.x[i], A.y[i]);
    if (h === c) continue;
    const dx = h.x - A.x[i], dy = h.y - A.y[i], rr = h.moundR * 0.4 + 8;
    if (dx * dx + dy * dy < rr * rr) { arriveAt(world, i, h); continue; }
    if (A.wf[i] > 0) continue;
    const d = AL.wrap(AL.atan2(dy, dx) - A.a[i]);
    A.a[i] += d > 0.25 ? 0.25 : d < -0.25 ? -0.25 : d;
    A.turn[i] = 0;
  }
}

// which colony's territory is this point in? (-1 = nobody). Used by AI, fog, UI.
function territoryOwner(world, x, y) {
  let best = -1, bv = 0;
  for (const c of world.colonies) {
    if (c.out && !c.satellites.length) continue;
    const pts = c.out ? c.satellites : [c].concat(c.satellites);
    for (const h of pts) {
      if (h.state === 'ruin') continue;
      const r = h === c ? c.terrR : h.terrR, d = Math.sqrt(AL.dist2(h.x, h.y, x, y));
      const v = 1 - d / r; if (v > bv) { bv = v; best = c.id; }
    }
  }
  return best;
}

// ---- winged queen flight -------------------------------------------------------------------
function siteCheck(world, ci, x, y) {
  const S = world.surface, c = world.colonies[ci];
  if (x < 60 || y < 60 || x > S.W - 60 || y > S.H - 60) return { ok: false, why: 'Too close to the edge' };
  for (let k = 0; k < 8; k++) { const a = k / 8 * AL.TAU; if (AL.Surface.isBlocked(S, x + AL.cos(a) * 18, y + AL.sin(a) * 18)) return { ok: false, why: 'Blocked ground' }; }
  if (AL.Surface.isBlocked(S, x, y)) return { ok: false, why: 'Blocked ground' };
  const g2 = CFG.sat.minGap * CFG.sat.minGap;
  for (const o of world.colonies) {
    if (!o.out && AL.dist2(o.x, o.y, x, y) < g2) return { ok: false, why: 'Too close to a nest' };
    for (const s of o.satellites) if (s.state !== 'ruin' && AL.dist2(s.x, s.y, x, y) < g2) return { ok: false, why: 'Too close to a nest' };
  }
  for (const f of world.exp.flights) if (AL.dist2(f.tx, f.ty, x, y) < g2) return { ok: false, why: 'Another queen is landing there' };
  if (satCount(world, ci) >= CFG.sat.max) return { ok: false, why: 'Max ' + CFG.sat.max + ' satellites' };
  if (c.out) return { ok: false, why: 'Colony is gone' };
  return { ok: true };
}
function satCount(world, ci) {
  let n = 0;
  for (const s of world.colonies[ci].satellites) if (s.state === 'active' || s.state === 'founding') n++;
  for (const f of world.exp.flights) if (f.col === ci) n++;
  return n;
}
function launch(world, ci, x, y) {
  const c = world.colonies[ci];
  if (c.royal.queens < 1) return null;
  if (!siteCheck(world, ci, x, y).ok) return null;
  if (c.sp.nomad) return split(world, ci, x, y);
  c.royal.queens--;
  const males = Math.min(CFG.sat.maxMales, c.royal.males); c.royal.males -= males;
  const F = CFG.flight, dx = x - c.x, dy = y - c.y, d = Math.max(1, AL.hypot(dx, dy));
  const a = AL.atan2(dy, dx), side = world.R() < 0.5 ? -1 : 1;
  const rimX = c.x + AL.cos(a) * c.moundR * 0.55, rimY = c.y + AL.sin(a) * c.moundR * 0.55;
  // cruise ends on the spiral circle around the landing spot, on the side she approaches from
  const ea = AL.atan2(rimY - y, rimX - x), ex = x + AL.cos(ea) * F.spiral, ey = y + AL.sin(ea) * F.spiral;
  const mx = (rimX + ex) / 2, my = (rimY + ey) / 2;
  const f = {
    id: world.exp.uid++, col: ci, sx: c.x, sy: c.y, rimX, rimY, tx: x, ty: y, ex, ey, ea, spin: side,
    cx: mx - dy / d * d * 0.18 * side, cy: my + dx / d * d * 0.18 * side,
    x: c.x, y: c.y, px: c.x, py: c.y, alt: 0, palt: 0, a, pa: a, phase: 'emerge', t: 0, pt: 0,
    cruise: Math.max(F.minCruise, d / F.speed), males, dist: d,
  };
  world.exp.flights.push(f);
  AL.emit(world, 'royalTakeoff', { col: ci, x: c.x, y: c.y, tx: x, ty: y, males, flight: f.id });
  return f;
}
// army ants: the colony splits. The new queen walks to (x, y) with a share of the colony and they form a second
// bivouac there (a satellite that is founded quickly: her workers came with her)
function split(world, ci, x, y) {
  const c = world.colonies[ci], A = world.ants, R = world.R, P = CFG.split, S = CFG.sat;
  if (totalPop(c) < P.minPop) return null;
  c.royal.queens--;
  const sat = {
    id: world.exp.uid++, col: ci, x, y, hp: S.hp, maxHp: S.hp,
    queen: { alive: true, hp: S.queenHp, maxHp: S.queenHp, i: -1, traits: {} },
    state: 'founding', found: 0, foundT: P.foundT, males: 0, split: true,
    soil: 2, moundR: 0, terrR: 120, age: 0, broodAcc: 0, kids: [], born: 0, underAttack: 0, ruinT: 0, by: -1, t0: world.t,
  };
  sat.moundR = satR(sat);
  c.satellites.push(sat);
  // who goes: a share of everyone but the old queen, the nurses and her repletes
  const want = Math.min(P.max, Math.round(totalPop(c) * P.share));
  const go = [];
  if (c.nest) {
    for (let i = 0; i < A.high && go.length < want; i++) {
      if (!A.state[i] || A.col[i] !== ci || A.carry[i] || A.headless[i]) continue;
      const k = A.caste[i]; if (k === C.QUEEN || k === C.WINGED || k === C.NURSE || k === C.HONEYPOT) continue;
      if (A.layer[i] === AL.LAYER.NEST) {
        if (A.nest[i] !== ci || (A.state[i] !== ST.N_IDLE && A.state[i] !== ST.N_WORK && A.state[i] !== ST.N_GOTO) || R() < 0.5) continue;
        A.layer[i] = AL.LAYER.SURFACE; A.act[i] = 0; A.task[i] = 0;
        const a = R() * AL.TAU; A.x[i] = A.px[i] = c.x + AL.cos(a) * 8; A.y[i] = A.py[i] = c.y + AL.sin(a) * 8; A.a[i] = a;
      } else if (A.state[i] !== ST.WANDER && A.state[i] !== ST.HOMING) continue;
      go.push(i);
    }
  } else if (c.inside) {
    const ins = c.inside;
    for (let k = 0; k < AL.NCASTE && go.length < want; k++) {
      if (k === C.QUEEN || k === C.HONEYPOT || k === C.WINGED) continue;
      const n = Math.min(Math.floor(ins[k]), Math.round(ins[k] * P.share));
      for (let j = 0; j < n && go.length < want; j++) {
        const i = spawnAt(world, ci, k, c.x, c.y, R); if (i < 0) break;
        A.hp[i] = A.maxhp[i] = AL.CASTES[k].hp * (c.sp.hp || 1);
        ins[k]--; go.push(i);
      }
    }
  }
  for (const i of go) { A.state[i] = ST.X_GARRISON; A.tx[i] = x; A.ty[i] = y; A.str[i] = 28; A.timer[i] = 45; A.tgt[i] = -1; addKid(world, sat, i); }
  sat.born = 0;
  AL.emit(world, 'colonySplit', { col: ci, x, y, n: go.length, sat: sat.id });
  return { split: true, sat, n: go.length };
}
function bez(p0, p1, p2, t) { const u = 1 - t; return u * u * p0 + 2 * u * t * p1 + t * t * p2; }
function updateFlight(world, f, dt) {
  const F = CFG.flight;
  f.px = f.x; f.py = f.y; f.palt = f.alt; f.pa = f.a; f.pt = f.t;
  f.t += dt;
  const t1 = F.emerge, t2 = t1 + F.takeoff, t3 = t2 + f.cruise, t4 = t3 + F.descend;
  let nx = f.x, ny = f.y;
  if (f.t < t1) {                       // crawl from the entrance up onto the mound rim, wings buzzing
    f.phase = 'emerge'; const u = AL.smooth(f.t / t1);
    nx = AL.lerp(f.sx, f.rimX, u); ny = AL.lerp(f.sy, f.rimY, u); f.alt = 0;
  } else if (f.t < t2) {                // lift off
    f.phase = 'takeoff'; const u = (f.t - t1) / F.takeoff;
    f.alt = 1 - (1 - u) * (1 - u);
    const g = 0.04 * u; nx = bez(f.rimX, f.cx, f.ex, g); ny = bez(f.rimY, f.cy, f.ey, g);
  } else if (f.t < t3) {                // cruise along a curved path
    f.phase = 'cruise'; const u = 0.04 + 0.96 * AL.easeInOut((f.t - t2) / f.cruise);
    nx = bez(f.rimX, f.cx, f.ex, u); ny = bez(f.rimY, f.cy, f.ey, u);
    f.alt = 1 + AL.sin(f.t * 2.2) * 0.06;
  } else if (f.t < t4) {                // spiral down onto the landing spot
    f.phase = 'descend'; const u = (f.t - t3) / F.descend;
    const ang = f.ea + f.spin * u * Math.PI * 2.4, r = F.spiral * (1 - AL.smooth(u));
    nx = f.tx + AL.cos(ang) * r; ny = f.ty + AL.sin(ang) * r;
    f.alt = 1 - AL.smooth(u);
  } else { land(world, f); return false; }
  const mdx = nx - f.x, mdy = ny - f.y;
  if (mdx * mdx + mdy * mdy > 0.0004) f.a = AL.atan2(mdy, mdx);
  f.x = nx; f.y = ny;
  return true;
}
function land(world, f) {
  const c = world.colonies[f.col], S = CFG.sat;
  const sat = {
    id: world.exp.uid++, col: f.col, x: f.tx, y: f.ty, hp: S.hp, maxHp: S.hp,
    queen: { alive: true, hp: S.queenHp, maxHp: S.queenHp, i: -1, traits: {} },
    state: 'founding', found: 0, foundT: S.foundT * (1 - S.maleBonus * f.males), males: f.males,
    soil: 2, moundR: 0, terrR: 120, age: 0, broodAcc: 0, kids: [], born: 0, underAttack: 0, ruinT: 0, by: -1, t0: world.t,
  };
  sat.moundR = satR(sat);
  applySite(world, c, sat);
  c.satellites.push(sat);
  AL.emit(world, 'royalLanded', { col: f.col, x: f.tx, y: f.ty, sat: sat.id });
}

// landing on (or next to) one of the Founding stage's marked sites gives that site's modifiers
function applySite(world, c, sat) {
  const sites = world.surface.foundingSites;
  if (!sites || !AL.Sites || !AL.Sites.siteAt) return;
  const site = AL.Sites.siteAt(sites, sat.x, sat.y, 90);
  if (!site || (site.taken >= 0 && site.taken !== c.id)) return;
  const m = AL.Sites.modsFor(site.id, c.spKey);
  sat.site = site.id; sat.siteName = site.name; sat.mods = m;
  sat.maxHp = sat.hp = Math.round(CFG.sat.hp * (m.defence || 1));
  site.taken = c.id;
}

// ---- satellites ---------------------------------------------------------------------------
function spawnAt(world, ci, caste, x, y, R) {
  const a = R() * AL.TAU, d = 4 + R() * 6;
  return world.ants.spawn(ci, caste, AL.LAYER.SURFACE, x + AL.cos(a) * d, y + AL.sin(a) * d, a, R);
}
function sweepKids(world, s) {
  const A = world.ants; let w = 0;
  for (let k = 0; k < s.kids.length; k += 2) { const i = s.kids[k]; if (A.state[i] && A.uid[i] === s.kids[k + 1]) { s.kids[w++] = i; s.kids[w++] = s.kids[k + 1]; } }
  s.kids.length = w;
  return w / 2;
}
function addKid(world, s, i) { if (i >= 0) { s.kids.push(i, world.ants.uid[i]); s.born++; s.soil += 0.7; s.moundR = satR(s); } }
function updateSatellite(world, c, s, dt) {
  const S = CFG.sat, R = world.R;
  if (s.underAttack > 0) s.underAttack -= dt;
  if (s.state === 'founding') {
    s.found += dt / s.foundT;
    s.soil = 2 + s.found * 6; s.moundR = satR(s);
    if (s.found >= 1) finishFounding(world, c, s);
    return;
  }
  if (s.state === 'ruin') { s.ruinT -= dt; return; }
  if (s.state === 'orphan') {
    s.hp -= s.maxHp / S.orphanLife * dt;
    if (s.hp <= 0) ruin(world, c, s, -1);
    return;
  }
  // active: queen lays, colony stock pays, living-ant cap grows with age
  s.age += dt;
  if (s.home != null) {   // its own nest: life.js runs it; keep the record in step
    s.terrR = Math.min(S.terrMax, S.terr0 + Math.sqrt(Math.max(0, (s.living || 0))) * 16);
    syncHome(world, c, s);
    if (s.queen && !s.queen.alive && s.state === 'active') { s.state = 'orphan'; AL.emit(world, 'satelliteOrphaned', { col: c.id, sat: s.id }); }
    return;
  }
  s.terrR = Math.min(S.terrMax, S.terr0 + Math.sqrt(s.born) * 16);
  if (s.queen.alive) s.queen.hp = Math.min(s.queen.maxHp, s.queen.hp + 0.5 * dt);
  if (c.out) return;
  s.broodAcc += dt * (c.sp.breed || 1) * ((s.mods && s.mods.warmth) || 1);
  if (s.broodAcc < S.broodEvery) return;
  const living = sweepKids(world, s), cap = Math.min(S.capMax, S.cap0 + s.age / S.growEvery);
  if (living >= cap || !hasStock(c, S.cost)) { s.broodAcc = S.broodEvery; return; }
  s.broodAcc -= S.broodEvery;
  pay(c, S.cost);
  const n = s.born % 6, caste = n === 5 && c.stock.protein > 30 ? C.SOLDIER : n % 3 === 2 ? C.WORKER : C.FORAGER;
  addKid(world, s, spawnAt(world, c.id, caste, s.x, s.y, R));
}
// ---- satellites with their own nest (colonies with a detailed nest: people's and AI rivals with real nests) --------
// The satellite becomes its own underground colony: its own tunnels, queen ant, brood and food store (nothing shared
// with the capital); ants born or living there belong to it (A.home). It is a "home": an object that inherits the
// colony (same id, species, research, orders) with its own nest and stock (world.homes[s.home]).
const OWN = ['stock', 'aphids', '_honeydew', 'pop', 'hunger', 'queens2', 'queenX', 'honey', 'sugarFlow', '_sugIn', '_sugAte', '_sugUse', '_sugConv', 'broodLayout', '_raidT', 'starving', 'disease', 'spoiled', 'gone', 'broodFood', 'capHost'];
function addHome(world, c, s) {
  if (!c.nest || !AL.Life || !AL.Life.initColony || s.home != null) return null;
  const H = world.homes; if (!H || H.length >= 250) return null;
  const h = Object.create(c);
  for (const k of OWN) h[k] = null;
  h.hid = H.length; h.sat = s; h.parent = c; h.gone = false; h.queenX = 0; h.honey = 0; h.starving = false; h.disease = 0; h.spoiled = 0;
  h.x = s.x; h.y = s.y; h.moundSoil = Math.max(10, s.soil || 10); AL.Colony.updateMound(h);
  h.pop = new Int32Array(AL.NCASTE); h.surf = 0; h.inNest = 0;
  // the queen flew off with reserves: a small store of her own, from the capital's
  const take = k => { const v = Math.min(S_TAKE[k], (c.stock[k] || 0) * 0.25); c.stock[k] -= v; return v; };
  h.stock = { sugar: 0, protein: 0, water: 0, seeds: 0, leaves: 0, fungus: 0 };
  const st = { sugar: 30 + take('sugar'), protein: 20 + take('protein'), water: 15 };
  H.push(h);
  AL.Life.initColony(world, h, { start: { workers: CFG.sat.nanitics + CFG.sat.homeWorkers, stock: st, brood: [{ caste: C.WORKER, stage: 0 }, { caste: C.WORKER, stage: 0 }, { caste: C.WORKER, stage: 1 }] }, siteTraits: c.siteTraits, queenTraits: (s.queen && s.queen.traits) || {} });
  h.stock.sugar = st.sugar; h.stock.protein = st.protein; h.stock.water = st.water;   // (initColony's default start stock is the capital's, not hers)
  // orders and alarms stay the colony's (one list, each tagged with the nest it is for: orders.js hid), so the
  // satellite reads the capital's lists rather than keeping copies of its own
  delete h.orders; delete h.hotspots;
  const A = world.ants, qi = h.queen.i;
  if (qi >= 0 && s.queen) { const f = s.queen.maxHp ? AL.clamp(s.queen.hp / s.queen.maxHp, 0.2, 1) : 1; A.hp[qi] = A.maxhp[qi] * f; h.queen.hp = A.hp[qi]; }
  s.home = h.hid;
  // enemies at its door go down and fight in its tunnels, as at any real nest (ai.js tickAI, orders.js breakIn)
  h.siegeIn = AL.Sim.siegeInHere;
  if (world.detailedHomes) world.detailedHomes.push(h.hid); else world.detailedHomes = [h.hid];
  AL.emit(world, 'homeFounded', { col: c.id, hid: h.hid, sat: s.id, x: s.x, y: s.y });
  return h;
}
const S_TAKE = { sugar: 40, protein: 25 };
// keep the satellite record and its home in step (queen, mound, head count); a dead queen orphans it
function syncHome(world, c, s) {
  const h = world.homes[s.home]; if (!h) return;
  if (s.queen) { s.queen.alive = !!(h.queen && h.queen.alive); s.queen.hp = h.queen ? h.queen.hp : 0; }
  s.moundR = h.moundR; s.soil = h.moundSoil;
  s.born = h.stats ? s.born : s.born;
  s.living = h.pop.reduce((a, b) => a + b, 0);
}
// the satellite is gone (ruined): its ants go home to the capital, its nest is closed
function closeHome(world, c, s) {
  const h = world.homes[s.home]; if (!h || h.gone) return;
  h.gone = true;
  const A = world.ants, R = world.R;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== c.id) continue;
    if (A.home[i] === h.hid) A.home[i] = c.hid;
    if (A.layer[i] === AL.LAYER.NEST && A.nest[i] === h.hid) {
      if (A.caste[i] === C.QUEEN) { A.kill(i); continue; }
      const a = R() * AL.TAU; A.layer[i] = AL.LAYER.SURFACE; A.nest[i] = c.hid; A.x[i] = A.px[i] = h.x + AL.cos(a) * 6; A.y[i] = A.py[i] = h.y + AL.sin(a) * 6; A.state[i] = ST.HOMING; A.timer[i] = 0; A.carry[i] = 0;
    }
  }
  h.queen.alive = false; h.brood.length = 0;
}
function finishFounding(world, c, s) {
  if (c.nest && addHome(world, c, s)) {   // its own underground colony
    s.state = 'active'; s.found = 1; s.terrR = CFG.sat.terr0; s.born = 0;
    c.expStats.satFounded++;
    AL.emit(world, 'satelliteFounded', { col: c.id, sat: s.id, x: s.x, y: s.y, home: s.home });
    return;
  }
  s.state = 'active'; s.found = 1; s.soil = 10; s.moundR = satR(s); s.terrR = CFG.sat.terr0;
  for (let k = 0; k < CFG.sat.nanitics; k++) addKid(world, s, spawnAt(world, c.id, k % 2 ? C.WORKER : C.FORAGER, s.x, s.y, world.R));
  s.born = 0;
  c.expStats.satFounded++;
  AL.emit(world, 'satelliteFounded', { col: c.id, sat: s.id, x: s.x, y: s.y });
}
function ruin(world, c, s, by) {
  if (s.state === 'ruin') return;
  const had = s.queen && s.queen.alive;
  if (s.queen) { s.queen.alive = false; s.queen.hp = 0; }
  s.state = 'ruin'; s.hp = 0; s.ruinT = CFG.sat.ruinTime; s.by = by;
  if (s.home != null) closeHome(world, c, s);
  c.expStats.satLost++;
  if (by >= 0 && world.colonies[by]) {
    world.colonies[by].expStats.nestsRazed++;
    if (world.colonies[by].sp.slaver && hooks.broodTheft) hooks.broodTheft(world, world.colonies[by], c, s);
  }
  AL.emit(world, 'satelliteLost', { col: c.id, sat: s.id, x: s.x, y: s.y, by, queen: had });
}

// ---- siege: enemies swarming an entrance wear it down, then the queen ------------------------
// (a stand-in until core combat fights at nests; also how raid-tunnel parties and garrisons do damage)
function siegeMainOn(world, c) { return CFG.siegeMain === 'auto' ? !c.nest && !c.siegeIn : !!CFG.siegeMain; }
function siege(world) {
  const cols = world.colonies, NC = cols.length, A = world.ants, SG = CFG.siege;
  const tg = [];
  for (const c of cols) {
    if (!c.out && c.queen.alive && siegeMainOn(world, c)) tg.push({ c, s: null, x: c.x, y: c.y, r: c.moundR + SG.pad });
    for (const s of c.satellites) if (s.state !== 'ruin' && s.home == null) tg.push({ c, s, x: s.x, y: s.y, r: (s.moundR || 14) + SG.pad });   // (a satellite with its own nest is fought for in its tunnels)
  }
  if (!tg.length) return;
  const pres = new Float32Array(tg.length * NC);
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== 0) continue;
    const x = A.x[i], y = A.y[i], w = WEIGHT[A.caste[i]];
    if (!w) continue;
    for (let k = 0; k < tg.length; k++) {
      const t = tg[k], dx = x - t.x, dy = y - t.y;
      if (dx > t.r || dx < -t.r || dy > t.r || dy < -t.r || dx * dx + dy * dy > t.r * t.r) continue;
      pres[k * NC + A.col[i]] += w;
    }
  }
  for (let k = 0; k < tg.length; k++) {
    const t = tg[k], c = t.c, s = t.s;
    let E = 0, by = -1, bv = 0;
    for (let o = 0; o < NC; o++) { if (o === c.id) continue; const v = pres[k * NC + o]; E += v; if (v > bv) { bv = v; by = o; } }
    const D = pres[k * NC + c.id];
    t.E = E; t.D = D;
    if (s && s.state === 'founding') {
      if (E >= 0.5) { s.queen.hp -= SG.foundingDmg * E; s.underAttack = 3; warn(world, c, s); if (s.queen.hp <= 0) ruin(world, c, s, by); }
      continue;
    }
    const q = s ? s.queen : c.queen;
    if (E >= 1 && E > D * 0.9) {
      const p = E - D * 0.7;
      if (s) { s.hp -= p * SG.structDmg; s.underAttack = 3; } else { c.mainHp -= p * SG.structDmg; c.underAttack = 3; }
      warn(world, c, s);
      const hp = s ? s.hp : c.mainHp;
      if (hp <= 0) {
        if (s) s.hp = 0; else c.mainHp = 0;
        if (q && q.alive) {
          if (s) { q.hp -= p * SG.queenDmg; if (q.hp <= 0) { q.hp = 0; ruin(world, c, s, by); } }
          else hurtQueen(world, c.id, null, p * SG.queenDmg, by);
        } else if (s && s.state === 'orphan') ruin(world, c, s, by);
      }
    } else if (E < 0.5) {
      if (s) s.hp = Math.min(s.maxHp, s.hp + SG.regen); else c.mainHp = Math.min(c.mainMaxHp, c.mainHp + SG.regen);
    }
  }
}
function warn(world, c, s) {
  if (world.t - c._warn < CFG.siege.warnEvery) return;
  c._warn = world.t;
  AL.emit(world, 'nestUnderAttack', { col: c.id, sat: s ? s.id : 0, x: s ? s.x : c.x, y: s ? s.y : c.y });
}
// is there a real queen ant for this colony (nest model)?
function queenAnt(world, c) {
  const q = c.queen, A = world.ants;
  return q && q.i >= 0 && A.state[q.i] && A.caste[q.i] === C.QUEEN && A.col[q.i] === c.id ? q.i : -1;
}
// for the core / combat: hurt a nest's queen directly (sat = null for the capital)
function hurtQueen(world, ci, sat, dmg, by) {
  const c = world.colonies[ci], q = sat ? sat.queen : c.queen;
  if (!q || !q.alive) return;
  const qi = sat ? -1 : queenAnt(world, c);
  if (qi >= 0 && AL.Combat && AL.Combat.hitAnt) { AL.Combat.hitAnt(world, qi, dmg, 'fight'); if (!c.queen.alive) mainQueenDied(world, c, by == null ? -1 : by, 'core'); return; }
  q.hp -= dmg;
  if (q.hp <= 0) { q.hp = 0; if (sat) ruin(world, c, sat, by == null ? -1 : by); else mainQueenDied(world, c, by == null ? -1 : by, 'hurt'); }
}

// ---- queen death, takeover, colony out ----------------------------------------------------
function livingQueens(world, c) {
  let n = c.queen && c.queen.alive && !c.out ? 1 : 0;
  if (!c.out && AL.Life && AL.Life.extraQueens) n += AL.Life.extraQueens(c);   // polygyne: extra queens at home
  for (const s of c.satellites) if (s.queen && s.queen.alive && (s.state === 'active' || s.state === 'founding')) n++;
  for (const f of world.exp.flights) if (f.col === c.id) n++;
  return n + c.royal.queens;
}
function mainQueenDied(world, c, by, cause) {
  if (c.out) return;
  if (c.queen.alive || !c.interregnum) {
    c.queen.alive = false; c.queen.hp = 0; c.interregnum = true; c.royal.queue.length = 0;
    if (cause !== 'core') AL.emit(world, 'queenDied', { col: c.id, colony: c, cause, by, byExpansion: true, handled: true });
  }
  // core AI nest: let the core finish its siege step first (it puts the attackers back on the surface at the
  // old capital); the succession runs on our next sim second
  if (cause === 'core' && c.siegeIn) return;
  resolveSuccession(world, c);
}
function takeoverCandidate(c) {
  let best = null, bv = -1;
  for (const s of c.satellites) {
    if (!s.queen || !s.queen.alive || (s.state !== 'active' && s.state !== 'founding')) continue;
    const v = (s.state === 'active' ? 1000 : 0) + s.kids.length * 10 + s.age + s.queen.hp * 0.01;
    if (v > bv) { bv = v; best = s; }
  }
  return best;
}
function resolveSuccession(world, c) {
  if (AL.Life && AL.Life.promoteQueen && AL.Life.promoteQueen(world, c)) return true;   // polygyne: another queen at home takes over
  const s = takeoverCandidate(c);
  if (s) return takeover(world, c, s);
  const waiting = c.royal.queens > 0 || world.exp.flights.some(f => f.col === c.id);
  if (!waiting) colonyOut(world, c);
}
// a satellite queen becomes the colony's queen and her nest the capital; the old capital (if standing)
// lives on as a queenless outpost until it crumbles
function takeover(world, c, s) {
  if (c.nest && AL.Nest) return adopt(world, c, s);
  const from = { x: c.x, y: c.y };
  if (c.mainHp > 0) {
    c.satellites.push({ id: world.exp.uid++, col: c.id, x: c.x, y: c.y, hp: Math.max(40, c.mainHp * 0.5), maxHp: c.mainMaxHp * 0.5, queen: null,
      state: 'orphan', found: 1, foundT: 1, males: 0, soil: c.moundSoil, moundR: c.moundR, terrR: c.terrR * 0.6, age: 0, broodAcc: 0, kids: [], born: 0, underAttack: 0, ruinT: 0, by: -1, t0: world.t });
  }
  if (s.state === 'founding') finishFounding(world, c, s);
  c.satellites.splice(c.satellites.indexOf(s), 1);
  c.x = s.x; c.y = s.y;
  c.moundSoil = Math.max(20, s.soil * 1.5); AL.Colony.updateMound(c);
  // she becomes the colony queen: keep the core's queen record (AI fields such as layT/abstract) and refill it
  const q = c.queen, maxHp = Math.max(s.queen.maxHp, (q.maxHp || s.queen.maxHp) * 0.6);
  Object.assign(q, { alive: true, maxHp, hp: Math.max(s.queen.hp, maxHp * 0.5), i: -1 });
  if (q.layT != null) q.layT = Math.max(q.layT, 2);
  s.queen = null; c.interregnum = false; c.alive = true;
  c.mainMaxHp = CFG.main.hp * 0.7; c.mainHp = c.mainMaxHp;
  c.expStats.takeovers++;
  AL.emit(world, 'queenTakeover', { col: c.id, mode: 'move', from, to: { x: s.x, y: s.y }, sat: s.id });
  return true;
}
// with a detailed nest (the player's), the capital stays put: the satellite queen is escorted home along the
// linked trail and settles in the royal chamber; her old satellite carries on queenless
function adopt(world, c, s) {
  const N = AL.Nest, nest = c.nest, A = world.ants;
  if (nest.fieldDirty) N.rebuild(nest);
  const qt = nest.tiles[N.CH.QUEEN];
  const tile = qt.length ? qt[(qt.length / 2) | 0] : N.idx(nest, nest.entrance.c, Math.min(nest.rows - 1, 6));
  const [qx, qy] = N.centre(nest, tile);
  const qi = A.spawn(c.id, C.QUEEN, AL.LAYER.NEST, qx, qy, 0, world.R);
  if (qi < 0) return false;
  const traits = (c.queen && c.queen.traits) || {}, max = AL.CASTES[C.QUEEN].hp * (traits.hpMul || 1);
  A.maxhp[qi] = max; A.hp[qi] = Math.max(s.queen.hp / s.queen.maxHp, 0.5) * max;
  A.state[qi] = ST.N_QUEEN; A.life[qi] = 1e9;
  c.queen = { alive: true, hp: A.hp[qi], maxHp: max, i: qi, layT: 2, traits };
  c.interregnum = false; c.alive = true;
  if (s.state === 'founding') finishFounding(world, c, s);
  s.queen = null; s.state = 'orphan';
  c.expStats.takeovers++;
  AL.emit(world, 'queenTakeover', { col: c.id, mode: 'adopt', from: { x: s.x, y: s.y }, to: { x: c.x, y: c.y }, sat: s.id });
  return true;
}
function colonyOut(world, c) {
  if (c.out) return;
  c.out = { t: world.t };
  c.queen.alive = false; c.interregnum = false;
  c.royal.queue.length = 0; c.royal.males = 0;
  for (const s of c.satellites) if (s.state === 'active' || s.state === 'founding') { s.state = 'orphan'; if (s.queen) s.queen.alive = false; }
  AL.emit(world, 'colonyOut', { col: c.id, x: c.x, y: c.y });
  if (world.mp && c.isPlayer) AL.emit(world, 'playerOut', { col: c.id, name: c.name });
}
// workers fight on for a while, then the colony fades away
function fade(world, c) {
  if (world.t - c.out.t < CFG.out.fadeDelay) return;
  const A = world.ants, R = world.R; let left = 0, k = 0;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== c.id) continue;
    if (R() < CFG.out.fadeRate) {
      if (A.layer[i] === 0 && (k++ % 3) === 0) AL.Surface.dropCorpse(world.surface, A.x[i], A.y[i], c.id, 1);
      if (AL.Combat && AL.Combat.killAnt) AL.Combat.killAnt(world, i, 'age'); else A.kill(i);
    } else left++;
  }
  if (!left && c.alive) { c.alive = false; AL.emit(world, 'colonyGone', { col: c.id }); }
}

// ---- garrison / rally (custom surface state) ------------------------------------------------
// A.tx/ty = spot, A.str = radius, A.timer = seconds left
function garrisonHandler(world, i, dt, sense) {
  const A = world.ants, R = world.R;
  A.timer[i] -= dt;
  if (A.timer[i] <= 0) { A.state[i] = ST.HOMING; A.timer[i] = 0; A.str[i] = 0; return 0; }
  if (A.wf[i] > 0) { A.wf[i] -= dt; return 0; }
  if (!sense) return 0;
  const dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i], r = A.str[i], d2 = dx * dx + dy * dy;
  // rallied onto a rival mound whose nest the core simulates: go in and fight (core siege / nest raid)
  if (A.col[i] !== undefined) {
    for (const o of (world.homes || world.colonies)) {   // (satellites with their own nest too)
      if (!o || o.id === A.col[i] || o.out || o.gone || !o.siegeIn) continue;
      const rr = o.moundR * 0.45 + 8;
      if (AL.dist2(A.x[i], A.y[i], o.x, o.y) < rr * rr && AL.dist2(A.tx[i], A.ty[i], o.x, o.y) < (o.moundR + 60) * (o.moundR + 60)) { o.siegeIn(world, i); return 2; }
    }
  }
  const ta = AL.atan2(dy, dx), da = AL.wrap(ta - A.a[i]);
  if (d2 > r * r) A.turn[i] = AL.clamp(da * 4, -5, 5) + (R() - 0.5);
  else A.turn[i] = A.turn[i] * 0.5 + (R() - 0.5) * 5 + (d2 > r * r * 0.5 ? da * 2 : 0);
  return 0;
}
// send up to n of a colony's idle surface ants (fighters first, nearest first) to hold a spot
function garrison(world, ci, x, y, r, n, secs) {
  const A = world.ants, pick = [];
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== ci || A.layer[i] !== 0 || A.carry[i]) continue;
    const st = A.state[i];
    if (st !== ST.WANDER && st !== ST.HOMING && st !== ST.X_GARRISON && st !== ST.GUARD) continue;
    const ca = A.caste[i]; if (ca === C.QUEEN || ca === C.WINGED || ca === C.NURSE || ca === C.HONEYPOT) continue;
    if (st === ST.X_GARRISON && AL.dist2(A.tx[i], A.ty[i], x, y) < r * r) continue;   // already there
    const fighter = ca === C.SOLDIER || ca === C.MAJOR ? 0 : 1;
    pick.push(fighter * 1e9 + AL.dist2(A.x[i], A.y[i], x, y), i);
  }
  const idx = []; for (let k = 0; k < pick.length; k += 2) idx.push(k);
  idx.sort((a, b) => pick[a] - pick[b]);
  let sent = 0;
  for (const k of idx) {
    if (sent >= n) break;
    const i = pick[k + 1];
    A.state[i] = ST.X_GARRISON; A.tx[i] = x; A.ty[i] = y; A.str[i] = r; A.timer[i] = secs || 90; A.tgt[i] = -1;
    sent++;
  }
  if (sent) AL.emit(world, 'rally', { col: ci, x, y, r, n: sent });
  return sent;
}

// ---- raid tunnels (late research) ------------------------------------------------------------
// Deep tunnelling is the 'tunnel' node of the research tree (research.js): these wrappers keep the old API.
function canResearch(world, ci) {
  if (world.colonies[ci].sp.nomad) return { ok: false, why: 'Army ants don\'t dig: they raid in the open' };
  if (world.colonies[ci].research.tunnel >= 1) return { ok: false, why: 'Already known' };
  return AL.Research ? AL.Research.can(world, ci, 'tunnel') : { ok: false, why: 'No research tree' };
}
function research(world, ci) { return AL.Research ? AL.Research.start(world, ci, 'tunnel') : false; }
// every rival entrance a tunnel could aim for: { col, sat (0 = capital), x, y }
function tunnelTargets(world, ci) {
  const out = [];
  for (const o of world.colonies) {
    if (o.id === ci || o.out) continue;
    if (o.queen.alive) out.push({ col: o.id, sat: 0, x: o.x, y: o.y });
    for (const s of o.satellites) if (s.state === 'active' || s.state === 'founding' || s.state === 'orphan') out.push({ col: o.id, sat: s.id, x: s.x, y: s.y });
  }
  return out;
}
function findNest(world, col, sat) {
  const o = world.colonies[col]; if (!o) return null;
  if (!sat) return o.out ? null : o;
  for (const s of o.satellites) if (s.id === sat && s.state !== 'ruin') return s;
  return null;
}
function tunnelPlan(world, ci, col, sat) {
  const c = world.colonies[ci], T = CFG.tunnel, tgt = findNest(world, col, sat);
  if (!tgt) return { ok: false, why: 'No such nest' };
  if (c.sp.nomad) return { ok: false, why: 'Army ants don\'t dig: they raid in the open' };
  if (c.research.tunnel < 1) return { ok: false, why: 'Research deep tunnelling first' };
  if (c.out) return { ok: false, why: 'Colony is gone' };
  if (world.exp.tunnels.some(t => t.col === ci && t.state === 'dig')) return { ok: false, why: 'Already digging a tunnel' };
  const from = homeOf(c, tgt.x, tgt.y), len = AL.hypot(tgt.x - from.x, tgt.y - from.y);
  if (len > T.maxLen) return { ok: false, why: 'Too far to dig' };
  if (c.surf < T.diggers + 4) return { ok: false, why: 'Needs ' + (T.diggers + 4) + ' ants outside' };
  if (!hasStock(c, T.cost)) return { ok: false, why: 'Needs ' + T.cost.protein + ' protein, ' + T.cost.sugar + ' sugar' };
  const eta = len / (T.speed * (c.sp.dig || 1));
  return { ok: true, from, tgt, len, eta };
}
function orderTunnel(world, ci, col, sat) {
  const p = tunnelPlan(world, ci, col, sat); if (!p.ok) return null;
  const c = world.colonies[ci], T = CFG.tunnel, A = world.ants;
  pay(c, T.cost);
  // the crew goes underground: diggers (nearest to the origin) and a raid party (fighters first)
  const cand = [];
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== ci || A.layer[i] !== 0 || A.state[i] === ST.DRAG) continue;
    const ca = A.caste[i]; if (ca === C.QUEEN || ca === C.WINGED) continue;
    cand.push(i);
  }
  cand.sort((a, b) => AL.dist2(A.x[a], A.y[a], p.from.x, p.from.y) - AL.dist2(A.x[b], A.y[b], p.from.x, p.from.y));
  const crew = [], used = new Set();
  for (const i of cand) { if (crew.length >= T.diggers) break; if (A.caste[i] === C.WORKER || A.caste[i] === C.FORAGER) { crew.push(A.caste[i]); used.add(i); } }
  const fighters = cand.filter(i => !used.has(i)).sort((a, b) => WEIGHT[A.caste[b]] - WEIGHT[A.caste[a]]);
  for (const i of fighters) { if (crew.length >= T.diggers + T.party) break; crew.push(A.caste[i]); used.add(i); }
  for (const i of used) A.kill(i);
  const t = {
    id: world.exp.uid++, col: ci, tcol: col, tsat: sat, x0: p.from.x, y0: p.from.y, from: p.from === c ? 0 : p.from.id,
    x1: p.tgt.x, y1: p.tgt.y, len: p.len, prog: 0, crew, diggers: Math.min(T.diggers, crew.length), state: 'dig', warned: false, t0: world.t,
  };
  world.exp.tunnels.push(t);
  c.expStats.tunnels++;
  AL.emit(world, 'tunnelStarted', { col: ci, target: col, sat, x: t.x1, y: t.y1, eta: p.eta });
  return t;
}
function updateTunnel(world, t, dt) {
  if (t.state !== 'dig') return;
  const c = world.colonies[t.col], T = CFG.tunnel;
  const tgt = findNest(world, t.tcol, t.tsat);
  const origin = t.from ? c.satellites.find(s => s.id === t.from && s.state !== 'ruin') : (c.out ? null : c);
  if (!tgt || !origin) {
    // target gone (crew climbs out at home) or origin lost (crew emerges at the nearest surviving entrance)
    t.state = 'failed';
    const h = c.out ? null : homeOf(c, t.x0, t.y0);
    if (h) for (const ca of t.crew) spawnAt(world, c.id, ca, h.x, h.y, world.R);
    AL.emit(world, 'tunnelFailed', { col: t.col, target: t.tcol });
    return;
  }
  t.x1 = tgt.x; t.y1 = tgt.y;
  t.prog += dt * T.speed * Math.sqrt(t.diggers / T.diggers) * (c.sp.dig || 1) / t.len;
  if (!t.warned && t.prog >= T.warnAt) {
    t.warned = true;
    const o = world.colonies[t.tcol];
    if (tgt === o && o.nest && AL.Nest) { const p = nestPlan(world, t, o); if (p) t.plan = p.path.map(q => q.r * o.nest.cols + q.c); }
    AL.emit(world, 'tunnelTremor', { col: t.col, target: t.tcol, sat: t.tsat, x: t.x1, y: t.y1 });
  }
  if (t.prog >= 1) breach(world, t, tgt);
}
function breach(world, t, tgt) {
  t.prog = 1; t.state = 'done'; t.tDone = world.t;
  const c = world.colonies[t.col], o = world.colonies[t.tcol];
  let handled = hooks.breach ? hooks.breach(world, t, t.crew.slice()) : false;
  if (!handled && tgt === o && o.nest && AL.Nest) handled = nestBreach(world, t);
  if (!handled && tgt === o && o.siege && o.inside) {
    // the core AI's abstract nest: the raid party comes up inside and joins the fight there (core siegeTick)
    for (const ca of t.crew) o.siege[ca] += 1;
    o.siegeBy = t.col; handled = true;
    AL.emit(world, 'siege', { col: o.id, by: t.col });
  }
  if (!handled) {
    // fallback: the raid party bursts out of the ground right at the target's entrance and holds it
    const r = (tgt.moundR || 20) + 25;
    for (const ca of t.crew) {
      const i = spawnAt(world, c.id, ca, tgt.x, tgt.y, world.R);
      if (i < 0) continue;
      const A = world.ants;
      A.state[i] = ST.X_GARRISON; A.tx[i] = tgt.x; A.ty[i] = tgt.y; A.str[i] = r; A.timer[i] = 150;
    }
  }
  // the tunnel undermines the nest's defences
  if (tgt === o) o.mainHp = Math.max(0, o.mainHp - o.mainMaxHp * CFG.tunnel.undermine);
  else tgt.hp = Math.max(0, tgt.hp - tgt.maxHp * CFG.tunnel.undermine);
  if (c.sp.slaver && hooks.broodTheft) hooks.broodTheft(world, c, o, tgt === o ? null : tgt);
  AL.emit(world, 'tunnelBreach', { col: t.col, target: t.tcol, sat: t.tsat, x: tgt.x, y: tgt.y, crew: t.crew.length, handled });
}

// ---- raid tunnels into a nest grid (the player's detailed nest) -------------------------------
function nestGrid(nest, goal) {
  const N = AL.Nest;
  return { cols: nest.cols, rows: nest.rows, queen: { c: goal % nest.cols, r: (goal / nest.cols) | 0 },
    dig(c, r) { const k = nest.kind[r * nest.cols + c]; return k === N.TILE.OPEN ? 0 : N.HARD[k]; } };
}
function nestGoal(world, o) {
  const N = AL.Nest, nest = o.nest, qi = queenAnt(world, o);
  if (qi >= 0) return N.tileOf(nest, world.ants.x[qi], world.ants.y[qi]);
  const qt = nest.tiles[N.CH.QUEEN]; if (qt.length) return qt[0];
  return nest.entrance.r * nest.cols + nest.entrance.c;
}
// dig in from the side facing the attacker, at least a few rows down
function nestPlan(world, t, o) { return planBreach(nestGrid(o.nest, nestGoal(world, o)), t.x0 < o.x ? -1 : 1); }
function nestBreach(world, t) {
  const o = world.colonies[t.tcol], nest = o.nest, N = AL.Nest, A = world.ants, R = world.R;
  const plan = nestPlan(world, t, o); if (!plan) return false;
  for (const p of plan.dig) N.carve(nest, p.c, p.r, p.c, p.r, 0);
  nest.fieldDirty = true; nest.version++; nest.layoutVersion = (nest.layoutVersion || 0) + 1;
  const path = plan.path.map(q => q.r * nest.cols + q.c);
  // core M3 has nest raiders (ST.N_RAID: flow field to the queen, defenders swarm them); else our own fallback
  const coreRaid = !!nest && o.isPlayer && !!(world.nestHandlers && world.nestHandlers[ST.N_RAID]) && ST.N_RAID != null;
  if (coreRaid) N.rebuild(nest);
  const raid = { id: t.id, col: t.col, tcol: t.tcol, path, ants: [], t0: world.t, life: 200 };
  const [x0, y0] = N.centre(nest, path[0]);
  for (const ca of t.crew) {
    const i = A.spawn(t.col, ca, AL.LAYER.NEST, x0 + (R() - 0.5) * 6, y0 + (R() - 0.5) * 6, 0, R);
    if (i < 0) continue;
    A.nest[i] = t.tcol;   // inside the target's nest
    A.hp[i] = A.maxhp[i] = AL.CASTES[ca].hp * (world.colonies[t.col].sp.hp || 1);
    if (coreRaid) { A.state[i] = ST.N_RAID; A.task[i] = N.F.QUEEN; A.timer[i] = 0; A.tx[i] = A.x[i]; A.ty[i] = A.y[i]; continue; }
    A.state[i] = ST.X_NRAID; A.ty[i] = 0; A.timer[i] = R() * 1.5;   // timer: staggered start
    raid.ants.push(i, A.uid[i]);
  }
  if (!coreRaid) world.exp.raids.push(raid);
  t.breachPath = path;
  AL.emit(world, 'nestBreached', { col: t.col, target: t.tcol, c: plan.path[0].c, r: plan.path[0].r, n: raid.ants.length / 2 });
  return true;
}
// raiders walk the tunnel to the royal chamber and fight whatever they meet; defenders bite back
function updateRaids(world, dt) {
  const E = world.exp; if (!E.raids.length) return;
  const A = world.ants, N = AL.Nest, CB = AL.Combat, IJ = AL.Injury;
  for (let k = E.raids.length - 1; k >= 0; k--) {
    const r = E.raids[k], o = world.colonies[r.tcol], nest = o.nest, att = world.colonies[r.col];
    // live raiders
    const live = [];
    for (let j = 0; j < r.ants.length; j += 2) { const i = r.ants[j]; if (A.state[i] === ST.X_NRAID && A.uid[i] === r.ants[j + 1]) live.push(i); }
    if (!live.length || !nest || world.t - r.t0 > r.life) { for (const i of live) A.kill(i); E.raids.splice(k, 1); continue; }
    // defenders: the target colony's ants in its nest
    const def = [];
    for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === AL.LAYER.NEST && A.col[i] === r.tcol && A.nest[i] === r.tcol) def.push(i);
    const qi = queenAnt(world, o);
    for (const i of live) {
      A.px[i] = A.x[i]; A.py[i] = A.y[i];
      if (A.timer[i] > 0) { A.timer[i] -= dt; continue; }
      // nearest defender in reach
      let foe = -1, fd = 81;
      for (const d of def) { const dd = AL.dist2(A.x[i], A.y[i], A.x[d], A.y[d]); if (dd < fd) { fd = dd; foe = d; } }
      const info = AL.CASTES[A.caste[i]];
      if (foe >= 0) {
        A.a[i] = AL.atan2(A.y[foe] - A.y[i], A.x[foe] - A.x[i]); A.anim[i] += dt * 8;
        const dmg = info.dps * (att.sp.dps || 1) * dt;
        if (CB && CB.hitAnt) { if (!CB.hitAnt(world, foe, dmg, 'fight') && IJ) IJ.bite(world, foe, dmg, IJ.jawOf(att, A.caste[i]), 0); } else { A.hp[foe] -= dmg; if (A.hp[foe] <= 0) A.kill(foe); }   // (legs only: injury.js)
        if (world.R() < dt * 2) world.fxq.push(11, A.x[i], A.y[i], 0);
        continue;
      }
      // walk the tunnel, then go for the queen
      let tx, ty;
      const step = A.ty[i] | 0;
      if (step < r.path.length) { [tx, ty] = N.centre(nest, r.path[step]); }
      else if (qi >= 0) { tx = A.x[qi]; ty = A.y[qi]; }
      else { const w = N.wanderTile(nest, N.tileOf(nest, A.x[i], A.y[i]), world.R); if (w < 0) continue; [tx, ty] = N.centre(nest, w); A.ty[i] = r.path.length; }
      const dx = tx - A.x[i], dy = ty - A.y[i], d = AL.hypot(dx, dy), sp = info.speed * (att.sp.speed || 1) * 0.55 * dt * (IJ ? IJ.mulOf(A, i) : 1);   // (lost legs slow it)
      if (d < 1.5) { if (step < r.path.length) A.ty[i] = step + 1; continue; }
      A.x[i] += dx / d * Math.min(sp, d); A.y[i] += dy / d * Math.min(sp, d);
      A.a[i] += AL.wrap(AL.atan2(dy, dx) - A.a[i]) * Math.min(1, dt * 10); A.anim[i] += sp * 0.3;
    }
    // defenders within reach of a raider bite back (soldiers and majors hit hard)
    for (const d of def) {
      if (!A.state[d] || A.headless[d]) continue;   // (a headless ant can't bite)
      let foe = -1, fd = 81;
      for (const i of live) { if (!A.state[i]) continue; const dd = AL.dist2(A.x[i], A.y[i], A.x[d], A.y[d]); if (dd < fd) { fd = dd; foe = i; } }
      if (foe < 0) continue;
      const dmg = AL.CASTES[A.caste[d]].dps * (o.sp.dps || 1) * (((o.siteTraits || {}).defence) || 1) * dt;
      if (CB && CB.hitAnt) { if (!CB.hitAnt(world, foe, dmg, 'fight') && IJ) IJ.bite(world, foe, dmg, IJ.jawOf(o, A.caste[d]), 0); } else { A.hp[foe] -= dmg; if (A.hp[foe] <= 0) A.kill(foe); }
    }
  }
}

// Plan a raid tunnel through a side-view nest grid (the nest model's tiles), for hooks.breach.
// grid = { cols, rows, queen: { c, r }, and either
//          dig(c, r) -> 0 open tile, > 0 dig-time multiplier, Infinity (or <0) impassable
//          or tile(c, r) -> 0 open, 1 soil, 2 rock }
// side = -1 dig in from the left edge, +1 from the right. Row 0 (just under the lawn) is skipped.
// Returns { path:[{c,r}], dig:[{c,r}] (tiles that need digging), cost } or null if there is no way in.
function planBreach(grid, side) {
  const W = grid.cols, H = grid.rows, N = W * H, goal = grid.queen;
  if (!goal) return null;
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const cost = grid.dig
    ? (c, r) => { const d = grid.dig(c, r); return d === 0 ? 1 : (d < 0 || !isFinite(d)) ? Infinity : 1 + 2 * d; }
    : (c, r) => { const t = grid.tile(c, r); return t === 2 ? Infinity : t === 1 ? 3 : 1; };
  const needsDig = grid.dig ? (c, r) => grid.dig(c, r) > 0 : (c, r) => grid.tile(c, r) === 1;
  // binary heap of [d, idx]
  const hd = [], hi = [];
  const push = (d, i) => { hd.push(d); hi.push(i); let k = hd.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (hd[p] <= hd[k]) break; [hd[p], hd[k]] = [hd[k], hd[p]]; [hi[p], hi[k]] = [hi[k], hi[p]]; k = p; } };
  const pop = () => { const i = hi[0], d = hd[0], ld = hd.pop(), li = hi.pop(); if (hd.length) { hd[0] = ld; hi[0] = li; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hd.length && hd[l] < hd[m]) m = l; if (r < hd.length && hd[r] < hd[m]) m = r; if (m === k) break; [hd[m], hd[k]] = [hd[k], hd[m]]; [hi[m], hi[k]] = [hi[k], hi[m]]; k = m; } } return [d, i]; };
  const c0 = side < 0 ? 0 : W - 1;
  for (let r = 1; r < H; r++) { const k = cost(c0, r); if (k < Infinity) { const i = r * W + c0; dist[i] = k; push(k, i); } }
  const gi = goal.r * W + goal.c;
  while (hd.length) {
    const [d, i] = pop();
    if (done[i]) continue; done[i] = 1;
    if (i === gi) break;
    const c = i % W, r = (i / W) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 1 || nc >= W || nr >= H) continue;
      const ni = nr * W + nc, k = cost(nc, nr); if (k === Infinity || done[ni]) continue;
      const nd = d + k; if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = i; push(nd, ni); }
    }
  }
  if (dist[gi] === Infinity) return null;
  const path = [], dig = [];
  for (let i = gi; i >= 0; i = prev[i]) { const p = { c: i % W, r: (i / W) | 0 }; path.push(p); if (needsDig(p.c, p.r)) dig.push(p); }
  path.reverse(); dig.reverse();
  return { path, dig, cost: dist[gi] };
}

// adapter for the Founding stage's soil grid (AL.Sites.buildSoil output) -> planBreach grid
function gridFromSoil(soil, queen) {
  const TI = AL.Sites && AL.Sites.TILE_INFO, T = AL.Sites && AL.Sites.TILE;
  return {
    cols: soil.cols, rows: soil.rows, queen,
    dig(c, r) {
      const v = soil.tiles[r * soil.cols + c];
      if (!TI) return v ? 1 : 0;
      if (v === T.AIR || v === T.GALLERY) return 0;
      const d = TI[v] ? TI[v].dig : 1;
      return d > 0 ? d : Infinity;
    },
  };
}

// ---- AI policy ------------------------------------------------------------------------------
// Score a satellite site: food nearby, key points nearby, a sensible distance from home, not under enemy noses.
function scoreSite(world, ci, x, y) {
  const c = world.colonies[ci], S = world.surface;
  let s = 0;
  for (const f of S.foods) {
    if (f.gone || f.corpse || f.amount < 5) continue;
    const d = Math.sqrt(AL.dist2(f.x, f.y, x, y)); if (d > 450) continue;
    s += Math.min(f.max || f.amount, 300) / 300 * (1 - d / 450) * (f.regen ? 1.4 : 1);
  }
  const V = world.victory;
  if (V) for (const p of V.points) { const d = Math.sqrt(AL.dist2(p.x, p.y, x, y)); if (d < 520) s += 1.6 * (1 - d / 520); }
  let dh = 1e9; for (const h of homes(c)) dh = Math.min(dh, Math.sqrt(AL.dist2(h.x, h.y, x, y)));
  if (dh < 420) s -= 2 * (1 - dh / 420); if (dh > 1500) s -= (dh - 1500) / 400;
  for (const o of world.colonies) {
    if (o.id === ci || o.out) continue;
    for (const h of homes(o)) { const d = Math.sqrt(AL.dist2(h.x, h.y, x, y)); if (d < 650) s -= 3 * (1 - d / 650); }
  }
  return s;
}
function pickSite(world, ci) {
  const S = world.surface, R = world.R;
  let best = null, bv = -1e9;
  for (let y = 120; y < S.H - 100; y += 150) for (let x = 120; x < S.W - 100; x += 150) {
    const jx = x + (R() - 0.5) * 60, jy = y + (R() - 0.5) * 60;
    if (!siteCheck(world, ci, jx, jy).ok) continue;
    const v = scoreSite(world, ci, jx, jy) + R() * 0.05;
    if (v > bv) { bv = v; best = { x: jx, y: jy, score: v }; }
  }
  return best;
}
// What a colony wants for its late game. Performs expansion actions itself (royal brood, flights, research,
// tunnels) and returns intents for the lead's AI: { rally: [{ x, y, r, n, why }], actions: [...] }.
// opts.rally === false: don't send garrisons itself (the lead's AI moves armies).
function aiPolicy(world, ci, opts) {
  opts = opts || {};
  const c = world.colonies[ci], out = { rally: [], actions: [] };
  if (c.out) return out;
  const pop = totalPop(c), R = CFG.royal, M = CFG.ai.minProtein;
  const sats = satCount(world, ci);
  // 1. succession emergency: queen dead and a winged queen waiting -> fly now
  // 2. raise winged queens while there is room for more satellites
  if (c.queen.alive && pop >= R.minPop && c.royal.queue.length === 0 && sats + c.royal.queens < CFG.sat.max &&
      c.stock.protein >= R.queen.protein * M && c.stock.sugar >= R.queen.sugar * M) {
    if (orderRoyal(world, ci, 'queen')) out.actions.push('raise queen');
  } else if (c.queen.alive && !c.sp.nomad && pop >= R.minPop && c.royal.queue.length === 0 && c.royal.males < 1 && c.royal.queens > 0 &&
      c.stock.protein >= R.male.protein * 2) {
    if (orderRoyal(world, ci, 'male')) out.actions.push('raise male');
  }
  // 3. launch a waiting queen at the best site
  if (c.royal.queens > 0 && sats < CFG.sat.max) {
    const site = pickSite(world, ci);
    if (site && launch(world, ci, site.x, site.y)) out.actions.push('launch ' + Math.round(site.x) + ',' + Math.round(site.y));
  }
  // 4. raid tunnels against the weakest reachable rival nest (rivals research deep tunnelling through research.js)
  if (c.research.tunnel >= 1 && pop >= 60) {
    let best = null, bv = 1e9;
    for (const t of tunnelTargets(world, ci)) {
      if (AL.AI && AL.AI.knows && !AL.AI.knows(world, ci, t.col)) continue;   // colonies stage: rivals only tunnel to nests they have found
      const p = tunnelPlan(world, ci, t.col, t.sat); if (!p.ok) continue;
      const n = findNest(world, t.col, t.sat), q = n === world.colonies[t.col] ? n.queen : n.queen;
      const v = p.len * (q && q.alive ? q.hp / q.maxHp + 0.5 : 0.8) * (t.sat ? 0.8 : 1.2);
      if (v < bv) { bv = v; best = t; }
    }
    if (best && orderTunnel(world, ci, best.col, best.sat)) out.actions.push('tunnel ' + best.col + ':' + best.sat);
  }
  // 5. key points: hold what we own, take the nearest we don't
  const V = world.victory;
  if (V && world.t >= V.activeAt - 30) {
    const pts = V.points.map(p => ({ p, d: Math.min.apply(null, homes(c).map(h => AL.hypot(h.x - p.x, h.y - p.y))) })).sort((a, b) => a.d - b.d);
    let want = Math.floor(pts.length / 2) + 1;
    for (const { p } of pts) {
      if (want-- <= 0) break;
      out.rally.push({ x: p.x, y: p.y, r: p.r * 0.75, n: p.owner === ci ? Math.ceil(CFG.ai.rally / 2) : CFG.ai.rally, why: 'keypoint:' + p.id });
    }
  }
  if (opts.rally !== false) {
    const A = world.ants;
    for (const r of out.rally) {
      let have = 0;
      for (let i = 0; i < A.high; i++) if (A.state[i] === ST.X_GARRISON && A.col[i] === ci && AL.dist2(A.tx[i], A.ty[i], r.x, r.y) < 400) have++;
      if (have < r.n) garrison(world, ci, r.x, r.y, r.r, Math.min(r.n - have, Math.floor(c.surf * 0.25)), 120);
    }
  }
  return out;
}

// ---- system ---------------------------------------------------------------------------------
function tick(world, dt) {
  const E = world.exp;
  for (let k = E.flights.length - 1; k >= 0; k--) if (!updateFlight(world, E.flights[k], dt)) E.flights.splice(k, 1);
  homeSteerFallback(world);
  updateRaids(world, dt);
}
// AI colonies' porters keep their satellites with own nests fed from the capital (the player does this with
// Send and nest tunnels): each second up to SHARE_MAX of sugar and of protein moves toward an even share per ant.
// (Balance runs had rival satellites starving on empty stores while the capital sat on plenty.)
const SHARE_RATE = 0.05, SHARE_MAX = 3, SHARE_KEEP = 20;
function shareFood(world, c) {
  const H = world.homes; if (!H || !c.satellites.length) return;
  const n = h => Math.max(5, h.pop ? h.pop.reduce((a, b) => a + b, 0) : 0), nc = n(c);
  for (const sat of c.satellites) {
    const h = sat.home != null && H[sat.home]; if (!h || h === c || h.gone || !h.nest || h.id !== c.id || !Object.prototype.hasOwnProperty.call(h, 'stock')) continue;
    const nh = n(h);
    for (const k of ['sugar', 'protein']) {
      const have = c.stock[k] || 0; if (have <= SHARE_KEEP) continue;
      const gap = have / nc - (h.stock[k] || 0) / nh; if (gap <= 0) continue;
      const v = Math.min(SHARE_MAX, gap * nh * SHARE_RATE, have - SHARE_KEEP);
      c.stock[k] = have - v; h.stock[k] = (h.stock[k] || 0) + v;
    }
  }
}
function second(world, dt) {
  const E = world.exp;
  for (const c of world.colonies) {
    updateRoyal(world, c, dt);
    for (const s of c.satellites) updateSatellite(world, c, s, dt);
    for (let k = c.satellites.length - 1; k >= 0; k--) { const s = c.satellites[k]; if (s.state === 'ruin' && s.ruinT <= 0) c.satellites.splice(k, 1); }
    c.terrR = CFG.main.terr + c.moundR * 2;
    if (c.underAttack > 0) c.underAttack -= dt;
    const pop = totalPop(c); if (pop > c.expStats.peakPop) c.expStats.peakPop = pop;
  }
  for (const c of world.colonies) if (!c.isPlayer && c.alive !== false && !c.out) shareFood(world, c);
  siege(world);
  if (world.fog) {
    const ex = (world.fog.extra || []).filter(e => !e.exp);
    // fog is this PC's view only
    for (const sat of world.player.satellites) if (sat.state !== 'ruin') ex.push({ x: sat.x, y: sat.y, r: sat.state === 'founding' ? 90 : 140 + sat.moundR * 2, exp: true });
    for (const f of E.flights) if (f.col === world.player.id) ex.push({ x: f.x, y: f.y, r: 110, exp: true });
    world.fog.extra = ex;
  }
  for (const c of world.colonies) {
    if (c.out) { fade(world, c); continue; }
    if ((c.queen.alive && c.queen.hp <= 0) || (!c.queen.alive && !c.interregnum)) mainQueenDied(world, c, -1, 'hurt');
    else if (c.interregnum) resolveSuccession(world, c);
    else if (c.queen.i < 0) c.queen.hp = Math.min(c.queen.maxHp, c.queen.hp + 0.3);
  }
  for (const t of E.tunnels) updateTunnel(world, t, dt);
  if (E.tunnels.length > 12) E.tunnels = E.tunnels.filter(t => t.state === 'dig' || world.t - t.t0 < 600);
  // rival AI (the lead's AI can take this over: AL.Expansion.CFG.aiAuto = false, then call aiPolicy)
  if (CFG.aiAuto) for (const c of world.colonies) {
    if (c.isPlayer || c.out) continue;
    if (((world.tick / 30 | 0) + c.id) % CFG.ai.every === 0) aiPolicy(world, c.id);
  }
}

// core M3 emits queenDied when the capital's queen ant dies: we own what happens next
AL.on('queenDied', (world, d) => {
  if (!world || !world.exp || !d || d.byExpansion) return;
  (d.data || d).handled = true;
  const c = world.colonies[d.col]; if (c) mainQueenDied(world, c, d.by == null ? -1 : d.by, 'core');
});

AL.registerSystem({
  id: 'expansion', order: 30,
  enabled(opts) { return !opts.benchOnly && opts.expansion !== false; },
  init, tick, second,
});

AL.Expansion = { addHome, closeHome,
  CFG, TEAM, WEIGHT, hooks,
  totalPop, setupColony,
  canRaise, orderRoyal, onRoyalEmerged,
  homes, homeOf, arriveAt, territoryOwner,
  siteCheck, satCount, launch, livingQueens,
  hurtQueen, mainQueenDied, takeover, colonyOut,
  garrison,
  canResearch, research, tunnelTargets, tunnelPlan, orderTunnel, findNest, planBreach, gridFromSoil, nestBreach, nestGrid, queenAnt, adopt,
  scoreSite, pickSite, aiPolicy,
};
if (NODE) module.exports = AL.Expansion;
})(typeof window !== 'undefined' ? window : globalThis);
