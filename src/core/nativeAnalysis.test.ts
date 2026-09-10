import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KnownPerson } from './db';

// jsdom nu implementeaza OffscreenCanvas — stub minimal, dar de data asta
// TREBUIE sa functioneze cu adevarat (spre deosebire de faceAnalysis.worker.test.ts,
// unde ramane neatins): analyzeNative() foloseste bitmapToBlob() la primul pas,
// necondiționat.
/** Cate canvas-uri la rezolutie plina s-au construit — vezi `needsFullCanvas`. */
let canvasesBuilt = 0;
class StubOffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; canvasesBuilt++; }
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

    /**
     * Fara nicio persoana inrolata, recunoasterea TOT ruleaza — pentru grupare,
     * nu pentru nume.
     *
     * Poarta cerea `knownPersons.length`, ceea ce e logica pentru NUMIT pe
     * cineva: fara referinta, n-ai cu ce compara. Gruparea insa compara doua
     * poze intre ele ("e acelasi om ca in cadrul de alaturi?"), deci n-are
     * nevoie de nicio inrolare. Masurat pe 200 de poze cu poarta pusa: ZERO
     * din 143 de perechi candidate au fost judecate dupa fete.
     *
     * Fata ramane neidentificata (n-are cu cine fi comparata), dar embedding-ul
     * ei exista si ajunge la hashCompare.worker.ts.
     */
    it('ruleaza recognize() si fara nicio persoana inrolata — embedding-ul e pentru grupare, nu pentru nume', async () => {
      mockOneFace();
      const recognize = vi.fn().mockResolvedValue({ embedding: [1, 0], faceCount: 1 });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(200, 200), recognize, []);

      expect(recognize).toHaveBeenCalledTimes(1);
      expect(result.faces[0].embedding).toEqual([1, 0]);
      expect(result.faces[0].personId).toBeNull();
      expect(result.faces[0].personName).toBeNull();
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
  // poze FARA fete. Nu fiindca cele cu fete ar avea deja un semnal mai bun
  // (fara nimeni inrolat, n-au niciunul), ci fiindca s-a masurat ce da acolo:
  // 108 din 138 de perechi respinse au picat cu peste 0.25 sub prag. Vezi
  // comentariul din nativeAnalysis.ts.
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

    it('cu fete SI persoane inrolate, sare peste el — embedding-urile faciale sunt semnalul puternic', async () => {
      detectFacesNative.mockResolvedValue({
        faces: [{ boundingBox: { left: 0, top: 0, width: 50, height: 50 }, smilingProbability: 0.5, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 }],
        imageWidth: 200, imageHeight: 200
      });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
      detectPoseNative.mockResolvedValue({ people: [] });
      const recognize = vi.fn().mockResolvedValue({ embedding: [1, 0], faceCount: 1 });
      const inrolat: KnownPerson = { id: 'ami-id', name: 'Ami', embeddings: [[1, 0]], updatedAt: 0 };

      const { analyzeNative } = await import('./nativeAnalysis');
      await analyzeNative('p1', fakeBitmap(200, 200), recognize, [inrolat]);

      expect(embedImageNative).not.toHaveBeenCalled();
    });

    /**
     * Pe poze cu fete NU se calculeaza, nici fara nimeni inrolat — si asta e o
     * decizie luata pe masuratoare, dupa ce s-a incercat si invers.
     *
     * Largirea conditiei parea evidenta: fara nimeni inrolat nu ruleaza
     * `recognize`, deci o poza cu fete ramanea fara niciun semnal de subiect.
     * Numaratoarea pe benzi (DovadaBanda in hashCompare.worker.ts) a aratat
     * insa ce cumpara semnalul asta acolo: din 143 de perechi ajunse in
     * fereastra de moment, 138 tot au picat, si 108 dintre ele cu PESTE 0.25
     * sub prag. Embedding-ul de continut raspunde la "ce fel de scena e",
     * nu la "e acelasi om" — si pe 200 de poze a costat 1m43s in plus pentru
     * 5 perechi legate.
     *
     * Ramane deci pe cadrele fara oameni, singurul loc unde "aceeasi scena" e
     * chiar intrebarea pusa.
     */
    it('cu fete DAR fara nimeni inrolat, tot NU il calculeaza — e semnalul gresit pentru oameni', async () => {
      detectFacesNative.mockResolvedValue({
        faces: [{ boundingBox: { left: 0, top: 0, width: 50, height: 50 }, smilingProbability: 0.5, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 }],
        imageWidth: 200, imageHeight: 200
      });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
      detectPoseNative.mockResolvedValue({ people: [] });
      embedImageNative.mockResolvedValue({ embedding: [0.7, 0.8] });

      const { analyzeNative } = await import('./nativeAnalysis');
      const result = await analyzeNative('p1', fakeBitmap(200, 200));

      expect(embedImageNative).not.toHaveBeenCalled();
      expect(result.imageEmbedding).toBeUndefined();
    });

    it('cu fete si o lista GOALA de persoane inrolate, nici atunci nu il calculeaza', async () => {
      // recognize ruleaza acum si fara inrolari (vezi mai sus), dar embedding-ul
      // GENERAL tot nu: pe poze cu oameni raspunde la alta intrebare.
      detectFacesNative.mockResolvedValue({
        faces: [{ boundingBox: { left: 0, top: 0, width: 50, height: 50 }, smilingProbability: 0.5, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 }],
        imageWidth: 200, imageHeight: 200
      });
      labelImageNative.mockResolvedValue({ labels: [] });
      analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
      detectPoseNative.mockResolvedValue({ people: [] });
      const recognize = vi.fn();
      embedImageNative.mockResolvedValue({ embedding: [0.7, 0.8] });

      const { analyzeNative } = await import('./nativeAnalysis');
      await analyzeNative('p1', fakeBitmap(200, 200), recognize, []);

      expect(embedImageNative).not.toHaveBeenCalled();
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

// Un lot de 400 de poze inseamna 400 x (suma timpilor tuturor modelelor) daca
// apelurile independente sunt asteptate unul dupa altul. Testele de mai jos
// prind exact regresia asta: nu masoara timp (fragil), ci verifica cine a
// APUCAT sa porneasca inainte ca altcineva sa termine.
describe('analyzeNative — apelurile independente chiar pornesc in paralel', () => {
  /** Un mock care intoarce `value`, dar abia dupa ce i se spune, si care raporteaza cand a fost pornit. */
  function gated<T>(value: T) {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    let started = false;
    return {
      get started() { return started; },
      release,
      impl: async () => { started = true; await gate; return value; }
    };
  }

  beforeEach(() => {
    for (const m of [detectFacesNative, analyzeImageNative, labelImageNative, analyzeFaceMeshNative, detectTextNative, embedImageNative, detectPoseNative]) m.mockReset();
  });

  it('detectia de fete, analiza de imagine si etichetarea pornesc toate trei inainte ca vreuna sa termine', async () => {
    const faces = gated({ faces: [], imageWidth: 100, imageHeight: 100 });
    const image = gated(IMAGE_ANALYSIS_FIXTURE);
    const labels = gated({ labels: [{ label: 'dog', confidence: 0.9 }] });
    detectFacesNative.mockImplementation(faces.impl);
    analyzeImageNative.mockImplementation(image.impl);
    labelImageNative.mockImplementation(labels.impl);
    embedImageNative.mockResolvedValue({ embedding: [0.1] });
    detectTextNative.mockResolvedValue({ textCoverage: 0 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const running = analyzeNative('p1', fakeBitmap(100, 100));
    await Promise.resolve(); // lasa microtask-urile sa porneasca apelurile

    expect(faces.started).toBe(true);
    expect(image.started).toBe(true);
    expect(labels.started).toBe(true);

    faces.release(); image.release(); labels.release();
    await running;
  });

  it('mesh-ul si postura pornesc amandoua imediat ce se stie ca exista fete', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 0, top: 0, width: 50, height: 50 }, smilingProbability: 0.5, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 }],
      imageWidth: 100, imageHeight: 100
    });
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    labelImageNative.mockResolvedValue({ labels: [] });
    // Fara nimeni inrolat, poza cu fete primeste acum si embedding-ul general
    // (vezi nativeAnalysis: e singura dovada de subiect ramasa).
    embedImageNative.mockResolvedValue({ embedding: [0.1, 0.2] });
    const mesh = gated({ faces: [] });
    const pose = gated({ people: [] });
    analyzeFaceMeshNative.mockImplementation(mesh.impl);
    detectPoseNative.mockImplementation(pose.impl);

    const { analyzeNative } = await import('./nativeAnalysis');
    const running = analyzeNative('p1', fakeBitmap(100, 100));
    // cateva ture de microtask-uri ca etapa 1 sa se rezolve si etapa 2 sa porneasca
    for (let i = 0; i < 20; i++) await Promise.resolve();

    expect(mesh.started).toBe(true);
    expect(pose.started).toBe(true);

    mesh.release(); pose.release();
    await running;
  });

  it('rezultatul ramane identic cu cel al ordinii secventiale de dinainte', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 10, top: 10, width: 40, height: 40 }, smilingProbability: 0.7, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 }],
      imageWidth: 100, imageHeight: 100
    });
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    labelImageNative.mockResolvedValue({ labels: [{ label: 'dog', confidence: 0.9 }, { label: 'dog', confidence: 0.8 }] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    detectPoseNative.mockResolvedValue({ people: [] });
    embedImageNative.mockResolvedValue({ embedding: [0.1, 0.2] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(100, 100));

    expect(result.faceCount).toBe(1);
    expect(result.sceneTags).toEqual(['dog']);        // dedupe pastrat
    expect(result.sharpness).toBe(IMAGE_ANALYSIS_FIXTURE.sharpness);
    // Exista fete -> fara embedding general, indiferent de inrolari: pe oameni
    // raspunde la alta intrebare decat cea pusa (vezi nativeAnalysis).
    expect(result.imageEmbedding).toBeUndefined();
    expect(embedImageNative).not.toHaveBeenCalled();
    expect(detectTextNative).not.toHaveBeenCalled();   // exista fete -> fara OCR
  });
});

/**
 * Canvas-ul la rezolutie plina se construia pe fiecare poza, neconditionat, pe
 * firul principal — desi pe calea cu URI de galerie are exact doi clienti:
 * decupajele de fata pentru recunoastere si blob-ul pentru OCR. Fara nicio
 * persoana inrolata, niciunul nu apare.
 */
describe('analyzeNative — canvas-ul la rezolutie plina, doar cand e cerut', () => {
  beforeEach(() => {
    detectFacesNative.mockReset();
    analyzeImageNative.mockReset();
    labelImageNative.mockReset();
    analyzeFaceMeshNative.mockReset();
    detectTextNative.mockReset();
    embedImageNative.mockReset();
    detectPoseNative.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    embedImageNative.mockResolvedValue({ embedding: [0.1] });
    detectPoseNative.mockResolvedValue({ people: [] });
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 1000, imageHeight: 500 });
    labelImageNative.mockResolvedValue({ labels: [{ label: 'beach' }] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    canvasesBuilt = 0;
  });

  it('cu URI de galerie si fara callback de recunoastere, nu construieste niciunul', async () => {
    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(4000, 3000), undefined, [], 'content://media/1');

    expect(canvasesBuilt).toBe(0);
  });

  /**
   * Scutirea de canvas NU mai depinde de inrolari, si asta e un COST, nu o
   * imbunatatire — trecut prin test ca sa nu se piarda din vedere.
   *
   * Cat timp recunoasterea rula doar cu persoane inrolate, omul care nu
   * folosea "Persoane cunoscute" nu platea niciun canvas. Acum embedding-urile
   * faciale se calculeaza pentru toata lumea, fiindca gruparea are nevoie de
   * ele ca sa spuna "acelasi om" — deci canvas-ul revine, si e cronometrat
   * ('canvas' in core/stageTiming.ts) tocmai ca sa se poata decide pe cifre
   * daca merita.
   */
  it('cu URI dar CU callback de recunoastere, il construieste chiar fara nicio persoana inrolata', async () => {
    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(4000, 3000), async () => null, [], 'content://media/1');

    expect(canvasesBuilt).toBeGreaterThan(0);
  });

  it('fara URI (selector de fisiere) il construieste, ca inainte — blob-ul e singura cale spre modele', async () => {
    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(4000, 3000));

    expect(canvasesBuilt).toBeGreaterThan(0);
  });

  it('cu persoane inrolate il construieste, chiar si cu URI — recunoasterea decupeaza din el', async () => {
    const persons: KnownPerson[] = [{ id: 'x', name: 'Ami', embeddings: [[0.1]], updatedAt: 0 }];
    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(4000, 3000), async () => null, persons, 'content://media/1');

    expect(canvasesBuilt).toBeGreaterThan(0);
  });
});

/**
 * Calea 'landmarker' (e7 din auditul motoarelor): un singur model da si
 * casetele, si zambetul, si ochii. Testele de aici apara exact ce se schimba
 * fata de calea ML Kit — si ce NU are voie sa se schimbe.
 */
describe('analyzeNative — motorul de fete FaceLandmarker', () => {
  beforeEach(() => {
    localStorage.clear();
    detectFacesNative.mockReset();
    analyzeImageNative.mockReset();
    labelImageNative.mockReset();
    analyzeFaceMeshNative.mockReset();
    detectTextNative.mockReset();
    embedImageNative.mockReset();
    detectPoseNative.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    labelImageNative.mockResolvedValue({ labels: [] });
    embedImageNative.mockResolvedValue({ embedding: [0.1] });
    detectPoseNative.mockResolvedValue({ people: [] });
  });

  const meshFace = (over: Record<string, unknown> = {}) => ({
    boundingBox: { left: 100, top: 50, width: 200, height: 250 },
    smile: 0.8,
    emotionSurprise: 0.1,
    emotionNegative: 0.05,
    eyesOpen: { left: 0.9, right: 0.85 },
    mouthOpen: false,
    genuineSmile: true,
    awkwardExpression: false,
    engagement: 0.7,
    eyeContact: 0.6,
    ...over
  });

  it('nu mai cheama deloc ML Kit — de acolo vin cele 33% din timpul unei poze', async () => {
    localStorage.setItem('lumin-face-engine', 'landmarker');
    analyzeFaceMeshNative.mockResolvedValue({ faces: [meshFace()], imageWidth: 1000, imageHeight: 500 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(detectFacesNative).not.toHaveBeenCalled();
    // Si un singur apel de mesh, nu doua: statisticile de grup vin din acelasi rezultat.
    expect(analyzeFaceMeshNative).toHaveBeenCalledTimes(1);
    expect(result.faceCount).toBe(1);
    expect(result.faceEngine).toBe('landmarker');
  });

  it('caseta vine din mesh, normalizata cu dimensiunile pe care s-a masurat', async () => {
    localStorage.setItem('lumin-face-engine', 'landmarker');
    analyzeFaceMeshNative.mockResolvedValue({ faces: [meshFace()], imageWidth: 1000, imageHeight: 500 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(result.faces[0].box).toEqual([0.1, 0.1, 0.2, 0.5]);
  });

  /**
   * Aici e diferenta care conta: pe calea ML Kit, cele doua modele gasesc liste
   * de fete care nu se pot potrivi 1:1, deci semnalele fine ajungeau doar ca
   * medie pe grup. Cu un singur detector, potrivirea e chiar identitatea.
   */
  it('semnalele fine ajung PER FATA, nu doar ca medie pe grup', async () => {
    localStorage.setItem('lumin-face-engine', 'landmarker');
    analyzeFaceMeshNative.mockResolvedValue({ faces: [meshFace()], imageWidth: 1000, imageHeight: 500 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(result.faces[0].eyeContact).toBe(0.6);
    expect(result.faces[0].mouthOpen).toBe(false);
    expect(result.faces[0].emotion?.happy).toBe(0.8);
    // ...si statisticile de grup raman calculate, din acelasi rezultat.
    expect(result.groupGenuineSmileRatio).toBe(1);
  });

  it('ochii se judeca pe pragul build-ului web, nu pe cel al ML Kit', async () => {
    localStorage.setItem('lumin-face-engine', 'landmarker');
    // 0.35 e sub MESH_BLINK_THRESHOLD (0.4), dar PESTE pragul ML Kit (0.5) ar fi
    // fost tot "clipit" — testul apara ca se foloseste scara potrivita.
    analyzeFaceMeshNative.mockResolvedValue({
      faces: [meshFace({ eyesOpen: { left: 0.35, right: 0.9 } })],
      imageWidth: 1000, imageHeight: 500
    });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(result.faces[0].isBlinking).toBe(true);
    expect(result.allEyesOpen).toBe(false);
  });

  it('o fata fara caseta (plugin mai vechi) e sarita, nu presupusa la zero', async () => {
    localStorage.setItem('lumin-face-engine', 'landmarker');
    analyzeFaceMeshNative.mockResolvedValue({
      faces: [meshFace(), meshFace({ boundingBox: undefined })],
      imageWidth: 1000, imageHeight: 500
    });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(result.faceCount).toBe(1);
  });

  it('implicit, nimic nu se schimba: ML Kit ramane detectorul', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 1000, imageHeight: 500 });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 500));

    expect(detectFacesNative).toHaveBeenCalledTimes(1);
    expect(result.faceEngine).toBe('mlkit');
  });
});

/**
 * CATE fete trec prin recunoastere, si care.
 *
 * Fara nicio inrolare, embedding-urile nu servesc la numit pe cineva, ci doar
 * la intrebarea gruparii ("acelasi subiect?"). Acolo fetele mici din fundal
 * costa doua lucruri: apeluri serializate in plus, si zgomot — pentru ca
 * `bestFaceSimilarity` (hashCompare.worker.ts) ia MAXIMUL peste toate
 * perechile, deci doi trecatori care seamana intre ei pot lega doua cadre
 * fara nicio legatura.
 */
describe('analyzeNative — cate fete trec prin recunoastere', () => {
  const cutie = (left: number, latura: number) => ({
    boundingBox: { left, top: 0, width: latura, height: latura },
    smilingProbability: 0.5, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9
  });

  beforeEach(() => {
    for (const m of [detectFacesNative, analyzeImageNative, labelImageNative, analyzeFaceMeshNative, detectTextNative, embedImageNative, detectPoseNative]) m.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    labelImageNative.mockResolvedValue({ labels: [] });
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    detectPoseNative.mockResolvedValue({ people: [] });
    // Patru fete: doua mari (indicii 1 si 3) si doua mici de fundal (0 si 2).
    detectFacesNative.mockResolvedValue({
      faces: [cutie(0, 70), cutie(100, 300), cutie(500, 80), cutie(700, 200)],
      imageWidth: 1000, imageHeight: 1000
    });
  });

  it('fara nicio inrolare, recunoaste doar cele mai mari doua fete', async () => {
    const recognize = vi.fn().mockResolvedValue({ embedding: [1, 0], faceCount: 1 });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 1000), recognize, []);

    expect(recognize).toHaveBeenCalledTimes(2);
    // Cele mari (300px si 200px) au embedding; cele de fundal, nu.
    expect(result.faces[1].embedding).toEqual([1, 0]);
    expect(result.faces[3].embedding).toEqual([1, 0]);
    expect(result.faces[0].embedding).toBeUndefined();
    expect(result.faces[2].embedding).toBeUndefined();
  });

  it('cu persoane inrolate le ia pe toate — oricare poate fi cineva de numit', async () => {
    const recognize = vi.fn().mockResolvedValue({ embedding: [1, 0], faceCount: 1 });
    const inrolat: KnownPerson = { id: 'ami-id', name: 'Ami', embeddings: [[1, 0]], updatedAt: 0 };

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(1000, 1000), recognize, [inrolat]);

    expect(recognize).toHaveBeenCalledTimes(4);
    expect(result.faces.every(f => f.embedding !== undefined)).toBe(true);
  });
});

/**
 * FIECARE model, cu cronometrul lui.
 *
 * Pana acum toate sapte stateau intr-o singura cifra ('nativeModels'), din
 * care se putea afla ca modelele costa ~592ms, dar nu si CARE dintre ele. Fara
 * asta, orice taiere e o banuiala — si banuielile au iesit prost de trei ori
 * la rand pe viteza.
 */
describe('analyzeNative — cronometru pe fiecare model', () => {
  beforeEach(async () => {
    localStorage.clear();
    for (const m of [detectFacesNative, analyzeImageNative, labelImageNative, analyzeFaceMeshNative, detectTextNative, embedImageNative, detectPoseNative]) m.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    detectPoseNative.mockResolvedValue({ people: [] });
    embedImageNative.mockResolvedValue({ embedding: [0.1] });
    detectTextNative.mockResolvedValue({ blocks: [], textCoverage: 0 });
    const { resetStageStats } = await import('./stageTiming');
    resetStageStats();
  });

  /** Etapele care chiar au primit masuratori, ca nume. */
  async function etapeMasurate(): Promise<string[]> {
    const { readStageStats } = await import('./stageTiming');
    return readStageStats().filter(st => st.count > 0).map(st => st.stage);
  }

  it('o poza cu fete masoara detectia, mesh-ul, imaginea, etichetele si postura — nu embedding-ul si nu OCR-ul', async () => {
    detectFacesNative.mockResolvedValue({
      faces: [{ boundingBox: { left: 0, top: 0, width: 50, height: 50 }, smilingProbability: 0.5, leftEyeOpenProbability: 0.9, rightEyeOpenProbability: 0.9 }],
      imageWidth: 200, imageHeight: 200
    });
    labelImageNative.mockResolvedValue({ labels: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(200, 200));

    const etape = await etapeMasurate();
    expect(etape).toEqual(expect.arrayContaining(['mFaceDetect', 'mFaceMesh', 'mImageAnalysis', 'mLabels', 'mPose']));
    expect(etape).not.toContain('mEmbed');
    expect(etape).not.toContain('mOcr');
  });

  it('o poza fara fete masoara embedding-ul si OCR-ul — nu mesh-ul si nu postura', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 200, imageHeight: 200 });
    labelImageNative.mockResolvedValue({ labels: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(200, 200));

    const etape = await etapeMasurate();
    expect(etape).toEqual(expect.arrayContaining(['mFaceDetect', 'mImageAnalysis', 'mLabels', 'mEmbed', 'mOcr']));
    expect(etape).not.toContain('mFaceMesh');
    expect(etape).not.toContain('mPose');
  });

  /**
   * OCR ruleaza ODATA CU al doilea val, si timpul lui ramane parte din peretele
   * masurat de 'nativeModels'. Scos de acolo, ar reaparea in reziduu ca timp
   * nemasurat — exact eroarea pe care o descrie stageTiming.ts.
   *
   * Doua masuratori de perete, nu trei: valul 1, apoi valul 2 impreuna cu OCR.
   * A treia ar fi insemnat ca OCR-ul asteapta din nou la coada.
   */
  it('OCR-ul ramane inauntrul peretelui, si in ACELASI perete cu valul 2', async () => {
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 200, imageHeight: 200 });
    labelImageNative.mockResolvedValue({ labels: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(200, 200));

    const { readStageStats } = await import('./stageTiming');
    const stats = readStageStats();
    const perete = stats.find(st => st.stage === 'nativeModels');
    // Valul 1, apoi valul 2 impreuna cu OCR. Trei ar fi insemnat ca OCR-ul si-a
    // luat iar rand separat; una singura, ca a iesit din perete cu totul.
    expect(perete?.count).toBe(2);
  });

  it('pe motorul landmarker, detectia ML Kit nu mai ruleaza deloc', async () => {
    localStorage.setItem('lumin-face-engine', 'landmarker');
    analyzeFaceMeshNative.mockResolvedValue({ faces: [], imageWidth: 200, imageHeight: 200 });
    labelImageNative.mockResolvedValue({ labels: [] });

    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(200, 200));

    const etape = await etapeMasurate();
    expect(etape).toContain('mFaceMesh');
    expect(etape).not.toContain('mFaceDetect');
  });
});

/**
 * OCR-ul nu mai asteapta valul 2.
 *
 * Nu depinde de nimic din el — se decide din `faces` si `sceneTags`, amandoua
 * din valul 1 — dar statea dupa, cu `await`, deci pe pozele unde se aprinde isi
 * adauga tot timpul la coada: masurat 1,4s de obicei, pe 49 de poze din 200.
 */
describe('analyzeNative — OCR ruleaza odata cu valul 2', () => {
  beforeEach(() => {
    for (const m of [detectFacesNative, analyzeImageNative, labelImageNative, analyzeFaceMeshNative, detectTextNative, embedImageNative, detectPoseNative]) m.mockReset();
    analyzeImageNative.mockResolvedValue(IMAGE_ANALYSIS_FIXTURE);
    analyzeFaceMeshNative.mockResolvedValue({ faces: [] });
    detectPoseNative.mockResolvedValue({ people: [] });
    detectFacesNative.mockResolvedValue({ faces: [], imageWidth: 200, imageHeight: 200 });
    labelImageNative.mockResolvedValue({ labels: [] });
  });

  it('porneste OCR-ul INAINTE ca embedding-ul din valul 2 sa se termine', async () => {
    let embeddingRezolvat = false;
    let ocrPornitInainteDeEmbedding = false;
    embedImageNative.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => { embeddingRezolvat = true; resolve({ embedding: [0.1] }); }, 20);
    }));
    detectTextNative.mockImplementation(() => {
      ocrPornitInainteDeEmbedding = !embeddingRezolvat;
      return Promise.resolve({ blocks: [], textCoverage: 0 });
    });

    const { analyzeNative } = await import('./nativeAnalysis');
    await analyzeNative('p1', fakeBitmap(200, 200));

    expect(detectTextNative).toHaveBeenCalledTimes(1);
    expect(ocrPornitInainteDeEmbedding, 'OCR-ul a asteptat valul 2 in loc sa ruleze odata cu el').toBe(true);
  });

  it('rezultatul OCR ajunge in inregistrare la fel ca inainte', async () => {
    detectTextNative.mockResolvedValue({
      blocks: [{ text: 'parola de wifi este LuminCuller2026', boundingBox: { left: 0, top: 0, width: 10, height: 10 } }],
      textCoverage: 0.4
    });
    embedImageNative.mockResolvedValue({ embedding: [0.1] });

    const { analyzeNative } = await import('./nativeAnalysis');
    const result = await analyzeNative('p1', fakeBitmap(200, 200));

    expect(result.textCoverage).toBe(0.4);
    expect(result.ocrText).toContain('LuminCuller2026');
  });
});
