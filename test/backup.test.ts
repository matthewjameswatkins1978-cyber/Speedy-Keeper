/** Backups: VACUUM INTO produces an independent, queryable copy. */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

test('backup copies records including supersede links, and stays usable', () => {
  const t = tempDb('backup');
  const dest = join(t.dir, 'copy.sqlite');
  let v1id = '';
  let v2id = '';
  const store = new KeeperStore(t.db);
  try {
    const v1 = store.save({ kind: 'decision', title: 'Backup me', body: 'original words' });
    const { current } = store.supersede(v1.id, { kind: 'decision', title: 'Backup me', body: 'revised words' });
    v1id = v1.id;
    v2id = current.id;
    store.save({ kind: 'gotcha', title: 'Second record', body: 'still here' });
    const info = store.backup(dest);
    assert.equal(info.path, dest);
    assert.ok(existsSync(dest));
    assert.ok(info.bytes > 0);
  } finally {
    store.close();
  }
  // The backup opens standalone and answers queries.
  const restored = new KeeperStore(dest);
  try {
    assert.equal(restored.get(v2id)!.body, 'revised words');
    assert.equal(restored.get(v1id)!.supersededBy, v2id);
    assert.equal(restored.search('revised words').length, 1);
    assert.deepEqual(restored.search('original words'), []);
    assert.equal(restored.search('original words', { includeSuperseded: true }).length, 1);
    assert.equal(restored.search('still here').length, 1);
  } finally {
    restored.close();
  }
});

test('exportAll emits readable JSON-ready records, superseded hidden by default', () => {
  const t = tempDb('backup');
  try {
    const store = new KeeperStore(t.db);
    try {
      const v1 = store.save({ kind: 'decision', title: 'Export me', body: 'v1' });
      store.supersede(v1.id, { kind: 'decision', title: 'Export me', body: 'v2' });
      const current = store.exportAll();
      assert.equal(current.length, 1);
      assert.equal(current[0]!.body, 'v2');
      const text = JSON.stringify(current, null, 2);
      assert.ok(text.includes('"body": "v2"'));
      assert.equal(store.exportAll({ includeSuperseded: true }).length, 2);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
