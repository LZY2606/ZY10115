/// <reference types='vitest/config' />
import { defineConfig, type Plugin } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackend } from './server/index.ts';

const here = dirname(fileURLToPath(import.meta.url));

function apiPlugin(dbPath?: string): Plugin {
  const backend = createBackend(dbPath ?? resolve(here, 'data', 'dev.sqlite'));
  return {
    name: 'platesolve-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').startsWith('/api/')) {
          backend.handler(req as never, res as never);
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [apiPlugin()],
  server: {
    host: '127.0.0.1',
    port: 5315,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
