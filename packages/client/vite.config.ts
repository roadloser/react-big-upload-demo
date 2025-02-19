import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 启用构建缓存
  cacheDir: 'node_modules/.vite',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://0.0.0.0:3002',
        changeOrigin: true,
        configure: proxy => {
          proxy.on('error', err => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', proxyReq => {
            proxyReq.setHeader('connection', 'keep-alive');
          });
        },
        timeout: 600000, // 10分钟超时
        proxyTimeout: 600000,
      },
    },
  },
  build: {
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 优化分包策略
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'antd-vendor': ['antd'],
          'axios-vendor': ['axios'],
        },
        // 优化文件命名
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
      },
      // 优化打包性能
      cache: true,
      treeshake: true,
    },
  },
});
