/**
 * sk-runtime-no-hooks: the extension exposes no lifecycle surface that could
 * inject context or trigger automatic writes. A recording Proxy proves only
 * registerTool is ever touched; a source scan bans handler APIs; shadow
 * retrieval is proven log-only with wouldInject false.
 */
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBuilt, fail, pass, repoRoot } from './_setup.mjs';

const ID = 'sk-runtime-no-hooks';
const BANNED = ['pi.on(', 'sendMessage', 'appendEntry', 'setActiveTools', 'registerCommand', 'registerProvider', 'registerMcpServer', 'before_agent_start', 'agent_before_settle', 'context_with_system'];

try {
  ensureBuilt();
  const root = repoRoot();

  // 1. Dynamic: every property access on the API stub is recorded.
  const factory = (await import('../../dist/pi-extension/keeper-memory.js')).default;
  const touched = [];
  const names = [];
  const stub = new Proxy(
    {},
    {
      get(_t, p) {
        touched.push(String(p));
        if (p === 'registerTool') return (def) => names.push(def.name);
        return () => {
          throw new Error(`unexpected API use: ${String(p)}`);
        };
      },
    },
  );
  process.env['SPEEDY_KEEPER_DB'] = join(tmpdir(), `bat-nohooks-${Date.now()}.sqlite`);
  factory(stub);
  delete process.env['SPEEDY_KEEPER_DB'];
  const extra = touched.filter((p) => p !== 'registerTool');
  if (extra.length > 0) fail(ID, `extension touched API beyond registerTool: ${extra.join(',')}`);
  if (names.join(',') !== 'memory_search,memory_save') fail(ID, `unexpected tool set: ${names.join(',')}`);

  // 2. Static: handler/injection APIs appear nowhere in the adapter surface.
  for (const f of ['pi-extension/keeper-memory.ts', 'src/pi/adapter.ts', 'src/pi/shadow.ts', 'src/pi/format.ts']) {
    const src = readFileSync(join(root, f), 'utf8');
    for (const banned of BANNED) {
      if (src.includes(banned)) fail(ID, `banned API reference ${banned} in ${f}`);
    }
  }

  // 3. Shadow retrieval writes only its log and never injects.
  const { KeeperStore } = await import('../../dist/src/index.js');
  const { shadowRetrieve } = await import('../../dist/src/pi/shadow.js');
  const dir = mkdtempSync(join(tmpdir(), 'bat-shadow-'));
  try {
    const seed = new KeeperStore(join(dir, 'm.sqlite'));
    try {
      seed.save({ kind: 'decision', title: 'Shadow hook probe', body: 'shadow hook body words' });
    } finally {
      seed.close();
    }
    const store = new KeeperStore(join(dir, 'm.sqlite'));
    try {
      for (let i = 0; i < 3; i++) {
        const r = shadowRetrieve(store, 'shadow hook', { logPath: join(dir, 'shadow.jsonl') });
        if (r.wouldInject !== false) fail(ID, 'shadow retrieval reported wouldInject true');
      }
    } finally {
      store.close();
    }
    const files = readdirSync(dir).sort();
    if (JSON.stringify(files) !== JSON.stringify(['m.sqlite', 'shadow.jsonl'])) {
      fail(ID, `shadow side effects beyond its log: ${files.join(',')}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  pass(ID);
} catch (err) {
  fail(ID, err);
}
