import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: '/',
  server: {
    port: 5273,
    host: '127.0.0.1',
    proxy: {
      '/pb': {
        // 剥掉 /pb 前缀，使 /pb/api/xxx -> :8199/api/xxx（与 nginx 反代行为一致）
        target: 'http://127.0.0.1:8199',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/pb/, '') || '/',
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia', 'pocketbase'],
        },
      },
    },
  },
})
