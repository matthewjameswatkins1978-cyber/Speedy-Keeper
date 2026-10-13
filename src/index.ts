/** Public surface of the memory core; kept minimal for the future Pi extension. */
export type { ClaimStatus, ExportOptions, MemoryRecord, RecordKind, SaveInput, SearchOptions } from './types.js';
export {
  ConflictError,
  DEFAULT_SEARCH_LIMIT,
  KeeperError,
  KeeperStore,
  MAX_SEARCH_LIMIT,
  NotFoundError,
  ValidationError,
  type StoreOptions,
} from './store.js';
export { KEEPER_DB_NAME, KEEPER_DIR_NAME, gitCommonDir, resolveDbPath, resolveProjectDbPath } from './paths.js';
export { MAX_BODY_CHARS, MAX_TITLE_CHARS, assertNoSecrets, containsSecret } from './secrets.js';
