import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works from any sub-path or static host.
  base: './',
  server: { port: 5174, strictPort: false, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
})
