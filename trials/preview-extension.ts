/**
 * B4 trial-harness extension: condition D (selective recall) ONLY.
 *
 * This file is loaded by `trials/run.mjs` with `-e` on preview runs and by
 * nothing else. It exists so the pre-task hypothesis can be tested without a
 * production lifecycle hook (packet: "first simulate pre-task retrieval in
 * the disposable trial harness").
 *
 * It is inert unless SPEEDY_KEEPER_PREVIEW=1 (set only on D runs). The
 * preview itself degrades to silence when SPEEDY_KEEPER_DB is unset or does
 * not resolve: resolveDbPath refuses outside a git project, so no production
 * memory can be reached by accident.
 *
 * Injection is a structured system-prompt section (never forceSystemPrompt),
 * strictly budgeted, explicitly labelled historical/untrusted, with an
 * explicit no-relevant-memory outcome. Failure to read memory means silence,
 * never a failed task.
 */
import { appendFileSync } from 'node:fs';
import { preflightPreview, PREVIEW_SECTION_NAME } from '../src/pi/preflight.js';
import type { ExtensionAPI } from '../pi-extension/pi-types.js';

export default function (pi: ExtensionAPI): void {
  if (process.env['SPEEDY_KEEPER_PREVIEW'] !== '1') return;
  const api = pi as ExtensionAPI & {
    on?: (event: 'before_agent_start', handler: (event: PreviewStartEvent) => void) => unknown;
  };
  if (typeof api.on !== 'function') return;
  api.on('before_agent_start', (event) => {
    try {
      const cwd = event.systemPromptOptions?.cwd ?? process.cwd();
      const preview = preflightPreview(cwd, { prompt: event.prompt });
      if (preview.text !== null) {
        event.systemPromptOptions.sections[PREVIEW_SECTION_NAME] = preview.text;
      }
      if (process.env['SPEEDY_KEEPER_PREVIEW_LOG']) {
        // Measurement only: proves what the harness offered the model.
        appendFileSync(process.env['SPEEDY_KEEPER_PREVIEW_LOG'], JSON.stringify(preview) + '\n');
      }
    } catch {
      // A preview must never break the run.
    }
  });
}

interface PreviewStartEvent {
  prompt: string;
  systemPromptOptions: { cwd?: string; sections: Record<string, string> };
}
