// Headless balance harness for the species (not a test file: run `node tools/species-harness.js [secs] [seeds]`).
// A hands-off player colony of each species (auto egg mix, no trails painted) against default rivals.
const fs = require('fs'), path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'fog.js', 'founding-sites.js', 'founding.js', 'expansion.js', 'victory.js',
  'world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js', 'species.js'])
  if (fs.existsSync(path.join(__dirname, '../public', f))) require('../public/' + f);
const C = AL.CASTE;
const SECS = +(process.argv[2] || 900), SEEDS = (process.argv[3] || '11,23').split(',').map(Number);
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const KEYS = (ONLY || Object.keys(AL.SPECIES));
// a recruit path from a to b in ~100-unit steps, each point nudged off obstacles (what a player would draw)
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
const MODE = process.env.MODE || 'hands-off';   // hands-off | famine (all food gone from 6:00) | raids (slave-makers recruit onto the rival mound every 2.5 min)
function run(spKey, seed, rival) {
  const w = AL.Sim.createWorld({ seed, species: spKey, rivalSpecies: rival ? [rival] : undefined, noFog: true });
  let popF = 0, starve = 0, peak = 0, minSug = 1e9, t0 = Date.now(), famineAt = -1;
  const p = w.player;
  for (let s = 0; s < SECS && !w.over; s++) {
    if (MODE === 'famine' && s >= 360) { for (const f of w.surface.foods) if (f.kind !== AL.CARRY.WATER) f.amount = 0; w.surface.foodDirty = true; if (famineAt < 0 && p.starving) famineAt = s - 360; if (s === 360) popF = p.pop.reduce((a, b) => a + b, 0); }
    if (MODE === 'raids' && s >= 120 && s % 150 === 120 && p.sp.raider) { const r = w.colonies[1]; AL.Orders.addRecruit(w, 0, pathTo(w, p, r), 14); }
    for (let k = 0; k < 30; k++) AL.Sim.step(w);
    if (p.starving) starve++;
    const pop = p.pop.reduce((a, b) => a + b, 0); if (pop > peak) peak = pop;
    if (s > 60) minSug = Math.min(minSug, p.stock.sugar);
  }
  const pop = p.pop.reduce((a, b) => a + b, 0);
  const r = w.colonies[1];
  return { sp: spKey, seed, pop, peak, cap: p.pop[C.CAPTIVE] || 0, hp: p.pop[C.HONEYPOT], maj: p.pop[C.MAJOR], sol: p.pop[C.SOLDIER],
    sugar: p.stock.sugar | 0, prot: p.stock.protein | 0, seeds: p.stock.seeds | 0, starve, minSug: minSug | 0, born: p.stats.born, died: p.stats.died,
    brood: p.brood.length, famineAt, popF, honey: (p.honey || 0) | 0, captured: (p.spStats || {}).captured || 0, over: w.over ? (w.over.win ? 'WIN ' : 'LOSE ') + (w.over.t | 0) : '', rival: r ? (r.spKey + ' ' + r.pop.reduce((a, b) => a + b, 0)) : '', ms: Date.now() - t0 };
}
const rows = [];
for (const k of KEYS) for (const seed of SEEDS) { const r = run(k, seed, process.env.RIVAL); rows.push(r); console.log(JSON.stringify(r)); }
console.log('\nmode: ' + MODE + ', ' + SECS + ' s');
console.log('| species | seed | pop end | peak | captives | honeypots | majors | soldiers | sugar | protein | seeds | starve s | min sugar | born | died | captured | famine->starving s | pop at famine | honey | rival |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.sp} | ${r.seed} | ${r.pop} | ${r.peak} | ${r.cap} | ${r.hp} | ${r.maj} | ${r.sol} | ${r.sugar} | ${r.prot} | ${r.seeds} | ${r.starve} | ${r.minSug} | ${r.born} | ${r.died | 0} | ${r.captured} | ${r.famineAt} | ${r.popF} | ${r.honey} | ${r.rival} ${r.over} |`);
