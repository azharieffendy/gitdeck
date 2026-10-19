'use strict';
// GitDeck credential prompts. git (GIT_ASKPASS) and OpenSSH (SSH_ASKPASS) run a
// helper with the prompt text as its argument and read the answer from its stdout.
// GitDeck points both at askpass/client.js, which relays the prompt over a private
// local socket (a named pipe on Windows, a Unix socket on Linux/macOS) to the app.
// Plain Node, no Electron dependency, so it can be tested with plain node.
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const MAX_REQUEST = 64 * 1024;
const CLIENT = path.join(__dirname, 'client.js');

// 'confirm' for ssh yes/no questions (e.g. unknown host key), 'secret' for anything
// that must be masked, otherwise 'text' (e.g. a username).
function classifyPrompt(prompt) {
  const p = String(prompt || '');
  if (/\(yes\/no(\/\[fingerprint\])?\)/i.test(p)) return 'confirm';
  if (/pass(word|phrase)|\bpin\b|token|secret|one-time|verification code/i.test(p)) return 'secret';
  return 'text';
}

// The quoted URL/host/key in prompts such as "Password for 'https://u@host': ".
function promptTarget(prompt) {
  const m = /'([^']+)'/.exec(String(prompt || ''));
  return m ? m[1] : null;
}

// Wrapper scripts, written fresh per session so they are executable and outside
// any app archive. The node binary and client path come from the environment.
function writeHelper(dir) {
  if (process.platform === 'win32') {
    const file = path.join(dir, 'askpass.cmd');
    fs.writeFileSync(file, '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n' +
      '"%GITDECK_ASKPASS_NODE%" "%GITDECK_ASKPASS_CLIENT%" %*\r\n');
    return file;
  }
  const file = path.join(dir, 'askpass.sh');
  fs.writeFileSync(file, '#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "$GITDECK_ASKPASS_NODE" "$GITDECK_ASKPASS_CLIENT" "$@"\n',
    { mode: 0o700 });
  return file;
}

function sameToken(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// onPrompt({prompt, kind, target}) resolves to the answer string, or null to cancel.
// Resolves to {env, close}: env goes into every git invocation.
function startAskpassServer(onPrompt) {
  const token = crypto.randomBytes(24).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdeck-askpass-')); // 0700 on POSIX
  const helper = writeHelper(dir);
  const socketPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\gitdeck-askpass-' + crypto.randomBytes(12).toString('hex')
    : path.join(dir, 'sock');

  const server = net.createServer((sock) => {
    let buf = '';
    let handled = false;
    const reply = (obj) => { if (!sock.destroyed) sock.end(JSON.stringify(obj) + '\n'); };
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      if (handled) return;
      buf += chunk;
      if (buf.length > MAX_REQUEST) { sock.destroy(); return; }
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      handled = true;
      let req;
      try { req = JSON.parse(buf.slice(0, nl)); } catch { reply({ ok: false }); return; }
      if (!sameToken(req.token, token)) { reply({ ok: false }); return; }
      const prompt = String(req.prompt || '');
      Promise.resolve()
        .then(() => onPrompt({ prompt, kind: classifyPrompt(prompt), target: promptTarget(prompt) }))
        .then((answer) => reply(answer == null ? { ok: false } : { ok: true, answer: String(answer) }),
          () => reply({ ok: false }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      const env = {
        GIT_ASKPASS: helper,
        SSH_ASKPASS: helper,
        SSH_ASKPASS_REQUIRE: 'force', // OpenSSH 8.4+: use the helper even with no DISPLAY
        GITDECK_ASKPASS_NODE: process.execPath,
        GITDECK_ASKPASS_CLIENT: CLIENT,
        GITDECK_ASKPASS_SOCKET: socketPath,
        GITDECK_ASKPASS_TOKEN: token,
      };
      const close = () => {
        server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      };
      resolve({ env, close });
    });
  });
}

module.exports = { startAskpassServer, classifyPrompt, promptTarget };
