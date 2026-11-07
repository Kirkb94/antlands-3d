'use strict';
// Antlands server: serves the game from public/ (static files, no caching, a /healthz check for hosting)
// and runs multiplayer rooms over a WebSocket at /mp.
//
// Multiplayer is lockstep: every PC runs the same simulation from the same seed. The server never simulates;
// it collects each player's commands and sends out numbered turns (every 100 ms: how many sim steps to run and
// the commands to apply first). It keeps the whole turn log, so a PC that reloads or reconnects replays the
// match from the start and catches up. PCs report a hash of their world now and then; a mismatch is a desync.
// Rooms live only in memory; when the server restarts, the host's PC can bring its match back (see "surviving a
// server restart" below), and PCs whose match is gone are told so ({t:'gone'}).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +(process.env.PORT || 3000), PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  const rel = path.normalize(url === '/' ? '/index.html' : url).replace(/^(\.\.[\/\\])+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(buf);
  });
});

// ---- a small WebSocket server (RFC 6455 text frames; no dependencies) --------------------------------------
const MAX_MSG = 64 * 1024;
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = { socket, open: true, onmessage: null, onclose: null, buf: Buffer.alloc(0), frags: [] };
  ws.send = text => {
    if (!ws.open) return;
    const data = Buffer.from(text), n = data.length;
    const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
    try { socket.write(Buffer.concat([head, data])); } catch (e) { close(); }
  };
  const close = () => { if (!ws.open) return; ws.open = false; try { socket.end(Buffer.from([0x88, 0])); } catch (e) { /* gone */ } socket.destroy(); if (ws.onclose) ws.onclose(); };
  ws.close = close;
  socket.on('data', chunk => {
    ws.buf = Buffer.concat([ws.buf, chunk]);
    if (ws.buf.length > MAX_MSG * 4) { close(); return; }
    for (;;) {
      const b = ws.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 15, masked = b[1] & 0x80;
      let len = b[1] & 127, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(6); off = 10; }
      if (!masked || len > MAX_MSG) { close(); return; }   // clients must mask; no huge messages
      if (b.length < off + 4 + len) return;
      const mask = b.slice(off, off + 4), data = Buffer.from(b.slice(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      ws.buf = b.slice(off + 4 + len);
      if (op === 8) { close(); return; }
      if (op === 9) { try { socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch (e) { /* gone */ } continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        ws.frags.push(data);
        if (fin) { const msg = Buffer.concat(ws.frags).toString('utf8'); ws.frags = []; if (msg.length <= MAX_MSG && ws.onmessage) ws.onmessage(msg); }
      }
    }
  });
  socket.on('close', close); socket.on('error', close); socket.on('end', close);
  return ws;
}

// ---- rooms ----------------------------------------------------------------------------------------------
const TURN_MS = 100, STEPS_1X = 3;            // 100 ms of game at 1x = 3 sim steps of 1/30 s
const MAX_PLAYERS = 4, MAX_COLONIES = 8, LAG_TURNS = 30, HASH_EVERY = 50;
// pacing: a PC more than SOFT_LAG turns behind slows the turns down smoothly (down to MIN_PACE of real time as it nears
// LAG_TURNS) so it can keep up, instead of everyone stopping dead and waiting for it at LAG_TURNS
const SOFT_LAG = 6, MIN_PACE = 0.1;
// snapshot joins: a PC that opens the match fresh (a reload, another device) once it has run SNAP_MIN turns gets a
// snapshot of the world from another PC instead of the whole log to replay (public/snap.js), plus the turns since;
// if none comes within SNAP_WAIT it gets the log after all
const SNAP_MIN = +process.env.MP_SNAP_MIN || 300, SNAP_WAIT = +process.env.MP_SNAP_WAIT || 20000, SNAP_MAX = 8e6;
const SPEEDS = [1, 2, 4], STEP_COUNTS = [0].concat(SPEEDS.map(v => v * STEPS_1X));
const MAX_ARGS = 1024, MAX_TURN_CMDS = 400, MAX_TURN_BYTES = 16 * 1024;   // one command's args, one turn's commands
const rooms = new Map(), byToken = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SPECIES = ['fire', 'leafcutter', 'carpenter', 'army', 'honeypot', 'harvester', 'slavemaker', 'bullet'];
const PLAYABLE = ['fire', 'carpenter', 'bullet'];   // the lobby offers only these for now (public/data.js AL.PLAYABLE); saved starts may hold any
const LEVELS = ['easy', 'normal', 'hard'];
const BIOMES = ['backyard', 'forest', 'desert', 'wetland'], SIZES = ['small', 'medium', 'large'];   // public/terrain.js
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"]/g, '').trim().slice(0, n);
function newCode() { for (;;) { let c = ''; for (let k = 0; k < 4; k++) c += LETTERS[crypto.randomInt(LETTERS.length)]; if (!rooms.has(c) && !pending.has(c) && !ended.has(c)) return c; } }
const send = (p, m) => { if (p.ws && p.ws.open) p.ws.send(JSON.stringify(m)); };
const each = (room, m) => { const s = JSON.stringify(m), turn = m.t === 'turn'; for (const p of room.players) if (p.ws && p.ws.open && !(turn && p.snapWait)) p.ws.send(s); };   // (a PC waiting for a snapshot gets its turns from the log after it)
function roomView(room, p) {
  return { t: 'room', code: room.code, you: p.id, host: room.host, state: room.state, settings: room.settings,
    players: room.players.map(q => ({ id: q.id, name: q.name, species: q.species, perk: q.perk, ready: q.ready, slot: q.slot, online: !!(q.ws && q.ws.open) })) };
}
const syncRoom = room => { for (const p of room.players) send(p, roomView(room, p)); };

// ---- surviving a server restart ------------------------------------------------------------------------------
// Rooms live only in memory, and a free host restarts the server now and then (deploys, sleeping, crashes). Every
// PC in a match keeps the start message and the whole turn log anyway, so the match can come back:
//  - at the start each player gets a secret for their slot (kept in their own sessionStorage); the start message
//    carries only hashes of the secrets ("locks"), plus a signature when MP_KEY is set (the same key survives restarts)
//  - a PC whose room the server doesn't know sends {t:'rejoin', code, slot, secret, k}. The server asks the host's
//    PC to upload its start message and turn log ({t:'restore'}, {t:'restoreLog'} chunks, {t:'restoreEnd'}), checks
//    it (limits, sane values, signature, the host's own secret) and rebuilds the room; a PC that got a turn or two the
//    host missed adds them. Then everyone gets their slot back by their secret and the turns go on from the log's end.
//  - if no host shows up within MP_RESTORE_WAIT (30 s) the waiting PCs hear {t:'gone', reason:'lost'}.
// A restore never replaces a room the server knows.
const KEY = process.env.MP_KEY ? String(process.env.MP_KEY) : null;
const RESTORE_WAIT = +process.env.MP_RESTORE_WAIT || 30000;   // ms for the host's PC to come back after the first PC asks
const OFFER_WAIT = 3000;                                        // ms to hear from every PC before the room is rebuilt
const MAX_LOG = 300000;                                         // turns (over 8 hours at 1x)
const MAX_RESTORE_BYTES = +process.env.MP_MAX_RESTORE || 32 * 1024 * 1024;
const MAX_TAIL = 100, MAX_PENDING = 100;
const pending = new Map();   // room code -> a match PCs are asking for that this server doesn't know (yet)
const ended = new Map();     // room code -> { reason, t }: matches that are over, so a late PC hears why
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function same(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const lockOk = (lock, secret) => typeof lock === 'string' && typeof secret === 'string' && secret.length >= 16 && secret.length <= 64 && same(lock, sha(secret));
const signKey = KEY || crypto.randomBytes(32).toString('hex');
// (the map goes in only when it isn't the default backyard, so a start signed before biomes existed still checks out)
const sign = s => crypto.createHmac('sha256', signKey).update(JSON.stringify([s.code, s.seed, s.colonies, s.aiLevel, s.hostSlot, s.locks, s.mp.humans, s.mp.species, s.mp.names, s.mp.perks].concat((s.biome || 'backyard') === 'backyard' && (s.mapSize || 'medium') === 'medium' ? [] : [s.biome, s.mapSize]))).digest('hex');
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const argBytes = a => { try { return Buffer.byteLength(JSON.stringify(a)); } catch (e) { return Infinity; } };

// an uploaded start message: rebuilt from checked fields only (null if anything is off)
function checkStart(s, code) {
  if (!plain(s) || !plain(s.mp) || s.code !== code) return null;
  const mp = s.mp, h = mp.humans;
  if (!Number.isInteger(s.seed) || s.seed < 1 || s.seed >= 2 ** 31 - 1) return null;
  if (!Number.isInteger(h) || h < 1 || h > MAX_PLAYERS || !Number.isInteger(s.colonies) || s.colonies < h || s.colonies > MAX_COLONIES) return null;
  if (!LEVELS.includes(s.aiLevel) || !Number.isInteger(s.hostSlot) || s.hostSlot < 0 || s.hostSlot >= h) return null;
  const biome = s.biome == null ? 'backyard' : s.biome, mapSize = s.mapSize == null ? 'medium' : s.mapSize;
  if (!BIOMES.includes(biome) || !SIZES.includes(mapSize)) return null;
  const list = (a, ok) => Array.isArray(a) && a.length === h && a.every(ok);
  if (!list(mp.species, x => SPECIES.includes(x))) return null;
  if (!list(mp.names, x => typeof x === 'string' && x.length > 0 && clean(x, 16) === x)) return null;
  if (!list(mp.perks, x => typeof x === 'string' && x.length > 0 && clean(x, 24) === x)) return null;
  if (!list(s.locks, x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) || new Set(s.locks).size !== h) return null;
  const out = { t: 'start', code, seed: s.seed, colonies: s.colonies, aiLevel: s.aiLevel, biome, mapSize, hostSlot: s.hostSlot, locks: s.locks.slice(),
    mp: { humans: h, species: mp.species.slice(), names: mp.names.slice(), perks: mp.perks.slice() } };
  out.sig = sign(out);
  if (KEY && !(typeof s.sig === 'string' && same(s.sig, out.sig))) return null;   // with a fixed key only a start this server signed
  return out;
}
// an uploaded turn: must be turn k, a step count the server sends, and commands it would have accepted
function checkTurn(t, k, humans) {
  if (!plain(t) || t.k !== k || !STEP_COUNTS.includes(t.n) || !Array.isArray(t.c) || t.c.length > MAX_TURN_CMDS) return null;
  const c = []; let bytes = 0;
  for (const x of t.c) {
    if (!plain(x) || !Number.isInteger(x.col) || x.col < 0 || x.col >= humans || typeof x.n !== 'string' || !x.n || clean(x.n, 24) !== x.n) return null;
    if (!plain(x.a) || !Number.isInteger(x.s)) return null;
    const b = argBytes(x.a); if (b > MAX_ARGS) return null;
    bytes += b + 40; if (bytes > MAX_TURN_BYTES) return null;
    c.push({ col: x.col, n: x.n, a: x.a, s: x.s });
  }
  return { t: 'turn', k, n: t.n, c };
}

function rejoin(p, m) {
  if (p.room || p.pend) return;
  const code = clean(m.code, 4).toUpperCase(), slot = m.slot, secret = typeof m.secret === 'string' ? m.secret : '';
  const k = Number.isInteger(m.k) ? Math.max(-1, Math.min(MAX_LOG, m.k)) : -1, has = !!m.has;
  const room = rooms.get(code);
  if (room) {
    // the server knows this room (this PC just lost its token): take the slot back by its secret
    const q = room.state === 'game' && room.players.find(x => x.slot === slot);
    if (!q || !lockOk(q.lock, secret)) return send(p, { t: 'gone', reason: 'unknown' });
    return claim(p, q, has ? k : -1);
  }
  const e = ended.get(code);
  if (e) return send(p, { t: 'gone', reason: e.reason });
  if (!/^[A-Z]{4}$/.test(code) || !Number.isInteger(slot) || slot < 0 || slot >= MAX_PLAYERS || secret.length < 16 || secret.length > 64) return send(p, { t: 'gone', reason: 'unknown' });
  let pd = pending.get(code);
  if (!pd) {
    if (pending.size >= MAX_PENDING) return send(p, { t: 'gone', reason: 'lost' });
    pd = { code, t0: Date.now(), waiters: new Set(), tried: new Set(), up: null, start: null, log: null, speed: 1, paused: false };
    pd.timer = setInterval(() => pendTick(pd), 250); pd.timer.unref();
    pending.set(code, pd);
  }
  if (pd.waiters.size >= MAX_PLAYERS * 2) return send(p, { t: 'gone', reason: 'unknown' });
  p.pend = pd; p.rj = { slot, secret, k, has, host: !!m.host };
  pd.waiters.add(p);
  send(p, { t: 'restoring' });
  pendTick(pd);
}
function pendTick(pd) {
  if (pending.get(pd.code) !== pd) { clearInterval(pd.timer); return; }
  const now = Date.now();
  if (pd.up) { if (now - pd.up.t0 > RESTORE_WAIT) { send(pd.up.p, { t: 'restoreFail', why: 'slow' }); pd.up = null; } else return; }
  if (!pd.start) {
    // first the host's PC (the one with the longest log, if more than one says so) uploads the start and the log
    const cands = [...pd.waiters].filter(q => q.rj.has && q.rj.host && !pd.tried.has(q)).sort((a, b) => b.rj.k - a.rj.k);
    if (cands.length) return ask(pd, cands[0], 0);
    if (now - pd.t0 > RESTORE_WAIT) return failPending(pd, 'lost');
    return;
  }
  if (now - pd.t0 < OFFER_WAIT) return;
  // a PC that got turns the host missed (sent just before the restart) adds them, so nobody is ahead of the room
  const K = pd.log.length;
  const ahead = [...pd.waiters].filter(q => q.rj.has && q.rj.k >= K && q.rj.k < K + MAX_TAIL && !pd.tried.has(q) && lockOk(pd.start.locks[q.rj.slot], q.rj.secret)).sort((a, b) => b.rj.k - a.rj.k);
  if (ahead.length) return ask(pd, ahead[0], K);
  finishRestore(pd);
}
function ask(pd, q, from) {
  pd.tried.add(q);
  pd.up = { p: q, from, t0: Date.now(), turns: [], bytes: 0, start: null, speed: 1, paused: false };
  send(q, { t: 'restoreAsk', from });
}
function failPending(pd, reason) {
  clearInterval(pd.timer); pending.delete(pd.code);
  ended.set(pd.code, { reason, t: Date.now() });
  for (const q of pd.waiters) { q.pend = null; send(q, { t: 'gone', reason }); }
  pd.waiters.clear();
}
// the upload messages from the PC that was asked
function restoreMsg(p, m) {
  const pd = p.pend, up = pd && pd.up;
  if (!up || up.p !== p) return;
  const bad = why => { pd.up = null; send(p, { t: 'restoreFail', why }); pendTick(pd); };
  up.bytes += m._bytes;
  if (up.bytes > MAX_RESTORE_BYTES) return bad('too big');
  if (m.t === 'restore') {
    if (up.from !== 0 || up.start) return bad('order');
    const s = checkStart(m.start, pd.code);
    if (!s) return bad('start');
    if (s.hostSlot !== p.rj.slot || !lockOk(s.locks[p.rj.slot], p.rj.secret)) return bad('not host');
    up.start = s; up.speed = SPEEDS.includes(m.speed) ? m.speed : 1; up.paused = !!m.paused;
    return;
  }
  const start = up.from === 0 ? up.start : pd.start;
  if (!start) return bad('order');
  if (m.t === 'restoreLog') {
    if (!Array.isArray(m.turns)) return bad('log');
    for (const t of m.turns) {
      const k = up.from + up.turns.length;
      if (k >= MAX_LOG || (up.from > 0 && up.turns.length >= MAX_TAIL)) return bad('too long');
      const c = checkTurn(t, k, start.mp.humans);
      if (!c) return bad('turn ' + k);
      up.turns.push(c);
    }
    return;
  }
  if (m.t === 'restoreEnd') {
    if (m.k !== up.from + up.turns.length) return bad('count');
    if (up.from === 0) { pd.start = up.start; pd.log = up.turns; pd.speed = up.speed; pd.paused = up.paused; }
    else for (const t of up.turns) pd.log.push(t);
    pd.up = null;
    return pendTick(pd);
  }
}
function finishRestore(pd) {
  clearInterval(pd.timer); pending.delete(pd.code);
  if (rooms.has(pd.code)) { for (const q of pd.waiters) { q.pend = null; send(q, { t: 'gone', reason: 'unknown' }); } return; }   // never replace a live room
  const s = pd.start, now = Date.now();
  const room = { code: pd.code, host: 0, players: [], state: 'game', settings: { ai: s.colonies - s.mp.humans, aiLevel: s.aiLevel, biome: s.biome, mapSize: s.mapSize }, created: now,
    turn: pd.log.length, speed: pd.speed, paused: pd.paused, cmds: [], cmdBytes: 0, log: pd.log, hashes: new Map(), timer: null, start: s, waitT: 0, loadBy: 0, restored: true };
  for (let k = 0; k < s.mp.humans; k++) {
    const q = { id: nextId++, token: crypto.randomBytes(12).toString('hex'), ws: null, room, rateT: 0, rateN: 0,
      name: s.mp.names[k], species: s.mp.species[k], perk: s.mp.perks[k], ready: true, slot: k, lock: s.locks[k], secret: null,
      gone: true, inMatch: true, loaded: false, acked: -1, restored: true };
    room.players.push(q); byToken.set(q.token, q);
  }
  room.host = room.players[s.hostSlot].id;
  rooms.set(room.code, room);
  room.timer = setInterval(() => tick(room), TURN_MS); room.timer.unref();
  console.log('room ' + room.code + ' restored at turn ' + room.turn);
  // the host first (it already has everything), then the others
  const ws = [...pd.waiters].sort((a, b) => (b.rj.host ? 1 : 0) - (a.rj.host ? 1 : 0));
  for (const w of ws) {
    w.pend = null;
    const q = room.players.find(x => x.slot === w.rj.slot);
    if (!q || (q.ws && q.ws.open) || !lockOk(q.lock, w.rj.secret)) { send(w, { t: 'gone', reason: 'unknown' }); continue; }
    claim(w, q, w.rj.has ? w.rj.k : -1);
  }
}
// a connection takes over a player of a match (its slot proven by the secret); `restored`: the first time since a restore
function claim(tmp, q, k) {
  const ws = tmp.ws;
  tmp.ws = null; tmp.pend = null; byToken.delete(tmp.token);
  if (!ws || !ws.open) return;
  bind(q, ws);
  q.acked = Math.max(q.acked, Math.min(k, q.room.turn - 1));
  send(q, { t: 'rejoined', id: q.id, token: q.token, restored: !!q.restored });
  q.restored = false;
  resume(q, k);
}

function createRoom(p, name) {
  const room = { code: newCode(), host: p.id, players: [], state: 'lobby', settings: { ai: 0, aiLevel: 'normal', biome: 'backyard', mapSize: 'medium' }, created: Date.now(),
    turn: 0, speed: 1, paused: false, cmds: [], cmdBytes: 0, log: [], hashes: new Map(), timer: null, start: null, waitT: 0 };
  rooms.set(room.code, room);
  joinRoom(p, room, name);
  return room;
}
function joinRoom(p, room, name) {
  if (room.state !== 'lobby') return send(p, { t: 'err', msg: 'That match has already started.' });
  if (room.players.length >= MAX_PLAYERS) return send(p, { t: 'err', msg: 'That room is full (4 players).' });
  leaveRoom(p);
  p.room = room; p.name = clean(name, 16) || 'Player ' + (room.players.length + 1);
  p.species = PLAYABLE.includes(p.species) ? p.species : PLAYABLE[room.players.length % PLAYABLE.length]; p.perk = p.perk || 'random'; p.ready = false; p.slot = -1;
  room.players.push(p);
  syncRoom(room);
}
function leaveRoom(p) {
  const room = p.room; if (!room) return;
  p.room = null;
  if (room.state === 'lobby') {
    room.players = room.players.filter(q => q !== p);
    if (room.host === p.id && room.players.length) room.host = room.players[0].id;
    if (!room.players.length) dropRoom(room); else syncRoom(room);
  } else {
    p.gone = true;   // in a match: the colony stays (idle); the player can come back with the same token
    each(room, { t: 'left', slot: p.slot, name: p.name });
    if (room.players.every(q => q.gone || !(q.ws && q.ws.open))) dropRoomSoon(room);
  }
}
function dropRoom(room) {
  if (room.timer) clearInterval(room.timer); room.timer = null;
  if (rooms.get(room.code) === room) rooms.delete(room.code);
  if (room.state === 'game') ended.set(room.code, { reason: 'ended', t: Date.now() });
  for (const p of room.players) byToken.delete(p.token);
}
function dropRoomSoon(room) { setTimeout(() => { if (rooms.get(room.code) === room && room.players.every(q => q.gone || !(q.ws && q.ws.open))) dropRoom(room); }, 5 * 60 * 1000).unref(); }

function startMatch(room) {
  const humans = room.players.slice(0, MAX_PLAYERS);
  const secrets = humans.map(() => crypto.randomBytes(16).toString('hex'));
  humans.forEach((p, k) => { p.slot = k; p.acked = -1; p.loaded = false; p.secret = secrets[k]; p.lock = sha(secrets[k]); });
  const ai = Math.max(0, Math.min(MAX_COLONIES - humans.length, room.settings.ai | 0));
  room.state = 'game';
  room.start = {
    t: 'start', code: room.code, seed: crypto.randomInt(1, 2 ** 31 - 1),
    colonies: humans.length + ai, aiLevel: room.settings.aiLevel, biome: room.settings.biome || 'backyard', mapSize: room.settings.mapSize || 'medium',
    hostSlot: Math.max(0, humans.findIndex(p => p.id === room.host)), locks: humans.map(p => p.lock),
    mp: { humans: humans.length, species: humans.map(p => p.species), names: humans.map(p => p.name), perks: humans.map(p => p.perk) },
  };
  room.start.sig = sign(room.start);
  room.turn = 0; room.log = []; room.cmds = []; room.cmdBytes = 0; room.speed = 1; room.paused = false;
  for (const p of humans) send(p, Object.assign({ slot: p.slot, secret: p.secret }, room.start));
  // turns start once every PC has loaded the match (or after 20 s, without the stragglers)
  room.loadBy = Date.now() + 20000;
  room.timer = setInterval(() => tick(room), TURN_MS); room.timer.unref();
}
function tick(room) {
  if (room.snap) { const sn = room.snap; if (!(sn.to.ws && sn.to.ws.open)) { room.snap = null; sn.to.snapWait = 0; } else if (Date.now() - sn.t0 > SNAP_WAIT || !(sn.from.ws && sn.from.ws.open)) snapFallback(room, 'slow'); }
  const live = room.players.filter(p => !p.gone && p.ws && p.ws.open);
  if (!live.length) return;
  if (room.turn === 0 && !room.players.every(p => p.gone || p.loaded) && Date.now() < room.loadBy) return;
  // lockstep throttle: wait for a PC that has fallen too far behind (it catches up, then we go on)
  // a hidden tab and a PC catching up after a reload or rejoin (it replays the log flat out, then drops back into
  // the live match) don't hold the others up
  const slow = live.filter(p => p.loaded && !p.away && !p.catching && room.turn - p.acked > LAG_TURNS);
  if (slow.length) { if (Date.now() - room.waitT > 2000) { room.waitT = Date.now(); each(room, { t: 'wait', names: slow.map(p => p.name) }); } return; }
  // smooth pacing: the further behind the slowest PC is (past SOFT_LAG), the fewer turns go out, so it closes the gap
  // while the match only runs a little slower for a moment
  let lag = 0; for (const p of live) if (p.loaded && !p.away && !p.catching) lag = Math.max(lag, room.turn - p.acked);
  if (lag > SOFT_LAG && !room.paused) {
    room.pace = (room.pace || 0) + Math.max(MIN_PACE, 1 - (lag - SOFT_LAG) / (LAG_TURNS - SOFT_LAG));
    if (room.pace < 1) return;
    room.pace -= 1;
  } else room.pace = 0;
  const n = room.paused ? 0 : room.speed * STEPS_1X;
  if (!n && !room.cmds.length) return;   // paused: only send a turn when someone did something
  if (room.log.length >= MAX_LOG) return;   // a match this long stops here
  const turn = { t: 'turn', k: room.turn++, n, c: room.cmds };
  room.cmds = []; room.cmdBytes = 0;
  room.log.push(turn);
  each(room, turn);
}
function hashReport(room, p, k, h) {
  if (!room.hashes.has(k)) room.hashes.set(k, new Map());
  const m = room.hashes.get(k); m.set(p.slot, h >>> 0);
  const live = room.players.filter(q => !q.gone);
  if (m.size >= live.length) {
    const vals = new Set(m.values());
    if (vals.size > 1) each(room, { t: 'desync', k, hashes: Object.fromEntries(m) });
    room.hashes.delete(k);
  }
  for (const key of room.hashes.keys()) if (key < k - HASH_EVERY * 4) room.hashes.delete(key);
}

function onMessage(p, raw) {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== 'string') return;
  const room = p.room;
  // simple flood guard: at most 120 messages a second per player (a restore upload is limited by its size instead)
  const uploading = (p.pend && p.pend.up && p.pend.up.p === p && (m.t === 'restore' || m.t === 'restoreLog' || m.t === 'restoreEnd')) || (m.t === 'snapPart' && room && room.snap && room.snap.from === p);   // (a snapshot is limited by its size too)
  const now = Date.now(); if (now - p.rateT > 1000) { p.rateT = now; p.rateN = 0; } if (++p.rateN > 120 && !uploading) return;
  switch (m.t) {
    case 'create': if (p.pend) return; return createRoom(p, m.name);
    case 'join': { if (p.pend) return; const r = rooms.get(clean(m.code, 4).toUpperCase()); if (!r) return send(p, { t: 'err', msg: 'No room with that code.' }); return joinRoom(p, r, m.name); }
    case 'leave': if (p.pend) unwait(p); leaveRoom(p); return send(p, { t: 'left-room' });
    case 'rejoin': return rejoin(p, m);
    case 'restore': case 'restoreLog': case 'restoreEnd': m._bytes = Buffer.byteLength(raw); return restoreMsg(p, m);
    case 'set': {
      if (!room || room.state !== 'lobby') return;
      if (m.species != null && PLAYABLE.includes(m.species)) p.species = m.species;
      if (m.perk != null) p.perk = clean(m.perk, 24) || 'random';
      if (m.name != null) p.name = clean(m.name, 16) || p.name;
      if (m.ready != null) p.ready = !!m.ready;
      return syncRoom(room);
    }
    case 'settings': {
      if (!room || room.state !== 'lobby' || room.host !== p.id) return;
      if (m.ai != null) room.settings.ai = Math.max(0, Math.min(MAX_COLONIES - 1, m.ai | 0));
      if (LEVELS.includes(m.aiLevel)) room.settings.aiLevel = m.aiLevel;
      if (BIOMES.includes(m.biome)) room.settings.biome = m.biome;
      if (SIZES.includes(m.mapSize)) room.settings.mapSize = m.mapSize;
      return syncRoom(room);
    }
    case 'start': {
      if (!room || room.state !== 'lobby' || room.host !== p.id) return;
      if (room.players.length < 2 && !m.solo) return send(p, { t: 'err', msg: 'Need at least 2 players.' });
      if (!room.players.every(q => q.ready || q === p)) return send(p, { t: 'err', msg: 'Everyone has to be ready first.' });
      return startMatch(room);
    }
    case 'loaded': if (room && room.state === 'game') { p.loaded = true; p.inMatch = true; p.acked = Math.max(p.acked, m.k | 0); p.catching = !!m.catching; } return;
    case 'catchup': p.catching = !!m.on; return;
    case 'cmd': {
      if (!room || room.state !== 'game' || p.gone || p.slot < 0 || typeof m.n !== 'string' || !m.n) return;
      const a = plain(m.a) ? m.a : {}, b = argBytes(a) + 40;
      if (b > MAX_ARGS + 40 || room.cmds.length >= MAX_TURN_CMDS || room.cmdBytes + b > MAX_TURN_BYTES) return;
      room.cmdBytes += b;
      room.cmds.push({ col: p.slot, n: clean(m.n, 24) || '?', a, s: m.s | 0 });
      return;
    }
    case 'away': p.away = !!m.on; return;
    case 'snapPart': case 'snapEnd': case 'snapFail': case 'snapBad': if (room && room.state === 'game') snapMsg(p, room, m); return;
    case 'ack': if (room && room.state === 'game') { p.acked = Math.max(p.acked, m.k | 0); if (m.h != null) hashReport(room, p, m.k | 0, m.h); } return;
    case 'speed': if (room && room.state === 'game' && room.host === p.id && SPEEDS.includes(m.v)) { room.speed = m.v; each(room, { t: 'speed', v: room.speed, paused: room.paused }); } return;
    case 'pause': if (room && room.state === 'game' && room.host === p.id) { room.paused = !!m.on; each(room, { t: 'speed', v: room.speed, paused: room.paused }); } return;
    case 'chat': if (room) each(room, { t: 'chat', name: p.name, slot: p.slot, text: clean(m.text, 160) }); return;
  }
}

// a match in progress: a PC that (re)connects gets the start message and the turn log after turn `k` (the turns it
// already has; -1 for a freshly loaded page, which replays the match from the start and catches up)
function resume(p, k) {
  const room = p.room;
  if (!room || room.state !== 'game') { if (room) syncRoom(room); return; }
  const back = p.inMatch; p.gone = false; p.loaded = false; p.away = false;   // (a reloaded page says if it's hidden)
  send(p, roomView(room, p));
  const extra = { slot: p.slot, resume: true, speed: room.speed, paused: room.paused };
  if (p.secret) extra.secret = p.secret;
  // a fresh page well into the match: a snapshot from another PC instead of the whole log
  const donor = k < 0 && p.freshPage && !p.noSnap && room.turn > SNAP_MIN && !room.snap ? pickDonor(room, p) : null;
  if (donor) {
    const id = room.snapSeq = (room.snapSeq || 0) + 1;
    room.snap = { id, to: p, from: donor, t0: Date.now(), bytes: 0 };
    p.snapWait = id;
    send(p, Object.assign(extra, room.start, { snap: true, by: donor.name }));
    send(donor, { t: 'snapAsk', id });
    if (back) each(room, { t: 'back', slot: p.slot, name: p.name });
    return;
  }
  send(p, Object.assign(extra, room.start));
  sendLog(p, room, k);
  if (back) each(room, { t: 'back', slot: p.slot, name: p.name });
}
// the log from turn k+1 in chunks (one message never gets too big), then where it ends
function sendLog(p, room, k) {
  const from = Math.max(0, Math.min(room.log.length, (k == null ? -1 : k) + 1));
  for (let i = from; i < room.log.length; i += 200) send(p, { t: 'log', turns: room.log.slice(i, i + 200) });
  send(p, { t: 'logEnd', k: room.turn });
}
// who sends a joining PC its snapshot: a PC that is in the match and keeping up
function pickDonor(room, p) {
  const ok = room.players.filter(q => q !== p && !q.gone && q.ws && q.ws.open && q.loaded && !q.catching && !q.snapWait && room.turn - q.acked < LAG_TURNS);
  ok.sort((a, b) => (a.away ? 1 : 0) - (b.away ? 1 : 0) || b.acked - a.acked);
  return ok[0] || null;
}
// the snapshot didn't come (or was refused): the joining PC replays the whole log after all
function snapFallback(room, why) {
  const sn = room.snap; if (!sn) return;
  room.snap = null;
  const p = sn.to; p.snapWait = 0;
  if (!p.ws || !p.ws.open) return;
  send(p, { t: 'snapCancel', why });
  sendLog(p, room, -1);
}
function snapMsg(p, room, m) {
  const sn = room && room.snap;
  if (m.t === 'snapBad') { if (sn && sn.to === p) snapFallback(room, 'bad'); p.noSnap = true; return; }
  if (!sn || sn.from !== p || m.id !== sn.id) return;
  if (m.t === 'snapFail') return snapFallback(room, 'failed');
  if (m.t === 'snapPart') {
    if (typeof m.d !== 'string' || m.d.length > 60000) return snapFallback(room, 'part');
    sn.bytes += m.d.length; if (sn.bytes > SNAP_MAX) return snapFallback(room, 'big');
    return send(sn.to, { t: 'snapPart', i: m.i | 0, d: m.d });
  }
  if (m.t === 'snapEnd') {
    const k = m.k | 0; if (k < 0 || k >= room.turn) return snapFallback(room, 'turn');
    room.snap = null; sn.to.snapWait = 0;
    send(sn.to, { t: 'snapEnd', k, h: m.h >>> 0, n: m.n | 0, z: !!m.z, by: p.name });
    sendLog(sn.to, room, k);
  }
}

let nextId = 1;
function bind(p, ws) {
  if (p.ws && p.ws !== ws) { const old = p.ws; old.onclose = null; old.close(); }
  p.ws = ws;
  ws.onmessage = raw => onMessage(p, raw);
  ws.onclose = () => dropped(p, ws);
}
function unwait(p) {
  const pd = p.pend; if (!pd) return;
  p.pend = null; pd.waiters.delete(p);
  if (pd.up && pd.up.p === p) { pd.up = null; pendTick(pd); }
}
function dropped(p, ws) {
  if (p.ws !== ws) return;
  if (p.pend) unwait(p);
  const room = p.room;
  if (!room) { byToken.delete(p.token); return; }
  if (room.state === 'lobby') { setTimeout(() => { if (p.ws === ws && !ws.open) { leaveRoom(p); byToken.delete(p.token); } }, 15000).unref(); syncRoom(room); }
  else { if (p.inMatch) each(room, { t: 'left', slot: p.slot, name: p.name }); p.loaded = false; if (room.players.every(q => !(q.ws && q.ws.open))) dropRoomSoon(room); }
}
const sockets = new Set();
server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/mp') { socket.destroy(); return; }
  const ws = wsAccept(req, socket); if (!ws) return;
  sockets.add(socket); socket.on('close', () => sockets.delete(socket));
  const q = new URL(req.url, 'http://x').searchParams, token = q.get('token');
  let p = token && byToken.get(token);
  if (!p) { p = { id: nextId++, token: crypto.randomBytes(12).toString('hex'), ws: null, room: null, rateT: 0, rateN: 0 }; byToken.set(p.token, p); }
  bind(p, ws);
  p.freshPage = q.get('fresh') === '1'; if (q.get('nosnap') === '1') p.noSnap = true;   // (a page with no world yet; one a snapshot failed for)
  // inRoom false: this server doesn't know the PC's match (it restarted); a PC in a match then sends 'rejoin'
  send(p, { t: 'hi', id: p.id, token: p.token, inRoom: !!p.room });
  if (p.room) resume(p, -1);
});
// old empty lobbies go away, and so do old notes about ended matches
setInterval(() => {
  const t = Date.now();
  for (const r of rooms.values()) if (r.state === 'lobby' && t - r.created > 6 * 3600 * 1000) dropRoom(r);
  for (const [c, e] of ended) if (t - e.t > 6 * 3600 * 1000) ended.delete(c);
}, 60000).unref();

server.listen(PORT, () => console.log('Antlands on http://localhost:' + PORT));
// for tests: the room tables, and a way to stop this server like a crash would (every connection cut at once)
server.mp = {
  rooms, pending, ended,
  kill() {
    for (const r of rooms.values()) if (r.timer) clearInterval(r.timer);
    for (const pd of pending.values()) clearInterval(pd.timer);
    rooms.clear(); pending.clear(); byToken.clear();
    for (const s of sockets) s.destroy();
    if (server.closeAllConnections) server.closeAllConnections();
    return new Promise(res => server.close(() => res()));
  },
};
module.exports = server;
