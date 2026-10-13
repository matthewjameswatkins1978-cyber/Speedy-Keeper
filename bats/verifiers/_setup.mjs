/**
 * Shared verifier preamble. Terrorbat worktrees contain sources but no
 * node_modules/dist, so verifiers self-provision from a local module source
 * (SPEEDY_KEEPER_MODULES: absolute path to a populated node_modules) with
 * plain filesystem copies — no network, no registry, no privilege.
 * Every verifier: `node bats/verifiers/<name>.mjs` from the repo root.
 * Exit 0 + `PASS: <id>` line, or exit 1 + `FAIL: <id> <reason>`.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function ensureBuilt() {
  const root = repoRoot();
  const modules = process.env['SPEEDY_KEEPER_MODULES'];
  if (!modules) throw new Error('SPEEDY_KEEPER_MODULES env (absolute path to a populated node_modules) is required');
  const dest = join(root, 'node_modules');
  mkdirSync(dest, { recursive: true });
  for (const pkg of ['typebox', 'typescript', '@types']) {
    const from = join(modules, pkg);
    if (!existsSync(from)) throw new Error(`module source missing: ${from}`);
    const to = join(dest, pkg);
    if (!existsSync(to)) cpSync(from, to, { recursive: true });
  }
  if (!existsSync(join(root, 'dist', 'src', 'store.js'))) {
    execFileSync(process.execPath, [join(dest, 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.json')], {
      cwd: root,
      stdio: 'pipe',
    });
  }
}

export function fail(id, reason) {
  console.log(`FAIL: ${id} ${reason instanceof Error ? reason.message : reason}`);
  process.exit(1);
}

export function pass(id) {
  console.log(`PASS: ${id}`);
}
