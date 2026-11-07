// Antlands multiplayer client: the room connection and the lockstep turn runner (browser only).
// The server (server.js, WebSocket /mp) sends numbered turns; every PC runs each turn's commands, then its sim
// steps, so all PCs keep the same world. A match always runs in a freshly loaded page (?mp=CODE): starting a match
// reloads, and the server replays the turn log, which also makes reconnecting after a refresh work.
// Every PC also keeps the whole turn log, so after a server restart the host's PC can upload it and bring the match
// back; each PC reclaims its slot with the secret the server gave it at the start (sessionStorage, never shared).
(function (root) {
'use strict';
const AL = root.AL;
const KEY = 'antlands.mp';
const HASH_EVERY = 50, ACK_EVERY = 2;   // (acks often: the server paces the match by the slowest PC's last ack)
const store = {
  get() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch (e) { /* private mode */ } },
};
const listeners = {};
const N = AL.Net = {
  ws: null, id: 0, token: null, room: null, status: 'off',
  downSince: 0,          // when the connection was lost (0: connected or not trying)
  gone: null,            // in a match page: why the match can't go on ('lost', 'ended', 'unknown'), set by the server
  hashLog: [],           // recent 'turn:hash' pairs (checks and tests)
  game: null,            // in a match: { slot, start, queue: [], cur, left, k, speed, paused, syncing, host }
  on(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
  emit(t, m) { for (const fn of listeners[t] || []) { try { fn(m); } catch (e) { if (AL.reportError) AL.reportError(e, 'net ' + t); } } },
  active() { return !!(N.game && N.game.world); },
  isHost() { return !!(N.room && N.room.host === N.id); },
};

// ---- connection ---------------------------------------------------------------------------------------------
function url() {
  const s = store.get(), tk = N.token || (s && s.token);
  // fresh: this page has no world yet (a reload): the server may send a snapshot instead of the whole log; nosnap:
  // a snapshot didn't work for this match on this PC, replay instead
  const fresh = inMatchPage() && !(N.game && N.game.world), nosnap = fresh && noSnap();
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/mp' + (tk ? '?token=' + encodeURIComponent(tk) : '') +
    (fresh ? (tk ? '&' : '?') + 'fresh=1' + (nosnap ? '&nosnap=1' : '') : '');
}
let retry = 0, wantOpen = false, queueOut = [];
N.connect = function () {
  wantOpen = true;
  if (N.ws && (N.ws.readyState === 0 || N.ws.readyState === 1)) return;
  N.status = 'connecting'; N.emit('status', N.status);
  let ws;
  try { ws = new WebSocket(url()); } catch (e) { N.status = 'error'; N.emit('status', N.status); return; }
  N.ws = ws;
  if (!N.downSince) N.downSince = Date.now();
  ws.onopen = () => { retry = 0; N.downSince = 0; N.status = 'open'; N.emit('status', N.status); const q = queueOut; queueOut = []; for (const m of q) ws.send(m); };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
  ws.onclose = () => {
    if (N.ws !== ws) return;
    N.ws = null; N.status = 'closed'; if (!N.downSince) N.downSince = Date.now(); N.emit('status', N.status);
    // in a match keep trying (a free server can take a minute to wake up or restart); elsewhere give up after a while
    if (wantOpen && (retry < 30 || inMatchPage())) { retry++; setTimeout(() => { if (wantOpen) N.connect(); }, Math.min(5000, 400 * retry)); }
  };
};
N.close = function () { wantOpen = false; N.downSince = 0; if (N.ws) { const ws = N.ws; N.ws = null; try { ws.close(); } catch (e) { /* gone */ } } N.status = 'off'; };
function raw(m) { const s = JSON.stringify(m); if (N.ws && N.ws.readyState === 1) N.ws.send(s); else { queueOut.push(s); if (!N.ws) N.connect(); } }
N.raw = raw;
// lobby actions
N.create = name => raw({ t: 'create', name });
N.join = (code, name) => raw({ t: 'join', code, name });
N.set = patch => raw(Object.assign({ t: 'set' }, patch));
N.settings = patch => raw(Object.assign({ t: 'settings' }, patch));
N.start = solo => raw({ t: 'start', solo: !!solo });
N.leave = () => { raw({ t: 'leave' }); store.set(null); N.room = null; };
N.chat = text => raw({ t: 'chat', text });
// a command for this PC's colony (cmd.js calls this in a match)
N.send = (n, a, s) => raw({ t: 'cmd', n, a, s });

// ---- messages -----------------------------------------------------------------------------------------------
function handle(m) {
  switch (m.t) {
    case 'hi': {
      const s = store.get() || {};
      N.id = m.id; N.token = m.token; store.set(Object.assign(s, { token: m.token }));
      N.emit('hi', m);
      if (m.inRoom) break;
      // the server doesn't know us in a room: it restarted (or forgot us)
      if (inMatchPage()) rejoin(s);
      else if (N.room) { N.room = null; N.emit('roomLost', {}); }
      break;
    }
    case 'rejoined': N.id = m.id; N.token = m.token; { const s = store.get() || {}; store.set(Object.assign(s, { token: m.token })); } N.emit('rejoined', m); break;
    case 'restoring': N.emit('restoring', m); break;
    case 'restoreAsk': upload(m.from | 0); break;
    case 'restoreFail': N.emit('restoreFail', m); break;
    case 'gone': N.gone = m.reason || 'lost'; N.close(); N.emit('gone', m); break;
    case 'room': N.room = m; { const s = store.get() || {}; store.set(Object.assign(s, { code: m.code })); } N.emit('room', m); break;
    case 'err': N.emit('err', m); break;
    case 'left-room': N.room = null; N.emit('room', null); break;
    case 'start':
      if (!N.game && !inMatchPage()) {
        // a match starts: reload into a clean page that runs only the match (no state left from the title or an earlier game)
        store.set({ token: N.token, code: m.code, slot: m.slot, secret: m.secret });
        wantOpen = false;
        location.href = location.pathname + '?mp=' + encodeURIComponent(m.code);
        return;
      }
      beginMatch(m);
      break;
    case 'log': if (N.game) for (const t of m.turns) push(t); break;
    case 'logEnd': if (N.game) {
      // a restored room that ends before turns this PC already ran (it got a turn nobody else kept): replay from the start
      if (N.game.lastK >= m.k) { N.close(); location.reload(); return; }
      N.game.logEnd = m.k; if (N.game.queue.length > 10) catching(true);
    } break;
    case 'turn': if (N.game) push(m); break;
    case 'speed': if (N.game) { N.game.speed = m.v; N.game.paused = !!m.paused; mirror(); N.emit('speed', m); } break;
    case 'wait': N.emit('wait', m); break;
    case 'snapAsk': if (N.game && N.game.world) N.game.snapAsk = m.id; break;
    case 'snapPart': if (N.game && N.game.snapWait) N.game.snapParts[m.i | 0] = m.d; break;
    case 'snapEnd': if (N.game && N.game.snapWait) loadSnap(m); break;
    case 'snapCancel': if (N.game && N.game.snapWait) { N.game.snapWait = false; N.game.snapParts = []; N.emit('snap', { state: 'cancel', why: m.why }); } break;
    case 'desync': if (N.game && !(N.game.desynced >= m.k)) { N.game.desynced = m.k; N.emit('desync', m); } break;   // (mp-ui.js: only the PC that drifted reloads)
    case 'left': case 'back': case 'chat': N.emit(m.t, m); break;
  }
}
// a reconnect replays the whole log: keep only turns we don't have yet (and every turn, for a restore)
function push(t) { const g = N.game; if (t.k <= g.lastK) return; g.lastK = t.k; g.queue.push(t); g.log.push(t); }   // (a snapshot joiner's log starts at g.logBase)
const inMatchPage = () => new URLSearchParams(location.search).has('mp');
const pageCode = () => (new URLSearchParams(location.search).get('mp') || '').toUpperCase();

// ---- after a server restart --------------------------------------------------------------------------------
// ask for our slot back by its secret; say how far we got and whether we hold the whole log (the host's PC uploads it)
function rejoin(s) {
  if (s.secret == null || s.slot == null || (s.code && s.code !== pageCode())) { N.gone = 'unknown'; N.close(); N.emit('gone', { reason: 'unknown' }); return; }
  const g = N.game, has = !!(g && g.world && !g.logBase && g.log.length === g.lastK + 1);
  raw({ t: 'rejoin', code: pageCode(), slot: s.slot, secret: s.secret, k: g ? g.lastK : -1, has, host: !!(g && g.start && g.slot === g.start.hostSlot) });
}
// the server lost the room and asks this PC for it: the start message (from turn 0) and the turns from `from` on,
// in chunks under the server's message size limit
function upload(from) {
  const g = N.game; if (!g || !g.world) return;
  if (!from) {
    const s = g.start;
    raw({ t: 'restore', speed: g.speed, paused: g.paused,
      start: { t: 'start', code: s.code, seed: s.seed, colonies: s.colonies, aiLevel: s.aiLevel, biome: s.biome, mapSize: s.mapSize, hostSlot: s.hostSlot, locks: s.locks, mp: s.mp, sig: s.sig } });
  }
  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null, LIMIT = 48000;
  let part = [], bytes = 0;
  for (let k = from; k < g.log.length; k++) {
    const t = g.log[k], s = JSON.stringify(t), b = enc ? enc.encode(s).length : s.length * 3;
    if (part.length && bytes + b > LIMIT) { raw({ t: 'restoreLog', turns: part }); part = []; bytes = 0; }
    part.push(t); bytes += b + 1;
  }
  if (part.length) raw({ t: 'restoreLog', turns: part });
  raw({ t: 'restoreEnd', k: g.log.length });
}

// ---- the match ---------------------------------------------------------------------------------------------
function beginMatch(m) {
  const G = AL.Game;
  if (m.secret) { const s = store.get() || {}; store.set(Object.assign(s, { code: m.code, slot: m.slot, secret: m.secret })); }
  if (N.game && N.game.world) {
    // already running: a reconnect after a short drop or a restore (push() skips the turns we have)
    const g = N.game;
    if (m.seed !== g.start.seed || (m.slot | 0) !== g.slot) { N.gone = 'unknown'; N.close(); N.emit('gone', { reason: 'unknown' }); return; }
    g.speed = m.speed || g.speed; g.paused = !!m.paused; mirror();
    raw({ t: 'loaded', k: g.k, catching: !!g.catching });
    if (typeof document !== 'undefined') raw({ t: 'away', on: !!document.hidden });   // (and not away any more after a reload)
    return;
  }
  const slot = m.slot | 0;
  const opts = { seed: m.seed, species: m.mp.species[slot], perk: m.mp.perks[slot], colonies: m.colonies, aiLevel: m.aiLevel, biome: m.biome || 'backyard', mapSize: m.mapSize || 'medium', rivalNests: true,
    mp: { humans: m.mp.humans, me: slot, species: m.mp.species, names: m.mp.names, perks: m.mp.perks, hats: m.mp.hats } };
  N.game = { slot, start: m, queue: [], log: [], cur: null, left: 0, k: -1, lastK: -1, speed: m.speed || 1, paused: !!m.paused, syncing: !!m.resume, catching: !!m.resume, acc: 0, world: null,
    snapWait: !!m.snap, snapParts: [], snapAsk: 0, logBase: 0 };
  if (G.scene && G.scene.end) G.scene.end(G);
  G.scene = null;
  const w = G.newGame(opts);
  N.game.world = w;
  G.speed = N.game.speed; G.paused = N.game.paused; mirror();
  raw({ t: 'loaded', k: -1, catching: N.game.catching });
  if (typeof document !== 'undefined') raw({ t: 'away', on: !!document.hidden });   // (and not away any more after a reload)
  startClock();
  N.emit('match', { world: w, start: m });
  if (m.snap) N.emit('snap', { state: 'wait', by: m.by });
}

// ---- snapshot joins (snap.js) ----------------------------------------------------------------------------
const NOSNAP = 'antlands.nosnap';
function noSnap() { try { return sessionStorage.getItem(NOSNAP) === pageCode(); } catch (e) { return false; } }
function b64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function zip(u8, how) {
  const S = how === 'gzip' ? (typeof CompressionStream !== 'undefined' && CompressionStream) : (typeof DecompressionStream !== 'undefined' && DecompressionStream);
  if (!S || typeof Blob === 'undefined' || typeof Response === 'undefined') return Promise.resolve(null);
  return new Response(new Blob([u8]).stream().pipeThrough(new S('gzip'))).arrayBuffer().then(b => new Uint8Array(b));
}
// another PC is joining: our world as it stands right after turn k, compressed, in parts through the server
function sendSnap(w, id, k) {
  let bytes, h;
  try { bytes = AL.Snap.pack(AL.Snap.take(w)); h = N.hash(w); }
  catch (e) { raw({ t: 'snapFail', id }); if (AL.reportError) AL.reportError(e, 'snapshot', w); return; }
  zip(bytes, 'gzip').then(z => {
    if (!z) { raw({ t: 'snapFail', id }); return; }   // (no compression in this browser: far too big to send)
    const s = b64(z), CH = 48000, n = Math.ceil(s.length / CH);
    for (let i = 0; i < n; i++) raw({ t: 'snapPart', id, i, d: s.slice(i * CH, (i + 1) * CH) });
    raw({ t: 'snapEnd', id, k, h, n, z: true });
  }, () => raw({ t: 'snapFail', id }));
}
// our snapshot arrived: load it into our fresh world, check it, and play on from turn k
function loadSnap(m) {
  const g = N.game, parts = g.snapParts; g.snapParts = [];
  const fail = why => {
    try { sessionStorage.setItem(NOSNAP, pageCode()); } catch (e) { /* private mode */ }
    N.emit('snap', { state: 'failed', why });
    raw({ t: 'snapBad' });
    setTimeout(() => location.reload(), 300);   // a clean page that replays the log instead
  };
  let u8;
  try { for (let i = 0; i < m.n; i++) if (typeof parts[i] !== 'string') throw new Error('missing part ' + i); u8 = unb64(parts.join('')); }
  catch (e) { fail(e.message); return; }
  (m.z ? zip(u8, 'gunzip') : Promise.resolve(u8)).then(raw8 => {
    if (!raw8) throw new Error('no decompression');
    const w = g.world;
    AL.Snap.restore(w, AL.Snap.unpack(raw8), g.slot);
    if ((N.hash(w) >>> 0) !== (m.h >>> 0)) throw new Error('hash');
    // the queue so far holds the turns after k (the server sent them after the snapshot); g.log holds only those
    g.k = m.k; g.lastK = Math.max(g.lastK, m.k); g.logBase = m.k + 1; g.cur = null; g.left = 0;
    g.queue = g.queue.filter(t => t.k > m.k); g.log = g.log.filter(t => t.k > m.k);
    g.snapWait = false;
    const G = AL.Game; if (G && G.renderer && G.world === w) G.renderer.setWorld(w);
    if (AL.UI && AL.UI.onNewGame) { try { AL.UI.onNewGame(w, w.opts); } catch (e) { /* the HUD catches up next frame */ } }
    N.emit('snap', { state: 'loaded', k: m.k, by: m.by });
  }).catch(e => fail(e && e.message));
}
// catching up after a reload or rejoin: the server keeps the match going for the others meanwhile (it doesn't wait
// for this PC), and this PC drops back into the live match once it has replayed the log
function catching(on) {
  const g = N.game; if (!g) return;
  if (on) g.syncing = true;
  if (!!g.catching === on) return;
  g.catching = on; raw({ t: 'catchup', on });
}
// keep the speed buttons showing the match speed; a host's own clicks become requests to the server
let seenSpeed = 1, seenPaused = false;
function mirror() { const G = AL.Game, g = N.game; if (!g) return; G.speed = seenSpeed = g.speed; G.paused = seenPaused = g.paused; if (AL.UI && AL.UI.syncSpeed) AL.UI.syncSpeed(); }
function watchSpeed() {
  const G = AL.Game, g = N.game;
  if (G.speed === seenSpeed && G.paused === seenPaused) return;
  if (N.isHost() || (N.room == null && g.slot === 0)) {
    if (G.speed !== seenSpeed) raw({ t: 'speed', v: G.speed });
    if (G.paused !== seenPaused) raw({ t: 'pause', on: G.paused });
  } else if (G.speed !== seenSpeed || (G.paused && !seenPaused)) N.emit('notHost', {});
  G.speed = seenSpeed; G.paused = seenPaused;
}

// world hash: positions, health, states of every ant, the RNG, stocks, food (enough to notice any divergence)
function h32(h, v) { return Math.imul(h ^ v, 16777619) >>> 0; }
N.hash = function (w) {
  const A = w.ants, n = A.high; let h = 2166136261;
  const fx = new Uint32Array(A.x.buffer, A.x.byteOffset, n), fy = new Uint32Array(A.y.buffer, A.y.byteOffset, n), fh = new Uint32Array(A.hp.buffer, A.hp.byteOffset, n);
  for (let i = 0; i < n; i++) { h = h32(h, fx[i]); h = h32(h, fy[i]); h = h32(h, fh[i]); h = h32(h, A.state[i] | (A.col[i] << 8) | (A.caste[i] << 16)); }
  h = h32(h, w.R.state()); h = h32(h, w.tick);
  for (const c of w.colonies) { h = h32(h, Math.round(c.stock.sugar * 1000)); h = h32(h, Math.round(c.stock.protein * 1000)); h = h32(h, c.alive ? 1 : 0); }
  for (const f of w.surface.foods) h = h32(h, Math.round((f.amount || 0) * 100));
  return h >>> 0;
};

// one sim step of the queued turns (a turn's commands run before its first step). false: nothing to run.
function stepOne(w) {
  const g = N.game;
  while (!g.left) {
    if (g.cur) turnDone(w, g.cur);
    const t = g.queue.shift(); g.cur = t || null;
    if (!t) return false;
    if (t.c && t.c.length) AL.Cmd.runTurn(w, t.c);
    g.left = t.n;
    if (!t.n) { turnDone(w, t); g.cur = null; }
  }
  AL.Sim.step(w);
  g.left--;
  if (!g.left) { turnDone(w, g.cur); g.cur = null; }
  return true;
}
function turnDone(w, t) {
  const g = N.game; if (!t || t.k <= g.k) return;
  g.k = t.k;
  if (g.snapAsk && !g.syncing) { const id = g.snapAsk; g.snapAsk = 0; sendSnap(w, id, t.k); }   // another PC joins: right after this turn
  if (t.k % HASH_EVERY === 0) { const h = N.hash(w); raw({ t: 'ack', k: t.k, h }); N.hashLog.push(t.k + ':' + h.toString(16)); if (N.hashLog.length > 200) N.hashLog.shift(); }
  else if (t.k % ACK_EVERY === 0) raw({ t: 'ack', k: t.k });
}
const SYNC_MS = 120;
// main.js calls this every frame in a match instead of its own fixed-step loop. Returns the interpolation alpha.
N.frame = function (G, real) {
  const g = N.game, w = g.world;
  watchSpeed();
  if (g.snapWait) { N.emit('progress', { left: 1, k: g.k, end: g.logEnd || 0, snap: true }); return 1; }   // (the snapshot is on its way)
  const queued = g.queue.reduce((s, t) => s + t.n, 0) + g.left;
  const per = Math.max(1, g.speed * 3);   // steps the server sends per 100 ms turn at this speed
  const t0 = performance.now();
  // 4 s or more behind (the tab was hidden or the phone locked, and the browser slowed it down): catch up flat out,
  // and tell the server so the others play on meanwhile instead of waiting
  if (!g.syncing && queued > per * 40) catching(true);
  if (g.syncing) {
    // catching up (joined late or reloaded): run flat out, ~120 ms a frame with nothing drawn (main.js), until the
    // log is done
    while (performance.now() - t0 < SYNC_MS) if (!stepOne(w)) break;
    if (queued <= per * 2) { g.syncing = false; g.acc = 0; catching(false); }
    N.emit('progress', { left: queued, k: g.k, end: g.logEnd || 0 });
    return 1;
  }
  // real-time pace, plus a little extra when turns pile up (network bursts), never more than ~28 ms of work
  g.acc += real * 30 * (g.paused ? 0 : g.speed);
  if (queued > per * 2) g.acc += (queued - per) * 0.2;
  let steps = 0;
  while (g.acc >= 1) {
    if (!stepOne(w)) { g.acc = Math.min(g.acc, 1); break; }
    g.acc -= 1; steps++;
    if (performance.now() - t0 > (queued > per * 4 ? 40 : 28)) { g.acc = Math.min(g.acc, 1); break; }   // (a little more time when behind)
  }
  // turns with no steps (commands while paused) still apply right away
  if (!steps && g.queue.length && g.queue[0].n === 0) stepOne(w);
  if (steps) { const P = G.perf; P.simMs = P.simMs * 0.9 + (performance.now() - t0) * 0.1; }
  return Math.min(1, g.acc);
};
N.inMatchPage = inMatchPage;
// a hidden tab gets no animation frames and its own timers slow to once a second (or a minute): a tiny worker's
// timer doesn't, so it keeps this PC's match running in real time, nothing drawn, and nobody has to wait for it or
// catch it up. (The server is told anyway: a browser may still freeze a hidden tab outright.)
let clock = null, clockLast = 0;
function startClock() {
  if (clock || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return;
  try {
    clock = new Worker(URL.createObjectURL(new Blob(['setInterval(function () { postMessage(0); }, 40);'], { type: 'text/javascript' })));
    clock.onmessage = () => {
      const now = performance.now(), real = clockLast ? Math.min(0.25, (now - clockLast) / 1000) : 0.04; clockLast = now;
      const g = N.game; if (!g || !g.world || !document.hidden) return;
      try { N.frame(AL.Game, real); } catch (e) { if (AL.reportError) AL.reportError(e, 'multiplayer turn (hidden tab)', g.world); }
    };
  } catch (e) { clock = null; }
}
N.hiddenClock = () => !!clock;
// a hidden tab: tell the server (it stops waiting for us); keep up on the worker clock, or on a slowed timer as far
// as the browser lets us without one; back in view we catch up flat out if we fell behind anyway
if (typeof document !== 'undefined') {
  // leaving the page (a reload, a closed tab): nobody should wait for us while the socket closes
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (N.game && N.ws && N.ws.readyState === 1) { try { N.ws.send(JSON.stringify({ t: 'away', on: true })); } catch (e) { /* closing */ } } });
  document.addEventListener('visibilitychange', () => {
    const g = N.game; if (!g) return;
    // back in view and behind: say we're catching up before we stop being away, so nobody waits for us meanwhile
    if (!document.hidden && g.world) { const queued = g.queue.reduce((s, t) => s + t.n, 0) + g.left; if (queued > Math.max(1, g.speed * 3) * 2) catching(true); }
    raw({ t: 'away', on: document.hidden });
  });
  setInterval(() => {
    const g = N.game; if (!g || !g.world || !document.hidden || clock) return;
    const t0 = performance.now(); while (performance.now() - t0 < 60) if (!stepOne(g.world)) break;
  }, 250);
}
N.leaveMatch = function () {
  N.leave(); N.close(); N.game = null;
  location.href = location.pathname;
};
// boot: a page opened as ?mp=CODE reconnects with the stored token and the server resumes the match
N.boot = function () {
  if (!inMatchPage()) return false;
  const s = store.get();
  if (!s || !s.token) { location.href = location.pathname; return true; }
  N.token = s.token;
  N.connect();
  N.emit('booting', {});
  return true;
};
})(window);
