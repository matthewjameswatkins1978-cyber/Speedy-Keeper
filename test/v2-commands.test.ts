/** v2 commands: preview, project, guide, doctor, verify. */
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import {
  buildPreview,
  buildProjection,
  guideText,
  runDoctor,
  verifyDependencies,
} from '../src/commands.js';
import { tempDb } from './helpers.js';

function seed(store: KeeperStore): void {
  store.save({ kind: 'gotcha', title: 'Checkout trap', body: 'trap body here', taskScope: 'checkout' });
  store.save({
    kind: 'decision',
    title: 'Use staged checks',
    body: 'staged body here',
    taskScope: 'checkout',
    grade: 'SOURCE-READ',
    sources: ['docs/x.md'],
  });
  store.save({ kind: 'gotcha', title: 'Unrelated tooling', body: 'other body here', taskScope: 'other' });
}

test('preview returns task records with an explicit outcome', () => {
  const t = tempDb('v2-preview');
  try {
    const store = new KeeperStore(t.db);
    try {
      seed(store);
      const res = buildPreview(store, { task: 'checkout' });
      assert.equal(res.outcome, 'preview');
      assert.equal(res.via, 'scope');
      assert.ok(res.hits.length >= 2);
      assert.ok(res.text.includes('matches: 2'));
      const empty = buildPreview(store, { task: 'no-such-task-zzz' });
      assert.equal(empty.outcome, 'no-memory');
      assert.ok(empty.text.startsWith('no-memory:'));
      assert.ok(empty.text.includes('keeper save'));
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('preview falls back to task words when no scope matches', () => {
  const t = tempDb('v2-preview-words');
  try {
    const store = new KeeperStore(t.db);
    try {
      store.save({ kind: 'gotcha', title: 'Wordy trap', body: 'mentions checkout flow', taskScope: 'elsewhere' });
      const res = buildPreview(store, { task: 'checkout' });
      assert.equal(res.outcome, 'preview');
      assert.equal(res.via, 'words');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('projection is capped, typed and skips empty sections', () => {
  const t = tempDb('v2-project');
  try {
    const store = new KeeperStore(t.db);
    try {
      seed(store);
      const text = buildProjection(store, {});
      assert.ok(text.includes('## gotcha (2)'));
      assert.ok(text.includes('## decision (1)'));
      assert.ok(!text.includes('## baseline'));
      assert.ok(text.split('\n').length <= 200);
      assert.ok(text.length <= 25 * 1024);
      assert.ok(text.includes('[SOURCE-READ]'));
      const scoped = buildProjection(store, { task: 'other' });
      assert.ok(scoped.includes('## gotcha (1)'));
      assert.ok(!scoped.includes('Checkout trap'));
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('guide teaches the workflow in one screen', () => {
  const g = guideText();
  for (const must of ['preview', 'keeper save', 'TESTED', '--run', 'verify', 'supersede', 'matches: 0']) {
    assert.ok(g.includes(must), `guide missing: ${must}`);
  }
});

test('doctor passes on a healthy store and names its checks', () => {
  const t = tempDb('v2-doctor');
  try {
    const store = new KeeperStore(t.db);
    try {
      const report = runDoctor(store, t.db);
      assert.equal(report.ok, true);
      assert.ok(report.checks.some((c) => c.name.includes('v2')));
      assert.ok(report.checks.every((c) => c.ok));
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

function gitHead(repoRoot: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

test('verify marks missing SHAs stale and non-repos unknown', () => {
  const t = tempDb('v2-verify');
  try {
    const store = new KeeperStore(t.db);
    try {
      store.save({
        kind: 'baseline',
        title: 'Fake baseline',
        body: 'names a phantom object',
        dependsOn: ['abcdef1234567890abcdef1234567890abcdef12'],
      });
      store.save({
        kind: 'gotcha',
        title: 'Path dep',
        body: 'names a path, not an object',
        dependsOn: ['docs/x.md'],
      });
      // Outside any git checkout: everything unresolvable, nothing fabricated.
      const away = verifyDependencies(store, { cwd: t.dir });
      assert.equal(away.outcome, 'verified');
      assert.equal(away.stale.length, 0);
      assert.equal(away.unknown.length, 2);
      // Inside a real repo, the phantom SHA is STALE and paths are UNKNOWN.
      const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
      const here = verifyDependencies(store, { cwd: repoRoot });
      const staleIds = here.stale.map((e) => e.title);
      assert.ok(staleIds.includes('Fake baseline'), `expected stale, got ${JSON.stringify(here)}`);
      const unknownIds = here.unknown.map((e) => e.title);
      assert.ok(unknownIds.includes('Path dep'));
      // A real object resolves: attach the repo HEAD and re-verify.
      const head = gitHead(repoRoot);
      if (head !== null) {
        store.save({ kind: 'decision', title: 'Real pin', body: 'names HEAD', dependsOn: [head.slice(0, 12)] });
        const again = verifyDependencies(store, { cwd: repoRoot });
        assert.ok(!again.stale.some((e) => e.title === 'Real pin'));
      }
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
