'use strict';
// GitDeck askpass helper: run by git/ssh (through the wrapper that askpass/server.js
// writes) with the prompt as its argument. Relays the prompt to the running GitDeck
// app and prints the answer; exits non-zero when the user cancels.
const net = require('net');

const prompt = process.argv.slice(2).join(' ');
const socketPath = process.env.GITDECK_ASKPASS_SOCKET;
const token = process.env.GITDECK_ASKPASS_TOKEN;

function fail(msg) {
  process.stderr.write('gitdeck-askpass: ' + msg + '\n');
  process.exit(1);
}

if (!socketPath || !token) fail('not started by GitDeck');

let buf = '';
const conn = net.connect(socketPath, () => conn.write(JSON.stringify({ token, prompt }) + '\n'));
conn.setEncoding('utf8');
conn.on('data', (d) => { buf += d; });
conn.on('error', (e) => fail(e.message));
conn.on('end', () => {
  let res = null;
  try { res = JSON.parse(buf); } catch { /* treated as cancel */ }
  if (!res || !res.ok) fail('cancelled');
  process.stdout.write(res.answer + '\n');
  process.exit(0);
});
