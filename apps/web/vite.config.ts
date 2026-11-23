import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  // Product thumbnails may come from the store's image CDN. Nothing else loads from outside.
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Only in builds: the dev server needs inline scripts and styles for hot reload.
const contentPolicy: Plugin = {
  name: 'content-policy',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: POLICY }, injectTo: 'head-prepend' },
  ],
};

export default defineConfig({
  base: './',
  plugins: [react(), contentPolicy],
  build: { target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@relate/relate-wasm'] },
});
