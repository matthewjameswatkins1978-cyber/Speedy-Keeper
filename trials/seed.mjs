/**
 * Seed a disposable trial database from trials/tasks.json.
 * Usage: node trials/seed.mjs <dbPath> <taskId>   (imports built core from dist/)
 * Each task carries its own seed set (relevant + distractor memories) so
 * per-task retrieval precision can be graded against an independent truth set.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { KeeperStore } = await import('../dist/src/index.js');

const dbPath = process.argv[2];
const taskId = process.argv[3];
if (!dbPath || !taskId) {
  console.error('usage: node trials/seed.mjs <dbPath> <taskId>');
  process.exit(2);
}
const tasks = JSON.parse(readFileSync(join(root, 'trials', 'tasks.json'), 'utf8'));
const task = tasks.tasks.find((t) => t.id === taskId);
if (!task) {
  console.error(`unknown task: ${taskId}`);
  process.exit(2);
}
const store = new KeeperStore(dbPath);
try {
  const ids = task.seed.map((m) => store.save(m).id);
  console.log(JSON.stringify({ ok: true, count: ids.length, db: dbPath, taskId }));
} finally {
  store.close();
}
