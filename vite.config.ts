import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './src/manifest'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [react(), tailwindcss(), crx({ manifest })],
  server: {
    // crxjs HMR uses a fixed port; keep it stable so reloads are reliable
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
})
