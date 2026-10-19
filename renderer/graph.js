'use strict';
// GitDeck commit graph layout: assigns lanes and builds SVG paths.
// Exposed as window.GitGraph (classic script).
(function () {
  const LANE_W = 14;
  const ROW_H = 30;
  const COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#d29922', '#f778ba', '#39c5cf', '#ff7b72', '#7ee787'];

  function reserveFree(lanes, hash) {
    let i = lanes.indexOf(null);
    if (i === -1) { i = lanes.length; lanes.push(null); }
    lanes[i] = hash;
    return i;
  }

  // commits: [{hash, parents:[...]}] in display order (topo, children first).
  // lanes[i] holds the hash the lane is waiting for. Several lanes may wait for
  // the same commit (a fork point); they all converge into it when it arrives.
  function layout(commits) {
    const rowOf = new Map(commits.map((c, i) => [c.hash, i]));
    const laneOf = new Map();
    const lanes = [];
    const nodes = [];
    let laneCount = 1;

    commits.forEach((c, row) => {
      let idx = lanes.indexOf(c.hash);
      if (idx === -1) idx = reserveFree(lanes, c.hash);
      for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) lanes[i] = null;
      laneOf.set(c.hash, idx);
      nodes.push({ hash: c.hash, lane: idx, row });

      const visible = c.parents.filter((p) => rowOf.has(p));
      // First parent continues this lane (even if another lane already waits for it).
      if (visible.length && visible[0] === c.parents[0]) lanes[idx] = visible[0];
      for (const p of visible) {
        if (p !== c.parents[0] && lanes.indexOf(p) === -1) reserveFree(lanes, p);
      }
      laneCount = Math.max(laneCount, lanes.length);
      while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    });

    const edges = [];
    commits.forEach((c, row) => {
      const from = laneOf.get(c.hash);
      c.parents.forEach((p, pi) => {
        if (!rowOf.has(p)) return;
        const to = laneOf.get(p);
        const merge = pi > 0;
        edges.push({ fromLane: from, toLane: to, fromRow: row, toRow: rowOf.get(p), color: merge ? to : from, merge });
      });
    });

    return { nodes, edges, laneCount };
  }

  function laneX(lane) { return 12 + lane * LANE_W; }
  function rowY(row) { return ROW_H / 2 + row * ROW_H; }

  // Straight lines within a lane. A merge bends out right below the child and
  // then runs down the parent's lane; a fork runs down the child's lane and
  // bends into the parent just above it.
  function edgePath(e) {
    const x1 = laneX(e.fromLane), y1 = rowY(e.fromRow);
    const x2 = laneX(e.toLane), y2 = rowY(e.toRow);
    if (x1 === x2) return 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2;
    const half = ROW_H / 2;
    if (e.merge) {
      return 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + half) + ', ' + x2 + ' ' + (y1 + half) + ', ' + x2 + ' ' + (y1 + ROW_H) +
        ' L ' + x2 + ' ' + y2;
    }
    return 'M ' + x1 + ' ' + y1 + ' L ' + x1 + ' ' + (y2 - ROW_H) +
      ' C ' + x1 + ' ' + (y2 - half) + ', ' + x2 + ' ' + (y2 - half) + ', ' + x2 + ' ' + y2;
  }

  function svg(lay) {
    const w = 24 + lay.laneCount * LANE_W;
    const h = lay.nodes.length * ROW_H;
    let s = '<svg class="commit-graph" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">';
    for (const e of lay.edges) {
      const color = COLORS[e.color % COLORS.length];
      s += '<path d="' + edgePath(e) + '" stroke="' + color + '" fill="none" stroke-width="1.6"/>';
    }
    for (const n of lay.nodes) {
      const x = laneX(n.lane), y = rowY(n.row);
      const color = COLORS[n.lane % COLORS.length];
      s += '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + color + '" stroke="#0d1117" stroke-width="1"/>';
    }
    s += '</svg>';
    return s;
  }

  const api = { layout, svg, ROW_H, LANE_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node tests
  else window.GitGraph = api;
})();
