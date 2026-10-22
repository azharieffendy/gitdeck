'use strict';
// GitDeck docked layout: four panels (refs, log, list, detail) in four slots
// (left, top, bottom, right). Drag a panel header onto another panel to swap them,
// drag the splitters to resize. Both are remembered. Classic script: shares globals with app.js.

const DOCK_SLOTS = ['left', 'top', 'bottom', 'right'];
const DOCK_LAYOUTS = [
  { refs: 'left', log: 'top', detail: 'bottom', list: 'right' },
  { refs: 'left', log: 'top', list: 'bottom', detail: 'right' },
];
const dock = { map: null, sizes: null, drag: null };

function loadDock() {
  let map = null, sizes = null;
  try { map = JSON.parse(loadPref('dock', 'null')); } catch { map = null; }
  const valid = map && typeof map === 'object' && DOCK_SLOTS.every((s) => Object.values(map).includes(s)) &&
    ['refs', 'log', 'list', 'detail'].every((p) => DOCK_SLOTS.includes(map[p]));
  dock.map = valid ? map : Object.assign({}, DOCK_LAYOUTS[0]);
  try { sizes = JSON.parse(loadPref('dockSizes', 'null')); } catch { sizes = null; }
  dock.sizes = Object.assign({}, DOCK_DEFAULTS, sizes || {});
}

function saveDock() {
  savePref('dock', JSON.stringify(dock.map));
  savePref('dockSizes', JSON.stringify(dock.sizes));
}

// Smallest sizes a panel can be dragged to (px), and the splitters' width.
const DOCK_MIN = { side: 120, center: 200, right: 160, row: 60 };
const DOCK_SPLIT = 5;
const DOCK_DEFAULTS = { side: 240, right: 420, top: 0.55 };
const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The sizes that fit the window: each panel can grow until a neighbour hits its minimum.
function fitDock() {
  const root = $('#layout');
  const w = root.clientWidth || window.innerWidth;
  const h = root.clientHeight || window.innerHeight;
  const free = w - 2 * DOCK_SPLIT - DOCK_MIN.center;
  const side = Math.round(clampNum(dock.sizes.side, DOCK_MIN.side, Math.max(DOCK_MIN.side, free - DOCK_MIN.right)));
  const right = Math.round(clampNum(dock.sizes.right, DOCK_MIN.right, Math.max(DOCK_MIN.right, free - side)));
  const rowMin = h > 0 ? Math.min(0.45, DOCK_MIN.row / h) : 0.1;
  const top = clampNum(dock.sizes.top, rowMin, 1 - rowMin);
  return { side, right, top };
}

function applyDock() {
  const root = $('#layout');
  const { side, right, top } = fitDock();
  root.style.setProperty('--dock-side', side + 'px');
  root.style.setProperty('--dock-right', right + 'px');
  root.style.setProperty('--dock-top', Math.round(top * 1000) + 'fr');
  root.style.setProperty('--dock-bottom', Math.round((1 - top) * 1000) + 'fr');
  document.querySelectorAll('#layout .panel').forEach((p) => { p.dataset.slot = dock.map[p.dataset.panel]; });
}

function cycleLayout() {
  const same = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
  dock.map = Object.assign({}, same(dock.map, DOCK_LAYOUTS[0]) ? DOCK_LAYOUTS[1] : DOCK_LAYOUTS[0]);
  saveDock();
  applyDock();
}

// Store what is actually shown, so a drag past a limit does not leave a size that differs from the screen.
function setDockSize(kind, value) {
  dock.sizes[kind] = value;
  dock.sizes = Object.assign(dock.sizes, fitDock());
  applyDock();
}

const SPLIT_LABELS = { side: 'Resize the left panel', right: 'Resize the right panel', top: 'Resize the top and bottom panels' };

function wireSplitters() {
  document.querySelectorAll('#layout .splitter').forEach((s) => {
    const kind = s.dataset.split;
    s.tabIndex = 0;
    s.setAttribute('role', 'separator');
    s.setAttribute('aria-orientation', kind === 'top' ? 'horizontal' : 'vertical');
    s.setAttribute('aria-label', SPLIT_LABELS[kind]);
    s.title = SPLIT_LABELS[kind] + ' (double-click to reset)';
    // Pointer capture keeps the drag alive over the panels' content and outside the window.
    s.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      s.setPointerCapture(ev.pointerId);
      const rect = $('#layout').getBoundingClientRect();
      document.body.classList.add(kind === 'top' ? 'resizing-row' : 'resizing-col');
      s.classList.add('active');
      s.onpointermove = (e) => {
        if (kind === 'side') setDockSize('side', e.clientX - rect.left);
        else if (kind === 'right') setDockSize('right', rect.right - e.clientX);
        else setDockSize('top', (e.clientY - rect.top) / rect.height);
      };
      s.onpointerup = s.onpointercancel = () => {
        s.onpointermove = s.onpointerup = s.onpointercancel = null;
        document.body.classList.remove('resizing-row', 'resizing-col');
        s.classList.remove('active');
        saveDock();
      };
    };
    // Arrow keys move the splitter (Shift for bigger steps).
    s.onkeydown = (ev) => {
      const step = ev.shiftKey ? 64 : 16;
      const h = $('#layout').clientHeight || window.innerHeight;
      const keys = kind === 'top' ? { ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1 };
      const dir = keys[ev.key];
      if (!dir) return;
      ev.preventDefault();
      if (kind === 'side') setDockSize('side', dock.sizes.side + dir * step);
      else if (kind === 'right') setDockSize('right', dock.sizes.right - dir * step);
      else setDockSize('top', dock.sizes.top + (dir * step) / h);
      saveDock();
    };
    s.ondblclick = () => {
      dock.sizes = Object.assign({}, DOCK_DEFAULTS);
      saveDock();
      applyDock();
    };
  });
}

function wirePanelDrag() {
  document.querySelectorAll('#layout .panel').forEach((panel) => {
    const head = panel.querySelector('.panel-head');
    const id = panel.dataset.panel;
    head.ondragstart = (ev) => {
      dock.drag = id;
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', id);
      panel.classList.add('dragging');
    };
    head.ondragend = () => {
      dock.drag = null;
      document.querySelectorAll('#layout .panel').forEach((p) => p.classList.remove('dragging', 'drop-target'));
    };
    panel.ondragover = (ev) => {
      if (!dock.drag || dock.drag === id) return;
      ev.preventDefault();
      panel.classList.add('drop-target');
    };
    panel.ondragleave = (ev) => { if (!panel.contains(ev.relatedTarget)) panel.classList.remove('drop-target'); };
    panel.ondrop = (ev) => {
      ev.preventDefault();
      const from = dock.drag;
      if (!from || from === id) return;
      const a = dock.map[from];
      dock.map[from] = dock.map[id];
      dock.map[id] = a;
      saveDock();
      applyDock();
    };
  });
}

function initDock() {
  loadDock();
  applyDock();
  wireSplitters();
  wirePanelDrag();
  window.addEventListener('resize', applyDock);
}
