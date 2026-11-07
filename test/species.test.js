// The added species: honeypot, harvester, slave-maker and bullet ants (public/species.js).
const test = require('node:test'), assert = require('node:assert');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest.js', 'life.js', 'combat.js', 'orders.js', 'ai.js', 'fog.js', 'founding-sites.js', 'founding.js', 'expansion.js', 'victory.js',
  'world-time.js', 'world-poi.js', 'world-creatures.js', 'world-fog.js', 'species.js']) require('../public/' + f);
const S = AL.Species, C = AL.CASTE, ST = AL.ST, K = AL.CARRY, L = AL.LAYER;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const NEW = ['honeypot', 'harvester', 'slavemaker', 'bullet'];
const mk = (species, extra) => AL.Sim.createWorld(Object.assign({ seed: 31, species, noFog: true }, extra || {}));
const count = (w, col, fn) => { const A = w.ants; let n = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === col && fn(i)) n++; return n; };

test('eight species, each with the data fields the core reads', () => {
  assert.deepEqual(AL.SPECIES_ORDER, ['fire', 'leafcutter', 'carpenter', 'army', 'honeypot', 'harvester', 'slavemaker', 'bullet']);
  for (const k of AL.SPECIES_ORDER) {
    const sp = AL.SPECIES[k];
    for (const f of ['key', 'name', 'blurb', 'body', 'head', 'gaster', 'breed', 'hp', 'dps', 'speed', 'dig', 'size', 'start']) assert.ok(sp[f] != null, k + '.' + f);
    assert.ok(sp.perks.length >= 3, k + ' perks');
  }
  assert.equal(AL.NCASTE, 10); assert.equal(AL.CASTES[C.CAPTIVE].key, 'captive');
  assert.ok(!AL.EGG_CASTES.includes(C.CAPTIVE), 'queens never lay captives');
  for (const k of NEW) assert.ok(AL.Founding.PROFILE[k], 'founding profile ' + k);
});

test('every species runs as player and as a rival without errors (all eight on one map)', () => {
  const sites = [{ x: 600, y: 600 }, { x: 2000, y: 500 }, { x: 3400, y: 600 }, { x: 3400, y: 1500 }, { x: 3400, y: 2500 }, { x: 2000, y: 2500 }, { x: 600, y: 2500 }];
  for (const player of ['fire', 'slavemaker', 'bullet']) {
    const rivals = AL.SPECIES_ORDER.filter(k => k !== player);
    const w = mk(player, { playerSite: { x: 600, y: 1500 }, rivalSites: sites, rivalSpecies: rivals });
    assert.equal(w.colonies.length, 8);
    run(w, 150);
    for (const c of w.colonies) assert.ok(c.pop.reduce((a, b) => a + b, 0) > 0, player + ' map: ' + c.spKey + ' has ants');
    for (const c of w.colonies) for (const k of ['sugar', 'protein', 'seeds']) assert.ok(Number.isFinite(c.stock[k]) && c.stock[k] >= 0, c.spKey + ' ' + k);
  }
});

test('honeypot ants bank sugar in repletes; in lean times it is rationed and the queen stops laying', () => {
  const w = mk('honeypot'), p = w.player;
  run(w, 2);
  assert.ok(p.pop[C.HONEYPOT] >= 3, 'starts with repletes');
  p.stock.sugar = 200; run(w, 20);
  assert.ok(p.honey > 20, 'sugar banked as honey: ' + p.honey);
  const honey = p.honey;
  p.stock.sugar = 2; run(w, 3);
  assert.ok(p.lean, 'lean flag'); assert.ok(p.honey < honey, 'honey flows back');
  assert.ok(p.queen.layT >= 3, 'queen waits');
});

test('harvester majors mill seed into sugar and protein; they eat less', () => {
  const w = mk('harvester'), p = w.player;
  assert.ok(w.surface.foods.filter(f => f.kind === K.SEED && f.regen > 0).length >= 2, 'renewing grass seed near the mound');
  run(w, 2);
  p.stock.seeds = 100; p.stock.sugar = 20; p.stock.protein = 5;
  // the same colony without seeds (ants eat and nurses carry food off either way: compare, hunger.js)
  const w0 = mk('harvester'), p0 = w0.player; run(w0, 2);
  p0.stock.seeds = 0; p0.stock.sugar = 20; p0.stock.protein = 5;
  run(w, 10); run(w0, 10);
  assert.ok(p.stock.seeds < 100 && p.milled > 0, 'milled');
  assert.ok(p.stock.sugar > p0.stock.sugar + 2, 'sugar up: ' + p.stock.sugar.toFixed(1) + ' vs ' + p0.stock.sugar.toFixed(1));
  const f = mk('fire'); run(f, 2);
  assert.ok(AL.SPECIES.harvester.appetite < 1);
});

test('bullet ants: a tiny colony of huge, long-lived ants that carry big loads', () => {
  const w = mk('bullet'), p = w.player, A = w.ants;
  run(w, 1);
  const n = count(w, 0, i => A.caste[i] !== C.QUEEN);
  assert.ok(n <= 14 && n >= 10, 'about 14 ants: ' + n);
  let i = -1; for (let j = 0; j < A.high; j++) if (A.state[j] && A.col[j] === 0 && A.caste[j] === C.FORAGER) { i = j; break; }
  if (i >= 0) {
    A.layer[i] = L.SURFACE; A.x[i] = p.x; A.y[i] = p.y; A.carry[i] = K.SUGAR;
    const s0 = p.stock.sugar; p.enter(w, i);
    assert.equal(p.stock.sugar - s0, AL.SPECIES.bullet.carry - 1, 'bonus crumbs at the door');
  }
  const r = mk('fire', { rivalSpecies: ['bullet'] }), rc = r.colonies[1];
  run(r, 1);
  assert.ok(rc.inside.reduce((a, b) => a + b, 0) + rc.surf < 20, 'rival bullet colony is small too');
  assert.match(S.nameOf(1234), /^[A-ZÉ][a-zéú]+$/);
});

test('slave-makers start with captives in their host colours and lay raiders, not nurses', () => {
  const w = mk('slavemaker'), p = w.player, A = w.ants;
  run(w, 1);
  const caps = count(w, 0, i => A.caste[i] === C.CAPTIVE);
  assert.ok(caps >= 15, 'captives: ' + caps);
  for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.caste[i] === C.CAPTIVE) assert.equal(A.host[i], 1, 'host = the neighbouring colony');
  p.pop.fill(0); p.pop[C.CAPTIVE] = 30; p.pop[C.SOLDIER] = 2; p.pop[C.WORKER] = 4;   // few raiders left
  const plan = []; for (let k = 0; k < 20; k++) plan.push(S.autoCaste(p));
  assert.ok(!plan.includes(C.NURSE) && plan.filter(c => c === C.SOLDIER).length >= 8, 'raider egg plan ' + plan.join(','));
  assert.ok(p.broodMul > 0 && p.broodMul <= 1);
});

test('a slave raid on a rival nest carries pupae home; they hatch as captives of the victim', () => {
  const w = mk('slavemaker'), p = w.player, r = w.colonies[1], A = w.ants;
  run(w, 2);
  r.broodQ.push({ caste: C.WORKER, t: 0.9, fed: true });
  const q0 = r.broodQ.length;
  r.inside.fill(0);   // undefended: the propaganda wins at once
  const i = A.spawn(0, C.SOLDIER, L.SURFACE, r.x, r.y, 0, w.R);
  assert.ok(S.raidIn(w, i, r), 'grabbed a pupa');
  assert.equal(A.carry[i], K.BROOD); assert.equal(A.host[i], 1); assert.equal(r.broodQ.length, q0 - 1);
  // home again
  A.x[i] = p.x; A.y[i] = p.y;
  const b0 = p.brood.length; p.enter(w, i);
  const b = p.brood[p.brood.length - 1];
  assert.equal(p.brood.length, b0 + 1); assert.equal(b.caste, C.CAPTIVE); assert.equal(b.host, 1); assert.equal(b.stage, 2);
  // emerging: the new adult is a captive wearing colony 1's colours
  let born = -1; const off = AL.on('antBorn', (ww, d) => { if (ww === w && d.brood === b) born = d.i; });
  for (let k = 0; k < 120 && born < 0; k++) run(w, 1);
  off();
  assert.ok(born >= 0, 'hatched'); assert.equal(A.caste[born], C.CAPTIVE); assert.equal(A.host[born], 1);
});

test('a Recruit path onto a rival mound is a slave raid: own raiders answer, captives stay home', () => {
  const w = mk('slavemaker'), p = w.player, r = w.colonies[1], A = w.ants;
  run(w, 3);
  let ev = null; const off = AL.on('slaveRaid', (ww, d) => { if (ww === w) ev = d; });
  const o = AL.Orders.addRecruit(w, 0, [{ x: p.x, y: p.y }, { x: r.x, y: r.y }], 8);
  off();
  assert.ok(ev && ev.target === 1, 'raid announced');
  assert.equal(o.raidOn, 1);
  let caps = 0; for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.prev[i] === ST.RECRUIT && A.str[i] === o.id && A.caste[i] === C.CAPTIVE) caps++;
  assert.equal(caps, 0, 'no captives drafted');
  assert.ok(o.assigned >= 6, 'raiders drafted: ' + o.assigned);
});

test('a rival slave-maker colony raids the player and steals brood from the nursery', () => {
  // whether a small party slips past the queen to the nursery is down to the seed, so try a few maps
  let raided = 0, stolen = 0;
  for (const seed of [31, 32, 33, 34, 35]) {
    const w = AL.Sim.createWorld({ seed, species: 'fire', noFog: true, rivalSpecies: ['slavemaker'], playerSite: { x: 900, y: 1500 }, rivalSites: [{ x: 1500, y: 1500 }] });
    const p = w.player, r = w.colonies[1], A = w.ants;
    run(w, 2);
    assert.ok(r.inside[C.CAPTIVE] >= 5, 'rival has captives inside');
    r.inside[C.SOLDIER] = 20; r.spAI = { raidT: 1, wave: 0, n: 0 };
    if (AL.AI && AL.AI.discover) AL.AI.discover(w, r.id, 0, p.x, p.y, 'test');   // rivals must find the player first
    let raid = null, got = 0;
    const off1 = AL.on('broodRaid', (ww, d) => { if (ww === w) raid = d; });
    const off2 = AL.on('broodStolen', (ww, d) => { if (ww === w && d.from === 0) got++; });
    // an undefended nest (everyone out, and newly hatched workers removed too)
    const clear = () => { for (let i = 0; i < A.high; i++) if (A.state[i] && A.col[i] === 0 && A.caste[i] !== C.QUEEN) A.kill(i); };
    for (let k = 0; k < 90 && !got; k++) { clear(); run(w, 1); }
    off1(); off2();
    if (raid && raid.target === 0 && raid.n >= 6) raided++;
    stolen += got;
    if (stolen) break;
  }
  assert.ok(raided > 0, 'raid launched on the player');
  assert.ok(stolen > 0, 'brood carried off');
});

test('founding: the new species found colonies headlessly; host workers adopt a slave-maker queen', () => {
  for (const k of NEW) {
    const ho = AL.Founding.simulate({ species: k, siteId: 'meadow', seed: 5 });
    assert.ok(ho.ok, k + ' founding survived');
    assert.ok(ho.nanitics >= 1, k + ' raised workers');
  }
  const w = mk('slavemaker'); run(w, 1);
  const before = w.player.pop[C.CAPTIVE] = 0;
  AL.emit(w, 'founded', { col: 0 });
  assert.equal(count(w, 0, i => w.ants.caste[i] === C.CAPTIVE) - before >= S.CFG.SM_HOST_WORKERS, true);
});

test('existing species are untouched by the species hooks', () => {
  for (const k of ['fire', 'leafcutter', 'carpenter', 'army']) {
    const w = mk(k); run(w, 1);
    assert.equal(S.autoCaste(w.player), -1, k + ' uses the default egg plan');
    assert.equal(w.player.broodMul, k === 'army' ? AL.SPECIES.army.broodMul : 1);   // army brood is slow on purpose (one batch per cycle, bivouac.js)
    assert.equal(w.player.pop[C.CAPTIVE], 0);
  }
});
