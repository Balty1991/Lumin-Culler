import '@testing-library/jest-dom/vitest';
import { ensureLocaleLoaded } from '../i18n';

/**
 * "Telefonul" pe care ruleaza testele vorbeste romana.
 *
 * De cand aplicatia urmeaza limba dispozitivului cand utilizatorul n-a ales una
 * (vezi i18n/index.ts:deviceLocale), limba implicita nu mai e fixa. jsdom
 * raporteaza `en-US`, deci zeci de teste scrise cu texte romanesti au inceput
 * sa primeasca engleza — nu fiindca s-ar fi stricat ceva, ci fiindca premisa
 * lor tacuta ("aplicatia porneste in romana") a devenit o presupunere despre
 * mediu.
 *
 * O fixam aici, o data, in loc s-o repetam in fiecare test: premisa devine
 * explicita, iar testele care chiar verifica alegerea limbii isi pun singure
 * alta valoare peste asta (vezi i18n/index.test.ts).
 */
Object.defineProperty(navigator, 'languages', { value: ['ro-RO'], configurable: true });

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
