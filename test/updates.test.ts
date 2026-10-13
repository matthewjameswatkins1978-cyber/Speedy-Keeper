/** Updates happen only through atomic supersede, with revision-conflict protection. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ConflictError, KeeperStore, NotFoundError, ValidationError } from '../src/store.js';
import { tempDb } from './helpers.js';

test('supersede links the old record and hides it from ordinary search', () => {
  const t = tempDb('updates');
  try {
    const store = new KeeperStore(t.db);
    try {
      const old = store.save({ kind: 'decision', title: 'Use triggers', body: 'first draft' });
      const { old: retired, current } = store.supersede(old.id, {
        kind: 'decision',
        title: 'Use triggers',
        body: 'second draft with delete trigger',
      });
      assert.equal(retired.supersededBy, current.id);
      assert.equal(retired.revision, 2);
      assert.notEqual(current.id, old.id);
      // New text is searchable, old text row is hidden by default.
      assert.equal(store.search('delete trigger')[0]!.id, current.id);
      assert.deepEqual(store.search('delete trigger').map((r) => r.id).includes(old.id), false);
      // Explicit opt-in still finds the retired record.
      const withOld = store.search('first draft', { includeSuperseded: true });
      assert.ok(withOld.some((r) => r.id === old.id));
      // get() by id always works, retired or not.
      assert.equal(store.get(old.id)!.supersededBy, current.id);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('supersede rejects missing ids, double-supersede and stale revisions', () => {
  const t = tempDb('updates');
  try {
    const store = new KeeperStore(t.db);
    try {
      const rec = store.save({ kind: 'gotcha', title: 'Rev check', body: 'v1' });
      assert.throws(
        () => store.supersede('missing-id', { kind: 'gotcha', title: 'x', body: 'y' }),
        NotFoundError,
      );
      assert.throws(
        () => store.supersede(rec.id, { kind: 'gotcha', title: 'x', body: 'y' }, 999),
        ConflictError,
      );
      const ok = store.supersede(rec.id, { kind: 'gotcha', title: 'x', body: 'y' }, 1);
      assert.equal(ok.current.revision, 1);
      assert.throws(
        () => store.supersede(rec.id, { kind: 'gotcha', title: 'z', body: 'w' }),
        ConflictError,
      );
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('evidenced claims require explicit sources; nothing is auto-verified', () => {
  const t = tempDb('updates');
  try {
    const store = new KeeperStore(t.db);
    try {
      const plain = store.save({ kind: 'decision', title: 'Hunch', body: 'probably fine', sources: ['notes.md'] });
      assert.equal(plain.claimStatus, 'provisional');
      assert.throws(
        () => store.save({ kind: 'decision', title: 'Claim', body: 'trust me', claimStatus: 'evidenced' }),
        ValidationError,
      );
      const backed = store.save({
        kind: 'decision',
        title: 'Measured',
        body: 'bench says so',
        sources: ['bench.log'],
        claimStatus: 'evidenced',
      });
      assert.equal(backed.claimStatus, 'evidenced');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
