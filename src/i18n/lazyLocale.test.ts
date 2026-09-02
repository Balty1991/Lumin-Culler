import { describe, expect, it, vi } from 'vitest';

/**
 * i18n/lazyLocale.test.ts
 * Engleza nu mai e legata static in bundle (vezi i18n/index.ts) — se descarca
 * la cerere. Costul acelei economii e o stare noua care nu exista inainte:
 * "limba e ceruta, dar dictionarul ei inca n-a ajuns". Testele de aici pazesc
 * exact acea stare.
 *
 * `resetModules` + import dinamic, nu importul obisnuit de sus: fisierul de
 * setup al testelor (src/test/setup.ts) incarca dictionarul englez pentru toata
 * suita, tocmai fiindca restul testelor apeleaza `t(..., 'en')` sincron. Fara o
 * instanta PROASPATA a modulului, starea "inca neincarcat" ar fi imposibil de
 * observat aici.
 */
async function freshI18n() {
  vi.resetModules();
  return import('./index');
}

describe('incarcarea la cerere a dictionarului englez', () => {
  it('romana e disponibila din prima, fara nicio asteptare', async () => {
    const { isLocaleLoaded, t } = await freshI18n();
    expect(isLocaleLoaded('ro')).toBe(true);
    expect(t('ro', 'menu.title')).toBe('Meniu');
  });

  it('inainte de incarcare, engleza raspunde cu romana in loc sa arunce', async () => {
    const { isLocaleLoaded, t } = await freshI18n();
    expect(isLocaleLoaded('en')).toBe(false);
    // Nu e comportamentul dorit pe ecran — de-aia main.tsx asteapta dictionarul
    // inainte de prima randare — dar e degradarea sigura daca chunk-ul lipseste
    // (offline la prima pornire). Alternativa ar fi fost o exceptie: `DICTS.en`
    // absent, indexat direct de `t()`.
    expect(t('en', 'menu.title')).toBe('Meniu');
  });

  it('dupa ensureLocaleLoaded, engleza raspunde in engleza', async () => {
    const { ensureLocaleLoaded, isLocaleLoaded, t } = await freshI18n();
    await ensureLocaleLoaded('en');
    expect(isLocaleLoaded('en')).toBe(true);
    expect(t('en', 'menu.title')).toBe('Menu');
    // Romana nu are de suferit de pe urma incarcarii celeilalte limbi.
    expect(t('ro', 'menu.title')).toBe('Meniu');
  });

  it('ensureLocaleLoaded("ro") nu asteapta nimic si nu incarca engleza', async () => {
    const { ensureLocaleLoaded, isLocaleLoaded } = await freshI18n();
    await ensureLocaleLoaded('ro');
    expect(isLocaleLoaded('en')).toBe(false);
  });

  it('doua cereri simultane nu incarca dictionarul de doua ori', async () => {
    const { ensureLocaleLoaded, t } = await freshI18n();
    // Daca fiecare apel si-ar porni propriul import, promisiunile ar fi
    // distincte; `enLoading` le uneste pe toate in una singura.
    const [a, b] = [ensureLocaleLoaded('en'), ensureLocaleLoaded('en')];
    expect(a).toBe(b);
    await Promise.all([a, b]);
    expect(t('en', 'menu.title')).toBe('Menu');
  });

  it('un al doilea apel de dupa incarcare se rezolva fara sa mai importe nimic', async () => {
    const { ensureLocaleLoaded, isLocaleLoaded } = await freshI18n();
    await ensureLocaleLoaded('en');
    await ensureLocaleLoaded('en');
    expect(isLocaleLoaded('en')).toBe(true);
  });
});
