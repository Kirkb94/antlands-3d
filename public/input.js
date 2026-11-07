// Antlands input: camera pan/zoom (mouse, keyboard, touch pinch) and routing paint strokes to tools.
(function (root) {
'use strict';
const AL = root.AL;
const keys = new Set();
let G = null;
const ptrs = new Map();      // active pointers (touch pinch)
let drag = null;             // { mode: 'pan'|'paint', sx, sy, cam0 }
let pinch = null;

const Input = AL.Input = {
  tool: null,               // set by the UI: { paint(phase, wx, wy, ev) } or null for pan/look
  mouse: { x: 0, y: 0, wx: 0, wy: 0, inside: false },
  keys,
  init(game) {
    G = game;
    const cv = document.getElementById('cv');
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      keys.add(e.code);
      if (AL.UI && AL.UI.key) AL.UI.key(e);
    });
    window.addEventListener('keyup', e => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());
  },
  // per frame: keyboard panning
  update(dt) {
    if (!G || !G.world) return;
    const r = G.renderer, cam = r.activeCam ? r.activeCam() : r.cam;
    if (!cam || (r.transition && r.transition.active)) return;
    let dx = 0, dy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
    if (dx || dy) {
      const sp = 700 / cam.z * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 2.2 : 1);
      cam.x += dx * sp * dt; cam.y += dy * sp * dt;
      clamp(r, cam);
    }
    const m = Input.mouse;
    if (m.inside) { const w = toWorld(m.x, m.y); m.wx = w.x; m.wy = w.y; }
  },
};

function toWorld(sx, sy) { const r = G.renderer; return r.screenToWorldActive ? r.screenToWorldActive(sx, sy) : r.screenToWorld(sx, sy); }
function clamp(r, cam) { if (r.clampActive) r.clampActive(cam); else r.clampCam(cam); }
function overUI(e) { return e.target && e.target.id !== 'cv'; }

function down(e) {
  if (!G || !G.world || overUI(e)) return;
  const cv = e.target; try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = G.renderer, cam = r.activeCam ? r.activeCam() : r.cam;
  if (ptrs.size === 2) {
    // second finger: switch to pinch zoom + two-finger pan, cancel any paint stroke
    if (drag && drag.mode === 'paint' && Input.tool) Input.tool.paint('cancel', 0, 0, e);
    const [a, b] = [...ptrs.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: cam.z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, cam0: { x: cam.x, y: cam.y } };
    drag = null; return;
  }
  const paintBtn = e.button === 0 && Input.tool && !(r.transition && r.transition.active);
  if (paintBtn) {
    const w = toWorld(e.clientX, e.clientY);
    drag = { mode: 'paint' };
    Input.tool.paint('start', w.x, w.y, e);
  } else {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, cam0: { x: cam.x, y: cam.y }, moved: 0, button: e.button };
  }
}
function move(e) {
  const m = Input.mouse;
  m.x = e.clientX; m.y = e.clientY; m.inside = !overUI(e) || !!drag;
  if (!G || !G.world) return;
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const r = G.renderer, cam = r.activeCam ? r.activeCam() : r.cam;
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const nz = pinch.z0 * d / Math.max(10, pinch.d0);
    zoomTo(nz, pinch.cx, pinch.cy);
    cam.x -= (cx - pinch.cx) / cam.z; cam.y -= (cy - pinch.cy) / cam.z;
    pinch.cx = cx; pinch.cy = cy; pinch.d0 = d; pinch.z0 = cam.z;
    clamp(r, cam);
    return;
  }
  if (!drag) { if (Input.tool && Input.tool.hover) { const w = toWorld(e.clientX, e.clientY); Input.tool.hover(w.x, w.y); } return; }
  if (drag.mode === 'pan') {
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
    cam.x = drag.cam0.x - dx / cam.z; cam.y = drag.cam0.y - dy / cam.z;
    clamp(r, cam);
  } else if (drag.mode === 'paint' && Input.tool) {
    const w = toWorld(e.clientX, e.clientY);
    Input.tool.paint('move', w.x, w.y, e);
  }
}
function up(e) {
  ptrs.delete(e.pointerId);
  if (pinch) { if (ptrs.size < 2) pinch = null; drag = null; return; }
  if (!drag) return;
  if (drag.mode === 'paint' && Input.tool) { const w = toWorld(e.clientX, e.clientY); Input.tool.paint('end', w.x, w.y, e); }
  else if (drag.mode === 'pan' && drag.moved < 5 && drag.button === 0 && AL.UI && AL.UI.click) { const w = toWorld(e.clientX, e.clientY); AL.UI.click(w.x, w.y, e); }
  drag = null;
}
function zoomTo(nz, sx, sy) {
  const r = G.renderer, cam = r.activeCam ? r.activeCam() : r.cam;
  const lim = r.zoomLimits ? r.zoomLimits() : { min: 0.3, max: 6 };
  const before = toWorld(sx, sy);
  const z = AL.clamp(nz, lim.min, lim.max);
  // zooming past the limits can switch views (surface <-> nest)
  if (r.zoomBeyond && (nz > lim.max * 1.04 || nz < lim.min / 1.04)) { if (r.zoomBeyond(nz > lim.max ? 1 : -1, before)) return; }
  cam.z = z;
  const after = toWorld(sx, sy);
  cam.x += before.x - after.x; cam.y += before.y - after.y;
  clamp(r, cam);
}
function wheel(e) {
  e.preventDefault();
  if (!G || !G.world) return;
  const r = G.renderer; if (r.transition && r.transition.active) return;
  const cam = r.activeCam ? r.activeCam() : r.cam;
  const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
  zoomTo(cam.z * k, e.clientX, e.clientY);
}
Input.zoomTo = (nz, sx, sy) => zoomTo(nz, sx == null ? innerWidth / 2 : sx, sy == null ? innerHeight / 2 : sy);
})(window);
