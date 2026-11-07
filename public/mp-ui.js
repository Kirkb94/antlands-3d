// Antlands multiplayer screens: the Multiplayer button on the title, the room lobby (code, players, species,
// perks, AI rivals, ready / start), and the in-match bits (room badge, catching-up bar, waiting and desync
// banners, who left or came back, a player knocked out) and the connection screens (server unreachable, a match
// being brought back after a server restart, a match that is gone). Talks to the server through AL.Net (net.js).
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, N = AL.Net;
if (!N) return;
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TEAM = () => (AL.Expansion && AL.Expansion.TEAM) || ['#f2c14e', '#e0503a', '#4aa3df', '#a678de'];
const NAME_KEY = 'antlands.mpname';
const getName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } };
const setName = v => { try { localStorage.setItem(NAME_KEY, v); } catch (e) { /* private mode */ } };
const toast = (t, k) => { if (UI.toast) UI.toast(t, k); };
let el = null, badge = null, banner = null, sync = null, net = null, netKind = '';
const WAKE = 'The free server can take about a minute to wake up when nobody has played for a while.';

const CSS = `
#mp .sheet{max-width:620px}
#mp .kicker{color:var(--mute);text-transform:uppercase;letter-spacing:.12em;font-size:var(--fs-xs);margin-bottom:4px}
#mp h1{margin-bottom:4px}
#mp .grid{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin:10px 0}
#mp input[type=text]{font:inherit;color:var(--ink);background:rgba(12,8,4,.6);border:1px solid var(--line);border-radius:9px;padding:calc(7px * var(--k)) 10px;min-width:0;width:100%}
#mp input.code{text-transform:uppercase;letter-spacing:.3em;font-weight:700;width:9em}
#mp .or{color:var(--mute);margin:14px 0 6px;font-size:var(--fs-s)}
#mp .code-big{font:700 clamp(34px,7vw,52px)/1 ui-monospace,Consolas,monospace;letter-spacing:.18em;color:var(--gold);user-select:text;-webkit-user-select:text}
#mp .codebox{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:6px 0 4px}
#mp .players{display:flex;flex-direction:column;gap:6px;margin:12px 0}
#mp .pl{display:grid;grid-template-columns:14px minmax(0,1fr) auto;gap:10px;align-items:center;background:rgba(12,8,4,.45);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
#mp .pl.me{border-color:var(--line2)}
#mp .sw{width:14px;height:14px;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,.4)}
#mp .pl .nm{min-width:0}
#mp .pl .nm b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#mp .pl .nm small{color:var(--mute)}
#mp .st{font-size:var(--fs-s);color:var(--mute)}
#mp .st.ok{color:var(--good)}
#mp .mine{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0 2px}
#mp select{font:inherit;color:var(--ink);background:rgba(58,41,25,.9);border:1px solid var(--line);border-radius:9px;padding:calc(6px * var(--k)) 8px;max-width:100%}
#mp .host{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0;padding-top:10px;border-top:1px solid var(--line)}
#mp .host b{min-width:14px;text-align:center}
#mp .msg{min-height:1.4em;color:var(--warn);font-size:var(--fs-s);margin:6px 0}
#mp .foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center;margin-top:8px}
#mpBadge{position:fixed;bottom:calc(58px * var(--k));left:50%;transform:translateX(-50%);z-index:12;display:flex;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 24px);gap:10px;align-items:center;font-size:var(--fs-s);padding:4px 10px;pointer-events:none}
#mpBadge .dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:3px;vertical-align:-1px}
#mpBadge .off{opacity:.4}
#mpBadge .out{text-decoration:line-through;opacity:.6}
#mpBanner{position:fixed;top:calc(84px * var(--k));left:50%;transform:translateX(-50%);z-index:13;max-width:min(560px,calc(100vw - 24px));text-align:center;font-size:var(--fs-s)}
#mpSync{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:rgba(8,5,2,.82)}
#mpSync .sheet{max-width:420px;text-align:center}
#mpSync .bar{height:10px;border-radius:6px;background:rgba(0,0,0,.45);overflow:hidden;margin:12px 0 4px}
#mpSync .bar i{display:block;height:100%;width:0;background:var(--gold);transition:width .2s}
#mpNet{position:fixed;inset:0;z-index:41;display:flex;align-items:center;justify-content:center;background:rgba(8,5,2,.86)}
#mpNet .sheet{max-width:440px;text-align:center}
#mpNet .kicker{color:var(--mute);text-transform:uppercase;letter-spacing:.12em;font-size:var(--fs-xs);margin-bottom:4px}
#mpNet .row{justify-content:center;margin-top:12px}
#mpNet .wait{height:6px;border-radius:4px;background:rgba(0,0,0,.45);overflow:hidden;margin:12px 0 4px;position:relative}
#mpNet .wait i{position:absolute;top:0;bottom:0;width:30%;background:var(--gold);animation:mpWait 1.6s ease-in-out infinite}
@keyframes mpWait{0%{left:-30%}100%{left:100%}}
`;
let styled = false;
function style() { if (styled) return; styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); }
function ensure() {
  style();
  if (el) return;
  el = document.createElement('section'); el.className = 'ov'; el.id = 'mp'; el.hidden = true;
  el.innerHTML = '<div class="sheet"></div>';
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', e => { if (e.code === 'Enter' && e.target.id === 'mpCode') { e.preventDefault(); join(); } e.stopPropagation(); });
}
const sheet = () => el.querySelector('.sheet');
let msg = '';
function say(t) { msg = t || ''; const m = el && el.querySelector('.msg'); if (m) m.textContent = msg; }

// ---- entry: name, create, join ------------------------------------------------------------------------------
function showEntry() {
  ensure();
  el.hidden = false; if ($('title')) $('title').hidden = true;
  sheet().innerHTML = '<div class="kicker">Multiplayer · up to 4 players</div><h1>Play together</h1>' +
    '<p>Everyone runs their own colony in the same backyard. Make a room and share its code, or join a friend\'s room. Everyone has to open this same site.</p>' +
    '<label class="mute small" for="mpName">Your name</label><div class="grid" style="grid-template-columns:1fr"><input type="text" id="mpName" maxlength="16" placeholder="Name" value="' + esc(getName()) + '"></div>' +
    '<div class="row"><button class="go" data-a="create">Create room</button></div>' +
    '<div class="or">or join with a code</div>' +
    '<div class="row"><input type="text" class="code" id="mpCode" maxlength="4" placeholder="CODE" autocomplete="off"><button data-a="join">Join</button></div>' +
    '<div class="msg">' + esc(msg) + '</div>' +
    '<div class="foot"><span class="mute small" id="mpConn"></span><button data-a="back">Back</button></div>';
  conn();
  N.connect();
}
function nameVal() { const i = $('mpName'); const v = (i ? i.value : getName()).trim().slice(0, 16); if (v) setName(v); return v; }
function join() { const c = ($('mpCode') && $('mpCode').value || '').trim().toUpperCase(); if (c.length !== 4) { say('Room codes are 4 letters.'); return; } say(''); N.join(c, nameVal()); }
function conn() { const c = $('mpConn'); if (!c) return; c.textContent = N.status === 'open' ? 'Connected' : N.status === 'connecting' ? (N.downSince && Date.now() - N.downSince > 3000 ? 'Connecting… ' + WAKE : 'Connecting…') : N.status === 'closed' || N.status === 'error' ? 'Can\'t reach the server. Multiplayer needs the Antlands server (npm start).' : ''; }

// ---- lobby -------------------------------------------------------------------------------------------------
const spName = k => (AL.SPECIES[k] ? AL.SPECIES[k].name : k);
function perkList(sp) { return AL.Research && AL.Research.perksFor ? AL.Research.perksFor(sp) : []; }
function perkName(sp, id) { if (!id || id === 'random') return 'random perk'; const p = perkList(sp).find(q => q.id === id); return p ? p.name : 'no perk'; }
function showLobby(r) {
  ensure();
  el.hidden = false; if ($('title')) $('title').hidden = true;
  const me = r.players.find(p => p.id === r.you) || {}, host = r.host === r.you, T = TEAM();
  const order = AL.SPECIES_ORDER || Object.keys(AL.SPECIES);
  const rows = r.players.map((p, k) => '<div class="pl' + (p.id === r.you ? ' me' : '') + '"><span class="sw" style="background:' + T[k % T.length] + '"></span>' +
    '<span class="nm"><b>' + esc(p.name) + (p.id === r.host ? ' <span class="mute">(host)</span>' : '') + (p.id === r.you ? ' <span class="mute">· you</span>' : '') + '</b><small>' + esc(spName(p.species)) + ' · ' + esc(perkName(p.species, p.perk)) + '</small></span>' +
    '<span class="st' + (p.ready || p.id === r.host ? ' ok' : '') + '">' + (!p.online ? 'offline' : p.id === r.host ? 'host' : p.ready ? 'ready' : 'not ready') + '</span></div>').join('');
  const perks = perkList(me.species);
  const spSel = '<select id="mpSp">' + order.filter(k => AL.SPECIES[k] && (!AL.isPlayable || AL.isPlayable(k))).map(k => '<option value="' + k + '"' + (k === me.species ? ' selected' : '') + '>' + esc(spName(k)) + '</option>').join('') + '</select>';
  const pkSel = perks.length ? '<select id="mpPerk"><option value="random"' + (!me.perk || me.perk === 'random' ? ' selected' : '') + '>Random perk</option>' + perks.map(p => '<option value="' + p.id + '"' + (p.id === me.perk ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select>' : '';
  const nH = r.players.length, maxAi = 8 - nH, ai = Math.min(r.settings.ai, maxAi);
  const allReady = r.players.every(p => p.ready || p.id === r.host);
  const biome = AL.BIOMES && AL.BIOMES[r.settings.biome] ? r.settings.biome : 'backyard', size = AL.MAP_SIZES && AL.MAP_SIZES[r.settings.mapSize] ? r.settings.mapSize : 'medium';
  const mapName = AL.BIOMES ? AL.BIOMES[biome].name + ', ' + AL.MAP_SIZES[size].name.toLowerCase() : biome;
  sheet().innerHTML = '<div class="kicker">Room code · share it</div>' +
    '<div class="codebox"><span class="code-big">' + esc(r.code) + '</span><button data-a="copy">Copy code</button></div>' +
    '<p class="mute small" style="margin:0">Friends open this same site, press Multiplayer and join with the code.</p>' +
    '<div class="players">' + rows + '</div>' +
    '<div class="mine"><span class="mute">Your colony</span>' + spSel + pkSel + (host ? '' : '<button data-a="ready" class="' + (me.ready ? 'on' : '') + '">' + (me.ready ? 'Ready ✓' : 'Ready?') + '</button>') + '</div>' +
    (host ? '<div class="host"><span class="mute">AI rivals</span><button data-a="aiDn"' + (ai <= 0 ? ' disabled' : '') + '>&minus;</button><b>' + ai + '</b><button data-a="aiUp"' + (ai >= maxAi ? ' disabled' : '') + '>+</button>' +
      '<select id="mpLvl">' + ['easy', 'normal', 'hard'].map(l => '<option value="' + l + '"' + (r.settings.aiLevel === l ? ' selected' : '') + '>' + l[0].toUpperCase() + l.slice(1) + ' AI</option>').join('') + '</select></div>' +
      '<div class="host"><span class="mute">Map</span><select id="mpBiome">' + (AL.BIOME_ORDER || []).map(k => '<option value="' + k + '"' + (biome === k ? ' selected' : '') + '>' + esc(AL.BIOMES[k].name) + '</option>').join('') + '</select>' +
      '<select id="mpSize">' + ['small', 'medium', 'large'].map(k => '<option value="' + k + '"' + (size === k ? ' selected' : '') + '>' + esc(AL.MAP_SIZES[k].name) + ' (' + esc(AL.MAP_SIZES[k].best) + ')</option>').join('') + '</select></div>'
      : '<p class="mute small">The host picks the AI rivals and the map, and starts the match. AI rivals: ' + ai + ' (' + esc(r.settings.aiLevel) + '). Map: ' + esc(mapName) + '.</p>') +
    '<div class="msg">' + esc(msg) + '</div>' +
    '<div class="foot"><button data-a="leave">Leave room</button>' + (host ? '<button class="go" data-a="start"' + (nH < 2 || !allReady ? ' disabled' : '') + '>' + (nH < 2 ? 'Waiting for players…' : allReady ? 'Start match' : 'Waiting for ready…') + '</button>' : '') + '</div>';
}
function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
  const a = b.dataset.a, r = N.room;
  if (a === 'create') { say(''); N.create(nameVal()); }
  else if (a === 'join') join();
  else if (a === 'back') { el.hidden = true; N.close(); if ($('title')) $('title').hidden = false; }
  else if (a === 'leave') { N.leave(); showEntry(); }
  else if (a === 'copy') { const t = r ? r.code : ''; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => { b.textContent = 'Copied'; }, () => {}); }
  else if (a === 'ready' && r) { const me = r.players.find(p => p.id === r.you); N.set({ ready: !(me && me.ready) }); }
  else if (a === 'aiUp' && r) N.settings({ ai: r.settings.ai + 1 });
  else if (a === 'aiDn' && r) N.settings({ ai: Math.max(0, r.settings.ai - 1) });
  else if (a === 'start') { say(''); N.start(); }
}
function onChange(e) {
  if (e.target.id === 'mpSp') N.set({ species: e.target.value, perk: 'random' });
  else if (e.target.id === 'mpPerk') N.set({ perk: e.target.value });
  else if (e.target.id === 'mpLvl') N.settings({ aiLevel: e.target.value });
  else if (e.target.id === 'mpBiome') N.settings({ biome: e.target.value });
  else if (e.target.id === 'mpSize') N.settings({ mapSize: e.target.value });
}
N.on('status', () => conn());
N.on('room', r => { if (N.inMatchPage()) return; if (r && r.state === 'lobby') showLobby(r); });
N.on('roomLost', () => { msg = 'The server restarted and the room was closed. Make a new room or join again.'; if (el && !el.hidden) showEntry(); });
N.on('err', m => { say(m.msg); if (N.inMatchPage() && /match|room/i.test(m.msg)) { toast(m.msg, 'bad'); } });

// ---- title button ---------------------------------------------------------------------------------------------
const baseScreens = UI.initScreens;
UI.initScreens = function () {
  if (baseScreens) baseScreens.apply(this, arguments);
  const row = document.querySelector('#title .startrow');
  if (row && !$('btnMP')) {
    const b = document.createElement('button'); b.id = 'btnMP'; b.textContent = 'Multiplayer';
    b.dataset.tip = 'Up to 4 players, each with their own colony in one backyard. Make a room and share the code.';
    b.onclick = () => showEntry();
    row.insertBefore(b, $('btnHow'));
  }
};
const baseKey = UI.screenKey;
UI.screenKey = function (e) {
  if (el && !el.hidden) { if (e.code === 'Escape') { el.hidden = true; N.close(); if ($('title')) $('title').hidden = false; } return true; }
  if ((sync && !sync.hidden) || (net && !net.hidden)) return true;
  return baseKey ? baseKey(e) : false;
};

// ---- in the match ----------------------------------------------------------------------------------------------
function showBanner(text, kind, secs) {
  style();
  if (!banner) { banner = document.createElement('div'); banner.id = 'mpBanner'; banner.className = 'panel'; document.body.appendChild(banner); }
  banner.innerHTML = text; banner.hidden = false; banner.className = 'panel ' + (kind || '');
  clearTimeout(banner._t); if (secs) banner._t = setTimeout(() => { banner.hidden = true; }, secs * 1000);
}
function drawBadge() {
  const g = N.game, w = g && g.world; if (!w || !w.mp) return;
  style();
  if (!badge) { badge = document.createElement('div'); badge.id = 'mpBadge'; badge.className = 'panel'; document.body.appendChild(badge); }
  const T = TEAM(), r = N.room, online = id => !r || !r.players || r.players.some(p => p.slot === id && p.online);
  let h = '<span class="mute">Room ' + esc(g.start.code) + '</span>';
  for (let k = 0; k < w.mp.humans; k++) {
    const c = w.colonies[k], out = c.out || !c.alive;
    h += '<span class="' + (out ? 'out' : online(k) ? '' : 'off') + '"><i class="dot" style="background:' + T[k % T.length] + '"></i>' + esc(c.name || 'Player ' + (k + 1)) + (k === w.me ? ' (you)' : '') + '</span>';
  }
  if (g.paused) h += '<b style="color:var(--gold)">Paused</b>';
  if (badge.innerHTML !== h) badge.innerHTML = h;
}
function showSync(left, end) {
  style();
  if (!sync) { sync = document.createElement('div'); sync.id = 'mpSync'; sync.innerHTML = '<div class="sheet"><h1 style="font-size:28px">Joining the match</h1><p id="mpSyncTxt">Connecting…</p><div class="bar"><i></i></div></div>'; document.body.appendChild(sync); }
  sync.hidden = false;
  sync.querySelector('.bar').hidden = end == null;
  if (end != null) {
    const g = N.game, done = g ? Math.max(0, g.k) : 0, f = end > 0 ? Math.min(1, done / end) : 0;
    sync.querySelector('.bar i').style.width = (f * 100).toFixed(0) + '%';
    $('mpSyncTxt').textContent = end > 0 ? 'Catching up with the colonies: ' + Math.round(f * 100) + '%' : 'Starting…';
  }
}
N.on('booting', () => {
  if (AL.Game) AL.Game.demo = false;
  showSync(0, null); const t = $('mpSyncTxt'); if (t) t.textContent = 'Connecting to the room…';
  setTimeout(() => {
    if (N.game || N.gone) return;
    const x = $('mpSyncTxt'); if (x) x.innerHTML = 'Still connecting… ' + esc(WAKE) + '<br><button id="mpGiveUp" style="margin-top:10px">Back to the title</button>';
    const gb = $('mpGiveUp'); if (gb) gb.onclick = () => N.leaveMatch();
  }, 6000);
});

// ---- the connection: unreachable server, a match coming back after a server restart, a match that is gone ----------
const NET = {
  down: { k: 'Connection lost', h: 'Can\'t reach the server', p: 'Retrying… ' + WAKE + ' Your colony waits where it is.', b: 'Give up', wait: true },
  restoring: { k: 'Connection back', h: 'The server restarted', p: 'Bringing the match back from the host\'s PC…', b: 'Back to the title', wait: true },
  lost: { k: 'Match lost', h: 'The server restarted and this match was lost', p: 'The host\'s PC didn\'t come back in time to restore it.', b: 'Back to the title' },
  ended: { k: 'Match over', h: 'This match has ended', p: 'Its room was closed after everyone left.', b: 'Back to the title' },
  unknown: { k: 'Match not found', h: 'This match is gone', p: 'The server doesn\'t know this match or your place in it any more.', b: 'Back to the title' },
};
function showNet(kind) {
  style();
  if (!net) { net = document.createElement('div'); net.id = 'mpNet'; net.hidden = true; document.body.appendChild(net); net.addEventListener('click', e => { if (e.target.closest('[data-a="title"]')) N.leaveMatch(); }); }
  netKind = kind || '';
  if (!kind) { net.hidden = true; return; }
  const T = NET[kind] || NET.lost;
  net.innerHTML = '<div class="sheet"><div class="kicker">' + esc(T.k) + '</div><h1 style="font-size:26px">' + esc(T.h) + '</h1><p>' + esc(T.p) + '</p>' +
    (T.wait ? '<div class="wait"><i></i></div>' : '') + '<div class="row"><button class="' + (T.wait ? '' : 'go') + '" data-a="title">' + esc(T.b) + '</button></div></div>';
  net.dataset.kind = kind;
  net.hidden = false;
  if (!T.wait && sync) sync.hidden = true;
}
N.netKind = () => netKind;
N.on('restoring', () => showNet('restoring'));
N.on('gone', m => { if (banner) banner.hidden = true; showNet(m.reason in NET ? m.reason : 'lost'); });
N.on('rejoined', m => {
  if (netKind && netKind !== 'down') showNet(null);
  if (m.restored) showBanner('<b>The server restarted.</b> The match was resumed.', '', 8);
});
// the connection dropped: a note after 2 s, the full screen (with a way out) once it has been down a while
let lostNote = false;
setInterval(() => {
  if (!N.inMatchPage() || N.gone) return;
  const down = N.status !== 'open' && N.downSince ? Date.now() - N.downSince : 0;
  if (down > 2000 && N.game && !lostNote && !netKind) { lostNote = true; showBanner('Connection lost. Reconnecting…', '', 0); }
  if (down > 10000 && N.game && (!netKind || netKind === 'restoring')) showNet('down');
  if (!down) {
    if (lostNote) { lostNote = false; if (banner && /Reconnecting/.test(banner.textContent)) banner.hidden = true; }
    if (netKind === 'down') showNet(null);
  }
}, 1000);
N.on('match', ({ world, start }) => {
  if ($('title')) $('title').hidden = true;
  if (el) el.hidden = true;
  if (!start.resume && sync) sync.hidden = true;
  if (start.resume) showSync(1, 0);
  drawBadge();
  const r = AL.Game.renderer; if (r && r.cam) { r.cam.x = world.player.x; r.cam.y = world.player.y; r.cam.z = 1.4; if (r.clampCam) r.clampCam(r.cam); }
});
let greeted = false;
let snapBy = '';
N.on('progress', p => {
  const g = N.game;
  if (p.snap) { showSync(null, null); $('mpSyncTxt').textContent = 'Getting the match from ' + (snapBy || 'another player') + '…'; return; }
  if (g && g.syncing) { showSync(p.left, p.end); return; }
  if (sync) sync.hidden = true;
  if (!greeted) { greeted = true; toast(g && g.k > 60 ? 'Back in the match.' : 'The match is on. Your colony has the gold ring on the minimap. Good luck!', 'good'); }
});
// snapshot joins (net.js): the world comes from another PC in a moment instead of a long replay
N.on('snap', m => {
  if (m.state === 'wait') snapBy = esc(m.by || '');
  else if (m.state === 'failed') showBanner('That copy of the match didn\'t check out: replaying it from the start instead…', '', 0);
  else if (m.state === 'cancel') snapBy = '';
});
N.on('wait', m => showBanner('Waiting for ' + esc(m.names.join(', ')) + ' to catch up…', '', 2.3));   // (the server repeats it every 2 s while it waits, so it goes as soon as the match moves again)
// out of sync: every PC hears it and resyncs by itself (reloads and replays the match from the turn log, flat out,
// while the others play on: net.js catching). Twice within a few minutes means a replay doesn't fix it: say so
// instead of reloading again and again.
const RESYNC_KEY = 'antlands.mpResyncAt', RESYNC_GAP = 4 * 60 * 1000;
// Only the PCs whose world differs from the rest reload: the host's world wins a tie (with two PCs, the guest
// reloads), so a PC that is still right can send the reloading one a snapshot (net.js) and nobody replays the match.
function wrongSide(m) {
  const g = N.game, hs = (m && m.hashes) || {}, mine = hs[g.slot], host = hs[g.start && g.start.hostSlot];
  if (mine == null) return true;
  const n = {}; for (const k in hs) n[hs[k]] = (n[hs[k]] || 0) + 1;
  let best = host, bn = host != null ? n[host] : 0;
  for (const h in n) if (n[h] > bn) { best = +h; bn = n[h]; }
  return mine !== best;
}
N.on('desync', m => {
  if (!wrongSide(m)) { toast('Another player\'s backyard drifted out of sync: it is reloading this match from yours.'); return; }
  let last = 0; try { last = +sessionStorage.getItem(RESYNC_KEY) || 0; } catch (e) { last = 0; }
  if (Date.now() - last < RESYNC_GAP) {
    showBanner('<b class="warn">Out of sync again.</b> This PC\'s backyard still doesn\'t match the others, so what you see may differ. Reload the page to try once more.', '', 0);
    return;
  }
  try { sessionStorage.setItem(RESYNC_KEY, String(Date.now())); } catch (e) { /* private mode: it just won't remember */ }
  showBanner('<b class="warn">Out of sync.</b> This backyard drifted apart from the others: reloading the match…', '', 0);
  setTimeout(() => { try { N.close(); } catch (e) { /* gone */ } location.reload(); }, 1200);
});
N.on('left', m => toast((m.name || 'A player') + ' left the match. Their colony carries on without orders.', 'bad'));
N.on('back', m => toast((m.name || 'A player') + ' is back.', 'good'));
N.on('notHost', () => toast('Only the host can pause or change the speed.'));
N.on('speed', m => { drawBadge(); if (m.paused) showBanner(N.isHost() ? 'Paused for everyone (you are the host)' : 'Paused by the host', '', 0); else if (banner && /Paused/.test(banner.textContent)) banner.hidden = true; });
N.on('chat', m => toast((m.name || '?') + ': ' + m.text));
AL.on('playerOut', (w, d) => {
  if (!N.game || w !== N.game.world) return;
  if (d.col === w.me) showBanner('Your colony has lost its last queen. You can keep watching the backyard.', '', 10);
  else toast((d.name || 'A player') + '\'s colony has lost its last queen.', 'good');
  drawBadge();
});
// pause menu in a match: no restart; quitting leaves the room. Only the host's menu pauses everyone.
const basePause = UI.showPause;
UI.showPause = function (on) {
  if (!N.active()) return basePause.apply(this, arguments);
  $('pausem').hidden = !on;
  if (N.isHost()) { AL.Game.paused = on; }
  if (UI.syncSpeed) UI.syncSpeed(); if (UI.syncSound) UI.syncSound();
  const q = $('btnQuit'), rs = $('btnRestart');
  if (rs) rs.hidden = true;
  if (q) { q.textContent = 'Leave match'; q.onclick = () => { if (confirmLeave()) N.leaveMatch(); }; }
};
let leaveArmed = 0;
function confirmLeave() {
  const q = $('btnQuit'); if (Date.now() - leaveArmed < 3000) return true;
  leaveArmed = Date.now(); if (q) q.textContent = 'Click again to leave'; return false;
}
const baseFrame = UI.frameExtra;
let badgeT = 0;
UI.frameExtra = function (w, dt) {
  if (baseFrame) baseFrame(w, dt);
  if (N.active() && (badgeT -= dt) <= 0) { badgeT = 0.5; drawBadge(); }
};
// the end-of-match screen's New game leaves the room
document.addEventListener('click', e => {
  if (!N.active()) return;
  const b = e.target.closest && e.target.closest('[data-e="again"], #btnAgain');
  if (b) { e.stopImmediatePropagation(); e.preventDefault(); N.leaveMatch(); }
}, true);
// dev and single-player-only buttons are off in a match
N.on('match', () => { for (const id of ['btnBench']) { const x = $(id); if (x) x.hidden = true; } });
})(window);
