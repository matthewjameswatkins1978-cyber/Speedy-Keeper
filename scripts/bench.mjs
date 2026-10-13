/**
 * bench: seed a temp database and report cold search latency.
 * Usage: node scripts/bench.mjs [count]
 * Prints JSON to stdout.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeeperStore } from '../dist/src/index.js';

const count = Number(process.argv[2] ?? 500);
const dir = mkdtempSync(join(tmpdir(), 'keeper-bench-'));
const store = new KeeperStore(join(dir, 'bench.sqlite'));
const kinds = ['decision', 'gotcha', 'checkpoint'];
for (let i = 0; i < count; i++) {
  store.save({
    kind: kinds[i % 3],
    title: `bench record ${i} about wal indexing latency`,
    body: `body ${i} with distinctive token benchword${i % 50} and filler text for fts ranking`,
    taskScope: `task-${i % 7}`,
  });
}
// Warm up once (page cache, prepared statements).
store.search('benchword7');

const runs = 25;
const times = [];
for (let r = 0; r < runs; r++) {
  const q = `benchword${r % 50}`;
  const t0 = performance.now();
  const hits = store.search(q, { limit: 20 });
  times.push({ ms: performance.now() - t0, hits: hits.length });
}
times.sort((a, b) => a.ms - b.ms);
const ms = times.map((t) => t.ms);
const pick = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
console.log(
  JSON.stringify({
    records: count,
    runs,
    minMs: round(ms[0]),
    p50Ms: round(pick(0.5)),
    p95Ms: round(pick(0.95)),
    maxMs: round(ms[ms.length - 1]),
  }),
);
function round(n) {
  return Math.round(n * 100) / 100;
}
store.close();
rmSync(dir, { recursive: true, force: true });
