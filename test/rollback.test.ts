/** Rollback: failed writes and supersedes leave the database unchanged. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictError, KeeperStore, ValidationError } from '../src/store.js';
import { tempDb } from './helpers.js';

test('a transaction that throws mid-write rolls everything back', () => {
  const t = tempDb('rollback');
  try {
    const store = new KeeperStore(t.db);
    try {
      assert.throws(() =>
        store.transaction(() => {
          store.save({ kind: 'decision', title: 'rollback marker alpha', body: 'must vanish' });
          throw new Error('boom');
        }),
      );
      assert.deepEqual(store.search('rollback marker alpha'), []);
      assert.deepEqual(store.exportAll(), []);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('a supersede that fails validation or conflicts changes nothing', () => {
  const t = tempDb('rollback');
  try {
    const store = new KeeperStore(t.db);
    try {
      const rec = store.save({ kind: 'decision', title: 'Steady state', body: 'v1 body' });
      const before = store.exportAll().length;
      assert.throws(
        () => store.supersede(rec.id, { kind: 'decision', title: '  ', body: 'bad title' }),
        ValidationError,
      );
      assert.throws(
        () => store.supersede(rec.id, { kind: 'decision', title: 'New', body: 'v2' }, 42),
        ConflictError,
      );
      const after = store.get(rec.id)!;
      assert.equal(after.supersededBy, null);
      assert.equal(after.revision, 1);
      assert.equal(after.body, 'v1 body');
      assert.equal(store.exportAll().length, before);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
