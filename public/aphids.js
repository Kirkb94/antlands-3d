// Aphid farming (the late 'aphidfarm' research, mods.rootAphids): the root-aphid chamber.
//  - Once a nest has a root-aphid chamber (nest.js CH.APHID, AL.TUNE.APHID_PER_TILE aphids a tile), foragers that
//    take honeydew at a wild aphid plant now and then carry a live aphid home instead (behavior.js pickup asks
//    catchAphid), while the chamber has room. A plant always keeps a few, so it never dies out.
//  - Home, the aphid goes into the chamber (life.js enterNest routes it, sim.js addStock counts it in home.aphids).
//  - Every second the herd breeds towards the chamber's size and its honeydew goes into that nest's sugar store,
//    less in winter. Each nest (capital or satellite) keeps its own herd.
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./nest.js'); }
const K = AL.CARRY, ST = AL.ST, CH = AL.Nest.CH;
const AF = AL.APHID_TUNE = Object.assign({
  HONEYDEW: 0.02,   // sugar per aphid per second (wild plants give 0.03 per aphid, but foragers have to fetch it)
  BREED: 0.006,     // aphids born per aphid per second while there is room (slows as the chamber fills)
  CATCH: 0.35,      // chance a forager taking honeydew at a wild plant brings a live aphid home instead
  KEEP: 5,          // a wild plant never loses its last few aphids
  WINTER: 0.4,      // honeydew and breeding in winter
}, AL.APHID_TUNE || {});

const known = col => !!(col && col.mods && col.mods.rootAphids);
const cap = home => (home && home.nest && home.nest.caps ? home.nest.caps.aphid || 0 : 0);
// can this nest take another aphid?
function room(home) { return known(home) && cap(home) - (home.aphids || 0) >= 1; }

// behavior.js pickup: a forager at a wild aphid plant's honeydew may carry a live aphid home instead (true if it did)
function catchAphid(world, i, f) {
  const p = f && f.poi;
  if (!p || p.type !== 'aphids' || p.gone || !(p.aphids > AF.KEEP + 1)) return false;
  const A = world.ants, home = AL.homeOf(world, i);
  if (!room(home)) return false;
  if (AL.hash2(A.uid[i], world.tick, 313) > AF.CATCH) return false;
  p.aphids -= 1;
  A.carry[i] = K.APHID; A.state[i] = ST.RETURN; A.timer[i] = 0; A.str[i] = 0.6; A.a[i] += Math.PI;
  AL.emit(world, 'aphidCaught', { col: A.col[i], hid: home.hid, x: A.x[i], y: A.y[i] });
  return true;
}
// sim.js addStock: an aphid carried in joins the herd (a full chamber lets it go)
function arrive(home) { home.aphids = Math.min(cap(home), (home.aphids || 0) + 1); }

AL.registerSystem({
  id: 'aphids', order: 6,
  second(world) {
    const H = world.homes || world.colonies, winter = world.env && world.env.winter ? AF.WINTER : 1;
    for (const h of H) {
      if (!h || h.gone || !h.nest || !h.aphids) continue;
      const c = cap(h);
      if (h.aphids > c) h.aphids = c;   // the chamber shrank: the rest wander off
      if (h.aphids <= 0) { h.aphids = 0; continue; }
      const sugar = h.aphids * AF.HONEYDEW * winter;
      h.stock.sugar += sugar; h._honeydew = sugar;
      if (h.stats) h.stats.foodIn += sugar;
      h._sugIn = (h._sugIn || 0) + sugar;   // (the HUD's sugar flow)
      if (h.aphids >= 2 && c > 0) h.aphids = Math.min(c, h.aphids + h.aphids * AF.BREED * winter * (1 - h.aphids / c));
    }
  },
});
AL.Aphids = { AF, known, cap, room, catchAphid, arrive };
if (NODE) module.exports = AL.Aphids;
})(typeof window !== 'undefined' ? window : globalThis);
