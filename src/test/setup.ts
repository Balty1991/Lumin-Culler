import '@testing-library/jest-dom/vitest';
import { ensureLocaleLoaded } from '../i18n';

/**
 * Dictionarul englez se incarca la cerere in aplicatie (vezi i18n/index.ts), ca
 * sa nu mai stea in bundle-ul principal la fiecare pornire. In productie asta e
 * asteptat inainte de prima randare (main.tsx) si inainte de comutarea limbii
 * (store.setLocale); testele insa apeleaza `t(..., 'en')` direct si sincron, ca
 * pe o functie pura — fara pasul asta ar primi romana si ar cadea, desi codul
 * verificat de ele n-are nimic.
 *
 * `await` la nivel de modul: vitest asteapta fisierul de setup, deci
 * dictionarul e garantat prezent inainte de primul test.
 */
await ensureLocaleLoaded('en');
