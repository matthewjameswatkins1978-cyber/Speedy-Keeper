/**
 * sk-budget-maxfields: maximum-length titles/bodies/source arrays must still
 * produce model-visible output within budget, with every fence opened also
 * closed (never truncated mid-block). Budget failures must differ from empty.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-budget-maxfields';

try {
  ensureBuilt();
  const { KeeperStore } = await import('../../dist/src/index.js');
  const { createMemoryTools } = await import('../../dist/src/pi/adapter.js');

  const dir = mkdtempSync(join(tmpdir(), 'bat-budget-'));
  try {
    const seed = new KeeperStore(join(dir, 'm.sqlite'));
    try {
      // One maximal record plus small ones sharing a query term: whatever
      // rank order results, a blind character cut must land mid-block.
      seed.save({
        kind: 'decision',
        title: 'maximal sharedbit ' + 'T'.repeat(280),
        body: 'maximal sharedbit body ' + 'B'.repeat(7900),
        sources: Array.from({ length: 50 }, (_, s) => `src-${s} ` + 'S'.repeat(480)),
      });
      for (let i = 0; i < 3; i++) {
        seed.save({ kind: 'gotcha', title: `small sharedbit ${i}`, body: `small sharedbit body ${i}` });
      }
    } finally {
      seed.close();
    }
    // Wide store budget so the formatter backstop (4000) does the cutting.
    const [search] = createMemoryTools({ dbPath: join(dir, 'm.sqlite'), searchMaxChars: 20000 });
    const res = await search.execute('bat', { query: 'sharedbit' }, undefined, undefined, { cwd: dir });
    const text = res.content[0].text;
    if (text.length > 4000) fail(ID, `model-visible output ${text.length} chars exceeds 4000 budget`);
    const openers = (text.match(/<<<begin-untrusted-memory id="/g) ?? []).length;
    const closers = (text.match(/<<<end-untrusted-memory>>>/g) ?? []).length;
    if (openers === 0) fail(ID, 'no fenced block survived budgeting');
    if (openers !== closers) fail(ID, `truncated mid-block: ${openers} openers vs ${closers} closers`);
    // Budget failure must not look like an empty result.
    const [tiny] = createMemoryTools({ dbPath: join(dir, 'm.sqlite'), searchMaxChars: 120 });
    const bad = await tiny.execute('bat', { query: 'sharedbit' }, undefined, undefined, { cwd: dir });
    if (bad.details.ok !== false || bad.details.code !== 'budget-exceeded') {
      fail(ID, `tiny budget did not produce budget-exceeded envelope: ${JSON.stringify(bad.details).slice(0, 160)}`);
    }
    const empty = await search.execute('bat', { query: 'no such words anywhere' }, undefined, undefined, { cwd: dir });
    if (!empty.content[0].text.includes('matches: 0')) fail(ID, 'empty result lost its matches: 0 shape');
    if (bad.content[0].text === empty.content[0].text) fail(ID, 'budget failure indistinguishable from empty result');
    pass(ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (err) {
  fail(ID, err);
}
