// Living ant bridges. Streams are swimmable (a third of walking speed, terrain.js); a colony can span one with its
// own workers instead:
//  - The Bridge tool [4] (tools.js) is a drag from one bank across the water to the other: the 'bridge' command.
//    It costs workers: one for every PER units of water (at least MIN). They walk out of the nest to the near bank
//    (an ordinary recruit order, orders.js) and lock on one by one, so the chain grows out across the water. Each
//    one leaves the colony for good: a bridge ant only comes off the bridge dead.
//  - On a finished bridge the colony's own ants walk at full speed (behavior.js reads S.bridgeOwner). Enemies can't
//    use it: they still swim. Ants of the colony heading out (foraging, raids, recruits, collects) or home that
//    come to the water take the nearest bridge that goes their way (steer, behavior.js); with none they swim.
//  - Enemy ants can attack a bridge: its two end ants are bite targets like a creature (combat.js latches onto
//    world.bridgeEnds). The bridge ants never bite back, they're busy holding on. Each end ant killed is one ant
//    off the bridge (a corpse on the bank); a bridge that's lost an ant has a gap and can't be crossed until it's
//    patched (drag the Bridge tool over it again). The last ant dead, the bridge is gone.
//  - AI rivals build bridges too, over the narrowest water near their nest.
// world.bridges: [{ id, col, x0, y0, x1, y1, len, water, need, locked, whole, ever, hpEach, oid, t, gone }]
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) { require('./data.js'); require('./terrain.js'); require('./orders.js'); require('./cmd.js'); }
const ST = AL.ST, C = AL.CASTE, L = AL.LAYER;
const BT = AL.BRIDGE_TUNE = Object.assign({
  PER: 2.5,           // units of water one ant spans (the chain is three ants wide)
  MIN: 5,             // the smallest bridge
  MAX_WATER: 160,     // the widest water a bridge can span
  BANK: 10,           // how far a bridge reaches onto dry ground at each end
  HALF_W: 6,          // half-width of the deck ants walk on
  END_R: 7,           // an end ant as a bite target
  END_HP: 2.5,        // ... its hit points (x the bridge ants' own: locked on, they're hard to pull off)
  DETOUR: 420,        // how far along the bank an ant walks to reach its colony's bridge
  DETOUR_T: 40,       // seconds before it gives up on reaching it
  CASTES: [C.WORKER, C.FORAGER, C.SCOUT, C.CAPTIVE],
  AI_EVERY: 20,       // seconds between an AI rival's bridge thoughts
  AI_CHANCE: 0.3,     // ... chance it builds one then
  AI_MAX: 2,          // most bridges an AI rival keeps
  AI_POP: 25,         // ... and the colony size it needs first
  AI_SCAN: 600,       // how far from its nest it looks for water
  AI_WATER: 110,      // the widest water it bridges
}, AL.BRIDGE_TUNE || {});
const ID0 = 9000000;   // bridge end ids (combat.js A.tuid: never a creature's)
const WET = () => AL.TERRAIN.STREAM;
const wetAt = (S, x, y) => AL.Terrain.at(S, x, y) === WET();
const byId = (world, id) => { for (const b of world.bridges || []) if (b.id === id) return b; return null; };

// ---- planning: where a drag from (x0,y0) to (x1,y1) would put a bridge ---------------------------------
function plan(world, col, x0, y0, x1, y1) {
  const S = world.surface;
  if (!S.terrain) return { ok: false, why: 'No water here' };
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 12) return { ok: false, why: 'Press on one bank and drag across the water to the other.' };
  if (wetAt(S, x0, y0)) return { ok: false, why: 'Start the bridge on dry ground at the water\'s edge.' };
  if (wetAt(S, x1, y1)) return { ok: false, why: 'End the bridge on the far bank.' };
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, step = 2;
  let first = -1, last = -1, water = 0;
  for (let t = 0; t <= len; t += step) { if (wetAt(S, x0 + ux * t, y0 + uy * t)) { if (first < 0) first = t; last = t; water += step; } }
  if (first < 0) return { ok: false, why: 'There\'s no water to cross there.' };
  if (water > BT.MAX_WATER) return { ok: false, why: 'Too wide: a living bridge spans at most ' + BT.MAX_WATER + ' units of water.' };
  // the bridge itself: just over the water, a little way onto each bank
  const t0 = Math.max(0, first - BT.BANK), t1 = Math.min(len, last + BT.BANK);
  const bx0 = x0 + ux * t0, by0 = y0 + uy * t0, bx1 = x0 + ux * t1, by1 = y0 + uy * t1;
  if (AL.Surface.isBlocked(S, bx0, by0) || AL.Surface.isBlocked(S, bx1, by1)) return { ok: false, why: 'Something is in the way on the bank.' };
  const need = Math.max(BT.MIN, Math.ceil(water / BT.PER));
  // over one of this colony's own bridges: patch it instead
  for (const b of world.bridges || []) {
    if (b.gone || b.col !== col) continue;
    const d0 = Math.min(AL.dist2(b.x0, b.y0, bx0, by0), AL.dist2(b.x1, b.y1, bx0, by0)), d1 = Math.min(AL.dist2(b.x0, b.y0, bx1, by1), AL.dist2(b.x1, b.y1, bx1, by1));
    if (d0 < 40 * 40 && d1 < 40 * 40) return { ok: true, patch: b, need: Math.max(0, b.need - b.locked - pending(world, b)) };
  }
  return { ok: true, x0: bx0, y0: by0, x1: bx1, y1: by1, len: t1 - t0, water, need };
}
// workers already on the way to a bridge
function pending(world, b) {
  const c = world.colonies[b.col], o = c && c.orders && c.orders.find(q => q.id === b.oid && !q.done && !q.cancelled);
  return o ? Math.max(0, o.want - o.arrived) : 0;
}
const workers = c => (c.pop ? c.pop[C.WORKER] + c.pop[C.FORAGER] + c.pop[C.SCOUT] + (c.pop[C.CAPTIVE] || 0) : 0);

// ---- the 'bridge' command -----------------------------------------------------------------------------
function place(world, col, x0, y0, x1, y1) {
  const c = world.colonies[col];
  if (!c || c.alive === false) return { ok: false, why: 'No colony' };
  const p = plan(world, col, x0, y0, x1, y1);
  if (!p.ok) return p;
  if (p.patch) {
    if (p.need <= 0) return { ok: false, why: p.patch.whole ? 'That bridge is already whole.' : 'Enough workers are already on the way.' };
    if (workers(c) < p.need + 2) return { ok: false, why: 'Not enough workers: patching it needs ' + p.need + '.' };
    recruit(world, p.patch, p.need);
    return { ok: true, need: p.need, patch: true, id: p.patch.id };
  }
  if (workers(c) < p.need + 2) return { ok: false, why: 'Not enough workers: this bridge needs ' + p.need + '.' };
  world.bridges = world.bridges || []; world.bridgeSeq = (world.bridgeSeq || 0) + 1;
  const b = { id: world.bridgeSeq, col, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, len: p.len, water: p.water, need: p.need, locked: 0, whole: false, ever: false, hpEach: 0, oid: 0, t: world.t, gone: false };
  world.bridges.push(b);
  recruit(world, b, b.need);
  mark(world);
  AL.emit(world, 'bridgeStarted', { col, bridge: b });
  return { ok: true, need: b.need, id: b.id };
}
// send n workers out to the bridge's near bank
function recruit(world, b, n) {
  const c = world.colonies[b.col]; if (!c || !AL.Orders) return null;
  const old = c.orders && c.orders.find(q => q.id === b.oid);
  if (old && !old.done) AL.Orders.cancelRecruit(world, b.col, old.id);
  const o = AL.Orders.addRecruit(world, b.col, [{ x: c.x, y: c.y }, { x: b.x0, y: b.y0 }], n, undefined, { bridge: b.id, castes: BT.CASTES });
  b.oid = o.id;
  // an AI rival with an abstract nest (no tunnels, ai.js): its workers walk straight out
  if (!c.nest && c.inside && AL.AI && AL.AI.release) {
    const out = AL.AI.release(world, c, C.WORKER, ST.RECRUIT, n), A = world.ants;
    let k = 0;
    for (let i = A.high - 1; i >= 0 && k < out; i--) {
      if (A.state[i] !== ST.RECRUIT || A.col[i] !== c.id || A.timer[i] !== 0 || AL.dist2(A.x[i], A.y[i], c.x, c.y) > 8 * 8) continue;
      if (c.orders.some(q => q.id === A.str[i] && q !== o)) continue;
      A.str[i] = o.id; A.wp[i] = 0; k++;
    }
    o.assigned += k; if (o.assigned >= o.want) o.full = true;
  }
  return o;
}
// a recruit reached the bank (orders.js): it locks on to the chain. Returns false if the bridge doesn't need it.
function arrive(world, i, o) {
  const A = world.ants, b = byId(world, o.bridge);
  if (!b || b.gone || b.locked >= b.need) return false;   // (not needed after all: it wanders off like any recruit)
  b.hpEach = Math.max(b.hpEach, A.maxhp[i] || 1);
  if (A.state[i] === ST.DRAG && AL.Behavior) AL.Behavior.releaseDrag(world, i);
  A.kill(i);   // (not a death: it's part of the bridge now)
  b.locked++;
  if (b.locked >= b.need) {
    b.whole = true;
    const first = !b.ever; b.ever = true;
    const c = world.colonies[b.col], oo = c.orders && c.orders.find(q => q.id === b.oid);
    if (oo && !oo.done) AL.Orders.cancelRecruit(world, b.col, oo.id);
    AL.emit(world, 'bridgeDone', { col: b.col, bridge: b, first });
  }
  mark(world);
  return true;
}

// ---- the deck: cells the colony's ants walk at full speed, and the two end ants enemies bite ------------
function mark(world) {
  const S = world.surface; if (!S.terrain) return;
  const n = S.gw * S.gh;
  if (!S.bridgeOwner || S.bridgeOwner.length !== n) S.bridgeOwner = new Uint8Array(n); else S.bridgeOwner.fill(0);
  const O = S.bridgeOwner, cell = S.cell, gw = S.gw, gh = S.gh, ends = [];
  let whole = 0;
  world.bridges = (world.bridges || []).filter(b => !b.gone);
  for (const b of world.bridges) {
    const f = b.whole ? 1 : b.locked / b.need, ux = (b.x1 - b.x0) / (b.len || 1), uy = (b.y1 - b.y0) / (b.len || 1);
    if (b.whole) whole++;
    for (let t = 0; t <= b.len * f; t += cell * 0.5) for (let o = -BT.HALF_W; o <= BT.HALF_W; o += cell * 0.5) {
      const gx = ((b.x0 + ux * t - uy * o) / cell) | 0, gy = ((b.y0 + uy * t + ux * o) / cell) | 0;
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) O[gy * gw + gx] = b.col + 1;
    }
    // end ants: the near bank's while anyone's on the bridge, the far bank's once it reaches across
    b.ends = b.ends || [end(b, 0), end(b, 1)];
    for (const e of b.ends) {
      const k = e.k, on = k === 0 ? b.locked > 0 : b.whole;
      e.x = k ? b.x1 - ux * 3 : b.x0 + ux * 3; e.y = k ? b.y1 - uy * 3 : b.y0 + uy * 3;
      e.maxHp = Math.max(1, b.hpEach * BT.END_HP);
      if (on && !e.alive) { e.alive = true; e.hp = e.maxHp; }
      else if (!on) { e.alive = false; e.hp = 0; }
      ends.push(e);
    }
  }
  world.bridgeEnds = ends; world.bridgesWhole = whole;
}
const end = (b, k) => ({ id: ID0 + b.id * 2 + k, bridgeEnd: true, bridge: b.id, k, owner: b.col, x: b.x0, y: b.y0, r: BT.END_R, hp: 0, maxHp: 1, alive: false, hostile: true, attacking: true, armor: 0.1, attackers: 0 });
function endById(world, id) { for (const e of world.bridgeEnds || []) if (e.id === id) return e; return null; }
// an end ant bitten to death (combat.js): one ant off the bridge
function endDied(world, e, by) {
  const b = byId(world, e.bridge); e.alive = false; e.hp = 0;
  if (!b || b.gone) return;
  b.locked = Math.max(0, b.locked - 1);
  AL.Surface.dropCorpse(world.surface, e.x, e.y, b.col, 1);
  const c = world.colonies[b.col]; if (c && c.stats) c.stats.died++;
  const wasWhole = b.whole;
  if (b.locked < b.need) b.whole = false;
  if (b.locked <= 0) { b.gone = true; AL.emit(world, 'bridgeLost', { col: b.col, bridge: b, by }); }
  else AL.emit(world, 'bridgeHit', { col: b.col, bridge: b, by, broke: wasWhole && !b.whole });
  mark(world);
}

// ---- walking: a colony's ants take their own bridge when they come to the water ---------------------------
const ROUTE = new Uint8Array(64);
for (const s of ['WANDER', 'RETURN', 'HOMING', 'HEAL', 'RECRUIT', 'RAID', 'COLLECT', 'RALLY']) if (ST[s] != null) ROUTE[ST[s]] = 1;
function mem(A) {
  if (A.brId && A.brId.length >= A.cap) return;
  const grow = (old, T) => { const a = new T(A.cap); if (old) a.set(old.subarray(0, Math.min(old.length, A.cap))); return a; };
  A.brId = grow(A.brId, Int32Array); A.brUid = grow(A.brUid, Int32Array); A.brK = grow(A.brK, Uint8Array); A.brPh = grow(A.brPh, Uint8Array); A.brT = grow(A.brT, Float32Array);
}
// the heading ant i should take (NaN: none, its own state machine steers). Called from the hot loop while any
// colony has a whole bridge.
function steer(world, i) {
  const A = world.ants; mem(A);
  const st = A.state[i];
  if (!ROUTE[st]) { A.brId[i] = 0; return NaN; }
  const x = A.x[i], y = A.y[i];
  let id = A.brId[i];
  if (id && A.brUid[i] !== A.uid[i]) id = A.brId[i] = 0;
  if (id) {
    const b = byId(world, id);
    if (!b || b.gone || !b.whole || world.t - A.brT[i] > BT.DETOUR_T) { A.brId[i] = 0; return NaN; }
    const k = A.brK[i], nx = k ? b.x1 : b.x0, ny = k ? b.y1 : b.y0, fx = k ? b.x0 : b.x1, fy = k ? b.y0 : b.y1;
    if (A.brPh[i] === 1) {
      if (AL.dist2(x, y, nx, ny) < 12 * 12) A.brPh[i] = 2;
      else return AL.atan2(ny - y, nx - x);
    }
    if (AL.dist2(x, y, fx, fy) < 9 * 9) { A.brId[i] = 0; return NaN; }   // over: on its way again
    // along the deck (pulled back onto its line if it drifted)
    const ux = (fx - nx) / (b.len || 1), uy = (fy - ny) / (b.len || 1), t = (x - nx) * ux + (y - ny) * uy;
    const tx = nx + ux * Math.min(b.len, t + 14), ty = ny + uy * Math.min(b.len, t + 14);
    return AL.atan2(ty - y, tx - x);
  }
  // water just ahead (and not swimming already, nor on its own deck): is there a bridge going its way?
  const S = world.surface, TSP = S.tspeed, O = S.bridgeOwner, gw = S.gw, gh = S.gh, inv = 1 / S.cell, col = A.col[i];
  const gx = (x * inv) | 0, gy = (y * inv) | 0;
  if (gx < 0 || gy < 0 || gx >= gw || gy >= gh || TSP[gy * gw + gx] < 0.5) return NaN;
  const a = A.a[i], ca = AL.cos(a), sa = AL.sin(a), ax = ((x + ca * 16) * inv) | 0, ay = ((y + sa * 16) * inv) | 0;
  if (ax < 0 || ay < 0 || ax >= gw || ay >= gh) return NaN;
  const ci = ay * gw + ax;
  if (TSP[ci] >= 0.5 || (O && O[ci] === col + 1)) return NaN;
  let best = null, bk = 0, bd = BT.DETOUR * BT.DETOUR;
  for (const b of world.bridges) {
    if (b.col !== col || !b.whole || b.gone) continue;
    const d0 = AL.dist2(x, y, b.x0, b.y0), d1 = AL.dist2(x, y, b.x1, b.y1), k = d0 <= d1 ? 0 : 1, d = k ? d1 : d0;
    if (d >= bd) continue;
    const vx = k ? b.x0 - b.x1 : b.x1 - b.x0, vy = k ? b.y0 - b.y1 : b.y1 - b.y0;
    if ((vx * ca + vy * sa) < 0.15 * (b.len || 1)) continue;   // that bridge goes the other way
    best = b; bk = k; bd = d;
  }
  if (!best) return NaN;   // none: it swims
  A.brId[i] = best.id; A.brUid[i] = A.uid[i]; A.brK[i] = bk; A.brPh[i] = 1; A.brT[i] = world.t;
  return AL.atan2((bk ? best.y1 : best.y0) - y, (bk ? best.x1 : best.x0) - x);
}

// ---- once a second: unfinished bridges keep recruiting; AI rivals build their own ------------------------------
function second(world) {
  const Bs = world.bridges;
  if (Bs && Bs.length) {
    let dirty = false;
    for (const b of Bs) {
      const c = world.colonies[b.col];
      if (!c || c.alive === false || c.out) { b.gone = true; dirty = true; continue; }
      // the first build carries on until it's across (ants killed on the way are replaced); AI rivals patch theirs too
      if (!b.whole && (!b.ever || c.ai) && b.locked + pending(world, b) < b.need && workers(c) > b.need - b.locked + 2) recruit(world, b, b.need - b.locked - pending(world, b));
    }
    if (dirty) mark(world);
  }
  const S = world.surface;
  if (!S.terrainCounts || !(S.terrainCounts[WET()] > 0) || world.mpNoAI) return;
  const tt = world.t | 0;
  for (const c of world.colonies) {
    if (!c.ai || c.isPlayer || c.alive === false || c.out || (c.sp && c.sp.nomad)) continue;
    if ((tt + c.id * 7) % BT.AI_EVERY) continue;
    if ((c.popAll || 0) < BT.AI_POP || AL.hash2(tt, c.id, 77) > BT.AI_CHANCE) continue;
    if ((Bs || []).filter(b => b.col === c.id && !b.gone).length >= BT.AI_MAX) continue;
    const p = aiSpot(world, c);
    if (p) place(world, c.id, p.x0, p.y0, p.x1, p.y1);
  }
}
// the narrowest water near an AI nest that nobody has bridged yet
function aiSpot(world, c) {
  const S = world.surface; let best = null;
  for (let k = 0; k < 24; k++) {
    const a = k / 24 * AL.TAU, ux = Math.cos(a), uy = Math.sin(a);
    let first = -1, last = -1;
    for (let r = (c.moundR || 20) + 40; r < BT.AI_SCAN; r += 6) {
      const x = c.x + ux * r, y = c.y + uy * r;
      if (x < 4 || y < 4 || x > S.W - 4 || y > S.H - 4) break;
      if (wetAt(S, x, y)) { if (first < 0) first = r; last = r; } else if (first >= 0) break;
    }
    if (first < 0 || last - first + 6 > BT.AI_WATER) continue;
    const w = last - first + 6;
    const x0 = c.x + ux * (first - 18), y0 = c.y + uy * (first - 18), x1 = c.x + ux * (last + 18), y1 = c.y + uy * (last + 18);
    if ((world.bridges || []).some(b => !b.gone && AL.dist2(b.x0, b.y0, x0, y0) < 140 * 140)) continue;
    const p = plan(world, c.id, x0, y0, x1, y1); if (!p.ok || p.patch) continue;
    // the water goes on either side (not just the tip of a stream, where walking round is quicker)
    let goes = 0;
    for (const o of [-60, 60]) for (let t = 0; t <= 1; t += 0.05) if (wetAt(S, x0 + (x1 - x0) * t - uy * o, y0 + (y1 - y0) * t + ux * o)) { goes++; break; }
    if (goes < 2) continue;
    const score = w + first * 0.15;
    if (!best || score < best.score) best = { x0, y0, x1, y1, score };
  }
  return best;
}

AL.registerSystem({
  id: 'bridges', order: 5.2,
  enabled: opts => opts.world !== false && !opts.benchOnly,
  init(world) { world.bridges = world.bridges || []; mark(world); },
  second,
});
if (AL.Cmd) AL.Cmd.def('bridge', (w, col, a) => {
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  return place(w, col, num(a.x0, 0), num(a.y0, 0), num(a.x1, 0), num(a.y1, 0));
});
// ---- drawing (browser): the 2D chain when the 3D models are off, the Bridge tool's drag line, build progress ---------
if (!NODE) {
  const label = (ctx, text, x, y, k, col) => {
    ctx.font = '700 ' + (12 * k) + 'px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3 * k; ctx.strokeStyle = 'rgba(20,14,6,0.8)'; ctx.strokeText(text, x, y); ctx.fillStyle = col || '#ffe6b0'; ctx.fillText(text, x, y);
  };
  const overAnts = (ctx, view, r) => {
    const w = r.world; if (!w || w.over || view.scene === 'nest') return;
    const k = 1 / view.z * (view.dpr || 1), me = AL.me ? AL.me() : 0, fog = w.fog, Bs = w.bridges || [];
    const flat = !(AL.R3D && AL.R3D.drawing);
    ctx.save();
    for (const b of Bs) {
      if (b.gone) continue;
      const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
      if (b.col !== me && fog && !fog.visibleAt(mx, my) && !fog.visibleAt(b.x0, b.y0)) continue;
      const c = w.colonies[b.col], body = (c && (c.colours || c.sp) && (c.colours || c.sp).body) || '#7a3b22';
      const f = b.whole ? 1 : b.locked / b.need, ux = (b.x1 - b.x0) / (b.len || 1), uy = (b.y1 - b.y0) / (b.len || 1);
      if (flat) {   // ants linked in three lanes (the 3D renderer draws real ones)
        ctx.fillStyle = body;
        for (let t = 0; t <= b.len * f; t += 5.5) for (const o of [-4, 0, 4]) {
          ctx.beginPath(); ctx.ellipse(b.x0 + ux * t - uy * o, b.y0 + uy * t + ux * o, 2.6, 1.5, Math.atan2(uy, ux) + ((t / 5.5 | 0) & 1 ? 0.4 : -0.4), 0, Math.PI * 2); ctx.fill();
        }
      }
      if (b.col === me && !b.whole && !pending(w, b)) label(ctx, (b.ever ? 'Broken bridge ' : 'Bridge ') + b.locked + '/' + b.need, mx, my - 14 * k, k, b.ever ? '#ffb0a0' : '#ffe6b0');
    }
    // the Bridge tool being dragged: where the bridge would go and what it costs
    const T = AL.Tools, d = T && T.bridgeDrag && T.bridgeDrag();
    if (d && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4) {
      const p = plan(w, me, d.x0, d.y0, d.x1, d.y1), ok = p.ok && (p.need > 0 || !p.patch);
      ctx.setLineDash([7 * k, 5 * k]); ctx.lineWidth = 2 * k; ctx.strokeStyle = 'rgba(255,240,210,0.7)';
      ctx.beginPath(); ctx.moveTo(d.x0, d.y0); ctx.lineTo(d.x1, d.y1); ctx.stroke(); ctx.setLineDash([]);
      if (p.ok && !p.patch) { ctx.lineWidth = BT.HALF_W * 2; ctx.strokeStyle = 'rgba(208,138,74,0.75)'; ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); ctx.stroke(); }
      const txt = !p.ok ? p.why : p.patch ? (p.need > 0 ? 'Patch: ' + p.need + ' workers' : 'Bridge is whole') : p.need + ' workers · ' + Math.round(p.water) + ' of water';
      label(ctx, txt, d.x1, d.y1 - 12 * k, k, ok ? '#ffe6b0' : '#ffb0a0');
    }
    ctx.restore();
  };
  AL.registerSystem({ id: 'bridges-ui', order: 91, render: { overAnts } });
  const mine = (w, d) => d && d.col === (AL.me ? AL.me() : 0) && AL.UI && AL.UI.toast && AL.Game && AL.Game.world === w;
  AL.on('bridgeDone', (w, d) => { if (mine(w, d)) AL.UI.toast(d.first ? 'The living bridge reaches the far bank: your ants cross at full speed.' : 'The bridge is whole again.', 'good'); });
  AL.on('bridgeHit', (w, d) => { if (mine(w, d) && d.broke) AL.UI.toast('Enemies killed one of your bridge ants: the bridge has a gap. Drag the Bridge tool over it to patch it.'); });
  AL.on('bridgeLost', (w, d) => { if (mine(w, d)) AL.UI.toast('Your living bridge is gone: the last of its ants were killed.'); });
}
AL.Bridges = { BT, plan, place, recruit, arrive, mark, steer, endById, endDied, byId, pending, aiSpot, ID0 };
if (NODE) module.exports = AL.Bridges;
})(typeof window !== 'undefined' ? window : globalThis);
