/**
 * sk-preview-storage-failure: missing, corrupt or disabled storage must
 * degrade to silence — never a throw, never a partial/half-rendered preview,
 * never an error page in the prompt (B4 Phase 7 list, items 7/8: missing or
 * corrupt storage, extension disablement).
 */
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass } from './_setup.mjs';

const ID = 'sk-preview-storage-failure';

try {
  ensureBuilt();
  const { preflightPreview } = await import('../../dist/src/pi/preflight.js');
  const { PREVIEW_SECTION_NAME } = await import('../../dist/src/pi/preflight.js');
  const previewExtension = (await import('../../dist/trials/preview-extension.js')).default;

  const dir = mkdtempSync(join(tmpdir(), 'bat-storage-'));
  try {
    // 1. Missing directory: outcome unavailable/disabled, text null (silence).
    const missing = preflightPreview(join(dir, 'does-not-exist'), {});
    if (!['unavailable', 'disabled'].includes(missing.outcome)) fail(ID, `missing dir outcome ${missing.outcome}`);
    if (missing.text !== null) fail(ID, 'missing dir must be silent, not partial text');

    // 2. Corrupt database: same silence, and it must not throw.
    const corruptDb = join(dir, 'corrupt.sqlite');
    writeFileSync(corruptDb, 'this is definitely not a sqlite database');
    let corrupt;
    try {
      corrupt = preflightPreview(dir, { dbPath: corruptDb, prompt: 'port staging listen' });
    } catch (err) {
      fail(ID, `corrupt db threw: ${err instanceof Error ? err.message : err}`);
    }
    if (corrupt.outcome === 'preview') fail(ID, 'corrupt db must never yield a preview');
    if (corrupt.text !== null) fail(ID, 'corrupt db must be silent');

    // 3. SPEEDY_KEEPER_DISABLED wins even with a healthy db present.
    const saved = process.env['SPEEDY_KEEPER_DISABLED'];
    process.env['SPEEDY_KEEPER_DISABLED'] = '1';
    try {
      const off = preflightPreview(dir, { dbPath: corruptDb, prompt: 'port staging listen' });
      if (off.outcome !== 'disabled' || off.text !== null) fail(ID, 'disabled must be silence');
    } finally {
      if (saved === undefined) delete process.env['SPEEDY_KEEPER_DISABLED'];
      else process.env['SPEEDY_KEEPER_DISABLED'] = saved;
    }

    // 4. Through the extension with preview opted in but storage unreachable
    //    (temp dir is not a git project): section must stay absent — no
    //    half-injected prompt fragment — and no exception may escape.
    const savedPreview = process.env['SPEEDY_KEEPER_PREVIEW'];
    const savedDb = process.env['SPEEDY_KEEPER_DB'];
    process.env['SPEEDY_KEEPER_PREVIEW'] = '1';
    process.env['SPEEDY_KEEPER_DB'] = corruptDb;
    let sectionSeen = 'unset';
    try {
      previewExtension({
        registerTool: () => fail(ID, 'preview extension must register no tools'),
        on: (_name, handler) => {
          const event = {
            prompt: 'port staging listen',
            systemPromptOptions: { cwd: dir, sections: {} },
          };
          handler(event);
          sectionSeen = PREVIEW_SECTION_NAME in event.systemPromptOptions.sections ? 'present' : 'absent';
        },
      } );
    } catch (err) {
      fail(ID, `extension threw with corrupt storage: ${err instanceof Error ? err.message : err}`);
    } finally {
      if (savedPreview === undefined) delete process.env['SPEEDY_KEEPER_PREVIEW'];
      else process.env['SPEEDY_KEEPER_PREVIEW'] = savedPreview;
      if (savedDb === undefined) delete process.env['SPEEDY_KEEPER_DB'];
      else process.env['SPEEDY_KEEPER_DB'] = savedDb;
    }
    if (sectionSeen === 'unset') fail(ID, 'handler never subscribed/run — test would be vacuous');
    if (sectionSeen !== 'absent') fail(ID, 'unreachable storage must leave the prompt section absent (pure silence)');
    pass(ID);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} catch (err) {
  fail(ID, err);
}
