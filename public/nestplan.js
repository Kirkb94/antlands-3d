// How the nest is dug starts to matter: room layout bonuses, buried finds, and door plugs.
//
// Layout (worked out again whenever the nest's rooms change; distances are walking tiles between two rooms):
//  - Nursery by the queen's chamber (NEAR tiles or less): brood grows 15% faster (eggs go straight to the nurses).
//  - Food store by the water reservoir: stored food spoils half as fast.
//  - Midden far from the nursery (FAR_MIDDEN+): half the disease from it; right next to it (NEAR): double.
//  - Barracks by the entrance: the door plug is rebuilt twice as fast.
//
// Buried finds: some undug tiles hide something (fixed per nest from its seed, about 1 in 35 diggable tiles). A
// worker digging one out (nest.js excavate) finds it: beetle grubs, cicada nymphs and seed stashes near the
// surface, sap roots and air pockets (a few tiles that open up for free) deeper down, underground springs and an
// old dead colony's larder at the bottom. Finds next to open tunnels glint in the nest view.
//
// Door plugs: every nest plugs its door (home.plug: { on, hp, max }). The colony's own ants pass; a raider at the
// door (orders.js breakIn) has to chew through it first, at a quarter of its bite. While nobody has chewed it for a
// few seconds the workers build it back with soil. Carpenter ants plug the door with their majors' heads: 2.5x as
// tough. The nest panel's Door button opens or closes it ('plug' command).
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); require('./cmd.js'); }
const N = AL.Nest, CH = N.CH, F = N.F, TILE = N.TILE, C = AL.CASTE, K = AL.CARRY;
const NP = AL.NESTPLAN = Object.assign({
  NEAR: 4, FAR_MIDDEN: 10,
  BROOD: 1.15, SPOIL: 0.5, MIDDEN_FAR: 0.5, MIDDEN_NEAR: 2, PLUG_REGROW: 2,
  FIND_EVERY: 35,                       // about one tile in this many diggable ones hides a find
  PLUG_HP: 200, PLUG_HEADS: 2.5,        // the plug's hp; carpenter ants' head plugs are this much tougher
  PLUG_BITE: 0.25,                      // share of a raider's bite that goes into the plug
  PLUG_GROW: 6, PLUG_SOIL: 0.04,        // hp rebuilt a second, soil per hp
  PLUG_QUIET: 5,                        // seconds without chewing before the workers rebuild it
  PLUG_PER_ANT: 0.6,                    // + hp per ant living in the nest (a big colony keeps a thicker plug)
}, AL.NESTPLAN || {});

// ---- layout ----------------------------------------------------------------------------------------
// walking tiles from any tile of room `a` to the nearest tile of room `fb` (its field); Infinity if either is missing
function apart(nest, a, fb) {
  const t = nest.tiles[a], f = nest.fields[fb]; if (!t || !t.length || !f) return Infinity;
  let m = N.FAR; for (const i of t) if (f[i] < m) m = f[i];
  return m >= N.FAR ? Infinity : m;
}
// (cached per layout version, never while the flow fields are stale: the fields are rebuilt in the sim's own time,
// so a layout worked out between, by the UI say, could differ from another PC's)
function layout(nest) {
  if (nest._lay && nest._lay.v === nest.layoutVersion && !nest.fieldDirty) return nest._lay;
  const hasN = nest.tiles[CH.NURSERY].length > 0, hasM = nest.tiles[CH.MIDDEN].length > 0;
  const dQN = apart(nest, CH.NURSERY, F.QUEEN), dFW = apart(nest, CH.FOOD, F.WATER), dMN = hasN && hasM ? apart(nest, CH.MIDDEN, F.NURSERY) : NaN, dBE = apart(nest, CH.BARRACKS, F.ENTRANCE);
  const L = {
    v: nest.layoutVersion,
    nursery: dQN <= NP.NEAR, food: dFW <= NP.NEAR, barracks: dBE <= NP.NEAR + 2,
    midden: !hasM || !hasN ? 0 : dMN >= NP.FAR_MIDDEN ? 1 : dMN <= NP.NEAR ? -1 : 0,
    d: { qn: dQN, fw: dFW, mn: dMN, be: dBE },
  };
  L.brood = L.nursery ? NP.BROOD : 1;
  L.spoil = L.food ? NP.SPOIL : 1;
  L.middenF = L.midden > 0 ? NP.MIDDEN_FAR : L.midden < 0 ? NP.MIDDEN_NEAR : 1;
  L.plugGrow = L.barracks ? NP.PLUG_REGROW : 1;
  // room levels (nestclimate.js): a bigger queen chamber lays faster, a bigger store spoils less, a bigger midden smells less
  const M = AL.NestClimate && !nest.bivouac ? AL.NestClimate.layoutMul(nest) : null;
  L.lay = M ? M.lay : 1;
  if (M) { L.spoil *= M.spoil; L.middenF *= M.midden; }
  if (!nest.fieldDirty) nest._lay = L;
  return L;
}

// ---- buried finds -----------------------------------------------------------------------------------
const FINDS = {
  grubs:  { name: 'Beetle grubs',        give: { protein: 14 } },
  cicada: { name: 'A cicada nymph',      give: { protein: 30 } },
  seeds:  { name: 'A buried seed stash', give: { sugar: 12, seeds: 18 } },
  sap:    { name: 'A sap-filled root',   give: { sugar: 35 } },
  pocket: { name: 'An air pocket',       open: 5 },
  spring: { name: 'An underground spring', give: { water: 80 } },
  larder: { name: 'An old colony\'s larder', give: { sugar: 45, protein: 45 } },
};
// which find (if any) undug tile i of this nest hides: fixed by the nest's seed, deeper tiles hold the better ones
function findAt(nest, i) {
  const k = nest.base ? nest.base[i] : nest.kind[i];   // (what the soil was before anyone dug it)
  if (k === TILE.OPEN || k === TILE.ROCK || k === TILE.ROOT || k === TILE.LIVE || k === TILE.AIR) return null;
  const seed = nest._findSeed || (nest._findSeed = 1 + ((nest.colony && nest.colony.id) || 0) * 7919 + Math.floor(AL.hash2(nest.cols, nest.rows, 991) * 1e6));
  if (AL.hash2(i, seed, 401) * NP.FIND_EVERY >= 1) return null;
  const r = (i / nest.cols) | 0, depth = r / nest.rows, u = AL.hash2(i, seed, 409);
  if (depth < 0.3) return u < 0.45 ? 'grubs' : u < 0.75 ? 'seeds' : 'cicada';
  if (depth < 0.65) return u < 0.35 ? 'sap' : u < 0.65 ? 'cicada' : u < 0.85 ? 'pocket' : 'grubs';
  return u < 0.35 ? 'spring' : u < 0.6 ? 'pocket' : u < 0.8 ? 'larder' : 'sap';
}
// nest.js excavate: a worker dug out tile i
function dug(world, nest, i) {
  const what = findAt(nest, i); if (!what) return;
  nest.found = nest.found || {}; if (nest.found[i]) return; nest.found[i] = 1;
  const d = FINDS[what], col = nest.colony, s = col.stock, mul = (d.give && (d.give.sugar || d.give.protein || d.give.seeds)) ? (AL.TUNE.FOOD_MUL || 1) : 1;
  if (d.give) for (const k in d.give) s[k] = (s[k] || 0) + d.give[k] * (k === 'water' ? 1 : mul);
  if (d.open) {   // an air pocket: a few marked or plain tiles next to it fall open
    const cols = nest.cols, q = [i], seen = new Set(q); let n = 0;
    while (q.length && n < d.open) {
      const j = q.shift(), c = j % cols, r = (j / cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr; if (cc < 0 || rr < 1 || cc >= cols || rr >= nest.rows) continue;
        const t = rr * cols + cc; if (seen.has(t)) continue; seen.add(t);
        const k = nest.kind[t]; if (k === TILE.ROCK || k === TILE.ROOT || k === TILE.LIVE || k === TILE.AIR) continue;
        if (k !== TILE.OPEN) { if (nest.mark[t]) nest.digCount--; nest.kind[t] = TILE.OPEN; nest.mark[t] = 0; nest.prog[t] = 0; n++; if (r >= nest.waterTable) nest.water[t] = 1; }
        q.push(t);
      }
    }
    nest.fieldDirty = true; nest.version++; nest.layoutVersion++;
  }
  const [x, y] = N.centre(nest, i);
  AL.emit(world, 'nestFind', { col: col.id, hid: col.hid != null ? col.hid : col.id, what, name: d.name, give: d.give, open: d.open, x, y, mul });
}
// finds next to open tunnels (they glint in the nest view): [tile, kind]
function hints(nest) {
  if (nest._hint && nest._hint.v === nest.version) return nest._hint.list;
  const out = [], cols = nest.cols, n = nest.n;
  for (let i = cols; i < n; i++) {
    if (nest.kind[i] === TILE.OPEN) continue;
    const c = i % cols;
    if (!((c > 0 && nest.kind[i - 1] === TILE.OPEN) || (c < cols - 1 && nest.kind[i + 1] === TILE.OPEN) || nest.kind[i - cols] === TILE.OPEN || (i + cols < n && nest.kind[i + cols] === TILE.OPEN))) continue;
    const f = findAt(nest, i); if (f && !(nest.found && nest.found[i])) out.push([i, f]);
  }
  nest._hint = { v: nest.version, list: out };
  return out;
}

// ---- door plugs -------------------------------------------------------------------------------------
const heads = col => !!(col && col.sp && col.sp.key === 'carpenter');
function plugMax(h) { return (NP.PLUG_HP + NP.PLUG_PER_ANT * ((h.pop ? h.pop.reduce((a, b) => a + b, 0) : 0))) * (heads(h) ? NP.PLUG_HEADS : 1); }
function plugOf(h) {
  if (!h || !h.nest || (h.sp && h.sp.nomad)) return null;
  if (!h.plug || !Object.prototype.hasOwnProperty.call(h, 'plug')) { const m = plugMax(h); h.plug = { on: true, hp: m, max: m, hitT: -99 }; }
  return h.plug;
}
// orders.js breakIn: ant i wants into `target`'s nest; true while the plug holds (the ant chews it instead)
function blocks(world, i, target) {
  const p = plugOf(target); if (!p || !p.on || p.hp <= 0) return false;
  const A = world.ants, info = AL.CASTES[A.caste[i]], sp = world.colonies[A.col[i]].sp;
  const bite = (info.dps || 1) * ((sp && sp.dps) || 1) * NP.PLUG_BITE * AL.TUNE.DT;
  p.hp = Math.max(0, p.hp - bite); p.hitT = world.t;
  if (p.hp <= 0) AL.emit(world, 'plugBroken', { col: target.id, hid: target.hid != null ? target.hid : target.id, by: A.col[i] });
  return p.hp > 0;
}
function cmdPlug(world, col, a) {
  const h = (a.h != null && world.homes && world.homes[a.h | 0]) || world.colonies[col];
  if (!h || h.id !== col) return false;
  const p = plugOf(h); if (!p) return false;
  p.on = !!a.on; return true;
}

AL.registerSystem({
  id: 'nestplan', order: 7,
  second(world) {
    for (const h of world.homes || world.colonies) {
      if (!h || h.gone || !h.nest || h.alive === false) continue;
      const nest = h.nest, L = layout(nest);
      h.layout = L;
      const p = plugOf(h); if (!p) continue;
      p.max = plugMax(h);
      if (p.on && p.hp < p.max && world.t - p.hitT > NP.PLUG_QUIET) {
        const soil = h.stock.soil || 0, want = Math.min(p.max - p.hp, NP.PLUG_GROW * L.plugGrow), cost = want * NP.PLUG_SOIL;
        const can = soil >= cost ? want : soil / NP.PLUG_SOIL;
        if (can > 0) { p.hp += can; h.stock.soil = soil - can * NP.PLUG_SOIL; }
      }
      if (p.hp > p.max) p.hp = p.max;
    }
  },
});
if (AL.Cmd) AL.Cmd.def('plug', cmdPlug);
// the UI's read-only look at a home's plug (plugOf makes one when there is none: only the sim may do that)
const plugPeek = h => (h && Object.prototype.hasOwnProperty.call(h, 'plug') ? h.plug : null);
AL.NestPlan = { NP, FINDS, layout, plugPeek, apart, findAt, dug, hints, plugOf, plugMax, blocks, heads };
if (NODE) module.exports = AL.NestPlan;
})(typeof window !== 'undefined' ? window : globalThis);
