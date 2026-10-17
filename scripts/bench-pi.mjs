/**
 * bench-pi: latency + token-overhead measurements for the B2 adapter.
 * Disposable temp database only. Usage: node scripts/bench-pi.mjs [count]
 * Prints JSON to stdout.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeeperStore } from '../dist/src/index.js';
import { createMemoryTools } from '../dist/src/pi/adapter.js';

const count = Number(process.argv[2] ?? 200);
const dir = mkdtempSync(join(tmpdir(), 'keeper-bench-pi-'));
const db = join(dir, 'bench.sqlite');
const seed = new KeeperStore(db);
const kinds = ['decision', 'gotcha', 'checkpoint'];
for (let i = 0; i < count; i++) {
  seed.save({
    kind: kinds[i % 3],
    title: `bench memory ${i} about wal indexing latency`,
    body: `body ${i} with benchword${i % 25} and realistic filler text for preview budgets`,
    sources: [`src/file${i % 9}.ts`],
  });
}
seed.close();

const [search, save] = createMemoryTools({ dbPath: db });
const ctx = { cwd: dir };
async function timed(fn, runs = 20) {
  await fn();
  const ms = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    ms.push(performance.now() - t0);
  }
  ms.sort((a, b) => a - b);
  const pick = (p) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  return { p50Ms: round(pick(0.5)), p95Ms: round(pick(0.95)) };
}
const round = (n) => Math.round(n * 100) / 100;

const searchRes = await search.execute('b', { query: 'benchword3 wal' }, undefined, undefined, ctx);
const searchText = searchRes.content[0].text;
const searchLat = await timed(() => search.execute('b', { query: 'benchword3 wal' }, undefined, undefined, ctx));
const saveLat = await timed(() =>
  save.execute('b', { kind: 'gotcha', title: 'bench save', body: 'bench save body' }, undefined, undefined, ctx),
);
const [disSearch] = createMemoryTools({ dbPath: db, disabled: true });
const t0 = performance.now();
await disSearch.execute('b', { query: 'x' }, undefined, undefined, ctx);
const disabledMs = round(performance.now() - t0);
const [badSearch] = createMemoryTools({ dbPath: dir });
const t1 = performance.now();
const badRes = await badSearch.execute('b', { query: 'x' }, undefined, undefined, ctx);
const unavailableMs = round(performance.now() - t1);

console.log(
  JSON.stringify({
    records: count,
    search: { ...searchLat, chars: searchText.length, estTokens: Math.ceil(searchText.length / 4) },
    save: saveLat,
    disabledMs,
    unavailableMs,
    unavailableCode: badRes.details.code,
  }),
);
rmSync(dir, { recursive: true, force: true });
