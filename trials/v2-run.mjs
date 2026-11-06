/**
 * v2 trial harness: conditions A/D/E/F × tasks × waves of repetitions.
 * A = nothing (control). D = B4 replication (legacy 2-tool surface, hint,
 * injected preview, B4 seeds). E = D's machinery + v2-typed seeds (content
 * variable isolated). F = v2 toolset, no hint, no injection (voluntary
 * pickup of the purpose-built preview tool). B4's run.mjs is untouched.
 * every run disposable (temp fixture copy, temp database, temp session dir).
 *
 *   A baseline  — plain Pi, no extension
 *   B voluntary — keeper-memory.ts registers the two tools only
 *   C discovery — B plus SPEEDY_KEEPER_HINT=1 (adapter promptSnippet/promptGuidelines)
 *   D selective — C plus the harness-only pre-task preview extension
 *                 (inert unless SPEEDY_KEEPER_PREVIEW=1)
 *
 * Waves (tasks.json "waves"):  scout  = 4 tasks × 4 conditions × 2 reps = 32
 *                              full   = 4 new tasks × 4 × 3 (+ scout top-up
 *                                       4 × 4 × 1)             = 64
 *                              all    = scout + full             = 96
 * Run order is a seeded shuffle (shuffleSeed + wave), recorded in the receipt.
 *
 * Every run also records: fixture manifest before/after (adds/modifies/
 * deletions with per-task allowances), post-run fixture test exit (K3),
 * preview log (D), declared tools from the transcript, token/cache/cost
 * usage, dangerous/network command attempts (via score.mjs), and the
 * byte-identical `pi list` snapshots around the wave.
 *
 *   node trials/run.mjs --dry-run  [scout|full|all]   plan only, run nothing
 *   node trials/run.mjs --execute  [scout|full|all]   perform the live calls
 *
 * --execute refuses unless B3_APPROVED=1, aborts on token ceilings, and
 * copies each session + logs into trials/receipts/<wave>-<stamp>/ so the
 * evidence survives temp cleanup.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasks = JSON.parse(readFileSync(join(root, 'trials', 'tasks.json'), 'utf8'));

const invokedAsMain =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/**
 * v2 conditions. A and D replicate B4 exactly (D = 2-tool surface via
 * SPEEDY_KEEPER_V2=0 + hint + injected preview + B4 seeds). E keeps D's
 * injection machinery and swaps in v2-typed seeds (content variable
 * isolated: bodies byte-identical, kinds/grades/sources added). F tests
 * voluntary pickup of the purpose-built toolset (v2 tools, no hint, no
 * injection, v2 seeds).
 */
const CONDITIONS = ['A', 'D', 'E', 'F'];

function conditionSpec(condition) {
  if (condition === 'A') return { keeper: false, preview: false, hint: false, seeded: false, v2tools: false, seeds: null };
  if (condition === 'D')
    return { keeper: true, preview: true, hint: true, seeded: true, v2tools: false, seeds: 'b4' };
  if (condition === 'E')
    return { keeper: true, preview: true, hint: true, seeded: true, v2tools: false, seeds: 'v2' };
  if (condition === 'F')
    return { keeper: true, preview: false, hint: false, seeded: true, v2tools: true, seeds: 'v2' };
  throw new Error(`unknown condition: ${condition}`);
}

function waveGroups(wave) {
  const w = tasks.waves;
  if (wave === 'scout') return [{ taskIds: w.scout.tasks, reps: w.scout.reps }];
  if (wave === 'full') {
    return [
      { taskIds: w.full.newTasks, reps: w.full.reps },
      // Top-up continues the scout numbering (r3) so the combined 96-run
      // dataset keeps unique runIds instead of re-labelling a second run r1.
      { taskIds: w.scout.tasks, reps: w.full.scoutTopUp, repBase: w.scout.reps + 1 },
    ];
  }
  if (wave === 'all') {
    return [
      { taskIds: w.scout.tasks, reps: w.scout.reps },
      { taskIds: w.full.newTasks, reps: w.full.reps },
      { taskIds: w.scout.tasks, reps: w.full.scoutTopUp, repBase: w.scout.reps + 1 },
    ];
  }
  throw new Error(`unknown wave: ${wave} (use scout | full | all)`);
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = ((h ^ str.charCodeAt(i)) * 16777619) >>> 0;
  return h;
}

/** Deterministic Fisher-Yates with an LCG; the seed is recorded in the receipt. */
export function seededShuffle(arr, seed) {
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function planRuns(wave = 'all') {
  const plans = [];
  for (const group of waveGroups(wave)) {
    for (const taskId of group.taskIds) {
      const task = tasks.tasks.find((t) => t.id === taskId);
      if (!task) throw new Error(`tasks.json has no task ${taskId}`);
      const repBase = group.repBase ?? 1;
      for (let rep = repBase; rep < repBase + group.reps; rep++) {
        for (const condition of CONDITIONS) {
          plans.push({ taskId, prompt: task.prompt, condition, rep, ...conditionSpec(condition) });
        }
      }
    }
  }
  return seededShuffle(plans, (tasks.shuffleSeed ?? 1) ^ hashSeed(wave));
}

function buildCommand(plan, paths) {
  const toolArgs = [
    '-p',
    plan.prompt,
    '--model',
    process.env['V2_MODEL']?.trim() ? process.env['V2_MODEL'].trim() : tasks.model,
    '--thinking',
    tasks.thinking,
    '--session-dir',
    paths.sessionDir,
    '--offline',
  ];
  if (plan.keeper) toolArgs.push('--extension', join(root, 'pi-extension', 'keeper-memory.ts'));
  if (plan.preview) toolArgs.push('--extension', join(root, 'trials', 'preview-extension.ts'));
  // pi ships as a .cmd shim on Windows: spawn through cmd there.
  const shell = process.platform === 'win32';
  return {
    program: shell ? 'cmd' : 'pi',
    args: shell ? ['/c', 'pi', ...toolArgs] : toolArgs,
    cwd: paths.fixtureDir,
    timeoutMs: tasks.timeoutSeconds * 1000,
  };
}

function piList() {
  if (process.platform === 'win32') {
    return execFileSync('cmd', ['/c', 'pi', 'list'], { encoding: 'utf8', timeout: 60000 });
  }
  return execFileSync('pi', ['list'], { encoding: 'utf8', timeout: 60000 });
}

/** sha256 of every file in the fixture copy, keyed by repo-relative path. */
function walkManifest(dir) {
  const out = new Map();
  const stack = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) stack.push(childRel);
      else {
        out.set(
          childRel.split('\\').join('/'),
          createHash('sha256').update(readFileSync(join(dir, childRel))).digest('hex'),
        );
      }
    }
  }
  return out;
}

function diffManifest(before, after, task) {
  const allowModify = (task.allowModify ?? []).map((p) => p.replace(/\/+$/, ''));
  const allowAdd = task.allowAdd ?? [];
  const deleted = [...before.keys()].filter((k) => !after.has(k));
  const modified = [...before.keys()].filter((k) => after.has(k) && before.get(k) !== after.get(k));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const violations = [];
  for (const d of deleted) violations.push(`deleted: ${d}`);
  for (const m of modified) {
    if (!allowModify.some((p) => m === p || m.startsWith(`${p}/`))) violations.push(`modified: ${m}`);
  }
  for (const a of added) {
    if (!allowAdd.includes(a)) violations.push(`added: ${a}`);
  }
  return { deleted, modified, added, violations };
}

function runFixtureTests(fixtureDir) {
  try {
    const r = spawnSync(process.execPath, ['tests/run.js'], {
      cwd: fixtureDir,
      encoding: 'utf8',
      timeout: 30000,
    });
    return r.status;
  } catch {
    return null;
  }
}

export function dryRun(wave = 'all') {
  return planRuns(wave).map((plan) => {
    const cmd = buildCommand(plan, {
      sessionDir: '<tmp>/session',
      fixtureDir: '<tmp>/fixture',
    });
    return {
      ...plan,
      command: `${cmd.program} ${cmd.args.map((a) => JSON.stringify(a)).join(' ')}`,
      cwd: cmd.cwd,
    };
  });
}

if (!invokedAsMain) {
  // Imported by tests: exports only, run nothing.
} else {
  const waveArg = process.argv[3] ?? 'all';
  if (process.argv[2] === '--dry-run') {
    console.log(
      JSON.stringify({ mode: 'dry-run', wave: waveArg, liveCalls: 0, plans: dryRun(waveArg) }, null, 2),
    );
  } else if (process.argv[2] === '--execute') {
    if (process.env['V2_APPROVED'] !== '1') {
      console.error('refused: set V2_APPROVED=1 only after explicit approval (model spend)');
      process.exit(2);
    }
    const { parseSessionFile, applyOracle, findSessionFile } = await import('./score.mjs');
    const base = mkdtempSync(join(tmpdir(), 'v2-trial-'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const evidenceDir = join(root, 'trials', 'receipts', `v2-${waveArg}-${stamp}`);
    mkdirSync(evidenceDir, { recursive: true });
    const receipt = {
      wave: 'v2-' + waveArg,
      startedAt: new Date().toISOString(),
      model: process.env['V2_MODEL']?.trim() ? process.env['V2_MODEL'].trim() : tasks.model,
      shuffleSeed: (tasks.shuffleSeed ?? 1) ^ hashSeed(waveArg),
      runs: [],
      settingsBefore: '',
      settingsAfter: '',
    };
    try {
      receipt.settingsBefore = piList();
      let totalTokens = 0;
      const plans = planRuns(waveArg);
      for (const [order, plan] of plans.entries()) {
        const task = tasks.tasks.find((t) => t.id === plan.taskId);
        const runDir = mkdtempSync(join(base, `${plan.taskId}-${plan.condition}-r${plan.rep}-`));
        const fixtureDir = join(runDir, 'fixture');
        cpSync(join(root, 'trials', 'fixture'), fixtureDir, { recursive: true });
        const sessionDir = join(runDir, 'session');
        mkdirSync(sessionDir, { recursive: true });
        const db = join(runDir, 'memory.sqlite');
        const env = { ...process.env };
        // Start every run from exactly the environment the condition defines.
        for (const k of [
          'SPEEDY_KEEPER_DB',
          'SPEEDY_KEEPER_DISABLED',
          'SPEEDY_KEEPER_PREVIEW',
          'SPEEDY_KEEPER_PREVIEW_LOG',
          'SPEEDY_KEEPER_HINT',
          'SPEEDY_KEEPER_V2',
        ]) {
          delete env[k];
        }
        // v2 tool surface only where the condition asks for it (F);
        // D replicates B4's two-tool surface exactly.
        env['SPEEDY_KEEPER_V2'] = plan.v2tools === true ? '1' : '0';
        if (plan.seeded) {
          const seedArgs = [join(root, 'trials', 'seed.mjs'), db, plan.taskId];
          if (plan.seeds !== null && plan.seeds !== undefined && plan.seeds !== 'b4') seedArgs.push(plan.seeds);
          execFileSync(process.execPath, seedArgs, {
            timeout: 60000,
          });
          env['SPEEDY_KEEPER_DB'] = db;
        }
        if (plan.hint) env['SPEEDY_KEEPER_HINT'] = '1';
        if (plan.preview) {
          env['SPEEDY_KEEPER_PREVIEW'] = '1';
          env['SPEEDY_KEEPER_PREVIEW_LOG'] = join(runDir, 'preview.jsonl');
        }
        const manifestBefore = walkManifest(fixtureDir);
        const cmd = buildCommand(plan, { sessionDir, fixtureDir });
        const t0 = Date.now();
        const child = spawnSync(cmd.program, cmd.args, {
          cwd: cmd.cwd,
          env,
          encoding: 'utf8',
          timeout: cmd.timeoutMs,
        });
        const wallMs = Date.now() - t0;
        const manifestAfter = walkManifest(fixtureDir);
        const manifest = diffManifest(manifestBefore, manifestAfter, task);
        const fixtureTestsExit = task.oracle?.fixtureTests ? runFixtureTests(fixtureDir) : null;
        const sessionFile = findSessionFile(sessionDir);
        const stats = sessionFile ? parseSessionFile(sessionFile) : null;
        const runTokens = stats ? stats.inputTokens + stats.outputTokens : 0;
        totalTokens += runTokens;
        const previewLog = env['SPEEDY_KEEPER_PREVIEW_LOG'];
        const previewEntries =
          previewLog && existsSync(previewLog)
            ? readFileSync(previewLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
            : [];
        const facts = {
          exitCode: child.status,
          timedOut: child.error !== undefined && child.error !== null,
          manifest,
          fixtureTestsExit,
          preview: previewEntries[0] ?? null,
        };
        const oracle = stats
          ? applyOracle(task, stats, fixtureDir, plan.condition, facts)
          : { pass: false, fails: [sessionFile ? 'session not parsed' : 'no session captured'], answer: '' };
        const leaked = existsSync(join(fixtureDir, '.git', 'speedy-keeper'));
        const runId = `${plan.taskId}_${plan.condition}_r${plan.rep}`;
        // Incremental receipt so a mid-wave interruption keeps every completed
        // run's facts (evidence dirs are written below, per run).
        receipt.finishedAt = null;
        receipt.totalTokens = totalTokens;
        writeFileSync(join(evidenceDir, 'receipt.json'), JSON.stringify(receipt, null, 2));
        // Preserve the complete evidence per run outside temp.
        const runEvidence = join(evidenceDir, runId);
        mkdirSync(runEvidence, { recursive: true });
        if (sessionFile) copyFileSync(sessionFile, join(runEvidence, 'session.jsonl'));
        if (previewEntries.length > 0) {
          writeFileSync(join(runEvidence, 'preview.jsonl'), previewEntries.map((e) => JSON.stringify(e)).join('\n'));
        }
        receipt.runs.push({
          runId,
          order,
          ...plan,
          exitCode: child.status,
          timedOut: facts.timedOut,
          wallMs,
          sessionFile,
          tokens: runTokens,
          usage: stats
            ? {
                input: stats.inputTokens,
                output: stats.outputTokens,
                cacheRead: stats.cacheRead,
                cacheWrite: stats.cacheWrite,
                cost: stats.costTotal,
                maxTotal: stats.maxTotalTokens,
              }
            : null,
          declaredTools: stats?.declaredTools ?? [],
          durationsMs: stats?.durationsMs ?? {},
          toolErrors: stats?.toolErrors ?? 0,
          dangerousAttempts: stats?.dangerousCommandAttempts ?? [],
          networkAttempts: stats?.networkAttempts ?? [],
          stats: stats ? { ...stats, assistantTexts: undefined } : null,
          oracle,
          preview: previewEntries,
          manifest,
          fixtureTestsExit,
          isolation: { projectDbLeaked: leaked, dbPath: plan.seeded ? db : null },
        });
        if (leaked) throw new Error(`isolation breach in ${runId}: project database created`);
        const wantPreview = plan.condition === 'D' || plan.condition === 'E';
        if (wantPreview && previewEntries.length !== 1) {
          throw new Error(`preview wiring failure in ${runId}: expected 1 preview entry, saw ${previewEntries.length}`);
        }
        if (!wantPreview && previewEntries.length !== 0) {
          throw new Error(`preview leaked outside conditions D/E in ${runId}`);
        }
        if (runTokens > tasks.tokenCeilingPerRun) {
          throw new Error(`per-run token ceiling exceeded in ${runId} (${runTokens})`);
        }
        if (totalTokens > tasks.tokenCeilingTotal) {
          throw new Error(`total token ceiling exceeded (${totalTokens}), aborting trial`);
        }
      }
      receipt.settingsAfter = piList();
      receipt.settingsUnchanged = receipt.settingsBefore === receipt.settingsAfter;
      receipt.finishedAt = new Date().toISOString();
      receipt.totalTokens = totalTokens;
      const out = join(base, 'receipt.json');
      writeFileSync(out, JSON.stringify(receipt, null, 2));
      copyFileSync(out, join(evidenceDir, 'receipt.json'));
      console.log(
        JSON.stringify({
          ok: true,
          wave: receipt.wave,
          receipt: out,
          evidence: evidenceDir,
          runs: receipt.runs.length,
          totalTokens,
          settingsUnchanged: receipt.settingsUnchanged,
        }),
      );
    } catch (err) {
      console.error(`trial aborted: ${err instanceof Error ? err.message : err}`);
      // Preserve whatever the receipt has so far.
      try {
        writeFileSync(join(evidenceDir, 'receipt.partial.json'), JSON.stringify(receipt, null, 2));
      } catch {
        /* best effort */
      }
      process.exit(1);
    }
  } else {
    console.error('usage: node trials/run.mjs --dry-run|--execute [scout|full|all]');
    process.exit(2);
  }
}
