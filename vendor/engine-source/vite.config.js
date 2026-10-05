/**
 * Vite config for Cloudflare Pages deployment.
 * Configures the build to output to the `web/` directory so that
 * Cloudflare serves `web/index.html` as the site root.
 */
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: 'web/index.html',
    },
  },
})