/**
 * B3 trial runner. Disposable everything: temp fixture copy, temp database,
 * temp session dir. With-runs load the extension via explicit `-e` only;
 * without-runs omit it. NOTHING is installed, configured or merged.
 *
 *   node trials/run.mjs --dry-run        print the planned live calls, run nothing
 *   node trials/run.mjs --execute        perform the approved live-model calls
 *
 * --execute refuses unless B3_APPROVED=1 is set in the environment, and
 * aborts when token ceilings from trials/tasks.json would be exceeded.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasks = JSON.parse(readFileSync(join(root, 'trials', 'tasks.json'), 'utf8'));

const invokedAsMain =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const mode = process.argv[2] ?? '--dry-run';
const CONDITIONS = ['with', 'without'];

function planRuns() {
  const plans = [];
  for (const task of tasks.tasks) {
    for (const condition of CONDITIONS) {
      plans.push({ taskId: task.id, prompt: task.prompt, condition });
    }
  }
  return plans;
}

function buildCommand(plan, paths) {
  const args = [
    '-p',
    plan.prompt,
    '--model',
    tasks.model,
    '--thinking',
    tasks.thinking,
    '--session-dir',
    paths.sessionDir,
    '--offline',
  ];
  if (plan.condition === 'with') {
    args.push('--extension', join(root, 'pi-extension', 'keeper-memory.ts'));
  }
  return { program: 'pi', args, cwd: paths.fixtureDir, timeoutMs: tasks.timeoutSeconds * 1000 };
}

export function dryRun() {
  return planRuns().map((plan) => {
    const cmd = buildCommand(plan, {
      sessionDir: '<tmp>/session',
      fixtureDir: '<tmp>/fixture',
    });
    return { ...plan, command: `${cmd.program} ${cmd.args.map((a) => JSON.stringify(a)).join(' ')}`, cwd: cmd.cwd };
  });
}

if (!invokedAsMain) {
  // Imported by tests: export dryRun only, run nothing.
} else if (mode === '--dry-run') {
  console.log(JSON.stringify({ mode: 'dry-run', liveCalls: 0, plans: dryRun() }, null, 2));
} else if (mode === '--execute') {
  if (process.env['B3_APPROVED'] !== '1') {
    console.error('refused: set B3_APPROVED=1 only after explicit spending approval');
    process.exit(2);
  }
  const { parseSessionFile, applyOracle, findSessionFile } = await import('./score.mjs');
  const base = mkdtempSync(join(tmpdir(), 'b3-trial-'));
  const receipt = { startedAt: new Date().toISOString(), model: tasks.model, runs: [], settingsBefore: '', settingsAfter: '' };
  try {
    receipt.settingsBefore = execFileSync('pi', ['list'], { encoding: 'utf8', timeout: 60000 });
    let totalTokens = 0;
    for (const plan of planRuns()) {
      const runDir = mkdtempSync(join(base, `${plan.taskId}-${plan.condition}-`));
      const fixtureDir = join(runDir, 'fixture');
      cpSync(join(root, 'trials', 'fixture'), fixtureDir, { recursive: true });
      const sessionDir = join(runDir, 'session');
      mkdirSync(sessionDir, { recursive: true });
      const db = join(runDir, 'memory.sqlite');
      const env = { ...process.env };
      if (plan.condition === 'with') {
        execFileSync(process.execPath, [join(root, 'trials', 'seed.mjs'), db], { timeout: 60000 });
        env['SPEEDY_KEEPER_DB'] = db;
      } else {
        delete env['SPEEDY_KEEPER_DB'];
      }
      const cmd = buildCommand(plan, { sessionDir, fixtureDir });
      const t0 = Date.now();
      const child = spawnSync(cmd.program, cmd.args, { cwd: cmd.cwd, env, encoding: 'utf8', timeout: cmd.timeoutMs });
      const wallMs = Date.now() - t0;
      const sessionFile = findSessionFile(sessionDir);
      const stats = sessionFile ? parseSessionFile(sessionFile) : null;
      const runTokens = stats ? stats.inputTokens + stats.outputTokens : 0;
      totalTokens += runTokens;
      const task = tasks.tasks.find((t) => t.id === plan.taskId);
      const oracle = stats ? applyOracle(task, stats, fixtureDir) : { pass: false, fails: ['no session captured'], answer: '' };
      // Isolation: the fixture project must not gain a keeper database.
      const leaked = existsSync(join(fixtureDir, '.git', 'speedy-keeper'));
      receipt.runs.push({
        ...plan,
        exitCode: child.status,
        wallMs,
        sessionFile,
        tokens: runTokens,
        stats,
        oracle,
        isolation: { projectDbLeaked: leaked, dbPath: plan.condition === 'with' ? db : null },
      });
      if (leaked) throw new Error(`isolation breach in ${plan.taskId}/${plan.condition}: project database created`);
      if (totalTokens > tasks.tokenCeilingTotal) throw new Error(`token ceiling exceeded (${totalTokens}), aborting trial`);
    }
    receipt.settingsAfter = execFileSync('pi', ['list'], { encoding: 'utf8', timeout: 60000 });
    receipt.settingsUnchanged = receipt.settingsBefore === receipt.settingsAfter;
    receipt.finishedAt = new Date().toISOString();
    const out = join(base, 'receipt.json');
    writeFileSync(out, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ ok: true, receipt: out, runs: receipt.runs.length, settingsUnchanged: receipt.settingsUnchanged }));
  } catch (err) {
    console.error(`trial aborted: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
} else {
  console.error('usage: node trials/run.mjs --dry-run | --execute');
  process.exit(2);
}
