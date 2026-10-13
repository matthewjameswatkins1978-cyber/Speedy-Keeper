/**
 * Minimal local shape of the Pi 1.1.0 extension API surface this experiment
 * uses (verified against the installed Pi docs and the real `pi --extension`
 * load probe). Type-only: erased at runtime, so Pi's jiti never resolves it.
 * Only `registerTool` is used — the experiment registers no event handlers,
 * commands, providers, or context injections.
 */
import type { TSchema } from 'typebox';

export interface PiToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface PiToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details?: unknown;
}

export interface PiToolContext {
  cwd: string;
}

export interface PiToolDefinition {
  name: string;
  description: string;
  parameters: TSchema;
  annotations?: PiToolAnnotations;
  /** One line in the default system prompt's "Available tools" section; Pi omits custom tools from that section without it. */
  promptSnippet?: string;
  /** Guideline bullets appended while this tool is active. */
  promptGuidelines?: string[];
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: PiToolContext,
  ) => Promise<PiToolResult>;
}

export interface ExtensionAPI {
  registerTool(tool: PiToolDefinition): unknown;
}
