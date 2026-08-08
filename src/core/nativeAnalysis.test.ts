import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnownPerson } from './db';

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

// jsdom nu implementeaza nici createImageBitmap() — folosit doar de calea de
// recunoastere faciala (cropFaceBitmap in nativeAnalysis.ts) pentru a decupa
// regiunea unei fete inainte de a o trimite la worker-ul de recunoastere.
// Stub minimal: ignora coordonatele, intoarce un "bitmap" fals cu close() no-op.
vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close: () => {} } as unknown as ImageBitmap)));

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

const embedImageNative = vi.fn();
vi.mock('./nativeImageEmbedder', () => ({ embedImageNative: (...a: unknown[]) => embedImageNative(...a) }));

const detectPoseNative = vi.fn();
vi.mock('./nativePoseDetection', () => ({ detectPoseNative: (...a: unknown[]) => detectPoseNative(...a) }));

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
    embedImageNative.mockReset();
    detectPoseNative.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    embedImageNative.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });
    detectPoseNative.mockResolvedValue({ people: [] });
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

  it('fara callback de recunoastere (web nu ajunge aici; native cand nimeni nu e inrolat) — knownFaceCount 0, strangerCount = faceCount, personId null', async () => {
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

  // Bug real gasit de auditul QA: pipeline-ul nativ (ML Kit/MediaPipe) nu are
  // niciun model propriu de recunoastere faciala — addPerson/enrollare
  // functionau, dar pozele analizate NATIV ramaneau mereu cu toata lumea
  // "necunoscuta", indiferent cati oameni erau inrolati. Fix: recognize()
  // (injectat de AnalysisPool.analyze() din workerPool.ts, care ruleaza un
  // worker Human.js lazy DOAR pentru decupajul mic al fiecarei fete, vezi
  // header-ul fisierului) e apelat per fata ML Kit, iar rezultatul e comparat
  // cosinus fata de knownPersons.
  describe('recunoastere faciala nativa (recognize + knownPersons)', () => {
    const AMI: KnownPerson = { id: 'ami-id', name: 'Ami', embeddings: [[1, 0]], updatedAt: 0 };

    function mockOneFace() {
      detectFacesNative.mockResolvedValue({
        faces: [{ boundingBox: { left: 10, top: 10, width: 50, height: 50 } }],
        imageWidth: 200,
        imageHeight: 200
      });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    }

    it('eticheteaza fata cu persoana cunoscuta cand embeddingul intors de recognize() se potriveste', async () => {
      mockOneFace();
      const recognize = vi.fn().mockResolvedValue({ embedding: [1, 0], faceCount: 1 });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(200, 200), recognize, [AMI]);

      expect(recognize).toHaveBeenCalledTimes(1);
      expect(result.faces[0].personId).toBe('ami-id');
      expect(result.faces[0].personName).toBe('Ami');
      expect(result.faces[0].similarity).toBe(1);
      expect(result.faces[0].embedding).toEqual([1, 0]);
      expect(result.knownFaceCount).toBe(1);
      expect(result.strangerCount).toBe(0);
    });

    it('lasa fata neidentificata cand similaritatea ramane sub pragul de recunoastere', async () => {
      mockOneFace();
      const recognize = vi.fn().mockResolvedValue({ embedding: [0, 1], faceCount: 1 }); // ortogonal pe [1,0] -> similaritate 0

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(200, 200), recognize, [AMI]);

      expect(result.faces[0].personId).toBeNull();
      expect(result.knownFaceCount).toBe(0);
      expect(result.strangerCount).toBe(1);
    });

    it('nu apeleaza deloc recognize() cand nu exista nicio persoana inrolata (gard redundant fata de AnalysisPool)', async () => {
      mockOneFace();
      const recognize = vi.fn();

      const { analyzeNative } = await import('./nativeAnalysis');
      await analyzeNative('p1', fakeBitmap(200, 200), recognize, []);

      expect(recognize).not.toHaveBeenCalled();
    });

    it('un esec al recognize() pentru o fata nu opreste restul analizei pozei (fata ramane neidentificata)', async () => {
      mockOneFace();
      const recognize = vi.fn().mockRejectedValue(new Error('worker de recunoastere blocat'));

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(200, 200), recognize, [AMI]);

      expect(result.faces[0].personId).toBeNull();
      expect(result.faceCount).toBe(1); // restul analizei (faceCount, etc.) tot s-a produs normal
    });

    it('proceseaza cel mult MAX_RECOGNIZED_FACES_PER_PHOTO fete — restul raman neidentificate, fara sa mai apeleze recognize()', async () => {
      const manyFaces = Array.from({ length: 8 }, () => ({ boundingBox: { left: 10, top: 10, width: 50, height: 50 } }));
      detectFacesNative.mockResolvedValue({ faces: manyFaces, imageWidth: 200, imageHeight: 200 });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
      const recognize = vi.fn().mockResolvedValue({ embedding: [1, 0], faceCount: 1 });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(200, 200), recognize, [AMI]);

      expect(recognize.mock.calls.length).toBeLessThan(manyFaces.length);
      expect(result.faceCount).toBe(8); // toate fetele raman in AnalysisRecord, doar recunoasterea e plafonata
    });
  });

  // imageEmbedding (ImageEmbedder, Faza 6) — vezi AnalysisRecord: doar pentru
  // poze FARA fete, unde nu exista deja embedding-uri faciale mai puternice
  // pentru rafinarea seriilor in hashCompare.worker.ts.
  describe('imageEmbedding general (fara fete)', () => {
    it('calculeaza embedding-ul general cand nu exista nicio fata', async () => {
      detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
      labelImageNative.mockResolvedValue({ labels: [] });
      detectTextNative.mockResolvedValue({ blocks: [], textCoverage: 0 });
      embedImageNative.mockResolvedValue({ embedding: [0.4, 0.5, 0.6] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(embedImageNative).toHaveBeenCalledTimes(1);
      expect(result.imageEmbedding).toEqual([0.4, 0.5, 0.6]);
    });

    it('nu calculeaza deloc embedding-ul general cand exista cel putin o fata (embedding-urile faciale sunt deja semnalul puternic)', async () => {
      detectFacesNative.mockResolvedValue({
        faces: [{ boundingBox: { left: 0, top: 0, width: 10, height: 10 } }],
        imageWidth: 100,
        imageHeight: 100
      });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(embedImageNative).not.toHaveBeenCalled();
      expect(result.imageEmbedding).toBeUndefined();
    });
  });

  // bodyCroppedAtEdge (PoseDetection, Faza 5) — vezi AnalysisRecord: doar cand
  // exista fete (postura n-are subiect de verificat pe un peisaj/obiect).
  describe('bodyCroppedAtEdge (postura)', () => {
    function mockOneFaceForPose() {
      detectFacesNative.mockResolvedValue({
        faces: [{ boundingBox: { left: 0, top: 0, width: 10, height: 10 } }],
        imageWidth: 100,
        imageHeight: 100
      });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    }

    const WRIST_INDEX = 15;

    function landmarksWithWristAt(x: number, y: number, visibility: number) {
      const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
      landmarks[WRIST_INDEX] = { x, y, z: 0, visibility };
      return landmarks;
    }

    it('nu calculeaza deloc postura cand nu exista nicio fata', async () => {
      detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 100, imageHeight: 100 });
      labelImageNative.mockResolvedValue({ labels: [] });
      detectTextNative.mockResolvedValue({ blocks: [], textCoverage: 0 });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(detectPoseNative).not.toHaveBeenCalled();
      expect(result.bodyCroppedAtEdge).toBeUndefined();
    });

    it('true cand o incheietura e langa marginea cadrului SI cu incredere de vizibilitate scazuta (probabil extrapolata dincolo de cadru)', async () => {
      mockOneFaceForPose();
      detectPoseNative.mockResolvedValue({ people: [{ landmarks: landmarksWithWristAt(0.01, 0.5, 0.2) }] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(result.bodyCroppedAtEdge).toBe(true);
    });

    it('false cand o incheietura e langa margine dar cu incredere MARE (clar vizibila, nu taiata)', async () => {
      mockOneFaceForPose();
      detectPoseNative.mockResolvedValue({ people: [{ landmarks: landmarksWithWristAt(0.01, 0.5, 0.95) }] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(result.bodyCroppedAtEdge).toBe(false);
    });

    it('false cand incheietura are incredere scazuta dar NU e langa margine (ocluzie in alta parte a cadrului, nu taiere)', async () => {
      mockOneFaceForPose();
      detectPoseNative.mockResolvedValue({ people: [{ landmarks: landmarksWithWristAt(0.5, 0.5, 0.2) }] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(result.bodyCroppedAtEdge).toBe(false);
    });

    it('false cand nicio persoana nu e detectata de PoseDetection', async () => {
      mockOneFaceForPose();
      detectPoseNative.mockResolvedValue({ people: [] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(100, 100));

      expect(result.bodyCroppedAtEdge).toBe(false);
    });
  });
});
