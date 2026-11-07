// AI colonies (any species). Their nest is abstract (counts by caste, not tiles): ants that walk in
// become numbers; numbers walk out as foragers, scouts, defenders and raiding parties. They forage with
// the same pheromone behaviour as the player, breed from what they bring home, defend their mound and
// raid the colonies they know about (the player and each other). Ants that reach a rival mound break in
// and fight the defenders inside (Lanchester: numbers win); with the defenders gone they kill the queen.
//
// Knowledge: a rival starts the match knowing no other nest. It learns one when its surface ants see the
// mound (sight = caste fog sight, scouts see furthest; a hidden site is noticed from closer), and it gets a
// lead (a bearing to follow) when its ants meet enemy ants walking home or raiders marching in. Raids only
// go to known colonies; until then the colony sends scouts outward to the nearest unexplored ground.
//   col.ai.known[k]          1 once colony k's nest is known      AL.AI.knows(world, a, b), AL.AI.discover(world, a, b)
//   event 'colonyFound'      { col, target, x, y, seen }  (seen: the player could see the ant that found it)
//   opts.aiKnows === 'all'   start with every nest known (tests, old behaviour)
// Contract for other stages:
//   col.founding truthy      the colony is still founding: no AI at all for it this second (no eating,
//                            breeding, scouting or raids), nobody picks it as a raid target and nobody breaks
//                            into it here (the founding stage owns attacks on founding nests). It can still be
//                            discovered. Clear the flag and the AI takes over with whatever col.inside holds.
//   col.noticeR              if set, the radius (world units) at which rival ants notice this nest
//   AL.Species.aiSecond(world, col)  optional per-second hook for species-specific rival behaviour
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./life.js'); require('./combat.js'); require('./orders.js'); }
const ST = AL.ST, C = AL.CASTE, K = AL.CARRY, L = AL.LAYER, T = AL.TUNE;
// fighting value of one ant (combat.js stats: caste x species x research); sp-only fallback for old callers
const power = (caste, sp, col) => col && AL.Combat && AL.Combat.power ? AL.Combat.power(col, caste) : AL.CASTES[caste].dps * AL.CASTES[caste].hp * (sp ? (sp.dps || 1) * (sp.hp || 1) : 1);
const stat = (col, caste) => AL.Combat && AL.Combat.stat ? AL.Combat.stat(col, caste) : { dps: AL.CASTES[caste].dps * (col.sp.dps || 1), hp: AL.CASTES[caste].hp * (col.sp.hp || 1), tough: 1 };
// sieges inside abstract nests (square law at tunnel pace) and raid parties
const SGT = AL.SIEGE_TUNE = Object.assign({
  K: 0.09,          // share of each side's bite damage that lands per second in the tunnels (surface fights: 1)
  QUEEN_K: 0.12,    // ... on the queen once nobody is left to defend her
  QUEEN_BITE: 10,   // hp per second the queen bites off the attackers in her chamber
  EXPOSE: AL.CASTES.map(c => ({ soldier: 2, major: 2, nurse: 0.5, honeypot: 0.3, winged: 0.3, queen: 0 })[c.key] ?? 1),   // who meets the attackers first
  REPEL: 0.3,       // a raid party cut below this share of its starting size (and outnumbered) turns for home
}, AL.SIEGE_TUNE || {});
ST.AI_SCOUT = 62;   // (merge: 60/61 are the species stage) AI scout walking out to a point to look around (then searches like a forager)

const EXC = 250;    // exploration grid cell (world units)
const AT = AL.AI_TUNE = Object.assign({
  SCOUT_EVERY: [18, 30],   // seconds between scouting parties while some nest is still unknown
  LEAD_RANGE: 650,         // how far a scout follows a lead's bearing
  FIRST_RAID: [540, 660],  // earliest raid (seconds), as before discovery existed
  BUSTLE: 90,              // added to a mound's radius for how far off its nest is noticed
  FUNGUS_PROT: 0.4,        // protein a leafcutter rival's garden yields per second at most while protein is short
                           // (balance, Nov 2026: 1.5 -> 0.4; with the slave-makers reined in leafcutter rivals won most matches)
  GARDEN_PER: 0.0025,      // leaves a leafcutter rival's garden takes per adult per second (+0.4; was 0.004, same pass)
  BROOD_SUGAR: 2,          // sugar per protein a broodProt species (AI_SPECIES_TUNE) pays instead
}, AL.AI_TUNE || {});
// species twists on the abstract model (balance, Nov 2026: 48 hands-off 6-colony matches had rival slave-makers
// winning 22, carpenters never surviving and honeypot / bullet / army rivals almost never). Rivals only: the
// player's detailed nest and the squad fights don't read this table.
//   forage     share of the seconds the colony's own workers and foragers go out foraging
//   raidEvery  time between ordinary raids (the ones that break in and go for the queen) x this
//   nestDef    defenders inside the nest bite this much harder in a siege (on top of the site's defence)
//   display    rivals judge this colony this much stronger when picking a raid target
//   nightOut   share of the foragers that still go out at night (others: half)
//   life       adults inside live this much longer
//   queenPop   polygyne rivals take in extra queens once adults x this reaches AL.TUNE.POLY.autoPop
//   broodProt  share of a larva's protein the brood needs (the rest is made up in sugar, BROOD_SUGAR per protein)
//   prey       protein brought home counts this much (species.js)
//   broodRoom  the abstract brood chambers hold this share of the usual brood (AL.TUNE.GROW ai*)
const AIS = AL.AI_SPECIES_TUNE = Object.assign({
  // Polyergus workers can't forage: the captives do it (species.js sends them). Without this the rival's own
  // sickle-jawed workers fed a huge soldier caste and it won by holding the key points with them. And a host
  // nest is worth more alive (its brood is the next crop of captives): slave-makers go for the queen less often.
  slavemaker: { forage: 0.25, raidEvery: 1.6 },
  // Camponotus: galleries chewed through wood are narrow and easy to hold, the workers forage by night and live long,
  // and the brood is raised mostly on honeydew (rivals hardly grew: few, big, protein-starved ants that aged out
  // as fast as anyone's; they never survived a match)
  carpenter: { nestDef: 1.5, nightOut: 1, life: 1.6, broodProt: 0.5 },
  // Atta: they farm, they don't conquer. Gardens defended by giant majors, but few raids on other nests (once the
  // slave-makers were reined in, leafcutter rivals won most matches)
  leafcutter: { raidEvery: 2 },
  // Pogonomyrmex: fierce at their territory's edge, but they gather seed rather than raid other nests
  harvester: { raidEvery: 1.4 },
  // Solenopsis invicta's polygyne form: rivals take in newly mated queens while still small, so one lost queen
  // doesn't end them (fire rivals hardly ever reached the 300 adults extra queens need and won 2 matches in 40)
  // ... and stinging swarms that overpower prey bring home more of every catch (fire rivals were protein-starved)
  fire: { queenPop: 2.5, prey: 1.5 },
  // Eciton: the bivouac is built of the workers' own bodies: every ant at home bites when raiders break in (rivals
  // lost the queen to small raids). They live on prey: the swarm overpowers what it finds, and their raids eat the
  // brood of the nests they break into (species.js preyIn).
  army: { nestDef: 1.5 },   // (was prey 1.5 too: swarm raids feed army rivals now, swarm.js)
  // Myrmecocystus: border tournaments (workers stilt-walk and puff up so the colony looks bigger than it is) instead
  // of raids, and a deep desert nest whose shafts are easy to hold (rivals fell to the first small raids)
  honeypot: { display: 2, nestDef: 2, raidEvery: 1.5 },
  // Paraponera: tiny colonies that raise a handful of brood at a time. Rivals filled the same brood chambers as
  // anyone's and, where no slave-makers culled them, grew to 100-200 giants and won most matches
  bullet: { broodRoom: 0.3 },
}, AL.AI_SPECIES_TUNE || {});
const twist = col => (col && col.spKey && AIS[col.spKey]) || {};
// difficulty (polish): opts.aiLevel 'easy' | 'normal' | 'hard' (or a number: <=0.75 easy, >=1.25 hard). Scales the
// first raid and the time between raids, raid size, breeding, and how far rival ants notice a nest.
const LEVELS = AL.AI_LEVELS = Object.assign({
  // playerBias: how much a rival prefers the player as a raid target; playerGap: seconds after any raid on the
  // player during which other rivals pick someone else (stops 5 rivals queueing up on one passive player);
  // gangGap: the same for a rival nest that was just raided (the weakest rival no longer gets mobbed)
  easy:   { firstRaid: 1.4,  raidEvery: 1.35, raidSize: 0.65, breed: 0.85, sight: 0.8,  marchRest: 1.2,  playerBias: -0.15, playerGap: 180, gangGap: 90 },
  normal: { firstRaid: 1,    raidEvery: 1,    raidSize: 1,    breed: 1,    sight: 1,    marchRest: 1,    playerBias: 0,     playerGap: 100, gangGap: 60 },
  hard:   { firstRaid: 0.75, raidEvery: 0.75, raidSize: 1.35, breed: 1.15, sight: 1.25, marchRest: 0.85, playerBias: 0.15,  playerGap: 0,   gangGap: 30 },
}, AL.AI_LEVELS || {});
const levelKey = v => typeof v === 'string' && LEVELS[v] ? v : typeof v === 'number' ? (v <= 0.75 ? 'easy' : v >= 1.25 ? 'hard' : 'normal') : 'normal';
const levelOf = col => (col && col.ai && LEVELS[col.ai.level]) || LEVELS.normal;

// an AI rival with a detailed nest (ai-nest.js plays it): only what the AI knows and plans; the colony itself is life.js's
function setupBot(world, col, opts) {
  const R = world.R, NC = world.colonies.length, S = world.surface, lv = LEVELS[levelKey(opts.aiLevel)];
  const ew = Math.ceil(S.W / EXC), eh = Math.ceil(S.H / EXC);
  col.hotspots = col.hotspots || []; col.orders = col.orders || [];
  col.ai = {
    target: -1, raidT: (AT.FIRST_RAID[0] + R() * (AT.FIRST_RAID[1] - AT.FIRST_RAID[0])) * lv.firstRaid, raidN: 0, defendT: 0, level: levelKey(opts.aiLevel), wave: 0, lastSeen: -1,
    known: new Uint8Array(NC), knownAt: new Float32Array(NC), grudge: new Float32Array(NC), leads: [],
    explored: new Uint8Array(ew * eh), ew, eh, scoutT: 8 + R() * 10, scouts: 0, bot: true,
  };
  col.ai.known[col.id] = 1;
  if (opts.aiKnows === 'all') col.ai.known.fill(1);
  // enemies at the door go down into the tunnels and fight there (orders.js breakIn), as raiders do in a person's nest
  col.siegeIn = AL.Sim.siegeInHere;
}
function setup(world, col, opts) {
  if (col.bot && col.nest) return setupBot(world, col, opts);
  const R = world.R, NC = world.colonies.length, S = world.surface;
  col.inside = new Float32Array(AL.NCASTE);
  col.broodQ = [];
  col.queen = { alive: true, hp: 600, maxHp: 600, abstract: true, layT: 3 };
  col.hotspots = []; col.orders = [];
  col.cap = { food: 600, water: 200 };
  col.stock.sugar = 80; col.stock.protein = 30;
  col.siege = new Float32Array(AL.NCASTE);   // enemy ants fighting inside this nest, by caste
  const ew = Math.ceil(S.W / EXC), eh = Math.ceil(S.H / EXC);
  const lv = LEVELS[levelKey(opts.aiLevel)];
  col.ai = {
    target: -1, raidT: (AT.FIRST_RAID[0] + R() * (AT.FIRST_RAID[1] - AT.FIRST_RAID[0])) * lv.firstRaid, raidN: 0, defendT: 0, level: levelKey(opts.aiLevel), wave: 0, lastSeen: -1,
    known: new Uint8Array(NC), knownAt: new Float32Array(NC), grudge: new Float32Array(NC), leads: [],
    explored: new Uint8Array(ew * eh), ew, eh, scoutT: 8 + R() * 10, scouts: 0,
  };
  col.ai.known[col.id] = 1;
  if (opts.aiKnows === 'all') col.ai.known.fill(1);
  col.enter = enterAbstract;
  col.siegeIn = siegeIn;
  // the starting colony: some ants already out, most at home (species with big starts get more)
  const n = (opts.start && opts.start.rivalWorkers) || Math.round(44 * (col.sp.start || 40) / 40);
  const mix = [C.WORKER, C.FORAGER, C.FORAGER, C.WORKER, C.SOLDIER, C.FORAGER, C.WORKER, C.FORAGER, C.SOLDIER, C.WORKER];
  for (let k = 0; k < n; k++) {
    const caste = mix[k % mix.length];
    if (k % 3 === 0 && caste !== C.SOLDIER) {
      const a = R() * AL.TAU, d = 20 + R() * 120;
      const i = world.ants.spawn(col.id, caste, L.SURFACE, col.x + AL.cos(a) * d, col.y + AL.sin(a) * d, a, R);
      world.ants.timer[i] = R() * 20; world.ants.age[i] = R() * 200;
    } else col.inside[caste]++;
  }
  col.inside[C.SCOUT] += 3;
  for (let k = 0; k < 10; k++) col.broodQ.push({ caste: k % 4 ? C.WORKER : C.FORAGER, t: R() * 0.8 });
}

// ---- knowledge ----------------------------------------------------------------------------------
function knows(world, a, b) {
  const c = world.colonies[a];
  if (!c) return false;
  if (!c.ai || !c.ai.known) return true;      // the player (and non-AI colonies) see with their own eyes
  return a === b || c.ai.known[b] === 1;
}
function discover(world, a, b, x, y, how) {
  const c = world.colonies[a], o = world.colonies[b];
  if (!c || !o || !c.ai || !c.ai.known || c.ai.known[b]) return false;
  c.ai.known[b] = 1; c.ai.knownAt[b] = world.t;
  c.ai.leads = c.ai.leads.filter(l => l.col !== b);
  const seen = !!(o.id === world.me && x != null && (!world.fog || world.fog.visibleAt(x, y)));   // UI only (this PC's fog)
  AL.emit(world, 'colonyFound', { col: a, target: b, x, y, seen, how: how || 'sight' });
  return true;
}
function addLead(c, col, x, y, a, t) {
  const L = c.ai.leads;
  for (const l of L) if (l.col === col) { l.x = x; l.y = y; l.a = a; l.t = t; return; }
  L.push({ col, x, y, a, t });
  if (L.length > 4) L.shift();
}
// how close an ant must come to notice this nest (on top of its own sight): the mound plus the bustle of
// ants round the door; a hidden founding site (siteTraits.visibility < 1) is noticed from closer
function noticeR(o) {
  if (o.noticeR != null) return o.noticeR;
  const v = o.siteTraits && o.siteTraits.visibility != null ? AL.clamp(o.siteTraits.visibility, 0.25, 2) : 1;
  return ((o.moundR || 30) + AT.BUSTLE) * v;
}

// once a second: one pass over the surface ants for every AI colony at once
//   intruders near each AI mound, nests seen by AI ants, explored ground, leads from enemy ants going home
const SCR = { intN: null, intX: null, intY: null, intBy: null, unk: null };
function sense(world) {
  const A = world.ants, cols = world.colonies, NC = cols.length, hash = world.hash, FC = T.FOG_CELL;
  const ais = cols.filter(c => !c.isPlayer && c.ai && c.alive && !c.founding);
  if (!ais.length) return;
  if (!SCR.intN || SCR.intN.length < NC) { SCR.intN = new Float64Array(NC); SCR.intX = new Float64Array(NC); SCR.intY = new Float64Array(NC); SCR.intBy = new Float64Array(NC * NC); SCR.unk = []; }
  const intN = SCR.intN, intX = SCR.intX, intY = SCR.intY, intBy = SCR.intBy;
  intN.fill(0); intX.fill(0); intY.fill(0); intBy.fill(0);
  // per AI colony: mound radius for intruders, and the nests it still has to find
  const mx = [], my = [], mr2 = [], aiIdx = new Int8Array(NC).fill(-1), unk = [];
  ais.forEach((c, k) => {
    aiIdx[c.id] = k; mx.push(c.x); my.push(c.y); mr2.push(AL.pow(c.moundR + 220, 2));
    const u = [];
    for (const o of cols) if (o !== c && o.alive !== false && !o.out && !c.ai.known[o.id]) u.push(o);
    unk.push(u);
  });
  const NA = ais.length, ST_ = A.state, LY = A.layer, CO = A.col, X = A.x, Y = A.y, CA = A.caste, phase = (world.tick / 30) | 0;
  for (let i = 0; i < A.high; i++) {
    if (!ST_[i] || LY[i] !== 0) continue;
    const a = CO[i], x = X[i], y = Y[i];
    for (let k = 0; k < NA; k++) {
      if (ais[k].id === a) continue;
      const dx = x - mx[k], dy = y - my[k];
      if (dx * dx + dy * dy < mr2[k]) { const id = ais[k].id; intN[id]++; intX[id] += x; intY[id] += y; intBy[id * NC + a]++; }
    }
    const k = aiIdx[a];
    if (k < 0) continue;
    const c = ais[k], u = unk[k];
    if (!u.length) continue;
    // explored ground
    const ex = (x / EXC) | 0, ey = (y / EXC) | 0;
    if (ex >= 0 && ey >= 0 && ex < c.ai.ew && ey < c.ai.eh) c.ai.explored[ey * c.ai.ew + ex] = 1;
    // nests in sight
    const sight = AL.CASTES[CA[i]].vis * FC, ls = levelOf(c).sight;
    for (let j = u.length - 1; j >= 0; j--) {
      const o = u[j], r = (sight + noticeR(o)) * ls;
      if (AL.dist2(x, y, o.x, o.y) < r * r) { discover(world, c.id, o.id, x, y, 'sight'); u.splice(j, 1); }
    }
    // enemy ants met on the way: follow the ones walking home, back-track the ones heading out (sampled)
    if (!u.length || ((i + phase) & 1) !== 0 || !hash.enemiesNear(hash.cellOf(x, y), a)) continue;
    hash.each(x, y, jj => {
      if (!ST_[jj] || LY[jj] !== 0 || CO[jj] === a) return false;
      const o = cols[CO[jj]];
      if (c.ai.known[o.id] || !o.alive) return false;
      const s = ST_[jj];
      if (s === ST.RETURN || s === ST.HOMING || s === ST.HEAL) { addLead(c, o.id, X[jj], Y[jj], A.a[jj], world.t); return true; }
      if (s === ST.RAID || s === ST.WANDER || s === ST.RECRUIT || s === ST.COLLECT || s === ST.AI_SCOUT) { addLead(c, o.id, X[jj], Y[jj], A.a[jj] + Math.PI, world.t); return true; }
      return false;
    });
  }
  // results per AI colony
  for (const c of ais) {
    const id = c.id, ai = c.ai, n = intN[id];
    c._int = n; c._ix = n ? intX[id] / n : 0; c._iy = n ? intY[id] / n : 0;
    for (let o = 0; o < NC; o++) { ai.grudge[o] *= 0.997; const m = intBy[id * NC + o]; if (m >= 3) ai.grudge[o] = Math.min(2, ai.grudge[o] + 0.02 * m); }
    ai.unknown = unk[aiIdx[id]].length;
  }
}

// where to send scouts: follow the freshest lead's bearing, else the nearest unexplored ground
function scoutPoint(world, col) {
  const ai = col.ai, S = world.surface, R = world.R, m = 120;
  const lead = ai.leads.length ? ai.leads.pop() : null;
  if (lead) {
    const x = AL.clamp(lead.x + AL.cos(lead.a) * AT.LEAD_RANGE, m, S.W - m), y = AL.clamp(lead.y + AL.sin(lead.a) * AT.LEAD_RANGE, m, S.H - m);
    return { x, y, lead: true };
  }
  let best = -1, bv = 1e18;
  for (let k = 0; k < ai.explored.length; k++) {
    if (ai.explored[k]) continue;
    const x = (k % ai.ew + 0.5) * EXC, y = (((k / ai.ew) | 0) + 0.5) * EXC;
    if (x < m || y < m || x > S.W - m || y > S.H - m) continue;
    const v = AL.hypot(x - col.x, y - col.y) * (0.25 + R());
    if (v < bv) { bv = v; best = k; }
  }
  if (best < 0) { ai.explored.fill(0); return { x: m + R() * (S.W - 2 * m), y: m + R() * (S.H - 2 * m) }; }   // seen it all: look again
  ai.explored[best] = 1;   // claimed: the next party goes elsewhere
  return { x: (best % ai.ew + 0.5) * EXC, y: (((best / ai.ew) | 0) + 0.5) * EXC };
}
// AI_SCOUT: walk to the point, then search around it like a forager (and come home with whatever it found)
function scoutHandler(world, i, dt, sense) {
  const A = world.ants, col = world.colonies[A.col[i]];
  if (col.recall) { A.state[i] = ST.HOMING; A.timer[i] = 0; return 0; }
  A.timer[i] += dt;
  const dx = A.tx[i] - A.x[i], dy = A.ty[i] - A.y[i];
  if (dx * dx + dy * dy < 50 * 50 || A.timer[i] > 160) { A.state[i] = ST.WANDER; A.timer[i] = 0; return 0; }
  if (sense && A.wf[i] <= 0) A.turn[i] = AL.clamp(AL.wrap(AL.atan2(dy, dx) - A.a[i]) * 3, -4, 4) + (world.R() - 0.5) * 1.1;
  if (A.wf[i] > 0) A.wf[i] -= dt;
  world.handlerSpeed = 1.1;
  return 0;
}

// ---- abstract nest ------------------------------------------------------------------------------
// Wounds indoors: an ant walking in adds its missing hp to a pool per caste (col.wound), the pool heals for
// sugar (AL.HEAL, like the player's nest; none with an empty store), and every ant walking out takes its
// share (pool / ants of that caste inside). So going indoors heals over time, never instantly for free; a
// wounded soldier's damage is spread over its nestmates rather than kept on one ant (simple, totals kept).
// Ants that die indoors (age, hunger, a siege) take their share with them. col.woundN = inside at last look.
// Lost legs (injury.js) pool the same way in col.crip: limbs never heal, so the legs come back out on someone.
function wounds(col) {
  if (!col.wound) { col.wound = new Float64Array(AL.NCASTE); col.woundN = new Float64Array(AL.NCASTE); }
  if (!col.crip) col.crip = new Float64Array(AL.NCASTE);
  const w = col.wound, n = col.woundN, ins = col.inside, cr = col.crip;
  for (let k = 0; k < AL.NCASTE; k++) { if (ins[k] < n[k]) { const f = ins[k] > 0 ? ins[k] / n[k] : 0; w[k] *= f; cr[k] *= f; } n[k] = ins[k]; }
  return w;
}
// an ant walking out takes its share of its caste's wounds (call before taking it off col.inside)
function walkOut(col, caste, A, i, R) {
  const w = wounds(col), n = col.inside[caste];
  // lost legs: each ant out takes floor(pool / n + R()) of them (at most 4, and never a whole side)
  if (n >= 1 && col.crip[caste] >= 0.5 && R && AL.Injury) {
    const share = col.crip[caste] / n;
    let k = Math.min(4, Math.floor(share + R()));
    while (k-- > 0 && col.crip[caste] >= 0.5) { AL.Injury.lameOut(A, i, R); col.crip[caste] -= 1; }
    if (col.crip[caste] < 0) col.crip[caste] = 0;
  }
  if (n >= 1) col.woundN[caste] = n - 1;   // (walking out isn't dying inside: the pools keep their totals)
  if (n < 1 || w[caste] <= 0) return;
  const hurt = Math.min(A.maxhp[i] * 0.9, w[caste] / n);
  A.hp[i] = A.maxhp[i] - hurt; w[caste] -= hurt; col.woundN[caste] = n - 1;
}
function healInside(col) {
  const w = wounds(col), ins = col.inside, s = col.stock, HL = AL.HEAL;
  for (let k = 0; k < AL.NCASTE; k++) {
    if (w[k] <= 0) continue;
    if (ins[k] < 1) { w[k] = 0; continue; }   // nobody left indoors to carry it
    if (s.sugar <= 1) continue;
    // about half its hp missing per wounded ant, each healing RATE of its max hp a second
    const mh = AL.CASTES[k].hp * (col.sp.hp || 1);
    const h = Math.min(w[k], Math.max(w[k] * 2 * HL.RATE, mh * HL.RATE), (s.sugar - 1) / HL.SUGAR_PER_HP);
    w[k] -= h; s.sugar -= h * HL.SUGAR_PER_HP;
  }
}
// an ant reached its own (abstract) mound: it becomes a number inside
enterAbstract._snap = 'ai.enterAbstract'; siegeIn._snap = 'ai.siegeIn';
function enterAbstract(world, i) {
  const A = world.ants, col = world.colonies[A.col[i]], k = A.caste[i];
  if (A.carry[i]) { AL.Sim.addStock(col, A.carry[i], 1); A.carry[i] = 0; }
  const w = wounds(col);
  w[k] += Math.max(0, A.maxhp[i] - A.hp[i]);
  if (AL.Injury && A.legs[i] !== 63) col.crip[k] += AL.Injury.LOST[A.legs[i]];   // (legs never grow back)
  col.inside[k]++; col.woundN[k] = col.inside[k];
  A.kill(i);   // not a death: the ant just went indoors
}
// an enemy ant (the player's or another rival's) breaks into this abstract nest
function siegeIn(world, i) {
  const A = world.ants, col = world.colonies[A.col[i]];
  const target = this;
  target.siege[A.caste[i]] += A.hp[i] / A.maxhp[i];
  target.siegeBy = A.col[i];
  // the defenders learn where the attackers came from (back along the attackers' approach)
  if (target.ai && target.ai.known && !target.ai.known[col.id]) addLead(target, col.id, A.x[i], A.y[i], A.a[i] + Math.PI, world.t);
  if (target.ai && target.ai.grudge) target.ai.grudge[col.id] = Math.min(2, target.ai.grudge[col.id] + 0.05);
  A.kill(i);
  if (!target._siegeMsgT || world.t - target._siegeMsgT > 15) { target._siegeMsgT = world.t; AL.emit(world, 'siege', { col: target.id, by: col.id }); }
}

function release(world, col, caste, state, n, tx, ty) {
  const A = world.ants, R = world.R;
  let out = 0;
  while (out < n && col.inside[caste] >= 1) {
    const a = R() * AL.TAU;
    const i = A.spawn(col.id, caste, L.SURFACE, col.x + AL.cos(a) * 5, col.y + AL.sin(a) * 5, a, R);
    if (i < 0) break;
    A.hp[i] = A.maxhp[i] = AL.CASTES[caste].hp * (col.sp.hp || 1);
    walkOut(col, caste, A, i, R);   // with its share of the unhealed wounds (and lost legs)
    col.inside[caste]--; out++;
    A.state[i] = state; A.timer[i] = state === ST.GUARD ? 25 + R() * 20 : 0;
    if (tx != null) { A.tx[i] = tx + (R() - 0.5) * 40; A.ty[i] = ty + (R() - 0.5) * 40; A.a[i] = AL.atan2(ty - col.y, tx - col.x); }
  }
  return out;
}

// rough fighting strength of a colony as a rival would judge it (head counts by caste)
function strength(c) {
  const p = c.pop;
  return p[C.WORKER] + p[C.FORAGER] + p[C.SCOUT] * 0.8 + p[C.SOLDIER] * 3 + p[C.MAJOR] * 5;
}
// the known colony this one raids next: near, weak, and whoever has been hitting us
function pickTarget(world, col) {
  const ai = col.ai, me = strength(col), lv = levelOf(col), gap = world._raidOnPlayerT != null && world.t - world._raidOnPlayerT < lv.playerGap;
  let best = -1, bv = 1e9;
  for (const o of world.colonies) {
    if (o === col || o.alive === false || o.out || o.founding || !ai.known[o.id]) continue;
    if (!o.nest && !o.siegeIn) continue;
    if (o.isPlayer && gap) continue;   // difficulty: someone just raided the player
    if (!o.isPlayer && world._raidedT && world._raidedT[o.id] != null && world.t - world._raidedT[o.id] < lv.gangGap && world._raidedBy[o.id] !== col.id) continue;
    const d = AL.hypot(o.x - col.x, o.y - col.y);
    const v = d / 1200 + strength(o) * (twist(o).display || 1) / (me + 5) * 0.6 - ai.grudge[o.id] * 0.6 - (o.isPlayer ? lv.playerBias : 0) + world.R() * 0.35;
    if (v < bv) { bv = v; best = o.id; }
  }
  return best;
}

// a rival lays one egg if there's room and sugar, and (unless it's a batch) protein to raise it. true = laid
function layEgg(world, col, batch) {
  const s = col.stock, T = AL.TUNE, G = T.GROW, ai = col.ai, R = world.R, tw = twist(col);
  let total = col.surf || 0; for (let k = 0; k < AL.NCASTE; k++) total += col.inside[k];
  const room = Math.min(G.aiBroodMax, G.aiBrood + total * G.aiBroodPer) * (tw.broodRoom || 1) * (batch ? 3 : 1);
  if (!(s.sugar > (batch ? 8 : 4) && col.broodQ.length < room && col.broodQ.filter(b => !b.fed).length < s.protein + 6 + (batch ? total * 0.8 : 0))) return false;
  // the AI's caste plan: more soldiers once it has met an enemy, a few majors later, scouts while searching
  const threatened = ai.lastSeen > 0 && world.t - ai.lastSeen < 240;
  const r = R(); let caste = C.WORKER;
  if (r < (threatened ? 0.3 : 0.16)) caste = C.SOLDIER; else if (r < 0.2 + (world.t > 900 ? 0.05 : 0)) caste = C.MAJOR; else if (r < 0.55) caste = C.FORAGER;
  else if (ai.unknown && r > 0.95) caste = C.SCOUT;
  col.broodQ.push({ caste, t: 0, fed: false });
  s.sugar -= 0.3;
  return true;
}
function secondAI(world) {
  const R = world.R, env = world.env;
  sense(world);
  for (const col of world.colonies) {
    if (col.isPlayer || !col.inside || !col.alive || col.founding) continue;
    const s = col.stock, ins = col.inside, ai = col.ai, sp = col.sp, tw = twist(col);
    let inN = 0; for (let k = 0; k < AL.NCASTE; k++) inN += ins[k];
    const outN = col.surf, total = inN + outN;
    // ---- eat ----
    s.sugar -= (AL.Colony.upkeep ? AL.Colony.upkeep(col) : total * T.SUGAR_PER_ANT) * (env.winter ? 0.35 : 1) + T.QUEEN_SUGAR;   // by caste and species size
    if (s.sugar < 10 && s.seeds > 0) { const m = Math.min(s.seeds, 0.6); s.seeds -= m; s.sugar += m * 0.7; }   // seeds keep: eaten when sugar runs low
    if (s.sugar < 0) { s.sugar = 0; for (const k of [C.WORKER, C.FORAGER, C.SOLDIER]) if (ins[k] >= 1 && R() < 0.3) ins[k] -= 1; }
    s.protein *= 0.9995;
    // leafcutters: leaves feed the fungus garden, the fungus feeds the colony
    if (sp.fungus) {
      if (s.leaves > 0) { const conv = Math.min(s.leaves, 0.4 + total * AT.GARDEN_PER); s.leaves -= conv; s.fungus += conv * 1.6; }
      const toP = Math.min(s.fungus, s.protein < 40 ? AT.FUNGUS_PROT : 0.15), toS = Math.min(s.fungus - toP, s.sugar < 80 ? 2 : 0.2);
      s.fungus -= toP + toS; s.protein += toP; s.sugar += toS;
    }
    // ---- breed ----
    // laying climbs with colony size (life.js sizeBonus, same as the player); polygyne rivals' extra queens lay too,
    // and the brood chambers grow with the colony (AL.TUNE.GROW ai*)
    const q = col.queen, G = T.GROW, Life = AL.Life;
    if (sp.polygyne && Life.autoQueen) Life.autoQueen(world, col, total * (tw.queenPop || 1));
    if (q.alive && !env.winter) {
      const grow = Life.sizeBonus ? Life.sizeBonus(sp, total) : 1, queens = 1 + (col.queenX || 0) * T.POLY.layMul;
      q.layT -= sp.breed * grow * queens * (1 + Math.min(1.5, (s.sugar + (col.honey || 0) * 0.5) / 300)) * levelOf(col).breed * (Life.layBrake ? Life.layBrake(col, total, world) : 1);   // (slower as food runs short)   // balance: half of a honeypot rival's banked honey counts as plenty
      if (q.layT <= 0) {
        q.layT = (T.AI_LAY_INTERVAL || T.LAY_INTERVAL) * 1.1;
        // army ants lay in batches (bivouac.js): the eggs build up between them
        if (col.biv && AL.Bivouac && AL.Bivouac.banks(world, col)) q.bank = Math.min(AL.Bivouac.TUNE.BANK_MAX, (q.bank || 0) + AL.Bivouac.TUNE.BATCH_BONUS);
        else layEgg(world, col);
      }
    }
    const rate = 1 / (T.EGG_T + T.LARVA_T + T.PUPA_T) * 0.8 * (sp.nomad ? (sp.broodMul || 1) : 1);   // army brood is slow (one batch per cycle)
    for (let k = col.broodQ.length - 1; k >= 0; k--) {
      const b = col.broodQ[k];
      if (!b.fed) {
        const p0 = AL.CASTES[b.caste].prot * (T.AI_BROOD_FOOD != null ? T.AI_BROOD_FOOD : T.BROOD_FOOD), p = p0 * (tw.broodProt || 1), sg = (p0 - p) * AT.BROOD_SUGAR;
        if (s.protein >= p && s.sugar >= sg + 4) { s.protein -= p; s.sugar -= sg; b.fed = true; } else continue;
      }
      b.t += rate;
      if (b.t >= 1) { ins[b.caste]++; col.broodQ.splice(k, 1); col.stats.born++; }
    }
    // ---- aging inside (numbers retire at roughly their lifespan) ----
    for (let k = 0; k < AL.NCASTE; k++) if (ins[k] > 0 && k !== C.QUEEN) { const die = ins[k] / (AL.CASTES[k].life * (tw.life || 1)); ins[k] = Math.max(0, ins[k] - die); }
    // ---- wounds heal indoors (for sugar) ----
    healInside(col);
    // ---- send foragers out ----
    const quiet = env.winter || env.rain > 0.35 || col.recall;
    const wantOut = quiet ? 0 : Math.min(260, 10 + total * 0.55) * (1 - (env.night || 0) * (1 - (tw.nightOut == null ? 0.5 : tw.nightOut)));
    if (outN < wantOut) {
      const own = tw.forage == null ? 1 : tw.forage;   // (slave-makers: the captives forage, species.js)
      if (own >= 1 || R() < own) { release(world, col, C.FORAGER, ST.WANDER, 3); release(world, col, C.WORKER, ST.WANDER, 2); }
      // scouts go out to look for food (a few stay in for scouting parties while some nest is unknown)
      if (ins[C.SCOUT] >= (ai.unknown ? 4 : 1)) release(world, col, C.SCOUT, ST.WANDER, 1);
    }
    // ---- scouts: some nest is still unknown ----
    if (ai.unknown && !quiet) {
      ai.scoutT -= ai.leads.length ? 2 : 1;
      if (ai.scoutT <= 0) {
        ai.scoutT = AT.SCOUT_EVERY[0] + R() * (AT.SCOUT_EVERY[1] - AT.SCOUT_EVERY[0]);
        const p = scoutPoint(world, col), want = total > 160 ? 4 : 3;
        let n = release(world, col, C.SCOUT, ST.AI_SCOUT, want, p.x, p.y);
        if (n < want) n += release(world, col, C.FORAGER, ST.AI_SCOUT, want - n, p.x, p.y);
        if (n < want) n += release(world, col, C.WORKER, ST.AI_SCOUT, want - n, p.x, p.y);
        ai.scouts += n;
      }
    }
    // ---- notice intruders near the mound ----
    const intruders = col._int || 0;
    if (intruders) {
      ai.lastSeen = world.t;
      if (intruders >= 6) col._raidT = world.t;   // the mound is under attack: wounded ants out there defend it too
      const ix = col._ix, iy = col._iy;
      col.hotspots = [{ x: ix, y: iy, t: world.t, life: 15 }];
      const need = Math.min(30, Math.ceil(intruders * 1.3));
      const sOut = release(world, col, C.SOLDIER, ST.RALLY, need, ix, iy);
      const mOut = release(world, col, C.MAJOR, ST.RALLY, Math.ceil(need / 6), ix, iy);
      // (combat) the nest pours out: workers make up for missing soldiers, more of them the bigger the attack
      const short = Math.ceil(intruders * 1.2) - sOut - mOut * 2;
      if (intruders > 3 && short > 0) release(world, col, C.WORKER, ST.RALLY, Math.min(40, short + (intruders > 8 ? Math.ceil(intruders * 0.3) : 0)), ix, iy);
    }
    // ---- raids on a known colony ----
    ai.raidT -= 1;
    const army = ins[C.SOLDIER] + ins[C.MAJOR] * 2;
    if (ai.raidT <= 0 && !env.winter) {
      const tgt = army + ins[C.WORKER] * 0.3 >= 10 ? pickTarget(world, col) : -1;
      if (tgt >= 0) {
        ai.wave++; ai.target = tgt;
        const lv = levelOf(col);   // difficulty: raid size
        const nS = Math.min(ins[C.SOLDIER], Math.round((5 + ai.wave * 5) * lv.raidSize)), nM = Math.min(ins[C.MAJOR], Math.floor(ai.wave / 2 * lv.raidSize)), nW = Math.min(ins[C.WORKER], Math.floor(ins[C.WORKER] * 0.35 * lv.raidSize));
        release(world, col, C.SOLDIER, ST.RAID, nS); release(world, col, C.MAJOR, ST.RAID, nM); release(world, col, C.WORKER, ST.RAID, nW);
        AL.emit(world, 'raid', { col: col.id, target: tgt, n: nS + nM + nW, wave: ai.wave });
        { const T_ = world.colonies[tgt], d = AL.hypot(T_.x - col.x, T_.y - col.y) || 1; ai.raid = { target: tgt, n0: nS + nM + nW, t0: world.t, ux: (T_.x - col.x) / d, uy: (T_.y - col.y) / d, front: 0, n: nS + nM + nW }; }   // (combat) the party, see raidParty
        ai.raidT = (150 + R() * 90 - Math.min(60, ai.wave * 8)) * (sp.nomad ? 0.8 : 1) * (tw.raidEvery || 1) * lv.raidEvery;
      } else {
        ai.raidT = army + ins[C.WORKER] * 0.3 >= 10 ? 20 : 40;
        if (ai.unknown) ai.scoutT = Math.min(ai.scoutT, 4);   // an army with nobody to fight: look harder
      }
    }
    // ---- a siege inside: attackers vs defenders, numbers win ----
    siegeTick(world, col);
    raidParty(world, col);
    // ---- species-specific rival behaviour (species stage) ----
    if (AL.Species && AL.Species.aiSecond) AL.Species.aiSecond(world, col);
  }
}
function siegeTick(world, col) {
  const sg = col.siege, ins = col.inside;
  let attN = 0; for (let k = 0; k < AL.NCASTE; k++) attN += sg[k];
  if (attN < 0.05) {
    if (col.sieging && col.siegeBy != null) AL.emit(world, 'siegeRepelled', { col: col.id, by: col.siegeBy });
    sg.fill(0); col.sieging = false; return;
  }
  col.sieging = true;
  const by = world.colonies[col.siegeBy || 0], def = ((col.siteTraits && col.siteTraits.defence) || 1) * (twist(col).nestDef || 1);
  // square law: each side loses hit points in proportion to the other side's total bite (numbers win)
  let attD = 0, defD = 0, defN = 0;
  for (let k = 0; k < AL.NCASTE; k++) {
    attD += sg[k] * stat(by, k).dps;
    if (k !== C.QUEEN) { defD += ins[k] * stat(col, k).dps * def; defN += ins[k]; }
  }
  // losses spread over castes by who meets the attackers first (soldiers and majors hold the tunnels)
  const kill = (arr, loss, c, skipQueen) => {
    let wTot = 0; for (let k = 0; k < AL.NCASTE; k++) if (!(skipQueen && k === C.QUEEN)) { const st = stat(c, k); wTot += arr[k] * st.hp * (st.tough || 1) * SGT.EXPOSE[k]; }
    if (wTot <= 0) return 0;
    let dead = 0;
    for (let k = 0; k < AL.NCASTE; k++) {
      if ((skipQueen && k === C.QUEEN) || arr[k] <= 0) continue;
      const st = stat(c, k), eh = st.hp * (st.tough || 1), share = arr[k] * eh * SGT.EXPOSE[k] / wTot;
      const d = Math.min(arr[k], loss * share / eh); arr[k] -= d; dead += d;
    }
    return dead;
  };
  const queenFight = defN < 1 && col.queen.alive;
  const dd = kill(ins, attD * SGT.K, col, true);
  const ad = kill(sg, defD * SGT.K + (queenFight ? SGT.QUEEN_BITE : 0), by, false);
  col.stats.died += dd; by.stats.died += ad; by.stats.kills += dd; col.stats.kills += ad;
  col.siegeLog = { att: attN, def: defN };
  if (defN < 1 && !col._siegeBroken) { col._siegeBroken = true; AL.emit(world, 'siegeBroken', { col: col.id, by: col.siegeBy || 0 }); }
  if (defN >= 2) col._siegeBroken = false;
  // no defenders left: the attackers reach the queen
  if (queenFight) {
    col.queen.hp -= attD * SGT.QUEEN_K;
    if (col.queen.hp <= 0 && AL.Life && AL.Life.promoteQueen && AL.Life.promoteQueen(world, col)) return;   // polygyne: the next queen in the chamber
    if (col.queen.hp <= 0) {
      col.queen.hp = 0; col.queen.alive = false;
      const data = { handled: false };
      AL.emit(world, 'queenDied', { col: col.id, colony: col, data, by: col.siegeBy || 0 });
      if (!data.handled && AL.Life && AL.Life.queenLost) AL.Life.queenLost(world, col);
      // the survivors come back out as foragers
      for (let k = 0; k < AL.NCASTE; k++) { const n = Math.floor(sg[k]); for (let j = 0; j < n; j++) { const a = world.R() * AL.TAU; world.ants.spawn(col.siegeBy || 0, k, L.SURFACE, col.x + AL.cos(a) * 8, col.y + AL.sin(a) * 8, a, world.R); } }
      sg.fill(0);
    }
  }
}
// a raid party on the march: keep it together (front-runners wait, stragglers hurry; orders.js reads ai.raid)
// and call it off once it has been cut down and the defenders hold the field
function raidParty(world, col) {
  const ai = col.ai, r = ai.raid; if (!r) return;
  const A = world.ants, tgt = world.colonies[r.target];
  let n = 0, sp = 0, fight = 0;
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.col[i] !== col.id || A.layer[i] !== L.SURFACE) continue;
    const st = A.state[i];
    if (st !== ST.RAID && !(st === ST.FIGHT && A.prev[i] === ST.RAID)) continue;
    n++; sp += (A.x[i] - col.x) * r.ux + (A.y[i] - col.y) * r.uy; if (st === ST.FIGHT) fight++;
  }
  r.n = n; r.front = n ? sp / n : 0; r.fighting = fight;
  if (!n) { if (world.t - r.t0 > 10) ai.raid = null; return; }
  if (world.t - r.t0 > 20 && n < Math.max(2, r.n0 * SGT.REPEL) && !r.inside) {
    // beaten back: whoever is left turns for home
    for (let i = 0; i < A.high; i++) {
      if (!A.state[i] || A.col[i] !== col.id || A.layer[i] !== L.SURFACE) continue;
      const st = A.state[i];
      if (st === ST.RAID || (st === ST.FIGHT && A.prev[i] === ST.RAID)) { if (AL.Combat && AL.Combat.flee) AL.Combat.flee(world, i); else A.state[i] = ST.HOMING; }
    }
    AL.emit(world, 'raidRepelled', { col: col.id, target: r.target, lost: r.n0 - n, n0: r.n0, x: tgt ? tgt.x : col.x, y: tgt ? tgt.y : col.y });
    ai.raid = null;
  }
}
// enemy ants close to an AI mound in a fighting mood break in (one pass over the ants for every AI mound)
const BRK = [], BRK_X = new Float64Array(64), BRK_Y = new Float64Array(64), BRK_R2 = new Float64Array(64);
function tickAI(world) {
  if (world.tick % 5) return;
  const A = world.ants;
  BRK.length = 0;
  for (const col of world.colonies) if (!col.isPlayer && (col.inside || col.bot) && col.siegeIn && col.alive && !col.founding) BRK.push(col);
  // satellites with their own nest (anyone's, people's too): enemies at the door break into its tunnels
  const H = world.homes; if (H) for (let k = world.colonies.length; k < H.length && BRK.length < 64; k++) { const h = H[k]; if (h && h.siegeIn && !h.gone && h.sat && h.sat.state !== 'ruin' && h.sat.state !== 'founding') BRK.push(h); }
  if (!BRK.length) return;
  const NB = BRK.length, bx = BRK_X, by = BRK_Y, br2 = BRK_R2;
  for (let k = 0; k < NB; k++) { bx[k] = BRK[k].x; by[k] = BRK[k].y; br2[k] = !BRK[k].sat && AL.Combat && AL.Combat.doorOpen && !AL.Combat.doorOpen(world, BRK[k]) ? -1 : AL.pow(BRK[k].moundR * 0.45 + 8, 2); }   // (combat) a held door: fight there first
  for (let i = 0; i < A.high; i++) {
    if (!A.state[i] || A.layer[i] !== L.SURFACE) continue;
    const st = A.state[i];
    if (st !== ST.GUARD && st !== ST.RALLY && st !== ST.RECRUIT && st !== ST.RAID && st !== ST.WANDER) continue;
    if (st === ST.WANDER && A.caste[i] !== C.SOLDIER && A.caste[i] !== C.MAJOR) continue;
    const x = A.x[i], y = A.y[i], c = A.col[i];
    for (let k = 0; k < NB; k++) {
      if (BRK[k].id === c) continue;
      const dx = x - bx[k], dy = y - by[k];
      if (dx * dx + dy * dy < br2[k]) { BRK[k].siegeIn(world, i); break; }
    }
  }
}

AL.registerSystem({
  id: 'ai', order: 6, skipsFounding: true,   // honours col.founding itself (see founding-race.js)
  enabled: opts => !opts.benchOnly,
  init(world, opts) {
    for (const c of world.colonies) if (!c.isPlayer) setup(world, c, opts);
    world.surfaceHandlers[ST.AI_SCOUT] = scoutHandler;
  },
  tick: tickAI,
  second: secondAI,
});
AL.on('raid', (w, d) => {   // for playerGap / gangGap
  if (!w || !w.colonies || !w.colonies[d.target]) return;
  if (w.colonies[d.target].isPlayer) w._raidOnPlayerT = w.t;
  (w._raidedT = w._raidedT || {})[d.target] = w.t; (w._raidedBy = w._raidedBy || {})[d.target] = d.col;
});
AL.AI = { siegeIn, LEVELS, levelKey, levelOf, setup, setupBot, enterAbstract, release, wounds, walkOut, healInside, siegeTick, raidParty, power, knows, discover, addLead, noticeR, sense, scoutPoint, pickTarget, strength, twist, layEgg, TUNE: AT, SPECIES_TUNE: AIS };
if (NODE) module.exports = AL.AI;
})(typeof window !== 'undefined' ? window : globalThis);
