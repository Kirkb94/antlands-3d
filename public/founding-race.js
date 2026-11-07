// Antlands founding race. Two halves, both pure simulation (no DOM; runs in Node tests):
//
// 1) The race in the founding scene: every rival queen founds at the same time as the player, with the
//    same founding rules (AL.Founding, AI choices), in lockstep and deterministic per seed. A rival that
//    reaches colony stage first leaves founding: its scouts are out and can find and raid nests that are
//    still founding (the player's included: telegraphed a couple of days ahead).
//      const race = AL.FoundingRace.create({ player: fs, rivals: AL.FoundingRace.rivalSpecs(opts, seed), seed })
//      AL.FoundingRace.update(race, realSeconds)   // advances the player and every rival in fixed steps
//      AL.FoundingRace.rows(race)                  // the race panel: species, site, phase, progress
//      AL.FoundingRace.rivalPatch(race)            // opts.rivalFoundings for createWorld
//
// 2) The 'founding-race' system in colony play: rivals that were still founding when the player started
//    the colony start the match as small, weak, exposed nests (col.founding is set, see docs/CONTRACT.md).
//    They grow at their species pace and become normal AI colonies at colony stage. Until then they don't
//    forage far, don't raid, and their queen dies fast once the few nanitics inside are beaten.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./founding-sites.js'); require('./founding.js'); }
const Fd = AL.Founding;

// ---- tuning ---------------------------------------------------------------------------------------
const RT = {
  STEP: 0.05,          // founding days per fixed race step
  FIND: 0.12,          // per day: chance a rival that is out finds a founding nest (x exposure x proximity x size)
  TELEGRAPH: 1.8,      // days between "their scouts found you" and the raid (the player can plug the entrance)
  RAID_CD: 5,          // days before the same rival raids the same nest again
  OUT_GROW: 0.6,       // workers per founding day a rival gains after it is out (its raids get stronger)
  RIVAL_MIN_HP: 12,    // rival queens are never killed in the founding scene (the match needs its colonies)
};
// colony play
const M = {
  SEC_PER_DAY: 20,     // sim seconds per founding day for nests still founding in the match
  QUEEN_HP: 90,        // a founding queen (normal AI queens have 600)
  LEASH: 280,          // founding nanitics forage this close to home
  OUT_MAX: 3,          // at most this many of them outside at once
  HEAD_W: 0.45,        // rivals that left founding before you: extra workers per founding day of head start
  HEAD_S: 2.5,         // ... and extra sugar per day
  MOUND: 4,            // mound soil of a founding nest (normal colonies start with 60)
};

// ---- who is racing ----------------------------------------------------------------------------------
// rivals from the nuptial flight (opts.landings), else from opts.rivalSpecies / rivalSites / colonies (count)
// / rivals (count), else the core default of one fire-ant rival. Returns [{ col, species, siteType, x, y, bonus, team }].
function rivalSpecs(opts, seed, playerSiteType) {
  opts = opts || {};
  const out = [], teams = (AL.Flight && AL.Flight.TEAM_COLOURS) || ['#f2c14e', '#e0503a', '#4aa3df', '#a678de', '#3fbfa0', '#f08a3c', '#e86fa8', '#9ccc4a'];
  const lands = (opts.landings || []).filter(l => l.colonyId !== 0);
  if (lands.length) {
    for (const l of lands) {
      const s = opts.flight && opts.flight.sites ? opts.flight.sites.find(z => z.id === l.siteId) : null;
      const ty = l.siteType || (s && s.type);
      const pos = l.nest || (s ? { x: s.x, y: s.y } : { x: 0, y: 0 });
      out.push({ col: l.colonyId, species: l.species || 'fire', siteType: AL.SITES[ty] ? ty : 'meadow', siteKey: l.siteId, x: pos.x, y: pos.y, bonus: l.bonus ? l.bonus.reserves || 0 : 0, team: teams[l.colonyId % teams.length] });
    }
    return out.sort((a, b) => a.col - b.col);
  }
  const sp = Array.isArray(opts.rivalSpecies) ? opts.rivalSpecies : null, rs = Array.isArray(opts.rivalSites) ? opts.rivalSites : null;
  let n = rs ? rs.length : sp ? sp.length : typeof opts.colonies === 'number' ? opts.colonies - 1 : Array.isArray(opts.colonies) ? opts.colonies.length - 1 : typeof opts.rivals === 'number' ? opts.rivals : 1;
  n = Math.max(0, Math.min(7, n | 0));
  let sites = null;
  try { sites = AL.Sites.placeDefault ? AL.Sites.placeDefault((seed >>> 0) || 1, { map: opts }) : null; } catch (_) { sites = null; }
  const taken = playerSiteType ? [playerSiteType] : [];
  const Z = (AL.MAP_SIZES && AL.MAP_SIZES[opts.mapSize]) || { W: 4000, H: 3000 };
  const defPos = [{ x: Math.round(3240 * Z.W / 4000), y: Math.round(760 * Z.H / 3000) }];   // createWorld's default rival nest
  for (let k = 1; k <= n; k++) {
    const species = (sp && sp[k - 1]) || 'fire';
    let pos = (rs && rs[k - 1]) || defPos[k - 1] || null, ty = null;
    if (sites && sites.length) {
      let best = null;
      if (pos) { let bd = 1e18; for (const s of sites) { const e = AL.Sites.entranceOf(s), d = AL.sq(e.x - pos.x) + AL.sq(e.y - pos.y); if (d < bd) { bd = d; best = s; } } }
      else best = AL.Sites.pickForAI(sites, species, ((seed >>> 0) + k * 131) >>> 0, taken) || sites[k % sites.length];
      ty = best.id; taken.push(best.id);
      if (!pos) pos = AL.Sites.entranceOf(best);
    }
    out.push({ col: k, species, siteType: ty || 'meadow', x: pos ? pos.x : Z.W / 2, y: pos ? pos.y : Z.H / 2, bonus: 0, team: teams[k % teams.length] });
  }
  return out;
}

// ---- the race --------------------------------------------------------------------------------------
// opts: { player: fs (the player's AL.Founding state), rivals: rivalSpecs(...), seed, x, y (player nest) }
function create(opts) {
  const seed = (opts.seed >>> 0) || 1;
  const p = opts.player;
  const race = {
    seed, R: AL.rng(seed ^ 0x2ace), acc: 0, day: 0, steps: 0,
    player: { col: 0, me: true, fs: p, species: p.spKey, siteType: p.siteId, x: opts.x != null ? opts.x : (p.site && p.site.x) || 760, y: opts.y != null ? opts.y : (p.site && p.site.y) || 2240, team: '#f2c14e', cd: {} },
    rivals: [], pending: [], events: [], evN: 0, raids: [],
  };
  p.autoThreats = false;      // raids now come from rivals that are out (see threats below)
  for (const r of opts.rivals || []) {
    const fs = Fd.create({ site: { id: r.siteType, def: AL.SITES[r.siteType], x: r.x, y: r.y }, species: r.species, seed: (seed + r.col * 977) >>> 0, col: r.col, ai: true, autoThreats: false, reserveBonus: r.bonus || 0 });
    race.rivals.push(Object.assign({}, r, { fs, out: false, outDay: null, ho: null, cd: {}, outW: 0 }));
  }
  return race;
}
function rEv(race, kind, text, good, col) { race.evN++; race.events.push({ n: race.evN, day: race.day, kind, text, good: !!good, col }); if (race.events.length > 40) race.events.shift(); }
const spName = k => (AL.SPECIES && AL.SPECIES[k] && AL.SPECIES[k].name) || (k ? k[0].toUpperCase() + k.slice(1) + ' ants' : 'Ants');
const siteName = k => (AL.SITES[k] && AL.SITES[k].name) || k;
function label(r) { return spName(r.species) + ' (' + siteName(r.siteType) + ')'; }

// proximity of two nests for scouting (shared site = right next door)
function prox(a, b) {
  const d = AL.hypot(a.x - b.x, a.y - b.y);
  if (d < 220) return 2.6;
  return AL.clamp(900 / d, 0.35, 1.6);
}
// how many workers a rival that is out has now (it keeps growing while others are still founding)
function outWorkers(r, day) { return (r.ho ? r.ho.nanitics + r.ho.workers : 4) + Math.max(0, day - r.outDay) * RT.OUT_GROW; }
function raidPower(r, day) { const sp = AL.SPECIES && AL.SPECIES[r.species]; return Math.min(9, 1.5 + 0.35 * outWorkers(r, day) * ((sp && sp.dps) || 1)); }

function markOut(race, r) {
  r.out = true; r.outDay = race.day;
  r.ho = Fd.handoff(r.fs); delete r.ho.nest.tiles;
  const left = race.rivals.filter(z => !z.out).length + (race.player.fs.phase === 'done' ? 0 : 1);
  rEv(race, 'out', label(r) + ' reached colony stage and left founding. Their scouts are out' + (left ? ': open nests can be found.' : '.'), false, r.col);
}

// one fixed step of founding days for everybody
function step(race, dd) {
  const R = race.R, pf = race.player.fs;
  race.day += dd; race.steps++;
  const playerLive = pf.phase !== 'done' && pf.phase !== 'dead';
  if (playerLive) {
    const was = pf.marks.colony;
    Fd.advance(pf, dd);
    if (was == null && pf.marks.colony != null) {
      const still = race.rivals.filter(r => !r.out).length;
      if (race.rivals.length) rEv(race, 'ready', still ? still + ' of ' + race.rivals.length + ' rival' + (race.rivals.length > 1 ? 's are' : ' is') + ' still founding. Start the colony now and they begin colony play small and exposed: easy to raid.' : 'Every rival is already out. Start soon: your open nest is easy to find.', true, 0);
    }
  }
  for (const r of race.rivals) {
    if (r.out) continue;
    Fd.advance(r.fs, dd);
    if (r.fs.queen.hp < RT.RIVAL_MIN_HP) r.fs.queen.hp = RT.RIVAL_MIN_HP;
    if (r.fs.phase === 'done') markOut(race, r);
  }
  threats(race, dd, R);
}
// rivals that are out scout for nests that are still founding (the player's, and each other's)
function threats(race, dd, R) {
  const pf = race.player.fs, playerLive = pf.phase !== 'done' && pf.phase !== 'dead';
  for (const a of race.rivals) {
    if (!a.out) continue;
    const size = 0.6 + outWorkers(a, race.day) / 8;
    // the player: found -> telegraphed raid
    if (playerLive && !race.pending.some(p => p.col === a.col) && !(a.cd[0] > race.day)) {
      const rate = RT.FIND * Fd.exposure(pf) * prox(a, race.player) * size;
      if (R() < rate * dd) {
        const at = race.day + RT.TELEGRAPH * (0.85 + R() * 0.3);
        race.pending.push({ col: a.col, at, found: race.day, power: raidPower(a, race.day) });
        a.cd[0] = at + RT.RAID_CD;
        rEv(race, 'found', 'Scouts of the ' + label(a) + ' found your entrance. A raid is coming in about ' + Math.ceil(at - race.day) + ' days. Plug the entrance or start the colony.', false, a.col);
      }
    }
    // other rivals still founding: raided straight away (shown in the race feed)
    for (const t of race.rivals) {
      if (t.out || t === a || t.cd[a.col] > race.day || t.fs.queen.hp < 45) continue;
      const rate = RT.FIND * Fd.exposure(t.fs) * prox(a, t) * size;
      if (R() < rate * dd) {
        t.cd[a.col] = race.day + RT.RAID_CD;
        const res = Fd.attack(t.fs, raidPower(a, race.day), label(a));
        if (t.fs.queen.hp < RT.RIVAL_MIN_HP) t.fs.queen.hp = RT.RIVAL_MIN_HP;
        if (res) { race.raids.push({ day: race.day, from: a.col, to: t.col, repelled: res.repelled }); rEv(race, 'raid', label(a) + ' raided the ' + label(t) + (res.repelled ? ': driven off.' : ' and carried off ' + res.broodLost + ' brood.'), false, t.col); }
      }
    }
  }
  // telegraphed raids land on the player
  for (let k = race.pending.length - 1; k >= 0; k--) {
    const p = race.pending[k];
    if (!playerLive) { race.pending.splice(k, 1); continue; }
    if (race.day < p.at) continue;
    race.pending.splice(k, 1);
    const a = race.rivals.find(r => r.col === p.col);
    // a sealed or plugged entrance: half the time they lose the scent, else they dig in at half strength
    let power = p.power;
    if (pf.sealed && pf.prof.mode !== 'bivouac') {
      if (race.R() < 0.5) { rEv(race, 'lost', 'The ' + label(a) + ' raiders found only a ' + (pf.plugged ? 'plugged hole' : 'sealed shaft') + ' and lost the scent.', true, p.col); continue; }
      power *= 0.5;
    }
    pf.lastAttacker = a.species;
    const nm = spName(a.species), res = Fd.attack(pf, power, (/ ants$/.test(nm) ? nm.replace(/ ants$/, '-ant') : nm.replace(/s$/, '')) + ' raiders');
    race.raids.push({ day: race.day, from: p.col, to: 0, repelled: !!(res && res.repelled) });
  }
}
// real seconds -> fixed steps (deterministic for a given seed and the player's choices)
function update(race, realSec) {
  const pf = race.player.fs;
  if (!pf.paused && pf.phase !== 'done' && pf.phase !== 'dead') {
    race.acc += realSec * Fd.F.DAYS_PER_SEC * pf.speed;
    let guard = 0;
    while (race.acc >= RT.STEP && guard++ < 400) { race.acc -= RT.STEP; step(race, RT.STEP); if (pf.phase === 'done' || pf.phase === 'dead') { race.acc = 0; break; } }
  }
  Fd.ageFx(pf, realSec);
}
// headless: run until the player is done (tests); `play(fs)` makes the player's choices each step
function run(race, maxDays, play) {
  const pf = race.player.fs;
  while (pf.phase !== 'done' && pf.phase !== 'dead' && race.day < (maxDays || 80)) { if (play) play(pf, race); if (pf.phase === 'done' || pf.phase === 'dead') break; step(race, RT.STEP); }
  return race;
}

// rows for the race panel, most advanced first
function rows(race) {
  const all = [race.player].concat(race.rivals).map(r => {
    const info = r.out ? { phase: 'out', progress: 1, workers: Math.round(outWorkers(r, race.day)), exposure: 1, sealed: false } : Fd.race(r.fs);
    const exposed = r.out || (!info.sealed && info.phase !== 'dead');
    return { col: r.col, me: !!r.me, species: r.species, spName: spName(r.species), siteType: r.siteType, siteName: siteName(r.siteType), x: r.x, y: r.y, team: r.team,
      phase: info.phase, label: Fd.PHASE_LABEL[info.phase] || info.phase, progress: info.progress, workers: info.workers, out: !!r.out, outDay: r.outDay, exposed,
      pace: Fd.profileFor(r.species).pace };
  });
  all.sort((a, b) => (b.out - a.out) || (a.out && b.out ? a.outDay - b.outDay : 0) || (b.progress - a.progress) || (a.col - b.col));
  return all;
}
function rank(race) { const rs = rows(race); return { place: rs.findIndex(r => r.me) + 1, of: rs.length, still: race.rivals.filter(r => !r.out).length, out: race.rivals.filter(r => r.out).length }; }

// the createWorld patch for rival colonies: out -> a normal founding handoff (+ head start);
// still founding -> the same handoff plus `race` (stillFounding, progress, phase, brood development...)
function rivalPatch(race) {
  return race.rivals.map(r => {
    if (r.out) return Object.assign({}, r.ho, { headStart: Math.round((race.day - r.outDay) * 10) / 10, race: { out: true, outDay: r.outDay, progress: 1, phase: 'out' } });
    const fs = r.fs, ho = Fd.handoff(fs); delete ho.nest.tiles;
    const info = Fd.race(fs);
    const laidTarget = fs.laid === 0 ? (fs.prof.fat > 65 ? 12 : 10) : fs.clutch;
    let digLeft = 0;
    if (fs.prof.mode !== 'bivouac' && (fs.phase === 'land' || fs.phase === 'shed' || fs.phase === 'choose' || fs.phase === 'dig' || fs.phase === 'seal')) {
      digLeft = Math.max(0.3, fs.digQ.length ? fs.digQ.length * Fd.F.DIG_DAYS * 1.4 / Math.max(0.2, fs.mods.dig * (fs.prof.digMul || 1)) : 2.5) + Fd.F.SEAL_T;
    }
    ho.race = {
      stillFounding: true, phase: info.phase, progress: info.progress, colonyAt: fs.prof.colonyAt,
      nanitics: fs.workers.length, opened: fs.opened || fs.prof.mode === 'bivouac', exposure: info.exposure,
      digLeft, digTotal: Math.max(digLeft, 1), toLay: Math.max(0, laidTarget - fs.laid), layRate: Fd.F.LAY_PER_DAY * fs.prof.breed,
      devRate: Fd.devRate(fs), brood: Fd.broodDevs(fs).filter(d => d < 1), day: Math.round(fs.day * 10) / 10,
    };
    return ho;
  });
}

// =====================================================================================================
// colony play: nests still founding
// col.founding = { progress, phase, colonyAt, nanitics, opened, exposure, brood: [dev 0..1], dig, toLay,
//                  layRate, devRate, siege, spKey, since }   (see docs/CONTRACT.md "Founding colonies")
const ST = AL.ST, C = AL.CASTE, L = AL.LAYER;
function makeState(ho, world) {
  const r = ho.race, prof = Fd.profileFor(ho.species);
  return {
    progress: r.progress, phase: r.phase, colonyAt: r.colonyAt || prof.colonyAt, spKey: ho.species,
    nanitics: r.nanitics || 0, opened: !!r.opened, exposure: r.exposure != null ? r.exposure : 1,
    brood: (r.brood || []).slice(), dig: r.digLeft || 0, digTotal: r.digTotal || 1, toLay: r.toLay || 0, layT: 0,
    layRate: r.layRate || 3, devRate: r.devRate || prof.dev, naniticSize: prof.nanitic,
    siege: { n: 0, power: 0, hp: 0, by: 0 }, since: world.t, setup: false, hpFrac: ho.queen ? AL.clamp(ho.queen.hpFrac, 0.2, 1) : 1,
  };
}
function progressNow(f) {
  const devs = f.brood.slice().sort((a, b) => b - a);
  for (let k = 0; k < f.nanitics; k++) devs.unshift(1);
  const digFrac = f.dig > 0 ? 1 - f.dig / Math.max(f.dig, f.digTotal) : 1;
  return f.nanitics >= f.colonyAt && f.opened ? 1 : Math.min(0.99, Fd.progressOf(digFrac, devs, f.colonyAt, f.opened));
}
function phaseNow(f) {
  if (f.dig > 0) return 'digging';
  if (f.nanitics >= f.colonyAt && f.opened) return 'colony';
  if (f.nanitics) return f.opened ? 'open' : 'nanitics';
  const top = f.brood.length ? Math.max(...f.brood) : -1, D = Fd.F, T = Fd.TOTAL_D;
  if (top < 0) return 'sealed';
  return top >= (D.EGG_D + D.LARVA_D) / T ? 'pupae' : top >= D.EGG_D / T ? 'larvae' : 'eggs';
}
function setupFounding(world, col) {
  const f = col.founding;
  f.setup = true;
  f.saved = { queenMaxHp: col.queen ? col.queen.maxHp || 600 : 600, enter: col.enter };
  if (col.queen) { col.queen.maxHp = M.QUEEN_HP; col.queen.hp = M.QUEEN_HP * f.hpFrac; col.queen.layT = 1e9; }
  if (col.broodQ) col.broodQ.length = 0;            // its brood lives in col.founding.brood until colony stage
  if (!col.inside) col.inside = new Float32Array(AL.NCASTE);
  // founding.js has set inside[WORKER] to its nanitics; anything else (core start ants) goes
  const A = world.ants;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col.id && A.caste[i] !== C.QUEEN) A.kill(i);
  col.inside.fill(0); col.inside[C.WORKER] = f.nanitics;
  col.moundSoil = Math.min(col.moundSoil || M.MOUND, M.MOUND); if (AL.Colony && AL.Colony.updateMound) AL.Colony.updateMound(col);
  col.enter = enterFounding;
  f.progress = Math.max(f.progress, progressNow(f)); f.phase = phaseNow(f);
}
// a nanitic comes home: she becomes a number inside (like an AI nest)
enterFounding._snap = 'founding.enterFounding';
function enterFounding(world, i) {
  const A = world.ants, col = world.colonies[A.col[i]];
  if (A.carry[i]) { AL.Sim.addStock(col, A.carry[i], 1); A.carry[i] = 0; }
  col.inside[A.caste[i]]++;
  A.kill(i);
}
function releaseNanitic(world, col) {
  if (col.inside[C.WORKER] < 1) return -1;
  const A = world.ants, R = world.R, a = R() * AL.TAU, f = col.founding;
  const i = A.spawn(col.id, C.WORKER, L.SURFACE, col.x + AL.cos(a) * 5, col.y + AL.sin(a) * 5, a, R);
  if (i < 0) return -1;
  col.inside[C.WORKER]--;
  const N = Fd.NANITIC;
  A.maxhp[i] = A.hp[i] = AL.CASTES[C.WORKER].hp * N.hp * (col.sp.hp || 1);
  A.life[i] = AL.CASTES[C.WORKER].life * N.life;
  if (A.size) A.size[i] = f.naniticSize || N.size;
  if (A.nanitic) A.nanitic[i] = 1;
  A.state[i] = ST.WANDER; A.timer[i] = 0;
  return i;
}
// ants of a foreign colony in a fighting mood that reach a founding nest break in
const unitPower = (caste, sp) => AL.CASTES[caste].dps * AL.CASTES[caste].hp * (sp ? (sp.dps || 1) * (sp.hp || 1) : 1);
function breakIns(world) {
  const A = world.ants;
  for (const col of world.colonies) {
    const f = col.founding; if (!f || !col.alive || !f.setup) continue;
    const r = col.moundR * 0.45 + 8;
    AL.Sim.antsNear(world, col.x, col.y, r, j => {
      if (A.col[j] === col.id) return;
      const st = A.state[j];
      if (st !== ST.GUARD && st !== ST.RALLY && st !== ST.RECRUIT && st !== ST.RAID && st !== ST.WANDER && st !== ST.FIGHT) return;
      if (st === ST.WANDER && A.caste[j] !== C.SOLDIER && A.caste[j] !== C.MAJOR && A.caste[j] !== C.SCOUT) return;
      const by = world.colonies[A.col[j]], hpF = A.hp[j] / Math.max(1, A.maxhp[j]);
      f.siege.n += hpF; f.siege.power += unitPower(A.caste[j], by.sp) * hpF; f.siege.hp += A.maxhp[j] * hpF; f.siege.by = A.col[j];
      A.kill(j);
      if (!f._msgT || world.t - f._msgT > 15) { f._msgT = world.t; AL.emit(world, 'siege', { col: col.id, by: by.id, founding: true }); }
    });
  }
}
// numbers win: nanitics inside against the raiders; with the nanitics gone the queen falls fast
function siegeTick(world, col) {
  const f = col.founding, sg = f.siege, ins = col.inside;
  if (sg.n < 0.05) { sg.n = sg.power = sg.hp = 0; col.sieging = false; return; }
  col.sieging = true;
  const N = Fd.NANITIC, nanP = unitPower(C.WORKER, col.sp) * N.hp * N.dps;
  const defN = ins[C.WORKER], def = defN * nanP, att = sg.power;
  const K = 0.0035;
  const defDead = Math.min(defN, att * K / Math.max(1, AL.CASTES[C.WORKER].hp * N.hp));
  ins[C.WORKER] -= defDead; col.stats.died += defDead;
  const avgHp = sg.hp / Math.max(0.05, sg.n), lost = Math.min(sg.n, def * K / Math.max(1, avgHp));
  const keep = sg.n > 0 ? (sg.n - lost) / sg.n : 0;
  sg.n -= lost; sg.power *= keep; sg.hp *= keep;
  if (world.colonies[sg.by]) world.colonies[sg.by].stats.died += lost;
  col.siegeLog = { att: sg.n, def: ins[C.WORKER] };
  if (ins[C.WORKER] < 1 && col.queen && col.queen.alive) {
    col.queen.hp -= Math.max(2, att * 0.02);
    if (col.queen.hp <= 0) {
      col.queen.hp = 0; col.queen.alive = false; f.dead = true;
      const data = { handled: false };
      AL.emit(world, 'queenDied', { col: col.id, colony: col, data, founding: true });
      if (!data.handled) { if (AL.Life && AL.Life.queenLost) AL.Life.queenLost(world, col); else col.alive = false; }
      const n = Math.floor(sg.n);
      for (let j = 0; j < n; j++) { const a = world.R() * AL.TAU; world.ants.spawn(sg.by, C.WORKER, L.SURFACE, col.x + AL.cos(a) * 8, col.y + AL.sin(a) * 8, a, world.R); }
      sg.n = sg.power = sg.hp = 0; col.sieging = false;
    }
  }
}
// colony stage reached in the match: from now on a normal AI colony
function graduate(world, col) {
  const f = col.founding;
  if (col.queen) { const frac = col.queen.hp / M.QUEEN_HP; col.queen.maxHp = f.saved.queenMaxHp; col.queen.hp = f.saved.queenMaxHp * AL.clamp(frac, 0.2, 1); col.queen.layT = 3; }
  col.enter = f.saved.enter || col.enter;
  if (col.broodQ) for (const b of f.brood) col.broodQ.push({ caste: C.WORKER, t: Math.min(0.95, b), fed: true });
  col.moundSoil = Math.max(col.moundSoil, 24); if (AL.Colony && AL.Colony.updateMound) AL.Colony.updateMound(col);
  if (col.ai) col.ai.raidT = Math.max(col.ai.raidT || 0, 240 + world.R() * 120);   // no raid the moment it comes out
  col.sieging = false;
  delete col.founding;
  col.foundedAt = world.t;
  AL.emit(world, 'foundingDone', { col: col.id, t: world.t, x: col.x, y: col.y });
}
function secondFounding(world) {
  const dd = 1 / M.SEC_PER_DAY, env = world.env || {}, D = Fd.TOTAL_D;
  for (const col of world.colonies) {
    const f = col.founding; if (!f || !f.setup) continue;
    if (!col.alive) continue;
    siegeTick(world, col);
    if (!col.alive || !col.founding) continue;
    // grow at the species pace: dig, lay the rest of the clutch, raise the brood
    const pace = env.winter ? 0.3 : 1;
    if (f.dig > 0) f.dig = Math.max(0, f.dig - dd * pace);
    else {
      if (f.toLay > 0) { f.layT += dd * pace * f.layRate; while (f.layT >= 1 && f.toLay > 0) { f.layT -= 1; f.toLay--; f.brood.push(0); } }
      for (let k = f.brood.length - 1; k >= 0; k--) {
        f.brood[k] += dd * pace * f.devRate / D;
        if (f.brood[k] >= 1) { f.brood.splice(k, 1); f.nanitics++; col.inside[C.WORKER]++; col.stats.born++; }
      }
      if (f.nanitics >= 1) f.opened = true;
    }
    f.progress = Math.max(f.progress, progressNow(f)); f.phase = phaseNow(f);
    f.exposure = f.dig > 0 ? 0.9 : f.opened ? 1 : 0.3;
    if (f.nanitics >= f.colonyAt && f.opened && !col.sieging) { graduate(world, col); continue; }
    // a few nanitics forage close to home (no raids, no long trips)
    if (f.opened && !env.winter && !(env.rain > 0.35) && !(env.night > 0.6) && col.surf < Math.min(M.OUT_MAX, Math.floor(col.inside[C.WORKER] * 0.6 + 0.4))) releaseNanitic(world, col);
  }
}
function leash(world) {
  const A = world.ants, cols = world.colonies, R2 = M.LEASH * M.LEASH;
  let any = false; for (const c of cols) if (c.founding) { any = true; break; }
  if (!any) return;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== L.SURFACE) continue;
    const c = cols[A.col[i]]; if (!c || !c.founding) continue;
    if (A.state[i] === ST.WANDER && AL.dist2(A.x[i], A.y[i], c.x, c.y) > R2) { A.state[i] = ST.HOMING; A.timer[i] = 0; }
  }
}
// until ai.js honours col.founding itself (the colonies stage sets `skipsFounding: true` on its system),
// hide founding colonies from it: during the AI's own calls their col.inside reads as null, which ai.js skips
function wrapAI(world) {
  const k = world.systems.findIndex(s => s && s.id === 'ai');
  if (k < 0) return;
  const ai = world.systems[k];
  if (ai.skipsFounding || ai._foundingWrapped) return;
  const hide = fn => fn && function (w, dt) {
    const hidden = [];
    for (const c of w.colonies) if (c.founding && c.inside) { hidden.push([c, c.inside]); c.inside = null; }
    try { return fn.call(ai, w, dt); } finally { for (const [c, ins] of hidden) c.inside = ins; }
  };
  world.systems[k] = Object.assign({}, ai, { tick: hide(ai.tick), second: hide(ai.second), pre: hide(ai.pre), post: hide(ai.post), _foundingWrapped: true });
}

if (AL.registerSystem) AL.registerSystem({
  id: 'founding-race', order: 4,
  enabled(opts) { return !opts.bench && Array.isArray(opts.rivalFoundings) && opts.rivalFoundings.length > 0; },
  init(world, opts) {
    world.foundingRace = { cols: [] };
    for (const ho of opts.rivalFoundings) {
      const col = world.colonies[ho.col];
      if (!col || col.isPlayer) continue;
      if (ho.race && ho.race.stillFounding) { col.founding = makeState(ho, world); world.foundingRace.cols.push(col.id); }
      else if (ho.headStart > 0) col._headStart = ho.headStart;
    }
    wrapAI(world);
  },
  pre(world) {
    const fr = world.foundingRace; if (!fr || fr.applied) return;
    fr.applied = true;     // first tick, after the 'founding' system (order 3) applied every handoff
    for (const col of world.colonies) {
      if (col.founding && !col.founding.setup) setupFounding(world, col);
      // rivals that left founding before the player had a head start: they kept growing
      if (col._headStart && col.inside) {
        const hs = col._headStart, pace = Fd.profileFor(col.spKey).dev;
        col.inside[C.WORKER] += Math.round(hs * M.HEAD_W * pace); col.stock.sugar += hs * M.HEAD_S; col.stock.protein += hs * M.HEAD_S * 0.5;
        delete col._headStart;
      }
    }
  },
  tick(world) {
    if (world.tick % 5 === 0) breakIns(world);
    if (world.tick % 20 === 7) leash(world);
  },
  second: secondFounding,
  render: {
    overAnts(ctx, view, r) {
      const w = r && r.world; if (!w || !w.foundingRace) return;
      for (const col of w.colonies) {
        const f = col.founding; if (!f || !col.alive) continue;
        if (col.x < view.x0 - 80 || col.x > view.x1 + 80 || col.y < view.y0 - 80 || col.y > view.y1 + 80) continue;
        if (w.fog && !w.fog.visibleAt(col.x, col.y)) continue;
        // a fresh spoil ring with the founding progress around it
        const R0 = col.moundR + 10, t = (view.frame || 0) * 0.05;
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(20,12,6,0.55)';
        ctx.beginPath(); ctx.arc(col.x, col.y, R0, 0, AL.TAU); ctx.stroke();
        ctx.strokeStyle = 'rgba(242,193,78,0.95)'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(col.x, col.y, R0, -Math.PI / 2, -Math.PI / 2 + AL.TAU * f.progress); ctx.stroke();
        ctx.setLineDash([4, 5]); ctx.lineDashOffset = -t * 10; ctx.strokeStyle = 'rgba(255,236,190,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(col.x, col.y, R0 + 6, 0, AL.TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '600 10px system-ui,sans-serif'; ctx.textAlign = 'center';
        const txt = 'Founding ' + Math.round(f.progress * 100) + '% · ' + Math.round(col.inside ? col.inside[C.WORKER] + col.surf : 0) + ' nanitics';
        const tw = ctx.measureText(txt).width + 10, ty = col.y + R0 + 16;
        ctx.fillStyle = 'rgba(24,17,11,0.8)'; ctx.fillRect(col.x - tw / 2, ty - 10, tw, 14);
        ctx.fillStyle = '#f3e9d2'; ctx.fillText(txt, col.x, ty + 1);
      }
    },
  },
});

// HUD: a small "still founding" widget and a toast when one finishes (browser only, guarded)
function widgetHtml(w) {
  const fr = w && w.foundingRace; if (!fr) return '';
  const cols = w.colonies.filter(c => c.founding && c.alive);
  if (!cols.length) return '';
  let h = '<div style="font-weight:600;margin-bottom:3px" data-tip="Rival queens that were still founding when you started. Weak and exposed until they reach colony stage: find them and raid them.">Rivals still founding</div>';
  for (const c of cols) {
    const seen = !w.fog || w.fog.seenAt(c.x, c.y);
    h += '<div style="display:flex;align-items:center;gap:6px;font-size:11.5px;margin:2px 0"><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + spName(c.spKey) + (seen ? '' : ' <span class="mute">· not found</span>') + '</span>' +
      '<i style="display:inline-block;width:54px;height:6px;border-radius:3px;background:rgba(255,255,255,.1);overflow:hidden"><i style="display:block;height:100%;width:' + Math.round(c.founding.progress * 100) + '%;background:linear-gradient(90deg,#7a5a3a,#f2c14e)"></i></i></div>';
  }
  return h;
}
if (AL.on) {
  AL.on('worldCreated', (w) => {
    if (!AL.UI || !AL.UI.addWidget) return;
    if (w.foundingRace && w.foundingRace.cols.length) AL.UI.addWidget('founding-race', { where: 'right', every: 1, html: widgetHtml });
    else if (AL.UI.removeWidget) AL.UI.removeWidget('founding-race');
  });
  AL.on('foundingDone', (w, d) => {
    const c = w.colonies[d.col];
    if (AL.UI && AL.UI.toast && c && !w.bench) AL.UI.toast((w.fog && !w.fog.seenAt(c.x, c.y) ? 'A rival ' : 'The ' + spName(c.spKey) + ' ') + 'colony finished founding: from now on it forages and raids.', 'bad');
    if (AL.UI && AL.UI.removeWidget && !w.colonies.some(z => z.founding && z.alive)) AL.UI.removeWidget('founding-race');
  });
}

AL.FoundingRace = { enterFounding, RT, M, rivalSpecs, create, step, update, run, rows, rank, rivalPatch, prox, raidPower, label, spName, siteName, makeState, progressNow, graduate, wrapAI, widgetHtml };
if (NODE) module.exports = AL.FoundingRace;
})(typeof window !== 'undefined' ? window : globalThis);
