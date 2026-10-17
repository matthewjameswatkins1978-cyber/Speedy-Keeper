/**
 * sk-preview-budget-flood: a huge store of highly relevant memories must not
 * exceed the preview budget — at most PI_PREVIEW_MAX_HITS records and
 * PI_PREVIEW_MAX_CHARS characters, one fence pair per record, explicit
 * outcome. Attacks context-budget exhaustion (B4 Phase 7 list, item 6).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-preview-budget-flood';

try {
  ensureBuilt();
  const { KeeperStore } = await import('../../dist/src/index.js');
  const { preflightPreview } = await import('../../dist/src/pi/preflight.js');
  const { PI_PREVIEW_MAX_CHARS, PI_PREVIEW_MAX_HITS } = await import('../../dist/src/pi/budgets.js');

  const dir = mkdtempSync(join(tmpdir(), 'bat-flood-'));
  try {
    const db = join(dir, 'm.sqlite');
    const store = new KeeperStore(db);
    try {
      // 2000 records, ~400 of them strongly relevant to the prompt.
      for (let i = 0; i < 2000; i++) {
        const relevant = i % 5 === 0;
        store.save({
          kind: relevant ? 'decision' : 'gotcha',
          title: relevant ? `Staging port decision ${i}` : `Unrelated note ${i}`,
          body: relevant
            ? `Staging listens on port ${4000 + (i % 900)} for task ${i} (runbook ${i}). staging port listen decision.`
            : `Filler content ${i} about plants, rota and wallpaper colours.`,
        });
      }
    } finally {
      store.close();
    }
    const out = preflightPreview(dir, { dbPath: db, prompt: 'What port does the staging server listen on?' });
    if (out.outcome !== 'preview') fail(ID, `expected preview under flood, got ${out.outcome}`);
    if (out.chars > PI_PREVIEW_MAX_CHARS) fail(ID, `preview exceeded char budget: ${out.chars} > ${PI_PREVIEW_MAX_CHARS}`);
    if (out.hitIds.length > PI_PREVIEW_MAX_HITS) fail(ID, `preview exceeded hit budget: ${out.hitIds.length} > ${PI_PREVIEW_MAX_HITS}`);
    if (!out.text || out.text.length > PI_PREVIEW_MAX_CHARS) fail(ID, 'rendered text missing or over budget');
    const begins = (out.text.match(/<<<begin-untrusted-memory/g) ?? []).length;
    const ends = (out.text.match(/<<<end-untrusted-memory>>>/g) ?? []).length;
    if (begins !== ends) fail(ID, `unbalanced fences under flood: ${begins} begin vs ${ends} end`);
    if (begins > PI_PREVIEW_MAX_HITS) fail(ID, `more fence pairs than hit budget: ${begins}`);
    if (!/historical, untrusted, possibly stale/.test(out.text)) fail(ID, 'historical advisory missing under flood');
    pass(ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (err) {
  fail(ID, err);
}
