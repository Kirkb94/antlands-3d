// Colony: stocks, mound, population counts. (Brood, egg queue and economy are added in the nest milestone.)
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./data.js');

// rivals of other species get a redder, darker take on their colours so they never look like yours
function rivalTint(sp) {
  const mix = (a, b, t) => { const na = parseInt(a.slice(1), 16), nb = parseInt(b.slice(1), 16); const ch = s => Math.round(((na >> s) & 255) * (1 - t) + ((nb >> s) & 255) * t); return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1); };
  return { body: mix(sp.body, '#c4291b', 0.45), head: mix(sp.head, '#a51d12', 0.45), gaster: mix(sp.gaster, '#46120c', 0.35) };
}
function create(world, id, opts) {
  const sp = AL.SPECIES[opts.species || 'fire'];
  const c = {
    id, isPlayer: !!opts.player, sp, spKey: sp.key,
    colours: opts.colours || (opts.player ? sp : rivalTint(sp)),
    x: opts.x, y: opts.y,
    stock: { sugar: 70, protein: 30, water: 20, seeds: 0, leaves: 0, fungus: 0 },   // (growth pass: was 40 / 16)
    moundSoil: opts.moundSoil || 60,
    moundR: 0,
    pop: new Int32Array(AL.NCASTE), surf: 0, inNest: 0,
    stats: { foodIn: 0, born: 0, died: 0, kills: 0 },
    alive: true,
  };
  updateMound(c);
  return c;
}
// mound radius grows with the square root of the soil piled on it
function updateMound(c) { c.moundR = 26 + Math.sqrt(c.moundSoil) * 2.2; }

// sugar a colony's adults eat per second (the queen is separate: QUEEN_SUGAR). Bigger ants eat more but less
// per unit of body, like real metabolism: each caste weighs (caste size x species size)^UPKEEP_EXP, x species appetite.
const upkeepW = {};
function casteUpkeep(sp, k) {
  const key = (sp && sp.key) || 'fire';
  let w = upkeepW[key];
  if (!w) {
    w = upkeepW[key] = new Float32Array(AL.NCASTE);
    for (let c = 0; c < AL.NCASTE; c++) w[c] = c === AL.CASTE.QUEEN ? 0 : AL.pow((AL.CASTES[c].size || 1) * ((sp && sp.size) || 1), AL.TUNE.UPKEEP_EXP || 1);
  }
  return w[k];
}
function upkeep(col) {
  let u = 0; const pop = col.pop;
  for (let k = 0; k < AL.NCASTE; k++) if (pop[k]) u += pop[k] * casteUpkeep(col.sp, k);
  return u * AL.TUNE.SUGAR_PER_ANT * (col.sp.appetite || 1);
}

AL.Colony = { create, updateMound, casteUpkeep, upkeep };
if (NODE) module.exports = AL.Colony;
})(typeof window !== 'undefined' ? window : globalThis);
