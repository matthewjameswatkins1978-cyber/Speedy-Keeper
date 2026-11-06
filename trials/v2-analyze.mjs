/**
 * v2 trial analysis: per-condition oracle pass, memory-value relay,
 * voluntary invocation, abstention, cost. Reads v2 receipt dirs
 * (trials/receipts/v2-*) produced by trials/v2-run.mjs. No live calls.
 *
 * Usage: node trials/v2-analyze.mjs [receipts-dir-glob...]
 *   default: all trials/receipts/v2-* dirs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadReceipts(dirs) {
  const runs = [];
  for (const dir of dirs) {
    const p = join(dir, 'receipt.json');
    if (!existsSync(p)) continue;
    const r = JSON.parse(readFileSync(p, 'utf8'));
    for (const run of r.runs ?? []) runs.push({ ...run, wave: r.wave, model: r.model });
  }
  return runs;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function analyze(runs) {
  const byCond = {};
  for (const run of runs) {
    const c = run.condition;
    byCond[c] = byCond[c] ?? { runs: [] };
    byCond[c].runs.push(run);
  }
  const out = {};
  for (const [cond, { runs: rs }] of Object.entries(byCond)) {
    const passed = rs.filter((r) => r.oracle?.pass === true);
    const invoked = rs.filter((r) => {
      const tc = r.toolCalls ?? {};
      return (tc['memory_preview'] ?? 0) + (tc['memory_search'] ?? 0) > 0;
    });
    const previewInvoked = rs.filter((r) => (r.toolCalls?.['memory_preview'] ?? 0) > 0);
    const searchInvoked = rs.filter((r) => (r.toolCalls?.['memory_search'] ?? 0) > 0);
    const relayTasks = ['K1-decision-recall', 'K2-technical-rationale', 'K4-location-pipeline', 'K5-stale-port', 'K8-conflicting-ratelimit'];
    const relayRuns = rs.filter((r) => relayTasks.includes(r.taskId));
    const relayPassed = relayRuns.filter((r) => r.oracle?.pass === true);
    const k7 = rs.filter((r) => r.taskId === 'K7-irrelevant-notes');
    out[cond] = {
      runs: rs.length,
      pass: `${passed.length}/${rs.length}`,
      passRate: rs.length === 0 ? null : passed.length / rs.length,
      memoryInvoked: `${invoked.length}/${rs.length}`,
      previewToolInvoked: `${previewInvoked.length}/${rs.length}`,
      searchToolInvoked: `${searchInvoked.length}/${rs.length}`,
      relay: `${relayPassed.length}/${relayRuns.length}`,
      k7pass: `${k7.filter((r) => r.oracle?.pass === true).length}/${k7.length}`,
      medianWallMs: median(rs.map((r) => r.wallMs ?? 0)),
      medianTokens: median(rs.map((r) => r.tokens ?? 0)),
      totalCost: rs.reduce((n, r) => n + (r.usage?.cost ?? 0), 0),
    };
  }
  return out;
}

function report(analysis) {
  const lines = ['# v2 trial report', ''];
  const conds = Object.keys(analysis).sort();
  lines.push('| condition | runs | pass | invoked | preview-tool | search-tool | relay | K7 | wallMs p50 | tokens p50 |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of conds) {
    const a = analysis[c];
    lines.push(
      `| ${c} | ${a.runs} | ${a.pass} | ${a.memoryInvoked} | ${a.previewToolInvoked} | ${a.searchToolInvoked} | ${a.relay} | ${a.k7pass} | ${a.medianWallMs ?? '-'} | ${a.medianTokens ?? '-'} |`,
    );
  }
  lines.push('');
  lines.push('Comparisons: E vs D isolates typed content (same machinery, same bodies). F vs B4-B (8% search) tests voluntary preview-tool pickup. A is the control.');
  return lines.join('\n');
}

const args = process.argv.slice(2);
const dirs =
  args.length > 0
    ? args
    : readdirSync(join(root, 'trials', 'receipts'), { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith('v2-'))
        .map((e) => join(root, 'trials', 'receipts', e.name));
const runs = loadReceipts(dirs);
const analysis = analyze(runs);
console.log(JSON.stringify({ conditions: analysis, runs: runs.length }, null, 2));
console.log(report(analysis));
