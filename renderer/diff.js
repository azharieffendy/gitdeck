'use strict';
// GitDeck unified-diff parser. Produces a file model for rendering.
// Exposed as window.GitDiff (classic script; renderer has no module loader).
(function () {
  function parse(unifiedText) {
    const files = [];
    const lines = unifiedText.split('\n');
    let cur = null;
    let oldNo = 0, newNo = 0;
    let hunk = null;

    const finishFile = () => { if (cur) files.push(cur); cur = null; };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git ')) {
        finishFile();
        const m = line.match(/^diff --git a\/(.*) b\/(.*)$/);
        cur = {
          oldPath: m ? m[1] : line.slice(11),
          newPath: m ? m[2] : line.slice(11),
          isNew: false, isDeleted: false, isBinary: false, isRename: false,
          hunks: [], additions: 0, deletions: 0,
        };
        continue;
      }
      if (!cur) continue;
      if (line.startsWith('new file mode')) { cur.isNew = true; continue; }
      if (line.startsWith('deleted file mode')) { cur.isDeleted = true; continue; }
      if (line.startsWith('Binary files')) { cur.isBinary = true; continue; }
      if (line.startsWith('rename from ')) { cur.isRename = true; cur.oldPath = line.slice(12); continue; }
      if (line.startsWith('rename to ')) { cur.isRename = true; cur.newPath = line.slice(10); continue; }
      if (line.startsWith('index ') || line.startsWith('old mode') || line.startsWith('new mode') ||
          line.startsWith('similarity index') || line.startsWith('dissimilarity index')) continue;

      const hm = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
      if (hm) {
        oldNo = parseInt(hm[1], 10);
        newNo = parseInt(hm[3], 10);
        hunk = { header: line, oldStart: oldNo, newStart: newNo, lines: [] };
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
        }
      }
    }
    finishFile();
    return files;
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderFile(f) {
    let html = '<div class="diff-file">';
    const name = f.isRename ? f.oldPath + ' \u2192 ' + f.newPath :
      f.isNew ? f.newPath : f.isDeleted ? f.oldPath : f.newPath;
    html += '<div class="diff-file-header"><span class="diff-file-name">' + escapeHtml(name) + '</span>';
    if (f.isNew) html += '<span class="badge badge-add">new</span>';
    if (f.isDeleted) html += '<span class="badge badge-del">deleted</span>';
    if (f.isRename) html += '<span class="badge badge-info">renamed</span>';
    html += '<span class="diff-stats"><span class="stat-add">+' + f.additions + '</span> <span class="stat-del">\u2212' + f.deletions + '</span></span></div>';
    if (f.isBinary) {
      html += '<div class="diff-binary">Binary file not shown</div></div>';
      return html;
    }
    html += '<div class="diff-table"><div class="diff-gutter-old"></div>';
    for (const h of f.hunks) {
      html += '<div class="diff-hunk-header">' + escapeHtml(h.header) + '</div>';
      for (const l of h.lines) {
        const cls = l.type === 'add' ? 'add' : l.type === 'del' ? 'del' : l.type === 'note' ? 'note' : 'ctx';
        html += '<div class="diff-row ' + cls + '">' +
          '<span class="diff-no">' + (l.oldNo == null ? '' : l.oldNo) + '</span>' +
          '<span class="diff-no">' + (l.newNo == null ? '' : l.newNo) + '</span>' +
          '<span class="diff-sign">' + (l.type === 'add' ? '+' : l.type === 'del' ? '\u2212' : '') + '</span>' +
          '<span class="diff-text">' + escapeHtml(l.text || ' ') + '</span></div>';
      }
    }
    html += '</div></div>';
    return html;
  }

  function render(unifiedText) {
    if (!unifiedText || !unifiedText.trim()) {
      return '<div class="diff-empty">No changes</div>';
    }
    return parse(unifiedText).map(renderFile).join('') || '<div class="diff-empty">No changes</div>';
  }

  window.GitDiff = { parse, render, renderFile, escapeHtml };
})();
