// Biomes, map sizes and terrain (terrain.js): the ground changes how ants walk, how trails last and what lives there.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'life', 'combat', 'orders', 'ai', 'bivouac', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco']) require('../public/' + f + '.js');
const T = AL.TERRAIN;
const mk = (biome, mapSize, o) => AL.Sim.createWorld(Object.assign({ seed: 5, species: 'fire', colonies: 4, biome, mapSize, noFog: true }, o || {}));
const share = w => { const c = w.surface.terrainCounts, n = c.reduce((a, b) => a + b, 0); return c.map(v => v / n); };
function reachable(w) {
  const S = w.surface, gw = S.gw, gh = S.gh, cellOf = (x, y) => Math.min(gh - 1, (y / S.cell) | 0) * gw + Math.min(gw - 1, (x / S.cell) | 0);
  const seen = new Uint8Array(gw * gh), q = [cellOf(w.player.x, w.player.y)]; seen[q[0]] = 1;
  while (q.length) { const i = q.pop(), gx = i % gw, gy = (i / gw) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = gx + dx, ny = gy + dy, j = ny * gw + nx; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || seen[j] || S.blocked[j]) continue; seen[j] = 1; q.push(j); } }
  let open = 0, got = 0; for (let i = 0; i < gw * gh; i++) if (!S.blocked[i]) { open++; if (seen[i]) got++; }
  const near = (x, y) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (seen[cellOf(x + dx * S.cell, y + dy * S.cell)]) return true; return false; };
  return { frac: got / open, colonies: w.colonies.every(c => near(c.x, c.y)), pois: S.pois.filter(p => !p.gone).every(p => near(p.x, p.y)) };
}

test('every biome and map size builds, with its own ground', () => {
  for (const b of AL.BIOME_ORDER) for (const sz of ['small', 'medium', 'large']) {
    const w = mk(b, sz), Z = AL.MAP_SIZES[sz];
    assert.equal(w.biomeKey, b); assert.equal(w.mapSize, sz);
    assert.equal(w.surface.W, Z.W); assert.equal(w.surface.H, Z.H);
    for (const c of w.colonies) assert.ok(c.x > 0 && c.y > 0 && c.x < Z.W && c.y < Z.H, b + ' ' + sz + ': nest on the map');
  }
  const f = share(mk('forest', 'medium')), d = share(mk('desert', 'medium')), wl = share(mk('wetland', 'medium')), y = share(mk('backyard', 'medium'));
  assert.ok(f[T.LITTER] > 0.4, 'the forest floor is mostly leaf litter');
  assert.ok(d[T.SAND] + d[T.GRAVEL] > 0.8, 'the desert is sand and gravel');
  assert.ok(wl[T.MUD] > 0.12 && wl[T.STREAM] > 0.03, 'the wetland has mud and water');
  assert.ok(y[T.GRASS] > 0.5 && y[T.STREAM] > 0, 'the backyard is mostly lawn, with a stream');
  assert.ok(Math.abs(AL.TERRAIN_INFO[T.STREAM].speed - 1 / 3) < 1e-9, 'ants swim streams at a third of walking speed');
});

test('streams never cut anything off: every nest, every find and almost all open ground can be walked to', () => {
  for (const b of ['forest', 'wetland']) for (const sz of ['small', 'large']) for (const seed of [1, 3, 8]) {
    const r = reachable(mk(b, sz, { seed, colonies: seed % 2 ? 2 : 6 }));
    assert.ok(r.colonies && r.pois, b + ' ' + sz + ' seed ' + seed + ': everything reachable');
    assert.ok(r.frac > 0.99, 'open ground reachable: ' + (r.frac * 100).toFixed(1) + '%');
  }
});

test('mud slows ants down and sand is quick; scent fades faster on sand', () => {
  const run = (w, i, n) => { let d = 0; for (let k = 0; k < n; k++) { AL.Sim.step(w); d += Math.hypot(w.ants.x[i] - w.ants.px[i], w.ants.y[i] - w.ants.py[i]); } return d; };
  const speedOn = t => {
    const w = mk('backyard', 'medium', { flatGround: true, start: { workers: 0 } }), S = w.surface, A = w.ants, c = w.player;
    S.terrain.fill(t); for (let i = 0; i < S.tspeed.length; i++) S.tspeed[i] = AL.TERRAIN_INFO[t].speed;
    const i = A.spawn(0, AL.CASTE.FORAGER, 0, c.x + 600, c.y, Math.PI, w.R); A.state[i] = AL.ST.HOMING;
    return run(w, i, 30);
  };
  const g = speedOn(T.GRASS), m = speedOn(T.MUD), s = speedOn(T.SAND);
  assert.ok(Math.abs(m / g - AL.TERRAIN_INFO[T.MUD].speed) < 0.02, 'mud: ' + (m / g).toFixed(3));
  assert.ok(s > g, 'sand is quicker');
  const w = mk('desert', 'medium'), S = w.surface, gw = S.gw, P = w.pher.food[0];
  const sand = S.tfade.find(i => S.terrain[i] === T.SAND), grass = (() => { for (let i = 0; i < S.terrain.length; i++) if (S.terrain[i] === T.GRASS && !S.blocked[i]) return i; return -1; })();
  assert.ok(sand >= 0 && grass >= 0);
  P.data[sand] = P.data[grass] = 10;
  for (let k = 0; k < 30 * 6; k++) AL.Sim.step(w);
  assert.ok(P.data[sand] < P.data[grass] * 0.9, 'sand ' + P.data[sand].toFixed(2) + ' vs grass ' + P.data[grass].toFixed(2) + ' (cell ' + (sand % gw) + ')');
});

const mowed = w => { let n = 0; const off = AL.on('mower', ww => { if (ww === w) n++; }); const M = w.poi.human.mower; M.state = 'warn'; M.t = 0.05; for (let k = 0; k < 30 * 2; k++) AL.Sim.step(w); off(); return n; };
test('the wild biomes have no people: no mower, no patio, a wild prize in the middle', () => {
  for (const [b, label] of [['forest', "Fallen bird's nest"], ['desert', 'Cactus fruit'], ['wetland', 'Dead frog']]) {
    const w = mk(b, 'medium');
    assert.equal(w.surface.patio, null, b + ': no patio');
    const spill = w.surface.pois.find(p => p.type === 'spill');
    assert.ok(spill && spill.label === label, b + ': ' + (spill && spill.label));
    assert.equal(mowed(w), 0, b + ': no mower comes');
  }
  const y = mk('backyard', 'medium');
  assert.ok(y.surface.patio, 'the backyard keeps its patio');
  assert.ok(mowed(y) > 0, 'the backyard mower still runs');
});

test('the ground is the same for every colony (the map is drawn round the middle) and the same each time', () => {
  for (const b of ['forest', 'wetland', 'desert']) {
    const w = mk(b, 'medium', { colonies: 4 }), S = w.surface;
    const ring = c => { const n = new Array(AL.TERRAIN_INFO.length).fill(0); for (let r = 150; r <= 600; r += 50) for (let a = 0; a < 48; a++) { const ang = Math.atan2(c.y - S.H / 2, c.x - S.W / 2) + a / 48 * Math.PI * 2; n[AL.Terrain.at(S, c.x + Math.cos(ang) * r, c.y + Math.sin(ang) * r)]++; } return n; };
    const rings = w.colonies.map(ring), tot = rings[0].reduce((a, v) => a + v, 0);
    for (const r of rings.slice(1)) { let diff = 0; for (let t = 0; t < r.length; t++) diff += Math.abs(r[t] - rings[0][t]); assert.ok(diff / tot < 0.12, b + ': ground round each nest alike (' + (diff / tot * 100).toFixed(1) + '% differs)'); }
    assert.deepEqual(Array.from(mk(b, 'medium', { colonies: 4 }).surface.terrain), Array.from(S.terrain), 'same seed, same ground');
  }
});

test('flatGround gives plain grass everywhere (for tests of movement and fights)', () => {
  const w = mk('wetland', 'medium', { flatGround: true });
  assert.equal(share(w)[T.GRASS], 1);
});

test('the wild prizes keep sane numbers (regression: the cactus water and the frog\'s aphids sized themselves by the prize and went NaN, crashing the draw)', () => {
  for (const b of ['desert', 'wetland']) {
    const w = mk(b, 'medium', { seed: 1 });
    for (let k = 0; k < 30 * 300; k++) AL.Sim.step(w);
    for (const f of w.surface.foods) {
      assert.ok(isFinite(f.amount) && isFinite(f.r), b + ': ' + f.visual + ' amount ' + f.amount + ' r ' + f.r);
      if (f.poi) assert.ok(isFinite(f.poi.r), b + ': ' + f.visual + ' poi r ' + f.poi.r);
    }
  }
});
