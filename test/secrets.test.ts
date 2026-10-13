/** Secrets are rejected; ordinary engineering notes pass through. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

const SECRETS = [
  '-----BEGIN RSA PRIVATE KEY-----\nMIIB...',
  'the key is sk-abcdefghijklmnop1234567890 end',
  'token ghp_abcdefghijklmnop1234567890 helps',
  'id AKIAIOSFODNN7EXAMPLE here',
  'xoxb-1234567890-abcdefghij secret',
  'AIzaSyB4x-abcdefghijklmnopqrstuv end',
  'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYKEY here',
  'password: hunter2hunter2 noted',
];

for (const sample of SECRETS) {
  test(`rejects secret-like input (${sample.slice(0, 24)}…)`, () => {
    const t = tempDb('secrets');
    try {
      const store = new KeeperStore(t.db);
      try {
        assert.throws(() => store.save({ kind: 'decision', title: 'Routine note', body: sample }), /secret-rejected/);
      } finally {
        store.close();
      }
    } finally {
      t.cleanup();
    }
  });
}

test('ordinary notes mentioning keys in the abstract are accepted', () => {
  const t = tempDb('secrets');
  try {
    const store = new KeeperStore(t.db);
    try {
      const rec = store.save({
        kind: 'decision',
        title: 'Rotate the deploy API key',
        body: 'Rotate the deploy key quarterly; the current value lives in the team vault, see docs/ops.md.',
      });
      assert.equal(store.get(rec.id)!.title, 'Rotate the deploy API key');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('oversized bodies are rejected with guidance to summarise', () => {
  const t = tempDb('secrets');
  try {
    const store = new KeeperStore(t.db);
    try {
      assert.throws(
        () => store.save({ kind: 'gotcha', title: 'Huge dump', body: 'x'.repeat(9000) }),
        /exceeds 8000 characters/,
      );
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
