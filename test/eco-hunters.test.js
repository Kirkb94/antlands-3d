// The ant hunters (eco-hunters.js): centipedes, antlions, assassin bugs and praying mantises live, eat, starve and
// breed like the rest of the yard, and every predator's hunger meter decides whether it goes after ants.
const test = require('node:test'), assert = require('node:assert');
const path = require('path'), { execFileSync } = require('child_process');
const AL = require('../public/al.js');
require('../public/sim.js');
for (const f of ['nest', 'hunger', 'life', 'injury', 'combat', 'orders', 'ai', 'fog', 'species', 'expansion', 'research', 'victory', 'world-time', 'world-poi', 'world-creatures', 'world-fog', 'eco', 'swarm']) require('../public/' + f + '.js');
const H = AL.EcoHunters, WC = AL.WorldCreatures, C = AL.CASTE, ST = AL.ST;
const run = (w, secs) => { for (let k = 0, n = Math.round(secs * 30); k < n; k++) AL.Sim.step(w); };
const mk = o => AL.Sim.createWorld(Object.assign({ seed: 3, colonies: 2, noFog: true, hunters: false, keypointsAt: 1e9 }, o || {}));
// an open spot well away from both mounds
function spot(w) {
  const S = w.surface;
  for (let k = 0; k < 400; k++) {
    const x = 200 + ((k * 977) % (S.W - 400)), y = 200 + ((k * 571) % (S.H - 400));
    if (!AL.Surface.isBlocked(S, x, y) && w.colonies.every(c => Math.hypot(c.x - x, c.y - y) > 400)) return { x, y };
  }
  throw new Error('no open spot');
}
function antsAt(w, x, y, n, d) { const A = w.ants, out = []; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, i = A.spawn(0, C.WORKER, 0, x + Math.cos(a) * d, y + Math.sin(a) * d, a, w.R); A.state[i] = ST.WANDER; A.timer[i] = 0; out.push(i); } return out; }
function kills(w) { const k = { n: 0 }; k.off = AL.on('hunterKill', ww => { if (ww === w) k.n++; }); return k; }
test.beforeEach(() => { WC.TUNE_GRACE = 0; });
test.afterEach(() => { delete WC.TUNE_GRACE; });

test('the four hunters exist, burn their bellies, starve and leave a carcass full of protein', () => {
  const w = mk(), p = spot(w);
  for (const kind of H.KINDS) {
    const cr = H.make(w, kind, p.x, p.y, { food: 0.3 });
    assert.ok(cr && AL.CREATURE_TYPES[kind].hp > 0 && AL.CREATURE_TYPES[kind].protein > 0, kind);
    const f0 = cr.food; run(w, 20);
    assert.ok(cr.food < f0, kind + ' gets hungrier: ' + f0 + ' -> ' + cr.food);
    cr.food = 0; cr.hp = cr.maxHp * 0.005;
    run(w, 3);
    assert.ok(!cr.alive, kind + ' starved');
    assert.ok(w.surface.foods.some(f => f.carcass && f.visual === kind && !f.gone), kind + ' left a carcass');
  }
  const c = AL.Eco.census(w);
  for (const kind of H.KINDS) assert.ok(c.n[kind] != null, kind + ' is in the census');
});

test('a starving centipede comes out and runs an ant down; a fed one stays under the litter', () => {
  const w = mk(), p = spot(w);
  const hungry = H.make(w, 'centipede', p.x, p.y, { food: 0.1 }), fed = H.make(w, 'centipede', p.x + 600, p.y, { food: 0.97 });
  antsAt(w, p.x + 60, p.y, 1, 0); antsAt(w, p.x + 660, p.y, 1, 0);
  const k = kills(w), seen = {};
  for (let s = 0; s < 120; s++) { AL.Sim.step(w); seen[hungry.state] = 1; seen['fed-' + fed.state] = 1; }
  run(w, 8); k.off();
  assert.ok(seen.stalk || seen.bite, 'the hungry one hunted: ' + Object.keys(seen));
  assert.ok(!seen['fed-stalk'] && !seen['fed-bite'], 'the fed one did not');
  assert.ok(k.n >= 1, 'it killed the ant');
});

test('an antlion pit draws ants down to a hungry antlion; a fed one lets them walk by', () => {
  const w = mk(), p = spot(w), A = w.ants;
  const al = H.make(w, 'antlion', p.x, p.y, { food: 0.15, dug: 1, state: 'wait' });
  run(w, 0.5);   // (settled in: camouflaged)
  const ants = antsAt(w, p.x, p.y, 4, 14);
  const k = kills(w);
  run(w, 6); k.off();
  assert.ok(k.n >= 1 || al.victim >= 0 || al.state === 'bite' || al.state === 'feed', 'it caught one');
  assert.ok(al.camo || al.prey, 'camouflaged in the sand until it strikes');
  // fed: nothing slides in
  const w2 = mk(), p2 = spot(w2);
  const al2 = H.make(w2, 'antlion', p2.x, p2.y, { food: 0.99, dug: 1, state: 'wait' });
  run(w2, 0.5);
  antsAt(w2, p2.x, p2.y, 4, 14);
  const k2 = kills(w2); run(w2, 3); k2.off();
  assert.equal(k2.n, 0); assert.equal(al2.victim, -1);
  assert.ok(ants.length === 4);
});

test('a waiting assassin bug and a perched mantis strike when hungry, and ants walk past them unawares', () => {
  for (const kind of ['assassin', 'mantis']) {
    const w = mk(), p = spot(w);
    const cr = H.make(w, kind, p.x, p.y, { food: 0.1, state: kind === 'mantis' ? 'perch' : 'wait', st: 0 });
    run(w, 0.5);
    assert.equal(cr.prey, false, kind + ' is camouflaged: ants don\'t swarm it');
    antsAt(w, p.x, p.y, 3, 12);
    const k = kills(w); run(w, 8); k.off();
    assert.ok(k.n >= 1, kind + ' killed an ant');
    // fed: leaves them alone
    const w2 = mk(), p2 = spot(w2);
    const cr2 = H.make(w2, kind, p2.x, p2.y, { food: 0.99, state: kind === 'mantis' ? 'perch' : 'wait', st: 0 });
    run(w2, 0.5);
    antsAt(w2, p2.x, p2.y, 3, 12);
    const k2 = kills(w2); run(w2, 3); k2.off();
    assert.equal(k2.n, 0, kind + ' fed: no kill'); assert.ok(cr2.alive);
  }
});

test('a mantis eats other insects too', () => {
  const w = mk(), p = spot(w);
  const m = H.make(w, 'mantis', p.x, p.y, { food: 0.2, state: 'perch', st: 0 });
  const lb = WC.spawn(w, 'lblarva', p.x + 14, p.y, { state: 'crawl', food: 0.9 });
  run(w, 2);
  assert.ok(!lb.alive, 'the larva was eaten'); assert.ok(m.food > 0.5);
});

test('a hungry ground beetle goes for an ant when nothing dead is about', () => {
  const w = mk(), p = spot(w);
  for (const f of w.surface.foods) if (f.carcass || f.corpse) f.gone = true;
  for (const o of w.surface.creatures) if (o.type === 'caterpillar' || o.type === 'cocoon' || o.type === 'lblarva') o.alive = false;
  const b = WC.spawn(w, 'beetle', p.x, p.y, { state: 'wander', food: 0.1, tx: p.x, ty: p.y });
  antsAt(w, p.x + 40, p.y, 1, 0);
  AL.Sim.step(w);   // (the ants' spatial hash is built during a step)
  b.state = 'wander'; b.food = 0.1;
  AL.Eco.beetleLook(w, b);
  assert.equal(b.state, 'stalk', 'stalking an ant');
});

test('hunters wander in a few minutes into a match, not in the campaign', () => {
  const w = mk({ hunters: true, seed: 8 });
  const seen = {}; const off = AL.on('ecoArrive', (ww, d) => { if (ww === w) seen[d.kind] = 1; });
  run(w, H.TUNE.FIRST.antlion + 30);
  off();
  assert.ok(seen.antlion || AL.Eco.census(w).n.antlion > 0 || !H.sandSpot(w, w.surface.W / 2, w.surface.H / 2, w.surface.W), 'an antlion arrived (if there is sand)');
  assert.ok(!seen.mantis, 'not yet the mantis');
  const wc = mk({ hunters: true, campaign: true, seed: 8 });
  for (let k = 0; k < 30 * 330; k++) AL.Sim.step(wc);
  const n = AL.Eco.census(wc).n; assert.equal(n.antlion + n.centipede + n.assassin + n.mantis, 0, 'none in the campaign');
});

test('same seed, same yard: a match with hunters stays deterministic (two separate runs)', () => {
  const src = `
    const AL = require(${JSON.stringify(path.join(__dirname, '../public/al.js'))}); require(${JSON.stringify(path.join(__dirname, '../public/sim.js'))});
    for (const f of ['nest','hunger','life','injury','combat','orders','ai','ai-nest','fog','species','expansion','research','victory','world-time','world-poi','world-creatures','world-fog','eco','swarm']) require(${JSON.stringify(path.join(__dirname, '../public'))} + '/' + f + '.js');
    AL.HUNTER_TUNE.FIRST = { antlion: 30, assassin: 40, centipede: 50, mantis: 60 };
    const w = AL.Sim.createWorld({ seed: 12, colonies: 3, rivalNests: true });
    for (let k = 0; k < 30 * 200; k++) AL.Sim.step(w);
    const A = w.ants; let h = 0; for (let i = 0; i < A.high; i++) if (A.state[i]) h = (h * 31 + Math.round(A.x[i] * 10) + A.state[i]) >>> 0;
    const c = AL.Eco.census(w).n;
    console.log(h, w.surface.creatures.map(cr => cr.type + Math.round(cr.x) + ':' + cr.food.toFixed(3)).join(','), c.antlion + c.assassin + c.centipede + c.mantis);`;
  const go = () => execFileSync(process.execPath, ['-e', src], { encoding: 'utf8' }).trim();
  const a = go(), b = go();
  assert.equal(a, b);
  assert.ok(+a.split(' ').pop() > 0, 'hunters were in it');
});
