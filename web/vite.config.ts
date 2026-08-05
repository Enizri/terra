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
      '/analyze': api,
      '/analyses': api,
      '/preview': api,
      '/ask': api,
      '/files': api,
    },
  },
})
