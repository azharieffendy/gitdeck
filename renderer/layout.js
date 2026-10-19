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
  dock.sizes = Object.assign({ side: 240, right: 420, top: 0.55 }, sizes || {});
}

function saveDock() {
  savePref('dock', JSON.stringify(dock.map));
  savePref('dockSizes', JSON.stringify(dock.sizes));
}

function applyDock() {
  const root = $('#layout');
  const w = root.clientWidth || window.innerWidth;
  // Keep the center column usable on narrow windows.
  const side = Math.round(Math.max(160, Math.min(dock.sizes.side, w * 0.24)));
  const right = Math.round(Math.max(240, Math.min(dock.sizes.right, w * 0.38)));
  const top = Math.max(0.15, Math.min(0.85, dock.sizes.top));
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

function wireSplitters() {
  document.querySelectorAll('#layout .splitter').forEach((s) => {
    s.onmousedown = (ev) => {
      ev.preventDefault();
      const kind = s.dataset.split;
      const rect = $('#layout').getBoundingClientRect();
      document.body.classList.add(kind === 'top' ? 'resizing-row' : 'resizing-col');
      const move = (e) => {
        if (kind === 'side') dock.sizes.side = e.clientX - rect.left;
        else if (kind === 'right') dock.sizes.right = rect.right - e.clientX;
        else dock.sizes.top = (e.clientY - rect.top) / rect.height;
        applyDock();
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        document.body.classList.remove('resizing-row', 'resizing-col');
        saveDock();
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    s.ondblclick = () => {
      dock.sizes = { side: 240, right: 420, top: 0.55 };
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
