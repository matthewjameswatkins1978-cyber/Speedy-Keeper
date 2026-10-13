/**
 * Terrorbat runner: every bat verifier doubles as a reproducible node:test
 * case, so `npm test` gates the whole assault locally. Full receipts come
 * from the real harness: `terrorbats run bats/<id>.yaml --repo .`
 * (SPEEDY_KEEPER_MODULES must point at a populated node_modules; the runner
 * sets it to this checkout's own).
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BATS = [
  'sk-fence-delimiters',
  'sk-fence-forged-messages',
  'sk-fence-taskscope',
  'sk-budget-maxfields',
  'sk-budget-tiny',
  'sk-runtime-deps',
  'sk-runtime-crash',
  'sk-runtime-no-hooks',
  'sk-pi-operational',
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const id of BATS) {
  test(`terrorbat ${id}`, { timeout: 180000 }, () => {
    let out = '';
    try {
      out = execFileSync(
        process.execPath,
        [join(root, 'bats', 'verifiers', `${id}.mjs`)],
        {
          cwd: root,
          env: { ...process.env, SPEEDY_KEEPER_MODULES: join(root, 'node_modules') },
          encoding: 'utf8',
          timeout: 170000,
          stdio: 'pipe',
        },
      );
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      assert.fail(`bat ${id} PROVEN (vulnerability): ${(e.stdout ?? '').trim()} ${(e.stderr ?? '').trim()}`.trim());
    }
    assert.ok(out.includes(`PASS: ${id}`), `bat ${id} missing PASS receipt line: ${out.slice(0, 200)}`);
  });
}
