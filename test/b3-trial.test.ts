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
    const out = execFileSync(
      process.execPath,
      [join(root, 'trials', 'seed.mjs'), db, 'K6-hostile-testnotes'],
      { encoding: 'utf8', timeout: 60000 },
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.taskId, 'K6-hostile-testnotes');
    assert.equal(parsed.count, 3);
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

test('dry run plans 96 isolated live calls across waves with the right shape', async () => {
  // @ts-ignore: untyped trial helper (mjs)
  const { dryRun } = await import(trial('run.mjs'));
  const scout = dryRun('scout') as Array<{ taskId: string; condition: string; command: string; rep: number }>;
  const full = dryRun('full') as Array<{ taskId: string; condition: string; command: string }>;
  const all = dryRun('all') as Array<{ taskId: string; condition: string; command: string }>;
  assert.equal(scout.length, 32, 'scout: 4 tasks × 4 conditions × 2 reps');
  assert.equal(full.length, 64, 'full: 4 new × 4 × 3 + scout top-up 4 × 4 × 1');
  assert.equal(all.length, 96, 'complete matrix');
  const runId = (p: { taskId: string; condition: string; rep?: number }): string =>
    `${p.taskId}_${p.condition}_r${p.rep}`;
  assert.equal(new Set(full.map(runId)).size, 64, 'full-wave runIds must be unique (top-up continues at r3)');
  assert.equal(new Set(all.map(runId)).size, 96, 'merged dataset must not re-label any run');
  const conds = [...new Set(all.map((p) => p.condition))].sort();
  assert.deepEqual(conds, ['A', 'B', 'C', 'D']);
  const taskIds = [...new Set(all.map((p) => p.taskId))];
  assert.equal(taskIds.length, 8, 'all eight tasks appear in the full dataset');
  for (const p of all) {
    assert.ok(p.command.includes('"--thinking" "off"'), p.command);
    assert.ok(p.command.includes('"--session-dir"'), p.command);
    assert.ok(p.command.includes('mimo-v2.6-flash'), p.command);
    if (p.condition === 'A') assert.ok(!p.command.includes('--extension'), p.command);
    else assert.ok(p.command.includes('keeper-memory.ts'), p.command);
    if (p.condition === 'D') assert.ok(p.command.includes('preview-extension.ts'), p.command);
    else assert.ok(!p.command.includes('preview-extension.ts'), p.command);
  }
});
