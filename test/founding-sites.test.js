const test = require('node:test'), assert = require('node:assert');
// in the lead's tree this resolves to ../public/*.js; standalone it falls back to the _core mirror
const core = f => { try { return require('../public/' + f); } catch (_) { return require('../../_core/public/' + f); } };
const AL = core('al.js');
core('sim.js');
require('../public/founding-sites.js');
const Sites = AL.Sites, T = Sites.TILE;

test('8 sites with pros, cons and every numeric modifier', () => {
  assert.equal(AL.SITE_ORDER.length, 8);
  const keys = ['dig', 'caveIn', 'flood', 'food', 'warmth', 'defence', 'chamberMax', 'visibility', 'hazard', 'entrances'];
  for (const id of AL.SITE_ORDER) {
    const s = AL.SITES[id];
    assert.equal(s.id, id); assert.ok(s.name && s.blurb);
    assert.ok(s.pros.length >= 2 && s.cons.length >= 2, id + ' pros/cons');
    for (const p of s.pros.concat(s.cons)) assert.ok(p.tag && p.text, id + ' tag/text');
    for (const k of keys) assert.equal(typeof s.mods[k], 'number', id + '.' + k);
  }
});

test('modifiers say what the design says', () => {
  const M = id => AL.SITES[id].mods;
  assert.ok(M('rock').visibility < 0.5 && M('rock').dig < 1, 'rock: very safe, slow to dig');
  assert.ok(M('log').dig > 1 && M('log').food > 1 && M('log').flood > 0.5, 'log: fast dig, food, floods');
  const fastest = AL.SITE_ORDER.reduce((a, b) => (M(a).dig > M(b).dig ? a : b));
  assert.equal(fastest, 'sand'); assert.ok(M('sand').caveIn === Math.max(...AL.SITE_ORDER.map(i => M(i).caveIn)), 'sand caves in most');
  assert.ok(M('garden').food === Math.max(...AL.SITE_ORDER.map(i => M(i).food)) && M('garden').hazard > 2, 'garden: rich food, hazards');
  assert.ok(M('roots').defence === Math.max(...AL.SITE_ORDER.map(i => M(i).defence)) && M('roots').chamberMax === Math.min(...AL.SITE_ORDER.map(i => M(i).chamberMax)), 'roots: defend, cramped');
  assert.ok(M('crack').warmth === Math.max(...AL.SITE_ORDER.map(i => M(i).warmth)) && M('crack').food === Math.min(...AL.SITE_ORDER.map(i => M(i).food)), 'crack: warm, no food');
  assert.ok(M('stump').chamberMax === Math.max(...AL.SITE_ORDER.map(i => M(i).chamberMax)) && AL.SITES.stump.residents, 'stump: space + beetles');
  assert.ok(M('meadow').visibility === Math.max(...AL.SITE_ORDER.map(i => M(i).visibility)), 'meadow: exposed');
});

test('species fit: carpenters dig wood fast, army ants ignore soil', () => {
  assert.equal(Sites.modsFor('log', 'carpenter').dig, AL.SITES.log.mods.dig * 2);
  assert.equal(Sites.modsFor('stump', 'carpenter').dig, AL.SITES.stump.mods.dig * 2);
  assert.equal(Sites.modsFor('rock', 'army').caveIn, 0);
  assert.ok(Sites.modsFor('garden', 'leafcutter').food > AL.SITES.garden.mods.food);
  assert.notStrictEqual(Sites.modsFor('rock', 'fire'), AL.SITES.rock.mods, 'returns a copy');
});

test('placement on the lead map: 8 spread-out sites, in bounds, on open ground, anchored to scenery', () => {
  const w = AL.Sim.createWorld({ seed: 11 });
  const S = w.surface;
  const sites = w.founding ? w.founding.sites : Sites.place(S, { seed: 11 });
  assert.equal(sites.length, 8);
  assert.deepEqual(sites.map(s => s.id).sort(), AL.SITE_ORDER.slice().sort());
  let md = 1e9;
  for (const a of sites) for (const b of sites) if (a !== b) md = Math.min(md, Math.hypot(a.x - b.x, a.y - b.y));
  assert.ok(md > 450, 'spread out (min ' + md.toFixed(0) + ')');
  for (const s of sites) {
    assert.ok(s.x > 100 && s.y > 100 && s.x < S.W - 100 && s.y < S.H - 100, s.id + ' in bounds');
    const e = Sites.entranceOf(s);
    assert.ok(!AL.Surface.isBlocked(S, e.x, e.y), s.id + ' entrance walkable');
    assert.equal(s.type, s.id);
  }
  const by = id => sites.find(s => s.id === id);
  const rock = S.rocks.find(r => r.shelter);
  assert.ok(Math.hypot(by('rock').x - rock.x, by('rock').y - rock.y) < 200, 'rock site at the shelter rock');
  assert.ok(Math.hypot(by('log').x - S.logs[0].x, by('log').y - S.logs[0].y) < 260, 'log site by the log');
  assert.ok(by('crack').x > S.patio.x && by('crack').y > S.patio.y, 'crack on the patio');
  assert.ok(S.trees.some(t => Math.hypot(t.x - by('roots').x, t.y - by('roots').y) < 80), 'roots at a tree');
  // the stump is solid scenery
  const st = by('stump');
  assert.ok(AL.Surface.isBlocked(S, st.x, st.y), 'stump blocks');
});

test('placement works on a bare map and with a subset', () => {
  const sites = Sites.place({ W: 2000, H: 1500 }, { seed: 3, ids: ['rock', 'meadow', 'crack'] });
  assert.equal(sites.length, 3);
  for (const s of sites) assert.ok(s.x > 0 && s.x < 2000 && s.y > 0 && s.y < 1500);
  const d = Sites.placeDefault(5);
  assert.equal(d.length, 8);
  const again = Sites.placeDefault(5);
  assert.deepEqual(d.map(s => [s.x, s.y]), again.map(s => [s.x, s.y]), 'deterministic');
});

test('AI pick and click lookup', () => {
  const sites = Sites.placeDefault(7);
  const pick = Sites.pickForAI(sites, 'fire', 1);
  assert.ok(pick && AL.SITES[pick.id]);
  pick.taken = 1;
  assert.notEqual(Sites.pickForAI(sites, 'fire', 1).id, pick.id, 'skips taken');
  const e = Sites.entranceOf(sites[0]);
  assert.equal(Sites.siteAt(sites, e.x + 5, e.y - 5).id, sites[0].id);
  assert.equal(Sites.siteAt(sites, -500, -500), null);
});

test('soil variants: each site gets its signature layer, entrance column is diggable', () => {
  const has = (g, v) => g.tiles.includes(v);
  for (const id of AL.SITE_ORDER) {
    const g = Sites.buildSoil(id, 90, 60, 42);
    assert.equal(g.tiles.length, 90 * 60);
    for (let r = 0; r < 4; r++) { const v = Sites.tileAt(g, g.entrance.c, r); assert.ok(Sites.TILE_INFO[v].dig > 0 || v === T.AIR, id + ' entrance row ' + r + ' = ' + Sites.TILE_INFO[v].key); }
    assert.ok(g.waterRow > 20 && g.waterRow < 60, id + ' water table');
  }
  const top = (id, v) => { const g = Sites.buildSoil(id, 90, 60, 1); let n = 0; for (let r = 0; r < 12; r++) for (let c = 0; c < 90; c++) if (g.tiles[r * 90 + c] === v) n++; return n; };
  assert.ok(top('rock', T.ROCK) > 30, 'rock ceiling');
  assert.ok(top('log', T.WOOD) > 100, 'wood grain');
  assert.ok(top('sand', T.SAND) > 500, 'sand');
  assert.ok(top('garden', T.MULCH) > 150, 'mulch');
  assert.ok(top('roots', T.ROOT) > top('meadow', T.ROOT) * 2, 'roots');
  assert.equal(Sites.tileAt(Sites.buildSoil('crack', 90, 60, 1), 10, 0), T.SLAB, 'slab');
  assert.ok(has(Sites.buildSoil('stump', 90, 60, 1), T.GALLERY), 'beetle galleries');
  // deterministic
  assert.deepEqual(Sites.buildSoil('roots', 40, 30, 9).tiles, Sites.buildSoil('roots', 40, 30, 9).tiles);
});

test('stockFood adds food around rich sites only', () => {
  const w = AL.Sim.createWorld({ seed: 2 });
  const S = w.surface, sites = Sites.place(S, { seed: 2 });
  Sites.stockFood(S, sites, 2);
  const near = id => S.foods.filter(f => f.site === id).length;
  assert.ok(near('garden') > near('crack'), 'garden gets more than the patio');
  assert.equal(near('crack'), 0);
});
