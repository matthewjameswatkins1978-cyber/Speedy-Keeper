/**
 * sk-runtime-crash: SIGKILL a writer mid-burst. Afterwards the database must
 * open cleanly, pass integrity_check, and hold only complete records.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureBuilt, fail, pass, repoRoot } from './_setup.mjs';

const ID = 'sk-runtime-crash';

try {
  ensureBuilt();
  const storeUrl = pathToFileURL(join(repoRoot(), 'dist', 'src', 'index.js')).href;
  const dir = mkdtempSync(join(tmpdir(), 'bat-crash-'));
  try {
    const db = join(dir, 'm.sqlite');
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import(${JSON.stringify(storeUrl)}).then(async ({ KeeperStore }) => {
          const s = new KeeperStore(${JSON.stringify(db)});
          for (let i = 0; i < 500; i++) s.save({ kind: 'decision', title: 'crash burst ' + i, body: 'burst body ' + i });
        });`,
      ],
      { stdio: 'ignore' },
    );
    await new Promise((r) => setTimeout(r, 400));
    child.kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 500));

    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(db);
    let integrity;
    try {
      integrity = raw.prepare('PRAGMA integrity_check').get();
    } finally {
      raw.close();
    }
    if (!integrity || integrity.integrity_check !== 'ok') {
      fail(ID, `integrity_check failed after kill: ${JSON.stringify(integrity)}`);
    }
    const { KeeperStore } = await import('../../dist/src/index.js');
    const check = new KeeperStore(db);
    try {
      const all = check.exportAll({ includeSuperseded: true });
      if (all.length > 500) fail(ID, `impossible record count ${all.length}`);
      for (const rec of all) {
        const one = check.get(rec.id);
        if (!one || one.title !== rec.title || one.body !== rec.body) {
          fail(ID, `partial record survived the kill: ${rec.id}`);
        }
      }
    } finally {
      check.close();
    }
    pass(ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (err) {
  fail(ID, err);
}
