'use strict';
// GitDeck unified-diff parser. Produces a file model for rendering.
// Exposed as window.GitDiff (classic script; renderer has no module loader).
(function () {
  function parse(unifiedText) {
    const files = [];
    const lines = unifiedText.split('\n');
    // A trailing newline yields one empty element that is not a context line.
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    let cur = null;
    let oldNo = 0, newNo = 0;
    let hunk = null;

    // Reset the hunk too, so the next file's ---/+++ headers are not read as content.
    const finishFile = () => { if (cur) files.push(cur); cur = null; hunk = null; };

    for (let i = 0; i < lines.length; i++) {
      // raw keeps a trailing CR so hunk patches still apply to CRLF files;
      // line drops it so CRLF files (common on Windows) render without stray characters.
      const raw = lines[i];
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line.startsWith('diff --git ')) {
        finishFile();
        const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
        cur = {
          oldPath: m ? m[1] : line.slice(11),
          newPath: m ? m[2] : line.slice(11),
          isNew: false, isDeleted: false, isBinary: false, isRename: false,
          headerLines: [line], hunks: [], additions: 0, deletions: 0,
        };
        continue;
      }
      if (!cur) continue;

      const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
      if (hm) {
        oldNo = parseInt(hm[1], 10);
        newNo = parseInt(hm[3], 10);
        hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [], raw: [line] };
        cur.hunks.push(hunk);
        continue;
      }
      if (hunk) {
        if (line.startsWith('+')) {
          hunk.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) });
          cur.additions++;
        } else if (line.startsWith('-')) {
          hunk.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) });
          cur.deletions++;
        } else if (line.startsWith('\\')) {
          hunk.lines.push({ type: 'note', oldNo: null, newNo: null, text: line.slice(1) });
        } else if (line.startsWith(' ') || line === '') {
          hunk.lines.push({ type: 'ctx', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
        } else continue;
        hunk.raw.push(raw);
        continue;
      }

      // File header lines (before the first hunk) are kept for building patches.
      cur.headerLines.push(line);
      if (line.startsWith('new file mode')) cur.isNew = true;
      else if (line.startsWith('deleted file mode')) cur.isDeleted = true;
      else if (line.startsWith('Binary files')) cur.isBinary = true;
      else if (line.startsWith('rename from ')) { cur.isRename = true; cur.oldPath = line.slice(12); }
      else if (line.startsWith('rename to ')) { cur.isRename = true; cur.newPath = line.slice(10); }
    }
    finishFile();
    return files;
  }

  // A standalone patch containing one hunk of a parsed file, for `git apply`.
  function hunkPatch(file, hunkIndex) {
    const h = file.hunks[hunkIndex];
    if (!h) throw new Error('No such hunk');
    return file.headerLines.join('\n') + '\n' + h.raw.join('\n') + '\n';
  }

  // A one-hunk patch that applies only the selected lines (indices into hunk.lines).
  // Forward (staging): an unselected deletion stays as context, an unselected addition
  // is left out. reverse (unstage / discard, applied with --reverse): the other way round,
  // because the target already holds the new side.
  function linesPatch(file, hunkIndex, selected, reverse) {
    const h = file.hunks[hunkIndex];
    if (!h) throw new Error('No such hunk');
    const pick = new Set(selected);
    const body = [];
    let oldCount = 0, newCount = 0, changed = 0, lastKept = false;
    h.lines.forEach((l, i) => {
      const raw = h.raw[i + 1];
      if (l.type === 'note') { if (lastKept) body.push(raw); return; }
      let out = null;
      if (l.type === 'ctx') out = raw;
      else if (pick.has(i)) { out = raw; changed++; }
      else if ((l.type === 'del') !== !!reverse) out = ' ' + raw.slice(1); // becomes context
      lastKept = out !== null;
      if (!lastKept) return;
      body.push(out);
      if (out[0] !== '+') oldCount++;
      if (out[0] !== '-') newCount++;
    });
    if (!changed) throw new Error('Select one or more changed lines first');
    const header = '@@ -' + h.oldStart + ',' + oldCount + ' +' + h.newStart + ',' + newCount + ' @@';
    return file.headerLines.join('\n') + '\n' + header + '\n' + body.join('\n') + '\n';
  }

  // Word-level difference of two lines: [{text, changed}] for each side, or null when
  // the lines are too long to compare cheaply.
  const MAX_WORD_TOKENS = 300;
  function wordDiff(a, b) {
    const ta = a.match(/\w+|\s+|[^\w\s]/g) || [], tb = b.match(/\w+|\s+|[^\w\s]/g) || [];
    if (ta.length > MAX_WORD_TOKENS || tb.length > MAX_WORD_TOKENS) return null;
    // Longest common subsequence table, filled from the end.
    const lcs = Array.from({ length: ta.length + 1 }, () => new Uint16Array(tb.length + 1));
    for (let i = ta.length - 1; i >= 0; i--) {
      for (let j = tb.length - 1; j >= 0; j--) {
        lcs[i][j] = ta[i] === tb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const left = [], right = [];
    const push = (side, text, changed) => {
      const last = side[side.length - 1];
      if (last && last.changed === changed) last.text += text; else side.push({ text, changed });
    };
    let i = 0, j = 0;
    while (i < ta.length || j < tb.length) {
      if (i < ta.length && j < tb.length && ta[i] === tb[j]) { push(left, ta[i++], false); push(right, tb[j++], false); }
      else if (j < tb.length && (i === ta.length || lcs[i][j + 1] >= lcs[i + 1][j])) push(right, tb[j++], true);
      else push(left, ta[i++], true);
    }
    return { left, right };
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const sign = (t) => (t === 'add' ? '+' : t === 'del' ? '−' : '');
  const no = (n) => (n == null ? '' : n);

  // Line text with changed words marked, when the line has a counterpart that is
  // mostly the same (a rewritten line is clearer without word marks).
  function lineHtml(l, other) {
    if (!other || !l.text || !other.text) return escapeHtml(l.text || ' ');
    const wd = l.type === 'del' ? wordDiff(l.text, other.text) : wordDiff(other.text, l.text);
    if (!wd) return escapeHtml(l.text);
    const segs = l.type === 'del' ? wd.left : wd.right;
    const same = segs.filter((s) => !s.changed).reduce((n, s) => n + s.text.trim().length, 0);
    if (same < l.text.trim().length * 0.4) return escapeHtml(l.text);
    return segs.map((s) => (s.changed ? '<span class="wd">' + escapeHtml(s.text) + '</span>' : escapeHtml(s.text))).join('');
  }

  // Each deleted line's replacing addition and vice versa, for word marks.
  function counterparts(h) {
    const map = new Map();
    for (const [l, r] of splitPairs(h)) {
      if (l && r && l.type === 'del' && r.type === 'add') { map.set(l, r); map.set(r, l); }
    }
    return map;
  }

  function unifiedRows(h, fi, hi, selectable) {
    const pairs = counterparts(h);
    let html = '';
    h.lines.forEach((l, li) => {
      const pick = selectable && (l.type === 'add' || l.type === 'del');
      html += '<div class="diff-row ' + l.type + (pick ? ' selectable" data-file="' + fi + '" data-hunk="' + hi + '" data-line="' + li : '') + '">' +
        '<span class="diff-no">' + no(l.oldNo) + '</span>' +
        '<span class="diff-no">' + no(l.newNo) + '</span>' +
        '<span class="diff-sign">' + sign(l.type) + '</span>' +
        '<span class="diff-text">' + lineHtml(l, pairs.get(l)) + '</span></div>';
    });
    return html;
  }

  // Pair each run of deletions with the run of additions that follows it.
  function splitPairs(h) {
    const pairs = [];
    let dels = [], adds = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) pairs.push([dels[i] || null, adds[i] || null]);
      dels = []; adds = [];
    };
    for (const l of h.lines) {
      if (l.type === 'del') { if (adds.length) flush(); dels.push(l); }
      else if (l.type === 'add') adds.push(l);
      else { flush(); pairs.push([l, l]); }
    }
    flush();
    return pairs;
  }

  function splitCell(l, side, other) {
    if (!l) return '<span class="diff-no"></span><span class="diff-text empty"></span>';
    const n = side === 'old' ? l.oldNo : l.newNo;
    const cls = l.type === 'ctx' ? '' : ' ' + l.type;
    return '<span class="diff-no' + cls + '">' + no(n) + '</span>' +
      '<span class="diff-text' + cls + '">' + (l.type === 'ctx' ? escapeHtml(l.text || ' ') : lineHtml(l, other)) + '</span>';
  }

  function splitRows(h) {
    let html = '';
    for (const [left, right] of splitPairs(h)) {
      if (left && left.type === 'note') {
        html += '<div class="diff-row note"><span></span><span></span><span></span><span class="diff-text">' + escapeHtml(left.text) + '</span></div>';
        continue;
      }
      html += '<div class="diff-split-row">' + splitCell(left, 'old', right) + splitCell(right, 'new', left) + '</div>';
    }
    return html;
  }

  // opts.mode: 'unified' (default) | 'split'.
  // opts.hunkActions: [{action, label, title, danger}] -> buttons with data-file/data-hunk.
  function renderFile(f, fi, opts) {
    opts = opts || {};
    let html = '<div class="diff-file">';
    const name = f.isRename ? f.oldPath + ' → ' + f.newPath :
      f.isNew ? f.newPath : f.isDeleted ? f.oldPath : f.newPath;
    html += '<div class="diff-file-header"><span class="diff-file-name">' + escapeHtml(name) + '</span>';
    if (f.isNew) html += '<span class="badge badge-add">new</span>';
    if (f.isDeleted) html += '<span class="badge badge-del">deleted</span>';
    if (f.isRename) html += '<span class="badge badge-ren">renamed</span>';
    html += '<span class="diff-stats"><span class="stat-add">+' + f.additions + '</span> <span class="stat-del">−' + f.deletions + '</span></span></div>';
    if (f.isBinary) return html + '<div class="diff-binary">Binary file not shown</div></div>';

    const split = opts.mode === 'split';
    // Line actions ({lines: true}) work on rows picked in the unified layout.
    const actions = (opts.hunkActions || []).filter((a) => !(a.lines && split));
    const selectable = actions.some((a) => a.lines);
    html += '<div class="diff-table' + (split ? ' split' : '') + '">';
    f.hunks.forEach((h, hi) => {
      html += '<div class="diff-hunk-header"><span class="hunk-title">' + escapeHtml(h.header) + '</span>';
      for (const a of actions) {
        html += '<button class="btn btn-xs hunk-act' + (a.danger ? ' btn-danger' : '') + '" data-action="' + escapeHtml(a.action) +
          '" data-file="' + fi + '" data-hunk="' + hi + '" title="' + escapeHtml(a.title || a.label) + '">' + escapeHtml(a.label) + '</button>';
      }
      html += '</div>';
      html += split ? splitRows(h) : unifiedRows(h, fi, hi, selectable);
    });
    return html + '</div></div>';
  }

  function renderFiles(files, opts) {
    return files.map((f, i) => renderFile(f, i, opts)).join('') || '<div class="diff-empty">No changes</div>';
  }

  function render(unifiedText, opts) {
    if (!unifiedText || !unifiedText.trim()) return '<div class="diff-empty">No changes</div>';
    return renderFiles(parse(unifiedText), opts);
  }

  const api = { parse, hunkPatch, linesPatch, wordDiff, splitPairs, render, renderFile, renderFiles, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node tests
  else window.GitDiff = api;
})();
