import { defineConfig } from 'vite';

const headers = { 'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:5173; object-src 'none'; base-uri 'self'", 'Permissions-Policy': 'microphone=()' };

export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, headers },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers },
  worker: { format: 'es' },
  build: { target: 'es2022' }
});
