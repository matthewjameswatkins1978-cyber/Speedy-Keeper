/**
 * sk-runtime-deps: missing, locked and corrupted databases degrade to
 * structured envelopes fast — never hangs, never raw throws, never damage.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-runtime-deps';

try {
  ensureBuilt();
  const { DatabaseSync } = await import('node:sqlite');
  const { KeeperStore } = await import('../../dist/src/index.js');
  const { createMemoryTools } = await import('../../dist/src/pi/adapter.js');

  const dir = mkdtempSync(join(tmpdir(), 'bat-runtime-'));
  try {
    const good = join(dir, 'good.sqlite');
    const seed = new KeeperStore(good);
    try {
      seed.save({ kind: 'decision', title: 'Resilient record', body: 'runtime carrier' });
    } finally {
      seed.close();
    }

    // 1. Missing: a file where a directory must be.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const [missing] = createMemoryTools({ dbPath: join(blocker, 'm.sqlite') });
    const m = await missing.execute('bat', { query: 'x' }, undefined, undefined, { cwd: dir });
    if (m.details.ok !== false || m.details.code !== 'memory-unavailable') {
      fail(ID, `missing db misreported: ${JSON.stringify(m.details).slice(0, 160)}`);
    }

    // 2. Locked: hold a write lock. Reads still serve (WAL readers are never
    // blocked); a contending write must answer fast with memory-busy.
    const raw = new DatabaseSync(good);
    raw.exec('BEGIN IMMEDIATE');
    try {
      const [lockedSearch, lockedSave] = createMemoryTools({ dbPath: good, busyTimeoutMs: 100 });
      const r = await lockedSearch.execute('bat', { query: 'runtime' }, undefined, undefined, { cwd: dir });
      if (r.details.ok !== true || r.details.hits.length !== 1) {
        fail(ID, `reads blocked by a write lock: ${JSON.stringify(r.details).slice(0, 160)}`);
      }
      const t0 = Date.now();
      let w;
      try {
        w = await lockedSave.execute(
          'bat',
          { kind: 'decision', title: 'Contended write', body: 'must not hang' },
          undefined,
          undefined,
          { cwd: dir },
        );
      } catch (err) {
        fail(ID, `contended write threw raw instead of memory-busy envelope: ${err.message}`);
      }
      const dt = Date.now() - t0;
      if (w.details.ok !== false || w.details.code !== 'memory-busy') {
        fail(ID, `locked db misreported: ${JSON.stringify(w.details).slice(0, 200)}`);
      }
      if (dt > 5000) fail(ID, `locked db took ${dt}ms: bounded contention violated`);
    } finally {
      raw.exec('ROLLBACK');
      raw.close();
    }

    // 3. Corrupt: garbage bytes are unavailable, loudly.
    const garbage = join(dir, 'garbage.sqlite');
    writeFileSync(garbage, Buffer.from([0, 1, 2, 3, 255, 254, 253, 0, 9, 9, 9]));
    const [corrupt] = createMemoryTools({ dbPath: garbage });
    const c = await corrupt.execute('bat', { query: 'x' }, undefined, undefined, { cwd: dir });
    if (c.details.ok !== false || c.details.code !== 'memory-unavailable') {
      fail(ID, `corrupt db misreported: ${JSON.stringify(c.details).slice(0, 160)}`);
    }

    // 4. The good database is untouched by all three attacks.
    const check = new KeeperStore(good);
    try {
      const rows = check.exportAll();
      if (rows.length !== 1 || rows[0].body !== 'runtime carrier') fail(ID, 'good database damaged by attacks');
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
