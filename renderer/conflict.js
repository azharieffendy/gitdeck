'use strict';
// GitDeck three-way merge editor for a conflicted file: per-block choice of ours /
// theirs / both / base, an editable result, and "save & mark resolved".
// Uses window.GitMerge for the model. Classic script: shares globals with app.js.

const MERGE_CHOICES = [
  ['ours', 'Ours'], ['theirs', 'Theirs'], ['ours-theirs', 'Ours, then theirs'], ['theirs-ours', 'Theirs, then ours'], ['base', 'Base'],
];
const CONTEXT_LINES = 3;

const noCr = (lines) => lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

function mergeSide(title, lines, cls) {
  const body = lines == null ? '<div class="mg-none">Not available: use "Show base" to add it</div>'
    : lines.length ? noCr(lines).map((l) => '<div class="mg-line">' + esc(l || ' ') + '</div>').join('') : '<div class="mg-none">(empty)</div>';
  return '<div class="mg-side ' + cls + '"><div class="mg-side-title">' + esc(title) + '</div>' + body + '</div>';
}

function mergeContext(lines) {
  const l = noCr(lines);
  const show = (arr) => arr.map((x) => '<div class="mg-line">' + esc(x || ' ') + '</div>').join('');
  if (l.length <= CONTEXT_LINES * 2 + 1) return '<div class="mg-context">' + show(l) + '</div>';
  return '<div class="mg-context">' + show(l.slice(0, CONTEXT_LINES)) +
    '<div class="mg-skip">… ' + (l.length - CONTEXT_LINES * 2) + ' unchanged lines …</div>' + show(l.slice(-CONTEXT_LINES)) + '</div>';
}

// Whole-file fallback (binary, deleted on one side, or unreadable).
function conflictFallback(path, why) {
  detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span class="badge badge-conflict">conflict</span></div>' +
    '<div class="conflict-tools"><div class="conflict-hint">' + esc(why) + ' Pick one side for the whole file, or fix it in your editor and mark it resolved.</div>' +
    '<div class="actions"><button class="btn btn-sm" id="act-ours">Take ours (current branch)</button>' +
    '<button class="btn btn-sm" id="act-theirs">Take theirs (incoming)</button>' +
    '<button class="btn btn-sm btn-primary" id="act-resolved">Mark resolved</button></div></div>');
  wireWholeFile(path);
}

function wireWholeFile(path) {
  const resolve = (side) => async () => {
    try {
      await api('gd:resolveConflict', { repo: state.repo, path, side });
      toast('Resolved ' + path + ' with ' + side, 'success');
      await refreshAll();
      reselectFile();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#act-ours').onclick = resolve('ours');
  $('#act-theirs').onclick = resolve('theirs');
  const done = $('#act-resolved');
  if (done) done.onclick = async () => { await act('gd:stagePaths', 'Marked ' + path + ' resolved', { paths: [path] }); reselectFile(); };
}

async function showConflict(path) {
  state.detailFiles = [];
  state.redrawDetail = null;
  let text;
  try { text = await api('gd:readFile', { repo: state.repo, path }); }
  catch (e) { conflictFallback(path, e.message + '.'); return; }
  const crlf = text.includes('\r\n');
  const segs = window.GitMerge.parseConflicts(text);
  const total = window.GitMerge.conflictCount(segs);
  if (!total) { conflictFallback(path, 'No conflict markers left in the file.'); return; }
  const choices = [];
  const hasBase = segs.some((s) => s.type === 'conflict' && s.base);
  const result = () => noCr(window.GitMerge.resolve(segs, choices).split('\n')).join('\n');

  let k = 0;
  const blocks = segs.map((s) => {
    if (s.type === 'text') return mergeContext(s.lines);
    const i = k++;
    return '<div class="mg-block" data-k="' + i + '"><div class="mg-block-head"><span>Conflict ' + (i + 1) + ' of ' + total + '</span>' +
      '<span class="seg">' + MERGE_CHOICES.filter(([v]) => v !== 'base' || s.base).map(([v, l]) =>
        '<button class="seg-btn mg-pick" data-k="' + i + '" data-choice="' + v + '">' + l + '</button>').join('') + '</span></div>' +
      '<div class="mg-sides' + (s.base ? ' three' : '') + '">' + mergeSide('Ours: ' + (s.oursLabel || 'current'), s.ours, 'ours') +
      (s.base ? mergeSide('Base: ' + (s.baseLabel || 'common ancestor'), s.base, 'base') : '') +
      mergeSide('Theirs: ' + (s.theirsLabel || 'incoming'), s.theirs, 'theirs') + '</div></div>';
  }).join('');

  detail('<div class="detail-header"><span class="title">' + esc(path) + '</span><span class="badge badge-conflict">' + total + ' conflict' + (total > 1 ? 's' : '') + '</span>' +
    (hasBase ? '' : '<button class="btn btn-sm" id="act-show-base" title="Rewrite the markers with the common ancestor">Show base</button>') +
    '<button class="btn btn-sm" id="act-ours">All ours</button><button class="btn btn-sm" id="act-theirs">All theirs</button></div>' +
    '<div class="merge-editor"><div class="mg-blocks">' + blocks + '</div>' +
    '<div class="mg-result"><div class="mg-side-title">Result <span class="mg-hint">Picking a side rewrites this; edit it last.</span></div>' +
    '<textarea id="mg-result" spellcheck="false" wrap="off"></textarea>' +
    '<div class="commit-row"><span class="commit-hint" id="mg-left"></span>' +
    '<button class="btn btn-primary" id="act-save-resolved">Save &amp; mark resolved</button></div></div></div>');

  const area = $('#mg-result');
  const update = () => {
    area.value = result();
    const left = total - choices.filter(Boolean).length;
    $('#mg-left').textContent = left ? left + ' conflict(s) not chosen yet' : 'All conflicts chosen';
    document.querySelectorAll('.mg-pick').forEach((b) => b.classList.toggle('active', choices[Number(b.dataset.k)] === b.dataset.choice));
  };
  document.querySelectorAll('.mg-pick').forEach((b) => {
    b.onclick = () => { choices[Number(b.dataset.k)] = b.dataset.choice; update(); };
  });
  const showBase = $('#act-show-base');
  if (showBase) {
    showBase.onclick = async () => {
      if (!window.confirm('Rewrite ' + path + ' with base sections? Edits made to it since the conflict are lost.')) return;
      try { await api('gd:conflictWithBase', { repo: state.repo, path }); showConflict(path); }
      catch (e) { toast(e.message, 'error'); }
    };
  }
  wireWholeFile(path);
  $('#act-save-resolved').onclick = async () => {
    const value = area.value;
    if (window.GitMerge.hasMarkers(value) && !window.confirm('The result still has conflict markers. Save it as resolved anyway?')) return;
    try {
      await api('gd:saveResolved', { repo: state.repo, path, content: crlf ? value.replace(/\r?\n/g, '\r\n') : value });
      toast('Resolved ' + path, 'success');
      await refreshAll();
      reselectFile();
    } catch (e) { toast(e.message, 'error'); }
  };
  update();
}
