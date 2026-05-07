import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        plan: resolve(__dirname, 'plan.html'),
        notes: resolve(__dirname, 'notes.html'),
      },
    },
  },
});
