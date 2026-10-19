'use strict';
// GitDeck shared form dialog (tags, rename, remotes, worktrees, pull requests, settings).
// formDialog({title, note, ok, fields: [{name, label, type, value, placeholder, options}]})
// resolves to {name: value} on OK, or null when cancelled. type: text (default) |
// textarea | select | checkbox. Classic script: shares globals with app.js.

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
    } else input = '<input id="' + id + '" value="' + e(v) + '"' + ph + ' spellcheck="false" autocomplete="off">';
    return '<label class="fd-field"><span>' + e(f.label) + '</span>' + input + '</label>';
  };
  dlg.innerHTML = '<form method="dialog" class="fd-form"><div class="fd-title">' + e(spec.title) + '</div>' +
    (spec.note ? '<div class="fd-note">' + e(spec.note) + '</div>' : '') +
    spec.fields.map(field).join('') +
    '<div class="cred-actions"><button type="button" class="btn" id="fd-cancel">Cancel</button>' +
    '<button type="submit" class="btn btn-primary" id="fd-ok">' + e(spec.ok || 'OK') + '</button></div></form>';

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
  });
}
