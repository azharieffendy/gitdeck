'use strict';
// GitDeck editor helper for interactive rebase, run by git as
//   GIT_SEQUENCE_EDITOR="... editor.js seq" <todo-file>
//   GIT_EDITOR="... editor.js msg" <message-file>
// seq: replace git's todo list with the one GitDeck prepared (GITDECK_TODO).
// msg: answer the next queued message (GITDECK_MSGS, a JSON array); null, or an
// empty queue, keeps the message git proposed.
const fs = require('fs');

function main(argv, env) {
  const mode = argv[2], target = argv[argv.length - 1];
  if (!target || argv.length < 4) throw new Error('usage: editor.js seq|msg <file>');
  if (mode === 'seq') {
    fs.writeFileSync(target, fs.readFileSync(env.GITDECK_TODO));
    return;
  }
  if (mode !== 'msg') throw new Error('unknown mode: ' + mode);
  if (!env.GITDECK_MSGS || !fs.existsSync(env.GITDECK_MSGS)) return;
  const queue = JSON.parse(fs.readFileSync(env.GITDECK_MSGS, 'utf8'));
  if (!Array.isArray(queue) || !queue.length) return;
  const next = queue.shift();
  fs.writeFileSync(env.GITDECK_MSGS, JSON.stringify(queue));
  if (typeof next === 'string') fs.writeFileSync(target, next.replace(/\s*$/, '\n'));
}

try { main(process.argv, process.env); }
catch (e) { process.stderr.write('gitdeck editor: ' + e.message + '\n'); process.exit(1); }
