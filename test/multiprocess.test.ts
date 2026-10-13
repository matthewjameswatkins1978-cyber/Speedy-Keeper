/**
 * Multi-process regression: independent Node processes writing to the same
 * SQLite database lose no committed records, and a blocked writer fails
 * with a recognisable busy error instead of corrupting anything.
 */
import { strict as assert } from 'node:assert';
import { execFile, execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { KeeperStore } from '../src/store.js';
import { tempDb } from './helpers.js';

const CHILD_CODE = `
import(STORE_URL).then(async ({ KeeperStore }) => {
  const [dbPath, worker, count] = process.argv.slice(1);
  const store = new KeeperStore(dbPath, { busyTimeoutMs: Number(process.env.KEEPER_BUSY_MS ?? 5000) });
  try {
    let n = 0;
    for (let i = 0; i < Number(count); i++) {
      store.save({ kind: 'decision', title: 'mp-' + worker + '-' + i + ' multiprocess', body: 'worker ' + worker + ' record ' + i });
      n++;
    }
    console.log(JSON.stringify({ ok: true, count: n }));
  } finally {
    store.close();
  }
}).catch((err) => { console.error('child-failed: ' + ((err && err.message) || err)); process.exit(1); });
`;

function runChild(code: string, db: string, worker: string, count: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ ok: boolean; count: number }>((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', code, db, worker, count],
      { env: { ...process.env, ...extraEnv }, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`child ${worker} failed: ${String(stderr || err.message).slice(0, 300)}`));
          return;
        }
        resolve(JSON.parse(String(stdout)));
      },
    );
  });
}

test('independent processes share one database without losing records', async () => {
  const t = tempDb('multiprocess');
  // Children import the compiled store, so `npm test` (which builds first) is required.
  const storeUrl = JSON.stringify(new URL('../src/store.js', import.meta.url).href);
  const code = CHILD_CODE.replace('STORE_URL', storeUrl);
  const store = new KeeperStore(t.db);
  try {
    const results = await Promise.all([0, 1, 2, 3].map((w) => runChild(code, t.db, String(w), '10')));
    assert.equal(
      results.reduce((n, r) => n + r.count, 0),
      40,
      'every child must report all its writes committed',
    );
    const all = store.exportAll();
    assert.equal(all.length, 40, 'no committed record may go missing');
    assert.equal(new Set(all.map((r) => r.id)).size, 40, 'ids must be unique across processes');
    assert.equal(store.search('multiprocess', { limit: 100, maxChars: 200000 }).length, 40);

    // Busy handling: a writer with a tiny timeout fails recognisably while a
    // write lock is held, and writes nothing.
    let busySeen = false;
    store.transaction(() => {
      try {
        execFileSync(
          process.execPath,
          ['--input-type=module', '-e', code, t.db, 'blocked', '1'],
          { env: { ...process.env, KEEPER_BUSY_MS: '50' }, timeout: 60000, stdio: 'pipe' },
        );
      } catch (err) {
        const out = String((err as { stderr?: unknown }).stderr ?? '') + String((err as Error).message ?? '');
        busySeen = /busy|locked/i.test(out);
      }
    });
    assert.equal(busySeen, true, 'blocked writer must surface a busy/locked error');
    assert.equal(store.exportAll().length, 40, 'failed writer must leave the database unchanged');
  } finally {
    store.close();
    t.cleanup();
  }
});
