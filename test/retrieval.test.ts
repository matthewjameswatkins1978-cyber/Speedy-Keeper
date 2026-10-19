/** Retrieval: save defaults, get round-trip, FTS search, filters, bounded results. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

test('save stores a record with safe defaults', () => {
  const t = tempDb('retrieval');
  try {
    const store = new KeeperStore(t.db);
    try {
      const rec = store.save({ kind: 'decision', title: 'Use WAL mode', body: 'WAL allows readers during writes' });
      assert.equal(rec.kind, 'decision');
      assert.equal(rec.claimStatus, 'provisional');
      assert.equal(rec.revision, 1);
      assert.equal(rec.supersededBy, null);
      assert.equal(rec.taskScope, null);
      assert.deepEqual(rec.sources, []);
      assert.ok(rec.id.length > 0 && rec.createdAt.length > 0);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('get round-trips sources and task scope; missing id returns null', () => {
  const t = tempDb('retrieval');
  try {
    const store = new KeeperStore(t.db);
    try {
      const saved = store.save({
        kind: 'checkpoint',
        title: 'Milestone 1 done',
        body: 'Core API implemented and tested',
        taskScope: 'b1-core',
        sources: ['src/store.ts', 'abc1234'],
      });
      const got = store.get(saved.id);
      assert.deepEqual(got, saved);
      assert.equal(store.get('does-not-exist'), null);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('search finds title and body terms via FTS and ignores unrelated text', () => {
  const t = tempDb('retrieval');
  try {
    const store = new KeeperStore(t.db);
    try {
      const a = store.save({ kind: 'gotcha', title: 'FTS trigger pitfall', body: 'forgetting the delete trigger duplicates index rows' });
      store.save({ kind: 'decision', title: 'Unrelated choice', body: 'pick blue for the landing page banner' });
      const byTitle = store.search('pitfall');
      assert.equal(byTitle.length, 1);
      assert.equal(byTitle[0]!.id, a.id);
      const byBody = store.search('duplicates index');
      assert.equal(byBody.length, 1);
      assert.equal(byBody[0]!.id, a.id);
      assert.deepEqual(store.search('zebracorn'), []);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('search honours kind and task filters and bounds results', () => {
  const t = tempDb('retrieval');
  try {
    const store = new KeeperStore(t.db);
    try {
      for (let i = 0; i < 5; i++) {
        store.save({ kind: i % 2 === 0 ? 'decision' : 'gotcha', title: `filter me ${i}`, body: 'common filter body', taskScope: i < 3 ? 'alpha' : 'beta' });
      }
      assert.equal(store.search('filter', { kind: 'decision' }).length, 3);
      assert.equal(store.search('filter', { taskScope: 'beta' }).length, 2);
      assert.equal(store.search('filter', { limit: 2 }).length, 2);
      // Oversized limits are capped, not fatal.
      assert.equal(store.search('filter', { limit: 10_000 }).length, 5);
      // Blank query browses recent records, still bounded.
      assert.equal(store.search('', { limit: 3 }).length, 3);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('long queries recover via OR fallback when AND starves (PR #7)', () => {
  const t = tempDb('retrieval-or-fallback');
  try {
    const store = new KeeperStore(t.db);
    try {
      const rec = store.save({
        kind: 'decision',
        title: 'API rate limit rationale',
        body: 'ledgerd allows 60 requests per minute per key',
      });
      // Six tokens; `distribution` appears nowhere in the record, so the
      // AND query starves (zero hits). The OR fallback must still return
      // the record (B4 K8-class query; cf. the zeroed `distribution`
      // query in docs/b4-live-results.md).
      const hits = store.search('API rate limit distribution per minute ledgerd');
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.id, rec.id);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('two-token queries keep AND precision; no OR fallback (PR #7)', () => {
  const t = tempDb('retrieval-and-precision');
  try {
    const store = new KeeperStore(t.db);
    try {
      store.save({ kind: 'decision', title: 'Backup me', body: 'revised words' });
      // Only `words` matches; `original` matches nothing. The OR fallback
      // is gated to 3+ tokens, so this must stay empty (matches
      // backup.test.ts supersede-hiding expectation).
      assert.deepEqual(store.search('original words'), []);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('OR fallback never fires when AND succeeds; distractors excluded (PR #7)', () => {
  const t = tempDb('retrieval-no-mislead');
  try {
    const store = new KeeperStore(t.db);
    try {
      const target = store.save({
        kind: 'decision',
        title: 'Retry rationale',
        body: 'ledgerd retry delay rationale documented here',
      });
      // Distractor shares only the incidental word `delay`.
      store.save({ kind: 'gotcha', title: 'Standup notes', body: 'delay the deploy until morning standup' });
      // All four tokens present in the target: AND hits, fallback stays off,
      // distractor excluded despite sharing `delay`.
      const hits = store.search('ledgerd retry delay rationale');
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.id, target.id);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
