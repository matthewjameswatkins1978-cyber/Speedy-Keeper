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
