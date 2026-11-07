// Cosmetic hats (look only: nothing in the simulation reads them). Picked on the title screen's Cosmetics tab; the
// colony's queens, soldiers, majors and winged ants wear it (render3d.js / hats3d.js draw them).
//  - AI rivals get a random hat nobody else in the match has.
//  - Multiplayer: each person's pick rides in the match start (mp.hats). Two people on the same hat: the second one's
//    is a different colour of it (col.hat.v, the variant).
// col.hat = { id, v } or null (no hat). Seeded from the match seed, never from the world's random stream.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
const LIST = [
  { id: 'tophat', name: 'Top hat' }, { id: 'crown', name: 'Crown' }, { id: 'propeller', name: 'Propeller cap' },
  { id: 'hardhat', name: 'Hard hat' }, { id: 'cowboy', name: 'Cowboy hat' }, { id: 'wizard', name: 'Wizard hat' },
  { id: 'party', name: 'Party hat' }, { id: 'viking', name: 'Viking helmet' }, { id: 'chef', name: 'Chef\'s hat' }, { id: 'beanie', name: 'Beanie' },
];
const IDS = LIST.map(h => h.id);
// the browser's pick (title screen > Cosmetics), 'none' if never picked
const saved = () => { try { const v = root.localStorage && root.localStorage.getItem('antlands.hat'); return v && IDS.indexOf(v) >= 0 ? v : 'none'; } catch (_) { return 'none'; } };
const save = id => { try { root.localStorage.setItem('antlands.hat', IDS.indexOf(id) >= 0 ? id : 'none'); } catch (_) { /* private mode */ } };
// who wears it: queens, soldiers, majors and winged ants (the adult males / new queens)
const C = AL.CASTE || { SOLDIER: 3, MAJOR: 4, QUEEN: 7, WINGED: 8 };
const WEAR = new Uint8Array(16); WEAR[C.QUEEN] = WEAR[C.SOLDIER] = WEAR[C.MAJOR] = WEAR[C.WINGED] = 1;
// where the head is on the ant model (art.js / render3d.js numbers, ant facing +x, model units): x = head centre,
// r = head radius. looks = AL.R3D.LOOKS (species tweaks) when there is one
const HEAD = { 3: 1.55, 4: 1.9, 7: 1.15, 8: 1.0 }, THORAX = { 3: 1.05, 4: 1.15, 7: 1.5, 8: 1.3 }, headCache = {};
function head(caste, look, looks) {
  const key = caste + '|' + (look || ''); let h = headCache[key];
  if (h) return h;
  const lk = looks && look && caste !== C.QUEEN ? looks[look] : null;
  const hd = (HEAD[caste] || 1) * (lk && lk.head || 1), th = (THORAX[caste] || 1) * (lk && lk.thorax || 1);
  h = headCache[key] = { x: 0.6 + 1.15 * th + 1.25 * hd, r: 1.35 * hd };
  return h;
}
const valid = id => IDS.indexOf(id) >= 0;
const nameOf = id => { const h = LIST.find(q => q.id === id); return h ? h.name : 'No hat'; };
function assign(world, opts) {
  const mp = opts.mp, used = {}, humans = world.humans || [world.me || 0];
  for (const k of humans) {
    const c = world.colonies[k]; if (!c) continue;
    const id = mp ? mp.hats && mp.hats[k] : opts.hat !== undefined ? opts.hat : NODE ? null : saved();
    if (!valid(id)) { c.hat = null; continue; }
    const v = used[id] || 0; used[id] = v + 1; c.hat = { id, v };
  }
  for (const c of world.colonies) {
    if (humans.indexOf(c.id) >= 0) continue;
    const free = IDS.filter(id => !used[id]), pool = free.length ? free : IDS;
    const id = pool[Math.floor(AL.hash2((world.seed || opts.seed || 1) | 0, c.id, 4242) * pool.length) % pool.length];
    const v = used[id] || 0; used[id] = v + 1; c.hat = { id, v };
  }
}
AL.registerSystem({ id: 'hats', order: 0.5, init(world, opts) { assign(world, opts || {}); } });
AL.Hats = { LIST, IDS, valid, nameOf, assign, saved, save, WEAR, head };
if (NODE) module.exports = AL.Hats;
})(typeof window !== 'undefined' ? window : globalThis);
