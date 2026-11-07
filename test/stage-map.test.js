// The nuptial flight and the founding play on the match's own map: any biome, any size. The flight's yard
// (founding-sites.js stageMap) is the one createWorld builds under the flight's nests.
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'combat', 'orders', 'ai', 'ai-nest', 'species', 'expansion', 'research', 'victory', 'world-time',
  'world-poi', 'world-creatures', 'world-fog', 'eco', 'founding-sites', 'founding', 'founding-race', 'flight'])
  require('../public/' + f + '.js');
const Fl = AL.Flight;

// fly the whole flight headless and hand its patch to createWorld, as main.js startFlow does
function flyAndPlay(opts) {
  const S = AL.Sites.stageMap(opts);
  const sites = AL.Sites.place(S, { seed: opts.seed, ids: AL.Sites.stageIds(opts) });
  const fl = Fl.create({ seed: opts.seed, species: opts.species, rivals: opts.colonies - 1, sites, W: S.W, H: S.H });
  Fl.finish(fl);
  const patch = Fl.toPatch(fl);
  const w = AL.Sim.createWorld(Object.assign({}, opts, patch, { skipFlight: true, skipFounding: true, rivalNests: true, noFog: true }));
  return { S, sites, fl, patch, w };
}

for (const biome of ['backyard', 'forest', 'desert', 'wetland']) for (const mapSize of ['small', 'medium', 'large']) {
  test('flight on ' + biome + ', ' + mapSize + ': the match plays where the queens landed, on the map the flight showed', () => {
    const Z = AL.MAP_SIZES[mapSize], opts = { seed: 4242, biome, mapSize, colonies: 5, species: 'fire' };
    const { S, sites, fl, patch, w } = flyAndPlay(opts);
    assert.equal(S.W, Z.W); assert.equal(S.H, Z.H);
    assert.equal(fl.W, Z.W);
    for (const s of sites) assert.ok(s.x > 0 && s.y > 0 && s.x < Z.W && s.y < Z.H, 'site on the map: ' + s.id + ' ' + s.x + ',' + s.y);
    if (AL.BIOMES[biome].humans === false) assert.ok(!sites.some(s => s.id === 'crack' || s.id === 'garden'), 'no patio or garden sites in the wild');
    assert.equal(w.mapW, Z.W); assert.equal(w.mapH, Z.H); assert.equal(w.biomeKey, biome);
    assert.equal(w.colonies.length, 5);
    // the player's nest is where the queen landed
    assert.ok(Math.hypot(w.player.x - patch.playerSite.x, w.player.y - patch.playerSite.y) < 400, 'player nest near the landing');
    for (const c of w.colonies) assert.ok(c.x > 100 && c.y > 100 && c.x < Z.W - 100 && c.y < Z.H - 100, 'nest on the map');
    // same scenery as the flight (the custom maps are the fair map; the medium backyard the hand-made yard)
    const key = r => Math.round(r.x) + ',' + Math.round(r.y);
    assert.deepEqual(w.surface.rocks.map(key).sort(), S.rocks.map(key).sort(), 'the rocks the flight showed');
    assert.deepEqual(w.surface.logs.map(key).sort(), S.logs.map(key).sort(), 'the logs the flight showed');
    if (S.terrain && w.surface.terrain) {
      let same = 0, n = 0;
      for (let k = 0; k < S.terrain.length; k += 37) { n++; if (S.terrain[k] === w.surface.terrain[k]) same++; }
      assert.ok(same / n > 0.85, 'the ground the flight showed: ' + (same / n).toFixed(2));
    }
    for (let k = 0; k < 30 * 20; k++) AL.Sim.step(w);
    assert.ok(w.colonies.every(c => c.alive !== false), 'the match runs');
  });
}

test('the founding race places rivals on the chosen map, and the founding map knows its size', () => {
  const opts = { seed: 99, biome: 'desert', mapSize: 'large', colonies: 4, rivalSpecies: ['fire', 'carpenter', 'bullet'] };
  const rs = AL.FoundingRace.rivalSpecs(opts, 99, 'rock');
  const Z = AL.MAP_SIZES.large;
  assert.equal(rs.length, 3);
  for (const r of rs) assert.ok(r.x > 0 && r.y > 0 && r.x < Z.W && r.y < Z.H);
  const sites = AL.Sites.placeDefault(99, { map: opts });
  assert.ok(sites.length >= 6 && sites.every(s => s.x < Z.W && s.y < Z.H));
});

test('the medium backyard stays the hand-made yard', () => {
  assert.ok(!AL.Sites.stageCustom({ biome: 'backyard', mapSize: 'medium' }));
  assert.ok(!AL.Sites.stageCustom({}));
  const S = AL.Sites.stageMap({ seed: 5 }), w = { R: AL.rng(5) }, base = AL.Surface.generate(w, { nests: [] });
  assert.deepEqual(S.rocks.map(r => r.x), base.rocks.map(r => r.x));
});
