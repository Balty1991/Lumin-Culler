// Miniaturile randurilor de fisier se cer din Dexie — fara asta, promisiunea
// respinsa iese ca eroare neprinsa in raportul de teste.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExportDestinations } from './ExportDestinations';
import { useStore, type PhotoView } from '../state/store';
import * as entitlement from '../core/entitlement';
import { vi } from 'vitest';

/**
 * ui/ExportDestinations.test.tsx
 * "Export" e unul dintre cele patru taburi permanente din bara de jos, deci se
 * deschide si de catre cineva care n-a triat inca nimic. Auditul de dinaintea
 * lansarii l-a gasit ca fundatura: trei comutatoare peste "0 poze" si un buton
 * stins, fara sa spuna nicaieri de unde vine o selectie.
 */
function photo(id: string, status: PhotoView['status']): PhotoView {
  return { id, fileName: id + '.jpg', importedAt: 0, status, aiDecided: false, rating: 0, aiScore: 50 } as PhotoView;
}

function open(photos: PhotoView[]) {
  useStore.setState({ locale: 'ro', exportDestinationsOpen: true, photos, exportProgress: null, tiktokSortOpen: false });
  render(<ExportDestinations />);
}

describe('ExportDestinations — foaia deschisa fara selectie', () => {
  beforeEach(() => {
    useStore.setState({ collections: [], premiumLocked: true, photosUsedThisWindow: 0 });
  });

  it('spune ce e exportul si scoate omul spre triaj, in loc sa arate comutatoare moarte', () => {
    open([photo('a', 'pending'), photo('b', 'review')]);

    expect(screen.getByText(/Nimic de trimis încă/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Treci prin cele 2 poze rămase/ })).toBeInTheDocument();
    // Comutatoarele n-au ce comuta cat timp nu exista nicio decizie.
    expect(screen.queryByText('Etichete Lightroom (.xmp)')).not.toBeInTheDocument();
  });

  it('butonul de triaj deschide sortarea rapida pe pozele nedecise', () => {
    open([photo('a', 'pending'), photo('b', 'review')]);
    fireEvent.click(screen.getByRole('button', { name: /Treci prin cele 2 poze rămase/ }));

    expect(useStore.getState().tiktokSortOpen).toBe(true);
    expect(useStore.getState().tiktokSortScopeIds).toEqual(['a', 'b']);
    expect(useStore.getState().exportDestinationsOpen).toBe(false);
  });

  /**
   * Sidecar-urile .xmp se scriu pentru tot ce e DECIS, nu pentru selectie (vezi
   * exportXMP in state/store.ts). Un fotograf care tocmai a respins tot lotul
   * are ce exporta chiar daca n-a pastrat nimic — butonul era stins pentru el.
   */
  it('cu poze respinse dar niciuna pastrata, exportul de etichete ramane posibil', () => {
    open([photo('a', 'rejected'), photo('b', 'rejected')]);

    expect(screen.getByText(/Nicio poză păstrată/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Trimite|Export/i })).not.toBeDisabled();
  });

  /**
   * Pana la runda asta, apasarea pornea exportul de fisiere SI deschidea panoul
   * de plata pentru .xmp — peste o bara de progres deja in miscare. Poarta se
   * verifica acum inainte sa porneasca ceva, iar comutatorul poarta lacatul.
   */
  it('cu Lightroom bifat si Premium blocat, exportul nu porneste — se deschide poarta', () => {
    // Poarta reala citeste entitlement.ts, nu oglinda din store: pe web, fara
    // billing, isPremiumFeatureLocked() e fals si totul e deschis (vezi
    // comentariul din core/entitlement.ts). Aici o punem pe blocat.
    vi.spyOn(entitlement, 'isPremiumFeatureLocked').mockReturnValue(true);
    open([photo('a', 'selected')]);

    expect(screen.getByText('Premium')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Trimite|Export/i }));

    expect(useStore.getState().premiumOpen).toBe(true);
    expect(useStore.getState().premiumReason).toBe('xmp');
    expect(useStore.getState().exportProgress).toBeNull();
  });

  it('cu o selectie reala, foaia arata fisierele si nu mai arata golul', () => {
    open([photo('a', 'selected'), photo('b', 'pending')]);

    expect(screen.queryByText(/Nimic de trimis încă/)).not.toBeInTheDocument();
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
  });
});
