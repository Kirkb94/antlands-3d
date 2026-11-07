// Antlands brushes: what painting with a player tool does to the world (scent trails, alarm orders,
// dig marks, chambers). Pure simulation, no DOM, so every PC in a multiplayer match (and Node) paints the same.
// tools.js is the UI side: it turns mouse strokes into 'paint' commands (cmd.js), which call AL.Brush.run.
// Strokes live in the world, one per colony: world.strokes[col].
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
const B = {};

// this PC's own stroke: toasts and tutorial hints (UI only, never changes the world)
const mine = (w, col) => !NODE && w && col === (w.me || 0) && AL.Game && w === AL.Game.world;
const say = (w, col, text, kind) => { if (mine(w, col) && AL.UI && AL.UI.toast) AL.UI.toast(text, kind); };
const strokes = w => w.strokes || (w.strokes = {});
// walk from the last brush point to (x,y) in fixed steps so fast strokes leave no gaps
function along(st, x, y, step, fn) {
  const dx = x - st.lx, dy = y - st.ly, d = AL.hypot(dx, dy);
  if (d < step) return;
  const n = Math.floor(d / step);
  for (let k = 1; k <= n; k++) { const t = k * step / d; fn(st.lx + dx * t, st.ly + dy * t); st.len += step; }
  st.lx += dx * n * step / d; st.ly += dy * n * step / d;
}
const grid = (w, key, col) => (w.pher[key + 'Of'] ? w.pher[key + 'Of'][col] : w.pher[key]);
// the nest a stroke is for (a.h: one of your satellites' nests, picked in the nest tabs) and the order's home id:
// set only when the colony has satellites, so a one-nest colony's orders stay open to all its ants
function homeFor(w, col, a) { const hm = a && a.h != null && w.homes && w.homes[a.h | 0]; return hm && hm.id === col && !hm.gone ? hm : w.colonies[col]; }
function orderHid(w, col, a) {
  const home = homeFor(w, col, a);
  if (home.sat) return home.hid;
  for (const h of w.homes || []) if (h && h.sat && h.id === col && !h.gone) return home.hid;
  return undefined;
}

function surface(id, def) {
  B[id] = Object.assign({ radius: 14 }, def, {
    run(w, col, phase, x, y, a) {
      const S = strokes(w);
      if (phase === 'start') { const st = S[col] = { id, lx: x, ly: y, len: 0, pts: [{ x, y }] }; this.dab(w, x, y, st, col, a); return; }
      const st = S[col]; if (!st || st.id !== id) return;
      if (phase === 'move') along(st, x, y, 6, (px, py) => { this.dab(w, px, py, st, col, a); if (st.len % 30 < 6) st.pts.push({ x: px, y: py }); });
      if (phase === 'end') { st.pts.push({ x, y }); S[col] = null; if (this.finish) return this.finish(w, st, col, a); }
      if (phase === 'cancel') S[col] = null;
    },
  });
}
// food trail: gets a little stronger along the stroke, so ants know which way leads out
// (capped at AL.TRAIL.PAINT_CAP: a painted trail guides ants out, but the highways they lay themselves are stronger)
surface('food', {
  dab(w, x, y, s, col) { const cap = AL.TRAIL ? AL.TRAIL.PAINT_CAP : 3; w.pher.food[col].depositDisc(x, y, this.radius, (0.9 + Math.min(1.6, s.len / 500)) * cap / 8, cap * (0.75 + 0.25 * Math.min(1, s.len / 500))); },
  finish(w, s, col) { AL.emit(w, 'trailPainted', { col, pts: s.pts.slice(), len: s.len }); },
});
surface('alarm', { radius: 22,
  dab(w, x, y, s, col, a) { w.pher.alarm[col].depositDisc(x, y, this.radius, 2); if (!s.last || AL.dist2(s.last.x, s.last.y, x, y) > 160 * 160) { s.last = { x, y }; AL.Orders.addAlarm(w, col, x, y, orderHid(w, col, a)); } },
  finish(w, s, col, a) { const p = s.pts[s.pts.length - 1]; AL.Orders.addAlarm(w, col, p.x, p.y, orderHid(w, col, a)); if (mine(w, col) && AL.UI && AL.UI.hintEvent) AL.UI.hintEvent('alarm'); },
});
surface('avoid', { radius: 18,
  dab(w, x, y, s, col) { grid(w, 'avoid', col).depositDisc(x, y, this.radius, 2.5); },
});
surface('erase', { radius: 26,
  dab(w, x, y, s, col) {
    w.pher.food[col].erase(x, y, this.radius); grid(w, 'avoid', col).erase(x, y, this.radius); w.pher.alarm[col].erase(x, y, this.radius); grid(w, 'recruit', col).erase(x, y, this.radius);
    // erasing over a recruit path cancels that order
    for (const o of AL.Orders.ordersNear(w, col, x, y, this.radius + 6)) { const n = AL.Orders.cancelRecruit(w, col, o.id); say(w, col, 'Recruit order cancelled, ' + n + ' ants heading home'); }
    // and over the middle of a Collect circle cancels that one
    for (const o of AL.Orders.collectsNear(w, col, x, y, this.radius + 14)) { const n = AL.Orders.cancelCollect(w, col, o.id); say(w, col, 'Collect cancelled, ' + n + ' ants heading home'); }
  },
});

// ---- nest tools: tiles of your own nest's side view ----
function tiles(id, def) {
  B[id] = Object.assign({ tiles: 0 }, def, {
    run(w, col, phase, x, y, a) {
      const home = homeFor(w, col, a);   // (a.h: one of your satellites' nests)
      const nest = home.nest; if (!nest || nest.bivouac) return;   // a bivouac lays itself out (nest.js)
      const S = strokes(w);
      if (phase === 'start') { const st = S[col] = { id, lx: x, ly: y, len: 0, n: 0 }; this.dabTiles(nest, x, y, st, a); return; }
      const st = S[col]; if (!st || st.id !== id) return;
      if (phase === 'move') along(st, x, y, 3, (px, py) => this.dabTiles(nest, px, py, st, a));
      if (phase === 'end' || phase === 'cancel') S[col] = null;
    },
    dabTiles(nest, x, y, st, a) {
      const T = nest.tile, c0 = Math.floor(x / T), r0 = Math.floor(y / T), rr = this.tiles;
      for (let dr = -rr; dr <= rr; dr++) for (let dc = -rr; dc <= rr; dc++) {
        if (Math.abs(dr) + Math.abs(dc) > rr + (rr > 1 ? 1 : 0)) continue;
        if (this.apply(nest, c0 + dc, r0 + dr, a)) st.n++;
      }
    },
  });
}
const chOf = a => (a && a.ch != null ? a.ch | 0 : 2);
tiles('dig', { apply: (nest, c, r) => AL.Nest.mark(nest, c, r) });
tiles('chamber', { tiles: 1, apply: (nest, c, r, a) => { if (!AL.Nest.CH_INFO[chOf(a)]) return false; if (chOf(a) === AL.Nest.CH.APHID && !(nest.colony && nest.colony.mods && nest.colony.mods.rootAphids)) return false;   /* (aphid farming first) */ if (!nest.colony.sp.dig && !AL.Nest.isOpen(nest, c, r)) return false; return AL.Nest.designate(nest, c, r, chOf(a)); } });
tiles('fill', { tiles: 1, apply: (nest, c, r) => { const a = AL.Nest.unmark(nest, c, r), i = AL.Nest.idx(nest, c, r); let b = false; if (i >= 0 && nest.chamber[i]) b = AL.Nest.designate(nest, c, r, 0); return a || b; } });

AL.Brush = {
  B, along, orderHid,
  run(w, col, id, phase, x, y, a) { const b = B[id]; return b ? b.run(w, col, phase, x, y, a) : undefined; },
};
if (NODE) module.exports = AL.Brush;
})(typeof window !== 'undefined' ? window : globalThis);
