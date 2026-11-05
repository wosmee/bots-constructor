import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite dev proxies /api to the local Worker (wrangler dev on :8787),
// so the constructor and admin API talk to the same origin in dev.
export default defineConfig({
  plugins: [react()],
  build: {
    // Keep the heavy flow-canvas lib in its own long-lived chunk so app-code
    // deploys don't bust the visitor's xyflow cache, and report real wire sizes.
    reportCompressedSize: true,
    target: 'es2020',
    rollupOptions: {
      output: {
        // Function form so subpath imports (react/jsx-runtime, react-dom/client)
        // actually land in the vendor chunk instead of leaking back into app code.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@xyflow') || id.includes('reactflow')) return 'xyflow-vendor';
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
