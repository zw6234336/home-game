import { defineConfig, type Plugin } from 'vite';
import { startPs4EyeWatcher } from './scripts/ps4eye-auto.mjs';

const headers = { 'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:5173; object-src 'none'; base-uri 'self'", 'Permissions-Policy': 'microphone=()' };

type ApiRes = { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void };
type HookServer = {
  middlewares: { use: (fn: (req: { url?: string }, res: ApiRes, next: () => void) => void) => void };
  httpServer?: { once: (event: string, listener: () => void) => void } | null;
};

function sendJson(res: ApiRes, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function mountPs4EyeApi(server: HookServer): void {
  const watcher = startPs4EyeWatcher({ rootDir: process.cwd() });
  server.httpServer?.once('close', () => watcher.stop());
  server.middlewares.use((req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname === '/api/ps4eye/status') {
      sendJson(res, 200, watcher.getStatus());
      return;
    }
    if (pathname === '/api/ps4eye/ensure') {
      void watcher.ensure().then(
        result => sendJson(res, 200, result),
        error => sendJson(res, 500, { state: 'error', ready: false, initializedNow: false, message: error instanceof Error ? error.message : 'unknown' }),
      );
      return;
    }
    next();
  });
}

function ps4EyeAutoPlugin(): Plugin {
  return {
    name: 'ps4eye-auto',
    configureServer(server) {
      mountPs4EyeApi(server);
    },
    configurePreviewServer(server) {
      mountPs4EyeApi(server);
    },
  };
}

export default defineConfig({
  plugins: [ps4EyeAutoPlugin()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, headers },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers },
  worker: { format: 'es' },
  build: { target: 'es2022' }
});
