import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  /**
   * `__BUILD_ID__` vine din `define` in vite.config.ts, iar fisierul asta e o
   * configuratie SEPARATA — deci sub vitest simbolul nu exista, si orice
   * componenta care il citeste arunca ReferenceError la randare.
   *
   * Valoare fixa, nu sha-ul real: testele n-au nevoie de versiunea adevarata,
   * au nevoie ca simbolul sa existe. Ca eticheta chiar ajunge in build-ul de
   * productie e verificat separat, citind vite.config.ts — vezi
   * src/buildId.test.ts.
   */
  define: { __BUILD_ID__: JSON.stringify('0000-00-00·test') },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts']
  }
});
