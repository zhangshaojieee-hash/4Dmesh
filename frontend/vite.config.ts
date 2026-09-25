import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const reactRouterProductionEntry = fileURLToPath(
  new URL('./node_modules/react-router/dist/production/index.mjs', import.meta.url),
)
const reactRouterDomProductionEntry = fileURLToPath(
  new URL('./node_modules/react-router/dist/production/dom-export.mjs', import.meta.url),
)

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: command === 'serve' ? [react()] : [],
  resolve: command === 'build'
    ? {
        alias: [
          { find: /^react-router\/dom$/, replacement: reactRouterDomProductionEntry },
          { find: /^react-router$/, replacement: reactRouterProductionEntry },
        ],
      }
    : undefined,
  server: {
    allowedHosts: ['www.dev-lmx.xyz'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    reportCompressedSize: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'three-vendor': ['three', '@react-three/fiber'],
        },
      },
    },
  },
}))
