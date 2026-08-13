import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, type AnalysisRecord } from './db';
import { readLibraryScores } from './importPipeline';

function analysis(photoId: string, aiScore: number): AnalysisRecord {
  return {
    photoId, faces: [], faceCount: 0, knownFaceCount: 0, strangerCount: 0,
    bestSmile: 0, allEyesOpen: true, sharpness: 50, exposure: 50,
    sceneType: 'landscape', aiScore, analyzedAt: 0
  };
}

// Garda impotriva unei rupturi TACUTE: readLibraryScores citeste cheile
// indexului Dexie pe `aiScore`, nu inregistrarile. Daca cineva l-ar schimba pe
// `.primaryKeys()` sau pe alt index, ar intoarce id-uri de poze (string-uri) in
// loc de scoruri — deriveThresholds ar primi gunoi, ar muta pragurile pe baza
// lui, si nimic n-ar arunca vreo eroare.
describe('readLibraryScores', () => {
  it('intoarce SCORURILE, sortate crescator — nu id-urile pozelor', async () => {
    await db.analyses.bulkPut([analysis('c', 90), analysis('a', 10), analysis('b', 50)]);
    expect(await readLibraryScores()).toEqual([10, 50, 90]);
  });

  it('intoarce o lista goala pe o biblioteca goala (praguri fixe, fara adaptare)', async () => {
    await db.analyses.clear();
    expect(await readLibraryScores()).toEqual([]);
  });
});
