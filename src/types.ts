/** Shared record shapes for the Speedy Keeper memory core. */

export type RecordKind = 'decision' | 'gotcha' | 'checkpoint' | 'baseline' | 'ask' | 'brief';

/**
 * Provisional claims are unverified working notes.
 * Evidenced claims carry a source reference backing them.
 * Records are NEVER auto-verified: `evidenced` is only stored when the
 * caller explicitly passes it together with at least one source.
 */
export type ClaimStatus = 'provisional' | 'evidenced';

/**
 * Evidence grade, enforced at write time (v2). INFERRED is the default and
 * maps to provisional; SOURCE-READ and TESTED map to evidenced and require
 * at least one source. TESTED additionally requires evidence.run +
 * evidence.exit so a grade can never be claimed without the run behind it.
 */
export type EvidenceGrade = 'INFERRED' | 'SOURCE-READ' | 'TESTED';

export interface GradeEvidence {
  /** Exact command that was run, e.g. 'python -m unittest tests.test_x -q'. */
  run: string;
  /** Process exit code of that run. */
  exit: number;
}

export type LinkRel = 'supersedes' | 'falsifies' | 'refines' | 'answers';

export interface RecordLink {
  rel: LinkRel;
  id: string;
}

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
  /** v2 evidence grade; claimStatus is derived from it (see store). */
  grade: EvidenceGrade;
  /** v2 run evidence; required when grade is TESTED. */
  evidence: GradeEvidence | null;
  /** v2 dependency SHAs/paths; staleness is computed from these, never stored. */
  dependsOn: string[];
  /** v2 explicit links to other records (falsifies, refines, answers ...). */
  links: RecordLink[];
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
  /** v2 grade; default INFERRED. TESTED/SOURCE-READ imply evidenced. */
  grade?: EvidenceGrade;
  /** v2 run evidence; mandatory for grade TESTED. */
  evidence?: GradeEvidence;
  /** v2 dependency SHAs/paths used for computed staleness. */
  dependsOn?: string[];
  /** v2 explicit links to other records. */
  links?: RecordLink[];
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
  grade: EvidenceGrade;
  revision: number;
  supersededBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportOptions {
  includeSuperseded?: boolean;
}
