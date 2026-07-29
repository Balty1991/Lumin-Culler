import { describe, expect, it } from 'vitest';
import { useStore, type PhotoView } from './store';

function makePhoto(i: number): PhotoView {
  return {
    id: `p${i}`,
    fileName: `IMG_${i}.jpg`,
    importedAt: i,
    status: i % 5 === 0 ? 'selected' : i % 5 === 1 ? 'rejected' : 'review',
    rating: i % 5,
    aiScore: (i * 37) % 100,
    sceneType: 'portrait',
    contextKey: 'portrait:known',
    faceCount: 1,
    knownFaceCount: 1,
    strangerCount: 0,
    bestSmile: 0.5,
    allEyesOpen: true,
    sharpness: 80,
    exposure: 50,
    ruleOfThirds: 0.5,
    headroom: 0.5,
    personNames: []
  } as unknown as PhotoView;
}

/**
 * filtered() e memoizat (vezi filteredCache in store.ts) — fara asta, orice
 * schimbare de stare, chiar fara legatura cu filtrarea (ex. o litera tastata
 * in campul de watermark), forta un recalcul integral al filtrarii/sortarii
 * pe toata biblioteca, o data per componenta montata care cheama
 * useStore(s => s.filtered()) (App.tsx, Workspace.tsx, ContactSheet.tsx,
 * PresentationMode.tsx). Testele astea verifica DOAR corectitudinea cache-ului
 * (aceeasi referinta cand nimic relevant nu s-a schimbat, referinta noua cand
 * s-a schimbat) — nu si viteza (un prag de timp ar fi fragil/instabil in CI).
 */
describe('filtered() memoization', () => {
  it('returns the same array reference across repeated calls when nothing relevant changed', () => {
    const photos = Array.from({ length: 50 }, (_, i) => makePhoto(i));
    useStore.setState({ photos });

    const first = useStore.getState().filtered();
    const second = useStore.getState().filtered();
    expect(second).toBe(first);
  });

  it('keeps the cached reference across an UNRELATED state change (e.g. typing in an unrelated field)', () => {
    const photos = Array.from({ length: 50 }, (_, i) => makePhoto(i));
    useStore.setState({ photos });
    const first = useStore.getState().filtered();

    useStore.setState({ watermarkText: 'Studio X' });
    const second = useStore.getState().filtered();
    expect(second).toBe(first);
  });

  it('recomputes (new reference) when a filter-relevant field actually changes', () => {
    const photos = Array.from({ length: 50 }, (_, i) => makePhoto(i));
    useStore.setState({ photos, minRating: 0 });
    const first = useStore.getState().filtered();

    useStore.setState({ minRating: 3 });
    const second = useStore.getState().filtered();
    expect(second).not.toBe(first);
  });

  it('recomputes when the photos array itself is replaced (a real photo mutation)', () => {
    const photos = Array.from({ length: 50 }, (_, i) => makePhoto(i));
    useStore.setState({ photos });
    const first = useStore.getState().filtered();

    useStore.setState({ photos: [...photos] });
    const second = useStore.getState().filtered();
    expect(second).not.toBe(first);
    expect(second).toEqual(first); // continut identic, doar referinta difera
  });
});
