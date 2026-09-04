import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * ui/ImportReminder.test.tsx
 *
 * Memento-ul e singurul loc din aplicatie care vorbeste NECHEMAT. De-aia ce se
 * pazeste aici nu e ca apare cifra, ci ca NU apare cand n-are dreptul: o cifra
 * gresita spusa cu incredere e mai rea decat niciuna — omul deschide, gaseste
 * altceva, si nu mai crede nici data viitoare.
 */
const getPhotosAccess = vi.fn(async () => 'full' as string);
const countGalleryPhotosSince = vi.fn(async (_since: number) => ({ granted: true, count: 312 }));
const isNativeMediaLibraryAvailable = vi.fn(() => true);
vi.mock('../core/nativeMediaLibrary', () => ({
  getPhotosAccess: () => getPhotosAccess(),
  countGalleryPhotosSince: (since: number) => countGalleryPhotosSince(since),
  isNativeMediaLibraryAvailable: () => isNativeMediaLibraryAvailable()
}));

const { ImportReminder } = await import('./ImportReminder');
const { useStore } = await import('../state/store');
const { writeGalleryWatermark } = await import('../state/galleryWatermark');
const { IMPORT_REMINDER_INTERVAL_MS } = await import('../state/importReminder');

/** O poza importata destul de demult cat memento-ul sa fie indreptatit sa apara. */
function pozaVeche() {
  return { id: '1', importedAt: Date.now() - IMPORT_REMINDER_INTERVAL_MS - 1000, status: 'review', aiScore: 50 };
}

beforeEach(() => {
  localStorage.clear();
  getPhotosAccess.mockClear();
  countGalleryPhotosSince.mockClear();
  isNativeMediaLibraryAvailable.mockClear();
  getPhotosAccess.mockResolvedValue('full');
  countGalleryPhotosSince.mockResolvedValue({ granted: true, count: 312 });
  isNativeMediaLibraryAvailable.mockReturnValue(true);
  useStore.setState({ locale: 'ro', photos: [pozaVeche()] as any });
});

describe('cand chiar stim cate poze noi sunt', () => {
  it('spune cifra, nu "a trecut ceva vreme"', async () => {
    writeGalleryWatermark(1000);
    render(<ImportReminder onAddPhotos={() => {}} />);
    expect(await screen.findByText(/312 poze noi/)).toBeInTheDocument();
  });

  it('pune particula "de" unde o cere romana, si n-o pune unde nu', async () => {
    // 312 se termina in 12 -> "312 poze"; 40 se termina in 40 -> "40 DE poze".
    // Verificat aici fiindca sirul foloseste {countDe}, care CONTINE deja
    // numarul: scris gresit ca "{count} {countDe}" ar fi randat "40 40 de".
    writeGalleryWatermark(1000);
    countGalleryPhotosSince.mockResolvedValue({ granted: true, count: 40 });
    render(<ImportReminder onAddPhotos={() => {}} />);
    expect(await screen.findByText(/40 de poze noi/)).toBeInTheDocument();
  });

  it('intreaba de la SEMNUL DE CARTE, nu de la o data inventata', async () => {
    writeGalleryWatermark(1_700_000_000_000);
    render(<ImportReminder onAddPhotos={() => {}} />);
    await waitFor(() => expect(countGalleryPhotosSince).toHaveBeenCalledWith(1_700_000_000_000));
  });
});

describe('cand NU avem dreptul la cifra, ramane exact mesajul de dinainte', () => {
  it('fara semn de carte (prima folosire) — nici nu intreaba galeria', async () => {
    render(<ImportReminder onAddPhotos={() => {}} />);
    expect(screen.getByText(/N-ai mai importat poze/)).toBeInTheDocument();
    await waitFor(() => expect(countGalleryPhotosSince).not.toHaveBeenCalled());
  });

  it('cu acces LIMITAT, MediaStore arata doar pozele bifate atunci — cifra ar minti', async () => {
    writeGalleryWatermark(1000);
    getPhotosAccess.mockResolvedValue('limited');
    render(<ImportReminder onAddPhotos={() => {}} />);
    await waitFor(() => expect(getPhotosAccess).toHaveBeenCalled());
    expect(countGalleryPhotosSince).not.toHaveBeenCalled();
    expect(screen.getByText(/N-ai mai importat poze/)).toBeInTheDocument();
  });

  it('prea putine poze noi — "ai 3 poze noi" nu e un motiv sa deschizi nimic', async () => {
    writeGalleryWatermark(1000);
    countGalleryPhotosSince.mockResolvedValue({ granted: true, count: 3 });
    render(<ImportReminder onAddPhotos={() => {}} />);
    await waitFor(() => expect(countGalleryPhotosSince).toHaveBeenCalled());
    expect(screen.getByText(/N-ai mai importat poze/)).toBeInTheDocument();
  });

  it('interogarea esueaza — memento-ul nu are voie sa arunce', async () => {
    writeGalleryWatermark(1000);
    countGalleryPhotosSince.mockRejectedValue(new Error('MediaStore indisponibil'));
    render(<ImportReminder onAddPhotos={() => {}} />);
    await waitFor(() => expect(countGalleryPhotosSince).toHaveBeenCalled());
    expect(screen.getByText(/N-ai mai importat poze/)).toBeInTheDocument();
  });

  it('pe web (fara plugin nativ) nu se intreaba nimic', async () => {
    writeGalleryWatermark(1000);
    isNativeMediaLibraryAvailable.mockReturnValue(false);
    render(<ImportReminder onAddPhotos={() => {}} />);
    expect(screen.getByText(/N-ai mai importat poze/)).toBeInTheDocument();
    await waitFor(() => expect(getPhotosAccess).not.toHaveBeenCalled());
  });
});

describe('memento-ul tace cand nu e momentul', () => {
  it('un import recent il tine complet ascuns', () => {
      useStore.setState({ photos: [{ ...pozaVeche(), importedAt: Date.now() }] as any });
    writeGalleryWatermark(1000);
    const { container } = render(<ImportReminder onAddPhotos={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
