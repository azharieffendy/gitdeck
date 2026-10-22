'use strict';
// GitDeck tests for the SmartGit-parity features: line staging, word diff, merge
// editor model, Markdown, GitHub remotes, tags/remotes/reflog, cherry-pick of
// several commits, stash of selected files, blame at a revision, templates,
// worktrees, safe file access and interactive rebase. Run: node test/features.test.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const g = require('../git.js');
const more = require('../git-more.js');
const gh = require('../github.js');
const GitDiff = require('../renderer/diff.js');
const GitMerge = require('../renderer/merge.js');
const GitMarkdown = require('../renderer/markdown.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdeck-feat-'));
const REPO = path.join(ROOT, 'repo');
const BARE = path.join(ROOT, 'remote.git');

const write = (rel, content) => {
  const p = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r/g, '');
const commitAll = async (msg) => {
  await g.stageAll(REPO);
  await g.commit(REPO, msg);
  return (await g.run(REPO, ['rev-parse', 'HEAD'])).trim();
};
const subjects = async () => (await g.log(REPO)).map((c) => c.subject);

let passed = 0;
function ok(name, fn) {
  return Promise.resolve(fn()).then(() => { passed++; console.log('  ok -', name); });
}

(async () => {
  // ---- pure helpers -------------------------------------------------------------
  await ok('wordDiff marks only the changed word', () => {
    const d = GitDiff.wordDiff('const a = 1;', 'const b = 1;');
    assert.deepStrictEqual(d.left.filter((s) => s.changed).map((s) => s.text), ['a']);
    assert.deepStrictEqual(d.right.filter((s) => s.changed).map((s) => s.text), ['b']);
    assert.strictEqual(d.left.map((s) => s.text).join(''), 'const a = 1;');
    assert.strictEqual(GitDiff.wordDiff('x '.repeat(400), 'y'), null);
  });

  await ok('linesPatch keeps unselected changes out of the patch', () => {
    const f = GitDiff.parse([
      'diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,3 +1,3 @@', ' a', '-b', '-c', '+B', '+C', '',
    ].join('\n'))[0];
    // lines: 0 ctx a, 1 del b, 2 del c, 3 add B, 4 add C. Stage "b -> B" only.
    const fwd = GitDiff.linesPatch(f, 0, [1, 3], false);
    assert.ok(fwd.includes('@@ -1,3 +1,3 @@\n a\n-b\n c\n+B\n'), fwd);
    const rev = GitDiff.linesPatch(f, 0, [4], true);
    assert.ok(rev.includes('@@ -1,2 +1,3 @@\n a\n B\n+C\n'), rev);
    assert.throws(() => GitDiff.linesPatch(f, 0, [0], false), /Select one or more/);
  });

  await ok('parseConflicts / resolve with diff3 base', () => {
    const text = 'top\n<<<<<<< HEAD\nmine\n||||||| base\norig\n=======\ntheirs\n>>>>>>> side\nend\n';
    const segs = GitMerge.parseConflicts(text);
    assert.strictEqual(GitMerge.conflictCount(segs), 1);
    const c = segs.find((s) => s.type === 'conflict');
    assert.deepStrictEqual([c.ours, c.base, c.theirs].map((l) => l.join('|')), ['mine', 'orig', 'theirs']);
    assert.strictEqual(GitMerge.resolve(segs, ['ours-theirs']), 'top\nmine\ntheirs\nend\n');
    assert.strictEqual(GitMerge.resolve(segs, ['base']), 'top\norig\nend\n');
    assert.ok(GitMerge.hasMarkers(GitMerge.resolve(segs, [])));
  });

  await ok('markdown escapes HTML and only links http(s)', () => {
    const html = GitMarkdown.render('# Hi\n\n<script>x</script> **b** [ok](https://e.x) [no](javascript:alert(1))\n\n- [x] done');
    assert.ok(html.includes('<h1>Hi</h1>'));
    assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
    assert.ok(html.includes('<strong>b</strong>') && html.includes('href="https://e.x"'));
    assert.ok(!/href="javascript/i.test(html));
  });

  await ok('GitHub remote URLs parse; others do not', () => {
    const want = { owner: 'o', repo: 'r' };
    for (const u of ['https://github.com/o/r.git', 'https://me@github.com/o/r', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git']) {
      assert.deepStrictEqual(gh.parseGitHubRemote(u), want, u);
    }
    assert.strictEqual(gh.parseGitHubRemote('https://gitlab.com/o/r.git'), null);
    assert.ok(gh.isGitHubUrl('https://github.com/o/r/pull/1'));
    assert.ok(!gh.isGitHubUrl('https://github.com.evil.com/x') && !gh.isGitHubUrl('file:///etc/passwd'));
  });

  await ok('rebasePlan orders messages as git asks for them', () => {
    const h = (n) => String(n).repeat(7);
    const plan = more.rebasePlan([
      { action: 'pick', hash: h(1) }, { action: 'reword', hash: h(2), message: 'R' },
      { action: 'squash', hash: h(3), message: 'S' }, { action: 'fixup', hash: h(4) },
      { action: 'pick', hash: h(5) }, { action: 'fixup', hash: h(6) }, { action: 'drop', hash: h(7) },
    ]);
    assert.deepStrictEqual(plan.queue, ['R', 'S']);
    assert.ok(plan.todo.startsWith('pick 1111111\nreword 2222222\n'));
    assert.throws(() => more.rebasePlan([{ action: 'fixup', hash: h(1) }]), /cannot be squashed/);
    assert.throws(() => more.rebasePlan([{ action: 'exec', hash: h(1) }]), /Unknown/);
  });

  await ok('parseWorktrees marks the main worktree', () => {
    const list = more.parseWorktrees('worktree /a\nHEAD 1\nbranch refs/heads/main\n\nworktree /b\nHEAD 2\ndetached\n');
    assert.deepStrictEqual(list.map((w) => [w.isMain, w.branch, w.detached]), [[true, 'main', false], [false, null, true]]);
  });

  // ---- git integration --------------------------------------------------------------
  fs.mkdirSync(REPO, { recursive: true });
  await g.run(REPO, ['init', '-b', 'main']);
  await g.run(REPO, ['config', 'user.name', 'GitDeck Test']);
  await g.run(REPO, ['config', 'user.email', 'test@gitdeck.local']);
  await g.run(REPO, ['config', 'core.autocrlf', 'false']);
  write('a.txt', 'one\ntwo\nthree\n');
  const first = await commitAll('first');

  await ok('stage selected lines only', async () => {
    write('a.txt', 'ONE\ntwo\nTHREE\n');
    const f = GitDiff.parse(await g.diffWorking(REPO, 'a.txt'))[0];
    const idx = f.hunks[0].lines.findIndex((l) => l.type === 'del' && l.text === 'one');
    const add = f.hunks[0].lines.findIndex((l) => l.type === 'add' && l.text === 'ONE');
    await g.applyPatch(REPO, GitDiff.linesPatch(f, 0, [idx, add], false), { cached: true });
    assert.strictEqual(await g.run(REPO, ['show', ':a.txt']), 'ONE\ntwo\nthree\n');
    await g.run(REPO, ['checkout', 'HEAD', '--', 'a.txt']);
  });

  await ok('tags: lightweight, annotated, delete', async () => {
    await more.createTag(REPO, 'v1', null, '');
    await more.createTag(REPO, 'v1-ann', first, 'release one');
    const t = await more.tags(REPO);
    const ann = t.find((x) => x.name === 'v1-ann');
    assert.ok(ann.annotated && ann.subject === 'release one' && first.startsWith(ann.commit));
    assert.ok(!t.find((x) => x.name === 'v1').annotated);
    await more.deleteTag(REPO, 'v1');
    assert.ok(!(await more.tags(REPO)).some((x) => x.name === 'v1'));
    await assert.rejects(more.createTag(REPO, '-bad', null, ''));
  });

  await ok('remote add, tag push, remote tag delete, remote remove', async () => {
    await g.run(ROOT, ['init', '--bare', '-b', 'main', BARE]);
    await more.addRemote(REPO, 'origin', BARE);
    await more.pushTag(REPO, 'origin', 'v1-ann');
    assert.ok((await g.run(BARE, ['tag'])).includes('v1-ann'));
    await more.deleteRemoteTag(REPO, 'origin', 'v1-ann');
    assert.ok(!(await g.run(BARE, ['tag'])).includes('v1-ann'));
    await assert.rejects(more.addRemote(REPO, 'x', '--upload-pack=evil'));
    await more.removeRemote(REPO, 'origin');
    assert.strictEqual((await g.remotes(REPO)).length, 0);
  });

  await ok('branch rename', async () => {
    await g.createBranch(REPO, 'feat');
    await more.renameBranch(REPO, 'feat', 'feature');
    const names = (await g.branches(REPO)).local.map((b) => b.name);
    assert.ok(names.includes('feature') && !names.includes('feat'));
  });

  await ok('reflog lists HEAD movements', async () => {
    const r = await more.reflog(REPO);
    assert.ok(r.length >= 1 && /^HEAD@\{\d+\}$/.test(r[0].selector) && r[0].hash.length >= 40);
  });

  await ok('cherry-pick several commits in order', async () => {
    await g.switchBranch(REPO, 'feature');
    write('b.txt', 'b\n'); const c1 = await commitAll('add b');
    write('c.txt', 'c\n'); const c2 = await commitAll('add c');
    await g.switchBranch(REPO, 'main');
    await more.cherryPickMany(REPO, [c1, c2]);
    const onMain = (await g.run(REPO, ['log', '-2', '--format=%s', 'main'])).trim().split(/\r?\n/);
    assert.deepStrictEqual(onMain, ['add c', 'add b']);
    await assert.rejects(more.cherryPickMany(REPO, []), /No commits/);
  });

  await ok('stash only the selected files', async () => {
    write('a.txt', 'changed a\n');
    write('b.txt', 'changed b\n');
    await g.stashSave(REPO, 'only a', false, ['a.txt']);
    assert.strictEqual(read('a.txt'), 'one\ntwo\nthree\n');
    assert.strictEqual(read('b.txt'), 'changed b\n');
    await g.stashPop(REPO, 'stash@{0}');
    assert.strictEqual(read('a.txt'), 'changed a\n');
    await g.run(REPO, ['checkout', 'HEAD', '--', 'a.txt', 'b.txt']);
  });

  await ok('blame at an older revision', async () => {
    write('a.txt', 'one\ntwo\nthree\nfour\n');
    const head = await commitAll('four');
    assert.strictEqual((await g.blame(REPO, 'a.txt')).length, 4);
    assert.strictEqual((await g.blame(REPO, 'a.txt', head + '^')).length, 3);
    await assert.rejects(g.blame(REPO, 'a.txt', '--output=x'));
  });

  await ok('commit template strips comment lines', async () => {
    assert.strictEqual(await more.commitTemplate(REPO), '');
    fs.writeFileSync(path.join(ROOT, 'tmpl.txt'), 'feat: \n# explain why\n\nRefs: \n');
    await g.run(REPO, ['config', 'commit.template', path.join(ROOT, 'tmpl.txt')]);
    assert.strictEqual(await more.commitTemplate(REPO), 'feat: \n\nRefs:');
    await g.run(REPO, ['config', '--unset', 'commit.template']);
  });

  await ok('working-file access stays inside the repository', async () => {
    assert.strictEqual(more.readWorkingFile(REPO, 'a.txt').replace(/\r/g, ''), 'one\ntwo\nthree\nfour\n');
    for (const bad of ['../x', '.git/config', path.join(REPO, 'a.txt'), '']) {
      assert.throws(() => more.readWorkingFile(REPO, bad), bad);
    }
    assert.throws(() => more.writeWorkingFile(REPO, 'new.txt', 'x'));
    more.writeWorkingFile(REPO, 'a.txt', 'edited\n');
    assert.strictEqual(read('a.txt'), 'edited\n');
    await g.run(REPO, ['checkout', 'HEAD', '--', 'a.txt']);
  });

  await ok('merge editor: diff3 markers, save resolved', async () => {
    await g.createBranch(REPO, 'other');
    write('a.txt', 'main side\n'); await commitAll('main edit');
    await g.switchBranch(REPO, 'other');
    write('a.txt', 'other side\n'); await commitAll('other edit');
    await g.switchBranch(REPO, 'main');
    await assert.rejects(g.merge(REPO, 'other'));
    await more.conflictWithBase(REPO, 'a.txt');
    const segs = GitMerge.parseConflicts(more.readWorkingFile(REPO, 'a.txt'));
    const c = segs.find((s) => s.type === 'conflict');
    assert.ok(c && c.base.length > 0, 'base section present');
    await more.saveResolved(REPO, 'a.txt', GitMerge.resolve(segs, ['theirs-ours']));
    assert.strictEqual((await g.status(REPO)).conflicted.length, 0);
    await g.continueOperation(REPO, 'merge');
    assert.strictEqual(read('a.txt'), 'other side\nmain side\n');
  });

  await ok('worktree add, list, remove', async () => {
    const dir = path.join(ROOT, 'wt');
    await more.worktreeAdd(REPO, dir, { newBranch: 'wt-branch' });
    const list = await more.worktrees(REPO);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[1].branch, 'wt-branch');
    await assert.rejects(more.worktreeRemove(REPO, list[0].path), /Not a removable/);
    await more.worktreeRemove(REPO, list[1].path, false);
    assert.strictEqual((await more.worktrees(REPO)).length, 1);
    await assert.rejects(more.worktreeAdd(REPO, 'relative/dir', {}), /absolute/);
  });

  await ok('interactive rebase: reword, squash, drop', async () => {
    const base = (await g.log(REPO))[0].hash;
    for (const n of ['r1', 'r2', 'r3', 'r4']) { write(n + '.txt', n + '\n'); await commitAll('commit ' + n); }
    const list = await more.rebaseCommits(REPO, base);
    assert.deepStrictEqual(list.map((c) => c.subject), ['commit r1', 'commit r2', 'commit r3', 'commit r4']);
    await more.rebaseInteractive(REPO, base, [
      { action: 'reword', hash: list[0].hash, message: 'renamed r1' },
      { action: 'pick', hash: list[1].hash },
      { action: 'squash', hash: list[2].hash, message: 'r2 and r3' },
      { action: 'drop', hash: list[3].hash },
    ]);
    assert.strictEqual(await g.operationInProgress(REPO), null);
    assert.deepStrictEqual((await subjects()).slice(0, 2), ['r2 and r3', 'renamed r1']);
    assert.ok(fs.existsSync(path.join(REPO, 'r3.txt')) && !fs.existsSync(path.join(REPO, 'r4.txt')));
    const dir = await more.gitDir(REPO);
    assert.ok(!fs.existsSync(path.join(dir, 'gitdeck-rebase-todo')));
  });

  await ok('pull with rebase replays local commits', async () => {
    const clone = path.join(ROOT, 'clone');
    await more.addRemote(REPO, 'origin', BARE);
    await g.run(REPO, ['push', '-u', 'origin', 'main']);
    await g.run(ROOT, ['clone', BARE, clone]);
    await g.run(clone, ['config', 'user.name', 'Other']);
    await g.run(clone, ['config', 'user.email', 'o@x']);
    fs.writeFileSync(path.join(clone, 'remote.txt'), 'r\n');
    await g.stageAll(clone); await g.commit(clone, 'remote change');
    await g.run(clone, ['push']);
    write('local.txt', 'l\n'); await commitAll('local change');
    await g.pull(REPO, { rebase: true });
    const log = await g.log(REPO);
    assert.deepStrictEqual(log.slice(0, 2).map((c) => c.subject), ['local change', 'remote change']);
    assert.strictEqual(log[0].parents.length, 1);
  });

  await ok('file browser: list and read files, working tree and at a revision', async () => {
    fs.writeFileSync(path.join(REPO, '.gitignore'), 'ignored.txt\n');
    write('dir/nested/deep.txt', 'deep\n');
    fs.writeFileSync(path.join(REPO, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    write('ignored.txt', 'not listed\n');
    const parent = (await g.run(REPO, ['rev-parse', 'HEAD'])).trim();
    const head = await commitAll('add deep, binary and ignore');
    assert.strictEqual(head.length, 40);

    // Working tree: tracked + untracked, ignored files left out.
    const wt = await more.listFiles(REPO, null);
    const paths = wt.files.map((f) => f.path);
    assert.ok(paths.includes('a.txt') && paths.includes('dir/nested/deep.txt'));
    assert.ok(!paths.includes('ignored.txt'));
    assert.strictEqual(wt.rev, null);
    assert.strictEqual(wt.truncated, false);

    // At the previous commit the new files are gone; blob sizes are included.
    const at = await more.listFiles(REPO, parent);
    const atPaths = at.files.map((f) => f.path);
    assert.ok(!atPaths.includes('dir/nested/deep.txt') && atPaths.includes('a.txt'));
    assert.strictEqual(at.rev, parent);
    assert.ok(at.files.find((f) => f.path === 'a.txt').size > 0);

    // Reading: same content from disk and from a commit; binaries are reported.
    const fromDisk = await more.readFileAt(REPO, 'a.txt', null);
    const atRev = await more.readFileAt(REPO, 'a.txt', parent);
    assert.strictEqual(fromDisk.binary, false);
    assert.strictEqual(atRev.content, fromDisk.content);
    assert.ok(atRev.content.length > 0);
    assert.strictEqual((await more.readFileAt(REPO, 'dir/nested/deep.txt', head)).content, 'deep\n');
    assert.strictEqual((await more.readFileAt(REPO, 'bin.dat', head)).binary, true);
    await assert.rejects(more.readFileAt(REPO, 'dir/nested/deep.txt', parent), /is not in/);

    // Paths stay inside the tree; revisions must be hashes.
    await assert.rejects(more.readFileAt(REPO, '../outside.txt', null), /Invalid file path/);
    await assert.rejects(more.readFileAt(REPO, 'a.txt', 'HEAD'), /Invalid commit hash/);
    await assert.rejects(more.listFiles(REPO, 'HEAD'), /Invalid commit hash/);
  });

  await ok('file browser: ignored files, assume-unchanged and skip-worktree flags', async () => {
    write('build/out/gen.js', 'generated\n');
    fs.appendFileSync(path.join(REPO, '.gitignore'), 'build/\n');
    await commitAll('ignore build');
    write('loose.txt', 'untracked\n');
    const byPath = (list) => new Map(list.files.map((f) => [f.path, f]));

    // Ignored files only when asked; an ignored directory is one entry, not scanned.
    const plain = byPath(await more.listFiles(REPO, null));
    assert.ok(!plain.has('ignored.txt') && !plain.has('build/'));
    const all = byPath(await more.listFiles(REPO, null, { ignored: true }));
    assert.strictEqual(all.get('ignored.txt').state, 'ignored');
    assert.strictEqual(all.get('build/').state, 'ignored');
    assert.strictEqual(all.get('build/').dir, true);
    assert.ok(!all.has('build/out/gen.js'));
    assert.strictEqual(all.get('a.txt').state, 'tracked');
    assert.strictEqual(all.get('loose.txt').state, 'untracked');

    await more.setFileFlag(REPO, ['a.txt'], 'assume', true);
    await more.setFileFlag(REPO, ['dir/nested/deep.txt'], 'skip', true);
    let flags = byPath(await more.listFiles(REPO, null));
    assert.strictEqual(flags.get('a.txt').assume, true);
    assert.strictEqual(flags.get('dir/nested/deep.txt').skip, true);
    assert.ok(!flags.get('bin.dat').assume && !flags.get('bin.dat').skip);
    await more.setFileFlag(REPO, ['a.txt'], 'assume', false);
    await more.setFileFlag(REPO, ['dir/nested/deep.txt'], 'skip', false);
    flags = byPath(await more.listFiles(REPO, null));
    assert.ok(!flags.get('a.txt').assume && !flags.get('dir/nested/deep.txt').skip);
    await assert.rejects(more.setFileFlag(REPO, ['a.txt'], 'bogus', true), /Unknown file flag/);
  });

  await ok('file browser: ignore, move, remove and file log', async () => {
    await more.ignorePaths(REPO, ['loose.txt']);
    assert.ok(read('.gitignore').split('\n').includes('/loose.txt'));
    assert.ok(!(await more.listFiles(REPO, null)).files.some((f) => f.path === 'loose.txt'));
    await assert.rejects(more.ignorePaths(REPO, ['../x']), /Invalid file path/);

    // Tracked files move with git mv; untracked ones are renamed on disk.
    await more.moveFile(REPO, 'dir/nested/deep.txt', 'moved/deep.txt');
    assert.strictEqual(read('moved/deep.txt'), 'deep\n');
    const st = await g.status(REPO);
    assert.ok(st.staged.some((e) => e.x === 'R' && e.path === 'moved/deep.txt'));
    write('scratch.txt', 's\n');
    await more.moveFile(REPO, 'scratch.txt', 'scratch2.txt');
    assert.ok(fs.existsSync(path.join(REPO, 'scratch2.txt')) && !fs.existsSync(path.join(REPO, 'scratch.txt')));
    await assert.rejects(more.moveFile(REPO, 'scratch2.txt', 'a.txt'), /already exists/);
    await commitAll('move deep');

    // Remove from the index only: the file stays on disk, untracked.
    await more.removeFiles(REPO, ['bin.dat'], { cached: true });
    assert.ok(fs.existsSync(path.join(REPO, 'bin.dat')));
    assert.ok((await g.status(REPO)).staged.some((e) => e.x === 'D' && e.path === 'bin.dat'));
    await more.removeFiles(REPO, ['scratch2.txt'], {});
    assert.ok(!fs.existsSync(path.join(REPO, 'scratch2.txt')));
    await commitAll('remove scratch');

    // Local or staged changes do not block a confirmed remove.
    write('rm-mod.txt', 'm\n');
    write('rm-staged.txt', 's\n');
    await commitAll('remove targets');
    write('rm-mod.txt', 'm2\n');
    write('rm-staged.txt', 's2\n');
    await g.stage(REPO, ['rm-staged.txt']);
    write('rm-staged.txt', 's3\n');
    await more.removeFiles(REPO, ['rm-mod.txt'], {});
    assert.ok(!fs.existsSync(path.join(REPO, 'rm-mod.txt')));
    await more.removeFiles(REPO, ['rm-staged.txt'], { cached: true });
    assert.strictEqual(read('rm-staged.txt'), 's3\n');
    const rmSt = await g.status(REPO);
    assert.deepStrictEqual(rmSt.staged.filter((e) => e.x === 'D').map((e) => e.path).sort(), ['rm-mod.txt', 'rm-staged.txt']);
    fs.rmSync(path.join(REPO, 'rm-staged.txt'));
    await commitAll('remove changed files');

    // The log of one file follows it across the rename.
    const hist = await more.fileLog(REPO, 'moved/deep.txt');
    assert.deepStrictEqual(hist.map((c) => c.subject), ['move deep', 'add deep, binary and ignore']);
    assert.strictEqual(hist[0].hash.length, 40);
    assert.ok(hist[0].authorName && hist[0].timestamp > 0);
  });

  await ok('file browser: commit only the chosen folder', async () => {
    write('pick/a.txt', 'a\n');
    write('pick/sub/b.txt', 'b\n');
    write('other/c.txt', 'c\n');
    write('pick/[weird].txt', 'w\n');
    await commitAll('folders');
    write('pick/a.txt', 'a2\n');           // modified
    write('pick/new.txt', 'n\n');          // untracked
    fs.rmSync(path.join(REPO, 'pick/sub/b.txt')); // deleted
    write('pick/[weird].txt', 'w2\n');    // glob characters stay literal
    write('other/c.txt', 'c2\n');
    await g.stage(REPO, ['other/c.txt']);  // staged elsewhere: must stay staged
    const picked = ['pick/a.txt', 'pick/new.txt', 'pick/sub/b.txt', 'pick/[weird].txt'];
    const head = await more.commitPaths(REPO, 'pick only', picked, { untracked: ['pick/new.txt'] });
    assert.strictEqual(head.subject, 'pick only');
    const files = (await g.run(REPO, ['show', '--name-status', '--format=', 'HEAD'])).trim().split('\n').sort();
    assert.deepStrictEqual(files, ['A\tpick/new.txt', 'D\tpick/sub/b.txt', 'M\tpick/[weird].txt', 'M\tpick/a.txt']);
    const st = await g.status(REPO);
    assert.deepStrictEqual(st.staged.map((e) => e.path), ['other/c.txt']);
    await assert.rejects(more.commitPaths(REPO, '', ['other/c.txt']), /message is empty/);
    await assert.rejects(more.commitPaths(REPO, 'x', []), /No files selected/);
    await assert.rejects(more.commitPaths(REPO, 'x', ['../c.txt']), /Invalid file path/);
    await commitAll('other');

    // A failed commit leaves the untracked picks untracked, not staged.
    const hook = path.join(REPO, '.git', 'hooks', 'pre-commit');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    write('pick/hooked.txt', 'h\n');
    try {
      await assert.rejects(more.commitPaths(REPO, 'blocked', ['pick/hooked.txt'], { untracked: ['pick/hooked.txt'] }));
      const after = await g.status(REPO);
      assert.deepStrictEqual(after.staged, []);
      assert.deepStrictEqual(after.untracked.map((e) => e.path), ['pick/hooked.txt']);
    } finally {
      fs.rmSync(hook);
      fs.rmSync(path.join(REPO, 'pick/hooked.txt'));
    }
  });

  console.log('\nALL ' + passed + ' FEATURE TESTS PASSED');
})().catch((e) => { console.error('\nFAILED after ' + passed + ' passes:', e.stack || e.message); process.exit(1); })
  .finally(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } });
