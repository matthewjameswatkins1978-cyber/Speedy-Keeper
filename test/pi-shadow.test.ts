/** Shadow-mode pre-task retrieval: logged, budgeted, never injected. */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { appendShadowLog, shadowRetrieve } from '../src/pi/shadow.js';
import { tempDb } from './helpers.js';

function seedTopics(db: string): void {
  const store = new KeeperStore(db);
  try {
    store.save({ kind: 'decision', title: 'WAL journal mode', body: 'wal allows readers during writes, busy timeout five seconds' });
    store.save({ kind: 'gotcha', title: 'WAL checkpoint pitfall', body: 'wal file grows without checkpoints on busy volumes' });
    store.save({ kind: 'checkpoint', title: 'WAL rollout task', body: 'wal rollout across services', taskScope: 'storage' });
    store.save({ kind: 'decision', title: 'Backup strategy', body: 'vacuum into gives online backups' });
    store.save({ kind: 'decision', title: 'Banner colour', body: 'pick blue for the landing page banner' });
    store.save({ kind: 'gotcha', title: 'Unrelated flake', body: 'retry storms on thundering herd deploys' });
  } finally {
    store.close();
  }
}

test('shadow retrieval logs without injecting and stays budgeted', () => {
  const t = tempDb('pi-shadow');
  try {
    seedTopics(t.db);
    const store = new KeeperStore(t.db);
    try {
      const log = join(t.dir, 'shadow.jsonl');
      const r = shadowRetrieve(store, 'wal mode readers', { logPath: log });
      assert.equal(r.mode, 'shadow');
      assert.equal(r.wouldInject, false);
      assert.ok(r.hitIds.length > 0);
      assert.ok(r.chars <= 2000, `shadow output exceeded budget: ${r.chars}`);
      assert.ok(r.estTokens > 0);
      const lines = readFileSync(log, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const logged = JSON.parse(lines[0]!) as typeof r;
      assert.equal(logged.wouldInject, false);
      assert.deepEqual(logged.hitIds, r.hitIds);
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('shadow relevance: topical hits found, unrelated excluded', () => {
  const t = tempDb('pi-shadow');
  try {
    seedTopics(t.db);
    const store = new KeeperStore(t.db);
    try {
      const r = shadowRetrieve(store, 'wal', { limit: 5 });
      // Recall: all three wal records surface; precision: banner/flake absent.
      assert.equal(r.hitIds.length, 3);
      const texts = r.hitIds.map((id) => store.get(id)!.title).join(' | ');
      assert.ok(texts.includes('WAL journal mode'));
      assert.ok(texts.includes('WAL checkpoint pitfall'));
      assert.ok(texts.includes('WAL rollout task'));
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('appendShadowLog appends one JSON object per line', () => {
  const t = tempDb('pi-shadow');
  try {
    const log = join(t.dir, 'nested', 's.jsonl');
    appendShadowLog(log, { mode: 'shadow', query: 'a', hitIds: [], chars: 1, estTokens: 1, wouldInject: false, at: 't' });
    appendShadowLog(log, { mode: 'shadow', query: 'b', hitIds: ['x'], chars: 2, estTokens: 1, wouldInject: false, at: 't' });
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal((JSON.parse(lines[0]!) as { query: string }).query, 'a');
  } finally {
    t.cleanup();
  }
});
