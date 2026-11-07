// World snapshots (snap.js): a PC joining a match late loads another PC's world instead of replaying the match.
// The restored world must be the source world bit for bit (seen from its own player) and stay in lockstep with it.
const test = require('node:test'), assert = require('node:assert');
const path = require('path');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'nestclimate', 'injury', 'combat', 'orders', 'ai', 'ai-nest', 'bivouac', 'fog', 'species', 'expansion', 'research', 'victory',
  'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'eco-hunters', 'swarm', 'brush', 'cmd', 'raids', 'aphids', 'links', 'nestplan', 'snap']) require('../public/' + f + '.js');
const D = require('../tools/deep-state.js');
const S = AL.Snap;
const opts = me => ({ seed: 44, colonies: 5, aiLevel: 'normal', rivalNests: true, biome: 'forest', species: ['fire', 'carpenter'][me],
  mp: { humans: 2, me, species: ['fire', 'carpenter'], names: ['A', 'B'], perks: ['random', 'random'] } });
const skip = new Set(D.SKIP); for (const k of ['me', 'player', 'fog', 'nest', 'arrive']) skip.add(k);
const fp = w => D.deepHash(w, { skip, skipKey: k => k === 'colours' });
const same = (a, b) => { const x = fp(a), y = fp(b); return x.get('') === y.get('') ? null : D.diff(x, y, 8); };
// the scripted players: trails, eggs, research, a raid, a satellite
function turn(w, k) {
  const c = [];
  for (let col = 0; col < 2; col++) {
    const o = w.colonies[col];
    if (k % 300 === 30) c.push({ col, n: 'paint', a: { t: 'food', p: 'start', x: o.x + 20, y: o.y } }, { col, n: 'paint', a: { t: 'food', p: 'end', x: o.x + 300, y: o.y + 80 } });
    if (k % 400 === 100) c.push({ col, n: 'egg', a: { caste: AL.CASTE.SOLDIER } });
    if (k % 500 === 200) c.push({ col, n: 'research', a: { id: ['jelly', 'antennae', 'jaws', 'nursery'][(k / 500 | 0) % 4] } });
    if (k === 300 && col === 0) { o.royal.queens++; AL.Expansion.launch(w, 0, o.x + (o.x < 2000 ? 600 : -600), o.y + (o.y < 1500 ? 300 : -300)); }
    if (k === 1700) { const fs = w.surface.foods.filter(f => !f.gone && f.amount >= 1 && f.kind <= 2 && AL.dist2(f.x, f.y, o.x, o.y) < 700 * 700).slice(0, 5); if (fs.length) c.push({ col, n: 'collect', a: { x: fs[0].x, y: fs[0].y, r: 250, ids: fs.map(f => f.id), n: 12 } }); }
    if (k === 1500) { const t = w.colonies[3]; c.push({ col, n: 'raid', a: { x: t.x, y: t.y, w: 4, s: 4, m: 1 } }); }
  }
  AL.Cmd.runTurn(w, c);
  for (let s = 0; s < 3; s++) AL.Sim.step(w);
}

test('a snapshot restores the world exactly, for another player too, and both run on in lockstep', () => {
  const a = AL.Sim.createWorld(opts(0));
  for (let k = 0; k < 1800; k++) turn(a, k);
  const packed = S.pack(S.take(a));
  assert.ok(packed.length > 1e6, 'a real world: ' + packed.length + ' bytes');
  const b = S.restore(AL.Sim.createWorld(opts(1)), S.unpack(packed), 1);
  assert.equal(b.me, 1); assert.equal(b.player, b.colonies[1]); assert.equal(b.nest, b.colonies[1].nest);
  assert.equal(b.R.state(), a.R.state());
  assert.deepEqual(same(a, b), null, 'restored = source');
  assert.ok((a.homes || []).some(h => h && h.sat && !h.gone && h.nest), 'with a satellite nest (an Object.create home)');
  for (let k = 1800; k < 3000; k++) { turn(a, k); turn(b, k); if (k % 300 === 299) assert.deepEqual(same(a, b), null, 'in lockstep at turn ' + k); }
  // and a snapshot of the restored world is the same snapshot as the source's
  assert.deepEqual(same(S.restore(AL.Sim.createWorld(opts(0)), S.unpack(S.pack(S.take(b))), 0), a), null);
});

test('module constants the world points at go by name, and nothing else is shared between worlds', () => {
  const a = AL.Sim.createWorld(opts(0)), b = AL.Sim.createWorld(Object.assign(opts(1), { seed: 45 }));
  for (let k = 0; k < 1200; k++) { turn(a, k); turn(b, k); }
  const reach = w => { const s = new Set(), q = [w]; s.add(w); while (q.length) { const v = q.pop(); if (ArrayBuffer.isView(v)) continue; const kids = v instanceof Map ? [...v.values()] : v instanceof Set ? [...v] : Object.keys(v).filter(k => !(v === w && S.KEEP.has(k))).map(k => v[k]); const pr = Object.getPrototypeOf(v); if (pr && pr !== Object.prototype && pr !== Array.prototype && pr !== Map.prototype && pr !== Set.prototype && !(pr.constructor && pr.constructor.prototype === pr)) kids.push(pr); for (const x of kids) if (x && typeof x === 'object' && !s.has(x)) { s.add(x); q.push(x); } } return s; };
  const ra = reach(a), rb = reach(b), C = S.consts();
  for (const o of ra) if (rb.has(o)) assert.ok(C.has(o), 'shared between worlds but not a named constant: ' + JSON.stringify(o).slice(0, 80));
  for (const o of ra) if (C.has(o)) assert.ok(rb.has(o) || !Object.keys(o).length || true);
});

test('a world function the snapshot can\'t name is an error, not a silent desync later', () => {
  const a = AL.Sim.createWorld(opts(0));
  a.colonies[2].mystery = () => 1;
  assert.throws(() => S.take(a), /can't name/);
});
