/** Shared record shapes for the Speedy Keeper memory core. */

export type RecordKind = 'decision' | 'gotcha' | 'checkpoint';

/**
 * Provisional claims are unverified working notes.
 * Evidenced claims carry a source reference backing them.
 * Records are NEVER auto-verified: `evidenced` is only stored when the
 * caller explicitly passes it together with at least one source.
 */
export type ClaimStatus = 'provisional' | 'evidenced';

export interface MemoryRecord {
  id: string;
  kind: RecordKind;
  title: string;
  body: string;
  /** Task scope for checkpoints; null when not task-scoped. */
  taskScope: string | null;
  /** Source references (files, commits, URLs, tool names). Never raw dumps. */
  sources: string[];
  claimStatus: ClaimStatus;
  /** Bumped on every supersede so writers can detect conflicts. */
  revision: number;
  /** Id of the record that replaced this one; null while current. */
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveInput {
  kind: RecordKind;
  title: string;
  body: string;
  taskScope?: string;
  sources?: string[];
  claimStatus?: ClaimStatus;
}

export interface SearchOptions {
  kind?: RecordKind;
  taskScope?: string;
  /** Default 20, capped at 100. */
  limit?: number;
  /** Ordinary search hides superseded records; pass true to include them. */
  includeSuperseded?: boolean;
  /** Preview length per hit in characters. Default 280, clamped to 24..2000. */
  snippetChars?: number;
  /**
   * Total output budget in characters across all returned hits.
   * Hits accumulate until the next one would exceed the budget; the first
   * hit is always returned. Default 12000, clamped to 256..200000.
   */
  maxChars?: number;
}

/**
 * Compact search preview for model context: stable id, relevant metadata
 * and source references, plus a short body excerpt. Never carries the full
 * body — use `get(id)` for complete content.
 */
export interface SearchHit {
  id: string;
  kind: RecordKind;
  title: string;
  snippet: string;
  taskScope: string | null;
  sources: string[];
  claimStatus: ClaimStatus;
  revision: number;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportOptions {
  includeSuperseded?: boolean;
}
