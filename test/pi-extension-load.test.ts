/**
 * Extension wiring: the B2 factory registers exactly the two tools and no
 * lifecycle handlers (no auto-injection surface), honours the disabled flag
 * by registering nothing, and reads the disposable-database env override.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import factory from '../pi-extension/keeper-memory.js';
import type { PiToolDefinition } from '../pi-extension/pi-types.js';
import { tempDb } from './helpers.js';

function capture(env: Record<string, string | undefined>): { tools: PiToolDefinition[]; events: string[] } {
  const saved: Record<string, string | undefined> = {};
  for (const k of ['SPEEDY_KEEPER_DB', 'SPEEDY_KEEPER_DISABLED']) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    const tools: PiToolDefinition[] = [];
    const events: string[] = [];
    factory({
      registerTool: (t: PiToolDefinition) => {
        tools.push(t);
        return t.name;
      },
      // Any event subscription attempt would throw here — and fail the test.
      on: ((name: string) => {
        events.push(name);
        throw new Error(`unexpected event subscription: ${name}`);
      }) as never,
    } as never);
    return { tools, events };
  } finally {
    for (const k of ['SPEEDY_KEEPER_DB', 'SPEEDY_KEEPER_DISABLED']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('factory registers exactly memory_search and memory_save, no event handlers', () => {
  const t = tempDb('pi-ext');
  try {
    const { tools, events } = capture({ SPEEDY_KEEPER_DB: t.db });
    assert.deepEqual(tools.map((x) => x.name), ['memory_search', 'memory_save']);
    assert.deepEqual(events, []);
    for (const tool of tools) {
      assert.ok(tool.description.length > 20);
      assert.ok(tool.parameters !== undefined);
      assert.equal(typeof tool.execute, 'function');
    }
  } finally {
    t.cleanup();
  }
});

test('SPEEDY_KEEPER_DISABLED=1 registers nothing', () => {
  const { tools } = capture({ SPEEDY_KEEPER_DISABLED: '1', SPEEDY_KEEPER_DB: undefined });
  assert.deepEqual(tools, []);
});

test('registered search tool honours the disposable database', async () => {
  const t = tempDb('pi-ext');
  try {
    const { tools } = capture({ SPEEDY_KEEPER_DB: t.db });
    const search = tools.find((x) => x.name === 'memory_search')!;
    const res = await search.execute('t', { query: 'empty disposable db' }, undefined, undefined, { cwd: t.dir });
    assert.equal((res.details as any).ok, true);
    assert.deepEqual((res.details as any).hits, []);
  } finally {
    t.cleanup();
  }
});
