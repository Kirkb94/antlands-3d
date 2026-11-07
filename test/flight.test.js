// Nuptial flight logic tests. Works from the stage folder (flight/test) and once copied
// into the game (antlands/test, with flight.js in antlands/public).
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const LEAD = path.join(__dirname, '..', '..', '_core', 'public');   // the lead's core mirror (read-only)
const inGame = fs.existsSync(path.join(__dirname, '..', 'public', 'flight.js'));
const PUB = inGame ? path.join(__dirname, '..', 'public') : LEAD;
const AL = require(path.join(PUB, 'al.js'));
require(path.join(PUB, 'data.js'));
globalThis.AL = AL;
const Flight = require(inGame ? path.join(PUB, 'flight.js') : path.join(__dirname, '..', 'flight.js'));
const F = Flight.TUNE;

function run(fl, secs, each) { for (let t = 0; t < secs && fl.phase !== 'done'; t += F.STEP) { if (each) each(fl); Flight.step(fl, F.STEP); } }
// steer the player straight at a site and hold land once over it
function pilot(site, flap) { return fl => { const q = Flight.player(fl); const over = Math.hypot(q.x - site.x, q.y - site.y) < site.r * 0.5; Flight.setInput(fl, { tx: site.x, ty: site.y, flap: !!flap && !over, land: over }); }; }

test('queens start spread round the yard edges, up to 8', () => {
  const fl = Flight.create({ seed: 7, species: 'leafcutter', rivals: 7 });
  assert.equal(fl.queens.length, 8);
  assert.equal(fl.queens.filter(q => q.isPlayer).length, 1);
  for (const q of fl.queens) {
    const edge = Math.min(q.x, q.y, fl.W - q.x, fl.H - q.y);
    assert.ok(edge < 100, 'starts at an edge');
  }
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) assert.ok(Math.hypot(fl.queens[a].x - fl.queens[b].x, fl.queens[a].y - fl.queens[b].y) > 600, 'queens are far apart');
  const big = Flight.create({ seed: 1, rivals: 12 });
  assert.equal(big.queens.length, 8, 'capped at 8 queens');
});

test('sites get full pros/cons and a fit per species; founding data is accepted', () => {
  const fl = Flight.create({ seed: 3 });
  assert.equal(fl.sites.length, 10);
  assert.equal(new Set(fl.sites.map(s => s.type)).size, 8, 'all 8 site types');
  for (const s of fl.sites) { assert.ok(s.pros.length && s.cons.length); for (const sp of ['fire', 'leafcutter', 'carpenter', 'army']) assert.ok(s.fit[sp] >= 0); }
  const custom = Flight.create({ seed: 3, sites: [{ id: 'a', type: 'Rotting log', x: 500, y: 500 }, { id: 'b', name: 'Pavement crack', x: 3000, y: 2000, pros: [{ tag: 'X', text: 'custom' }] }] });
  assert.equal(custom.sites[0].type, 'log');
  assert.equal(custom.sites[1].type, 'crack');
  assert.equal(custom.sites[1].pros[0].text, 'custom', 'founding text wins');
});

test('AI queens choose by species fit and distance', () => {
  const sites = [{ id: 'near-meadow', type: 'meadow', x: 1200, y: 1500 }, { id: 'far-log', type: 'log', x: 1700, y: 1500 }, { id: 'far-away-log', type: 'log', x: 3900, y: 2900 }];
  const fl = Flight.create({ seed: 5, sites, colonies: [{ colonyId: 0, species: 'fire', isPlayer: true }, { colonyId: 1, species: 'carpenter' }, { colonyId: 2, species: 'army' }] });
  const carp = fl.queens[1], army = fl.queens[2];
  carp.x = army.x = 1000; carp.y = army.y = 1500; carp.ai.siteId = army.ai.siteId = null;
  assert.equal(Flight.aiChoose(fl, carp).id, 'far-log', 'carpenter prefers the log a bit further away');
  assert.equal(Flight.aiChoose(fl, army).id, 'near-meadow', 'army ants want the meadow');
  assert.ok(Flight.siteScore(fl, carp, fl.sites[1]) > Flight.siteScore(fl, carp, fl.sites[2]), 'distance counts');
});

test('a whole race finishes: every AI queen lands, results carry colonyId/species/siteId/landedAt', () => {
  const fl = Flight.create({ seed: 11, species: 'fire', rivals: 5 });
  Flight.start(fl);
  const target = fl.sites[0];
  run(fl, 120, pilot(target, true));
  assert.equal(fl.phase, 'done');
  const p = Flight.toPatch(fl);
  assert.equal(p.flight.queens.length, 6);
  for (const q of p.flight.queens) {
    assert.ok(q.siteId != null, 'landed somewhere');
    assert.ok(q.landedAt > 0 && q.landedAt <= fl.duration + 30);
    assert.ok(typeof q.species === 'string');
  }
  assert.equal(p.flight.queens.find(q => q.isPlayer).siteId, target.id);
  assert.equal(p.landings.length, 6);
  assert.equal(p.rivalSites.length, 5, 'one rival site per AI colony (createWorld)');
  assert.deepEqual(p.playerSite, p.landings.find(l => l.colonyId === 0).nest);
  assert.deepEqual(p.rivalSites[0], p.landings.find(l => l.colonyId === 1).nest, 'rivalSites in colonyId order');
  assert.equal(p.rivalSpecies.length, 5);
  assert.equal(typeof p.queenTraits.reserveBonus, 'number');
  const orders = p.flight.queens.map(q => q.order).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6]);
});

test('first queen down gets the reserves bonus', () => {
  const fl = Flight.create({ seed: 2, species: 'fire', rivals: 1 });
  Flight.start(fl);
  const q = Flight.player(fl), s = Flight.nearestSite(fl, q.x, q.y);
  q.x = s.x; q.y = s.y;               // already over a site
  run(fl, 2, f => Flight.setInput(f, { tx: s.x, ty: s.y, land: true }));
  assert.equal(fl.firstLanded, q.colonyId);
  run(fl, 120, f => Flight.setInput(f, { tx: s.x, ty: s.y, land: true }));
  const res = Flight.result(fl);
  const me = res.queens.find(z => z.isPlayer), rival = res.queens.find(z => !z.isPlayer);
  assert.equal(me.order, 1);
  assert.equal(me.bonus.reserves, F.FIRST_BONUS);
  assert.ok(me.bonus.tags.includes('First to land'));
  assert.equal(rival.bonus.reserves, 0);
});

test('landing needs a hold over a site, not a tap or open lawn', () => {
  const fl = Flight.create({ seed: 4, rivals: 0 });
  Flight.start(fl);
  const q = Flight.player(fl), s = fl.sites[3];
  q.x = 2000; q.y = 50; // open ground, no site
  Flight.setInput(fl, { tx: q.x, ty: q.y, land: true });
  run(fl, 1);
  assert.equal(q.site, null, 'cannot land off-site');
  q.x = s.x; q.y = s.y;
  Flight.setInput(fl, { tx: s.x, ty: s.y, land: true });
  Flight.step(fl, F.LAND_HOLD * 0.5);
  Flight.setInput(fl, { land: false });
  Flight.step(fl, 0.1);
  assert.equal(q.site, null, 'a short tap does not land');
  assert.equal(q.hold, 0, 'releasing resets the hold');
  Flight.setInput(fl, { land: true });
  Flight.step(fl, F.LAND_HOLD + 0.05);
  assert.equal(q.site, s.id);
  assert.equal(q.state, 'landing');
  Flight.step(fl, F.LAND_ANIM + 0.1);
  assert.equal(q.state, 'landed');
  assert.ok(fl.events.some(e => e.type === 'touchdown'), 'touchdown event for the dust puff');
});

test('two queens on the same site both get it and it is marked shared', () => {
  const sites = [{ id: 'only', type: 'rock', x: 2000, y: 1500 }, { id: 'far', type: 'meadow', x: 100, y: 100 }];
  const fl = Flight.create({ seed: 9, sites, colonies: [{ colonyId: 0, species: 'fire', isPlayer: true }, { colonyId: 1, species: 'fire' }] });
  Flight.start(fl);
  for (const q of fl.queens) { q.x = 2000; q.y = 1500; }
  fl.queens[1].ai.siteId = 'only';
  run(fl, 30, f => Flight.setInput(f, { tx: 2000, ty: 1500, land: true }));
  const res = Flight.result(fl);
  assert.equal(res.queens[0].siteId, 'only');
  assert.equal(res.queens[1].siteId, 'only');
  assert.ok(res.queens[0].shared && res.queens[1].shared);
  assert.deepEqual(res.queens[0].neighbours, [1]);
  const site = res.sites.find(s => s.id === 'only');
  assert.ok(site.shared); assert.equal(site.occupants.length, 2);
  const P = Flight.toPatch(fl), a = P.playerSite, b = P.rivalSites[0];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= F.NEST_SPLIT - 1, 'shared nests are split apart');
  assert.deepEqual(P.landings[0].nest, a);
  const q0 = fl.queens[0], q1 = fl.queens[1];
  assert.ok(Math.hypot(q0.lx - q1.lx, q0.ly - q1.ly) > 40, 'landed queens do not overlap');
});

test('time out gently auto-lands everyone left on the nearest site', () => {
  const fl = Flight.create({ seed: 13, rivals: 2, duration: 5 });
  Flight.start(fl);
  // the player just hovers in the middle of the yard and never lands
  run(fl, 60, f => Flight.setInput(f, { tx: 2000, ty: 120, land: false }));
  assert.equal(fl.phase, 'done');
  assert.ok(fl.timeUp);
  const me = Flight.result(fl).queens.find(q => q.isPlayer);
  assert.ok(me.auto, 'auto-landed');
  assert.ok(me.siteId);
  assert.equal(me.bonus.reserves, F.TIRED);
});

test('flapping drains stamina, gliding and breezes restore it; winded queens cannot flap', () => {
  const fl = Flight.create({ seed: 21, rivals: 0, sites: [{ id: 'x', type: 'rock', x: 3900, y: 2900 }] });
  fl.lanes = []; // still air
  Flight.start(fl);
  const q = Flight.player(fl); q.x = 200; q.y = 1500;
  Flight.setInput(fl, { kx: 1, ky: 0, flap: true });
  Flight.step(fl, 1);
  assert.ok(q.flapping);
  assert.ok(Math.abs(q.stamina - (1 - F.DRAIN)) < 0.03);
  const x1 = q.x;
  Flight.step(fl, 3);
  assert.ok(q.winded, 'out of breath');
  assert.ok(!q.flapping);
  const vFlap = (q.x - x1) / 3;
  assert.ok(vFlap > F.GLIDE * 0.9, 'flapping was faster than a glide');
  Flight.setInput(fl, { flap: false });
  const s0 = q.stamina; Flight.step(fl, 2);
  assert.ok(q.stamina > s0, 'gliding rests the wings');
  // breeze: flying along it rests faster and pushes along
  const fl2 = Flight.create({ seed: 21, rivals: 0 });
  Flight.start(fl2);
  const L = fl2.lanes[0], seg = L.segs[1];
  const mx = (seg.ax + seg.bx) / 2, my = (seg.ay + seg.by) / 2;
  const w = Flight.windAt(fl2, mx, my);
  assert.ok(Math.hypot(w.x, w.y) > F.WIND * 0.8, 'strong push in the lane centre');
  assert.ok(w.x * seg.tx + w.y * seg.ty > 0, 'push follows the lane direction');
  const q2 = Flight.player(fl2); q2.x = mx; q2.y = my; q2.stamina = 0.2;
  Flight.setInput(fl2, { kx: seg.tx, ky: seg.ty, flap: false });
  Flight.step(fl2, 0.5);
  const gain = q2.stamina - 0.2;
  assert.ok(gain > F.RECOVER * 0.5 * 1.8, 'breeze rests the wings faster');
});

test('same seed and inputs give the same race', () => {
  const go = () => { const fl = Flight.create({ seed: 99, species: 'army', rivals: 3 }); Flight.start(fl); run(fl, 120, pilot(fl.sites[5], true)); return JSON.stringify(Flight.result(fl)); };
  assert.equal(go(), go());
});

test('finish() resolves the rest of the race instantly', () => {
  const fl = Flight.create({ seed: 31, rivals: 3 });
  const res = Flight.finish(fl);
  assert.equal(fl.phase, 'done');
  assert.ok(res.queens.every(q => q.siteId));
});

// Founding stage compatibility: its placed sites go straight in, and its scene can read our patch
const FOUNDING = path.join(__dirname, '..', '..', 'founding', 'public', 'founding-sites.js');
const FOUNDING_IN_GAME = path.join(PUB, 'founding-sites.js');
const foundingFile = fs.existsSync(FOUNDING_IN_GAME) ? FOUNDING_IN_GAME : fs.existsSync(FOUNDING) ? FOUNDING : null;
test('uses the Founding stage sites (AL.Sites.place) and hands back what Founding reads', { skip: !foundingFile && 'founding-sites.js not present' }, () => {
  require(foundingFile);
  assert.ok(AL.Sites && AL.SITES, 'founding sites loaded onto the same AL');
  const placed = AL.Sites.place({ W: 4000, H: 3000 }, { seed: 77 });
  const fl = Flight.create({ seed: 77, species: 'carpenter', rivals: 3, sites: placed });
  assert.equal(fl.sites.length, placed.length);
  for (const s of fl.sites) {
    const src = placed.find(p => p.id === s.id);
    assert.equal(s.type, src.id); assert.equal(s.pros, src.pros, 'Founding pros/cons shown as-is');
    const e = AL.Sites.entranceOf(src); assert.equal(s.ex, e.x); assert.equal(s.ey, e.y);
    assert.ok(s.fit.carpenter >= 0 && s.fit.carpenter <= 1);
  }
  const stump = fl.sites.find(s => s.id === 'stump'), meadow = fl.sites.find(s => s.id === 'meadow');
  assert.ok(stump.fit.carpenter > meadow.fit.carpenter, 'carpenters still prefer wood');
  Flight.finish(fl);
  const P = Flight.toPatch(fl), me = P.landings.find(l => l.colonyId === 0);
  const s = P.flight.sites.find(z => z.id === me.siteId);
  assert.ok(AL.SITES[s.type], 'Founding can look the type up in AL.SITES');
  assert.ok(Array.isArray(P.flight.queens.find(q => q.colonyId === 0).neighbours));
  assert.ok(me.bonus && typeof me.bonus.reserves === 'number');
});
