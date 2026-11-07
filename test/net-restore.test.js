// Multiplayer after a server restart: the host's PC uploads the start message and the turn log, the server checks it
// and rebuilds the room, everyone takes their slot back by its secret and the turns go on. Bad uploads are refused.
// Runs real servers (server.js, loaded fresh for each "restart") on random ports and talks to them over WebSockets.
const test = require('node:test'), assert = require('node:assert');
const path = require('path'), crypto = require('crypto');
const SERVER = path.join(__dirname, '../server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(env) {
  const keep = {};
  for (const k of ['PORT', 'MP_KEY', 'MP_RESTORE_WAIT', 'MP_MAX_RESTORE', 'MP_SNAP_MIN', 'MP_SNAP_WAIT']) { keep[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, { PORT: '0' }, env || {});
  const log = console.log; console.log = () => {};
  delete require.cache[SERVER];
  const s = require(SERVER);
  if (!s.listening) await new Promise(r => s.once('listening', r));
  console.log = log;
  for (const k in keep) { if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; }
  return { s, port: s.address().port };
}

// a test PC: keeps every turn (like net.js), acks them, and can upload its log when the server asks
function pc(port, token, extra) {
  const c = { msgs: [], log: [], start: null, token: null, wait: [], upload: null };
  c.ws = new WebSocket('ws://127.0.0.1:' + port + '/mp' + (token ? '?token=' + token : '') + (extra || ''));
  c.send = m => c.ws.send(JSON.stringify(m));
  const add = t => { if (t.k === c.log.length) c.log.push(t); };
  c.ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    c.msgs.push(m);
    if (m.t === 'hi' || m.t === 'rejoined') c.token = m.token;
    if (m.t === 'start') { if (!c.start) c.start = m; c.slot = m.slot; if (m.secret) c.secret = m.secret; }
    if (m.t === 'log') m.turns.forEach(add);
    if (m.t === 'turn') { add(m); if (!c.noAck) c.send({ t: 'ack', k: m.k }); }
    if (m.t === 'restoreAsk' && c.upload) c.upload(m.from);
    for (const w of c.wait.slice()) if (w.test(m)) { c.wait.splice(c.wait.indexOf(w), 1); w.res(m); }
  };
  c.next = (pred, ms = 8000) => new Promise((res, rej) => {
    const old = c.msgs.find(pred); if (old) { c.msgs.splice(c.msgs.indexOf(old), 1); return res(old); }
    const w = { test: pred, res: m => { clearTimeout(t); c.msgs.splice(c.msgs.indexOf(m), 1); res(m); } };
    const t = setTimeout(() => { c.wait.splice(c.wait.indexOf(w), 1); rej(new Error('timeout waiting; got ' + c.msgs.map(x => x.t).join(','))); }, ms);
    c.wait.push(w);
  });
  c.type = (t, ms) => c.next(m => m.t === t, ms);
  c.opened = new Promise(r => { c.ws.onopen = r; });
  c.closed = new Promise(r => { c.ws.onclose = r; });
  c.close = () => { try { c.ws.close(); } catch (e) { /* gone */ } };
  return c;
}
// upload like net.js does: the start message (from turn 0), then the turns in chunks, then the count
function uploader(c, start, log, opts = {}) {
  return from => {
    if (!from) c.send({ t: 'restore', start, speed: 1, paused: false });
    const per = opts.per || 200;
    for (let k = from; k < log.length; k += per) c.send({ t: 'restoreLog', turns: log.slice(k, k + per) });
    c.send({ t: 'restoreEnd', k: log.length });
  };
}
async function match(port) {
  const a = pc(port), b = pc(port);
  await a.type('hi'); await b.type('hi');
  a.send({ t: 'create', name: 'Hosty' });
  const r = await a.next(m => m.t === 'room' && m.players.length === 1);
  b.send({ t: 'join', code: r.code, name: 'Guest' });
  await b.next(m => m.t === 'room' && m.players.length === 2);
  b.send({ t: 'set', ready: true, species: 'army' });
  await a.next(m => m.t === 'room' && m.players.length === 2 && m.players[1].ready);
  a.send({ t: 'start' });
  await a.type('start'); await b.type('start');
  a.send({ t: 'loaded', k: -1 }); b.send({ t: 'loaded', k: -1 });
  return { a, b, code: r.code };
}
const until = async (f, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await sleep(20); } };

test('a match comes back after a restart: host restores, a PC that got more turns adds them, turns go on', async () => {
  const A = await boot({ MP_KEY: 'same-key' });
  const { a, b, code } = await match(A.port);
  assert.equal(a.start.hostSlot, 0); assert.equal(b.start.locks.length, 2);
  assert.ok(a.secret && b.secret && a.secret !== b.secret, 'each PC its own secret');
  assert.ok(!JSON.stringify(a.start).includes(b.secret), 'the host never sees the guest\'s secret');
  await until(() => a.log.length >= 8);
  b.send({ t: 'cmd', n: 'egg', a: { caste: 1 }, s: 1 });
  b.send({ t: 'cmd', n: 'paint', a: { big: 'x'.repeat(2000) }, s: 2 });   // too big: dropped
  await until(() => a.log.length >= 20 && b.log.length >= 20);
  const all = a.log.concat(b.log).flatMap(t => t.c);
  assert.ok(all.some(c => c.n === 'egg' && c.col === 1) && !all.some(c => c.s === 2), 'small command relayed, huge one dropped');
  await A.s.mp.kill(); await a.closed; await b.closed;
  // the host's PC missed the last two turns; the guest has them
  const K = Math.min(a.log.length, b.log.length);
  const hostLog = a.log.slice(0, K - 2), guestLog = b.log.slice(0, K);
  assert.deepEqual(hostLog, guestLog.slice(0, K - 2));

  const B = await boot({ MP_KEY: 'same-key' });
  const a2 = pc(B.port, a.token), b2 = pc(B.port, b.token);
  a2.log = hostLog.slice(); b2.log = guestLog.slice();
  a2.upload = uploader(a2, a.start, hostLog, { per: 1 });   // one turn a message: more than the 120/s flood guard
  b2.upload = uploader(b2, b.start, guestLog);
  const hi = await a2.type('hi'); await b2.type('hi');
  assert.equal(hi.inRoom, false, 'the new server doesn\'t know the room');
  a2.send({ t: 'rejoin', code, slot: 0, secret: a.secret, k: hostLog.length - 1, has: true, host: true });
  b2.send({ t: 'rejoin', code, slot: 1, secret: b.secret, k: guestLog.length - 1, has: true, host: false });
  await a2.type('restoring');
  const ask = await b2.type('restoreAsk');
  assert.equal(ask.from, K - 2, 'the guest is asked only for the turns the host missed');
  const r1 = await a2.type('rejoined'), r2 = await b2.type('rejoined');
  assert.ok(r1.restored && r2.restored);
  const s1 = await a2.type('start');
  assert.equal(s1.resume, true); assert.equal(s1.seed, a.start.seed); assert.equal(s1.slot, 0);
  assert.equal((await a2.type('logEnd')).k, K); assert.equal((await b2.type('logEnd')).k, K);
  assert.equal(B.s.mp.rooms.get(code).host, r1.id, 'the host is still the host');
  // the host got the two turns it missed, and new turns go on from K, the same for both
  await until(() => a2.log.length >= K + 10 && b2.log.length >= K + 10);
  assert.deepEqual(a2.log.slice(0, K + 10), b2.log.slice(0, K + 10));
  assert.deepEqual(a2.log.slice(K - 2, K), guestLog.slice(K - 2, K));
  // the new tokens work for a plain reconnect
  a2.close(); await a2.closed;
  const a3 = pc(B.port, r1.token);
  assert.equal((await a3.type('hi')).inRoom, true);
  assert.equal((await a3.type('start')).seed, a.start.seed);
  a3.close(); b2.close();
  await B.s.mp.kill();
});

test('a PC that reloads catches up without pausing the match for the others; a slow PC still holds it', async () => {
  const S = await boot();
  const { a, b } = await match(S.port);
  await until(() => a.log.length >= 30);
  // b reloads its page: a fresh PC with its token, replaying the log from the start (it acks nothing for a while)
  b.close(); await b.closed;
  const b2 = pc(S.port, b.token); b2.noAck = true;
  await b2.type('hi'); await b2.type('start'); await b2.type('logEnd');
  b2.send({ t: 'loaded', k: -1, catching: true });
  const n0 = a.log.length;
  await until(() => a.log.length >= n0 + 40, 10000);   // turns keep coming for a: no waiting on b2
  assert.ok(!a.msgs.some(m => m.t === 'wait'), 'nobody waits for the PC catching up');
  // caught up, b2 is back in lockstep: if it falls behind now, the match waits for it
  b2.send({ t: 'catchup', on: false });
  await a.type('wait', 6000);
  const n1 = a.log.length; await sleep(400);
  assert.ok(a.log.length <= n1 + 1, 'held for the slow PC');
  a.close(); b2.close();
  await S.s.mp.kill();
});

// hand-made rooms for the checks (a server without MP_KEY can't check signatures, only that the start is sane)
const secret = () => crypto.randomBytes(16).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function craft(code, over) {
  const sec = [secret(), secret()];
  const start = Object.assign({ t: 'start', code, seed: 1234, colonies: 3, aiLevel: 'normal', hostSlot: 0, locks: sec.map(sha),
    mp: { humans: 2, species: ['fire', 'army'], names: ['A', 'B'], perks: ['random', 'random'] } }, over || {});
  const log = []; for (let k = 0; k < 30; k++) log.push({ t: 'turn', k, n: 3, c: k === 5 ? [{ col: 1, n: 'egg', a: { caste: 2 }, s: 4 }] : [] });
  return { sec, start, log };
}
let codeN = 0;
const nextCode = () => 'QR' + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(codeN / 24) | 0] + 'ABCDEFGHJKLMNPQRSTUVWXYZ'[codeN++ % 24];
async function attempt(port, code, slot, sec, start, log, extra) {
  const c = pc(port);
  await c.type('hi');
  c.upload = uploader(c, start, log);
  c.send(Object.assign({ t: 'rejoin', code, slot, secret: sec, k: log.length - 1, has: true, host: true }, extra || {}));
  const m = await c.next(x => x.t === 'restoreFail' || x.t === 'rejoined' || x.t === 'gone');
  return { c, m };
}

test('restore checks: sane start, host secret, turn order and values, size limits, no overwriting a live room', async () => {
  const V = await boot({ MP_RESTORE_WAIT: '1500', MP_MAX_RESTORE: '100000' });
  const fails = [];
  const bad = async (why, mod, slot = 0, useSec) => {
    const code = nextCode(), r = craft(code); mod(r);
    const { c, m } = await attempt(V.port, code, slot, useSec ? useSec(r) : r.sec[slot], r.start, r.log);
    fails.push(why + ': ' + m.t + ' ' + (m.why || m.reason || ''));
    assert.equal(m.t, 'restoreFail', why);
    c.close();
    return m.why;
  };
  assert.equal(await bad('seed out of range', r => { r.start.seed = 2 ** 40; }), 'start');
  assert.equal(await bad('5 players', r => { r.start.mp.humans = 5; }), 'start');
  assert.equal(await bad('unknown species', r => { r.start.mp.species[1] = 'termite'; }), 'start');
  assert.equal(await bad('names with markup', r => { r.start.mp.names[0] = '<b>x</b>'; }), 'start');
  assert.equal(await bad('code differs', r => { r.start.code = 'ZZZZ'; }), 'start');
  assert.equal(await bad('guest says it is the host', () => {}, 1), 'not host');
  assert.equal(await bad('wrong secret', () => {}, 0, () => secret()), 'not host');
  assert.equal(await bad('a gap in the turns', r => { r.log.splice(7, 1); }), 'turn 7');
  assert.equal(await bad('odd step count', r => { r.log[3].n = 7; }), 'turn 3');
  assert.equal(await bad('command for a colony nobody plays', r => { r.log[4].c.push({ col: 2, n: 'egg', a: {}, s: 1 }); }), 'turn 4');
  assert.equal(await bad('huge command', r => { r.log[4].c.push({ col: 0, n: 'egg', a: { x: 'y'.repeat(3000) }, s: 1 }); }), 'turn 4');
  assert.equal(await bad('too big', r => { for (let k = 30; k < 4000; k++) r.log.push({ t: 'turn', k, n: 3, c: [] }); }), 'too big');

  // a good one comes back; the other player takes their slot; turns go on from the end of the log
  const code = nextCode(), r = craft(code);
  const { c: h, m } = await attempt(V.port, code, 0, r.sec[0], r.start, r.log);
  assert.equal(m.t, 'rejoined');
  const g = pc(V.port); await g.type('hi');
  g.send({ t: 'rejoin', code, slot: 1, secret: r.sec[1], k: -1, has: false });
  assert.equal((await g.type('rejoined')).restored, true, 'the room is live again: the slot is claimed, first time since the restore');
  const t = await h.next(x => x.t === 'turn');
  assert.equal(t.k, 30);
  // a live room is never replaced, and a wrong secret gets no slot
  const { c: x, m: m2 } = await attempt(V.port, code, 1, secret(), craft(code).start, r.log);
  assert.deepEqual([m2.t, m2.reason], ['gone', 'unknown']);
  x.close();
  const l = pc(V.port); await l.type('hi'); l.send({ t: 'create', name: 'L' });
  const lobby = await l.type('room');
  const rl = craft(lobby.code);
  const { c: y, m: m3 } = await attempt(V.port, lobby.code, 0, rl.sec[0], rl.start, rl.log);
  assert.deepEqual([m3.t, m3.reason], ['gone', 'unknown'], 'a lobby with that code stays');
  assert.equal(V.s.mp.rooms.get(lobby.code).state, 'lobby');
  y.close(); l.close(); h.close(); g.close();

  // the host never comes back: the others hear the match is lost, and so does anyone later
  const lc = nextCode(), lr = craft(lc);
  const w = pc(V.port); await w.type('hi');
  w.send({ t: 'rejoin', code: lc, slot: 1, secret: lr.sec[1], k: 29, has: true, host: false });
  await w.type('restoring');
  const t0 = Date.now(), gone = await w.type('gone', 5000);
  assert.equal(gone.reason, 'lost'); assert.ok(Date.now() - t0 > 1000);
  const late = pc(V.port); await late.type('hi');
  late.send({ t: 'rejoin', code: lc, slot: 0, secret: lr.sec[0], k: 29, has: true, host: true });
  assert.equal((await late.type('gone')).reason, 'lost');
  w.close(); late.close();
  // a match that ended normally (its room was dropped) says so
  V.s.mp.ended.set('QZZZ', { reason: 'ended', t: Date.now() });
  const e = pc(V.port); await e.type('hi');
  e.send({ t: 'rejoin', code: 'QZZZ', slot: 0, secret: secret(), k: 10, has: true, host: true });
  assert.equal((await e.type('gone')).reason, 'ended');
  e.close();
  await V.s.mp.kill();

  // with MP_KEY set only a start message the server signed comes back
  const S = await boot({ MP_KEY: 'k' });
  const sc = nextCode(), sr = craft(sc);
  const { c: z, m: m4 } = await attempt(S.port, sc, 0, sr.sec[0], Object.assign({ sig: 'f'.repeat(64) }, sr.start), sr.log);
  assert.deepEqual([m4.t, m4.why], ['restoreFail', 'start']);
  z.close();
  await S.s.mp.kill();
});

test('a PC drifting behind slows the turns down smoothly instead of a dead stop; caught up, full speed again', async () => {
  const A = await boot({});
  const { a, b } = await match(A.port);
  await until(() => a.log.length >= 10 && b.log.length >= 10);
  // B falls behind: it acks only up to 12 turns back
  b.noAck = true;
  let lagK = 0; const tick = setInterval(() => { const k = b.log.length - 13; if (k > lagK) { lagK = k; b.send({ t: 'ack', k }); } }, 50);
  await sleep(600);
  const k0 = a.log.length, t0 = Date.now();
  await sleep(3000);
  const rate = (a.log.length - k0) / ((Date.now() - t0) / 100);
  assert.ok(rate > 0.08 && rate < 0.85, 'turns slowed but still coming: ' + rate.toFixed(2) + ' per 100 ms');
  assert.ok(!a.msgs.some(m => m.t === 'wait') && !b.msgs.some(m => m.t === 'wait'), 'nobody told to wait');
  // B catches up: full speed again
  clearInterval(tick); b.noAck = false; b.send({ t: 'ack', k: b.log.length - 1 });
  await sleep(400);
  const k1 = a.log.length, t1 = Date.now();
  await sleep(2000);
  const rate2 = (a.log.length - k1) / ((Date.now() - t1) / 100);
  assert.ok(rate2 > 0.85, 'back to full speed: ' + rate2.toFixed(2));
  a.close(); b.close(); await A.s.mp.kill();
});

test('a PC opening the match fresh gets a snapshot from another PC, then only the turns since; no snapshot: the whole log', async () => {
  const A = await boot({ MP_SNAP_MIN: '20', MP_SNAP_WAIT: '1500' });
  try {
  const { a, b } = await match(A.port);
  await until(() => a.log.length >= 30 && b.log.length >= 30);
  const tok = b.token; b.close(); await b.closed;
  // B reloads: a fresh page
  const c = pc(A.port, tok, '&fresh=1');
  const st = await c.type('start');
  assert.ok(st.snap && st.resume, 'told a snapshot is coming');
  const ask = await a.type('snapAsk');
  await sleep(300);
  assert.ok(!c.msgs.some(m => m.t === 'turn' || m.t === 'log'), 'no turns while the snapshot is on its way');
  const K = a.log.length - 1;
  a.send({ t: 'snapPart', id: ask.id, i: 0, d: 'AAAA' }); a.send({ t: 'snapPart', id: ask.id, i: 1, d: 'BBBB' });
  a.send({ t: 'snapEnd', id: ask.id, k: K, h: 1234, n: 2, z: true });
  const p0 = await c.type('snapPart'), p1 = await c.type('snapPart'), end = await c.type('snapEnd');
  assert.deepEqual([p0.d, p1.d, end.k, end.h, end.n], ['AAAA', 'BBBB', K, 1234, 2]);
  // then the turns after the snapshot: the log since (maybe empty), then live ones
  await c.type('logEnd');
  const after = await c.next(m => m.t === 'log' || m.t === 'turn');
  assert.equal(after.t === 'log' ? after.turns[0].k : after.k, K + 1, 'the turn after the snapshot comes next');
  // a snapshot that never comes: the whole log after all
  const tok2 = c.token; c.close(); await c.closed;
  const d = pc(A.port, tok2, '&fresh=1');
  assert.ok((await d.type('start')).snap);
  await a.type('snapAsk');   // (A doesn't answer)
  const cancel = await d.type('snapCancel', 4000);
  assert.equal(cancel.why, 'slow');
  const lg2 = await d.type('log');
  assert.equal(lg2.turns[0].k, 0, 'the whole log');
  // and a PC that says nosnap (a snapshot failed for it) never gets one
  const tok3 = d.token; d.close(); await d.closed;
  const e = pc(A.port, tok3, '&fresh=1&nosnap=1');
  const st3 = await e.type('start');
  assert.ok(!st3.snap); assert.equal((await e.type('log')).turns[0].k, 0);
  a.close(); e.close();
  } finally { await A.s.mp.kill(); }
});
