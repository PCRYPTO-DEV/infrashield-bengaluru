import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: false },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
})
