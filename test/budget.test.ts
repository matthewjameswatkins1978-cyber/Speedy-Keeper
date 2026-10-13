/** Budget without exceptions: previews shrink to fit; tiny budgets error; bad numbers rejected. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BudgetError, KeeperStore, ValidationError, isRecoverableFtsError } from '../src/store.js';
import type { SearchHit } from '../src/types.js';
import { tempDb } from './helpers.js';

function totalSize(hits: SearchHit[]): number {
  return hits.reduce((n, h) => n + JSON.stringify(h).length, 0);
}

test('oversized source lists are trimmed in previews but complete via get', () => {
  const t = tempDb('budget');
  try {
    const store = new KeeperStore(t.db);
    try {
      const sources = Array.from({ length: 50 }, (_, i) => `source-${i} ` + 'reference detail '.repeat(20));
      const saved = store.save({ kind: 'decision', title: 'Many sources record', body: 'budget sources body' });
      // Re-save with the big source list via supersede to keep one current record.
      const { current } = store.supersede(saved.id, {
        kind: 'decision',
        title: 'Many sources record',
        body: 'budget sources body',
        sources,
      });
      const hits = store.search('budget sources');
      assert.equal(hits.length, 1);
      assert.ok(totalSize(hits) <= 12000, `preview exceeded default budget: ${totalSize(hits)}`);
      assert.ok(hits[0]!.sources.length < 50, 'preview sources must shrink to fit');
      const full = store.get(current.id)!;
      assert.equal(full.sources.length, 50, 'get(id) must preserve every source');
      assert.deepEqual(full.sources, sources.map((s) => s.trim()), 'sources stored trimmed, as validated');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('a budget that cannot fit even the minimum preview raises a budget error', () => {
  const t = tempDb('budget');
  try {
    const store = new KeeperStore(t.db);
    try {
      const saved = store.save({ kind: 'decision', title: 'Short', body: 'tiny body' });
      assert.throws(() => store.search('short', { maxChars: 100 }), BudgetError);
      assert.throws(() => store.search('short', { maxChars: 100 }), /budget-exceeded/);
      // The record itself is untouched and fully readable.
      assert.equal(store.get(saved.id)!.body, 'tiny body');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('a small but viable budget returns strictly bounded previews', () => {
  const t = tempDb('budget');
  try {
    const store = new KeeperStore(t.db);
    try {
      for (let i = 0; i < 4; i++) {
        store.save({ kind: 'decision', title: `viable ${i}`, body: `viable body text ${i} `.repeat(40) });
      }
      const hits = store.search('viable', { limit: 10, maxChars: 900 });
      assert.ok(hits.length >= 1);
      assert.ok(totalSize(hits) <= 900, `total ${totalSize(hits)} exceeded budget 900`);
      for (const h of hits) assert.ok(JSON.stringify(h).length <= 900);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('invalid or non-finite numeric limits are rejected', () => {
  const t = tempDb('budget');
  try {
    const store = new KeeperStore(t.db);
    try {
      store.save({ kind: 'decision', title: 'Numbers', body: 'numeric guard body' });
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5' as unknown as number]) {
        assert.throws(() => store.search('numeric', { limit: bad }), ValidationError, `limit=${String(bad)}`);
        assert.throws(() => store.search('numeric', { snippetChars: bad }), ValidationError, `snippetChars=${String(bad)}`);
        assert.throws(() => store.search('numeric', { maxChars: bad }), ValidationError, `maxChars=${String(bad)}`);
      }
      const rec = store.save({ kind: 'decision', title: 'Rev', body: 'rev body' });
      assert.throws(() => store.supersede(rec.id, { kind: 'decision', title: 'x', body: 'y' }, Number.NaN), ValidationError);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('only genuine query-syntax failures are recoverable, never bare fts5: errors', () => {
  assert.equal(isRecoverableFtsError(new Error('syntax error near "foo"')), true);
  assert.equal(isRecoverableFtsError(new Error('unterminated string')), true);
  assert.equal(isRecoverableFtsError(new Error('unknown special query: bar')), true);
  // Everything else propagates — including internal errors that mention fts5:.
  assert.equal(isRecoverableFtsError(new Error('fts5: internal index failure')), false);
  assert.equal(isRecoverableFtsError(new Error('no such table: records_fts')), false);
  assert.equal(isRecoverableFtsError(new Error('database disk image is malformed')), false);
  assert.equal(isRecoverableFtsError(new Error('cannot open database file')), false);
  assert.equal(isRecoverableFtsError('syntax error'), false);
  assert.equal(isRecoverableFtsError(null), false);
});
