'use strict';
// GitDeck three-way merge model: parse a file with conflict markers into plain text and
// conflict blocks, then rebuild it from a choice per block.
// Exposed as window.GitMerge (classic script); module.exports for node tests.
(function () {
  const START = /^<<<<<<<( |$)/, BASE = /^\|\|\|\|\|\|\|( |$)/, MID = /^=======$/, END = /^>>>>>>>( |$)/;
  const bare = (l) => (l.endsWith('\r') ? l.slice(0, -1) : l);
  const label = (l) => bare(l).slice(8);

  // -> [{type:'text', lines}, {type:'conflict', ours, base, theirs, oursLabel, theirsLabel}]
  // Lines keep a trailing CR so CRLF files are written back unchanged.
  function parseConflicts(text) {
    const segs = [];
    let textLines = [];
    let c = null, part = null, rawBlock = [];
    const flushText = () => { if (textLines.length) segs.push({ type: 'text', lines: textLines }); textLines = []; };
    for (const line of text.split('\n')) {
      const b = bare(line);
      if (!c) {
        if (START.test(b)) {
          c = { type: 'conflict', ours: [], base: null, theirs: [], oursLabel: label(line), theirsLabel: '' };
          part = 'ours';
          rawBlock = [line];
        } else textLines.push(line);
        continue;
      }
      rawBlock.push(line);
      if (part === 'ours' && BASE.test(b)) { c.base = []; c.baseLabel = label(line); part = 'base'; }
      else if ((part === 'ours' || part === 'base') && MID.test(b)) part = 'theirs';
      else if (part === 'theirs' && END.test(b)) {
        c.theirsLabel = label(line);
        flushText();
        segs.push(c);
        c = null;
      } else c[part].push(line);
    }
    // An unterminated block is not a conflict: keep its lines as text.
    if (c) textLines.push(...rawBlock);
    flushText();
    return segs;
  }

  function blockLines(c, choice) {
    switch (choice) {
      case 'ours': return c.ours;
      case 'theirs': return c.theirs;
      case 'ours-theirs': return c.ours.concat(c.theirs);
      case 'theirs-ours': return c.theirs.concat(c.ours);
      case 'base': return c.base || [];
      default: { // unresolved: keep the markers
        const eol = (c.ours[0] || c.theirs[0] || '').endsWith('\r') ? '\r' : '';
        const mark = (m, l) => (l ? m + ' ' + l : m) + eol;
        const out = [mark('<<<<<<<', c.oursLabel), ...c.ours];
        if (c.base) out.push(mark('|||||||', c.baseLabel), ...c.base);
        return out.concat([mark('=======', '')], c.theirs, [mark('>>>>>>>', c.theirsLabel)]);
      }
    }
  }

  // choices[k] picks the k-th conflict's result; a missing choice keeps its markers.
  function resolve(segs, choices) {
    const out = [];
    let k = 0;
    for (const s of segs) out.push(...(s.type === 'text' ? s.lines : blockLines(s, choices[k++])));
    return out.join('\n');
  }

  const conflictCount = (segs) => segs.filter((s) => s.type === 'conflict').length;
  const hasMarkers = (text) => text.split('\n').some((l) => START.test(bare(l)) || END.test(bare(l)));

  const api = { parseConflicts, resolve, conflictCount, hasMarkers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.GitMerge = api;
})();
