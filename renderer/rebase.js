'use strict';
// GitDeck interactive rebase editor: pick / reword / squash / fixup / drop and
// reorder the commits after a base commit, then run it. Classic script.

const REBASE_ACTIONS = [
  ['pick', 'Pick'], ['reword', 'Reword'], ['squash', 'Squash into previous'], ['fixup', 'Fixup (drop message)'], ['drop', 'Drop'],
];

async function showRebase(base) {
  let commits;
  try { commits = await api('gd:rebaseCommits', { repo: state.repo, base }); }
  catch (e) { toast(e.message, 'error'); return; }
  if (!commits.length) { toast('No commits after this one on ' + state.branch, 'error'); return; }
  const steps = commits.map((c) => ({ hash: c.hash, short: c.short, subject: c.subject, action: 'pick', message: '' }));
  state.detailFiles = [];
  state.redrawDetail = null;

  const draw = () => {
    const rows = steps.map((s, i) => {
      const needsMsg = s.action === 'reword' || s.action === 'squash';
      return '<div class="rb-row rb-' + s.action + '" data-i="' + i + '">' +
        '<span class="rb-move"><button class="btn btn-xs rb-up" title="Move up"' + (i ? '' : ' disabled') + '>&#9650;</button>' +
        '<button class="btn btn-xs rb-down" title="Move down"' + (i < steps.length - 1 ? '' : ' disabled') + '>&#9660;</button></span>' +
        '<select class="rb-action">' + REBASE_ACTIONS.map(([v, l]) => '<option value="' + v + '"' + (v === s.action ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<span class="blame-hash">' + esc(s.short) + '</span><span class="rb-subject">' + esc(s.subject) + '</span>' +
        (needsMsg ? '<textarea class="rb-msg" rows="3" spellcheck="true" placeholder="' +
          (s.action === 'reword' ? 'New message (empty keeps the current one)' : 'Message for the combined commit (empty keeps all messages)') +
          '">' + esc(s.message) + '</textarea>' : '') + '</div>';
    }).join('');
    detail('<div class="detail-header"><span class="title">Interactive rebase</span>' +
      '<span class="detail-label">' + steps.length + ' commits onto ' + esc(base.slice(0, 12)) + '</span>' +
      '<button class="btn btn-sm" id="rb-cancel">Cancel</button>' +
      '<button class="btn btn-sm btn-primary" id="rb-start">Start rebase</button></div>' +
      '<div class="detail-meta"><div class="byline">Oldest commit first. Squash and fixup join a commit into the one above it. ' +
      'The rewritten commits get new hashes: do not rebase commits others already pulled.</div></div>' +
      '<div class="rb-list">' + rows + '</div>');
    wire();
  };

  const move = (i, d) => { const [s] = steps.splice(i, 1); steps.splice(i + d, 0, s); draw(); };
  const wire = () => {
    document.querySelectorAll('.rb-row').forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelector('.rb-up').onclick = () => move(i, -1);
      row.querySelector('.rb-down').onclick = () => move(i, 1);
      row.querySelector('.rb-action').onchange = (ev) => { steps[i].action = ev.target.value; draw(); };
      const msg = row.querySelector('.rb-msg');
      if (msg) msg.oninput = () => { steps[i].message = msg.value; };
    });
    $('#rb-cancel').onclick = () => showCommitDetail(base);
    $('#rb-start').onclick = start;
  };

  const start = async () => {
    const plan = steps.map((s) => ({
      hash: s.hash, action: s.action,
      message: (s.action === 'reword' || s.action === 'squash') && s.message.trim() ? s.message : null,
    }));
    const dropped = plan.filter((s) => s.action === 'drop').length;
    if (!(await confirmDialog('Rewrite ' + steps.length + ' commits on ' + state.branch + (dropped ? ' and drop ' + dropped : '') + '?',
      { title: 'Interactive rebase', ok: 'Rebase', danger: true }))) return;
    $('#rb-start').disabled = true;
    toast('Rebasing…', '', true);
    try {
      await api('gd:rebase', { repo: state.repo, base, steps: plan });
      toast('Rebase complete', 'success');
      state.selectedCommits = [];
      detail('');
      await refreshAll();
    } catch (e) {
      toast(e.message, 'error');
      await refreshAll().catch(() => {});
      if (state.op === 'rebase') setView('worktree'); // stopped on a conflict
      else draw();
    }
  };
  draw();
}
