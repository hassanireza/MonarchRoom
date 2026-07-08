import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Base path matches the GitHub Pages project URL: https://<user>.github.io/monarch-room/
// Update this if the repository is renamed.
export default defineConfig({
  base: '/MonarchRoom/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
