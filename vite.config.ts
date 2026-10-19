import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages veröffentlicht diese Anwendung unter dem Repository-Unterpfad.
// Der Wert ist bewusst fest gesetzt, damit TypeScript kein Node-"process" benötigt.
export default defineConfig({
  base: '/Provisionsrechner/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
});
