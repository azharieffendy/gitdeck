'use strict';
// GitDeck git-layer integration test. Run: node test/git-layer.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const g = require('../git.js');
const GitDiff = require('../renderer/diff.js');

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

  await ok('toplevel resolves to a native path', async () => {
    // realpath: expands Windows 8.3 short names and Linux/macOS tmp symlinks, as git does.
    assert.strictEqual(await g.toplevel(REPO), fs.realpathSync.native(REPO));
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

  await ok('log refs carry kind; origin/ is not stripped', async () => {
    await g.run(REPO, ['tag', 'release/1.0']);
    const head = (await g.log(REPO))[0];
    const byName = new Map(head.refs.map((r) => [r.name, r.kind]));
    assert.strictEqual(byName.get('main'), 'local');
    assert.strictEqual(byName.get('origin/main'), 'remote');
    assert.strictEqual(byName.get('release/1.0'), 'tag');
  });

  await ok('non-ASCII paths are not octal-quoted', async () => {
    write('café ünï.txt', 'x\n');
    const st = await g.status(REPO);
    assert.ok(st.untracked.some((e) => e.path === 'café ünï.txt'));
    await g.stageAll(REPO);
    await g.commit(REPO, 'unicode file');
  });

  await ok('remote URL with spaces is parsed', async () => {
    const spaced = path.join(ROOT, 'dir with space', 'r.git');
    await g.run(REPO, ['remote', 'add', 'spaced', spaced]);
    const r = await g.remotes(REPO);
    assert.strictEqual(r.find((x) => x.name === 'spaced').fetch, spaced);
    await g.run(REPO, ['remote', 'remove', 'spaced']);
  });

  await ok('option-like names and hashes are rejected', async () => {
    await assert.rejects(g.createBranch(REPO, '--help'), /Invalid branch name/);
    await assert.rejects(g.switchBranch(REPO, '-f'), /Invalid branch name/);
    await assert.rejects(g.commitDiff(REPO, '--output=x'), /Invalid commit hash/);
  });

  await ok('merge conflicts land in conflicted', async () => {
    await g.createBranch(REPO, 'side');
    write('a.txt', 'main version\n');
    await g.stageAll(REPO);
    await g.commit(REPO, 'main edit');
    await g.switchBranch(REPO, 'side');
    write('a.txt', 'side version\n');
    await g.stageAll(REPO);
    await g.commit(REPO, 'side edit');
    await g.switchBranch(REPO, 'main');
    await assert.rejects(g.merge(REPO, 'side'));
    const st = await g.status(REPO);
    assert.deepStrictEqual(st.conflicted.map((e) => e.path), ['a.txt']);
    assert.ok(!st.staged.some((e) => e.path === 'a.txt'));
    await g.run(REPO, ['merge', '--abort']);
  });

  const LINES = Array.from({ length: 20 }, (_, i) => 'line ' + (i + 1));
  const hunksOf = async (diff) => GitDiff.parse(diff)[0];

  await ok('stage and unstage a single hunk', async () => {
    write('h.txt', LINES.join('\n') + '\n');
    await g.stage(REPO, ['h.txt']);
    await g.commit(REPO, 'twenty lines');
    const edited = LINES.slice();
    edited[0] = 'FIRST'; edited[19] = 'LAST';
    write('h.txt', edited.join('\n') + '\n');
    const f = await hunksOf(await g.diffWorking(REPO, 'h.txt'));
    assert.strictEqual(f.hunks.length, 2);
    await g.applyPatch(REPO, GitDiff.hunkPatch(f, 0), { cached: true });
    const staged = await g.diffStaged(REPO, 'h.txt');
    assert.ok(staged.includes('+FIRST') && !staged.includes('+LAST'));
    const working = await g.diffWorking(REPO, 'h.txt');
    assert.ok(working.includes('+LAST') && !working.includes('+FIRST'));
    const sf = await hunksOf(staged);
    await g.applyPatch(REPO, GitDiff.hunkPatch(sf, 0), { cached: true, reverse: true });
    assert.strictEqual(await g.diffStaged(REPO, 'h.txt'), '');
  });

  await ok('discard a hunk, then discard files', async () => {
    const f = await hunksOf(await g.diffWorking(REPO, 'h.txt'));
    await g.applyPatch(REPO, GitDiff.hunkPatch(f, 1), { reverse: true });
    const left = await hunksOf(await g.diffWorking(REPO, 'h.txt'));
    assert.strictEqual(left.hunks.length, 1);
    assert.ok(left.hunks[0].lines.some((l) => l.text === 'FIRST'));
    write('junk.txt', 'scratch\n');
    await g.discard(REPO, ['h.txt'], ['junk.txt']);
    const st = await g.status(REPO);
    assert.strictEqual(st.unstaged.length + st.untracked.length, 0);
  });

  await ok('amend replaces the last commit', async () => {
    const before = (await g.log(REPO)).length;
    write('amend.txt', 'v1\n');
    await g.stageAll(REPO);
    await g.commit(REPO, 'amend me');
    write('amend.txt', 'v2\n');
    await g.stageAll(REPO);
    await g.commit(REPO, 'amended', { amend: true });
    assert.strictEqual((await g.log(REPO)).length, before + 1);
    assert.strictEqual(await g.lastCommitMessage(REPO), 'amended');
  });

  await ok('stash save, list, diff, pop and drop', async () => {
    write('amend.txt', 'stashed change\n');
    write('new-untracked.txt', 'u\n');
    await g.stashSave(REPO, 'wip one', true);
    let st = await g.status(REPO);
    assert.strictEqual(st.unstaged.length + st.untracked.length, 0);
    let list = await g.stashList(REPO);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].ref, 'stash@{0}');
    assert.ok(list[0].subject.includes('wip one'));
    assert.ok((await g.stashDiff(REPO, 'stash@{0}')).includes('+stashed change'));
    await g.stashPop(REPO, 'stash@{0}');
    assert.ok(fs.readFileSync(path.join(REPO, 'new-untracked.txt'), 'utf8').startsWith('u'));
    assert.strictEqual((await g.stashList(REPO)).length, 0);
    await g.stashSave(REPO, 'wip two', true);
    await g.stashDrop(REPO, 'stash@{0}');
    assert.strictEqual((await g.stashList(REPO)).length, 0);
    st = await g.status(REPO);
    assert.strictEqual(st.unstaged.length + st.untracked.length, 0);
    await assert.rejects(g.stashPop(REPO, '--index'), /Invalid stash reference/);
  });

  await ok('cherry-pick and revert', async () => {
    await g.createBranch(REPO, 'pick');
    await g.switchBranch(REPO, 'pick');
    write('picked.txt', 'from pick\n');
    await g.stageAll(REPO);
    const picked = await g.commit(REPO, 'pick commit');
    await g.switchBranch(REPO, 'main');
    await g.cherryPick(REPO, picked.hash);
    assert.strictEqual((await g.log(REPO))[0].subject, 'pick commit');
    assert.ok(fs.existsSync(path.join(REPO, 'picked.txt')));
    await g.revert(REPO, (await g.log(REPO))[0].hash);
    assert.ok(/^Revert/.test((await g.log(REPO))[0].subject));
    assert.ok(!fs.existsSync(path.join(REPO, 'picked.txt')));
  });

  await ok('conflicting cherry-pick is detected and aborted', async () => {
    const sideTip = (await g.run(REPO, ['rev-parse', 'side'])).trim();
    assert.strictEqual(await g.operationInProgress(REPO), null);
    await assert.rejects(g.cherryPick(REPO, sideTip));
    assert.strictEqual(await g.operationInProgress(REPO), 'cherry-pick');
    await g.abortOperation(REPO, 'cherry-pick');
    assert.strictEqual(await g.operationInProgress(REPO), null);
    await assert.rejects(g.abortOperation(REPO, 'reset'), /Unknown operation/);
  });

  await ok('merge conflict resolved with one side, then continued', async () => {
    await assert.rejects(g.merge(REPO, 'side'));
    assert.strictEqual(await g.operationInProgress(REPO), 'merge');
    assert.ok((await g.conflictDiff(REPO, 'a.txt')).includes('<<<<<<<'));
    await g.resolveConflict(REPO, 'a.txt', 'theirs');
    assert.strictEqual((await g.status(REPO)).conflicted.length, 0);
    assert.strictEqual(fs.readFileSync(path.join(REPO, 'a.txt'), 'utf8').replace(/\r/g, ''), 'side version\n');
    await g.continueOperation(REPO, 'merge');
    assert.strictEqual(await g.operationInProgress(REPO), null);
    assert.strictEqual((await g.log(REPO))[0].parents.length, 2);
  });

  await ok('blame attributes every line', async () => {
    const lines = await g.blame(REPO, 'h.txt');
    assert.strictEqual(lines.length, 20);
    assert.deepStrictEqual(lines.map((l) => l.line), LINES.map((_, i) => i + 1));
    assert.strictEqual(lines[0].text, 'line 1');
    assert.strictEqual(lines[0].author, 'GitDeck Test');
    assert.strictEqual(lines[0].summary, 'twenty lines');
    assert.ok(/^[0-9a-f]{40,64}$/.test(lines[0].hash) && lines[0].time > 0);
  });

  console.log('\nALL ' + passed + ' TESTS PASSED');
})().catch((e) => { console.error('\nFAILED after ' + passed + ' passes:', e.message); process.exit(1); });
