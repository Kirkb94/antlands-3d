// Nest layout bonuses, buried finds and door plugs (nestplan.js).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'brush', 'cmd', 'raids', 'nestplan']) require('../public/' + f + '.js');
const C = AL.CASTE, ST = AL.ST, L = AL.LAYER, N = AL.Nest, CH = N.CH, TILE = N.TILE, NP = AL.NestPlan;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const mk = o => AL.Sim.createWorld(Object.assign({ seed: 9, species: 'fire', colonies: 2, keypointsAt: 1e9, noFog: true }, o || {}));
const room = (c, x, y, ch) => { AL.Nest.carveRoom(c.nest, x, y, 3, 1.5, ch); c.nest.layoutVersion++; N.rebuild(c.nest); AL.Life.updateCaps(c); };

test('layout: a nursery by the queen grows brood faster; a store by the reservoir spoils less; a midden by the nursery breeds disease', () => {
  const w = mk(), c = w.player, nest = c.nest;
  run(w, 2);
  const L0 = NP.layout(nest);
  // a fresh nest's nursery sits by the queen; dig a far reservoir and a store next to it
  const qx = nest.entrance.c;
  room(c, qx + 16, 30, CH.WATER);
  for (let dc = 0; dc < 3; dc++) for (let r = 28; r <= 32; r++) { const i = N.idx(c.nest, qx + 16 + dc, r); if (c.nest.kind[i] === TILE.OPEN) c.nest.chamber[i] = CH.FOOD; }   // half of it a food store
  nest.layoutVersion++; N.rebuild(nest); AL.Life.updateCaps(c);
  run(w, 1);
  const L1 = NP.layout(nest);
  assert.ok(L1.food, 'store by the reservoir: ' + L1.d.fw);
  assert.ok(Math.abs(c.layout.spoil - NP.NP.SPOIL * AL.NestClimate.layoutMul(nest).spoil) < 1e-9);   // (times the store's room level: nestclimate.js)
  // spoilage halves
  c.stock.protein = 200; const p0 = c.stock.protein; run(w, 1); const lost = p0 - c.stock.protein;
  // brood speed carries the nursery bonus when it's next to the queen
  if (L1.nursery) assert.ok(Math.abs(c.layout.brood - NP.NP.BROOD) < 1e-9);
  // a midden right by the nursery: double, and it smells
  const nt = nest.tiles[CH.NURSERY][0], ncx = nt % nest.cols, nr = (nt / nest.cols) | 0;
  room(c, ncx + 3, nr, CH.MIDDEN);
  run(w, 1);
  const L2 = NP.layout(nest);
  assert.equal(L2.midden, -1, 'midden by the nursery: ' + L2.d.mn);
  nest.middenFill = 10; c.disease = 0;
  run(w, 20);
  assert.ok(c.disease > 0, 'it smells: disease ' + c.disease.toFixed(2));
  assert.ok(lost >= 0);
});

test('buried finds: fixed per nest, deeper finds are better, digging one out pays it; an air pocket opens tiles', () => {
  const w = mk(), c = w.player, nest = c.nest, A = w.ants;
  let n = 0, kinds = {}, diggable = 0;
  for (let i = nest.cols; i < nest.n; i++) { const k = nest.kind[i]; if (k !== TILE.OPEN && k !== TILE.ROCK && k !== TILE.ROOT) diggable++; const f = NP.findAt(nest, i); if (f) { n++; kinds[f] = (kinds[f] || 0) + 1; } }
  assert.ok(n > diggable / 70 && n < diggable / 20, n + ' finds in ' + diggable + ' tiles');
  assert.ok(kinds.grubs && kinds.spring, JSON.stringify(kinds));
  // the same nest from the same seed hides the same things
  const w2 = mk(); let same = true; for (let i = 0; i < nest.n; i++) if (NP.findAt(nest, i) !== NP.findAt(w2.player.nest, i)) { same = false; break; }
  assert.ok(same, 'fixed by the seed');
  // dig out a protein find and a pocket
  let got = null; const off = AL.on('nestFind', (ww, d) => { if (ww === w) got = d; });
  let ti = -1; for (let i = nest.cols; i < nest.n; i++) if (NP.findAt(nest, i) === 'cicada' || NP.findAt(nest, i) === 'grubs') { ti = i; break; }
  const p0 = c.stock.protein; N.mark(nest, ti % nest.cols, (ti / nest.cols) | 0); N.excavate(nest, ti, w);
  assert.ok(got && c.stock.protein > p0, 'protein found: ' + (got && got.name));
  got = null; let pi = -1; for (let i = nest.cols; i < nest.n; i++) if (NP.findAt(nest, i) === 'pocket') { pi = i; break; }
  let open0 = 0; for (let i = 0; i < nest.n; i++) if (nest.kind[i] === TILE.OPEN) open0++;
  N.mark(nest, pi % nest.cols, (pi / nest.cols) | 0); N.excavate(nest, pi, w);
  let open1 = 0; for (let i = 0; i < nest.n; i++) if (nest.kind[i] === TILE.OPEN) open1++;
  off();
  assert.ok(got && got.what === 'pocket' && open1 >= open0 + 3, 'a pocket opened ' + (open1 - open0) + ' tiles');
  N.excavate(nest, pi, w); assert.ok(true, 'digging it twice pays nothing more');
});

test('door plugs: raiders chew through before they get in; carpenters plug tougher; workers rebuild it with soil', () => {
  const w = mk({ rivalSpecies: ['carpenter'], colonies: 2, rivalNests: true }), c = w.player, t = w.colonies[1], A = w.ants;
  for (const o of w.colonies) if (o.ai) o.ai.raidT = 1e9;
  run(w, 2);
  const pc = NP.plugOf(c), pt = NP.plugOf(t);
  assert.ok(pc.on && pc.hp > 150, 'your door is plugged: ' + pc.hp);
  assert.ok(pt.max > pc.max * 2, 'carpenter head plug is tougher: ' + pt.max + ' vs ' + pc.max);
  // a raider at the player's door: breakIn is blocked while the plug holds
  const i = A.spawn(1, C.SOLDIER, L.SURFACE, c.x, c.y, 0, w.R);
  const hp0 = pc.hp;
  AL.Orders.breakIn(w, i, c);
  assert.equal(A.layer[i], L.SURFACE, 'still outside');
  assert.ok(pc.hp < hp0, 'it chewed the plug');
  pc.hp = 0.0001; AL.Orders.breakIn(w, i, c);
  assert.equal(A.layer[i], L.NEST, 'through once it gives');
  // rebuilt with soil once quiet
  c.stock.soil = 100; run(w, NP.NP.PLUG_QUIET + 3);
  assert.ok(pc.hp > 5 && c.stock.soil < 100, 'rebuilt: ' + pc.hp.toFixed(1) + ' hp, soil ' + c.stock.soil.toFixed(1));
  // opened: raiders walk in
  assert.ok(AL.Cmd.exec(w, 0, 'plug', { on: false }));
  const j = A.spawn(1, C.SOLDIER, L.SURFACE, c.x, c.y, 0, w.R); AL.Orders.breakIn(w, j, c);
  assert.equal(A.layer[j], L.NEST);
});
