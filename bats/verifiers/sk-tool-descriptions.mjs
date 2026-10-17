/**
 * sk-tool-descriptions: the model-facing contracts must state accurate
 * provisional semantics and must not advertise full-record retrieval that
 * the Pi tools cannot provide.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-tool-descriptions';
const FULL_RECORD_CLAIMS = ['full content', 'full record', 'complete record', 'entire record', 'get(id)'];

try {
  ensureBuilt();
  const { createMemoryTools } = await import('../../dist/src/pi/adapter.js');

  const dir = mkdtempSync(join(tmpdir(), 'bat-desc-'));
  try {
    const tools = createMemoryTools({ dbPath: join(dir, 'm.sqlite') });
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    if (!byName.memory_search || !byName.memory_save || !byName.memory_get || tools.length !== 3) {
      fail(ID, `unexpected tool set: ${tools.map((t) => t.name).join(',')}`);
    }
    const saveDesc = byName.memory_save.description;
    if (!saveDesc.includes('always provisional')) fail(ID, 'save description lost provisional accuracy');
    if (saveDesc.includes('unless evidence sources are supplied')) {
      fail(ID, 'save description keeps the false evidenced-by-sources claim');
    }
    for (const tool of tools) {
      for (const claim of FULL_RECORD_CLAIMS) {
        if (tool.description.includes(claim)) {
          fail(ID, `${tool.name} description advertises unavailable retrieval: ${claim}`);
        }
      }
    }
    // The save confirmation itself must not promise full-record retrieval.
    const res = await byName.memory_save.execute(
      'bat',
      { kind: 'decision', title: 'Description probe', body: 'description probe body' },
      undefined,
      undefined,
      { cwd: dir },
    );
    for (const claim of FULL_RECORD_CLAIMS) {
      if (res.content[0].text.includes(claim)) fail(ID, `save confirmation advertises unavailable retrieval: ${claim}`);
    }
    pass(ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (err) {
  fail(ID, err);
}
