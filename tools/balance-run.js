// Headless balance run (not a test): `node tools/balance-run.js <seed> [minutes] [species,species,...]`.
// An all-AI skirmish: every colony, the "player" one too, is an AI rival with a real nest (opts.rivalNests),
// medium map, run until one colony is left or the time is up. Prints one JSON line of what happened.
// tools/balance.js runs several of these side by side (each match in its own process: some modules keep state).
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'bivouac', 'fog', 'species', 'expansion', 'research',
  'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'eco-hunters', 'swarm', 'brush', 'cmd', 'raids', 'aphids', 'links', 'nestplan', 'nestclimate'])
  try { require('../public/' + f + '.js'); } catch (e) { /* optional module */ }
const C = AL.CASTE;
const seed = +(process.argv[2] || 1), MIN = +(process.argv[3] || 45);
const SP = (process.argv[4] || 'fire,carpenter,bullet,fire').split(',');
const w = AL.Sim.createWorld({ seed, species: SP[0], rivalSpecies: SP.slice(1), colonies: SP.length, rivalNests: true, aiLevel: 'normal', noFog: true });
// the player's colony becomes an AI rival too
const p = w.player;
p.isPlayer = false; p.bot = true;
AL.AI.setupBot(w, p, w.opts);
const NC = w.colonies.length, S = w.colonies.map(c => ({
  sp: c.sp.key, pop: [], peak: 0, died: null, killedBy: null, deaths: {}, born: 0, raids: 0, breakIns: 0, sats: 0, starveT: 0, food: [], kills: 0, research: 0,
}));
const pop = c => c.popAll || (c.pop ? c.pop.reduce((a, b) => a + b, 0) : 0);
AL.on('antDied', (ww, d) => { if (ww !== w || d.col == null || !S[d.col]) return; const st = S[d.col]; st.deaths[d.cause] = (st.deaths[d.cause] || 0) + 1; const b = Math.floor(w.t / 300); st.dBy = st.dBy || []; st.dBy[b] = st.dBy[b] || {}; st.dBy[b][d.cause] = (st.dBy[b][d.cause] || 0) + 1; });
AL.on('antBorn', (ww, d) => { if (ww === w && S[d.col]) { const st = S[d.col]; st.born++; const b = Math.floor(w.t / 300); st.bBy = st.bBy || []; st.bBy[b] = (st.bBy[b] || 0) + 1; } });
AL.on('raid', (ww, d) => { if (ww === w && S[d.col]) S[d.col].raids++; });
AL.on('breakIn', (ww, d) => { if (ww === w && S[d.col]) S[d.col].breakIns++; });
AL.on('satelliteFounded', (ww, d) => { if (ww === w && S[d.col]) S[d.col].sats++; });
AL.on('researchDone', (ww, d) => { if (ww === w && S[d.col]) S[d.col].research++; });
const t0 = Date.now();
let end = null;
for (let s = 1; s <= MIN * 60; s++) {
  for (let k = 0; k < 30; k++) { AL.Sim.step(w); if (w.over) w.over = null; }   // (no win screen: we watch who is left)
  for (const c of w.colonies) {
    const st = S[c.id], alive = c.alive !== false && !c.out && c.queen && c.queen.alive;
    if (!alive && st.died == null) { st.died = Math.round(w.t); }
    if (!alive) continue;
    const n = pop(c); if (n > st.peak) st.peak = n;
    if (c.starving) st.starveT++;
  }
  if (s % 300 === 0) for (const c of w.colonies) { const st = S[c.id]; st.pop.push(st.died == null ? pop(c) : 0); st.food.push(st.died == null ? Math.round((c.stock.sugar || 0) + (c.stock.protein || 0)) : 0); st.brood = st.brood || []; st.brood.push(c.brood ? c.brood.length : 0); st.brake = st.brake || []; st.brake.push(c.layBrake != null ? +c.layBrake.toFixed(2) : null); }
  const left = w.colonies.filter(c => S[c.id].died == null);
  if (left.length <= 1) { end = { winner: left.length ? left[0].id : -1, t: Math.round(w.t), reason: 'last colony standing' }; break; }
}
if (!end) {   // time's up: the biggest colony leads
  const alive = w.colonies.filter(c => S[c.id].died == null).sort((a, b) => pop(b) - pop(a));
  end = { winner: alive.length ? alive[0].id : -1, t: Math.round(w.t), reason: 'time (biggest colony)' };
}
const creatures = {};
for (const cr of (w.surface.creatures || [])) creatures[cr.type] = (creatures[cr.type] || 0) + 1;
console.log(JSON.stringify({ seed, species: SP, end, secs: Math.round((Date.now() - t0) / 1000), colonies: S, creaturesLeft: creatures }));
