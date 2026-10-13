// Creates the gitignored local test config expected by tests/run.js.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(here, 'config.local.json');

writeFileSync(cfgPath, JSON.stringify({ bind: '127.0.0.1', seeded: true }, null, 2) + '\n');
console.log(`wrote ${cfgPath}`);
