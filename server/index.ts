import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { createApiHandler } from './api.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

export function createBackend(dbPath: string = resolve(root, 'data', 'app.sqlite'), now: () => string = () => new Date().toISOString()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = new Store(dbPath);
  const handler = createApiHandler(store, now);
  return { store, handler };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 5315);
  const host = process.env.HOST ?? '127.0.0.1';
  const { handler } = createBackend();
  const server = createServer((req, res) => {
    if ((req.url ?? '').startsWith('/api/')) {
      handler(req, res);
    } else {
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'use the Vite dev server for the UI' }));
    }
  });
  server.listen(port, host, () => {
    console.log(`API listening on http://${host}:${port}`);
  });
}
