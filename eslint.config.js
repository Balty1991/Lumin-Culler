// eslint.config.js
// Configuratie minima (flat config, ESLint 9) — pana acum proiectul avea
// comentarii `eslint-disable-next-line react-hooks/exhaustive-deps` in 6
// fisiere (PresentationMode/BackupReminder/ImportReminder/Workspace/
// EditPanel/App), dar niciun linter nu rula de fapt: acele comentarii nu
// faceau nimic. Scop deliberat restrans la `src/` (web/Capacitor, partea
// activ dezvoltata) — electron/, mobile-rn/, src-tauri/, android/ raman
// neatinse, nu sunt tinta acestui audit.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'electron/**', 'mobile-rn/**', 'src-tauri/**', 'android/**', 'vendor/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.worker }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TS deja marcheaza variabile/parametri nefolositi cu strict:true la
      // compilare (desi noUnusedLocals/noUnusedParameters sunt false in
      // tsconfig) — regula ESLint ramane utila mai ales pentru importuri
      // nefolosite, dar un parametru prefixat cu "_" (conventie comuna
      // pentru "intentionat neutilizat") nu trebuie semnalat.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  }
);
