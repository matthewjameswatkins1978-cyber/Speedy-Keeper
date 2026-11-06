/** v2 schema: new kinds, enforced grades, migration, OR-fallback. */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { KeeperStore, ValidationError } from '../src/store.js';
import { tempDb } from './helpers.js';

test('new kinds save with INFERRED default mapping to provisional', () => {
  const t = tempDb('v2-kinds');
  try {
    const store = new KeeperStore(t.db);
    try {
      for (const kind of ['baseline', 'ask', 'brief'] as const) {
        const rec = store.save({ kind, title: `${kind} note`, body: 'short body' });
        assert.equal(rec.kind, kind);
        assert.equal(rec.grade, 'INFERRED');
        assert.equal(rec.claimStatus, 'provisional');
        assert.deepEqual(rec.dependsOn, []);
        assert.deepEqual(rec.links, []);
        assert.equal(rec.evidence, null);
      }
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('SOURCE-READ requires sources and maps to evidenced', () => {
  const t = tempDb('v2-source-read');
  try {
    const store = new KeeperStore(t.db);
    try {
      assert.throws(
        () => store.save({ kind: 'gotcha', title: 't', body: 'b', grade: 'SOURCE-READ' }),
        (e: unknown) => e instanceof ValidationError && /requires at least one source/.test(e.message),
      );
      const rec = store.save({
        kind: 'gotcha',
        title: 't',
        body: 'b',
        grade: 'SOURCE-READ',
        sources: ['src/store.ts'],
      });
      assert.equal(rec.grade, 'SOURCE-READ');
      assert.equal(rec.claimStatus, 'evidenced');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('TESTED requires run evidence and sources; refusal teaches the fix', () => {
  const t = tempDb('v2-tested');
  try {
    const store = new KeeperStore(t.db);
    try {
      assert.throws(
        () => store.save({ kind: 'decision', title: 't', body: 'b', grade: 'TESTED', sources: ['x'] }),
        (e: unknown) => e instanceof ValidationError && /requires evidence \{run, exit\}/.test(e.message),
      );
      assert.throws(
        () =>
          store.save({
            kind: 'decision',
            title: 't',
            body: 'b',
            grade: 'TESTED',
            evidence: { run: 'npm test', exit: 0 },
          }),
        (e: unknown) => e instanceof ValidationError && /requires at least one source/.test(e.message),
      );
      const rec = store.save({
        kind: 'decision',
        title: 't',
        body: 'b',
        grade: 'TESTED',
        sources: ['test/v2-schema.test.ts'],
        evidence: { run: 'npm test', exit: 0 },
      });
      assert.equal(rec.claimStatus, 'evidenced');
      assert.deepEqual(rec.evidence, { run: 'npm test', exit: 0 });
      const reread = store.get(rec.id)!;
      assert.deepEqual(reread.evidence, { run: 'npm test', exit: 0 });
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('explicit claimStatus cannot exceed the grade', () => {
  const t = tempDb('v2-status-cap');
  try {
    const store = new KeeperStore(t.db);
    try {
      assert.throws(
        () => store.save({ kind: 'gotcha', title: 't', body: 'b', claimStatus: 'evidenced' }),
        (e: unknown) => e instanceof ValidationError && /non-INFERRED grade/.test(e.message),
      );
      // Backwards compatibility: pre-grade evidenced-with-sources callers
      // promote to SOURCE-READ instead of failing.
      const rec = store.save({
        kind: 'gotcha',
        title: 't',
        body: 'b',
        claimStatus: 'evidenced',
        sources: ['x.md'],
      });
      assert.equal(rec.grade, 'SOURCE-READ');
      assert.equal(rec.claimStatus, 'evidenced');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('links and dependsOn round-trip; bad links refused', () => {
  const t = tempDb('v2-links');
  try {
    const store = new KeeperStore(t.db);
    try {
      const a = store.save({ kind: 'decision', title: 'a', body: 'b' });
      const b = store.save({
        kind: 'decision',
        title: 'b',
        body: 'c',
        dependsOn: ['abc1234', 'docs/x.md'],
        links: [{ rel: 'falsifies', id: a.id }],
      });
      assert.deepEqual(b.dependsOn, ['abc1234', 'docs/x.md']);
      assert.deepEqual(b.links, [{ rel: 'falsifies', id: a.id }]);
      assert.throws(
        () => store.save({ kind: 'decision', title: 't', body: 'b', links: [{ rel: 'eats', id: a.id }] as never }),
        (e: unknown) => e instanceof ValidationError && /links\[0\]\.rel/.test(e.message),
      );
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

const V1_SCHEMA = `
CREATE TABLE records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('decision','gotcha','checkpoint')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  task_scope TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  claim_status TEXT NOT NULL DEFAULT 'provisional'
    CHECK (claim_status IN ('provisional','evidenced')),
  revision INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT REFERENCES records(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE records_fts USING fts5(title, body, task_scope, content='records', content_rowid='rowid');
CREATE TRIGGER records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, title, body, task_scope) VALUES (new.rowid, new.title, new.body, new.task_scope);
END;
`;

test('v1 databases migrate: data preserved, evidenced maps to SOURCE-READ', () => {
  const t = tempDb('v2-migrate');
  try {
    const raw = new DatabaseSync(t.db);
    raw.exec(V1_SCHEMA);
    raw
      .prepare(
        "INSERT INTO records (id, kind, title, body, task_scope, sources, claim_status, revision, created_at, updated_at) VALUES ('old-1', 'decision', 'Old call', 'Old body text here', 'scope-a', '[\"s.md\"]', 'evidenced', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    raw
      .prepare(
        "INSERT INTO records (id, kind, title, body, task_scope, sources, claim_status, revision, created_at, updated_at) VALUES ('old-2', 'gotcha', 'Old hunch', 'Hunch body text here', NULL, '[]', 'provisional', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    raw.close();
    const store = new KeeperStore(t.db);
    try {
      const one = store.get('old-1')!;
      assert.equal(one.title, 'Old call');
      assert.equal(one.grade, 'SOURCE-READ');
      assert.equal(one.claimStatus, 'evidenced');
      assert.deepEqual(one.sources, ['s.md']);
      const two = store.get('old-2')!;
      assert.equal(two.grade, 'INFERRED');
      const hits = store.search('hunch');
      assert.equal(hits.length, 1);
      assert.equal(hits[0]!.id, 'old-2');
      // New kinds accepted on the migrated database.
      const rec = store.save({ kind: 'brief', title: 'new', body: 'after migration' });
      assert.equal(rec.kind, 'brief');
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});

test('OR-fallback defeats AND-starvation: disjoint tokens still surface', () => {
  const t = tempDb('v2-or');
  try {
    const store = new KeeperStore(t.db);
    try {
      store.save({ kind: 'gotcha', title: 'PowerShell exit codes', body: 'capture LASTEXITCODE immediately' });
      store.save({ kind: 'gotcha', title: 'CRLF line endings', body: 'threadmoth needs exact bytes' });
      const andQuery = store.search('PowerShell CRLF');
      assert.ok(
        andQuery.length >= 1,
        `expected OR-fallback to surface partial matches, got ${andQuery.length}`,
      );
      const titles = andQuery.map((h) => h.title);
      assert.ok(titles.some((x) => x.includes('PowerShell')));
    } finally {
      store.close();
    }
  } finally {
    t.cleanup();
  }
});
