'use strict';
// GitDeck commit graph layout: assigns lanes and builds SVG paths.
// Exposed as window.GitGraph (classic script).
(function () {
  const LANE_W = 14;
  const ROW_H = 30;
  const COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f778ba', '#39c5cf', '#ff7b72', '#7ee787'];

  // commits: [{hash, parents:[...]}] in display order (topo).
  function layout(commits) {
    const lanes = [];   // lane i currently "owned" by hash lanes[i] (or null when closed)
    const nodes = [];
    const edges = [];
    const indexOfHash = new Map(commits.map((c, i) => [c.hash, i]));

    commits.forEach((c, row) => {
      let idx = lanes.indexOf(c.hash);
      if (idx === -1) { lanes.push(c.hash); idx = lanes.length - 1; }
      c.lane = idx;

      let firstRouted = false;
      c.parents.forEach((p, pi) => {
        const prow = indexOfHash.get(p);
        const visible = prow !== undefined && prow > row;
        let pidx = lanes.indexOf(p);
        if (pi === 0) {
          // first parent continues this lane
          lanes[idx] = visible ? p : null;
          edges.push({ fromLane: idx, toLane: idx, fromRow: row, toRow: prow, color: idx, visible });
          firstRouted = true;
        } else {
          if (pidx === -1) { lanes.push(visible ? p : null); pidx = lanes.length - 1; }
          edges.push({ fromLane: idx, toLane: pidx, fromRow: row, toRow: prow, color: pidx, visible, merge: true });
        }
      });
      if (c.parents.length === 0) lanes[idx] = null;

      // drop trailing closed lanes
      while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
      nodes.push({ hash: c.hash, lane: idx, row });
    });

    return { nodes, edges, laneCount: Math.max(1, lanes.length) };
  }

  function laneX(lane) { return 12 + lane * LANE_W; }
  function rowY(row) { return ROW_H / 2 + row * ROW_H; }

  function svg(lay) {
    const w = 24 + lay.laneCount * LANE_W;
    const h = lay.nodes.length * ROW_H;
    let s = '<svg class="commit-graph" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    for (const e of lay.edges) {
      if (!e.visible) continue;
      const x1 = laneX(e.fromLane), y1 = rowY(e.fromRow);
      const x2 = laneX(e.toLane), y2 = rowY(e.toRow);
      const mid = (y1 + y2) / 2;
      const color = COLORS[e.color % COLORS.length];
      s += '<path d="M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + mid + ', ' + x2 + ' ' + mid + ', ' + x2 + ' ' + y2 + '" stroke="' + color + '" fill="none" stroke-width="1.6"/>';
    }
    for (const n of lay.nodes) {
      const x = laneX(n.lane), y = rowY(n.row);
      const color = COLORS[n.lane % COLORS.length];
      s += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + color + '" stroke="#0d1117" stroke-width="1"/>';
    }
    s += '</svg>';
    return s;
  }

  window.GitGraph = { layout, svg, ROW_H, LANE_W };
})();
