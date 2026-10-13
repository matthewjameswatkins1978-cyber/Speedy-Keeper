/** Adapter envelopes: structured results, budgets, empty/disabled/unavailable paths. */
import { strict as assert } from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { createMemoryTools, type ToolDefinition } from '../src/pi/adapter.js';
import { ADVISORY_PREAMBLE } from '../src/pi/format.js';
import { tempDb } from './helpers.js';

function tools(db: string): ToolDefinition[] {
  return createMemoryTools({ dbPath: db });
}

async function call(tool: ToolDefinition, params: Record<string, unknown>): Promise<{ text: string; details: any }> {
  const res = await tool.execute('test-call', params as never, undefined, undefined, { cwd: process.cwd() });
  assert.equal(res.content.length, 1);
  return { text: res.content[0]!.text, details: res.details as any };
}

test('only memory_search and memory_save are exposed', () => {
  const names = createMemoryTools({ dbPath: ':memory:' }).map((t) => t.name);
  assert.deepEqual(names, ['memory_search', 'memory_save']);
});

test('search returns fenced advisory previews within budget', async () => {
  const t = tempDb('pi-adapter');
  try {
    const seed = new KeeperStore(t.db);
    try {
      seed.save({ kind: 'decision', title: 'Adapter note', body: 'adapter body words here', sources: ['a.ts'] });
    } finally {
      seed.close();
    }
    const [search] = tools(t.db);
    const { text, details } = await call(search!, { query: 'adapter note' });
    assert.equal(details.ok, true);
    assert.equal(details.hits.length, 1);
    assert.ok(text.includes(ADVISORY_PREAMBLE));
    assert.ok(text.includes('<<<begin-untrusted-memory'));
    assert.ok(text.includes('<<<end-untrusted-memory'));
    assert.ok(text.includes(details.hits[0].id));
    assert.ok(!('body' in details.hits[0]), 'previews must not carry full bodies');
    assert.ok(text.length <= 4000, `tool output exceeded budget: ${text.length}`);
    assert.ok(details.estTokens > 0 && details.chars === text.length);
  } finally {
    t.cleanup();
  }
});

test('empty memory is a normal empty result, not a failure', async () => {
  const t = tempDb('pi-adapter');
  try {
    const [search] = tools(t.db);
    const { details } = await call(search!, { query: 'nothing stored yet' });
    assert.equal(details.ok, true);
    assert.deepEqual(details.hits, []);
  } finally {
    t.cleanup();
  }
});

test('save round-trips through the tool and rejects secrets as data', async () => {
  const t = tempDb('pi-adapter');
  try {
    const [, save] = tools(t.db);
    const ok = await call(save!, { kind: 'gotcha', title: 'Tool save', body: 'saved via tool' });
    assert.equal(ok.details.ok, true);
    assert.ok(ok.details.record.id.length > 0);
    assert.ok(ok.text.includes('Memory advisory'));
    const bad = await call(save!, { kind: 'gotcha', title: 'x', body: 'key sk-abcdefghijklmnop1234567890' });
    assert.equal(bad.details.ok, false);
    assert.equal(bad.details.code, 'secret-rejected');
    const invalid = await call(save!, { kind: 'decision', title: '  ', body: 'y' });
    assert.equal(invalid.details.ok, false);
    assert.equal(invalid.details.code, 'validation');
  } finally {
    t.cleanup();
  }
});

test('disabled memory reports disabled without touching storage', async () => {
  const t = tempDb('pi-adapter');
  try {
    const [search, save] = createMemoryTools({ dbPath: t.db, disabled: true });
    const s = await call(search!, { query: 'x' });
    assert.equal(s.details.ok, false);
    assert.equal(s.details.code, 'memory-disabled');
    const v = await call(save!, { kind: 'decision', title: 'x', body: 'y' });
    assert.equal(v.details.code, 'memory-disabled');
  } finally {
    t.cleanup();
  }
});

test('unopenable database degrades to memory-unavailable', async () => {
  const t = tempDb('pi-adapter');
  try {
    // A directory path cannot be opened as a database file.
    const [search] = tools(t.dir);
    const { details } = await call(search!, { query: 'x' });
    assert.equal(details.ok, false);
    assert.equal(details.code, 'memory-unavailable');
  } finally {
    t.cleanup();
  }
});

test('unexpected internal failures throw instead of being swallowed', async () => {
  const t = tempDb('pi-adapter');
  try {
    // Plant a regular table where the FTS index belongs. The store's schema
    // setup leaves it alone (CREATE ... IF NOT EXISTS), so every MATCH
    // query fails with a genuine SQLite error on every fresh open.
    const raw = new DatabaseSync(t.db);
    try {
      raw.exec('CREATE TABLE records_fts (rowid INTEGER PRIMARY KEY, title TEXT, body TEXT, task_scope TEXT)');
    } finally {
      raw.close();
    }
    const [search] = tools(t.db);
    await assert.rejects(() => call(search!, { query: 'broken' }), /no such column|MATCH/i);
  } finally {
    t.cleanup();
  }
});
