// Antlands campaign screens (browser only): the mission map ("A Backyard Summer", a code-drawn yard with the
// ten missions on a trail plus a list with locks and stars), the briefing, the objectives panel in the HUD, mission
// toasts and the win / lose card. Progress lives in localStorage through AL.Campaign.Progress (always try/catch).
// Hooks, all from this file: UI.startGame (a campaign restart from the pause menu replays the mission),
// UI.showGameOver (campaign worlds get the mission card), UI.onNewGame (objectives widget), UI.screenKey (Esc/Enter
// on these screens) and the Food trail tool's stroke end (emits 'trailPainted' for the trail objective).
(function (root) {
'use strict';
const AL = root.AL, UI = AL.UI, Cp = AL.Campaign, P = Cp && Cp.Progress;
if (!UI || !Cp) return;
const $ = id => document.getElementById(id);
const G = () => AL.Game;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const starRow = (n, of) => { let h = ''; for (let k = 0; k < (of || 3); k++) h += '<i class="' + (k < n ? 'on' : '') + '">&#9733;</i>'; return '<span class="cmp-stars">' + h + '</span>'; };

let prog = P.load(), root$ = null, mapCv = null, hover = -1, current = null, pick = null;

// ---- styles ----------------------------------------------------------------------------------------------------
const CSS = `
.cmp-sheet{max-width:1000px;width:100%;max-height:calc(100vh - 32px);overflow:auto;padding:22px 24px}
.cmp-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px}
.cmp-head h1{margin:0}
.cmp-tot{color:var(--mute);font-size:1em;white-space:nowrap}.cmp-tot b{color:var(--gold);font-size:1.23em}
.cmp-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:16px;align-items:start}
.cmp-map{position:relative;border-radius:12px;overflow:hidden;border:1px solid var(--line);box-shadow:inset 0 0 40px rgba(0,0,0,.35)}
.cmp-map canvas{display:block;width:100%;height:auto;cursor:pointer}
.cmp-info{margin-top:10px;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:10px;padding:10px 12px;min-height:92px}
.cmp-info h3{margin:0 0 3px!important;font:700 1.3em Georgia,serif!important;color:var(--gold)!important;display:flex;justify-content:space-between;gap:8px}
.cmp-info p{margin:0 0 6px;font-size:.96em}.cmp-info .row{gap:6px}
.cmp-list{display:flex;flex-direction:column;gap:5px}
.cmp-m{display:grid;grid-template-columns:28px 1fr auto;gap:2px 10px;align-items:center;text-align:left;white-space:normal;padding:7px 10px;width:100%}
.cmp-m .no{grid-row:1/3;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 1em Georgia,serif;background:rgba(0,0,0,.35);border:1px solid var(--line);color:var(--mute)}
.cmp-m b{font-size:1.04em}.cmp-m small{grid-column:2/4;color:var(--mute);font-size:.85em}
.cmp-m.done .no{background:#6a4a16;border-color:var(--gold);color:#ffe9b0}
.cmp-m.open .no{border-color:var(--gold);color:var(--gold);box-shadow:0 0 0 3px rgba(242,193,78,.15)}
.cmp-m.locked,.cmp-m.soon{opacity:.5;cursor:not-allowed;filter:none!important}.cmp-lock.soon{color:var(--gold)}
.cmp-t.soon{opacity:.45;cursor:not-allowed;filter:grayscale(.7)}
.cmp-m.hl{border-color:var(--line2);background:#4a3418}
.cmp-stars{letter-spacing:1px;font-size:1em;white-space:nowrap}.cmp-stars i{font-style:normal;color:rgba(255,235,200,.18)}.cmp-stars i.on{color:var(--gold);text-shadow:0 0 6px rgba(242,193,78,.5)}
.cmp-lock{font-size:.85em;color:var(--mute)}
.cmp-foot{display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:8px}
.cmp-brief{max-width:720px;max-height:calc(100vh - 32px);overflow:auto}
.cmp-brief h1{font-size:clamp(28px,5vw,44px)}
.cmp-story{font-family:Georgia,serif;font-size:1.15em!important;color:#e3d4b6!important;font-style:italic}
.cmp-sp{display:flex;gap:12px;align-items:center;background:rgba(0,0,0,.22);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:0 0 12px}
.cmp-sp canvas{flex:none}.cmp-sp div{font-size:.96em;color:var(--mute);line-height:1.45}.cmp-sp b{color:var(--ink);font-size:1.08em}
.cmp-sp ul{margin:3px 0 0;padding-left:16px;font-size:.92em}
.cmp-obj{list-style:none;padding:0!important;margin:0 0 6px!important}
.cmp-obj li{display:flex;gap:8px;align-items:baseline;color:var(--ink)!important}
.cmp-obj li:before{content:"";flex:none;width:9px;height:9px;border-radius:2px;border:1.5px solid var(--gold);transform:translateY(1px)}
.cmp-obj.bonus li:before{content:"\\2605";border:0;width:auto;height:auto;color:var(--gold);font-size:.92em;transform:none}
.cmp-tips{font-size:.96em!important}
.cmp-brief .species{margin-top:6px}
.cmp-brief .row{margin-top:14px;gap:8px}
/* HUD panel */
#w-campaign{font-size:.92em;padding:7px 10px}
#w-campaign h4{margin:0 0 4px;font:700 1em Georgia,serif;color:var(--gold);display:flex;justify-content:space-between;gap:6px}
#w-campaign h4 span{font:600 .78em system-ui,sans-serif;color:var(--mute);letter-spacing:.08em;text-transform:uppercase;align-self:center}
.cmp-o{display:grid;grid-template-columns:14px 1fr;gap:0 6px;margin:3px 0;line-height:1.3}
.cmp-o .ck{width:11px;height:11px;margin-top:2px;border-radius:3px;border:1.5px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:.72em;line-height:1}
.cmp-o.done .ck{background:var(--gold);color:#2a1a0c}.cmp-o.done .tx{color:var(--mute);text-decoration:line-through;text-decoration-color:rgba(242,193,78,.5)}
.cmp-o.failed .ck{border-color:var(--warn);color:var(--warn)}.cmp-o.failed .tx{color:var(--warn)}
.cmp-o.bonus .ck{border:0;color:rgba(242,193,78,.55);font-size:.92em;margin-top:0}.cmp-o.bonus.done .ck{background:none;color:var(--gold)}
.cmp-o .pg{grid-column:2;color:var(--mute);font-size:.85em;font-variant-numeric:tabular-nums}
.cmp-o .pg b{color:var(--ink);font-weight:600}
.cmp-sep{height:1px;background:var(--line);margin:5px 0}
/* end card */
#cmpEnd{z-index:35}
#cmpEnd .sheet{max-width:520px;text-align:center}
#cmpEnd h1.lose{color:#d9a48f}
#cmpEnd .big{margin:2px 0 8px}#cmpEnd .big .cmp-stars{font-size:34px}#cmpEnd .big i{margin:0 3px}
#cmpEnd .cmp-obj{text-align:left;display:inline-block;margin:4px auto 10px!important}
#cmpEnd .cmp-obj li.done:before{background:var(--gold)}#cmpEnd .cmp-obj li.failed{color:var(--warn)!important}
#cmpEnd .row{justify-content:center;flex-wrap:wrap;gap:8px}
body.cmp-nokp #w-expHold{display:none}
/* the mission's objectives and messages replace the free-play tutorial hints */
body.campaign #hint{display:none!important}
.cmp-sheet,.cmp-brief,#cmpEnd .sheet{touch-action:pan-y}
#cmpEnd .sheet{max-height:calc(100vh - 24px);overflow:auto}
.cmp-brief .row.go-row{position:sticky;bottom:-26px;margin:14px -28px -26px;padding:10px 28px 12px;background:var(--panel2);border-top:1px solid var(--line)}
#w-campaign h4{cursor:pointer}#w-campaign.fold .cmp-o,#w-campaign.fold .cmp-sep{display:none}
@media (max-width:760px){.cmp-grid{grid-template-columns:1fr}.cmp-sheet{padding:14px}}
@media (max-height:560px){#w-campaign{font-size:.85em;padding:5px 7px}#w-campaign .cmp-o.bonus,#w-campaign .cmp-sep,#w-campaign .pg{display:none}#w-campaign h4 span{display:none}
#cmpEnd h1{font-size:30px}#cmpEnd .big .cmp-stars{font-size:24px}#cmpEnd .sheet{padding:14px 18px}#cmpEnd p{font-size:.96em;margin-bottom:8px}
.cmp-brief h1{font-size:28px}.cmp-sp ul{display:none}.cmp-brief .row.go-row{bottom:-12px;margin:10px -16px -12px;padding:8px 16px 10px}
.cmp-sheet,.cmp-brief{padding:12px 16px}.cmp-story{font-size:1em!important}.cmp-head h1{font-size:28px}.cmp-m small{display:none}.cmp-grid{grid-template-columns:minmax(0,1.2fr) minmax(0,1fr)}}

.cmp-tabs{display:flex;gap:6px;margin:0 0 10px}.cmp-tabs button{font-size:1.04em}
.cmp-tuts{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.cmp-t{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;align-items:center;text-align:left;white-space:normal;padding:9px 11px}
.cmp-t b{font-size:1.12em}.cmp-t small{grid-column:1/3;color:var(--mute);font-size:.9em;line-height:1.35}.cmp-t em{font-style:normal;color:var(--gold);font-size:.9em}
.cmp-t.done{border-color:var(--line2)}
.cmp-steps{margin:0 0 6px!important;padding-left:22px!important;color:var(--ink)!important;font-size:1.04em!important;line-height:1.6!important}
/* tutorial panel: big, easy to read */
#w-campaign.tut{width:100%;font-size:1.08em;border-color:var(--line2)}
.tut-dots{display:flex;gap:4px;margin:2px 0 6px}.tut-dots i{flex:1;height:5px;border-radius:3px;background:rgba(255,235,200,.15)}.tut-dots i.on{background:var(--gold)}.tut-dots i.cur{background:linear-gradient(90deg,var(--gold),rgba(242,193,78,.35))}
.tut-step{font-size:1.22em;font-weight:700;line-height:1.3;color:var(--ink);margin:0 0 4px}
.tut-help{color:var(--mute);line-height:1.45;margin:0 0 6px}
.tut-prog{font-variant-numeric:tabular-nums;color:var(--gold);font-weight:600;margin:0 0 6px}
.tut-btns{display:flex;gap:6px}.tut-btns button{flex:1;justify-content:center;padding:5px 8px}
.tut-bonus{margin-top:6px;color:var(--mute);font-size:.9em}
.cmp-hl{outline:3px solid var(--gold)!important;outline-offset:2px;animation:cmphl 1s ease-in-out infinite;position:relative;z-index:2}
@keyframes cmphl{50%{outline-color:rgba(242,193,78,.25);box-shadow:0 0 18px rgba(242,193,78,.6)}}
#cmpOffer .sheet{max-width:460px}
`;

// ---- the yard map (code-drawn) ----------------------------------------------------------------------------------
const shut = st => st === 'locked' || st === 'soon';   // missions you can't open (not won the one before, or coming soon)
function drawMap(cv) {
  const dpr = Math.min(2, root.devicePixelRatio || 1), cw = cv.clientWidth || 560, W = cw, H = Math.round(cw * 0.66);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = H + 'px'; }
  const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t = performance.now() / 1000;
  // lawn with mower stripes
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#567f35'); g.addColorStop(1, '#3b6126');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.save(); x.globalAlpha = 0.07; x.fillStyle = '#e8ffd0';
  for (let k = -2; k < 14; k++) { x.beginPath(); x.moveTo(k * W / 9, 0); x.lineTo(k * W / 9 + W / 18, 0); x.lineTo(k * W / 9 + W / 18 - H * 0.35, H); x.lineTo(k * W / 9 - H * 0.35, H); x.fill(); }
  x.restore();
  // grass flecks (seeded, stable)
  for (let k = 0; k < 260; k++) { const px = AL.hash2(k, 1, 9) * W, py = AL.hash2(k, 2, 9) * H; x.fillStyle = AL.hash2(k, 3, 9) > 0.5 ? 'rgba(170,210,110,.22)' : 'rgba(20,40,10,.2)'; x.fillRect(px, py, 1.2, 3); }
  const sh = (cx, cy, rx, ry) => { x.fillStyle = 'rgba(10,20,5,.28)'; x.beginPath(); x.ellipse(cx + rx * 0.18, cy + ry * 0.25, rx, ry, 0, 0, AL.TAU); x.fill(); };
  // fence along the top
  x.fillStyle = '#6b4a2c'; x.fillRect(0, 0, W, H * 0.055);
  for (let px = 0; px < W; px += W / 26) { x.fillStyle = AL.hash2(px | 0, 5, 3) > 0.5 ? '#8a6038' : '#7a5432'; x.fillRect(px + 1, 0, W / 26 - 3, H * 0.07); }
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, H * 0.07, W, 3);
  // patio (bottom left)
  x.fillStyle = '#b8a688'; x.fillRect(0, H * 0.86, W * 0.24, H * 0.14);
  x.strokeStyle = 'rgba(80,60,40,.45)'; x.lineWidth = 1;
  for (let k = 0; k < 6; k++) { x.beginPath(); x.moveTo(k * W * 0.048, H * 0.86); x.lineTo(k * W * 0.048, H); x.stroke(); }
  x.beginPath(); x.moveTo(0, H * 0.93); x.lineTo(W * 0.24, H * 0.93); x.stroke();
  // stepping-stone path from the patio up to the fence
  for (let k = 0; k < 9; k++) { const u = k / 8, px = W * (0.27 + 0.05 * Math.sin(u * 3)) , py = H * (0.84 - u * 0.72); sh(px, py, 9, 6); x.fillStyle = '#a99d8a'; x.beginPath(); x.ellipse(px, py, 9, 6, 0.3, 0, AL.TAU); x.fill(); }
  // hedge along the bottom right
  for (let k = 0; k < 16; k++) { const px = W * (0.36 + k * 0.042), py = H * (0.95 + 0.02 * Math.sin(k * 1.7)); sh(px, py, 20, 14); x.fillStyle = k & 1 ? '#2c4f1d' : '#335a22'; x.beginPath(); x.arc(px, py, 20, 0, AL.TAU); x.fill(); }
  // apple tree (top left), old stump, termite mound, picnic blanket
  sh(W * 0.1, H * 0.3, 52, 44); x.fillStyle = '#2f5a24'; x.beginPath(); x.arc(W * 0.1, H * 0.3, 52, 0, AL.TAU); x.fill();
  x.fillStyle = '#3d6e2c'; x.beginPath(); x.arc(W * 0.085, H * 0.28, 34, 0, AL.TAU); x.fill();
  for (let k = 0; k < 6; k++) { x.fillStyle = '#c8402c'; x.beginPath(); x.arc(W * 0.1 + Math.cos(k * 1.3) * 30, H * 0.3 + Math.sin(k * 1.3) * 26, 3.5, 0, AL.TAU); x.fill(); }
  sh(W * 0.6, H * 0.47, 18, 15); x.fillStyle = '#7a5530'; x.beginPath(); x.arc(W * 0.6, H * 0.47, 17, 0, AL.TAU); x.fill(); x.strokeStyle = '#a07a4a'; x.lineWidth = 1.2; for (let r = 4; r < 16; r += 4) { x.beginPath(); x.arc(W * 0.6, H * 0.47, r, 0, AL.TAU); x.stroke(); }
  sh(W * 0.73, H * 0.24, 20, 10); x.fillStyle = '#9a6a3c'; x.beginPath(); x.moveTo(W * 0.73 - 20, H * 0.24 + 8); x.quadraticCurveTo(W * 0.73, H * 0.24 - 34, W * 0.73 + 20, H * 0.24 + 8); x.fill();
  x.save(); x.translate(W * 0.47, H * 0.3); x.rotate(-0.2); sh(0, 0, 28, 20); x.fillStyle = '#d8d0c0'; x.fillRect(-28, -20, 56, 40);
  x.fillStyle = 'rgba(200,50,40,.75)'; for (let i = 0; i < 4; i++) { x.fillRect(-28 + i * 14, -20, 7, 40); x.fillRect(-28, -20 + i * 10, 56, 5); } x.restore();
  // the trail through the missions
  const pts = Cp.MISSIONS.map(m => ({ x: m.map.x * W, y: m.map.y * H, m }));
  x.save(); x.lineCap = 'round';
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1], st = P.state(prog, b.m.id), mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.18, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.18;
    x.strokeStyle = shut(st) ? 'rgba(20,14,8,.35)' : 'rgba(242,193,78,.75)'; x.lineWidth = shut(st) ? 2 : 3;
    x.setLineDash(shut(st) ? [3, 6] : [7, 6]); x.lineDashOffset = shut(st) ? 0 : -t * 12;
    x.beginPath(); x.moveTo(a.x, a.y); x.quadraticCurveTo(mx, my, b.x, b.y); x.stroke();
  }
  x.restore();
  // a little ant walking toward the open mission
  const op = pts.find(p => P.state(prog, p.m.id) === 'open');
  if (op && AL.Art && AL.Art.drawAnt) {
    const sp = AL.SPECIES[op.m.species || UI.species || 'fire'] || AL.SPECIES.fire, a = t * 0.9;
    x.save(); x.translate(op.x + Math.cos(a) * 26, op.y + Math.sin(a) * 26); x.rotate(a + Math.PI / 2 + Math.PI / 2); x.scale(1.5, 1.5); AL.Art.drawAnt(x, AL.CASTE.WORKER, sp, (t * 8) | 0); x.restore();
  }
  // mission nodes
  pts.forEach((p, k) => {
    const st = P.state(prog, p.m.id), e = prog.missions[p.m.id], r = 15, hl = k === hover;
    sh(p.x, p.y, r, r * 0.8);
    if (st === 'open') { x.strokeStyle = 'rgba(242,193,78,' + (0.35 + 0.3 * Math.sin(t * 3)) + ')'; x.lineWidth = 3; x.beginPath(); x.arc(p.x, p.y, r + 5 + Math.sin(t * 3) * 1.5, 0, AL.TAU); x.stroke(); }
    x.fillStyle = st === 'done' ? '#c99a2e' : st === 'open' ? '#5c4218' : '#3a3128';
    x.strokeStyle = shut(st) ? '#5a5048' : '#f2c14e'; x.lineWidth = hl ? 3 : 2;
    x.beginPath(); x.arc(p.x, p.y, r, 0, AL.TAU); x.fill(); x.stroke();
    x.fillStyle = st === 'done' ? '#2a1a0c' : st === 'open' ? '#ffe2a0' : '#8a8076';
    x.font = '700 14px Georgia,serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(p.m.n), p.x, p.y + 1);
    if (st === 'done') { const n = e.stars || 1; for (let s = 0; s < 3; s++) { x.fillStyle = s < n ? '#f2c14e' : 'rgba(20,14,8,.5)'; x.font = '11px system-ui,sans-serif'; x.fillText('★', p.x + (s - 1) * 10, p.y - r - 7); } }
    if (hl || st === 'open') {
      x.font = '600 11px system-ui,sans-serif'; const tw = x.measureText(p.m.title).width + 12, ly = p.y + r + 13;
      x.fillStyle = 'rgba(18,12,6,.78)'; x.fillRect(p.x - tw / 2, ly - 8, tw, 16); x.fillStyle = shut(st) ? '#a89a88' : '#f4ead6'; x.fillText(p.m.title, p.x, ly);
    }
  });
  cv._pts = pts;
}
function mapHit(e) {
  const cv = mapCv, b = cv.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top;
  let best = -1, bd = 22 * 22;
  (cv._pts || []).forEach((p, k) => { const d = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my); if (d < bd) { bd = d; best = k; } });
  return best;
}

// ---- screens ----------------------------------------------------------------------------------------------------
function ensure() {
  if (root$) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root$ = document.createElement('div'); root$.id = 'campaignRoot';
  root$.innerHTML = '<section class="ov" id="cmpMap" hidden><div class="sheet cmp-sheet"><div class="cmp-head"><div><div class="kicker">Campaign</div><h1>A Backyard Summer</h1></div><div class="cmp-tot" id="cmpTot"></div></div>' +
    '<div class="cmp-tabs" id="cmpTabs"><button data-tab="campaign" class="on">Campaign</button><button data-tab="tutorials">Species tutorials</button></div>' +
    '<p style="margin-top:-2px" id="cmpIntro"></p>' +
    '<div class="cmp-tuts" id="cmpTuts" hidden></div>' +
    '<div class="cmp-grid" id="cmpGrid"><div><div class="cmp-map"><canvas id="cmpCv"></canvas></div><div class="cmp-info" id="cmpInfo"></div></div><div class="cmp-list" id="cmpList"></div></div>' +
    '<div class="cmp-foot"><button id="cmpBack">Back to title [Esc]</button><span class="mute small" style="margin:0">Progress is saved in this browser.</span></div></div></section>' +
    '<section class="ov" id="cmpBrief" hidden><div class="sheet cmp-brief" id="cmpBriefIn"></div></section>' +
    '<section class="ov" id="cmpEnd" hidden></section>' +
    '<section class="ov" id="cmpOffer" hidden></section>';
  document.body.appendChild(root$);
  mapCv = $('cmpCv');
  $('cmpBack').onclick = () => close(true);
  $('cmpTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) open(b.dataset.tab); });
  $('cmpTuts').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b && !b.classList.contains('soon')) brief(b.dataset.t); });
  $('cmpInfo').addEventListener('click', e => { const b = e.target.closest('[data-brief]'); if (b) brief(b.dataset.brief); });
  $('cmpList').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b && !b.classList.contains('locked') && !b.classList.contains('soon')) brief(b.dataset.m); });
  $('cmpList').addEventListener('pointerover', e => { const b = e.target.closest('[data-m]'); hover = b ? Cp.get(b.dataset.m).index : -1; });
  mapCv.addEventListener('pointermove', e => { hover = mapHit(e); mapCv.style.cursor = hover >= 0 && !shut(P.state(prog, Cp.MISSIONS[hover].id)) ? 'pointer' : 'default'; syncHl(); });
  mapCv.addEventListener('pointerleave', () => { hover = -1; syncHl(); });
  mapCv.addEventListener('click', e => { const k = mapHit(e); if (k >= 0 && !shut(P.state(prog, Cp.MISSIONS[k].id))) brief(Cp.MISSIONS[k].id); });
}
function syncHl() { for (const b of document.querySelectorAll('#cmpList [data-m]')) b.classList.toggle('hl', hover >= 0 && Cp.MISSIONS[hover].id === b.dataset.m); info(); }
// the card under the map: the hovered mission, else the next one to play
let infoId = null;
function info() {
  const m = hover >= 0 ? Cp.MISSIONS[hover] : (Cp.MISSIONS.find(q => P.state(prog, q.id) === 'open') || Cp.MISSIONS[Cp.MISSIONS.length - 1]);
  if (!$('cmpInfo') || (infoId === m.id && $('cmpInfo').innerHTML)) return;
  infoId = m.id;
  const st = P.state(prog, m.id), e = prog.missions[m.id], sp = m.species ? AL.SPECIES[m.species].name : 'any species';
  $('cmpInfo').innerHTML = '<h3>' + m.n + '. ' + esc(m.title) + (st === 'done' ? starRow(e.stars) : '') + '</h3><p>' + esc(m.story) + '</p>' +
    '<div class="row"><span class="mute" style="flex:1">' + esc(m.when) + ' · ' + esc(sp) + '</span>' + (st === 'soon' ? '<span class="cmp-lock soon">Coming soon</span>' : shut(st) ? '<span class="cmp-lock">Win mission ' + ((P.prevOpen(m.id) || m).n) + ' to open</span>' : '<button class="go" data-brief="' + m.id + '">' + (st === 'done' ? 'Replay' : 'Briefing') + '</button>') + '</div>';
}
let raf = 0;
function loop() { if (!$('cmpMap') || $('cmpMap').hidden) { raf = 0; return; } drawMap(mapCv); raf = requestAnimationFrame(loop); }
function list() {
  const live = Cp.MISSIONS.filter(m => !Cp.soon(m));
  $('cmpTot').innerHTML = '<b>' + P.stars(prog) + '</b> / ' + live.length * 3 + ' &#9733; · ' + live.filter(m => P.state(prog, m.id) === 'done').length + ' of ' + live.length + ' missions';
  $('cmpList').innerHTML = Cp.MISSIONS.map(m => {
    const st = P.state(prog, m.id), e = prog.missions[m.id], sp = m.species ? AL.SPECIES[m.species].name : 'Any species';
    return '<button class="cmp-m ' + st + '" data-m="' + m.id + '"' + (st === 'soon' ? ' aria-disabled="true" data-tip="Coming soon: this mission uses a species that isn&#39;t playable yet."' : shut(st) ? ' aria-disabled="true" data-tip="Win mission ' + ((P.prevOpen(m.id) || m).n) + ' to open this one."' : '') + '><span class="no">' + m.n + '</span><b>' + esc(m.title) + '</b>' +
      (st === 'soon' ? '<span class="cmp-lock soon">Coming soon</span>' : shut(st) ? '<span class="cmp-lock">Locked</span>' : starRow(st === 'done' ? e.stars : 0)) + '<small>' + esc(m.when) + ' · ' + esc(sp) + (e && e.best ? ' · best ' + clock(e.best) : '') + '</small></button>';
  }).join('');
}
function tutList() {
  $('cmpTuts').innerHTML = Cp.TUTORIALS.map(t => {
    const e = prog.missions[t.id], sp = AL.SPECIES[t.species];
    const soon = Cp.soon(t);
    return '<button class="cmp-t' + (e && e.done ? ' done' : '') + (soon ? ' soon' : '') + '" data-t="' + t.id + '"' + (soon ? ' aria-disabled="true"' : '') + '><span class="pt" data-sp="' + t.species + '"></span><span><b>' + esc(sp.name) + '</b><br><em>' + (soon ? 'Coming soon' : t.steps.length + ' steps' + (e && e.done ? ' · done &#10003;' : '')) + '</em></span><small>' + esc(t.story) + '</small></button>';
  }).join('');
  for (const el of $('cmpTuts').querySelectorAll('.pt')) el.appendChild(portrait(el.dataset.sp, 34));
}
function hideAll() { for (const id of ['cmpMap', 'cmpBrief', 'cmpEnd', 'cmpOffer']) if ($(id)) $(id).hidden = true; }
let tab = 'campaign';
function open(which) {
  ensure(); prog = P.load();
  if (which === 'campaign' || which === 'tutorials') tab = which;
  hideAll(); if ($('title')) $('title').hidden = true; if ($('howto')) $('howto').hidden = true;
  const tuts = tab === 'tutorials';
  for (const b of $('cmpTabs').children) b.classList.toggle('on', b.dataset.tab === tab);
  $('cmpIntro').textContent = tuts ? 'One short guided lesson per species: what makes it play differently, plus the basics on the way. Each step moves on by itself when you have done it; Skip and Back are in the panel.' :
    'Ten short missions, one summer in one backyard. Each teaches a part of the game, then tests it. Win a mission to open the next; bonus objectives earn stars.';
  $('cmpGrid').hidden = tuts; $('cmpTuts').hidden = !tuts;
  list(); if (tuts) tutList(); infoId = null; hover = -1; info(); $('cmpMap').hidden = false;
  if (!tuts) requestAnimationFrame(() => { drawMap(mapCv); if (!raf) raf = requestAnimationFrame(loop); });
}
function close(toTitle) { hideAll(); if (toTitle && $('title')) $('title').hidden = false; }
function portrait(spKey, px) {
  const sp = AL.SPECIES[spKey] || AL.SPECIES.fire, cv = document.createElement('canvas'); cv.width = cv.height = px * 2; cv.style.width = cv.style.height = px + 'px';
  const k = px * 2 / 15 * Math.min(sp.size, 1.35), x = cv.getContext('2d'), caste = sp.repletes ? AL.CASTE.HONEYPOT : AL.CASTE.WORKER;
  x.setTransform(0, -k, k, 0, px, px * 1.05); AL.Art.drawAnt(x, caste, sp, 1);
  return cv;
}
function brief(id) {
  ensure();
  const m = Cp.get(id); if (!m) return;
  current = m.id; pick = null;
  const el = $('cmpBriefIn'), spKey = m.species || UI.species || 'fire', sp = AL.SPECIES[spKey];
  const obj = (arr, cls) => '<ul class="cmp-obj ' + (cls || '') + '">' + arr.map(o => '<li>' + esc(Cp.fill(o.text, o)) + '</li>').join('') + '</ul>';
  const e = prog.missions[m.id];
  if (m.tutorial) {
    el.innerHTML = '<div class="kicker">Species tutorial · ' + m.steps.length + ' steps' + (e && e.done ? ' · done &#10003;' : '') + '</div><h1>' + esc(m.title) + '</h1>' +
      '<p class="cmp-story">' + esc(m.story) + '</p>' +
      '<div class="cmp-sp"><span id="cmpPortrait"></span><div><b>' + esc(sp.name) + '</b> &nbsp;' + esc(sp.blurb) + '<ul>' + (sp.perks || []).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div></div>' +
      '<h3>What you will do</h3><ol class="cmp-steps">' + m.steps.map(o => '<li>' + esc(Cp.fill(o.text, o)) + '</li>').join('') + '</ol>' +
      '<p class="mute">A quiet yard: no raids, calm weather and a full larder. Each step moves on by itself; Skip and Back are in the panel.</p>' +
      '<div class="row go-row"><button class="go" id="cmpGo">Start tutorial [Enter]</button><button id="cmpBriefBack">Tutorials [Esc]</button></div>';
    $('cmpPortrait').appendChild(portrait(spKey, 46));
    $('cmpGo').onclick = () => start(m.id);
    $('cmpBriefBack').onclick = () => open('tutorials');
    hideAll(); $('cmpBrief').hidden = false;
    return;
  }
  el.innerHTML = '<div class="kicker">Mission ' + m.n + ' of ' + Cp.MISSIONS.length + ' · ' + esc(m.when) + (e && e.done ? ' · ' + starRow(e.stars) : '') + '</div><h1>' + esc(m.title) + '</h1>' +
    '<p class="cmp-story">' + esc(m.story) + '</p>' +
    (m.pickSpecies ? '<h3>Pick your species</h3><div id="cmpPick"></div>' :
      '<div class="cmp-sp"><span id="cmpPortrait"></span><div><b>' + esc(sp.name) + '</b> &nbsp;' + esc(m.speciesNote) + '<ul>' + (sp.perks || []).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div></div>') +
    '<div class="cols"><div><h3>Objectives</h3>' + obj(m.goals) + '<h3>Bonus <span class="mute">(a star each)</span></h3>' + obj(m.bonus, 'bonus') + '</div>' +
    '<div><h3>Field notes</h3><ul class="cmp-tips">' + (m.tips || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ul></div></div>' +
    '<div class="row go-row"><button class="go" id="cmpGo">Start mission [Enter]</button><button id="cmpBriefBack">Mission map [Esc]</button></div>';
  if (m.pickSpecies) { if (UI.buildSpecies) UI.buildSpecies($('cmpPick')); }
  else $('cmpPortrait').appendChild(portrait(spKey, 46));
  $('cmpGo').onclick = () => start(m.id);
  $('cmpBriefBack').onclick = () => open('campaign');
  hideAll(); $('cmpBrief').hidden = false;
}
// start (or restart) a mission: the normal scene flow with the mission's options
function start(id, extra) {
  const m = Cp.get(id); if (!m) return;
  ensure(); hideAll();
  const ex = Object.assign({}, extra || {});
  if (m.pickSpecies && !ex.species) ex.species = UI.species || 'fire';
  const opts = Cp.optsFor(id, ex);
  if (m.tutorial) markSeen(m.species);
  for (const k of ['title', 'howto', 'pausem']) if ($(k)) $(k).hidden = true;
  const g = G(); g.demo = false; g.paused = false; g.speed = 1;
  if (g.renderer && g.renderer.view === 'nest') { g.renderer.view = 'surface'; if (UI.onView) UI.onView('surface'); }
  UI.lastOpts = JSON.parse(JSON.stringify(opts));
  g.startFlow(JSON.parse(JSON.stringify(opts)));
  if (UI.syncSpeed) UI.syncSpeed();
}

// ---- HUD: objectives panel ---------------------------------------------------------------------------------------
function rowHtml(r) {
  const ck = r.bonus ? '&#9733;' : r.state === 'done' ? '&#10003;' : r.state === 'failed' ? '&#10005;' : '';
  const pg = r.state === 'open' && (r.prog || r.note) ? '<div class="pg">' + (r.prog ? '<b>' + esc(r.prog) + '</b>' : '') + (r.prog && r.note ? ' · ' : '') + esc(r.note) + '</div>' : '';
  return '<div class="cmp-o ' + r.state + (r.bonus ? ' bonus' : '') + '"><span class="ck">' + ck + '</span><span class="tx">' + esc(r.text) + '</span>' + pg + '</div>';
}
function tutPanel(s) {
  const r = s.goals[s.step] || s.goals[s.goals.length - 1];
  const dots = s.goals.map((g, k) => '<i class="' + (k < s.step ? 'on' : k === s.step ? 'cur' : '') + '"></i>').join('');
  const prog = r.prog && r.of > 1 ? '<div class="tut-prog">' + esc(r.prog) + (r.note ? ' · ' + esc(r.note) : '') + '</div>' : r.note ? '<div class="tut-prog">' + esc(r.note) + '</div>' : '';
  return '<h4>' + esc(s.title) + '<span>Step ' + Math.min(s.step + 1, s.goals.length) + ' of ' + s.goals.length + '</span></h4><div class="tut-dots">' + dots + '</div>' +
    '<div class="tut-step">' + esc(r.text) + '</div>' + (r.help ? '<div class="tut-help">' + esc(r.help) + '</div>' : '') + prog +
    '<div class="tut-btns"><button data-tut="back"' + (s.step ? '' : ' disabled') + '>&#9664; Back</button><button data-tut="skip">Skip step &#9654;</button></div>' +
    s.bonus.map(b => '<div class="tut-bonus">&#9733; ' + esc(b.text) + (b.state === 'failed' ? ' (missed)' : '') + '</div>').join('');
}
function panel(w) {
  const s = Cp.status(w); if (!s) return '';
  const el = $('w-campaign'); if (el) el.classList.toggle('tut', !!s.tutorial);
  if (s.tutorial) return tutPanel(s);
  return '<h4>' + esc(s.title) + '<span>Mission ' + s.n + ' · ' + clock(s.t) + '</span></h4>' + s.goals.map(rowHtml).join('') + '<div class="cmp-sep"></div>' + s.bonus.map(rowHtml).join('');
}
// click the panel title to fold it to one line (remembered)
let fold = false; try { fold = localStorage.getItem('antlands.cmpFold') === '1'; } catch (_) {}
function foldSync() { const el = $('w-campaign'); if (el) el.classList.toggle('fold', fold); else setTimeout(foldSync, 600); }
document.addEventListener('click', e => {
  const tb = e.target.closest && e.target.closest('#w-campaign [data-tut]');
  if (tb) { const w = G().world; if (tb.dataset.tut === 'skip') Cp.skipStep(w); else Cp.backStep(w); const el = $('w-campaign'); if (el && w) el.innerHTML = panel(w); return; }
  const h = e.target.closest && e.target.closest('#w-campaign h4'); if (!h) return;
  fold = !fold; try { localStorage.setItem('antlands.cmpFold', fold ? '1' : '0'); } catch (_) {} foldSync();
});
const baseNew = UI.onNewGame;
UI.onNewGame = function (world, opts) {
  baseNew.apply(this, arguments);
  const on = !!world.campaign;
  document.body.classList.toggle('campaign', on);
  document.body.classList.toggle('cmp-nokp', on && !(world.victory && world.victory.points.length));
  if (on) { UI.addWidget('campaign', { where: 'left', every: 0.5, html: panel }); foldSync(); }
  else UI.removeWidget('campaign');
  if ($('cmpEnd')) $('cmpEnd').hidden = true;
};

// ---- mission messages and objective toasts --------------------------------------------------------------------
const mine = w => G() && w === G().world && !G().demo;
AL.on('campaignMsg', (w, d) => { if (mine(w)) UI.toast(d.text, d.kind); });
AL.on('campaignStep', (w, d) => { if (mine(w) && d.k > 0) { UI.toast('Step ' + (d.k + 1) + ' of ' + d.of + ': ' + d.text, 'good'); const el = $('w-campaign'); if (el) el.innerHTML = panel(w); } });
AL.on('campaignObjective', (w, d) => { if (mine(w) && !(w.campaign && w.campaign.tut && !d.bonus)) UI.toast((d.bonus ? 'Bonus ' : 'Objective ') + (d.failed ? 'missed: ' : 'done: ') + d.text, d.failed ? 'bad' : 'good'); });
// save the result the moment the mission ends
AL.on('campaignEnd', (w, r) => { if (!mine(w)) return; prog = P.load(); P.record(prog, r); P.save(prog); });

// ---- win / lose card -----------------------------------------------------------------------------------------
function endCard(w) {
  ensure();
  const r = w.campaign.result || (w.over && w.over.campaign); if (!r) return false;
  const m = Cp.get(r.id), nx = Cp.next(r.id), s = Cp.status(w), el = $('cmpEnd');
  if (m.tutorial) {
    const sp = AL.SPECIES[m.species];
    el.innerHTML = '<div class="sheet"><div class="kicker">Species tutorial</div><h1 class="win">Tutorial complete</h1>' +
      '<p>You know how <b>' + esc(sp.name.toLowerCase()) + '</b> play now. ' + esc(sp.perks.join('. ')) + '.</p>' +
      '<ol class="cmp-steps" style="text-align:left;display:inline-block">' + s.goals.map(g => '<li>' + esc(g.text) + (g.skipped ? ' <span class="mute">(skipped)</span>' : ' &#10003;') + '</li>').join('') + '</ol>' +
      '<div class="row"><button class="go" data-c="match">Play a match as ' + esc(sp.name) + '</button><button data-c="tuts">More tutorials</button><button data-c="watch">Keep playing</button></div></div>';
    el.hidden = false;
    el.onclick = e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      el.hidden = true;
      if (b.dataset.c === 'match') { UI.species = m.species; baseStart.call(UI, { species: m.species }); }
      else if (b.dataset.c === 'tuts') { if (UI.showTitle) UI.showTitle(); open('tutorials'); }
      else { G().paused = false; if (UI.syncSpeed) UI.syncSpeed(); }
    };
    return true;
  }
  const li = rr => '<li class="' + rr.state + '">' + (rr.bonus ? '&#9733; ' : '') + esc(rr.text) + (rr.state === 'failed' ? ' (missed)' : '') + '</li>';
  el.innerHTML = '<div class="sheet"><div class="kicker">Mission ' + m.n + ' · ' + esc(m.when) + '</div><h1 class="' + (r.win ? 'win' : 'lose') + '">' + (r.win ? 'Mission complete' : 'Mission failed') + '</h1>' +
    (r.win ? '<div class="big">' + starRow(r.stars) + '</div>' : '') +
    '<p><b>' + esc(m.title) + '.</b> ' + esc(r.win ? m.debrief.win : m.debrief.lose) + '</p>' +
    (r.win ? '' : '<p class="mute">' + esc(r.reason) + '</p>') +
    '<ul class="cmp-obj">' + s.goals.map(li).join('') + s.bonus.map(rr => li(Object.assign({}, rr, { state: r.win && r.bonus[s.bonus.indexOf(rr)] ? 'done' : 'failed' }))).join('') + '</ul>' +
    '<p class="mute small" style="margin:0 0 12px">Time ' + clock(r.time) + (r.win && nx ? ' · Next: ' + esc(nx.title) : r.win ? ' · That was the last mission. The yard is yours.' : '') + '</p>' +
    '<div class="row">' + (r.win && nx ? '<button class="go" data-c="next">Next mission</button>' : '') + '<button data-c="retry"' + (r.win ? '' : ' class="go"') + '>' + (r.win ? 'Replay' : 'Try again') + '</button><button data-c="map">Mission map</button>' + (r.win ? '<button data-c="watch">Keep watching</button>' : '') + '</div></div>';
  el.hidden = false;
  el.onclick = e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const c = b.dataset.c; el.hidden = true;
    if (c === 'next') brief(nx.id);
    else if (c === 'retry') start(r.id, { species: w.player.spKey });
    else if (c === 'map') { if (UI.showTitle) UI.showTitle(); open(); }
    else { G().paused = false; if (UI.syncSpeed) UI.syncSpeed(); }
  };
  return true;
}
const baseOver = UI.showGameOver;
UI.showGameOver = function (w, d) {
  if (w && w.campaign && w === G().world && endCard(w)) { G().paused = true; if (UI.syncSpeed) UI.syncSpeed(); return; }
  if (baseOver) return baseOver.apply(this, arguments);
};

// ---- other hooks -----------------------------------------------------------------------------------------------
// a restart from the pause menu (UI.startGame(UI.lastOpts)) replays the mission
const baseStart = UI.startGame;
UI.startGame = function (opts) {
  if (opts && opts.campaign && Cp.get(opts.campaign)) return start(opts.campaign, { species: opts.species });
  // the first game with a species: offer its tutorial once (remembered per species)
  const spk = (opts && opts.species) || UI.species || 'fire', t = Cp.tutorialFor(spk);
  if (t && !seen(spk) && !(opts && opts.noOffer)) { offer(t, opts); return; }
  return baseStart.apply(this, arguments);
};
const SEEN = 'antlands.tutSeen';
function seenMap() { try { return JSON.parse(localStorage.getItem(SEEN) || '{}') || {}; } catch (_) { return {}; } }
function seen(sp) { return !!seenMap()[sp]; }
function markSeen(sp) { const m = seenMap(); m[sp] = 1; try { localStorage.setItem(SEEN, JSON.stringify(m)); } catch (_) {} }
function offer(t, opts) {
  ensure();
  const sp = AL.SPECIES[t.species], el = $('cmpOffer');
  el.innerHTML = '<div class="sheet"><div class="kicker">First time with ' + esc(sp.name) + '?</div><h2>' + esc(sp.name) + ' play differently</h2><p>' + esc(sp.blurb) + ' A short guided tutorial (' + t.steps.length + ' steps) shows you how.</p>' +
    '<div class="row" style="gap:8px"><button class="go" data-o="play">Play the tutorial [Enter]</button><button data-o="skip">Skip, start the game</button></div></div>';
  hideAll(); if ($('title')) $('title').hidden = true;
  el.hidden = false;
  const go = el.querySelector('[data-o=play]'); if (go) go.focus();
  el.onclick = e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    markSeen(t.species); el.hidden = true;
    if (b.dataset.o === 'play') start(t.id); else baseStart.call(UI, opts);
  };
}
const baseKey = UI.screenKey;
UI.screenKey = function (e) {
  if ($('cmpBrief') && !$('cmpBrief').hidden) { if (e.code === 'Escape') open(); else if (e.code === 'Enter') { start(current); e.preventDefault(); } return true; }
  if ($('cmpMap') && !$('cmpMap').hidden) { if (e.code === 'Escape') close(true); return true; }
  if ($('cmpEnd') && !$('cmpEnd').hidden) return true;
  if ($('cmpOffer') && !$('cmpOffer').hidden) {
    const el = $('cmpOffer');
    if (e.code === 'Escape') { el.hidden = true; if ($('title')) $('title').hidden = false; }
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      // Enter picks the focused button, else the highlighted one (play the tutorial)
      const f = document.activeElement, b = f && el.contains(f) && f.dataset.o ? f : el.querySelector('[data-o=play]');
      e.preventDefault(); if (b && !e.repeat) b.click();
    }
    return true;
  }
  return baseKey ? baseKey(e) : false;
};
// the trail objective: brush.js emits 'trailPainted' when a Food trail stroke ends

// tutorial conditions the sim can't see: the camera view and egg-queue clicks
const baseView = UI.onView;
UI.onView = function (view) { baseView.apply(this, arguments); const w = G() && G().world; if (w && w.campaign) AL.emit(w, 'viewChanged', { view }); };
if ($('eggBtns')) $('eggBtns').addEventListener('click', e => { const b = e.target.closest('[data-caste]'), w = G() && G().world; if (b && w && w.campaign) AL.emit(w, 'eggQueued', { col: 0, caste: +b.dataset.caste }); });
// highlight the HUD element of the current tutorial step
let hlSel = '', hlT = 0;
function syncHlEl(w) {
  const s = w && w.campaign && w.campaign.tut && !w.campaign.result ? Cp.status(w) : null, r = s && s.goals[s.step], sel = r ? r.hl : '';
  if (sel === hlSel && !(sel && !document.querySelector('.cmp-hl'))) return;
  for (const el of document.querySelectorAll('.cmp-hl')) el.classList.remove('cmp-hl');
  hlSel = sel;
  if (sel) for (const el of document.querySelectorAll(sel)) el.classList.add('cmp-hl');
}
const baseExtra = UI.frameExtra;
UI.frameExtra = function (w, dt) { if (baseExtra) baseExtra(w, dt); hlT += dt; if (hlT > 0.3) { hlT = 0; syncHlEl(w); } };
// a pulsing ring and an arrow on the step's spot in the yard (an edge arrow when it is off screen)
function spotNow(w) { const st = w && w.campaign; if (!st || !st.tut || st.result) return null; const s = st.goals[st.step]; return s && s.o.spot ? Cp.spotOf(w, s.o.spot) : null; }
const csys = AL.SYSTEMS.find(q => q.id === 'campaign');
if (csys) csys.render = {
  // drawn in screen pixels, above the fog, so the target always shows
  screen(ctx, view, r) {
    if (r.view === 'nest') return;
    const p = spotNow(r.world); if (!p) return;
    // the screen layer has an identity view: rebuild the surface transform from the camera (as drawSurface does)
    const d = r.dpr || view.dpr || 1, t = performance.now() / 1000, W = r.w || view.w, H = r.h || view.h, z = r.cam.z * d;
    const sx = p.x * z + (W / 2 - r.cam.x * z), sy = p.y * z + (H / 2 - r.cam.y * z), m = 46 * d;
    ctx.fillStyle = '#f2c14e'; ctx.strokeStyle = 'rgba(40,24,8,.85)'; ctx.lineWidth = 2 * d;
    if (sx > m && sy > m && sx < W - m && sy < H - m) {
      const rad = ((p.r || 16) + 20) * z + (6 + Math.sin(t * 4) * 4) * d;
      ctx.save(); ctx.strokeStyle = 'rgba(242,193,78,0.95)'; ctx.lineWidth = 3 * d; ctx.setLineDash([10 * d, 8 * d]); ctx.lineDashOffset = -t * 20 * d;
      ctx.beginPath(); ctx.arc(sx, sy, rad, 0, AL.TAU); ctx.stroke(); ctx.restore();
      const ay = sy - rad - (12 + Math.abs(Math.sin(t * 3)) * 10) * d, s = d;
      ctx.beginPath(); ctx.moveTo(sx, ay + 14 * s); ctx.lineTo(sx - 12 * s, ay - 2 * s); ctx.lineTo(sx - 4.5 * s, ay - 2 * s); ctx.lineTo(sx - 4.5 * s, ay - 18 * s); ctx.lineTo(sx + 4.5 * s, ay - 18 * s); ctx.lineTo(sx + 4.5 * s, ay - 2 * s); ctx.lineTo(sx + 12 * s, ay - 2 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
      return;
    }
    // off screen: an arrow pointing the way, kept clear of the HUD columns and bars
    const L = Math.min(W * 0.3, 250 * d), Rr = Math.min(W * 0.3, 260 * d), T = 70 * d, B = 110 * d;
    const cx = (L + W - Rr) / 2, cy = (T + H - B) / 2, hw = (W - Rr - L) / 2, hh = (H - B - T) / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min(Math.abs(hw / (Math.cos(a) || 1e-6)), Math.abs(hh / (Math.sin(a) || 1e-6)));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k, s = (22 + Math.sin(t * 5) * 3) * d;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, -s * 0.7); ctx.lineTo(-s * 0.3, 0); ctx.lineTo(-s * 0.7, s * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  },
};

AL.CampaignUI = { open, close, brief, start, panel, endCard, offer, seen, markSeen, progress: () => prog, reload: () => { prog = P.load(); return prog; } };
})(window);
