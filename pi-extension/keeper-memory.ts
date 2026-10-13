/**
 * Speedy Keeper B2 experiment: isolated Pi adapter.
 *
 * - Registers exactly two tools, `memory_search` and `memory_save`.
 * - Registers NO event handlers, commands, providers, or context injection:
 *   pre-task retrieval research runs in shadow mode only (see src/pi/shadow.ts).
 * - Storage defaults to the project database (git common dir) unless
 *   SPEEDY_KEEPER_DB points at a disposable database (as in all B2 tests).
 * - SPEEDY_KEEPER_DISABLED=1 registers nothing: Pi runs exactly as if the
 *   extension were absent.
 * - NEVER install globally, NEVER merge auto-injection on this branch.
 */
import { createMemoryTools } from '../src/pi/adapter.js';
import type { ExtensionAPI } from './pi-types.js';

export default function (pi: ExtensionAPI): void {
  if (process.env['SPEEDY_KEEPER_DISABLED'] === '1') return;
  const dbPath = process.env['SPEEDY_KEEPER_DB']?.trim() || undefined;
  // B4 condition C/D discovery hint is opt-in via SPEEDY_KEEPER_HINT (trial
  // env only): condition B stays exactly "the two tools, no prompt changes".
  const hint = process.env['SPEEDY_KEEPER_HINT'] === '1';
  for (const tool of createMemoryTools({ dbPath, hint })) {
    pi.registerTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      annotations: tool.annotations,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: tool.promptGuidelines,
      execute: (id, params, signal, onUpdate, ctx) =>
        tool.execute(id, params as never, signal, onUpdate, ctx === undefined ? undefined : { cwd: ctx.cwd }),
    });
  }
}
