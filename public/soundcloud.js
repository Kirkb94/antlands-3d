// Your own music in game: paste a SoundCloud playlist (or track / profile / likes) link and it plays through the
// SoundCloud player widget. Player-side only: it never goes through the game commands, so in a multiplayer match only
// you hear it, and nothing about it is saved in the world. The link and the volume are remembered on this PC.
// The ♪ button sits in the top-right bar next to the menu; the panel can be folded away while the music keeps playing.
(function (root) {
'use strict';
const AL = root.AL;
const KEY = 'antlands.scUrl', VKEY = 'antlands.scVol';
const get = (k, d) => { try { return localStorage.getItem(k) || d; } catch (_) { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } };
const S = { url: get(KEY, ''), vol: +get(VKEY, '60'), widget: null, playing: false, open: false, el: null, frame: null, apiP: null };

const CSS = `
#scPanel{position:fixed;right:12px;top:64px;z-index:60;width:320px;max-width:calc(100vw - 24px);padding:10px 12px;border-radius:12px;
  background:rgba(28,20,12,.94);border:1px solid rgba(240,200,140,.25);box-shadow:0 8px 28px rgba(0,0,0,.45);color:#f3e6cc;font:13px system-ui,sans-serif}
#scPanel.folded{visibility:hidden;pointer-events:none}
#scPanel .h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:700}
#scPanel .h .x{background:none;border:0;color:#e9d8b4;font-size:16px;cursor:pointer}
#scPanel .row{display:flex;gap:6px;align-items:center;margin:6px 0}
#scPanel input[type=text]{flex:1;min-width:0;padding:6px 8px;border-radius:7px;border:1px solid rgba(240,200,140,.3);background:rgba(0,0,0,.35);color:#f3e6cc}
#scPanel button.b{padding:6px 10px;border-radius:7px;border:1px solid rgba(240,200,140,.35);background:rgba(240,190,110,.14);color:#f6e4c0;cursor:pointer;font-weight:600}
#scPanel button.b:hover{background:rgba(240,190,110,.28)}
#scPanel .now{font-size:12px;color:#d9c7a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
#scPanel input[type=range]{flex:1}
#scPanel iframe{width:100%;height:166px;border:0;border-radius:8px;margin-top:6px;display:block}
#scPanel .mute{color:#b9a888;font-size:11.5px}
#btnMusic.on{color:#f2c14e}
`;

const valid = u => { try { const h = new URL(u.trim()).hostname; return /(^|\.)soundcloud\.com$/.test(h) || h === 'on.soundcloud.com'; } catch (_) { return false; } };
const src = u => 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(u.trim()) + '&color=%23d08a4a&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false&visual=false';
function api() {
  if (root.SC && root.SC.Widget) return Promise.resolve(root.SC);
  if (S.apiP) return S.apiP;
  return (S.apiP = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://w.soundcloud.com/player/api.js'; s.onload = () => ok(root.SC); s.onerror = no; document.head.appendChild(s); }));
}
const $q = sel => S.el.querySelector(sel);
function build() {
  if (S.el) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = S.el = document.createElement('div'); el.id = 'scPanel'; el.className = 'folded';
  el.innerHTML = '<div class="h"><span>&#9835; Your music</span><button class="x" title="Hide (the music keeps playing)">&#10005;</button></div>' +
    '<div class="row"><input type="text" id="scUrl" placeholder="Paste a SoundCloud playlist link" spellcheck="false"><button class="b" id="scLoad">Load</button></div>' +
    '<div class="row"><button class="b" id="scPrev" title="Previous">&#9198;</button><button class="b" id="scPlay" title="Play / pause">&#9654;</button><button class="b" id="scNext" title="Next">&#9197;</button><input type="range" id="scVol" min="0" max="100" title="Volume"></div>' +
    '<div class="now" id="scNow"></div><div id="scFrame"></div>' +
    '<div class="mute">Only you hear this, also in multiplayer. Game sounds: [M].</div>';
  document.body.appendChild(el);
  // (keys typed into the link box are for the box, not the game)
  for (const ev of ['keydown', 'keyup']) $q('#scUrl').addEventListener(ev, e => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Enter') load($q('#scUrl').value); });
  $q('#scUrl').value = S.url; $q('#scVol').value = S.vol;
  $q('.x').onclick = () => show(false);
  $q('#scLoad').onclick = () => load($q('#scUrl').value);
  $q('#scPlay').onclick = () => { if (S.widget) S.widget.toggle(); else if (S.url) load(S.url, true); };
  $q('#scNext').onclick = () => S.widget && S.widget.next();
  $q('#scPrev').onclick = () => S.widget && S.widget.prev();
  $q('#scVol').oninput = e => { S.vol = +e.target.value; set(VKEY, String(S.vol)); if (S.widget) S.widget.setVolume(S.vol); };
  if (S.url && valid(S.url)) load(S.url, false);
}
function now(text) { if (S.el) $q('#scNow').textContent = text || ''; }
function load(u, autoplay) {
  u = (u || '').trim();
  if (!valid(u)) { now('That isn\'t a SoundCloud link. Copy the playlist\'s address from soundcloud.com.'); return; }
  S.url = u; set(KEY, u);
  const box = $q('#scFrame'); box.innerHTML = '';
  const f = S.frame = document.createElement('iframe'); f.allow = 'autoplay'; f.src = src(u); f.title = 'SoundCloud player'; box.appendChild(f);
  now('Loading...'); S.widget = null; S.playing = false; sync();
  api().then(SC => {
    const w = SC.Widget(f), E = SC.Widget.Events;
    w.bind(E.READY, () => { S.widget = w; w.setVolume(S.vol); title(); if (autoplay !== false && autoplay) w.play(); });
    w.bind(E.PLAY, () => { S.playing = true; sync(); title(); });
    w.bind(E.PAUSE, () => { S.playing = false; sync(); });
    w.bind(E.FINISH, () => { S.playing = false; sync(); });
    w.bind(E.ERROR, () => now('SoundCloud couldn\'t play that (private, removed or blocked in your region?)'));
  }).catch(() => now('Couldn\'t reach SoundCloud. Check your connection.'));
}
function title() { if (S.widget) S.widget.getCurrentSound(s => now(s ? (s.user ? s.user.username + ' - ' : '') + s.title : 'Ready')); }
function sync() {
  if (S.el) $q('#scPlay').innerHTML = S.playing ? '&#10074;&#10074;' : '&#9654;';
  const b = document.getElementById('btnMusic'); if (b) b.classList.toggle('on', S.playing);
}
function show(on) { build(); S.open = on == null ? !S.open : on; S.el.classList.toggle('folded', !S.open); if (S.open && !S.url) setTimeout(() => $q('#scUrl').focus(), 0); }
// the ♪ button in the top-right bar, next to the menu
function addButton() {
  const menu = document.getElementById('btnMenu');
  if (!menu || document.getElementById('btnMusic')) return;
  const b = document.createElement('button'); b.id = 'btnMusic'; b.innerHTML = '&#9835;';
  b.dataset.tip = 'Your music: play your SoundCloud playlist while you play. Only you hear it.';
  b.onclick = () => show();
  menu.parentNode.insertBefore(b, menu);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
// a saved playlist is loaded (paused) as soon as the page is up, so Play is one click away
setTimeout(() => { if (S.url) build(); }, 1500);
AL.Music = { show, load, state: S };
})(window);
