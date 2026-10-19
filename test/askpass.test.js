'use strict';
// GitDeck credential-prompt test: real git asks for credentials through the
// askpass helper, which relays them to this process. Run: node test/askpass.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const g = require('../git.js');
const { startAskpassServer, classifyPrompt, promptTarget } = require('../askpass/server.js');

let passed = 0;
function ok(name, fn) {
  return Promise.resolve(fn()).then(() => { passed++; console.log('  ok -', name); });
}

// `git credential fill` prompts for whatever the request lacks, exactly as
// push/pull/fetch do over HTTPS. An empty helper list keeps the OS store out of it.
const FILL = ['-c', 'credential.helper=', 'credential', 'fill'];
const REQUEST = 'protocol=https\nhost=git.example.test\n\n';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdeck-askpass-test-'));
  let answers = {};
  const seen = [];
  const server = await startAskpassServer(async (req) => {
    seen.push(req);
    const key = Object.keys(answers).find((k) => req.prompt.startsWith(k));
    return key ? answers[key] : null;
  });
  g.configureAskpass(server.env);

  try {
    await ok('prompts are classified', () => {
      assert.strictEqual(classifyPrompt("Username for 'https://github.com': "), 'text');
      assert.strictEqual(classifyPrompt("Password for 'https://me@github.com': "), 'secret');
      assert.strictEqual(classifyPrompt("Enter passphrase for key '/home/me/.ssh/id_ed25519': "), 'secret');
      assert.strictEqual(classifyPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? '), 'confirm');
      assert.strictEqual(promptTarget("Password for 'https://me@github.com': "), 'https://me@github.com');
    });

    await ok('git receives username and password from the dialog', async () => {
      answers = { Username: 'alice', Password: 's3cret pass' };
      const out = await g.run(dir, FILL, { input: REQUEST });
      assert.ok(out.includes('username=alice'), out);
      assert.ok(out.includes('password=s3cret pass'), out);
      assert.deepStrictEqual(seen.map((r) => r.kind), ['text', 'secret']);
      assert.strictEqual(seen[0].target, 'https://git.example.test');
    });

    await ok('cancelling the dialog fails the git command', async () => {
      answers = {};
      await assert.rejects(g.run(dir, FILL, { input: REQUEST }));
    });

    await ok('helper refuses a wrong token', async () => {
      const env = Object.assign({}, process.env, server.env, { GITDECK_ASKPASS_TOKEN: 'forged' });
      answers = { Username: 'alice' };
      const before = seen.length;
      // Async: the server answering this helper runs on this process's event loop.
      const r = await new Promise((resolve) => {
        const p = spawn(process.execPath, [server.env.GITDECK_ASKPASS_CLIENT, 'Username: '], { env });
        let stdout = '';
        p.stdout.on('data', (d) => { stdout += d; });
        p.on('close', (status) => resolve({ status, stdout }));
      });
      assert.notStrictEqual(r.status, 0);
      assert.strictEqual(r.stdout, '');
      assert.strictEqual(seen.length, before, 'prompt must not reach the app');
    });

    console.log('\nALL ' + passed + ' TESTS PASSED');
  } finally {
    g.configureAskpass({});
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error('\nFAILED after ' + passed + ' passes:', e.message); process.exit(1); });
