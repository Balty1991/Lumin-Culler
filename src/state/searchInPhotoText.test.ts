import { describe, expect, it } from 'vitest';
import { matchesSearch, type PhotoView } from './store';
import { normalizeForSearch } from '../core/sceneTagLabels';

/**
 * state/searchInPhotoText.test.ts
 * Cautarea in TEXTUL din poze.
 *
 * Aplicatia rula deja OCR pe telefon, dar din tot ce citea folosea o singura
 * cifra — cat la suta din cadru e acoperit de text — si arunca cuvintele.
 * Cuvintele alea sunt insa exact ce face pozele acelea gasibile: nimeni nu-si
 * aminteste ca a fotografiat "un dreptunghi alb pe 12 iulie", isi aminteste ca
 * are pe undeva bonul de la service sau parola de wifi de la cabana.
 *
 * Ce se pazeste aici e ca textul chiar INTRA in cautare — pe toate caile ei
 * (potrivire directa si interogare de mai multe cuvinte) — fiindca un camp
 * salvat degeaba n-ar da nicio eroare nicaieri.
 */
function poza(over: Partial<PhotoView>): PhotoView {
  return {
    id: '1', fileName: 'IMG_0042.jpg', personNames: [], status: 'review', aiScore: 50,
    ...over
  } as PhotoView;
}

const cauta = (p: PhotoView, q: string) => matchesSearch(p, normalizeForSearch(q), 'ro');

describe('textul din poza e cautabil', () => {
  const bon = poza({ ocrText: 'Bon fiscal SERVICE AUTO SRL total 349,50 lei garantie 12 luni' });

  it('un cuvant care apare doar in poza, nicaieri altundeva', () => {
    expect(cauta(bon, 'garantie')).toBe(true);
  });

  it('fara diacritice, cum tasteaza lumea', () => {
    const chitanta = poza({ ocrText: 'Chitanță pentru grădiniță, luna septembrie' });
    expect(cauta(chitanta, 'gradinita')).toBe(true);
  });

  it('o interogare de doua cuvinte cere ca AMANDOUA sa apara', () => {
    expect(cauta(bon, 'service auto')).toBe(true);
    expect(cauta(bon, 'service pisica')).toBe(false);
  });

  it('un cuvant care nu apare nicaieri nu inventeaza o potrivire', () => {
    expect(cauta(bon, 'bicicleta')).toBe(false);
  });

  it('o poza fara text citit se comporta exact ca inainte', () => {
    expect(cauta(poza({}), 'garantie')).toBe(false);
    expect(cauta(poza({ fileName: 'garantie.jpg' }), 'garantie')).toBe(true);
  });
});
