
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages: Repository-Unterpfad
export default defineConfig({
  base: '/Provisionsrechner/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
});
