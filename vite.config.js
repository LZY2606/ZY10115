import { defineConfig } from 'vite';

const apiPort = process.env.API_PORT || '5316';

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
