import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { notices } from './scripts/notices.ts'

// Builds the side-panel dashboard straight into ../extension (panel.html + assets/).
export default defineConfig({
  plugins: [react(), tailwindcss(), notices()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  base: './',
  build: {
    outDir: '../extension',
    emptyOutDir: false,
    rollupOptions: { input: [path.resolve(import.meta.dirname, 'panel.html'), path.resolve(import.meta.dirname, 'media.html')] },
  },
})
