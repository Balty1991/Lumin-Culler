import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enrichAfterFirstResult } from './backgroundIdentity';
import { lightAnalysis } from './lightAnalysis';
import { PET_CENTER_CROP } from './petIdentity';

describe('enrichAfterFirstResult', () => {
  it('nu scrie fețe când build-ul nu e cel de test, dar semnalează ochii închiși', async () => {
    const analysis = lightAnalysis('p', { sharpness: 80, exposure: 50 });
    const result = await enrichAfterFirstResult(
      { analysis, file: new File(['x'], 'a.jpg'), mediaUri: 'content://1' },
      {
        testIdentity: false,
        blinkThreshold: 0.4,
        mesh: async () => ({
          faces: [{ boundingBox: { left: 10, top: 10, width: 40, height: 40 }, eyesOpen: { left: 0.1, right: 0.9 } }],
          imageWidth: 100,
          imageHeight: 100
        })
      }
    );
    expect(result.eyesClosed).toBe(true);
    expect(analysis.faces).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('pe build-ul de test pune embeddingul pe fața cea mai mare și numele cunoscut', async () => {
    const analysis = lightAnalysis('p', { sharpness: 80, exposure: 50 });
    const cropped: [number, number, number, number][] = [];
    const result = await enrichAfterFirstResult(
      { analysis, file: new File(['x'], 'a.jpg'), mediaUri: 'content://1' },
      {
        testIdentity: true,
        blinkThreshold: 0.4,
        mesh: async () => ({
          faces: [
            { boundingBox: { left: 0, top: 0, width: 10, height: 10 }, eyesOpen: { left: 0.9, right: 0.9 }, smile: 0.2 },
            { boundingBox: { left: 20, top: 10, width: 40, height: 50 }, eyesOpen: { left: 0.9, right: 0.9 }, smile: 0.8 }
          ],
          imageWidth: 100,
          imageHeight: 100
        }),
        decodeSmall: async () => ({ width: 100, height: 100, close() {} }) as ImageBitmap,
        cropFace: async (_bitmap, box) => {
          cropped.push(box);
          return { close() {} } as ImageBitmap;
        },
        embedFace: async () => ({ embedding: [1, 0, 0] }),
        knownPersons: [{ id: 'ana', name: 'Ana', embeddings: [[1, 0, 0]] }]
      }
    );
    expect(result.changed).toBe(true);
    expect(analysis.faces).toHaveLength(2);
    expect(cropped[0][2]).toBeCloseTo(0.4);
    expect(cropped.length).toBe(2);
    expect(analysis.faces.every(f => f.personName === 'Ana')).toBe(true);
    expect(analysis.knownFaceCount).toBe(2);
  });

  it('decupează animalul și nu înglobează un cadru fără etichetă de animal', async () => {
    const analysis = lightAnalysis('p', { sharpness: 70, exposure: 50 });
    const crops: { x: number; y: number; w: number; h: number }[] = [];
    await enrichAfterFirstResult(
      { analysis, file: new File(['x'], 'a.jpg'), mediaUri: 'content://1' },
      {
        testIdentity: false,
        blinkThreshold: 0.4,
        label: async () => ['Grass', 'Dog'],
        detectObjects: async () => [{ x: 0.5, y: 0.4, w: 0.3, h: 0.35, label: 'cat' }],
        embedCrop: async (_uri, crop) => {
          crops.push(crop);
          return [0.2, 0.3, 0.4];
        },
        namedPets: [{ name: 'Rex', embedding: [1, 0, 0] }]
      }
    );
    expect(analysis.petLabel).toBe('dog');
    expect(analysis.sceneTags).toEqual(['Grass', 'Dog']);
    expect(crops[0].x).toBeGreaterThan(0.4);
    expect(analysis.petName).toBeUndefined();
    expect(analysis.petEmbedding).toEqual([0.2, 0.3, 0.4]);
  });

  it('fără cutii folosește centrul cadrului', async () => {
    const analysis = lightAnalysis('p', { sharpness: 70, exposure: 50 });
    analysis.sceneTags = ['cat'];
    let crop: { x: number; y: number } | undefined;
    await enrichAfterFirstResult(
      { analysis, file: new File(['x'], 'a.jpg'), mediaUri: 'content://1' },
      {
        testIdentity: false,
        blinkThreshold: 0.4,
        detectObjects: async () => [],
        embedCrop: async (_uri, next) => {
          crop = next;
          return [1, 0];
        },
        namedPets: [{ name: 'Miti', embedding: [1, 0] }]
      }
    );
    expect(crop).toEqual(PET_CENTER_CROP);
    expect(analysis.petName).toBe('Miti');
  });

  it('un document nu pornește modelele', async () => {
    const analysis = lightAnalysis('p', { sharpness: 10, exposure: 80 });
    let called = false;
    const result = await enrichAfterFirstResult(
      { analysis, file: new File(['x'], 'a.jpg'), mediaUri: 'content://1', aside: 'document' },
      {
        testIdentity: true,
        blinkThreshold: 0.4,
        mesh: async () => { called = true; return { faces: [] }; },
        embedCrop: async () => { called = true; return [1]; }
      }
    );
    expect(called).toBe(false);
    expect(result.changed).toBe(false);
  });
});

describe('identitatea nu e în treapta 1', () => {
  const rad = resolve(__dirname, '..', '..');
  const citeste = (cale: string) => readFileSync(resolve(rad, cale), 'utf8');

  it('stageOnePrepare nu cheamă îmbogățirea, iar analyze() nu primește faceres', () => {
    const pipe = citeste('src/core/importPipeline.ts');
    const stage = pipe.slice(pipe.indexOf('async function stageOnePrepare'), pipe.indexOf('async function processOne'));
    expect(stage).not.toContain('enrichAfterFirstResult');
    expect(pipe).toContain('schedulePost');
    const pool = citeste('src/core/workerPool.ts');
    expect(pool).toContain('ANDROID_IDENTITY_EMBEDDINGS ?');
    expect(pool).not.toContain('TEST_IDENTITY_EMBEDDINGS');
  });
});
