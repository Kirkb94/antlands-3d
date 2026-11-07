// Antlands boot + main loop: fixed-timestep simulation, interpolated rendering, perf meter.
(function (root) {
'use strict';
const AL = root.AL, DT = AL.TUNE.DT;
const params = new URLSearchParams(location.search);

const G = AL.Game = {
  world: null, renderer: null, speed: 1, paused: false, running: false,
  perf: { fps: 0, frameMs: 0, simMs: 0, renderMs: 0, frames: 0, acc: 0, samples: [], worst: 0 },
};

function newGame(opts) {
  opts = Object.assign({ seed: (Math.random() * 1e9) | 0, species: 'fire' }, opts || {});
  const world = AL.Sim.createWorld(opts);
  G.world = world;
  G.renderer.setWorld(world);
  if (AL.UI && AL.UI.onNewGame) AL.UI.onNewGame(world, opts);
  G.running = true; G.paused = false;
  return world;
}
G.newGame = newGame;

// ---- crash catcher: a bug in one part shows up on screen (with a Copy button) instead of freezing the game ----
AL.SAFE = true;
const seenErr = new Set();
AL.reportError = function (e, where, world) {
  const msg = (e && e.message) || String(e), key = where + '|' + msg;
  if (typeof console !== 'undefined') console.error('[Antlands ' + where + ']', e);
  if (seenErr.has(key)) return; seenErr.add(key);
  const w = world || G.world;
  const text = 'Antlands error in ' + where + ': ' + msg + '\n' + ((e && e.stack) || '').split('\n').slice(1, 9).map(s => s.trim()).join('\n') +
    '\n(game time ' + (w ? Math.round(w.t) + ' s, species ' + (w.player && w.player.spKey) + ', ' + (w.colonies ? w.colonies.length : 0) + ' colonies' : 'none') + ')';
  try { localStorage.setItem('antlands.lastError', text); } catch (err) { /* private mode */ }
  if (typeof document === 'undefined') return;
  let box = document.getElementById('crashbox');
  if (!box) {
    box = document.createElement('div'); box.id = 'crashbox';
    box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;max-width:min(560px,calc(100vw - 24px));background:#2a1214;color:#ffd9d9;border:2px solid #e05a5a;border-radius:10px;padding:12px 14px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.5)';
    box.innerHTML = '<b style="font-size:16px">Something broke, but the game kept going</b><div style="margin:4px 0 8px;opacity:.85">Copy this and send it to Claude so it can be fixed.</div>' +
      '<pre style="margin:0 0 8px;max-height:160px;overflow:auto;white-space:pre-wrap;font:12px/1.35 ui-monospace,monospace;background:#170a0b;padding:8px;border-radius:6px"></pre>' +
      '<button data-k="copy" style="font:inherit;padding:4px 12px;margin-right:6px">Copy</button><button data-k="close" style="font:inherit;padding:4px 12px">Dismiss</button>';
    box.addEventListener('click', ev => {
      const k = ev.target.dataset && ev.target.dataset.k, pre = box.querySelector('pre');
      if (k === 'close') box.remove();
      else if (k === 'copy') {
        const sel = () => { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pre.textContent).then(() => { ev.target.textContent = 'Copied'; }, sel); else sel();
      }
    });
    document.body.appendChild(box);
  }
  const pre = box.querySelector('pre');
  pre.textContent = (pre.textContent ? pre.textContent + '\n\n' : '') + text;
};
if (typeof window !== 'undefined') {
  window.addEventListener('error', ev => AL.reportError(ev.error || ev.message, 'page'));
  window.addEventListener('unhandledrejection', ev => AL.reportError(ev.reason, 'promise'));
}

// ---- scene flow: title -> [registered pre-colony scenes, e.g. flight, founding] -> colony play ----
// Each scene gets ctx = { opts, done(patch) }; done() merges patch into the options and moves on.
G.scene = null;
G.startFlow = function (opts) {
  opts = Object.assign({}, opts || {});
  const list = AL.SCENES.filter(s => !s.enabled || s.enabled(opts));
  let k = 0;
  const next = () => {
    if (G.scene && G.scene.end) G.scene.end(G);
    G.scene = null;
    if (k >= list.length) { newGame(opts); return; }
    const sc = list[k++];
    G.scene = sc;
    if (AL.UI && AL.UI.onScene) AL.UI.onScene(sc);
    sc.start(G, { opts, done(patch) { if (patch) Object.assign(opts, patch); next(); }, skip: next });
  };
  G.world = null; G.running = false;
  next();
};

let last = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const P = G.perf;
  let real = last ? (now - last) / 1000 : DT; last = now;
  if (real > 0.25) real = 0.25;
  // fps over a 1 second window, plus the worst frame in it
  P.frames++; P.acc += real; P.worst = Math.max(P.worst, real);
  if (P.acc >= 1) { P.fps = P.frames / P.acc; P.worstMs = P.worst * 1000; P.samples.push(P.fps); if (P.samples.length > 30) P.samples.shift(); P.frames = 0; P.acc = 0; P.worst = 0; }
  if (G.scene) {
    try { if (G.scene.update) G.scene.update(G, real); } catch (e) { AL.reportError(e, 'scene update'); }
    try { if (G.scene && G.scene.render) { const c = G.renderer.ctx; c.setTransform(1, 0, 0, 1, 0, 0); G.scene.render(c, G); } } catch (e) { AL.reportError(e, 'scene draw'); }
    return;
  }
  const w = G.world;
  if (!w) return;
  // multiplayer: the server's turns drive the sim (net.js), not this PC's clock or pause
  const net = AL.Net && AL.Net.active() && AL.Net.game.world === w;
  let alphaNet = 1;
  if (net) {
    try { alphaNet = AL.Net.frame(G, real); } catch (e) { AL.reportError(e, 'multiplayer turn', w); }
    // catching up after a reload or rejoin: nothing to look at yet (the banner shows how far), so every millisecond
    // goes to the sim
    if (AL.Net.game && AL.Net.game.syncing) { w.events.length = 0; return; }
  }
  else if (G.running && !G.paused && !(w.over && w.over.frozen)) acc += real * G.speed;
  const t0 = performance.now();
  let steps = 0;
  while (!net && acc >= DT) {
    // a throw here would otherwise stop the sim on every frame from now on (the "freeze")
    try { AL.Sim.step(w); } catch (e) { AL.reportError(e, 'sim step', w); }
    acc -= DT; steps++;
    // never let a slow frame snowball: drop sim time instead of freezing the page
    if (performance.now() - t0 > 28) { acc = 0; break; }
  }
  const t1 = performance.now();
  if (steps) P.simMs = P.simMs * 0.9 + (t1 - t0) * 0.1;
  try { G.renderer.spawnFx(w); } catch (e) { AL.reportError(e, 'effects', w); }
  try { if (AL.Input) AL.Input.update(real); } catch (e) { AL.reportError(e, 'input', w); }
  try { G.renderer.draw(net ? alphaNet : acc / DT, real); } catch (e) { AL.reportError(e, 'draw', w); try { const c = G.renderer.ctx; for (let k = 0; k < 16; k++) c.restore(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; } catch (e2) { /* nothing to undo */ } }
  P.renderMs = P.renderMs * 0.9 + (performance.now() - t1) * 0.1;
  P.frameMs = P.frameMs * 0.9 + real * 1000 * 0.1;
  try { if (AL.UI && AL.UI.frame) AL.UI.frame(w, real); } catch (e) { AL.reportError(e, 'ui', w); }
  w.events.length = 0;   // events were visible to the UI for this frame; listeners got them via AL.on
}

function boot() {
  const cv = document.getElementById('cv');
  G.renderer = new AL.Renderer(cv);
  G.renderer.resize();
  window.addEventListener('resize', () => G.renderer.resize());
  if (AL.Input) AL.Input.init(G);
  if (AL.UI) AL.UI.init(G);
  const bench = +params.get('bench') || 0;
  if (bench) {
    // benchmark mode: N ants foraging, straight into the game, perf panel open
    newGame({ seed: 12345, bench, benchOnly: true });
    if (AL.UI && AL.UI.showPerf) AL.UI.showPerf(true);
  } else if (AL.Net && AL.Net.boot()) {
    // multiplayer match page (?mp=CODE): net.js reconnects and the server resumes the match
  } else if (params.has('play') || !AL.UI || !AL.UI.showTitle) {
    newGame({ seed: +params.get('seed') || undefined, species: params.get('species') || 'fire' });
  } else {
    AL.UI.showTitle();
  }
  requestAnimationFrame(frame);
  // exposed for automated checks
  root.__antlands = { G, perf: () => Object.assign({ ants: G.world ? G.world.ants.count : 0, drawn: G.renderer.stats.drawn, lod: G.world && G.world.lod }, G.perf) };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
