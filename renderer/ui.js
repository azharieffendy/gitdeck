'use strict';
// GitDeck shared dialogs: formDialog (tags, rename, remotes, worktrees, pull requests,
// clone, settings) and confirmDialog (a styled window.confirm replacement).
// formDialog({title, note, ok, fields, onOpen}) resolves to {name: value} on OK, or
// null when cancelled. Field type: text (default) | textarea | select | checkbox |
// folder (readonly + Browse… through gd:pickFolder). onOpen(dlg) runs once the dialog
// is shown, for live wiring. Classic script: shares globals with app.js.

function formDialog(spec) {
  const dlg = document.getElementById('form-dialog');
  const e = window.GitDiff.escapeHtml;
  const field = (f) => {
    const id = 'fd-' + f.name;
    const v = f.value == null ? '' : String(f.value);
    const ph = f.placeholder ? ' placeholder="' + e(f.placeholder) + '"' : '';
    if (f.type === 'checkbox') {
      return '<label class="check fd-check"><input type="checkbox" id="' + id + '"' + (f.value ? ' checked' : '') + '> ' + e(f.label) + '</label>';
    }
    let input;
    if (f.type === 'textarea') input = '<textarea id="' + id + '" rows="' + (f.rows || 6) + '"' + ph + ' spellcheck="true">' + e(v) + '</textarea>';
    else if (f.type === 'select') {
      input = '<select id="' + id + '">' + f.options.map((o) => '<option value="' + e(o.value) + '"' +
        (o.value === v ? ' selected' : '') + '>' + e(o.label) + '</option>').join('') + '</select>';
    } else if (f.type === 'folder') {
      input = '<div class="fd-folder"><input id="' + id + '" value="' + e(v) + '" placeholder="' +
        e(f.placeholder || 'Choose a folder…') + '" spellcheck="false" autocomplete="off" readonly>' +
        '<button type="button" class="btn btn-sm" id="' + id + '-browse">Browse…</button></div>';
    } else input = '<input id="' + id + '" value="' + e(v) + '"' + ph + ' spellcheck="false" autocomplete="off">';
    return '<label class="fd-field"><span>' + e(f.label) + '</span>' + input + '</label>';
  };
  dlg.innerHTML = '<form method="dialog" class="fd-form"><div class="fd-title">' + e(spec.title) + '</div>' +
    (spec.note ? '<div class="fd-note">' + e(spec.note) + '</div>' : '') +
    spec.fields.map(field).join('') +
    '<div class="cred-actions"><button type="button" class="btn" id="fd-cancel">Cancel</button>' +
    '<button type="submit" class="btn btn-primary" id="fd-ok">' + e(spec.ok || 'OK') + '</button></div></form>';

  for (const f of spec.fields.filter((x) => x.type === 'folder')) {
    const input = dlg.querySelector('#fd-' + f.name);
    const browse = dlg.querySelector('#fd-' + f.name + '-browse');
    if (input && browse) browse.onclick = async () => {
      try {
        const dir = await api('gd:pickFolder', { title: f.pickTitle || 'Choose folder' });
        if (dir) {
          input.value = dir;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  return new Promise((resolve) => {
    let result = null;
    dlg.querySelector('#fd-cancel').onclick = () => dlg.close();
    dlg.querySelector('form').onsubmit = () => {
      result = {};
      for (const f of spec.fields) {
        const el = dlg.querySelector('#fd-' + f.name);
        result[f.name] = f.type === 'checkbox' ? el.checked : el.value;
      }
    };
    dlg.onclose = () => resolve(result);
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox]), textarea, select');
    if (first) first.focus();
    if (spec.onOpen) spec.onOpen(dlg);
  });
}

// Styled confirmation in place of the browser's window.confirm.
// confirmDialog(message, {title, ok, danger}) resolves true on OK,
// false on Cancel or Escape. Enter confirms; the OK button is first focused.
function confirmDialog(message, spec = {}) {
  const dlg = document.getElementById('confirm-dialog');
  if (dlg.open) return Promise.resolve(false); // a second confirm while one is showing auto-cancels
  const e = window.GitDiff.escapeHtml;
  dlg.innerHTML = '<form method="dialog" class="fd-form"><div class="fd-title">' + e(spec.title || 'Confirm') + '</div>' +
    '<div class="fd-msg">' + e(message) + '</div>' +
    '<div class="cred-actions"><button type="button" class="btn" id="cd-cancel">Cancel</button>' +
    '<button type="submit" class="btn ' + (spec.danger ? 'btn-danger' : 'btn-primary') + '" id="cd-ok">' +
    e(spec.ok || 'OK') + '</button></div></form>';
  return new Promise((resolve) => {
    let result = false;
    dlg.querySelector('#cd-cancel').onclick = () => dlg.close();
    dlg.querySelector('form').onsubmit = () => { result = true; };
    dlg.onclose = () => resolve(result);
    dlg.showModal();
    dlg.querySelector('#cd-ok').focus();
  });
}
