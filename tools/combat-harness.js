// Headless combat tournament (not a test file). Run: node tools/combat-harness.js [mode] [seeds]
//   modes: castes   N v N of each caste pair, plus equal-cost matchups (protein + half the sugar)
//          value    how many ants of each species it takes to beat 16 fire ants (vs the colony it fields)
//          species  a mixed squad (workers + soldiers) of every species pairing, equal count and equal cost
//          raid     full worlds: an AI raid wave on the player's real nest, by wave size (and the player's defence)
//          siege    the player recruits N soldiers onto a rival mound: does the siege kill the queen?
//          rivals   AI vs AI: a raid from one abstract nest on another
//          all      everything (default)
// Every fight reports: winner, survivors, time to kill, stall seconds (both sides alive, nobody fighting)
// and how many ants wandered off (> 120 units from the fight while enemies were still alive).
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'fog.js', 'founding-sites.js', 'founding.js', 'founding-race.js', 'species.js', 'expansion.js', 'victory.js'])
  if (fs.existsSync(path.join(__dirname, '../public', f))) require('../public/' + f);
const FULL = ['world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js'];
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER;
// try numbers without editing data.js: OVR='{"soldier":{"dps":8},"fire":{"dps":1.1}}' (caste or species keys)
if (process.env.OVR) for (const [k, v] of Object.entries(JSON.parse(process.env.OVR))) Object.assign(AL.CASTES.find(c => c.key === k) || AL.SPECIES[k], v);
const MODE = process.argv[2] || 'all';
const SEEDS = (process.argv[3] || '3,7,11,13,17,19').split(',').map(Number);
const out = [];
const log = s => { out.push(s); console.log(s); };
const CB = AL.Combat;
const hpOf = (col, caste) => CB.maxHp ? CB.maxHp(col, caste) : AL.CASTES[caste].hp * (col.sp.hp || 1);
// what an ant costs the colony: the protein to raise it plus half the sugar it eats over its life (upkeep ~ size^1.6)
const cost = caste => { const c = AL.CASTES[caste]; return c.prot + 0.5 * AL.TUNE.SUGAR_PER_ANT * Math.pow(c.size, AL.TUNE.UPKEEP_EXP || 1) * c.life; };

// ---- arena: an empty patch of yard, AI asleep, two squads facing each other ----
function arena(seed, spA, spB) {
  const w = AL.Sim.createWorld({ seed, species: spA || 'fire', rivalSpecies: [spB || 'fire'], noFog: true });
  const A = w.ants;
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.layer[i] === L.SURFACE) A.kill(i);
  for (const c of w.colonies) if (c.ai) { c.ai.raidT = 1e9; c.ai.scoutT = 1e9; c.recall = true; }
  w.player.recall = true;
  for (const cr of w.surface.creatures) cr.alive = false;
  // mirror the rival's home across the arena so ants running home run the same way off the field
  const p = w.player; w.colonies[1].x = 4000 - p.x; w.colonies[1].y = p.y;
  return w;
}
function squad(w, col, caste, n, x, y, face, mood) {
  const A = w.ants, c = w.colonies[col], ids = [];
  const per = Math.ceil(Math.sqrt(n)), sp = 6 * AL.CASTES[caste].size * (c.sp.size || 1);
  for (let k = 0; k < n; k++) {
    const gx = (k % per) * sp * face, gy = (((k / per) | 0) - (per - 1) / 2) * sp;
    const i = A.spawn(col, caste, L.SURFACE, x - gx, y + gy, face > 0 ? 0 : Math.PI, w.R);
    A.hp[i] = A.maxhp[i] = hpOf(c, caste);
    A.size[i] = c.sp.size || 1;
    if (mood === 'wander') { A.state[i] = ST.WANDER; A.timer[i] = 0; }
    else { A.state[i] = ST.GUARD; A.tx[i] = x + 15 * face; A.ty[i] = y; A.timer[i] = 999; }
    ids.push([i, A.uid[i]]);
  }
  return ids;
}
const alive = (w, ids) => ids.filter(([i, u]) => w.ants.state[i] && w.ants.uid[i] === u);
// still on the field: alive, on the surface and within 150 of the fight (ants that ran home have left it)
const present = (w, ids, cx, cy) => alive(w, ids).filter(([i]) => w.ants.layer[i] === 0 && AL.dist2(w.ants.x[i], w.ants.y[i], cx, cy) < 150 * 150);
function fight(w, a, b, cx, cy, maxT) {
  const A = w.ants;
  let t = 0, stall = 0, wander = 0, contact = -1, end = -1;
  const hp0 = side => side.reduce((s, [i]) => s + A.maxhp[i], 0), H0a = hp0(a), H0b = hp0(b);
  while (t < maxT) {
    for (let k = 0; k < 15; k++) AL.Sim.step(w);
    t += 0.5;
    const la = present(w, a, cx, cy), lb = present(w, b, cx, cy);
    const fa = la.filter(([i]) => A.state[i] === ST.FIGHT).length, fb = lb.filter(([i]) => A.state[i] === ST.FIGHT).length;
    if ((fa || fb) && contact < 0) contact = t;
    if (!la.length || !lb.length) { end = t; break; }
    if (!fa && !fb && contact >= 0) stall += 0.5;
    let off = 0; for (const [i] of la.concat(lb)) if (AL.dist2(A.x[i], A.y[i], cx, cy) > 90 * 90) off++;
    wander = Math.max(wander, off);
  }
  const la = present(w, a, cx, cy), lb = present(w, b, cx, cy);
  const ha = la.reduce((s, [i]) => s + A.hp[i], 0) / H0a, hb = lb.reduce((s, [i]) => s + A.hp[i], 0) / H0b;
  const win = !lb.length && la.length ? 'A' : !la.length && lb.length ? 'B' : ha > hb ? 'a' : hb > ha ? 'b' : '=';
  // fled: alive but off the field
  const fled = alive(w, a).length - la.length + alive(w, b).length - lb.length;
  return { win, sa: la.length, sb: lb.length, ha, hb, t: end > 0 ? end : maxT, contact, stall, wander, fled };
}
function duel(seed, ca, na, cb, nb, opt) {
  opt = opt || {};
  const w = arena(seed, opt.spA, opt.spB), x = 2000, y = 2700;
  const a = [], b = [];
  const f = opt.flip ? -1 : 1;   // flip: colony 0 starts on the right (cancels any left/right luck of the ground)
  for (const [caste, n] of (Array.isArray(ca) ? ca : [[ca, na]])) a.push(...squad(w, 0, caste, n, x - 18 * f, y, f, opt.mood));
  for (const [caste, n] of (Array.isArray(cb) ? cb : [[cb, nb]])) b.push(...squad(w, 1, caste, n, x + 18 * f, y, -f, opt.mood));
  return fight(w, a, b, x, y, opt.maxT || 60);
}
const both = (fn) => SEEDS.flatMap(s => [fn(s, false), fn(s, true)]);
const pct = v => Math.round(v * 100) + '%';
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
function agg(rs) {
  const n = rs.length, m = k => rs.reduce((s, r) => s + r[k], 0) / n;
  const wa = rs.filter(r => r.win === 'A' || r.win === 'a').length, wb = rs.filter(r => r.win === 'B' || r.win === 'b').length;
  return { wa, wb, n, sa: m('sa'), sb: m('sb'), t: m('t'), stall: m('stall'), wander: m('wander'), ha: m('ha'), hb: m('hb'), fled: m('fled') };
}

// ---- castes ----
const CASTES = [['worker', C.WORKER], ['forager', C.FORAGER], ['scout', C.SCOUT], ['soldier', C.SOLDIER], ['major', C.MAJOR]];
function modeCastes() {
  log('\n### Equal numbers (10 v 10, guard mood, fire v fire), ' + SEEDS.length + ' seeds x both sides');
  log('| A v B | A wins | B wins | A left | B left | fled | time s | stall s | strayed |');
  log('|---|---|---|---|---|---|---|---|---|');
  for (let p = 0; p < CASTES.length; p++) for (let q = p; q < CASTES.length; q++) {
    const rs = both((s, fl) => duel(s, CASTES[p][1], 10, CASTES[q][1], 10, { flip: fl }));
    const g = agg(rs);
    log(`| ${CASTES[p][0]} v ${CASTES[q][0]} | ${g.wa} | ${g.wb} | ${f1(g.sa)} | ${f1(g.sb)} | ${f1(g.fled)} | ${f1(g.t)} | ${f1(g.stall)} | ${f1(g.wander)} |`);
  }
  log('\n### Equal cost (budget 30 = protein to raise + half its lifetime sugar), guard mood');
  log('| A (n) v B (n) | A wins | B wins | A left | B left | A hp left | B hp left | time s | stall s |');
  log('|---|---|---|---|---|---|---|---|---|');
  for (let p = 0; p < CASTES.length; p++) for (let q = p + 1; q < CASTES.length; q++) {
    const na = Math.round(30 / cost(CASTES[p][1])), nb = Math.round(30 / cost(CASTES[q][1]));
    const rs = both((s, fl) => duel(s, CASTES[p][1], na, CASTES[q][1], nb, { flip: fl }));
    const g = agg(rs);
    log(`| ${CASTES[p][0]} (${na}) v ${CASTES[q][0]} (${nb}) | ${g.wa} | ${g.wb} | ${f1(g.sa)} | ${f1(g.sb)} | ${pct(g.ha)} | ${pct(g.hb)} | ${f1(g.t)} | ${f1(g.stall)} |`);
  }
  log('\n### Swarms and outnumbered fights');
  log('| matchup | A wins | B wins | A left | B left | fled | time s | stall s | strayed |');
  log('|---|---|---|---|---|---|---|---|---|');
  const sc = [
    ['3 majors v 20 workers', C.MAJOR, 3, C.WORKER, 20, {}],
    ['6 soldiers v 20 workers', C.SOLDIER, 6, C.WORKER, 20, {}],
    ['12 workers v 4 workers', C.WORKER, 12, C.WORKER, 4, {}],
    ['20 workers v 10 workers', C.WORKER, 20, C.WORKER, 10, {}],
    ['10 foragers v 10 foragers (wandering)', C.FORAGER, 10, C.FORAGER, 10, { mood: 'wander' }],
    ['4 soldiers v 12 foragers (wandering)', C.SOLDIER, 4, C.FORAGER, 12, { mood: 'wander' }],
    ['mixed 8w+4s v 8w+4s', [[C.WORKER, 8], [C.SOLDIER, 4]], 0, [[C.WORKER, 8], [C.SOLDIER, 4]], 0, {}],
    ['mixed 8w+4s v 16 workers', [[C.WORKER, 8], [C.SOLDIER, 4]], 0, C.WORKER, 16, {}],
  ];
  for (const [name, ca, na, cb, nb, o] of sc) {
    const g = agg(both((s, fl) => duel(s, ca, na, cb, nb, Object.assign({ flip: fl }, o))));
    log(`| ${name} | ${g.wa} | ${g.wb} | ${f1(g.sa)} | ${f1(g.sb)} | ${f1(g.fled)} | ${f1(g.t)} | ${f1(g.stall)} | ${f1(g.wander)} |`);
  }
}

// ---- species ----
function modeSpecies() {
  const K = AL.SPECIES_ORDER.filter(k => AL.SPECIES[k]);
  const mix = n => [[C.WORKER, Math.round(n * 0.75)], [C.SOLDIER, Math.round(n * 0.25)]];
  // a colony's fighting mix: slave-makers' own daughters are nearly all sickle-jawed soldiers, bullet ants are all big workers
  const MIXC = { slavemaker: [0.4, 0.6], bullet: [1, 0] };
  const mixOf = (k, n) => { const m = MIXC[k] || [0.75, 0.25]; return [[C.WORKER, Math.round(n * m[0])], [C.SOLDIER, Math.round(n * m[1])]].filter(q => q[1] > 0); };
  // equal cost: per-ant cost (species broodCost) and how many ants a colony of that species fields (breed, start)
  // colony size at 15:00 relative to fire ants (tools/species-harness.js 900 s, hands-off, seed 11): what a colony fields
  const FIELD = { fire: 1, leafcutter: 1, carpenter: 1, army: 1.1, honeypot: 0.93, harvester: 0.83, slavemaker: 0.36, bullet: 0.3 };
  const field = k => FIELD[k] || 1;
  for (const eq of (process.env.SPT ? [process.env.SPT] : ['count', 'cost'])) {
    log('\n### Species, equal ' + (eq === 'cost' ? 'colony (16 x a typical 15:00 colony relative to fire, in that species\' fighting mix)' : 'count (16 each, 75% workers + 25% soldiers)') + ', win share of the row species');
    log('| | ' + K.join(' | ') + ' | mean | margin |');
    log('|---|' + K.map(() => '---|').join('') + '---|---|');
    const score = {};
    for (const a of K) {
      const row = [];
      let tot = 0, n = 0, mg = 0;
      for (const b of K) {
        if (a === b) { row.push('-'); continue; }
        const key = [a, b].sort().join('/');
        if (!score[key]) {
          const na = eq === 'count' ? 16 : Math.max(2, Math.round(16 * field(a))), nb = eq === 'count' ? 16 : Math.max(2, Math.round(16 * field(b)));
          // both ways round (the player's colony slot plays each side once per seed)
          const ma = eq === 'count' ? mix(na) : mixOf(a, na), mb = eq === 'count' ? mix(nb) : mixOf(b, nb);
          const ab = SEEDS.map((s, k) => duel(s, ma, 0, mb, 0, { spA: a, spB: b, flip: k & 1 }));
          const ba = SEEDS.map((s, k) => duel(s, mb, 0, ma, 0, { spA: b, spB: a, flip: !(k & 1) }));
          const wA = ab.reduce((s, r) => s + (r.win === 'A' || r.win === 'a' ? 1 : r.win === '=' ? 0.5 : 0), 0) + ba.reduce((s, r) => s + (r.win === 'B' || r.win === 'b' ? 1 : r.win === '=' ? 0.5 : 0), 0);
          // margin: share of its starting hit points the row species still has on the field minus the other's
          const mA = (ab.reduce((s, r) => s + r.ha - r.hb, 0) + ba.reduce((s, r) => s + r.hb - r.ha, 0)) / (ab.length * 2);
          score[key] = { [a]: wA / (ab.length * 2), ['m' + a]: mA };
          score[key][b] = 1 - score[key][a]; score[key]['m' + b] = -mA;
        }
        const v = score[key][a]; row.push(pct(v)); tot += v; n++; mg += score[key]['m' + a];
      }
      log(`| ${a} | ${row.join(' | ')} | ${pct(tot / n)} | ${(mg / n >= 0 ? '+' : '') + Math.round(mg / n * 100)} |`);
    }
  }
}

// ---- species value: how many ants of each species it takes to beat 16 fire ants (same fighting mix) ----
// A species is fair at the colony level when that number is about the size of the colony it fields (FIELD x 16):
// below it, its colonies out-fight fire ants of the same age; above it, they lose (square law: strength ~ n^2).
function modeValue() {
  const K = AL.SPECIES_ORDER.filter(k => AL.SPECIES[k]);
  const FIELD = { fire: 1, leafcutter: 1, carpenter: 1, army: 1.1, honeypot: 0.93, harvester: 0.83, slavemaker: 0.36, bullet: 0.3 };
  const MIXC = { slavemaker: [0.4, 0.6], bullet: [1, 0] };
  const mixOf = (k, n) => { const m = MIXC[k] || [0.75, 0.25]; const s = Math.max(m[1] ? 1 : 0, Math.round(n * m[1])); return [[C.WORKER, n - s], [C.SOLDIER, s]].filter(q => q[1] > 0); };
  const winShare = (k, n) => { let w = 0, t = 0; for (const s of SEEDS) for (const fl of [false, true]) { const r = duel(s, mixOf(k, n), 0, mixOf('fire', 16), 0, { spA: k, spB: 'fire', flip: fl }); w += r.win === 'A' || r.win === 'a' ? 1 : r.win === '=' ? 0.5 : 0; t++; } return w / t; };
  log('\n### Species value: ants needed to beat 16 fire ants half the time (each in its own fighting mix), vs the colony it fields at 15:00');
  log('| species | ants needed | fire ants one is worth | fields (16 x colony size) | colony strength vs fire (n^2) |');
  log('|---|---|---|---|---|');
  for (const k of K) {
    let lo = 2, hi = 64;
    while (lo < hi) { const m = (lo + hi) >> 1; if (winShare(k, m) >= 0.5) hi = m; else lo = m + 1; }
    const f = FIELD[k] * 16;
    log(`| ${k} | ${lo} | ${(16 / lo).toFixed(2)} | ${f.toFixed(1)} | ${(Math.pow(f / lo, 2)).toFixed(2)} |`);
  }
}

// ---- full-world scenarios ----
function full() { for (const f of FULL) require('../public/' + f); }
function count(w, col, layer) { let n = 0; const A = w.ants; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col && (layer == null || A.layer[i] === layer)) n++; return n; }
function popOf(c) { let n = 0; for (let k = 0; k < c.pop.length; k++) if (k !== C.QUEEN) n += c.pop[k]; return n; }
// an AI wave of `n` soldiers (+ workers) on the player's real nest; the player has `def` soldiers at home
function raidOnPlayer(seed, n, def, secs) {
  const w = AL.Sim.createWorld({ seed, noFog: true }), r = w.colonies[1], p = w.player, A = w.ants;
  for (const cr of w.surface.creatures) cr.alive = false;
  if (w.creatures) { w.creatures.birdT = 1e9; if (w.creatures.lairs) w.creatures.lairs.length = 0; }
  AL.AI.discover(w, 1, 0);
  // player defenders inside the nest
  for (let k = 0; k < def; k++) { const t = w.nest.tiles[AL.Nest.CH.QUEEN][k % w.nest.tiles[AL.Nest.CH.QUEEN].length]; const [x, y] = AL.Nest.centre(w.nest, t); const i = A.spawn(0, C.SOLDIER, L.NEST, x, y, 0, w.R); A.hp[i] = A.maxhp[i] = hpOf(p, C.SOLDIER); A.timer[i] = 0.1 + k * 0.05; }
  r.inside[C.SOLDIER] = n; r.inside[C.WORKER] = Math.max(r.inside[C.WORKER], 30); r.ai.wave = Math.ceil((n - 5) / 5); r.ai.raidT = 1;
  let broke = 0, stolen = 0, kills0 = p.stats.kills, died0 = p.stats.died;
  const offB = AL.on('breakIn', (ww, d) => { if (ww === w && d.target === 0) broke++; });
  const offS = AL.on('foodStolen', ww => { if (ww === w) stolen++; });
  let firstFight = -1, doorFight = 0;
  for (let s = 0; s < secs && !w.over; s++) {
    for (let k = 0; k < 30; k++) AL.Sim.step(w);
    let near = 0; for (let i = 0; i < A.high; i++) if (A.state[i] === ST.FIGHT && A.layer[i] === 0 && AL.dist2(A.x[i], A.y[i], p.x, p.y) < 160 * 160) near++;
    if (near && firstFight < 0) firstFight = s; doorFight += near ? 1 : 0;
  }
  offB(); offS();
  const raidersLeft = (() => { let n = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 1 && (A.state[i] === ST.RAID || A.layer[i] === L.NEST || A.state[i] === ST.FIGHT)) n++; return n; })();
  return { broke, stolen, kills: p.stats.kills - kills0, died: p.stats.died - died0, queen: p.queen.alive ? Math.round(p.queen.hp) : 'dead', over: w.over ? w.over.reason.slice(0, 20) : '', doorFight, raidersLeft };
}
function modeRaid() {
  full();
  log('\n### AI raid on the player\'s real nest (wave of N soldiers + 35% of home workers; player starts with D extra soldiers), 150 s');
  log('| N raiders | D defenders | seed | break-ins | food stolen | raiders killed | player dead | queen hp | s fighting at door | raiders still in |');
  log('|---|---|---|---|---|---|---|---|---|---|');
  for (const [n, d] of [[10, 0], [25, 0], [25, 10], [50, 10], [60, 30]]) for (const s of SEEDS) {
    const r = raidOnPlayer(s, n, d, 150);
    log(`| ${n} | ${d} | ${s} | ${r.broke} | ${r.stolen} | ${Math.round(r.kills)} | ${Math.round(r.died)} | ${r.queen} | ${r.doorFight} | ${r.raidersLeft} ${r.over} |`);
  }
}
// a recruit path from a to b in ~100-unit steps, nudged off obstacles
function pathTo(w, a, b) {
  const S = w.surface, n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 100), pts = [];
  const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1;
  for (let k = 0; k <= n; k++) {
    const x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
    let q = { x, y };
    for (let o = 0; o < 400 && AL.Surface.isBlocked(S, q.x, q.y); o += 20) for (const sg of [1, -1]) { const t = { x: x + nx / nl * o * sg, y: y + ny / nl * o * sg }; if (!AL.Surface.isBlocked(S, t.x, t.y)) { q = t; break; } }
    pts.push(q);
  }
  return pts;
}
// the player marches n soldiers (spawned at its door, recruit path to the rival mound) on a rival that grew for `grow` s
function siegeRival(seed, n, grow, extraDef, caste) {
  const w = AL.Sim.createWorld({ seed, noFog: true }), r = w.colonies[1], p = w.player, A = w.ants;
  for (const cr of w.surface.creatures) cr.alive = false;
  r.ai.raidT = 1e9;
  for (let s = 0; s < grow; s++) for (let k = 0; k < 30; k++) AL.Sim.step(w);
  if (extraDef) r.inside[C.SOLDIER] += extraDef;
  const defPop = popOf(r);
  const ids = [];
  for (let k = 0; k < n; k++) { const a = k / n * AL.TAU; const i = A.spawn(0, caste || C.SOLDIER, L.SURFACE, p.x + Math.cos(a) * 8, p.y + Math.sin(a) * 8, a, w.R); A.hp[i] = A.maxhp[i] = hpOf(p, caste || C.SOLDIER); ids.push(i); }
  const o = AL.Orders.addRecruit(w, 0, pathTo(w, p, r), n); o.assigned = n; o.full = true;   // nobody else pulled out
  for (const i of ids) { A.state[i] = ST.RECRUIT; A.str[i] = o.id; A.wp[i] = 0; }
  let t = 0, sieged = -1;
  for (; t < 300 && r.queen.alive; t++) { for (let k = 0; k < 30; k++) AL.Sim.step(w); if (r.sieging && sieged < 0) sieged = t; }
  return { killed: !r.queen.alive, t: r.queen.alive ? '-' : t, sieged, defPop, defLeft: Math.round(popOf(r)), mine: alive(w, ids.map(i => [i, A.uid[i]])).length };
}
function modeSiege() {
  log('\n### Player siege: N soldiers recruited onto a rival mound after the rival grew G s (300 s limit)');
  log('| N soldiers | rival grew s | seed | rival pop | queen killed | time s | siege began s | rival pop left |');
  log('|---|---|---|---|---|---|---|---|');
  for (const [n, g] of [[20, 120], [40, 120], [40, 480], [80, 480], [120, 480]]) for (const s of SEEDS) {
    const r = siegeRival(s, n, g);
    log(`| ${n} | ${g} | ${s} | ${r.defPop} | ${r.killed ? 'yes' : 'no'} | ${r.t} | ${r.sieged} | ${r.defLeft} |`);
  }
}
// AI vs AI: colony 1 raids colony 2 with its wave
function rivals(seed, n, def) {
  const w = AL.Sim.createWorld({ seed, colonies: 3, noFog: true, rivalSpecies: ['fire', 'fire'] }), a = w.colonies[1], b = w.colonies[2];
  for (const cr of w.surface.creatures) cr.alive = false;
  for (const c of w.colonies) if (c.ai) c.ai.raidT = 1e9;
  AL.AI.discover(w, 1, 2);
  a.inside[C.SOLDIER] = n; b.inside[C.SOLDIER] = def; a.ai.wave = Math.ceil((n - 5) / 5); a.ai.raidT = 1;
  let b0 = 0; for (let k = 0; k < AL.NCASTE; k++) b0 += b.inside[k];
  b0 = Math.round(b0 + count(w, 2, 0));
  let sieged = 0;
  for (let s = 0; s < 240 && b.queen.alive; s++) { for (let k = 0; k < 30; k++) AL.Sim.step(w); if (b.sieging) sieged++; }
  return { killed: !b.queen.alive, b0, b1: Math.round(popOf(b)), sieged, aLeft: Math.round(popOf(a)) };
}
function modeRivals() {
  log('\n### AI v AI: a raid wave of N soldiers on a rival nest holding D soldiers (240 s)');
  log('| N | D | seed | defender pop | queen killed | defender pop after | s under siege | attacker pop after |');
  log('|---|---|---|---|---|---|---|---|');
  for (const [n, d] of [[15, 5], [30, 5], [30, 20], [60, 20]]) for (const s of SEEDS) {
    const r = rivals(s, n, d);
    log(`| ${n} | ${d} | ${s} | ${r.b0} | ${r.killed ? 'yes' : 'no'} | ${r.b1} | ${r.sieged} | ${r.aLeft} |`);
  }
}

if (require.main !== module) { module.exports = { arena, squad, fight, duel, agg, AL, pathTo }; return; }
const t0 = Date.now();
if (MODE === 'castes' || MODE === 'all') modeCastes();
if (MODE === 'species' || MODE === 'all') modeSpecies();
if (MODE === 'value' || MODE === 'all') modeValue();
if (MODE === 'siege' || MODE === 'all') modeSiege();
if (MODE === 'rivals' || MODE === 'all') modeRivals();
if (MODE === 'raid' || MODE === 'all') modeRaid();
log('\n(' + MODE + ', seeds ' + SEEDS.join(',') + ', ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
if (process.env.OUT) fs.writeFileSync(process.env.OUT, out.join('\n') + '\n');
