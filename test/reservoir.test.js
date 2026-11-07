// Water reservoir (nest.js): rain runs down the tunnels by gravity; a reservoir catches what pools on it.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life']) require('../public/' + f + '.js');
const N = AL.Nest, CH = N.CH;
const mk = () => { const w = AL.Sim.createWorld({ seed: 5, species: 'fire', colonies: 1 }); return w; };
// a shaft down from the entrance with a room at its foot, plus a room high up beside it
function dig(w, lowRes) {
  const n = w.player.nest, e = n.entrance.c;
  N.carve(n, e, 0, e, 30);
  N.carveRoom(n, e + 6, 29, 4, 1.5, lowRes ? CH.WATER : CH.FOOD); N.carve(n, e, 29, e + 2, 29);
  N.carveRoom(n, e - 6, 6, 4, 1.5, lowRes ? CH.FOOD : CH.WATER); N.carve(n, e - 2, 6, e, 6);
  N.rebuild(n); n.version++;
  AL.Life.updateCaps(w.player);
  return n;
}
const rain = (w, secs) => { w.env.rain = 1; w.player.stock.water = 0; for (let k = 0; k < secs; k++) { w.env.rain = 1; N.second(w.player.nest, w); } };
test('a reservoir dug low catches the rain that runs down the tunnels', () => {
  const w = mk(), n = dig(w, true);
  rain(w, 20);
  assert.ok(w.player.stock.water > 30, 'the low reservoir filled: ' + w.player.stock.water.toFixed(1));
  assert.ok(w.player.stock.water <= w.player.cap.water + 1e-6, 'up to what it holds');
});
test('a reservoir dug high only fills once the tunnels below it are flooded', () => {
  const lo = mk(); dig(lo, true); rain(lo, 6);
  const hi = mk(); dig(hi, false); rain(hi, 6);
  assert.ok(hi.player.stock.water < lo.player.stock.water * 0.5, 'high: ' + hi.player.stock.water.toFixed(1) + ' vs low: ' + lo.player.stock.water.toFixed(1));
});
test('no rain, no new water in the reservoir', () => {
  const w = mk(); dig(w, true); w.player.stock.water = 0; w.env.rain = 0;
  for (let k = 0; k < 10; k++) N.second(w.player.nest, w);
  assert.ok(w.player.stock.water < 1);
});
