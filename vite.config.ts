import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// GitHub Pages serves the site from /<repo>/; locally it is served from /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.BASE_PATH ?? '/dezremon-wiki/') : '/',
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('firebase')) return 'firebase'
          if (id.includes('@tiptap') || id.includes('prosemirror') || id.includes('lowlight') || id.includes('highlight.js')) return 'editor'
          if (id.includes('@codemirror') || id.includes('codemirror') || id.includes('@lezer')) return 'codemirror'
          if (id.includes('leaflet')) return 'leaflet'
          return undefined
        },
      },
    },
  },
}))
