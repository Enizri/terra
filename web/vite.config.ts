import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Terra Go API — same-origin in dev, so no CORS anywhere.
// TERRA_API overrides the target when the server runs on another port.
const api = process.env.TERRA_API ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Vite matches proxy keys by prefix, so '/analyze' would already catch
      // '/analyses' — the explicit entry keeps that from being an accident.
      '/analyses': api,
      '/analyze': api,
      '/jobs': api,
      '/preview': api,
      '/ask': api,
      '/files': api,
      '/traces': api,
    },
  },
})
