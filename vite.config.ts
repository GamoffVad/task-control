/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import pkg from './package.json' with { type: 'json' }

/** API (server/app.ts) внутри сервера разработки: хранилище — файл .data/dev-db.json или DATABASE_URL. */
const api = (): Plugin => ({
  name: 'task-control-api',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      if (!req.url?.startsWith('/api/')) return next()
      const mod = (await server.ssrLoadModule('/server/dev.ts')) as { handle: (q: IncomingMessage, s: ServerResponse) => Promise<void> }
      await mod.handle(req, res)
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Переменные из .env (например, DATABASE_URL после `vercel env pull`) — для API в режиме разработки.
  const env = loadEnv(mode, process.cwd(), '')
  // process.env превращает undefined в строку "undefined" — присваиваем только заданное значение.
  if (!process.env.DATABASE_URL && env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL
  return {
    plugins: [react(), api()],
    // Приложение должно открываться в последнем Chrome для Windows 7 (109) и в Edge 109.
    build: { target: ['chrome109', 'edge109', 'firefox115', 'safari15.6'] },
    esbuild: { target: 'chrome109' },
    // Версия приложения из package.json — показывается в интерфейсе.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
    },
  }
})
