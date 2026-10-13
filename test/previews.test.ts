/** Search previews: compact hits under a character budget; full bodies via get(). */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

test('search returns previews with stable ids, not full bodies', () => {
  const t = tempDb('previews');
  try {
    const store = new KeeperStore(t.db);
    try {
      const saved = store.save({
        kind: 'decision',
        title: 'Preview contract',
        body: 'full body text that must not leak into search output'.repeat(20),
        sources: ['src/store.ts'],
      });
      const hits = store.search('preview contract');
      assert.equal(hits.length, 1);
      const hit = hits[0]!;
      assert.equal(hit.id, saved.id);
      assert.equal(hit.kind, 'decision');
      assert.equal(hit.title, 'Preview contract');
      assert.deepEqual(hit.sources, ['src/store.ts']);
      assert.equal(hit.claimStatus, 'provisional');
      assert.ok(!('body' in hit), 'full body must not ride along in search hits');
      assert.ok(hit.snippet.length < saved.body.length);
      // Full content remains one get() away via the stable id.
      assert.equal(store.get(hit.id)!.body, saved.body);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('snippets centre on the match and respect snippetChars', () => {
  const t = tempDb('previews');
  try {
    const store = new KeeperStore(t.db);
    try {
      const filler = 'filler words padding the document. ';
      store.save({ kind: 'gotcha', title: 'Needle', body: filler.repeat(60) + 'needleterm buried deep' + filler.repeat(10) });
      const [hit] = store.search('needleterm', { snippetChars: 120 });
      assert.ok(hit, 'expected a hit');
      assert.ok(hit!.snippet.includes('needleterm'), `snippet missed the term: ${hit!.snippet}`);
      assert.ok(hit!.snippet.length <= 120 + 8, `snippet too long: ${hit!.snippet.length}`);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('maxChars caps total output but always returns the first hit', () => {
  const t = tempDb('previews');
  try {
    const store = new KeeperStore(t.db);
    try {
      for (let i = 0; i < 5; i++) {
        store.save({ kind: 'decision', title: `budget record ${i}`, body: `budget body ${i} `.repeat(60) });
      }
      const full = store.search('budget', { limit: 100, maxChars: 200000 });
      assert.equal(full.length, 5);
      const capped = store.search('budget', { limit: 100, maxChars: 800 });
      assert.ok(capped.length >= 1, 'first hit must survive any budget');
      assert.ok(capped.length < 5, 'budget must cut the tail');
      const [, ...tail] = capped;
      const tailSize = tail.reduce((n, h) => n + JSON.stringify(h).length, 0);
      assert.ok(tailSize <= 800, `tail exceeded budget: ${tailSize}`);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('punctuation-only queries degrade to bounded browsing instead of throwing', () => {
  const t = tempDb('previews');
  try {
    const store = new KeeperStore(t.db);
    try {
      store.save({ kind: 'decision', title: 'Something', body: 'ordinary words' });
      for (const q of ['((( ***', '"', 'OR AND NOT', '   ']) {
        const hits = store.search(q, { limit: 5 });
        assert.ok(Array.isArray(hits));
        assert.ok(hits.length <= 5);
      }
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('schema failures stay visible instead of falling back to LIKE', () => {
  const t = tempDb('previews');
  const store = new KeeperStore(t.db);
  try {
    store.save({ kind: 'decision', title: 'Indexed words here', body: 'findable findable' });
    assert.equal(store.search('findable').length, 1);
    // Simulate a broken index from an independent connection.
    const raw = new DatabaseSync(t.db);
    try {
      raw.exec('DROP TABLE records_fts');
    } finally {
      raw.close();
    }
    assert.throws(() => store.search('findable'), /no such table/i);
  } finally {
    store.close();
    t.cleanup();
  }
});

test('unexpected failures (closed handle) propagate to the caller', () => {
  const t = tempDb('previews');
  try {
    const store = new KeeperStore(t.db);
    store.save({ kind: 'decision', title: 'x', body: 'y' });
    store.close();
    assert.throws(() => store.search('x'));
  } finally {
    t.cleanup();
  }
});
