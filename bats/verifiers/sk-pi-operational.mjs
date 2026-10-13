/**
 * sk-pi-operational: Pi runs normally with Speedy Keeper absent and with it
 * explicitly disabled. No model calls: --list-models --offline only.
 */
import { execFileSync } from 'node:child_process';
import { ensureBuilt, fail, pass, repoRoot } from './_setup.mjs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ID = 'sk-pi-operational';

function pi(args, env) {
  // pi ships as a .cmd shim: spawn it through cmd (Windows-only bat).
  return execFileSync('cmd', ['/c', 'pi', ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 120000,
    stdio: 'pipe',
  });
}

try {
  ensureBuilt();
  const root = repoRoot();
  const ext = join(root, 'pi-extension', 'keeper-memory.ts');

  const plain = pi(['--list-models', '--offline'], {});
  if (!plain.includes('provider')) fail(ID, 'pi without extension did not list models');

  const disabled = pi(['--extension', ext, '--list-models', '--offline'], { SPEEDY_KEEPER_DISABLED: '1' });
  if (!disabled.includes('provider')) fail(ID, 'pi with disabled extension did not list models');

  const enabled = pi(['--extension', ext, '--list-models', '--offline'], {
    SPEEDY_KEEPER_DB: join(tmpdir(), 'bat-pi-probe.sqlite'),
  });
  if (!enabled.includes('provider')) fail(ID, 'pi with enabled extension did not list models');
  pass(ID);
} catch (err) {
  fail(ID, err);
}
