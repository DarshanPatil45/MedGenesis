import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Dev-only convenience: proxies the backend through the frontend's own
// origin so the whole app (UI + API + Swagger docs) is reachable from one
// URL during local development. BACKEND_URL defaults to :8000 (the
// backend's documented default port) but can be overridden — e.g. when
// that port is already taken by something else on the machine.
const BACKEND_URL = process.env.MEDGENESIS_BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': BACKEND_URL,
      '/docs': BACKEND_URL,
      '/openapi.json': BACKEND_URL,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
