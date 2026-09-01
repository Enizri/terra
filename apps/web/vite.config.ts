import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'

// Terra Go API — same-origin in dev, so no CORS anywhere.
// TERRA_API overrides the target when the server runs on another port.
const api = process.env.TERRA_API ?? 'http://localhost:8080'
const terraToken = process.env.TERRA_TOKEN?.trim() ?? ''

/** Forward TERRA_TOKEN from `.env` so the workspace does not ask you to paste it. */
function apiProxy(): ProxyOptions {
  return {
    target: api,
    configure(proxy) {
      if (!terraToken) return
      proxy.on('proxyReq', (proxyReq) => {
        if (!proxyReq.getHeader('authorization')) {
          proxyReq.setHeader('Authorization', `Bearer ${terraToken}`)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Only .test.tsx: the pure-logic .test.ts files run on `node --test`, which
  // vitest does not intercept.
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
  server: {
    proxy: {
      // Vite matches proxy keys by prefix, so '/analyze' would already catch
      // '/analyses' — the explicit entry keeps that from being an accident.
      '/analyses': apiProxy(),
      '/analyze': apiProxy(),
      '/jobs': apiProxy(),
      '/models': apiProxy(),
      '/host': apiProxy(),
      '/preview': apiProxy(),
      '/ask': apiProxy(),
      '/files': apiProxy(),
      '/traces': apiProxy(),
    },
  },
})
