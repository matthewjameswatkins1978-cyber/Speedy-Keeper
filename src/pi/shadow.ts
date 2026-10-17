/**
 * Selective pre-task retrieval, B2 research track: SHADOW MODE ONLY.
 * shadowRetrieve() answers "what would the model have seen for this task?"
 * and appends the answer to a disposable JSONL log. It never injects context
 * into a live turn (`wouldInject` is always false); no Pi event handler in
 * this branch performs injection.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeeperStore } from '../store.js';
import { PI_SHADOW_MAX_CHARS, estimateTokens } from './budgets.js';
import { formatSearchResults } from './format.js';

export interface ShadowOptions {
  kind?: 'decision' | 'gotcha' | 'checkpoint';
  task?: string;
  limit?: number;
  maxChars?: number;
  logPath?: string;
}

export interface ShadowResult {
  mode: 'shadow';
  query: string;
  hitIds: string[];
  chars: number;
  estTokens: number;
  /** B2 invariant: shadow retrieval never injects context. */
  wouldInject: boolean;
  at: string;
}

export function shadowRetrieve(store: KeeperStore, query: string, opts: ShadowOptions = {}): ShadowResult {
  const hits = store.search(query, {
    kind: opts.kind,
    taskScope: opts.task,
    limit: opts.limit ?? 5,
    maxChars: opts.maxChars ?? PI_SHADOW_MAX_CHARS,
  });
  const text = formatSearchResults(hits, opts.maxChars ?? PI_SHADOW_MAX_CHARS);
  const result: ShadowResult = {
    mode: 'shadow',
    query,
    hitIds: hits.map((h) => h.id),
    chars: text.length,
    estTokens: estimateTokens(text.length),
    wouldInject: false,
    at: new Date().toISOString(),
  };
  if (opts.logPath !== undefined) appendShadowLog(opts.logPath, result);
  return result;
}

export function appendShadowLog(logPath: string, result: ShadowResult): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(result) + '\n', 'utf8');
}
