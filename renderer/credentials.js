'use strict';
// GitDeck credential dialog: answers username / password / passphrase / host-key
// prompts that git and ssh raise during fetch, pull and push. The main process
// relays each prompt here; one dialog at a time, later prompts wait in a queue.
(function () {
  const el = (id) => document.getElementById(id);
  const queue = [];
  let current = null;

  const TITLES = { confirm: 'Confirm connection', secret: 'Authentication required', text: 'Sign in' };

  function show(req) {
    current = req;
    const confirm = req.kind === 'confirm';
    const input = el('cred-input');
    el('cred-title').textContent = TITLES[req.kind] || TITLES.text;
    el('cred-target').textContent = req.target || '';
    el('cred-prompt').textContent = String(req.prompt || '').trim();
    el('cred-field').hidden = confirm;
    el('cred-note').hidden = confirm;
    input.value = '';
    input.type = req.kind === 'secret' ? 'password' : 'text';
    el('cred-reveal').hidden = req.kind !== 'secret';
    el('cred-reveal').textContent = 'Show';
    el('cred-ok').textContent = confirm ? 'Yes, connect' : 'OK';
    el('cred-cancel').textContent = confirm ? 'No' : 'Cancel';
    el('cred-dialog').showModal();
    // git is waiting on the user now, not working: hide the busy card meanwhile.
    document.body.classList.add('busy-paused');
    // For an unknown host key the safe default is No.
    (confirm ? el('cred-cancel') : input).focus();
  }

  function answer(value) {
    if (!current) return;
    const id = current.id;
    current = null;
    el('cred-input').value = '';
    el('cred-dialog').close();
    document.body.classList.remove('busy-paused');
    window.gitdeck.invoke('gd:askpassReply', { id, answer: value });
    if (queue.length) show(queue.shift());
  }

  el('cred-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (current) answer(current.kind === 'confirm' ? 'yes' : el('cred-input').value);
  });
  el('cred-cancel').onclick = () => answer(null);
  // Escape closes a modal dialog; treat it as Cancel.
  el('cred-dialog').addEventListener('cancel', (e) => { e.preventDefault(); answer(null); });
  el('cred-reveal').onclick = () => {
    const input = el('cred-input');
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    el('cred-reveal').textContent = hidden ? 'Hide' : 'Show';
    input.focus();
  };

  if (window.gitdeck && window.gitdeck.onAskpass) {
    window.gitdeck.onAskpass((req) => { if (current) queue.push(req); else show(req); });
  }
})();
