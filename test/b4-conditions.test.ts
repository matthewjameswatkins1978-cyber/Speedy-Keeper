/** B4 dry-run contract for the four-condition matrix (no live calls). */
import { strict as assert } from 'node:assert';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const trial = (f: string): string => pathToFileURL(join(root, 'trials', f)).href;

interface Plan {
  taskId: string;
  condition: 'A' | 'B' | 'C' | 'D';
  keeper: boolean;
  preview: boolean;
  hint: boolean;
  seeded: boolean;
  command: string;
  cwd: string;
}

test('dry run plans the 12-run A/B/C/D matrix with correct wiring', async () => {
  // @ts-ignore: untyped trial helper (mjs)
  const { dryRun } = await import(trial('run.mjs'));
  const plans = dryRun() as Plan[];
  assert.equal(plans.length, 12, '3 tasks × 4 conditions');
  const ids = plans.map((p) => `${p.taskId}/${p.condition}`).sort();
  assert.deepEqual(ids, [
    'T1-recall/A', 'T1-recall/B', 'T1-recall/C', 'T1-recall/D',
    'T2-stale-hostile/A', 'T2-stale-hostile/B', 'T2-stale-hostile/C', 'T2-stale-hostile/D',
    'T3-hostile-only/A', 'T3-hostile-only/B', 'T3-hostile-only/C', 'T3-hostile-only/D',
  ]);
  for (const p of plans) {
    assert.ok(p.command.includes('"--thinking" "off"'), p.command);
    assert.ok(p.command.includes('"--session-dir"'), p.command);
    assert.ok(p.command.includes('mimo-v2.6-flash'), p.command);
    assert.equal(p.hint, p.condition === 'C' || p.condition === 'D', `${p.condition} hint flag`);
    if (p.condition === 'A') {
      assert.equal(p.keeper, false);
      assert.equal(p.preview, false);
      assert.equal(p.seeded, false);
      assert.ok(!p.command.includes('--extension'), `A must load no extension: ${p.command}`);
    } else {
      assert.equal(p.keeper, true);
      assert.equal(p.seeded, true);
      assert.ok(p.command.includes('keeper-memory.ts'), `${p.condition} must load the keeper extension`);
    }
    if (p.condition === 'D') {
      assert.equal(p.preview, true);
      assert.ok(p.command.includes('preview-extension.ts'), 'D must load the harness preview extension');
    } else {
      assert.equal(p.preview, false);
      assert.ok(!p.command.includes('preview-extension.ts'), `only D loads the preview extension: ${p.command}`);
    }
    if (p.condition === 'C') {
      // C adds no flag of its own: its difference is the adapter's prompt
      // metadata (env-gated), so the C command must be byte-identical to B's.
      const b = plans.find((x) => x.taskId === p.taskId && x.condition === 'B')!;
      assert.equal(p.command, b.command, 'C must differ from B only in adapter metadata');
    }
  }
});
