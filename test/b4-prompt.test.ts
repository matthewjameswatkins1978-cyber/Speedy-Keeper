/**
 * B4 condition C prompt-metadata contract: `memory_search` carries the one
 * line that puts it into Pi's "Available tools" section (custom tools are
 * omitted from that section without it — the B3 discoverability defect),
 * plus a single neutral guideline bullet; `memory_save` stays silent.
 * The extension passes both fields through and still registers no events.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createMemoryTools } from '../src/pi/adapter.js';
import factory from '../pi-extension/keeper-memory.js';
import type { PiToolDefinition } from '../pi-extension/pi-types.js';
import { tempDb } from './helpers.js';

function byName(hint = true): Record<string, ReturnType<typeof createMemoryTools>[number]> {
  const t = tempDb('b4-prompt');
  try {
    return Object.fromEntries(createMemoryTools({ dbPath: t.db, hint }).map((x) => [x.name, x]));
  } finally {
    t.cleanup();
  }
}

test('memory_search exposes one prompt snippet; memory_save exposes none', () => {
  const tools = byName();
  const search = tools['memory_search']!;
  const save = tools['memory_save']!;
  assert.ok(search.promptSnippet, 'memory_search must advertise a snippet');
  assert.ok(search.promptSnippet!.length < 120, `snippet too long: ${search.promptSnippet!.length}`);
  assert.match(search.promptSnippet!, /^memory_search\b/, 'snippet must name the tool it lists');
  assert.equal(save.promptSnippet, undefined, 'save must not add ambient prompt text');
});

test('condition B: without the hint flag, no prompt metadata exists at all', () => {
  const tools = byName(false);
  assert.equal(tools['memory_search']!.promptSnippet, undefined, 'B must add no snippet');
  assert.equal(tools['memory_search']!.promptGuidelines, undefined, 'B must add no guidelines');
});

test('memory_search carries exactly one neutral guideline bullet, save none', () => {
  const tools = byName();
  const search = tools['memory_search']!;
  assert.ok(Array.isArray(search.promptGuidelines));
  assert.equal(search.promptGuidelines!.length, 1, 'condition C is one bullet, not a procedure');
  const bullet = search.promptGuidelines![0]!;
  assert.ok(bullet.length < 160, `guideline too long: ${bullet.length}`);
  assert.ok(!/\bmust\b|\balways\b|\bnever\b/i.test(bullet), `guideline must stay neutral: ${bullet}`);
  assert.match(bullet, /memory_search/, 'guideline should name the tool it points at');
  assert.equal(tools['memory_save']!.promptGuidelines, undefined);
});

test('the extension passes prompt metadata through and still registers no events', () => {
  const t = tempDb('b4-ext');
  try {
    const saved = process.env['SPEEDY_KEEPER_DB'];
    const savedHint = process.env['SPEEDY_KEEPER_HINT'];
    process.env['SPEEDY_KEEPER_DB'] = t.db;
    process.env['SPEEDY_KEEPER_HINT'] = '1'; // condition C/D opt-in
    const tools: PiToolDefinition[] = [];
    const events: string[] = [];
    try {
      factory({
        registerTool: (d: PiToolDefinition) => {
          tools.push(d);
          return d.name;
        },
        on: ((name: string) => {
          events.push(name);
          throw new Error(`unexpected event subscription: ${name}`);
        }) as never,
      } as never);
    } finally {
      if (saved === undefined) delete process.env['SPEEDY_KEEPER_DB'];
      else process.env['SPEEDY_KEEPER_DB'] = saved;
      if (savedHint === undefined) delete process.env['SPEEDY_KEEPER_HINT'];
      else process.env['SPEEDY_KEEPER_HINT'] = savedHint;
    }
    assert.deepEqual(events, []);
    assert.deepEqual(tools.map((x) => x.name), ['memory_search', 'memory_save']);
    const search = tools.find((x) => x.name === 'memory_search')!;
    assert.ok(search.promptSnippet, 'extension must forward the snippet to Pi');
    assert.equal(search.promptGuidelines!.length, 1);
    assert.equal(tools.find((x) => x.name === 'memory_save')!.promptSnippet, undefined);
  } finally {
    t.cleanup();
  }
});
