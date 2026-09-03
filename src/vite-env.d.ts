/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/**
 * Eticheta build-ului (data · sha scurt), injectata de Vite — vezi buildId()
 * din vite.config.ts. Exista mereu: cand nu se poate afla sha-ul, ramane doar
 * data, deci codul care o afiseaza n-are un caz "lipseste" de tratat.
 */
declare const __BUILD_ID__: string;
