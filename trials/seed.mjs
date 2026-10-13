/**
 * Seed a disposable trial database from trials/tasks.json.
 * Usage: node trials/seed.mjs <dbPath>   (imports built core from dist/)
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { KeeperStore } = await import('../dist/src/index.js');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('usage: node trials/seed.mjs <dbPath>');
  process.exit(2);
}
const tasks = JSON.parse(readFileSync(join(root, 'trials', 'tasks.json'), 'utf8'));
const store = new KeeperStore(dbPath);
try {
  const ids = tasks.seedMemories.map((m) => store.save(m).id);
  console.log(JSON.stringify({ ok: true, count: ids.length, db: dbPath }));
} finally {
  store.close();
}
