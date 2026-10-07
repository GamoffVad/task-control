/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import pkg from './package.json' with { type: 'json' }

/** API (server/app.ts) внутри сервера разработки: хранилище — SQL Server (server/dev.ts). */
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
  // Переменные из .env (MSSQL_*, TC_*) — для API в режиме разработки.
  const env = loadEnv(mode, process.cwd(), '')
  // process.env превращает undefined в строку "undefined" — присваиваем только заданные значения.
  for (const [key, value] of Object.entries(env)) if (/^(MSSQL_|TC_)/.test(key) && !process.env[key] && value) process.env[key] = value
  return {
    plugins: [react(), api()],
    // Приложение должно открываться в последнем Chrome для Windows 7 (109) и в Edge 109.
    build: { target: ['chrome109', 'edge109', 'firefox115', 'safari15.6'] },
    // Vite 8 использует oxc: прежний параметр esbuild.target он игнорировал с предупреждением.
    oxc: { target: 'chrome109' },
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
