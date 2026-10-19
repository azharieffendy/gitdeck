'use strict';
// GitDeck git-layer integration test. Run: node test/git-layer.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const g = require('../git.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdeck-test-'));
const REPO = path.join(ROOT, 'repo');
const BARE = path.join(ROOT, 'remote.git');
const CLONE = path.join(ROOT, 'clone');

function write(rel, content) {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

let passed = 0;
function ok(name, fn) {
  return Promise.resolve(fn()).then(() => { passed++; console.log('  ok -', name); });
}

(async () => {
  fs.mkdirSync(REPO, { recursive: true });
  await g.run(REPO, ['init', '-b', 'main']);
  await g.run(REPO, ['config', 'user.name', 'GitDeck Test']);
  await g.run(REPO, ['config', 'user.email', 'test@gitdeck.local']);

  await ok('toplevel resolves', async () => {
    assert.strictEqual(await g.toplevel(REPO), REPO);
  });

  await ok('untracked file detected', async () => {
    write('a.txt', 'line1\nline2\n');
    const st = await g.status(REPO);
    assert.strictEqual(st.untracked.length, 1);
    assert.strictEqual(st.untracked[0].path, 'a.txt');
  });

  await ok('stage then status shows staged', async () => {
    await g.stage(REPO, ['a.txt']);
    const st = await g.status(REPO);
    assert.strictEqual(st.staged.length, 1);
    assert.strictEqual(st.staged[0].x, 'A');
  });

  await ok('staged diff has +lines', async () => {
    const d = await g.diffStaged(REPO, 'a.txt');
    assert.ok(d.includes('+line1'));
  });

  await ok('unstage clears index', async () => {
    await g.unstage(REPO, ['a.txt']);
    const st = await g.status(REPO);
    assert.strictEqual(st.staged.length, 0);
    assert.strictEqual(st.untracked.length, 1);
  });

  await ok('commit produces head', async () => {
    await g.stageAll(REPO);
    const h = await g.commit(REPO, 'first commit');
    assert.ok(h && h.hash && h.subject === 'first commit');
  });

  await ok('modification detected + working diff', async () => {
    write('a.txt', 'line1\nline2 changed\n');
    write('b/c.txt', 'nested\n');
    const st = await g.status(REPO);
    assert.ok(st.unstaged.some((e) => e.path === 'a.txt' && e.y === 'M'));
    assert.ok(st.untracked.some((e) => e.path === 'b/c.txt'));
    const d = await g.diffWorking(REPO, 'a.txt');
    assert.ok(d.includes('-line2') && d.includes('+line2 changed'));
  });

  await ok('second commit', async () => {
    await g.stageAll(REPO);
    await g.commit(REPO, 'second commit');
    const log = await g.log(REPO);
    assert.strictEqual(log.length, 2);
    assert.ok(log[0].isHead);
  });

  await ok('branch create/switch', async () => {
    await g.createBranch(REPO, 'feat');
    await g.switchBranch(REPO, 'feat');
    assert.strictEqual(await g.currentBranch(REPO), 'feat');
    write('feat.txt', 'feature work\n');
    await g.stageAll(REPO);
    await g.commit(REPO, 'feature commit');
  });

  await ok('merge back to main', async () => {
    await g.switchBranch(REPO, 'main');
    write('main-only.txt', 'work on main');
    await g.stageAll(REPO);
    await g.commit(REPO, 'main side commit');
    await g.merge(REPO, 'feat');
    const log = await g.log(REPO);
    const merge = log[0];
    assert.strictEqual(merge.parents.length, 2);
    assert.ok(fs.existsSync(path.join(REPO, 'feat.txt')));
  });

  await ok('push sets upstream; aheadBehind known', async () => {
    await g.run(REPO, ['init', '--bare', '-b', 'main', BARE]);
    await g.run(REPO, ['remote', 'add', 'origin', BARE]);
    const res = await g.push(REPO);
    assert.strictEqual(res.branch, 'main');
    const ab = await g.aheadBehind(REPO);
    assert.ok(ab && ab.ahead === 0 && ab.behind === 0);
  });

  await ok('clone + independent commit + push', async () => {
    await g.run(ROOT, ['clone', BARE, CLONE]);
    await g.run(CLONE, ['config', 'user.name', 'Other Dev']);
    await g.run(CLONE, ['config', 'user.email', 'other@gitdeck.local']);
    fs.writeFileSync(path.join(CLONE, 'from-clone.txt'), 'hello\n');
    await g.run(CLONE, ['add', '-A']);
    await g.run(CLONE, ['commit', '-m', 'from clone']);
    await g.run(CLONE, ['push']);
  });

  await ok('pull brings foreign commit', async () => {
    await g.pull(REPO);
    const log = await g.log(REPO);
    assert.ok(log.some((c) => c.subject === 'from clone'));
  });

  await ok('branches listing', async () => {
    const b = await g.branches(REPO);
    assert.ok(b.local.some((x) => x.name === 'main' && x.isCurrent));
    assert.ok(b.local.some((x) => x.name === 'feat'));
    assert.ok(b.remote.some((x) => x.name === 'origin/main'));
  });

  await ok('remotes listing', async () => {
    const r = await g.remotes(REPO);
    assert.strictEqual(r.length, 1);
    assert.strictEqual(r[0].name, 'origin');
    assert.strictEqual(r[0].fetch, BARE);
  });

  await ok('delete merged branch', async () => {
    await g.deleteBranch(REPO, 'feat');
    const b = await g.branches(REPO);
    assert.ok(!b.local.some((x) => x.name === 'feat'));
  });

  await ok('commitMeta and commitDiff', async () => {
    const log = await g.log(REPO);
    const head = log[0];
    const meta = await g.commitMeta(REPO, head.hash);
    assert.strictEqual(meta.hash, head.hash);
    const diff = await g.commitDiff(REPO, head.hash);
    assert.ok(diff.includes('diff --git'));
  });

  console.log('\nALL ' + passed + ' TESTS PASSED');
})().catch((e) => { console.error('\nFAILED after ' + passed + ' passes:', e.message); process.exit(1); });
