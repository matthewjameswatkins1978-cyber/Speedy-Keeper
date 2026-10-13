/**
 * sk-preview-irrelevant-flood: thousands of memories that share NO task
 * terms with the prompt must produce the explicit no-memory outcome and
 * inject nothing (B4 Phase 7 list, item 5 — irrelevant memory forced into
 * the context). One shared generic word must not qualify as relevance.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-preview-irrelevant-flood';

try {
  ensureBuilt();
  const { KeeperStore } = await import('../../dist/src/index.js');
  const { preflightPreview } = await import('../../dist/src/pi/preflight.js');

  const dir = mkdtempSync(join(tmpdir(), 'bat-irrel-'));
  try {
    const db = join(dir, 'm.sqlite');
    const store = new KeeperStore(db);
    try {
      for (let i = 0; i < 2000; i++) {
        store.save({
          kind: i % 2 ? 'decision' : 'gotcha',
          title: `Office note ${i}`,
          body: `Filler ${i}: wallpaper, ficus watering rota, biscuit budget, chair height. (source doc ${i})`,
        });
      }
    } finally {
      store.close();
    }
    const out = preflightPreview(dir, { dbPath: db, prompt: 'How does the billing webhook verify signatures?' });
    if (out.outcome !== 'no-memory') fail(ID, `irrelevant flood must be no-memory, got ${out.outcome} with ${out.hitIds.length} hits`);
    if (out.hitIds.length !== 0) fail(ID, `no-memory must carry zero hits, got ${out.hitIds.length}`);
    if (!out.text || !/no relevant memory for this task\./.test(out.text)) fail(ID, 'explicit no-memory text missing');
    if (out.chars !== (out.text?.length ?? -1)) fail(ID, 'chars must reflect the actual no-memory text');
    pass(ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (err) {
  fail(ID, err);
}
