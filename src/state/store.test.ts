import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

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

// Doar exportOriginalFiles e mock-uit (restul modulului ramane real): testele de
// mai jos verifica ce face STORE-ul cu rezultatul exportului (in special ce ramane
// pe ecran), nu cum ajung bytes-ii pe disc — acoperit separat in exportPhotos.test.ts.
type ExportResult = Awaited<ReturnType<typeof import('../core/exportPhotos').exportOriginalFiles>>;
const exportOriginalFilesMock = vi.fn<(...args: unknown[]) => Promise<ExportResult>>();
vi.mock('../core/exportPhotos', async importOriginal => {
  const actual = await importOriginal<typeof import('../core/exportPhotos')>();
  return { ...actual, exportOriginalFiles: (...args: unknown[]) => exportOriginalFilesMock(...args) };
});

import { ratingDecision, useStore, relabelFaces, matchFacesToPerson, selectMergedEmbeddings, type PhotoView } from './store';
import { db, type AnalysisRecord, type FaceInsight, type KnownPerson, type PhotoRecord } from '../core/db';
import { contextEngine } from '../core/learning/ContextEngine';
import { originalFiles } from '../core/importPipeline';
import { readSavedFilters } from './savedFilters';
import { t } from '../i18n';

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

// Cerinta directa a utilizatorului: badge-ul "Best of series" pe thumbnail —
// PhotoCard nu are acces la restul bibliotecii, deci calculul cross-poze
// trebuie facut central si memoizat (acelasi tipar ca filteredCache).
describe('bestInGroupIds()', () => {
  it('alege membrul cu claritate/expunere/compozitie mai buna dintr-un grup de 2+', () => {
    const sharp = { ...makePhoto(0), id: 'a', groupId: 'g1', sharpness: 90, exposure: 50 } as PhotoView;
    const blurry = { ...makePhoto(0), id: 'b', groupId: 'g1', sharpness: 30, exposure: 50 } as PhotoView;
    useStore.setState({ photos: [sharp, blurry] });

    const ids = useStore.getState().bestInGroupIds();

    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(false);
  });

  it('exclude pozele fara groupId, si grupurile de UN singur membru (nimic de comparat)', () => {
    const solo = { ...makePhoto(0), id: 'a', groupId: undefined } as PhotoView;
    const soloGroup = { ...makePhoto(0), id: 'b', groupId: 'g-solo' } as PhotoView;
    useStore.setState({ photos: [solo, soloGroup] });

    const ids = useStore.getState().bestInGroupIds();

    expect(ids.size).toBe(0);
  });

  it('returneaza acelasi Set (referinta) cat timp photos nu s-a schimbat', () => {
    const a = { ...makePhoto(0), id: 'a', groupId: 'g1', sharpness: 90 } as PhotoView;
    const b = { ...makePhoto(0), id: 'b', groupId: 'g1', sharpness: 30 } as PhotoView;
    useStore.setState({ photos: [a, b] });

    const first = useStore.getState().bestInGroupIds();
    const second = useStore.getState().bestInGroupIds();
    expect(second).toBe(first);

    useStore.setState({ watermarkText: 'schimbare neconexa' });
    const third = useStore.getState().bestInGroupIds();
    expect(third).toBe(first);
  });

  it('recalculeaza cand array-ul photos e inlocuit efectiv', () => {
    const a = { ...makePhoto(0), id: 'a', groupId: 'g1', sharpness: 90 } as PhotoView;
    const b = { ...makePhoto(0), id: 'b', groupId: 'g1', sharpness: 30 } as PhotoView;
    useStore.setState({ photos: [a, b] });
    const first = useStore.getState().bestInGroupIds();

    useStore.setState({ photos: [{ ...a }, { ...b }] });
    const second = useStore.getState().bestInGroupIds();

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
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
    expect(useStore.getState().notice).toBe('Un import e deja în curs — așteaptă să se termine înainte să mai adaugi poze.');

    resolveImportFiles?.(); // lasam primul import sa se termine, ca testul sa nu ramana agatat
    await firstImport;
  });
});

// Bug real gasit de auditul QA (raportat de utilizator: "abia incarca poze" la
// 500+ poze): onPhoto ruleaza per-poza, iar un set() per poza reconstruia
// intreg array-ul `photos` de fiecare data — cost cumulat aproape patratic.
// Testele astea verifica direct comportamentul de bufferizare/loturi, nu doar
// rezultatul final (deja acoperit indirect de alte teste).
describe('runImport photo batching', () => {
  function importedPhoto(i: number): { photo: PhotoRecord; analysis: AnalysisRecord } {
    return {
      photo: {
        id: `batch-${i}`, fileName: `IMG_${i}.jpg`, importedAt: i, width: 100, height: 100,
        dHash: '0'.repeat(64), status: 'review', groupId: ''
      },
      analysis: {
        photoId: `batch-${i}`, faces: [], faceCount: 0, knownFaceCount: 0, strangerCount: 0,
        bestSmile: 0, allEyesOpen: true, sharpness: 80, exposure: 50, sceneType: 'detail',
        aiScore: 50, analyzedAt: i
      }
    };
  }

  it('does not touch the photos array until PHOTO_FLUSH_BATCH photos have arrived', async () => {
    importFilesMock.mockClear();
    useStore.setState({ progress: null, notice: '', photos: [] });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });

    const runningImport = useStore.getState().runImport([file]);
    const [, , onPhoto] = importFilesMock.mock.calls[0] as [unknown, unknown, (item: { photo: PhotoRecord; analysis: AnalysisRecord }) => void];

    for (let i = 0; i < 14; i++) onPhoto(importedPhoto(i));
    expect(useStore.getState().photos).toHaveLength(0); // sub pragul de 15 — inca bufferizate

    onPhoto(importedPhoto(14)); // a 15-a — declanseaza flush-ul de lot
    expect(useStore.getState().photos).toHaveLength(15);

    resolveImportFiles?.();
    await runningImport;
  });

  it('flushes any remaining buffered photos (below the batch threshold) once the import finishes', async () => {
    importFilesMock.mockClear();
    useStore.setState({ progress: null, notice: '', photos: [] });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });

    const runningImport = useStore.getState().runImport([file]);
    const [, , onPhoto] = importFilesMock.mock.calls[0] as [unknown, unknown, (item: { photo: PhotoRecord; analysis: AnalysisRecord }) => void];

    for (let i = 0; i < 5; i++) onPhoto(importedPhoto(i)); // sub pragul de 15, niciun flush inca
    expect(useStore.getState().photos).toHaveLength(0);

    resolveImportFiles?.();
    await runningImport;

    expect(useStore.getState().photos).toHaveLength(5); // flush final, nimic pierdut
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

function makeFaceWithEmbedding(embedding: number[] | undefined, personId: string | null = null): FaceInsight {
  return { ...makeFace(personId, personId ? 'Deja identificat' : null), embedding };
}

function makePerson(embeddings: number[][]): KnownPerson {
  return { id: 'ami-id', name: 'Ami', embeddings, updatedAt: 0 };
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

// Bug real gasit de auditul QA: addPerson/importPersonProfiles nu re-potriveau
// RETROACTIV noile referinte fata de pozele deja analizate — doar viitoarele
// analize "vedeau" persoana nou-inrolata, desi embeddingul fiecarei fete e deja
// salvat in AnalysisRecord. matchFacesToPerson e logica extrasa din
// rematchPersonInExistingAnalyses (care atinge Dexie), testabila unitar.
describe('matchFacesToPerson', () => {
  it('identifies a previously-unmatched face whose embedding is close enough to a person reference', () => {
    const analysis = makeAnalysis([makeFaceWithEmbedding([1, 0])]);
    const changed = matchFacesToPerson(analysis, makePerson([[1, 0]]));
    expect(changed).toBe(true);
    expect(analysis.faces[0].personId).toBe('ami-id');
    expect(analysis.faces[0].personName).toBe('Ami');
    expect(analysis.faces[0].similarity).toBe(1);
    expect(analysis.knownFaceCount).toBe(1);
    expect(analysis.strangerCount).toBe(0);
  });

  it('leaves a face unmatched when similarity stays under the recognition threshold', () => {
    const analysis = makeAnalysis([makeFaceWithEmbedding([1, 0])]);
    const changed = matchFacesToPerson(analysis, makePerson([[0, 1]])); // orthogonal -> similarity 0
    expect(changed).toBe(false);
    expect(analysis.faces[0].personId).toBeNull();
  });

  it('never overrides a face already assigned to another person', () => {
    const analysis = makeAnalysis([makeFaceWithEmbedding([1, 0], 'someone-else')]);
    const changed = matchFacesToPerson(analysis, makePerson([[1, 0]]));
    expect(changed).toBe(false);
    expect(analysis.faces[0].personId).toBe('someone-else');
  });

  it('skips faces with no stored embedding (older records)', () => {
    const analysis = makeAnalysis([makeFaceWithEmbedding(undefined)]);
    const changed = matchFacesToPerson(analysis, makePerson([[1, 0]]));
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

function makeDbPhoto(overrides: Partial<PhotoRecord> & { id: string }): PhotoRecord {
  return {
    fileName: `${overrides.id}.jpg`, importedAt: 0, width: 100, height: 100, dHash: '0',
    status: 'review', ...overrides
  };
}

function makeDbAnalysis(overrides: Partial<AnalysisRecord> & { photoId: string }): AnalysisRecord {
  return {
    faces: [], faceCount: 0, knownFaceCount: 0, strangerCount: 0, bestSmile: 0, allEyesOpen: true,
    sharpness: 80, exposure: 50, sceneType: 'landscape', aiScore: 20, analyzedAt: 0, ...overrides
  };
}

// Bug real gasit de auditul QA (bug/medium, scalabilitate): bulkRejectBelow
// (si celelalte operatii in masa) faceau, per poza, db.photos.update() +
// syncOriginal() SERIAL inainte de train() — acum scrierile DB ruleaza in
// PARALEL (Promise.all), cu train() ramas strict SECVENTIAL dupa (nu poate
// fi paralelizat fara sa schimbe semantica invatarii online). Test real, cu
// Dexie adevarat (fake-indexeddb) — verifica ambele: (1) toate scrierile DB
// chiar se aplica, (2) contextEngine.recordCorrection e apelat o singura
// data per poza, in ordinea targets (nu amestecat de paralelizare).
describe('bulkRejectBelow (integration, Dexie real via fake-indexeddb)', () => {
  it('writes all target statuses and trains ContextEngine once per photo, in order', async () => {
    await db.photos.clear();
    await db.analyses.clear();

    const ids = ['p1', 'p2', 'p3'];
    for (const id of ids) {
      await db.photos.put(makeDbPhoto({ id, status: 'review' }));
      await db.analyses.put(makeDbAnalysis({ photoId: id, aiScore: 10 }));
    }
    const photos = ids.map(id => ({ ...makePhoto(0), id, status: 'review', aiScore: 10 } as PhotoView));
    useStore.setState({ photos });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection').mockResolvedValue({ topShift: null });

    const result = await useStore.getState().bulkRejectBelow(50);

    expect(result.affected).toBe(3);
    for (const id of ids) {
      expect((await db.photos.get(id))?.status).toBe('rejected');
    }
    expect(recordCorrectionSpy).toHaveBeenCalledTimes(3);
    // ordinea de antrenare trebuie sa ramana cea a targets, chiar daca
    // scrierile DB de dinainte au rulat in paralel
    expect(recordCorrectionSpy.mock.calls.map(c => c[0].photoId)).toEqual(ids);
    expect(recordCorrectionSpy.mock.calls.every(c => c[0].userDecision === false)).toBe(true);

    recordCorrectionSpy.mockRestore();
  });
});

// Cerinta directa a utilizatorului: un mic toast IMEDIAT dupa o corectie
// reala ("Am invatat: X"), distinct de panoul agregat "Preferinte AI"
// (InsightsPanel) deschis manual. Scop deliberat restrans la setStatus()
// (decizia P/X unica) — actiunile in masa NU trec pe aici.
describe('setStatus topShift toast (integration, Dexie real via fake-indexeddb)', () => {
  it('afiseaza toast-ul "Am invatat: X" cand recordCorrection raporteaza un topShift, la o schimbare reala de status', async () => {
    await db.photos.clear();
    await db.analyses.clear();
    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'review' }));
    await db.analyses.put(makeDbAnalysis({ photoId: 'p1', aiScore: 20 }));
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'review' } as PhotoView], notice: null });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection')
      .mockResolvedValue({ topShift: { feature: 'bestSmile', label: 'zambete largi' } });

    await useStore.getState().setStatus('p1', 'selected');

    expect(useStore.getState().notice).toBe('Am învățat: zambete largi');
    recordCorrectionSpy.mockRestore();
  });

  it('NU afiseaza toast cand recordCorrection nu raporteaza niciun topShift (acord, sau schimbare prea mica)', async () => {
    await db.photos.clear();
    await db.analyses.clear();
    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'review' }));
    await db.analyses.put(makeDbAnalysis({ photoId: 'p1', aiScore: 20 }));
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'review' } as PhotoView], notice: null });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection').mockResolvedValue({ topShift: null });

    await useStore.getState().setStatus('p1', 'selected');

    expect(useStore.getState().notice).toBeNull();
    recordCorrectionSpy.mockRestore();
  });

  it('NU afiseaza toast pentru o re-confirmare a aceluiasi status (nu e o schimbare reala)', async () => {
    await db.photos.clear();
    await db.analyses.clear();
    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'selected' }));
    await db.analyses.put(makeDbAnalysis({ photoId: 'p1', aiScore: 80 }));
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'selected' } as PhotoView], notice: null });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection')
      .mockResolvedValue({ topShift: { feature: 'bestSmile', label: 'zambete largi' } });

    await useStore.getState().setStatus('p1', 'selected'); // acelasi status ca inainte

    expect(useStore.getState().notice).toBeNull();
    recordCorrectionSpy.mockRestore();
  });
});

// Bug real gasit de auditul QA: bulkSetRatingForSelection (si surorile ei)
// suprascriau valorile TUTUROR pozelor din selectie fara nicio urma de undo —
// Ctrl+Z fie nu gasea nimic de anulat, fie anula din greseala o alta actiune
// aflata deja pe `batchHistory`. Fix: stiva separata `fieldBatchHistory`.
describe('bulkSetRatingForSelection undo (integration, Dexie real via fake-indexeddb)', () => {
  it('e reversibil cu undo() — restaureaza rating-urile individuale anterioare', async () => {
    await db.photos.clear();
    await db.analyses.clear();

    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'review', rating: 2 }));
    await db.photos.put(makeDbPhoto({ id: 'p2', status: 'review', rating: 4 }));
    const photos = [
      { ...makePhoto(0), id: 'p1', rating: 2 } as PhotoView,
      { ...makePhoto(0), id: 'p2', rating: 4 } as PhotoView
    ];
    useStore.setState({ photos, multiSelectIds: new Set(['p1', 'p2']), history: [], batchHistory: [], fieldBatchHistory: [] });

    await useStore.getState().bulkSetRatingForSelection(5);

    expect((await db.photos.get('p1'))?.rating).toBe(5);
    expect((await db.photos.get('p2'))?.rating).toBe(5);
    expect(useStore.getState().fieldBatchHistory).toHaveLength(1);

    await useStore.getState().undo();

    expect((await db.photos.get('p1'))?.rating).toBe(2);
    expect((await db.photos.get('p2'))?.rating).toBe(4);
    expect(useStore.getState().fieldBatchHistory).toHaveLength(0);
    const s = useStore.getState();
    expect(s.photos.find(p => p.id === 'p1')?.rating).toBe(2);
    expect(s.photos.find(p => p.id === 'p2')?.rating).toBe(4);
  });

  it('undo() alege stiva cu cel mai recent timestamp intre history/batchHistory/fieldBatchHistory', async () => {
    await db.photos.clear();
    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'review', rating: 1 }));
    const photos = [{ ...makePhoto(0), id: 'p1', rating: 1 } as PhotoView];
    useStore.setState({
      photos,
      history: [{ photoId: 'p1', previousStatus: 'pending', newStatus: 'selected', ts: 1 }],
      batchHistory: [],
      fieldBatchHistory: [{ id: 'f1', label: 'test', field: 'rating', changes: [{ photoId: 'p1', previousValue: 1 }], ts: 999 }]
    });

    // fieldBatchHistory (ts 999) e mai recent decat history (ts 1) -> reverta rating-ul, nu statusul
    await useStore.getState().undo();

    expect(useStore.getState().fieldBatchHistory).toHaveLength(0);
    expect(useStore.getState().history).toHaveLength(1);
  });
});

// Cerinta directa a utilizatorului: combinatii de filtre denumite, reaplicabile
// dintr-un click, persistate local (localStorage) — vezi state/savedFilters.ts.
describe('saved filter presets', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({
      savedFilters: [], personFilter: null, colorLabelFilter: null, sceneTagFilter: null,
      cameraFilter: null, projectFilter: null, searchText: '', minRating: 0
    });
  });

  it('nu salveaza un preset gol (fara niciun filtru secundar activ)', () => {
    const result = useStore.getState().saveCurrentFiltersAsPreset('Test');
    expect(result).toBeNull();
    expect(useStore.getState().savedFilters).toEqual([]);
    expect(readSavedFilters()).toEqual([]);
  });

  it('nu salveaza cu un nume gol/doar spatii, chiar daca exista filtre active', () => {
    useStore.setState({ minRating: 4 });
    expect(useStore.getState().saveCurrentFiltersAsPreset('   ')).toBeNull();
    expect(useStore.getState().savedFilters).toEqual([]);
  });

  it('salveaza si persista snapshot-ul filtrelor curente sub numele dat', () => {
    useStore.setState({ personFilter: 'Ami', colorLabelFilter: 'red', minRating: 4, searchText: 'plaja' });

    const result = useStore.getState().saveCurrentFiltersAsPreset('  Preferate  ');

    expect(result).toMatchObject({ name: 'Preferate', personFilter: 'Ami', colorLabelFilter: 'red', minRating: 4, searchText: 'plaja' });
    expect(useStore.getState().savedFilters).toHaveLength(1);
    expect(readSavedFilters()).toHaveLength(1); // persistat in localStorage, nu doar in memorie
  });

  it('applySavedFilterPreset seteaza toate campurile din preset, ignora un id necunoscut', () => {
    useStore.setState({ minRating: 3 });
    const preset = useStore.getState().saveCurrentFiltersAsPreset('Rating mare')!;
    useStore.setState({ minRating: 0, personFilter: 'Altcineva' });

    useStore.getState().applySavedFilterPreset(preset.id);
    expect(useStore.getState().minRating).toBe(3);
    expect(useStore.getState().personFilter).toBeNull();

    useStore.getState().applySavedFilterPreset('id-inexistent');
    expect(useStore.getState().minRating).toBe(3); // neschimbat, no-op
  });

  it('deleteSavedFilterPreset scoate presetul din stare si din localStorage', () => {
    useStore.setState({ minRating: 2 });
    const preset = useStore.getState().saveCurrentFiltersAsPreset('De sters')!;
    expect(useStore.getState().savedFilters).toHaveLength(1);

    useStore.getState().deleteSavedFilterPreset(preset.id);

    expect(useStore.getState().savedFilters).toEqual([]);
    expect(readSavedFilters()).toEqual([]);
  });
});

// Cerinta directa a utilizatorului: un singur buton care sa anuleze TOATE
// filtrele combinabile deodata (persoana/eticheta/scena/aparat/proiect/folder/
// cautare/data/rating), fara sa fie nevoie sa stii care era activ ca sa-l
// re-selectezi din propriul lui panou.
describe('clearAllFilters', () => {
  it('reseteaza toate filtrele combinabile, dar NU atinge filtrul principal de status', () => {
    useStore.setState({
      filter: 'selected',
      personFilter: 'Ami',
      colorLabelFilter: 'red',
      sceneTagFilter: 'dog',
      cameraFilter: 'Canon EOS R5',
      projectFilter: 'Nunta',
      collectionFilter: 'col-1',
      searchText: 'plaja',
      dateFrom: 1000,
      dateTo: 2000,
      minRating: 3
    });

    useStore.getState().clearAllFilters();

    const s = useStore.getState();
    expect(s.filter).toBe('selected'); // neschimbat — vezi comentariul actiunii in store.ts
    expect(s.personFilter).toBeNull();
    expect(s.colorLabelFilter).toBeNull();
    expect(s.sceneTagFilter).toBeNull();
    expect(s.cameraFilter).toBeNull();
    expect(s.projectFilter).toBeNull();
    expect(s.collectionFilter).toBeNull();
    expect(s.searchText).toBe('');
    expect(s.dateFrom).toBeNull();
    expect(s.dateTo).toBeNull();
    expect(s.minRating).toBe(0);
  });
});

// Cerinta directa a utilizatorului: foldere personalizate golite ODATA CU
// sesiunea ("Goleste sesiunea"), nu doar la reset-ul complet care include si
// persoanele — vezi comentariul din clearAll (store.ts) pentru motiv.
describe('clearAll clears custom collections too (integration, Dexie real via fake-indexeddb)', () => {
  it('sterge db.collections si reseteaza collections/collectionFilter din store', async () => {
    await db.photos.clear();
    await db.collections.clear();
    await db.collections.put({ id: 'col-1', name: 'Vacanta', createdAt: Date.now(), memberIds: ['p1'] });
    useStore.setState({ collections: [{ id: 'col-1', name: 'Vacanta', createdAt: Date.now(), memberIds: ['p1'] }], collectionFilter: 'col-1' });

    await useStore.getState().clearAll();

    expect(await db.collections.toArray()).toEqual([]);
    const s = useStore.getState();
    expect(s.collections).toEqual([]);
    expect(s.collectionFilter).toBeNull();
  });
});

// Motorul invata acum si din stele, nu doar din Selecteaza/Respinge: un 5 e
// cea mai clara parere pe care o dai despre o poza, un 1 la fel, in celalalt
// sens. Vezi ratingDecision (store.ts) pentru de ce 3 si 0 nu spun nimic.
describe('ratingDecision', () => {
  it('trateaza 4-5 stele ca "da" si 1-2 ca "nu"', () => {
    expect(ratingDecision(5)).toBe(true);
    expect(ratingDecision(4)).toBe(true);
    expect(ratingDecision(2)).toBe(false);
    expect(ratingDecision(1)).toBe(false);
  });

  it('nu invata nimic din 3 stele (mijloc explicit) sau 0 (fara rating dat)', () => {
    expect(ratingDecision(3)).toBeNull();
    expect(ratingDecision(0)).toBeNull();
  });
});

// Bug real raportat de utilizator: dupa "Goleste sesiunea", Supervizorul
// galeriei arata in continuare perioada tocmai stearsa ca deja acoperita (cu
// procentul vechi de acoperire), deci nu se mai putea relua curat. Cursorul
// inseamna "pana unde am adus poze IN biblioteca" — golirea bibliotecii il face
// fals prin definitie. Vezi resetSupervisorProgress (state/gallerySupervisor.ts).
describe('clearAll resets the gallery supervisor progress (integration, Dexie real via fake-indexeddb)', () => {
  it('uita cursorul, folderele aduse si ultimul import, in store si in localStorage', async () => {
    await db.photos.clear();
    localStorage.setItem('lumin-gallery-supervisor-covered-until', '1750000000000');
    localStorage.setItem('lumin-gallery-supervisor-imported-folders', JSON.stringify(['bucket-1']));
    useStore.setState({
      supervisorCoveredUntil: 1750000000000,
      supervisorImportedFolderIds: new Set(['bucket-1']),
      lastSupervisorImportIds: ['p1', 'p2']
    });

    await useStore.getState().clearAll();

    const s = useStore.getState();
    expect(s.supervisorCoveredUntil).toBeNull();
    expect([...s.supervisorImportedFolderIds]).toEqual([]);
    expect(s.lastSupervisorImportIds).toBeNull();
    expect(localStorage.getItem('lumin-gallery-supervisor-covered-until')).toBeNull();
    expect(localStorage.getItem('lumin-gallery-supervisor-imported-folders')).toBeNull();
  });

  it('pastreaza lungimea perioadei — e o preferinta de lucru, nu o evidenta a ce s-a adus', async () => {
    await db.photos.clear();
    localStorage.setItem('lumin-gallery-supervisor-period-months', '6');

    await useStore.getState().clearAll();

    expect(localStorage.getItem('lumin-gallery-supervisor-period-months')).toBe('6');
  });
});

// Bug real raportat de utilizator (confirmat pe device: "Exporta" pe un
// folder personalizat nu facea nimic): o poza membra a unui folder dar NU
// 'selected' nu avea originalul persistat, deci exportCollection() nu gasea
// nimic dupa un reload de sesiune (originalFiles, in memorie, e golit atunci).
describe('addPhotosToCollection persists originals regardless of status (integration, Dexie real via fake-indexeddb)', () => {
  it('persista originalul unei poze NEselectate la adaugarea in folder, si il elibereaza la scoatere', async () => {
    await db.photos.clear();
    await db.collections.clear();
    await db.originals.clear();
    await db.fileHandles.clear();

    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'review' }));
    const file = new File(['fake-bytes'], 'p1.jpg', { type: 'image/jpeg' });
    originalFiles.set('p1', file);
    useStore.setState({ collections: [] });

    const collection = await useStore.getState().createCollection('Test');
    expect(collection).not.toBeNull();

    await useStore.getState().addPhotosToCollection(collection!.id, ['p1']);
    expect(await db.originals.get('p1')).toMatchObject({ photoId: 'p1', fileName: 'p1.jpg' });

    await useStore.getState().removePhotosFromCollection(collection!.id, ['p1']);
    expect(await db.originals.get('p1')).toBeUndefined();

    originalFiles.delete('p1');
  });

  it('NU elibereaza originalul la scoaterea din folder daca poza e SELECTATA', async () => {
    await db.photos.clear();
    await db.collections.clear();
    await db.originals.clear();

    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'selected' }));
    await db.originals.put({ photoId: 'p1', blob: new Blob(['x']), fileName: 'p1.jpg', type: 'image/jpeg' });
    useStore.setState({ collections: [] });

    const collection = await useStore.getState().createCollection('Test');
    await useStore.getState().addPhotosToCollection(collection!.id, ['p1']);
    await useStore.getState().removePhotosFromCollection(collection!.id, ['p1']);

    expect(await db.originals.get('p1')).toBeDefined();
  });

  it('syncOriginal (prin setStatus) NU sterge originalul cat timp poza ramane membra a unui folder', async () => {
    await db.photos.clear();
    await db.collections.clear();
    await db.originals.clear();

    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'review' }));
    const file = new File(['fake-bytes'], 'p1.jpg', { type: 'image/jpeg' });
    originalFiles.set('p1', file);
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'review' } as PhotoView], collections: [] });

    const collection = await useStore.getState().createCollection('Test');
    await useStore.getState().addPhotosToCollection(collection!.id, ['p1']);
    expect(await db.originals.get('p1')).toBeDefined();

    // O actiune de status NECONEXA (ex. respinsa manual) nu trebuie sa stearga
    // originalul pastrat pentru folder — inainte de fix, syncOriginal() il
    // stergea neconditionat de fiecare data cand statusul nu era 'selected'.
    await useStore.getState().setStatus('p1', 'rejected');
    expect(await db.originals.get('p1')).toBeDefined();

    originalFiles.delete('p1');
  });
});

// Bug real gasit de auditul QA: clearAll() nu reseta multiSelectIds/
// multiSelectAnchor/selectMode/batchHistory/fieldBatchHistory — bara de
// selectie in masa continua sa arate poze "selectate" peste o grila golita.
describe('clearAll resets dangling multi-select and batch-history state', () => {
  it('reseteaza selectia in masa si istoricul de loturi', async () => {
    await db.photos.clear();
    useStore.setState({
      multiSelectIds: new Set(['p1', 'p2']),
      multiSelectAnchor: 'p1',
      selectMode: true,
      batchHistory: [{ id: 'b1', label: 'test', changes: [{ photoId: 'p1', previousStatus: 'review' }], ts: 1 }],
      fieldBatchHistory: [{ id: 'f1', label: 'test', field: 'rating', changes: [{ photoId: 'p1', previousValue: 0 }], ts: 1 }]
    });

    await useStore.getState().clearAll();

    const s = useStore.getState();
    expect(s.multiSelectIds.size).toBe(0);
    expect(s.multiSelectAnchor).toBeNull();
    expect(s.selectMode).toBe(false);
    expect(s.batchHistory).toEqual([]);
    expect(s.fieldBatchHistory).toEqual([]);
  });
});

// "Galerie client cu feedback" — importClientFeedback() citeste JSON-ul descarcat
// de client din galeria HTML statica (clientGallery.ts) si trebuie sa (1) scrie
// PhotoRecord.clientFeedback pe pozele care se potrivesc, (2) antreneze
// ContextEngine exact ca la o decizie normala a fotografului (acelasi train()
// folosit de setStatus), (3) sa nu se prabuseasca pe un fisier nepotrivit/invalid.
describe('importClientFeedback (integration, Dexie real via fake-indexeddb)', () => {
  function feedbackFile(payload: unknown): File {
    return new File([JSON.stringify(payload)], 'feedback.json', { type: 'application/json' });
  }

  it('potriveste pe id, scrie clientFeedback in DB + in memorie si antreneaza ContextEngine cu userDecision corect', async () => {
    await db.photos.clear();
    await db.analyses.clear();
    await db.photos.put(makeDbPhoto({ id: 'p1', status: 'selected' }));
    await db.photos.put(makeDbPhoto({ id: 'p2', status: 'review' }));
    await db.analyses.put(makeDbAnalysis({ photoId: 'p1', aiScore: 80 }));
    await db.analyses.put(makeDbAnalysis({ photoId: 'p2', aiScore: 20 }));
    useStore.setState({
      photos: [
        { ...makePhoto(0), id: 'p1', fileName: 'a.jpg', status: 'selected' } as PhotoView,
        { ...makePhoto(0), id: 'p2', fileName: 'b.jpg', status: 'review' } as PhotoView
      ],
      notice: null
    });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection').mockResolvedValue({ topShift: null });

    const file = feedbackFile({
      version: 1, galleryId: 'lc-test', exportedAt: '2026-08-06T00:00:00.000Z',
      photos: [{ id: 'p1', fileName: 'a.jpg', decision: 'like' }, { id: 'p2', fileName: 'b.jpg', decision: 'dislike' }]
    });

    await useStore.getState().importClientFeedback(file);

    expect((await db.photos.get('p1'))?.clientFeedback).toBe('like');
    expect((await db.photos.get('p2'))?.clientFeedback).toBe('dislike');
    const s = useStore.getState();
    expect(s.photos.find(p => p.id === 'p1')?.clientFeedback).toBe('like');
    expect(s.photos.find(p => p.id === 'p2')?.clientFeedback).toBe('dislike');

    expect(recordCorrectionSpy).toHaveBeenCalledTimes(2);
    const byPhoto = new Map(recordCorrectionSpy.mock.calls.map(c => [c[0].photoId, c[0].userDecision]));
    expect(byPhoto.get('p1')).toBe(true);
    expect(byPhoto.get('p2')).toBe(false);

    expect(s.notice).toBe(t('ro', 'store.clientFeedback.imported', { matched: 2, total: 2 }));
    recordCorrectionSpy.mockRestore();
  });

  it('foloseste numele de fisier ca alternativa cand id-ul din fisier nu mai exista in biblioteca curenta', async () => {
    await db.photos.clear();
    await db.analyses.clear();
    await db.photos.put(makeDbPhoto({ id: 'new-id', status: 'review' }));
    await db.analyses.put(makeDbAnalysis({ photoId: 'new-id', aiScore: 20 }));
    useStore.setState({
      photos: [{ ...makePhoto(0), id: 'new-id', fileName: 'a.jpg', status: 'review' } as PhotoView],
      notice: null
    });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection').mockResolvedValue({ topShift: null });

    // id-ul din exportul original ("old-id-din-alta-sesiune") nu mai exista —
    // fallback pe numele de fisier gaseste totusi poza curenta ("new-id")
    const file = feedbackFile({
      version: 1, photos: [{ id: 'old-id-din-alta-sesiune', fileName: 'a.jpg', decision: 'like' }]
    });

    await useStore.getState().importClientFeedback(file);

    expect((await db.photos.get('new-id'))?.clientFeedback).toBe('like');
    expect(recordCorrectionSpy).toHaveBeenCalledTimes(1);
    expect(recordCorrectionSpy.mock.calls[0][0].photoId).toBe('new-id');
    recordCorrectionSpy.mockRestore();
  });

  it('nu antreneaza nimic si arata un mesaj distinct cand nicio poza din fisier nu se potriveste', async () => {
    await db.photos.clear();
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', fileName: 'a.jpg' } as PhotoView], notice: null });

    const recordCorrectionSpy = vi.spyOn(contextEngine, 'recordCorrection').mockResolvedValue({ topShift: null });

    const file = feedbackFile({ version: 1, photos: [{ id: 'necunoscut', fileName: 'necunoscut.jpg', decision: 'like' }] });
    await useStore.getState().importClientFeedback(file);

    expect(recordCorrectionSpy).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toBe(t('ro', 'store.clientFeedback.noMatch'));
    recordCorrectionSpy.mockRestore();
  });

  it('arata un mesaj de eroare pe un fisier JSON invalid, fara sa arunce', async () => {
    useStore.setState({ notice: null });
    const file = new File(['nu-e-json'], 'feedback.json', { type: 'application/json' });

    await useStore.getState().importClientFeedback(file);

    expect(useStore.getState().notice).toContain('Importul feedback-ului de la client a eșuat');
  });
});

/**
 * Bug real raportat de utilizator (confirmat pe device, cu capturi de ecran):
 * tap pe Exporta -> toast-ul "Se exporta..." ramanea pe ecran LA INFINIT, fara
 * fisier, fara eroare, fara nimic. Cauza in store: pe o anulare, exportul iesea
 * din functie (`if (result.cancelled) return;`) fara sa mai atinga `notice`,
 * iar toast-ul de progres — care, corect, NU se mai auto-sterge dupa 10s
 * (vezi noticeTone in App.tsx) — ramanea agatat definitiv. O anulare trebuie
 * sa INLOCUIASCA mereu mesajul de progres cu un rezultat vizibil.
 */
describe('exportul nu lasa niciodata toast-ul de progres agatat pe ecran', () => {
  const cancelledResult: ExportResult = { exported: 0, missing: [], method: 'downloads', cancelled: true, grouped: false };

  beforeEach(() => {
    exportOriginalFilesMock.mockReset();
    useStore.setState({ notice: null, locale: 'ro' });
  });

  it('exportSelection inlocuieste "Se exporta..." cu mesajul de anulare', async () => {
    exportOriginalFilesMock.mockResolvedValue(cancelledResult);
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'selected' } as PhotoView] });

    await useStore.getState().exportSelection();

    expect(exportOriginalFilesMock).toHaveBeenCalledTimes(1);
    expect(useStore.getState().notice).toBe(t('ro', 'store.exportSelection.cancelled'));
    expect(useStore.getState().notice).not.toBe(t('ro', 'store.exportSelection.exporting'));
  });

  it('exportCollection inlocuieste "Se exporta..." cu mesajul de anulare', async () => {
    exportOriginalFilesMock.mockResolvedValue(cancelledResult);
    const collection = { id: 'col-1', name: 'Ami', createdAt: Date.now(), memberIds: ['p1'] };
    useStore.setState({
      photos: [{ ...makePhoto(0), id: 'p1', status: 'review' } as PhotoView],
      collections: [collection]
    });

    await useStore.getState().exportCollection('col-1');

    expect(exportOriginalFilesMock).toHaveBeenCalledTimes(1);
    expect(useStore.getState().notice).toBe(t('ro', 'store.exportSelection.cancelled'));
  });

  it('o eroare reala din export ramane raportata ca eroare, nu ca anulare', async () => {
    exportOriginalFilesMock.mockRejectedValue(new Error('puntea nativa a esuat'));
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'selected' } as PhotoView] });

    await useStore.getState().exportSelection();

    expect(useStore.getState().notice).toContain('puntea nativa a esuat');
  });
});

/**
 * Cerinta directa a utilizatorului: exportul unui folder personalizat trebuie sa
 * produca EXACT folderul pe care l-a creat si denumit el, nu categoriile deduse
 * de aplicatie (persoana/scena) — vezi ExportOptions.folderName.
 */
describe('exportCollection foloseste numele folderului personalizat ca destinatie', () => {
  beforeEach(() => {
    exportOriginalFilesMock.mockReset();
    useStore.setState({ notice: null, locale: 'ro' });
  });

  it('trimite folderName catre export si numeste folderul in mesajul de succes', async () => {
    exportOriginalFilesMock.mockResolvedValue({ exported: 2, missing: [], method: 'folder', cancelled: false, grouped: true });
    const collection = { id: 'col-1', name: 'Vacanta 2026', createdAt: Date.now(), memberIds: ['p1', 'p2'] };
    useStore.setState({
      photos: [
        { ...makePhoto(0), id: 'p1', status: 'review' } as PhotoView,
        { ...makePhoto(1), id: 'p2', status: 'review' } as PhotoView
      ],
      collections: [collection]
    });

    await useStore.getState().exportCollection('col-1');

    expect(exportOriginalFilesMock.mock.calls[0][1]).toMatchObject({ folderName: 'Vacanta 2026' });
    expect(useStore.getState().notice).toBe(
      t('ro', 'collections.export.exportedFolder', { count: 2, name: 'Vacanta 2026' })
    );
  });

  it('exportSelection NU primeste folderName — gruparea pe persoana/scena ramane neschimbata acolo', async () => {
    exportOriginalFilesMock.mockResolvedValue({ exported: 1, missing: [], method: 'folder', cancelled: false, grouped: true });
    useStore.setState({ photos: [{ ...makePhoto(0), id: 'p1', status: 'selected' } as PhotoView] });

    await useStore.getState().exportSelection();

    expect(exportOriginalFilesMock.mock.calls[0][1]).not.toHaveProperty('folderName');
  });
});
