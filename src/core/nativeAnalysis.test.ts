import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsdom nu implementeaza OffscreenCanvas — stub minimal, dar de data asta
// TREBUIE sa functioneze cu adevarat (spre deosebire de faceAnalysis.worker.test.ts,
// unde ramane neatins): analyzeNative() foloseste bitmapToBlob() la primul pas,
// necondiționat.
class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  getContext() { return { drawImage: () => {} }; }
  convertToBlob() { return Promise.resolve(new Blob(['fake-jpeg'], { type: 'image/jpeg' })); }
}
vi.stubGlobal('OffscreenCanvas', StubOffscreenCanvas);

const detectFacesNative = vi.fn();
vi.mock('./nativeFaceDetection', () => ({ detectFacesNative: (...a: unknown[]) => detectFacesNative(...a) }));

const analyzeImageNative = vi.fn();
vi.mock('./nativeImageAnalysis', () => ({ analyzeImageNative: (...a: unknown[]) => analyzeImageNative(...a) }));

const labelImageNative = vi.fn();
vi.mock('./nativeImageLabeling', () => ({ labelImageNative: (...a: unknown[]) => labelImageNative(...a) }));

const analyzeFaceMeshNative = vi.fn();
vi.mock('./nativeFaceMesh', () => ({ analyzeFaceMeshNative: (...a: unknown[]) => analyzeFaceMeshNative(...a) }));

const detectTextNative = vi.fn();
vi.mock('./nativeTextRecognition', () => ({ detectTextNative: (...a: unknown[]) => detectTextNative(...a) }));

const IMAGE_ANALYSIS_FIXTURE = {
  sharpness: 80,
  exposure: 55,
  highlightClipping: 0.01,
  shadowClipping: 0.02,
  ruleOfThirds: 0.7,
  headroom: 0.15,
  compositionScore: 0.6,
  leadingLinesDetected: false,
  symmetryDetected: false,
  negativeSpaceScore: 0.3,
  lightQuality: 'soft' as const,
  goldenHourDetected: false,
  bokehQuality: 'average' as const,
  colorHarmonyScore: 0.5,
  dominantColors: ['#112233']
};

function fakeBitmap(width = 1000, height = 500): ImageBitmap {
  return { width, height, close: () => {} } as unknown as ImageBitmap;
}

describe('analyzeNative', () => {
  beforeEach(() => {
    detectFacesNative.mockReset();
    analyzeImageNative.mockReset();
    labelImageNative.mockReset();
    analyzeFaceMeshNative.mockReset();
    detectTextNative.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
  });

  it('normalizeaza casetele ML Kit (pixeli) in FaceInsight.box (0..1) folosind imageWidth/imageHeight raportate de plugin', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 100, top: 50, width: 200, height: 250 }, smilingProbability: 0.8, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.95 }],
      imageWidth: 1000,
      imageHeight: 500
    });
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(result.faces).toHaveLength(1);
    expect(result.faces[0].box).toEqual([0.1, 0.1, 0.2, 0.5]);
    expect(result.faces[0].smile).toBe(0.8);
    expect(result.faces[0].isBlinking).toBe(false);
    expect(result.faceCount).toBe(1);
    expect(result.bestSmile).toBe(0.8);
  });

  it('marcheaza isBlinking cand probabilitatea de ochi deschis e sub prag, si trateaza probabilitate absenta ca "deschis"', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [
        { boundingBox: { left: 0, top: 0, width: 10, height: 10 }, leftEyeOpenProbability: 0.2, rightEyeOpenProbability: 0.9 },
        { boundingBox: { left: 0, top: 0, width: 10, height: 10 } } // fara nicio probabilitate — ML Kit n-a putut clasifica
      ],
      imageWidth: 100,
      imageHeight: 100
    });
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.faces[0].isBlinking).toBe(true); // 0.2 < prag
    expect(result.faces[1].isBlinking).toBe(false); // absent -> tratat ca 1 (deschis)
    expect(result.allEyesOpen).toBe(false); // cel putin o fata clipeste
  });

  it('calculeaza groupSmileRatio din smilingProbability ML Kit (bug real depistat de audit — lipsea complet pe native)', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [
        { boundingBox: { left: 0, top: 0, width: 10, height: 10 }, smilingProbability: 0.9 }, // peste prag
        { boundingBox: { left: 0, top: 0, width: 10, height: 10 }, smilingProbability: 0.1 }, // sub prag
        { boundingBox: { left: 0, top: 0, width: 10, height: 10 } } // fara probabilitate -> tratat ca 0
      ],
      imageWidth: 100,
      imageHeight: 100
    });
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.groupSmileRatio).toBeCloseTo(1 / 3);
  });

  it('groupSmileRatio absent cand nu exista fete', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({ labels: [{ label: 'cat', score: 0.9 }] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.groupSmileRatio).toBeUndefined();
  });

  it('nu apeleaza deloc FaceMesh cand nu exista fete', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({ labels: [{ label: 'cat', score: 0.9 }] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(analyzeFaceMeshNative).not.toHaveBeenCalled();
    expect(result.sceneTags).toEqual(['cat']);
    expect(result.groupGenuineSmileRatio).toBeUndefined();
  });

  it('dedupe etichetele in sceneTags, la fel ca faceAnalysis.worker.ts', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({
      labels: [
        { label: 'cat', score: 0.9 },
        { label: 'cat', score: 0.7 },
        { label: 'dog', score: 0.6 }
      ]
    });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.sceneTags).toEqual(['cat', 'dog']);
  });

  it('agrega grupul FaceMesh independent de lista ML Kit (numar diferit de fete intre cei doi detectori)', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 0, top: 0, width: 10, height: 10 }, smilingProbability: 0.5 }],
      imageWidth: 100,
      imageHeight: 100
    });
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({
      faces: [
        { smile: 0.9, emotionSurprise: 0, emotionNegative: 0, eyesOpen: { left: 1, right: 1 }, mouthOpen: false, genuineSmile: true, awkwardExpression: false, engagement: 0.8, eyeContact: 0.6 },
        { smile: 0.1, emotionSurprise: 0, emotionNegative: 0.4, eyesOpen: { left: 1, right: 1 }, mouthOpen: true, genuineSmile: false, awkwardExpression: true, engagement: 0.2 } // fara eyeContact
      ]
    });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.faceCount).toBe(1); // tot ML Kit ramane sursa pentru faces[]/faceCount
    expect(result.groupGenuineSmileRatio).toBe(0.5); // 1 din 2 fete FaceMesh
    expect(result.groupAwkwardRatio).toBe(0.5);
    expect(result.avgEngagement).toBeCloseTo(0.5); // (0.8+0.2)/2
    expect(result.avgEyeContact).toBe(0.6); // media doar peste fetele cu eyeContact definit
  });

  it('ruleaza OCR DOAR cand nu exista nici fete nici etichete de scena, si seteaza textCoverage', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({ labels: [] });
    detectTextNative.mockResolvedValue({ blocks: [{ text: 'Factura', box: { left: 0, top: 0, width: 50, height: 10 } }], textCoverage: 0.4 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(detectTextNative).toHaveBeenCalledTimes(1);
    expect(result.textCoverage).toBe(0.4);
  });

  it('nu apeleaza OCR cand exista fete', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 0, top: 0, width: 10, height: 10 } }],
      imageWidth: 100,
      imageHeight: 100
    });
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(detectTextNative).not.toHaveBeenCalled();
    expect(result.textCoverage).toBeUndefined();
  });

  it('nu apeleaza OCR cand exista o eticheta de scena CONCRETA (subiect real recunoscut)', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({ labels: [{ label: 'cat', score: 0.9 }] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(detectTextNative).not.toHaveBeenCalled();
    expect(result.textCoverage).toBeUndefined();
  });

  it('BUG REAL (audit): ruleaza OCR cand fara fete singurele etichete sunt abstracte/non-subiect (ex. "Photography"), nu doar cand nu exista nicio eticheta', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({ labels: [{ label: 'Photography', score: 0.9 }, { label: 'Text', score: 0.8 }] });
    detectTextNative.mockResolvedValue({ blocks: [], textCoverage: 0.5 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(detectTextNative).toHaveBeenCalledTimes(1);
    expect(result.textCoverage).toBe(0.5);
  });

  it('preia direct campurile ImageAnalysis (nume identice cu AnalysisRecord) fara remapare', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
    labelImageNative.mockResolvedValue({ labels: [] });
    detectTextNative.mockResolvedValue({ blocks: [], textCoverage: 0 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.sharpness).toBe(IMAGE_ANALYSIS_FIXTURE.sharpness);
    expect(result.compositionScore).toBe(IMAGE_ANALYSIS_FIXTURE.compositionScore);
    expect(result.dominantColors).toEqual(IMAGE_ANALYSIS_FIXTURE.dominantColors);
    expect(result.bokehQuality).toBe('average');
  });

  it('nu seteaza recunoastere faciala pe native — knownFaceCount 0, strangerCount = faceCount, personId null', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 0, top: 0, width: 10, height: 10 } }],
      imageWidth: 100,
      imageHeight: 100
    });
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.knownFaceCount).toBe(0);
    expect(result.strangerCount).toBe(1);
    expect(result.faces[0].personId).toBeNull();
    expect(result.faces[0].embedding).toBeUndefined();
  });
});
