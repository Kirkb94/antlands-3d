// LOD=1 turns the crowd LOD on with each PC's camera on its own nest.
// Runs one PC's side of a scripted lockstep match and prints its world hashes (tests/multiplayer.test.js runs two
// of these as separate processes, like two PCs). usage: node tools/mp-run.js <me>
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'bivouac.js', 'fog.js', 'species.js', 'expansion.js', 'research.js', 'victory.js', 'world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js', 'brush.js', 'cmd.js']) require('../public/' + f);
if (process.env.RN) require('../public/ai-nest.js');   // RN=1: the AI rivals have real nests (opts.rivalNests)
const mp = me => ({ seed: 21, colonies: process.env.RN ? 5 : 4, rivalNests: !!process.env.RN, mp: { humans: 3, me, species: ['fire', 'honeypot', 'slavemaker'], names: ['A', 'B', 'C'], perks: ['random', null, null] } });
function h(w) {
  const A = w.ants; let x = 2166136261;
  const mix = v => { x = Math.imul(x ^ v, 16777619) >>> 0; };
  const f = new Uint32Array(A.x.buffer, 0, A.high), g = new Uint32Array(A.y.buffer, 0, A.high);
  for (let i = 0; i < A.high; i++) { mix(f[i]); mix(g[i]); mix(A.state[i]); }
  mix(w.R.state()); for (const c of w.colonies) mix(Math.round(c.stock.sugar * 1000));
  return x;
}
const turn = (w, k) => {
  const cmds = [];
  if (k === 3) for (let c = 0; c < 3; c++) { const o = w.colonies[c]; cmds.push({ col: c, n: 'paint', a: { t: 'food', p: 'start', x: o.x + 20, y: o.y } }); for (let j = 1; j < 8; j++) cmds.push({ col: c, n: 'paint', a: { t: 'food', p: 'move', x: o.x + 20 + j * 30, y: o.y + j * 9 } }); cmds.push({ col: c, n: 'paint', a: { t: 'food', p: 'end', x: o.x + 260, y: o.y + 70 } }); cmds.push({ col: c, n: 'egg', a: { caste: AL.CASTE.SOLDIER } }); }
  if (k === 20 || k === 400) { const o = w.colonies[1], fs = w.surface.foods.filter(f => !f.gone && AL.dist2(f.x, f.y, o.x, o.y) < 600 * 600).slice(0, 6); if (fs.length) cmds.push({ col: 1, n: 'collect', a: { x: fs[0].x, y: fs[0].y, r: 300, ids: fs.map(f => f.id), n: 8 } }); }
  AL.Cmd.runTurn(w, cmds);
  for (let s = 0; s < 3; s++) {
    // LOD=1: the crowd LOD is on and each PC's camera (render.js world.view) looks at its own nest, as in a real match
    if (process.env.LOD) { w.autoLod = false; w.lod = true; const o = w.player; w.view = { x0: o.x - 500, y0: o.y - 350, x1: o.x + 500, y1: o.y + 350 }; }
    AL.Sim.step(w);
  }
};
const w = AL.Sim.createWorld(mp(+process.argv[2] || 0)), out = [];
for (let k = 0; k < 900; k++) { turn(w, k); if (k % 100 === 99) out.push(h(w)); }
console.log(out.join(' '), w.pher.food[0].data.some(v => v > 0) ? 'trail' : 'notrail', w.player.id);
