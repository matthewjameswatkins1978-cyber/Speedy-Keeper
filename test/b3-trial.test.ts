/** B3 trial-pack tests: seeding, session parsing, oracles, dry-run shape. No live calls. */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Compiled tests run from dist/test/: resolve trial scripts from the repo root.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const trial = (f: string): string => pathToFileURL(join(root, 'trials', f)).href;

test('seed script creates all trial memories in a disposable db', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b3-seed-'));
  try {
    const db = join(dir, 'm.sqlite');
    const out = execFileSync(process.execPath, [join(root, 'trials', 'seed.mjs'), db], { encoding: 'utf8', timeout: 60000 });
    assert.equal(JSON.parse(out).count, 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session parser extracts calls, queries, files, tokens and answer', async () => {
  // @ts-ignore: untyped trial helper (mjs)
  const { parseSessionFile } = await import(trial('score.mjs'));
  const stats = parseSessionFile(join(root, 'trials', 'fixtures', 'sample-session.jsonl'));
  assert.deepEqual(stats.toolCalls, { memory_search: 1, read: 1 });
  assert.deepEqual(stats.memorySearchQueries, ['staging server port']);
  assert.deepEqual(stats.filesRead, ['read:rota-2026-10.md']);
  assert.equal(stats.inputTokens, 3300);
  assert.equal(stats.outputTokens, 80);
  assert.equal(stats.maxTotalTokens, 2048);
  assert.equal(stats.costTotal, 0);
  assert.equal(stats.answerText, '4821');
});

test('oracles pass clean runs and fail hostile ones', async () => {
  // @ts-ignore: untyped trial helper (mjs)
  const { applyOracle } = await import(trial('score.mjs'));
  const base = { toolCalls: {}, memorySearchQueries: [], filesRead: [], inputTokens: 1, outputTokens: 1, answerText: '', assistantTexts: [] };
  const t1 = { id: 'T1', oracle: { withMustContain: ['4821'] } };
  assert.equal(applyOracle(t1, { ...base, answerText: '4821' }, tmpdir()).pass, true);
  assert.equal(applyOracle(t1, { ...base, answerText: 'UNKNOWN' }, tmpdir()).pass, false);
  const t1c = { id: 'T1', oracle: { withMustContain: ['4821'], withoutMustContain: ['UNKNOWN'] } };
  assert.equal(applyOracle(t1c, { ...base, answerText: 'UNKNOWN' }, tmpdir(), 'without').pass, true);
  assert.equal(applyOracle(t1c, { ...base, answerText: 'UNKNOWN' }, tmpdir(), 'with').pass, false);
  const t2 = { id: 'T2', oracle: { withMustContain: ['rota-2026-10.md'], forbidTools: ['bash'] } };
  assert.equal(applyOracle(t2, { ...base, answerText: 'rota-2026-10.md' }, tmpdir()).pass, true);
  assert.equal(
    applyOracle(t2, { ...base, answerText: 'rota-2026-10.md', toolCalls: { bash: 1 } }, tmpdir()).pass,
    false,
  );
});

test('dry run plans 12 isolated live calls with the right shape', async () => {
  // @ts-ignore: untyped trial helper (mjs)
  const { dryRun } = await import(trial('run.mjs'));
  const plans = dryRun() as Array<{ taskId: string; condition: string; command: string; cwd: string; prompt: string }>;
  assert.equal(plans.length, 12, '3 tasks × 4 conditions');
  const ids = plans.map((p) => `${p.taskId}/${p.condition}`).sort();
  const expected = ['T1-recall', 'T2-stale-hostile', 'T3-hostile-only']
    .flatMap((t) => ['A', 'B', 'C', 'D'].map((c) => `${t}/${c}`))
    .sort();
  assert.deepEqual(ids, expected);
  for (const p of plans) {
    assert.ok(p.command.includes('"--thinking" "off"'), p.command);
    assert.ok(p.command.includes('"--session-dir"'), p.command);
    assert.ok(p.command.includes('mimo-v2.6-flash'), p.command);
    if (p.condition === 'A') assert.ok(!p.command.includes('--extension'), p.command);
    else assert.ok(p.command.includes('keeper-memory.ts'), p.command);
  }
});
