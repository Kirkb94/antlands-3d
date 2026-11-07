// Antlands player commands. Every change a person makes to the world (painting scent, queuing eggs, research,
// royal brood, flights, tunnels...) goes through AL.Cmd, so a multiplayer match can replay the same commands at
// the same tick on every PC (lockstep, see net.js). Single player runs a command at once, exactly as before.
//
//   AL.Cmd.def(name, fn(world, col, args) -> result)   register a command (sim side, no DOM)
//   AL.Cmd.issue(name, args, cb?)                        UI: do it for this PC's colony; cb(result) when it ran
//   AL.Cmd.exec(world, col, name, args)                  run one now (single player, or a multiplayer turn)
(function (root) {
'use strict';
const NODE = typeof module !== 'undefined' && module.exports;
const AL = NODE ? require('./al.js') : root.AL;
if (NODE) require('./brush.js');
const H = {};
let seq = 0;
const waiting = new Map();   // multiplayer: seq -> callback for this PC's own commands

function def(name, fn) { H[name] = fn; }
function exec(world, col, name, args) {
  const fn = H[name];
  const c = world && world.colonies[col];
  if (!fn || !c || !c.isPlayer) return undefined;
  if (world.over && world.over.frozen) return undefined;
  try { return fn(world, col, args || {}); }
  catch (e) { if (AL.reportError) AL.reportError(e, 'command ' + name, world); else throw e; return undefined; }
}
function issue(name, args, cb) {
  const G = AL.Game, w = G && G.world;
  if (!w) return undefined;
  const net = AL.Net && AL.Net.active && AL.Net.active();
  if (!net) { const r = exec(w, w.me || 0, name, args); if (cb) cb(r); return r; }
  const id = ++seq;
  if (cb) waiting.set(id, cb);
  AL.Net.send(name, args || {}, id);
  return undefined;
}
// a multiplayer turn: run every command in it (in the order the server put them), then the callbacks for ours
function runTurn(world, cmds) {
  for (const m of cmds) {
    const r = exec(world, m.col, m.n, m.a);
    if (m.col === world.me && m.s && waiting.has(m.s)) { const cb = waiting.get(m.s); waiting.delete(m.s); try { cb(r); } catch (e) { if (AL.reportError) AL.reportError(e, 'command result ' + m.n, world); } }
  }
}

// ---- the commands ---------------------------------------------------------------------------------------
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
// egg queue and auto-laying (ui.js)
// a.h: one of this colony's satellites' nests (its own queue), else the colony's own
const homeOf = (w, col, a) => { const h = a && a.h != null && w.homes && w.homes[a.h | 0]; return h && h.id === col && !h.gone ? h : w.colonies[col]; };
def('egg', (w, col, a) => { const c = homeOf(w, col, a); if (!c.eggQueue) return false; const k = a.caste | 0; if (k < 0 || k >= AL.NCASTE) return false; if (c.eggQueue.length < 24) c.eggQueue.push(k); return true; });
def('eggDel', (w, col, a) => { const c = homeOf(w, col, a); if (c.eggQueue) c.eggQueue.splice(a.i | 0, 1); return true; });
def('eggAuto', (w, col, a) => { homeOf(w, col, a).auto = !!a.on; return true; });
// pheromone brushes and nest tools (brush.js; strokes live in the world, one per colony)
def('paint', (w, col, a) => (AL.Brush ? AL.Brush.run(w, col, String(a.t), String(a.p), num(a.x, 0), num(a.y, 0), a) : undefined));
def('swarmAim', (w, col, a) => (AL.Swarm ? AL.Swarm.aim(w, w.colonies[col], num(a.x, 0), num(a.y, 0)) : { ok: false, why: 'No swarm raids' }));
def('march', (w, col, a) => (AL.Bivouac ? AL.Bivouac.start(w, w.colonies[col], num(a.x, 0), num(a.y, 0)) : { ok: false, why: 'No bivouac' }));
// orders (ui-game.js)
def('recruitCancel', (w, col, a) => (AL.Orders ? AL.Orders.cancelRecruit(w, col, a.id | 0) : 0));
// Collect (tools.js): a circle and the food ids this player saw inside it; a.n ants fetch it all
def('collect', (w, col, a) => {
  if (!AL.Orders || !AL.Orders.addCollect) return { ok: false };
  const ids = Array.isArray(a.ids) ? a.ids.slice(0, 300).map(v => v | 0) : [];
  return AL.Orders.addCollect(w, col, num(a.x, 0), num(a.y, 0), AL.clamp(num(a.r, 30), 10, 700), ids, Math.max(1, Math.min(200, (a.n | 0) || 10)), AL.Brush && AL.Brush.orderHid ? AL.Brush.orderHid(w, col, a) : undefined);
});
def('collectCancel', (w, col, a) => (AL.Orders && AL.Orders.cancelCollect ? AL.Orders.cancelCollect(w, col, a.id | 0) : 0));
def('recall', (w, col, a) => { if (AL.WorldPOI && w.poi) AL.WorldPOI.setRecall(w, col, !!a.on); return true; });
// evolution (research-ui.js)
def('research', (w, col, a) => (AL.Research ? AL.Research.start(w, col, String(a.id)) : false));
def('researchCancel', (w, col) => (AL.Research ? AL.Research.cancel(w, col) : false));
// expansion (expansion-ui.js)
def('royal', (w, col, a) => (AL.Expansion ? AL.Expansion.orderRoyal(w, col, a.kind === 'male' ? 'male' : 'queen') : false));
def('tunnelResearch', (w, col) => (AL.Expansion ? AL.Expansion.research(w, col) : false));
def('adoptQueen', (w, col) => (AL.Life && AL.Life.adoptQueen ? AL.Life.adoptQueen(w, w.colonies[col], 'royal') : false));   // polygyne: keep a winged queen at home
def('launch', (w, col, a) => { const X = AL.Expansion; if (!X) return false; const c = X.siteCheck(w, col, num(a.x, 0), num(a.y, 0)); if (!c.ok || w.colonies[col].royal.queens < 1) return false; return X.launch(w, col, num(a.x, 0), num(a.y, 0)); });
def('tunnel', (w, col, a) => { const X = AL.Expansion; if (!X) return false; const p = X.tunnelPlan(w, col, a.tcol | 0, a.sat == null ? null : a.sat); if (!p.ok) return false; return X.orderTunnel(w, col, a.tcol | 0, a.sat == null ? null : a.sat); });
def('garrison', (w, col, a) => (AL.Expansion ? AL.Expansion.garrison(w, col, num(a.x, 0), num(a.y, 0), num(a.r, 45), a.n | 0, num(a.secs, 90)) : 0));

AL.Cmd = { def, exec, issue, runTurn, H };
if (NODE) module.exports = AL.Cmd;
})(typeof window !== 'undefined' ? window : globalThis);
