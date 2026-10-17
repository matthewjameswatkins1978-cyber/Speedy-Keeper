/**
 * Shared Pi event shape for the B4 disposable preview extension. Type-only:
 * erased at runtime, so Pi's jiti never resolves it.
 */
export interface PreviewStartEvent {
  prompt: string;
  systemPromptOptions: { cwd?: string; sections: Record<string, string> };
}
