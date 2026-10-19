import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages: festgelegter Repository-Unterpfad.
// Absichtlich ohne process.env, damit der TypeScript-Build keine Node-Typen benötigt.
export default defineConfig({
  base: '/Provisionsrechner/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
});
