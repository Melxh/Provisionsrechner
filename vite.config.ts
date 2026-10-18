import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages liefert die Seite unter /<Repository-Name>/ aus.
// Der Workflow setzt VITE_BASE_PATH automatisch aus dem Repository-Namen.
const base = process.env.VITE_BASE_PATH || '/Provisionsrechner/';

export default defineConfig({
  base,
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
});
