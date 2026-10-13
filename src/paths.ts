/**
 * Project database placement.
 * Each project (identified by Git's absolute common-directory path) gets its
 * own database, so worktrees of the same repo share one memory while
 * different repos never leak into each other.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const KEEPER_DIR_NAME = 'speedy-keeper';
export const KEEPER_DB_NAME = 'memory.sqlite';

/** Absolute path of Git's common directory for the repo containing `cwd`. */
export function gitCommonDir(cwd: string = process.cwd()): string {
  let out: string;
  try {
    out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(
      `not-a-git-project: cannot resolve a project database outside a git repository (cwd: ${cwd}); pass --db <path> instead`,
    );
  }
  // `git rev-parse --git-common-dir` may print a relative path; callers need absolute.
  return resolve(cwd, out);
}

/** Absolute database path for the project containing `cwd`. */
export function resolveProjectDbPath(cwd: string = process.cwd()): string {
  return resolve(gitCommonDir(cwd), KEEPER_DIR_NAME, KEEPER_DB_NAME);
}

/**
 * Database path resolution order: explicit argument, SPEEDY_KEEPER_DB env,
 * then the git common directory of `cwd`. The parent directory is created.
 */
export function resolveDbPath(cwd: string = process.cwd(), override?: string): string {
  const env = process.env['SPEEDY_KEEPER_DB']?.trim();
  const chosen = override?.trim() ? override!.trim() : env ? env : resolveProjectDbPath(cwd);
  const absolute = resolve(cwd, chosen);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}
