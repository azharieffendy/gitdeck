'use strict';
// GitDeck renderer unit tests (diff parser, graph layout). Run: node test/renderer.test.js
const assert = require('assert');
const GitDiff = require('../renderer/diff.js');
const GitGraph = require('../renderer/graph.js');
const { repoNameFromUrl } = require('../renderer/clone.js');

let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ok -', name); }

const TWO_FILES = [
  'diff --git a/a b/a', 'index 1..2 100644', '--- a/a', '+++ b/a', '@@ -1 +1 @@', '-x', '+y',
  'diff --git a/b b/b', 'index 1..2 100644', '--- a/b', '+++ b/b', '@@ -1 +1 @@', '-p', '+q', '',
].join('\n');

try {
  ok('multi-file diff keeps headers out of the previous file', () => {
    const files = GitDiff.parse(TWO_FILES);
    assert.strictEqual(files.length, 2);
    for (const f of files) {
      assert.strictEqual(f.additions, 1);
      assert.strictEqual(f.deletions, 1);
      assert.strictEqual(f.hunks[0].lines.length, 2);
    }
    assert.deepStrictEqual(files[0].hunks[0].lines.map((l) => l.text), ['x', 'y']);
  });

  ok('trailing newline adds no phantom context row', () => {
    const lines = GitDiff.parse(TWO_FILES)[1].hunks[0].lines;
    assert.ok(!lines.some((l) => l.type === 'ctx'));
  });

  ok('CRLF content lines are stripped of CR', () => {
    const f = GitDiff.parse('diff --git a/w b/w\n--- a/w\n+++ b/w\n@@ -1 +1 @@\n-old\r\n+new\r\n')[0];
    assert.deepStrictEqual(f.hunks[0].lines.map((l) => l.text), ['old', 'new']);
  });

  ok('fork point: both children converge on the parent lane', () => {
    // B and C both branch from A; A is drawn once and both edges end at A's lane.
    const commits = [
      { hash: 'C', parents: ['A'] },
      { hash: 'B', parents: ['A'] },
      { hash: 'A', parents: [] },
    ];
    const lay = GitGraph.layout(commits);
    const laneA = lay.nodes.find((n) => n.hash === 'A').lane;
    assert.strictEqual(lay.edges.length, 2);
    for (const e of lay.edges) assert.strictEqual(e.toLane, laneA);
    assert.strictEqual(lay.laneCount, 2);
  });

  ok('merge: second parent gets its own lane, lanes are reused after', () => {
    const commits = [
      { hash: 'M', parents: ['A', 'F'] },
      { hash: 'F', parents: ['A'] },
      { hash: 'A', parents: ['R'] },
      { hash: 'R', parents: [] },
    ];
    const lay = GitGraph.layout(commits);
    const lane = (h) => lay.nodes.find((n) => n.hash === h).lane;
    assert.strictEqual(lane('M'), 0);
    assert.strictEqual(lane('F'), 1);
    assert.strictEqual(lane('A'), 0);
    assert.strictEqual(lane('R'), 0);
    assert.strictEqual(lay.laneCount, 2);
    assert.ok(lay.edges.every((e) => e.toLane === lane(commits[e.toRow].hash)));
  });

  ok('hunkPatch rebuilds a standalone one-hunk patch, CR intact', () => {
    const text = [
      'diff --git a/f b/f', 'index 1..2 100644', '--- a/f', '+++ b/f',
      '@@ -1,2 +1,2 @@', '-a\r', '+A\r', ' b\r',
      '@@ -10 +10 @@', '-y', '+Y', '',
    ].join('\n');
    const f = GitDiff.parse(text)[0];
    assert.strictEqual(f.hunks.length, 2);
    const p = GitDiff.hunkPatch(f, 1);
    assert.strictEqual(p, 'diff --git a/f b/f\nindex 1..2 100644\n--- a/f\n+++ b/f\n@@ -10 +10 @@\n-y\n+Y\n');
    assert.ok(GitDiff.hunkPatch(f, 0).includes('-a\r\n+A\r\n'));
    assert.throws(() => GitDiff.hunkPatch(f, 5), /No such hunk/);
  });

  ok('splitPairs lines deletions up with the additions that replace them', () => {
    const f = GitDiff.parse('diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,4 +1,3 @@\n c\n-x1\n-x2\n+y1\n d\n')[0];
    const pairs = GitDiff.splitPairs(f.hunks[0]).map(([l, r]) => [l && l.text, r && r.text]);
    assert.deepStrictEqual(pairs, [['c', 'c'], ['x1', 'y1'], ['x2', null], ['d', 'd']]);
  });

  ok('split render: one row per pair, hunk buttons carry indices', () => {
    const html = GitDiff.render(TWO_FILES, {
      mode: 'split', hunkActions: [{ action: 'stage', label: 'Stage <hunk>' }],
    });
    assert.strictEqual((html.match(/class="diff-split-row"/g) || []).length, 2);
    assert.ok(html.includes('data-action="stage" data-file="1" data-hunk="0"'));
    assert.ok(html.includes('Stage &lt;hunk&gt;'));
    assert.ok(!GitDiff.render(TWO_FILES).includes('diff-split-row'));
  });

  ok('layout does not mutate input commits', () => {
    const commits = [{ hash: 'A', parents: [] }];
    GitGraph.layout(commits);
    assert.deepStrictEqual(Object.keys(commits[0]), ['hash', 'parents']);
  });

  ok('repoNameFromUrl: https, scp, local and dirty forms', () => {
    assert.strictEqual(repoNameFromUrl('https://github.com/electron/electron.git'), 'electron');
    assert.strictEqual(repoNameFromUrl('git@github.com:user/repo.git'), 'repo');
    assert.strictEqual(repoNameFromUrl('git@host:repo.git'), 'repo');
    assert.strictEqual(repoNameFromUrl('ssh://git@host:2222/repo.git/'), 'repo');
    assert.strictEqual(repoNameFromUrl('D:\\repos\\myrepo'), 'myrepo');
    assert.strictEqual(repoNameFromUrl('https://x.example/a<b'), 'ab');
    assert.strictEqual(repoNameFromUrl(''), '');
  });

  console.log('\nALL ' + passed + ' TESTS PASSED');
} catch (e) {
  console.error('\nFAILED after ' + passed + ' passes:', e.message);
  process.exit(1);
}
