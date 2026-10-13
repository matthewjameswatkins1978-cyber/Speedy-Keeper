/** Concurrent handles on one file: serialised writes, visible busy errors. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

test('interleaved writers on two handles lose nothing', () => {
  const t = tempDb('concurrency');
  try {
    const a = new KeeperStore(t.db);
    const b = new KeeperStore(t.db);
    try {
      for (let i = 0; i < 20; i++) {
        a.save({ kind: 'decision', title: `a-${i} concurrent`, body: 'writer a' });
        b.save({ kind: 'decision', title: `b-${i} concurrent`, body: 'writer b' });
      }
      const all = a.search('concurrent', { limit: 100, maxChars: 200000 });
      assert.equal(all.length, 40);
      const ids = new Set(all.map((r) => r.id));
      assert.equal(ids.size, 40);
    } finally {
      a.close();
      b.close();
    }
  } finally {
    t.cleanup();
  }
});

test('a write blocked by an open transaction surfaces a busy error, then succeeds', () => {
  const t = tempDb('concurrency');
  try {
    const a = new KeeperStore(t.db);
    const b = new KeeperStore(t.db, { busyTimeoutMs: 50 });
    try {
      a.transaction(() => {
        assert.throws(() => b.save({ kind: 'gotcha', title: 'blocked write', body: 'held lock' }), /busy|locked/i);
      });
      const rec = b.save({ kind: 'gotcha', title: 'blocked write', body: 'lock released' });
      assert.equal(a.get(rec.id)!.title, 'blocked write');
    } finally {
      a.close();
      b.close();
    }
  } finally {
    t.cleanup();
  }
});
