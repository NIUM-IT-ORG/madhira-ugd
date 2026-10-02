import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// MapLibre v6 runs its parser in a module worker (maplibre-gl-worker.mjs + maplibre-gl-shared.mjs).
// Ship the package's own prebuilt files as static assets so dev and production load the same thing.
function copyMaplibreWorker() {
  const src = path.resolve(__dirname, 'node_modules/maplibre-gl/dist')
  const dst = path.resolve(__dirname, 'public/vendor/maplibre')
  fs.mkdirSync(dst, { recursive: true })
  for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) fs.copyFileSync(path.join(src, f), path.join(dst, f))
}
copyMaplibreWorker()

// In development the API server (server/, port 8080) serves /api and the map data under /data.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The status model in ../shared is imported by both the app and the API server.
    fs: { allow: ['..'] },
    proxy: {
      '/api': 'http://localhost:8080',
      '/data': 'http://localhost:8080',
    },
  },
})
