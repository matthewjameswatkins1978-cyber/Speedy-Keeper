import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadConfig(env = 'staging') {
  const raw = readFileSync(join(here, 'config', `${env}.json`), 'utf8');
  return JSON.parse(raw);
}

export function start(env = 'staging') {
  const config = loadConfig(env);
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok\n');
      return;
    }
    res.writeHead(404);
    res.end('not found\n');
  });
  server.listen(config.port, config.bind);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start(process.env.LEDGERD_ENV ?? 'staging');
}
