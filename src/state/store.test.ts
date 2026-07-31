import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

// importFiles face analiza AI reala (workeri, modele TFJS) — inutil si lent
// intr-un test unitar. Il mock-uim CONTROLABIL (o promisiune care nu se
// rezolva decat cand testul o cere explicit), ca sa putem verifica exact
// comportamentul lui runImport CAT TIMP un import e "in curs", fara sa
// asteptam un import real. Restul exporturilor din modul raman reale.
let resolveImportFiles: (() => void) | null = null;
const importFilesMock = vi.fn((..._args: unknown[]) => new Promise<void>(resolve => { resolveImportFiles = resolve; }));
vi.mock('../core/importPipeline', async importOriginal => {
  const actual = await importOriginal<typeof import('../core/importPipeline')>();
  return { ...actual, importFiles: (...args: unknown[]) => importFilesMock(...args) };
});

import { useStore, relabelFaces, selectMergedEmbeddings, type PhotoView } from './store';
import type { AnalysisRecord, FaceInsight } from '../core/db';

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

// Bug real gasit de auditul QA: un al doilea runImport() pornit inainte ca
// primul sa se termine suprascria activeCancelToken (modul-level, in afara
// starii Zustand) — "Anuleaza" nu mai putea opri decat importul cel mai
// recent, iar `progress` (o singura bara) sarea imprevizibil intre done/
// total-ul celor doua importuri nelegate.
describe('runImport concurrency guard', () => {
  it('refuses to start a second import while one is already in progress', async () => {
    importFilesMock.mockClear();
    useStore.setState({ progress: null, notice: '' });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });

    const firstImport = useStore.getState().runImport([file]);
    expect(useStore.getState().progress).not.toBeNull(); // primul a pornit real

    const secondImport = useStore.getState().runImport([file]);
    await secondImport; // al doilea trebuie sa se rezolve IMEDIAT (respins), nu sa astepte primul
    expect(importFilesMock).toHaveBeenCalledTimes(1); // NU a pornit un al doilea import real
    expect(useStore.getState().notice).toBe('Un import e deja in curs — asteapta sa se termine inainte sa mai adaugi poze.');

    resolveImportFiles?.(); // lasam primul import sa se termine, ca testul sa nu ramana agatat
    await firstImport;
  });
});

// Bug real gasit de auditul QA: GroupCompare (ca DetailView) nu e montat cat
// timp Workspace e activ, dar spre deosebire de detailId, compareGroupId nu
// era niciodata resetat la intoarcerea in grila — o comparare de serie
// deschisa inainte de a intra in Workspace reaparea neasteptat la revenire.
describe('setWorkspaceMode', () => {
  it('clears a stale compareGroupId when returning to the grid, so GroupCompare does not reopen unexpectedly', () => {
    useStore.setState({ compareGroupId: 'g1', workspaceMode: false });
    useStore.getState().setWorkspaceMode(true);
    expect(useStore.getState().compareGroupId).toBe('g1'); // pastrat cat timp Workspace e activ (GroupCompare nu e randat oricum)

    useStore.getState().setWorkspaceMode(false);
    expect(useStore.getState().compareGroupId).toBeNull();
  });

  it('leaves compareGroupId untouched when it was already null', () => {
    useStore.setState({ compareGroupId: null, workspaceMode: false });
    useStore.getState().setWorkspaceMode(true);
    useStore.getState().setWorkspaceMode(false);
    expect(useStore.getState().compareGroupId).toBeNull();
  });
});

function makeFace(personId: string | null, personName: string | null): FaceInsight {
  return {
    box: [0, 0, 0.1, 0.1], faceScore: 0.9, smile: 0.5,
    eyesOpen: { left: 1, right: 1 }, isBlinking: false,
    personId, personName, similarity: personId ? 0.8 : 0
  };
}

function makeAnalysis(faces: FaceInsight[]): AnalysisRecord {
  return {
    photoId: 'p1', faces, faceCount: faces.length,
    knownFaceCount: faces.filter(f => f.personId).length,
    strangerCount: faces.filter(f => !f.personId).length,
    bestSmile: 0.5, allEyesOpen: true, sharpness: 80, exposure: 50,
    sceneType: 'portrait', aiScore: 50, analyzedAt: 0
  };
}

// Bug real gasit de auditul QA: removePerson/removePersons/mergePersons nu
// atingeau AnalysisRecord.faces[i].personId/personName deloc — pozele deja
// analizate ramaneau cu identificarea veche (persoana stearsa, sau profilul
// fragmentat dinainte de unire). relabelFaces e logica RETROACTIVA extrasa
// din relabelAnalyses (care atinge Dexie), testabila fara IndexedDB reala.
describe('relabelFaces', () => {
  it('clears personId/personName for a face whose person was deleted (mapped to null)', () => {
    const analysis = makeAnalysis([makeFace('person-a', 'Ami'), makeFace(null, null)]);
    const changed = relabelFaces(analysis, new Map([['person-a', null]]));
    expect(changed).toBe(true);
    expect(analysis.faces[0].personId).toBeNull();
    expect(analysis.faces[0].personName).toBeNull();
    expect(analysis.knownFaceCount).toBe(0);
    expect(analysis.strangerCount).toBe(2);
  });

  it('relabels a face to the merged identity when its old person was absorbed into another', () => {
    const analysis = makeAnalysis([makeFace('old-id', 'Ami (dublura)')]);
    const changed = relabelFaces(analysis, new Map([['old-id', { id: 'survivor-id', name: 'Ami' }]]));
    expect(changed).toBe(true);
    expect(analysis.faces[0].personId).toBe('survivor-id');
    expect(analysis.faces[0].personName).toBe('Ami');
    expect(analysis.knownFaceCount).toBe(1);
    expect(analysis.strangerCount).toBe(0);
  });

  it('leaves faces untouched (and reports no change) when no face matches the mapping', () => {
    const analysis = makeAnalysis([makeFace('unrelated-person', 'Cineva Altcineva')]);
    const before = JSON.parse(JSON.stringify(analysis.faces));
    const changed = relabelFaces(analysis, new Map([['person-a', null]]));
    expect(changed).toBe(false);
    expect(analysis.faces).toEqual(before);
  });

  it('never touches strangers (personId already null)', () => {
    const analysis = makeAnalysis([makeFace(null, null)]);
    const changed = relabelFaces(analysis, new Map([['person-a', null]]));
    expect(changed).toBe(false);
  });
});

// Bug real gasit de auditul QA: un tail-slice simplu pe concatenare putea
// sterge 100% din referintele unui profil la unire (ambele deja aproape de
// plafon) — comentariul vechi pretindea "cele mai recente", dar
// KnownPerson.embeddings n-are timestamp per-element, deci acea garantie era
// falsa. selectMergedEmbeddings garanteaza un plafon egal per profil.
describe('selectMergedEmbeddings', () => {
  it('keeps a fair, non-zero share from every profile even when both are already near the cap', () => {
    const profileA = Array.from({ length: 12 }, (_, i) => [i]);
    const profileB = Array.from({ length: 12 }, (_, i) => [100 + i]);
    const merged = selectMergedEmbeddings([profileA, profileB], 12);
    expect(merged.length).toBeLessThanOrEqual(12);
    expect(merged.some(e => e[0] < 100)).toBe(true);  // profileA a supravietuit partial
    expect(merged.some(e => e[0] >= 100)).toBe(true); // profileB la fel
  });

  it('keeps the most recent (tail) entries of each profile, not the oldest', () => {
    const profileA = [[1], [2], [3], [4]];
    const profileB = [[10], [20], [30], [40]];
    const merged = selectMergedEmbeddings([profileA, profileB], 4);
    // plafon per profil = floor(4/2) = 2 -> ultimele 2 din fiecare
    expect(merged).toEqual([[3], [4], [30], [40]]);
  });

  it('never exceeds maxTotal even with many small profiles', () => {
    const profiles = Array.from({ length: 6 }, (_, i) => [[i]]);
    const merged = selectMergedEmbeddings(profiles, 5);
    expect(merged.length).toBeLessThanOrEqual(5);
  });

  it('returns everything when profiles are smaller than their fair share', () => {
    const profileA = [[1]];
    const profileB = [[2], [3]];
    const merged = selectMergedEmbeddings([profileA, profileB], 12);
    expect(merged).toEqual([[1], [2], [3]]);
  });
});

// Bug real gasit de auditul QA: badge-urile de numar din randul de filtre
// (App.tsx, `counts`) se calculau din TOATA biblioteca, ignorand orice
// filtru secundar activ (persoana/eticheta/scena/camera/proiect/cautare/
// data/rating) — pastila "Selectate" arata mereu numarul pe toata
// biblioteca, chiar si cu (de ex.) un filtru de persoana activ care ar
// arata mult mai putine.
describe('secondaryFiltered', () => {
  it('applies the person filter, unlike raw photos', () => {
    const photos = [
      { ...makePhoto(0), personNames: ['Ami'] },
      { ...makePhoto(5), personNames: ['Ami'] },
      { ...makePhoto(1), personNames: ['Sotia'] }
    ];
    useStore.setState({ photos, personFilter: 'Ami', colorLabelFilter: null, sceneTagFilter: null, cameraFilter: null, projectFilter: null, searchText: '', dateFrom: null, dateTo: null, minRating: 0 });
    const result = useStore.getState().secondaryFiltered();
    expect(result.map(p => p.id).sort()).toEqual(['p0', 'p5']);
  });

  it('ignores the primary status/blinks/goldenHour axis entirely (that is what counts sums over)', () => {
    const photos = Array.from({ length: 10 }, (_, i) => makePhoto(i));
    useStore.setState({ photos, filter: 'selected', personFilter: null, colorLabelFilter: null, sceneTagFilter: null, cameraFilter: null, projectFilter: null, searchText: '', dateFrom: null, dateTo: null, minRating: 0 });
    const result = useStore.getState().secondaryFiltered();
    expect(result).toHaveLength(10); // toate, indiferent de `filter` (spre deosebire de filtered())
  });

  it('combines multiple secondary filters (AND), matching filtered()', () => {
    const photos = [
      { ...makePhoto(0), personNames: ['Ami'], rating: 5 },
      { ...makePhoto(5), personNames: ['Ami'], rating: 1 }
    ];
    useStore.setState({ photos, personFilter: 'Ami', minRating: 3, colorLabelFilter: null, sceneTagFilter: null, cameraFilter: null, projectFilter: null, searchText: '', dateFrom: null, dateTo: null });
    const result = useStore.getState().secondaryFiltered();
    expect(result.map(p => p.id)).toEqual(['p0']);
  });

  it('is memoized: returns the same reference when nothing relevant changed', () => {
    const photos = Array.from({ length: 5 }, (_, i) => makePhoto(i));
    useStore.setState({ photos, personFilter: null, colorLabelFilter: null, sceneTagFilter: null, cameraFilter: null, projectFilter: null, searchText: '', dateFrom: null, dateTo: null, minRating: 0 });
    const first = useStore.getState().secondaryFiltered();
    useStore.setState({ notice: 'unrelated change' });
    const second = useStore.getState().secondaryFiltered();
    expect(second).toBe(first);
  });
});
