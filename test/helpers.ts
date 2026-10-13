import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TempDb {
  dir: string;
  db: string;
  cleanup: () => void;
}

export function tempDb(name: string): TempDb {
  const dir = mkdtempSync(join(tmpdir(), `keeper-${name}-`));
  return {
    dir,
    db: join(dir, 'memory.sqlite'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
