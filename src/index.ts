/** Public surface of the memory core; kept minimal for the future Pi extension. */
export type { ClaimStatus, ExportOptions, MemoryRecord, RecordKind, SaveInput, SearchHit, SearchOptions } from './types.js';
export {
  BudgetError,
  ConflictError,
  DEFAULT_MAX_CHARS,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SNIPPET_CHARS,
  KeeperError,
  KeeperStore,
  isRecoverableFtsError,
  MAX_MAX_CHARS,
  MAX_SEARCH_LIMIT,
  MAX_SNIPPET_CHARS,
  NotFoundError,
  ValidationError,
  type StoreOptions,
} from './store.js';
export { KEEPER_DB_NAME, KEEPER_DIR_NAME, gitCommonDir, resolveDbPath, resolveProjectDbPath } from './paths.js';
export { MAX_BODY_CHARS, MAX_TITLE_CHARS, assertNoSecrets, containsSecret } from './secrets.js';
