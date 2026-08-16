import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// `@` resolves to /src so imports stay clean and refactor-safe.
// Vite loads this config from the project root, so process.cwd() is that root.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(process.cwd(), './src'),
    },
  },
  server: {
    port: 5173,
  },
});
