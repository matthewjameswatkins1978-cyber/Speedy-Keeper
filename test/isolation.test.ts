/** Project isolation: separate repos get separate databases; worktrees share one. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { gitCommonDir, resolveProjectDbPath } from '../src/paths.js';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

test('records in one project database are invisible from another', () => {
  const a = tempDb('isolation-a');
  const b = tempDb('isolation-b');
  try {
    const sa = new KeeperStore(a.db);
    const sb = new KeeperStore(b.db);
    try {
      const rec = sa.save({ kind: 'decision', title: 'isolation marker zebra', body: 'project A only' });
      assert.equal(sb.search('isolation marker zebra').length, 0);
      assert.equal(sb.get(rec.id), null);
      assert.equal(sa.search('isolation marker zebra').length, 1);
    } finally {
      sa.close();
      sb.close();
    }
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

function git(args: string[], cwd: string): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

test('database path follows the absolute git common directory', { concurrency: false }, () => {
  const root = join(tmpdir(), `keeper-git-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  let ok = false;
  try {
    mkdirSync(join(root, 'repo', 'sub'), { recursive: true });
    const repo = join(root, 'repo');
    git(['init', '-b', 'main'], repo);
    git(['config', 'user.email', 'test@example.com'], repo);
    git(['config', 'user.name', 'test'], repo);
    git(['commit', '--allow-empty', '-m', 'init'], repo);
    ok = true;
    // Repo root and a subdirectory resolve to the same database file, and it is absolute.
    const fromRoot = resolveProjectDbPath(repo);
    const fromSub = resolveProjectDbPath(join(repo, 'sub'));
    assert.equal(fromRoot, fromSub);
    assert.equal(fromRoot, resolve(fromRoot));
    assert.ok(fromRoot.endsWith(join('speedy-keeper', 'memory.sqlite')));
    // Common dir itself is absolute and shared.
    assert.equal(gitCommonDir(join(repo, 'sub')), gitCommonDir(repo));
    // A linked worktree shares the main checkout's database.
    const wt = join(root, 'wt');
    git(['worktree', 'add', wt], repo);
    assert.equal(resolveProjectDbPath(wt), fromRoot);
    git(['worktree', 'remove', '--force', wt], repo);
  } catch (err) {
    if (!ok) {
      console.log('  (skipped: git worktree setup unavailable in this environment)');
      return;
    }
    throw err;
  } finally {
    // Best-effort cleanup; temp lives outside the repo so nothing pollutes git.
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});
