/**
 * sk-budget-tiny: budgets below the minimum useful preview must raise a
 * clear budget error (returned, not thrown) while the record stays intact.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-budget-tiny';

try {
  ensureBuilt();
  const { KeeperStore } = await import('../../dist/src/index.js');
  const { createMemoryTools } = await import('../../dist/src/pi/adapter.js');

  const dir = mkdtempSync(join(tmpdir(), 'bat-tiny-'));
  try {
    const seed = new KeeperStore(join(dir, 'm.sqlite'));
    let id = '';
    try {
      id = seed.save({ kind: 'decision', title: 'Tiny', body: 'tiny body words' }).id;
    } finally {
      seed.close();
    }
    const [tiny] = createMemoryTools({ dbPath: join(dir, 'm.sqlite'), searchMaxChars: 100 });
    let res;
    try {
      res = await tiny.execute('bat', { query: 'tiny' }, undefined, undefined, { cwd: dir });
    } catch (err) {
      fail(ID, `budget failure threw instead of returning an envelope: ${err.message}`);
    }
    if (res.details.ok !== false || res.details.code !== 'budget-exceeded') {
      fail(ID, `expected budget-exceeded envelope, got: ${JSON.stringify(res.details).slice(0, 160)}`);
    }
    if (!res.content[0].text.includes('Memory unavailable (budget-exceeded)')) {
      fail(ID, 'budget failure text lost its structured shape');
    }
    const check = new KeeperStore(join(dir, 'm.sqlite'));
    try {
      if (check.get(id).body !== 'tiny body words') fail(ID, 'record damaged by failed budgeted search');
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
