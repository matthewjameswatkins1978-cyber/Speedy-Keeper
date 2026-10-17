/** Model-context budgets for the Pi adapter. All enforced before text reaches the model. */

export const PI_TOOL_MAX_CHARS = 4000;
export const PI_SEARCH_MAX_CHARS = 3500;
export const PI_SHADOW_MAX_CHARS = 2000;
/** B4 condition D: bounded pre-task preview injected before a task starts. */
export const PI_PREVIEW_MAX_CHARS = 900;
export const PI_PREVIEW_MAX_HITS = 3;

/** Rough token estimate for reporting (~4 chars per token). */
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function truncateTo(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, Math.max(0, maxChars)) + '…', truncated: true };
}
