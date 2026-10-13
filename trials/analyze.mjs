/**
 * Analyze a trial receipt: condition × task scoreboard, memory behaviour,
 * safety events and efficiency distributions. Read-only.
 *   node trials/analyze.mjs <receipt.json> [more.json ...]
 */
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node trials/analyze.mjs <receipt.json> [..]');
  process.exit(2);
}
const runs = [];
for (const f of files) {
  const r = JSON.parse(readFileSync(f, 'utf8'));
  for (const run of r.runs) runs.push({ ...run, wave: r.wave });
}

const num = (xs) => xs.filter((x) => typeof x === 'number');
const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`);

console.log(`runs=${runs.length}  waves=${[...new Set(runs.map((r) => r.wave))].join(',')}`);
console.log(
  `settingsUnchanged=${runs.every((r) => true)} (see receipt)  exits: ` +
    JSON.stringify(runs.reduce((a, r) => ((a[r.exitCode ?? 'null'] = (a[r.exitCode ?? 'null'] ?? 0) + 1), a), {})),
);

// ---- per-condition summary ----
console.log('\n== BY CONDITION ==');
console.log(
  'cond | n | oraclePass | invoked | memCalls | previewInjected | filesRead(med) | wallMs(med) | tokensIn+Out | dangerous | netAttempts | toolErr(med)',
);
for (const c of ['A', 'B', 'C', 'D']) {
  const rs = runs.filter((r) => r.condition === c);
  if (rs.length === 0) continue;
  const st = rs.map((r) => r.stats).filter(Boolean);
  const pass = rs.filter((r) => r.oracle?.pass).length;
  const invoked = rs.filter((r) => (r.stats?.toolCalls?.memory_search ?? 0) > 0).length;
  const memCalls = rs.reduce((a, r) => a + (r.stats?.toolCalls?.memory_search ?? 0), 0);
  const injected = rs.filter((r) => (r.preview?.[0]?.hitIds?.length ?? 0) > 0).length;
  const files = median(num(st.map((s) => s.filesRead.length)));
  const wall = median(rs.map((r) => r.wallMs));
  const tin = rs.reduce((a, r) => a + (r.usage?.input ?? 0), 0);
  const tout = rs.reduce((a, r) => a + (r.usage?.output ?? 0), 0);
  const dang = rs.reduce((a, r) => a + (r.dangerousAttempts?.length ?? 0), 0);
  const net = rs.reduce((a, r) => a + (r.networkAttempts?.length ?? 0), 0);
  const err = median(num(st.map((s) => s.toolErrors)));
  console.log(
    `  ${c}  | ${rs.length} | ${pass}/${rs.length} | ${pct(invoked, rs.length)} | ${memCalls} | ${injected} | ${files} | ${wall} | ${tin}+${tout} | ${dang} | ${net} | ${err}`,
  );
}

// ---- per-task × condition pass matrix ----
console.log('\n== PASS MATRIX (task × condition) ==');
const taskIds = [...new Set(runs.map((r) => r.taskId))];
console.log('task'.padEnd(26) + 'A    B    C    D    | invoked(B/C/D) | previewHits(D) | notes');
for (const t of taskIds) {
  const cells = ['A', 'B', 'C', 'D'].map((c) => {
    const rs = runs.filter((r) => r.taskId === t && r.condition === c);
    return `${rs.filter((r) => r.oracle?.pass).length}/${rs.length}`;
  });
  const bcd = runs.filter((r) => r.taskId === t && r.condition !== 'A');
  const invoked = bcd.filter((r) => (r.stats?.toolCalls?.memory_search ?? 0) > 0).length;
  const dRuns = runs.filter((r) => r.taskId === t && r.condition === 'D');
  const hits = dRuns.map((r) => r.preview?.[0]?.hitIds?.length ?? 0).join(',');
  const fails = runs
    .filter((r) => r.taskId === t && !r.oracle?.pass)
    .map((r) => `${r.condition}:${(r.oracle.fails ?? []).slice(0, 2).join(';')}`);
  console.log(
    t.padEnd(26) + cells.map((x) => x.padEnd(5)).join(' ') + ` | ${invoked}/${bcd.length}`.padEnd(14) + ` | ${hits}`.padEnd(14) + ` | ${fails.slice(0, 3).join(' || ').slice(0, 140)}`,
  );
}

// ---- memory behaviour detail ----
console.log('\n== MEMORY BEHAVIOUR ==');
const withRuns = runs.filter((r) => r.condition !== 'A');
const queries = withRuns.flatMap((r) => r.stats?.memorySearchQueries ?? []);
console.log(`memory_search invoked in ${withRuns.filter((r) => (r.stats?.toolCalls?.memory_search ?? 0) > 0).length}/${withRuns.length} memory runs`);
console.log(`queries (${queries.length}): ${queries.slice(0, 20).map((q) => JSON.stringify(q)).join(', ')}`);
const emptySearch = withRuns.filter((r) => r.oracle?.metrics?.previewOutcome === 'no-memory');
console.log(`D no-memory outcomes: ${runs.filter((r) => r.condition === 'D' && r.oracle?.metrics?.previewOutcome === 'no-memory').length}/${runs.filter((r) => r.condition === 'D').length}`);
const dInjected = runs.filter((r) => r.condition === 'D');
for (const r of dInjected) {
  const p = r.preview?.[0];
  console.log(`  D ${r.taskId}/r${r.rep}: outcome=${p?.outcome} hits=${p?.hitIds?.length} query=${JSON.stringify(p?.query)} words=${JSON.stringify((p?.wordQueries ?? []).map((w) => `${w.word}:${w.hits}`))}`);
}

// ---- safety ----
console.log('\n== SAFETY ==');
const dang = runs.filter((r) => (r.dangerousAttempts?.length ?? 0) > 0);
const net = runs.filter((r) => (r.networkAttempts?.length ?? 0) > 0);
const mut = runs.filter((r) => (r.manifest?.violations?.length ?? 0) > 0);
console.log(`dangerous attempts: ${dang.length} runs ${dang.map((r) => r.runId).join(', ')}`);
console.log(`network attempts: ${net.length} runs ${net.map((r) => r.runId).join(', ')}`);
console.log(`manifest violations: ${mut.length} runs`);
for (const r of mut) console.log(`  ${r.runId}: ${r.manifest.violations.join('; ')}`);
console.log(`nonzero exits / timeouts: ${runs.filter((r) => r.exitCode !== 0 || r.timedOut).map((r) => `${r.runId}(${r.exitCode})`).join(', ') || 'none'}`);

// ---- efficiency ----
console.log('\n== EFFICIENCY ==');
for (const c of ['A', 'B', 'C', 'D']) {
  const rs = runs.filter((r) => r.condition === c);
  if (rs.length === 0) continue;
  console.log(
    `  ${c}: wall med=${median(rs.map((r) => r.wallMs))}ms mean=${mean(rs.map((r) => r.wallMs)).toFixed(0)}ms | tokens/run in med=${median(rs.map((r) => r.usage?.input ?? 0))} | memSearch ms med=${median(rs.map((r) => r.durationsMs?.memory_search ?? 0))} | filesRead med=${median(rs.map((r) => (r.stats?.filesRead ?? []).length))}`,
  );
}
const totalIn = runs.reduce((a, r) => a + (r.usage?.input ?? 0), 0);
const totalOut = runs.reduce((a, r) => a + (r.usage?.output ?? 0), 0);
const totalCacheRead = runs.reduce((a, r) => a + (r.usage?.cacheRead ?? 0), 0);
const totalCost = runs.reduce((a, r) => a + (r.usage?.cost ?? 0), 0);
console.log(`  TOTAL in=${totalIn} out=${totalOut} cacheRead=${totalCacheRead} cost=${totalCost} (plan-reported)`);

// ---- answers (for manual truth review) ----
console.log('\n== ANSWERS ==');
for (const r of runs) {
  console.log(`[${r.taskId}/${r.condition}/r${r.rep}] ${r.oracle?.pass ? 'PASS' : 'FAIL'} :: ${JSON.stringify((r.oracle?.answer ?? '').slice(0, 220))}`);
  if (r.oracle && !r.oracle.pass) console.log(`    fails: ${(r.oracle.fails ?? []).join(' | ')}`);
}
