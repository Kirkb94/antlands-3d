// Foragers favour the food the colony is short of (behavior.js needs / skips), within reason.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'fog']) require('../public/' + f + '.js');
const B = AL.Behavior, K = AL.CARRY, C = AL.CASTE, ST = AL.ST;
const mk = () => AL.Sim.createWorld({ seed: 6, colonies: 2, noFog: true, flatGround: true, noStarter: true });
const share = (w, c, kind) => {
  const f = AL.Surface.addFood(w.surface, { kind, x: c.x + 400, y: c.y, r: 10, amount: 50 });
  let skip = 0, n = 0;
  for (let k = 0; k < 200; k++) { const i = w.ants.spawn(c.id, C.FORAGER, AL.LAYER.SURFACE, f.x, f.y, 0, w.R); n++; if (B.skips(w, c, i, f)) skip++; w.ants.kill(i); }
  f.gone = true;
  return skip / n;
};

test('short of protein with plenty of sugar: many foragers walk past sugar, none past protein', () => {
  const w = mk(), c = w.player;
  c.stock.sugar = 600; c.stock.protein = 0; c.stock.seeds = 0; w.t = 10;
  const n = B.needs(w, c);
  assert.ok(n.protein > 0.9 && n.sugar < 0.1, JSON.stringify(n));
  const s = share(w, c, K.SUGAR), p = share(w, c, K.PROTEIN);
  assert.ok(s > 0.45 && s <= B.NEED.SKIP_MAX + 0.08, 'sugar passed up by ' + (s * 100).toFixed(0) + '%');
  assert.equal(p, 0, 'protein is always picked up');
});

test('within reason: when both are needed, or neither, nobody skips anything', () => {
  const w = mk(), c = w.player;
  c.stock.sugar = 2; c.stock.protein = 1; w.t = 20;
  assert.equal(share(w, c, K.SUGAR), 0); assert.equal(share(w, c, K.PROTEIN), 0);
  c.stock.sugar = 600; c.stock.protein = 300; w.t = 30;
  assert.equal(share(w, c, K.SUGAR), 0); assert.equal(share(w, c, K.PROTEIN), 0);
});

test('short of sugar: foragers pass up protein instead; each ant decides the same way about the same find', () => {
  const w = mk(), c = w.player;
  c.stock.sugar = 0; c.stock.protein = 400; w.t = 40;
  assert.ok(share(w, c, K.PROTEIN) > 0.45);
  const f = AL.Surface.addFood(w.surface, { kind: K.PROTEIN, x: c.x + 300, y: c.y, r: 10, amount: 50 });
  const i = w.ants.spawn(c.id, C.FORAGER, AL.LAYER.SURFACE, f.x, f.y, 0, w.R);
  const a = B.skips(w, c, i, f);
  for (let k = 0; k < 5; k++) assert.equal(B.skips(w, c, i, f), a);
});

test('a colony out of protein brings home more protein than one that takes whatever it finds', () => {
  const run = favour => {
    const keep = B.NEED.SKIP_MAX; if (!favour) B.NEED.SKIP_MAX = 0;
    const w = mk(), c = w.player;
    for (const f of w.surface.foods) f.gone = true;
    w.surface.foodDirty = true;
    // sugar close by, protein a bit further out, round the nest
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * AL.TAU;
      AL.Surface.addFood(w.surface, { kind: K.SUGAR, x: c.x + Math.cos(a) * 260, y: c.y + Math.sin(a) * 260, r: 12, amount: 400 });
      AL.Surface.addFood(w.surface, { kind: K.PROTEIN, x: c.x + Math.cos(a + 0.4) * 420, y: c.y + Math.sin(a + 0.4) * 420, r: 12, amount: 400 });
    }
    let prot = 0; const off = AL.on('foodDelivered', (ww, d) => { if (ww === w && d.col === 0 && d.kind === K.PROTEIN) prot += d.amt || 1; });
    for (let k = 0; k < 30 * 150; k++) { c.stock.sugar = 200; c.stock.protein = 0; AL.Sim.step(w); }   // (enough sugar that wants() still takes it)
    off(); B.NEED.SKIP_MAX = keep;
    return prot;
  };
  const a = run(true), b = run(false);
  assert.ok(a > b * 1.15, 'protein home: ' + a + ' favouring vs ' + b + ' taking anything');
});
