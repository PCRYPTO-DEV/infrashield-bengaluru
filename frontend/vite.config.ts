import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,   // auto-increment if 5173 is busy
    proxy: {
      '/api': {
        target: 'http://localhost:8003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/pipeline/ws': {
        target: 'ws://localhost:8003',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
