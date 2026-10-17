// Fails deterministically when tests/config.local.json has not been created
// by `node tests/setup.js` (the file is gitignored, so fresh clones lack it).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = join(here, 'config.local.json');

if (!existsSync(cfgPath)) {
  console.error(`missing config: ${cfgPath} (run node tests/setup.js first)`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
if (cfg.bind !== '127.0.0.1') {
  console.error('config.bind must be 127.0.0.1 in tests');
  process.exit(1);
}

console.log('tests passed');
process.exit(0);
