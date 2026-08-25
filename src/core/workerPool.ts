/**
 * core/workerPool.ts
 * Pool de Web Workers pentru analiza ML. Firul principal doar decodează
 * imaginile și transferă ImageBitmap-uri (zero-copy); inferența rulează
 * exclusiv aici, pe N-1 nuclee.
 *
 * Pe Android nativ (Capacitor), acest pool NU mai porneste deloc workeri
 * Human.js pentru analiza normala — foloseste in schimb core/nativeAnalysis.ts
 * (5 plugin-uri Kotlin/ML Kit/MediaPipe deja dovedite pe device real). Vezi
 * `nativeMode` mai jos. Singura exceptie: computeEnrollmentEmbedding()
 * ("Persoane cunoscute") tot are nevoie de Human.js (recunoasterea nu exista
 * inca pe native) — porneste UN worker real, lazy, doar la prima folosire.
 */
import * as Comlink from 'comlink';
import { Capacitor } from '@capacitor/core';
import type { FaceAnalysisAPI } from '../workers/faceAnalysis.worker';
import type { AnalysisRecord, KnownPerson } from './db';
import { readEconomicMode } from './performanceSettings';
import { selectActivePersons } from './activePersons';
import { writeLastModelLoadMs } from './modelLoadTiming';
import { analyzeNative } from './nativeAnalysis';

interface Slot {
  worker: Worker;
  api: Comlink.Remote<FaceAnalysisAPI>;
  busy: boolean;
}

// 60s -> 90s -> 150s: primul worker parcurge acum o cascada WebGPU(6s)->WebGL(20s)->CPU
// (fara timeout propriu — ultimul refugiu, vezi faceAnalysis.worker.ts) inainte
// sa se stabileasca definitiv pe un backend; pe hardware slab, warmup-ul complet
// pe CPU pur (fara acceleratie GPU) pentru intregul set de modele (fata+iris+
// emotie+centernet) poate depasi singur bugetul disponibil, ceea ce ar respinge
// acest timeout EXACT cand cascada de mai jos e pe cale sa reuseasca (doar mai
// incet) — o eroare "Incarcarea a durat prea mult" tocmai atunci cand device-ul
// aproape terminase legitim. Bug real raportat de utilizator (Xiaomi 15T,
// WebGL blocklist-uit pe acel device — vezi comentariul din
// faceAnalysis.worker.ts despre Xiaomi Browser): esecul cadea exact la 90s,
// adica exact bugetul vechi, in timp ce refugiul CPU inca lucra legitim.
const MODEL_INIT_TIMEOUT_MS = 150000;
/**
 * O poza problematica (rezolutie extrema, pixeli corupti care duc inferenta
 * TF.js intr-un caz patologic etc.) poate bloca WORKER-ul la infinit — nu
 * doar main thread-ul. Fara acest timeout, un singur fisier "prost" inghetat
 * tot importul pentru totdeauna, exact simptomul raportat: bara de progres
 * ramane blocata la "N/total" fara sa mai avanseze vreodata. Folosit si pentru
 * lantul de 5 apeluri native secventiale (core/nativeAnalysis.ts) — modelele
 * native sunt in general mult mai rapide decat Human.js, deci acelasi buget
 * ramane confortabil.
 */
const ANALYZE_TIMEOUT_MS = 40000;

/**
 * human.load() foloseste fetch() fara timeout implicit — pe o retea mobila
 * instabila, o conexiune care doar "atarna" (nu esueaza niciodata explicit)
 * bloca tot importul la infinit, cu bara de progres inghetata la "0/N" si
 * nicio eroare vizibila. Cu timeout, o retea proasta devine un esec CONCRET,
 * pe care runImport (state/store.ts) il poate afisa si din care utilizatorul
 * se poate recupera (reincearca), in loc sa ramana blocat.
 */
/**
 * @param onAbandoned Chemat cand promisiunea originala se aseaza DUPA ce
 *   timeout-ul a castigat deja cursa — adica exact cand rezultatul ei nu mai
 *   ajunge la niciun apelant.
 *
 *   Bug real gasit de auditul QA (scurgere de memorie): un timeout nu ANULEAZA
 *   promisiunea de dedesubt, doar inceteaza sa o astepte. Pentru majoritatea
 *   apelurilor de aici (Comlink, pickere) valoarea intarziata e inofensiva —
 *   dar `createImageBitmap` intoarce un ImageBitmap, o resursa care trebuie
 *   inchisa EXPLICIT (close()) si care, la 2048px, tine ~16 MB de memorie
 *   GPU/CPU. Fara acest carlig, fiecare decodare care depaseste bugetul de 30s
 *   (decodari lente pe WebView mobil sub presiune — exact conditiile in care
 *   timeout-ul chiar se declanseaza) lasa in urma un bitmap pe care nimeni nu-l
 *   mai inchide vreodata. Pe un import mare, esecurile se aduna, si fiecare
 *   scurgere face urmatoarea decodare si mai lenta — deci si mai probabil sa
 *   depaseasca timeout-ul: exact spirala de OOM pe care timeout-ul incerca s-o
 *   previna.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string, onAbandoned?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; reject(new Error(message)); }, ms);
    promise.then(
      v => {
        clearTimeout(timer);
        if (timedOut) { try { onAbandoned?.(v); } catch { /* curatenie best-effort, nu are ce raporta */ } return; }
        resolve(v);
      },
      e => { clearTimeout(timer); if (!timedOut) reject(e); }
    );
  });
}

/**
 * Cate slot-uri (workeri Human.js/TFJS in paralel) sa porneasca — un compromis
 * intre viteza (mai multi workeri = import mai rapid) si presiunea de RAM
 * (fiecare worker isi incarca propria instanta completa de modele). Pe un
 * Honor 8X cu 4GB RAM, 4 workeri simultan a dus la un crash real raportat de
 * utilizator; pe telefoane cu mult RAM (8GB+), plafonul fix de 4 lasa viteza
 * pe masa fara niciun motiv. `navigator.deviceMemory` (doar Chromium; undefined
 * pe Firefox/Safari) da o estimare aproximativa, rotunjita la puteri ale lui 2.
 * Folosita doar pe web/PWA — pe Android nativ, init() nu mai ajunge aici deloc.
 */
export function computeWorkerCount(cores: number, deviceMemoryGB: number | undefined): number {
  const coreBudget = Math.max(1, cores - 1);
  if (deviceMemoryGB === undefined) return Math.min(4, coreBudget);
  if (deviceMemoryGB <= 4) return 1; // acelasi prag ca prabusirea reala pe 4GB RAM
  if (deviceMemoryGB <= 6) return Math.min(4, coreBudget);
  return Math.min(6, coreBudget); // 8GB+: putem impinge peste plafonul vechi de 4
}

function deviceMemoryGB(): number | undefined {
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}

/**
 * Cate poze in paralel sa trimitem prin lantul de apeluri native secventiale
 * (core/nativeAnalysis.ts). Fiecare apel individual ruleaza deja secvential in
 * interior (nu Promise.all — bug real de OOM gasit la testare pe device cand
 * toate modulele rulau simultan), deci aceasta limita e despre CATE poze diferite
 * pot avea propriul lor lant in zbor deodata, nu despre modele in paralel per poza.
 *
 * Era fixat la 2, valoare aleasa cand fiecare apel ducea imaginea la rezolutie
 * plina (2048px, ~1,4 MB de base64 per apel) — acolo, mai multe poze in paralel
 * chiar insemnau zeci de MB in zbor. De cand modelele primesc copia mica
 * (NATIVE_ANALYZE_MAX_SIDE in nativeAnalysis.ts), o poza in zbor costa cateva
 * sute de KB, deci limita conservatoare lasa pur si simplu nuclee nefolosite pe
 * un telefon cu 8. Jumatate din nuclee, plafonat la 4, cu minimul vechi de 2 pe
 * hardware slab.
 */
function nativeAnalysisConcurrency(): number {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(2, Math.min(4, Math.floor(cores / 2)));
}

export class AnalysisPool {
  private slots: Slot[] = [];
  private waiters: ((slot: Slot) => void)[] = [];
  private ready = false;
  private modelBase = '';
  private knownPersons: KnownPerson[] = [];
  /** Backend TFJS efectiv folosit de worker-ul de referinta (primul initializat), sau 'native' pe Android. */
  detectedBackend = 'unknown';

  /** true doar pe Android nativ — analiza normala ocoleste complet workerii Human.js. */
  private nativeMode = false;
  private nativeConcurrencyLimit = nativeAnalysisConcurrency();
  private nativeInFlight = 0;
  private nativeWaiters: (() => void)[] = [];

  /**
   * Worker Human.js lazy, folosit DOAR de computeEnrollmentEmbedding() pe
   * native (recunoasterea nu are inca echivalent nativ) — separat de
   * `slots`/`detectedBackend` intentionat: nu vrem ca o inrolare rara de
   * "persoana cunoscuta" sa suprascrie `detectedBackend` ('native') citit de
   * store.ts pentru raportarea normala a importului.
   */
  private enrollmentSlot: Slot | undefined;
  private enrollmentSlotPromise: Promise<Slot> | undefined;

  /**
   * Al doilea worker Human.js lazy, separat de enrollmentSlot — foloseste
   * config-ul 'recognitionOnly' (mesh/iris/emotie/CenterNet dezactivate, vezi
   * faceAnalysis.worker.ts) si ruleaza pe FIECARE poza analizata nativ (nu doar
   * la inrolare, rara), deci trebuie sa ramana cel mai ieftin mod posibil.
   * UN singur worker (nu un pool) — recunoasterea per-fata ruleaza strict
   * serializata, indiferent de NATIVE_ANALYSIS_CONCURRENCY: cauza reala a
   * crash-urilor native anterioare (vezi comentariile din init()) a fost
   * presiunea de GPU/RAM a MAI MULTOR incarcari/inferente Human.js in paralel,
   * exact ce acest design evita structural.
   */
  private recognitionSlot: Slot | undefined;
  private recognitionSlotPromise: Promise<Slot> | undefined;

  get size(): number { return this.nativeMode ? this.nativeConcurrencyLimit : this.slots.length; }

  /** false = fara accelerare WebGL/WASM — analiza ruleaza dar fara detectie reala de fete. 'native' e mereu accelerat (NNAPI/GPU delegate pe device). */
  get isAccelerated(): boolean {
    return ['webgl', 'humangl', 'webgpu', 'wasm', 'native'].includes(this.detectedBackend);
  }

  /** true dupa primul init() reusit — util ca sa stim daca resizeForEconomicMode() are ce redimensiona acum sau doar la urmatorul import. */
  get isReady(): boolean { return this.ready; }

  private async spawnSlot(forcedBackend?: string, recognitionOnly = false): Promise<{ slot: Slot; backend: string }> {
    const worker = new Worker(
      new URL('../workers/faceAnalysis.worker.ts', import.meta.url),
      { type: 'module' }
    );
    const api = Comlink.wrap<FaceAnalysisAPI>(worker);
    const backend = await withTimeout(
      api.init(this.modelBase, readEconomicMode(), forcedBackend, recognitionOnly),
      MODEL_INIT_TIMEOUT_MS,
      'Incarcarea modelelor AI a durat prea mult — verifica conexiunea la internet.'
    );
    if (this.knownPersons.length) await api.setKnownPersons(this.knownPersons);
    return { slot: { worker, api, busy: false }, backend };
  }

  async init(): Promise<void> {
    if (this.ready) return;
    // Apelurile concurente asteapta aceeasi initializare, nu pornesc inca una:
    // `ready` devine true abia la final, deci doua apeluri pornite inainte de
    // asta ar fi incarcat modelele de doua ori, in paralel — pe un telefon,
    // exact clasa de varf de memorie care omoara WebView-ul.
    if (this.initInFlight) return this.initInFlight;
    this.initInFlight = this.doInit().finally(() => { this.initInFlight = null; });
    return this.initInFlight;
  }

  private initInFlight: Promise<void> | null = null;

  private async doInit(): Promise<void> {
    // masurat aici (nu doar primul slot) — AiBootScreen ramane vizibil pana la
    // finalul intregii metode (toti workerii), vezi modelLoadTiming.ts
    const startedAt = performance.now();

    if (Capacitor.isNativePlatform()) {
      // Niciun worker Human.js pornit aici — elimina structural pe Android
      // exact clasa de crash reparata anterior in sesiune (randare WebView
      // prabusita/OOM la "Se incarca modelele AI"), nu doar o atenueaza:
      // acel cod pur si simplu nu se mai executa la pornirea normala a
      // aplicatiei. Vezi core/nativeAnalysis.ts pentru pipeline-ul real.
      this.nativeMode = true;
      this.nativeConcurrencyLimit = readEconomicMode() ? 1 : nativeAnalysisConcurrency();
      this.detectedBackend = 'native';
      this.ready = true;
      writeLastModelLoadMs(performance.now() - startedAt);
      return;
    }

    this.slots = []; // in caz ca o incercare anterioara a esuat/timeout partial, nu dublam sloturile
    const cores = navigator.hardwareConcurrency || 4;
    // mod economic: un singur worker, in loc de pana la N in paralel — mai putina
    // presiune de RAM (fiecare worker isi incarca propria instanta Human.js/TFJS)
    // pe hardware slab, cu costul unui import mai lent. Altfel, numarul se
    // adapteaza dupa RAM-ul device-ului (vezi computeWorkerCount).
    const size = readEconomicMode() ? 1 : computeWorkerCount(cores, deviceMemoryGB());
    this.modelBase = new URL(`${import.meta.env.BASE_URL}models/`, location.href).href;

    // Doar PRIMUL worker face detectia completa de backend (WebGPU -> WebGL ->
    // CPU, cu toate timeout-urile din faceAnalysis.worker.ts) — restul, daca
    // sunt mai multi, primesc direct backend-ul deja gasit si il incearca pe
    // acela singur. Fara asta, pana la 4 workeri incercau simultan aceeasi
    // cascada completa, independent unul de altul: pe telefoane cu hardware
    // mai slab, presiunea de CPU/memorie a 4 incercari paralele de WebGL/WebGPU
    // + warmup complet de modele a fost suficienta cat sa intarzie semnificativ
    // inclusiv propriile timere de siguranta ale fiecarui worker — blocaje
    // reale raportate de utilizatori (minute intregi pe "Se incarca modelele
    // AI"), desi fiecare timeout individual e finit.
    const { slot: firstSlot, backend: firstBackend } = await this.spawnSlot();
    this.slots.push(firstSlot);
    this.detectedBackend = firstBackend;
    this.ready = true;

    if (size > 1) {
      const rest = await Promise.all(
        Array.from({ length: size - 1 }, () => this.spawnSlot(firstBackend))
      );
      this.slots.push(...rest.map(r => r.slot));
    }
    writeLastModelLoadMs(performance.now() - startedAt);
  }

  /**
   * Punctul UNIC prin care ajung persoanele la motorul de recunoastere — de-aia
   * se filtreaza aici, nu la fiecare apelant (sunt vreo zece, in store.ts,
   * importPipeline.ts si backupService.ts, si ar fi fost o chestiune de timp
   * pana cand unul ar fi fost uitat).
   *
   * Fara abonament, doar profilurile active ajung mai departe; restul raman in
   * baza de date, intacte, si se reactiveaza singure la reabonare. Vezi
   * core/activePersons.ts pentru de ce nu se sterg.
   */
  async setKnownPersons(persons: KnownPerson[]): Promise<void> {
    persons = selectActivePersons(persons);
    this.knownPersons = persons;
    await Promise.all(this.slots.map(s => s.api.setKnownPersons(persons)));
    if (this.enrollmentSlot) await this.enrollmentSlot.api.setKnownPersons(persons);
    if (this.recognitionSlot) await this.recognitionSlot.api.setKnownPersons(persons);
  }

  /**
   * Aplica noul mod economic la pool-ul DEJA pornit, fara reincarcarea paginii —
   * inainte, comutatorul din meniu doar scria setarea si cerea reload, fiindca
   * numarul de workeri SI configuratia Human.js (iris/emotie) sunt fixate la
   * spawn (spawnSlot() citeste readEconomicMode() direct). Nu putem doar sa
   * adaugam/scoatem workeri (numarul s-ar schimba, dar cei existenti ar ramane
   * cu iris/emotie din modul VECHI) — inlocuim intreaga flota cu una noua,
   * corect configurata, si abia apoi terminam workerii vechi (chiar daca sunt
   * "busy": analiza lor in curs va esua pe timeout, ca orice worker blocat —
   * importFiles trateaza deja acest caz ca un esec normal per-poza, nu ca o
   * eroare fatala de import).
   *
   * Pe native: reinterpretam acelasi comutator ca plafon de concurenta pentru
   * apelurile native (1 vs NATIVE_ANALYSIS_CONCURRENCY), nu pentru workeri
   * Human.js — setarea existenta din meniu ramane utila cross-platform fara
   * UI nou. `nativeInFlight`/`nativeWaiters` fac limita sigura de schimbat
   * oricand (chiar cu analize in zbor): disponibilitatea se recalculeaza
   * mereu ca `nativeInFlight < nativeConcurrencyLimit`, nu printr-un contor
   * care ar putea deveni negativ/incorect la o scadere in timpul unui import.
   */
  async resizeForEconomicMode(economic: boolean): Promise<void> {
    if (!this.ready) return; // inca nepornit — init() va citi setarea curenta la primul import
    if (this.nativeMode) {
      this.nativeConcurrencyLimit = economic ? 1 : nativeAnalysisConcurrency();
      while (this.nativeInFlight < this.nativeConcurrencyLimit && this.nativeWaiters.length > 0) {
        const next = this.nativeWaiters.shift();
        if (!next) break;
        this.nativeInFlight++;
        next();
      }
      return;
    }

    const cores = navigator.hardwareConcurrency || 4;
    const targetSize = economic ? 1 : computeWorkerCount(cores, deviceMemoryGB());
    const oldSlots = this.slots;

    // La fel ca in init(): backend-ul e deja cunoscut din flota curenta, asa ca
    // niciunul dintre workerii noi nu mai are nevoie sa repete cascada completa
    // de detectie — evita exact aceeasi presiune de CPU/memorie descrisa acolo.
    const spawned = await Promise.all(
      Array.from({ length: targetSize }, () => this.spawnSlot(this.detectedBackend))
    );
    this.slots = spawned.map(s => s.slot);
    this.detectedBackend = spawned[0]?.backend ?? this.detectedBackend;
    if (this.knownPersons.length) await Promise.all(this.slots.map(s => s.api.setKnownPersons(this.knownPersons)));

    for (const s of oldSlots) { try { s.worker.terminate(); } catch { /* deja mort, nu conteaza */ } }
  }

  private acquire(): Promise<Slot> {
    const free = this.slots.find(s => !s.busy);
    if (free) { free.busy = true; return Promise.resolve(free); }
    return new Promise(resolve => this.waiters.push(slot => { slot.busy = true; resolve(slot); }));
  }

  private release(slot: Slot): void {
    slot.busy = false;
    const next = this.waiters.shift();
    if (next) next(slot);
  }

  /**
   * Inlocuieste worker-ul unui slot blocat cu unul nou, curat — altfel un
   * singur fisier problematic ar pierde definitiv acel slot din pool (worker-ul
   * vechi ramane "busy" pentru totdeauna in mintea noastra, fara sa mai
   * raspunda niciodata), reducand treptat concurenta pana la zero pe o
   * biblioteca mare cu mai multe poze problematice.
   */
  private async respawnSlot(slot: Slot): Promise<void> {
    try { slot.worker.terminate(); } catch { /* deja mort, nu conteaza */ }
    try {
      const { slot: fresh } = await this.spawnSlot(this.detectedBackend);
      slot.worker = fresh.worker;
      slot.api = fresh.api;
    } catch (err) {
      console.error('Nu am putut reporni worker-ul dupa timeout:', err);
    }
  }

  private acquireNativePermit(): Promise<void> {
    if (this.nativeInFlight < this.nativeConcurrencyLimit) { this.nativeInFlight++; return Promise.resolve(); }
    return new Promise(resolve => this.nativeWaiters.push(resolve));
  }

  /**
   * Bug real gasit de auditul QA: varianta veche preda permisul urmatorului
   * din coada NECONDITIONAT (`const next = shift(); if (next) { inFlight++;
   * next(); }`), fara sa mai verifice plafonul — exact ce comentariul de la
   * resizeForEconomicMode promitea ca NU se poate intampla ("disponibilitatea
   * se recalculeaza mereu ca nativeInFlight < nativeConcurrencyLimit, nu
   * printr-un contor care ar putea deveni... incorect la o scadere in timpul
   * unui import").
   *
   * Scenariu concret, reprodus in test: import in curs pe Android cu plafonul
   * normal (2-4 poze in zbor), utilizatorul comuta "mod economic" din meniu la
   * mijlocul importului -> resizeForEconomicMode(true) coboara plafonul la 1,
   * dar fiecare analiza terminata readmitea imediat o alta din coada, deci
   * numarul REAL de poze in zbor ramanea la vechiul plafon pana la finalul
   * lotului. Adica exact momentul in care setarea conteaza cel mai mult (import
   * mare pe telefon slab, presiune de RAM) era singurul in care nu facea nimic.
   */
  private releaseNativePermit(): void {
    this.nativeInFlight--;
    if (this.nativeInFlight >= this.nativeConcurrencyLimit) return; // plafon coborat intre timp — nu mai admitem pe nimeni
    const next = this.nativeWaiters.shift();
    if (next) { this.nativeInFlight++; next(); }
  }

  /** Analizează o fotografie. Bitmap-ul e transferat (nu copiat) și închis în worker — sau, pe native, închis direct în nativeAnalysis.ts. `mediaUri` (Android, poze din galerie) lasa partea nativa sa citeasca imaginea singura, fara nimic peste punte. */
  async analyze(photoId: string, bitmap: ImageBitmap, mediaUri?: string): Promise<AnalysisRecord> {
    if (this.nativeMode) {
      await this.acquireNativePermit();
      try {
        return await withTimeout(
          analyzeNative(
            photoId,
            bitmap,
            // Recunoasterea per-fata e utila (si platita ca timp) doar cand exista
            // cel putin o persoana inrolata — fara acest gard, fiecare fata din
            // fiecare poza ar trece prin worker-ul de recunoastere chiar si pentru
            // utilizatorii care nu folosesc deloc "Persoane cunoscute".
            this.knownPersons.length ? crop => this.computeFaceRecognitionEmbedding(crop) : undefined,
            this.knownPersons,
            // content:// din galerie, cand exista — vezi analyzeNative: cu el,
            // imaginea nu mai trece deloc peste puntea Capacitor.
            mediaUri
          ),
          ANALYZE_TIMEOUT_MS,
          'Analiza acestei fotografii a durat prea mult (posibil fisier problematic) — sarita.'
        );
      } finally {
        this.releaseNativePermit();
      }
    }

    const slot = await this.acquire();
    try {
      return await withTimeout(
        slot.api.analyze(photoId, Comlink.transfer(bitmap, [bitmap])),
        ANALYZE_TIMEOUT_MS,
        'Analiza acestei fotografii a durat prea mult (posibil fisier problematic) — sarita.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('a durat prea mult')) await this.respawnSlot(slot);
      throw err;
    } finally {
      this.release(slot);
    }
  }

  /** Reface (lazy, o singura data) worker-ul Human.js dedicat inrolarii pe native — vezi comentariul de la `enrollmentSlot`. */
  private ensureEnrollmentSlot(): Promise<Slot> {
    if (this.enrollmentSlot) return Promise.resolve(this.enrollmentSlot);
    if (!this.enrollmentSlotPromise) {
      this.enrollmentSlotPromise = this.spawnSlot().then(async ({ slot }) => {
        // Bug real gasit de auditul QA: acest apel Comlink NU avea niciun timeout,
        // spre deosebire de restul apelurilor din acest fisier — daca se bloca din
        // orice motiv (worker ocupat/raspuns pierdut), intreaga inrolare ramanea
        // agatata la infinit, fara nicio eroare vizibila si fara nicio recuperare.
        if (this.knownPersons.length) {
          await withTimeout(slot.api.setKnownPersons(this.knownPersons), MODEL_INIT_TIMEOUT_MS, 'Configurarea persoanelor cunoscute a durat prea mult.');
        }
        this.enrollmentSlot = slot;
        return slot;
      });
      // Bug real gasit de auditul QA: un esec aici (spawn/init SAU setKnownPersons)
      // nu reseta niciodata enrollmentSlotPromise — prima incercare esuata/blocata
      // "otravea" promisiunea memorata pentru tot restul sesiunii, facand orice
      // incercare ULTERIOARA de inrolare sa esueze instantaneu, fara sa mai
      // porneasca vreodata un worker nou, pana la restart complet al aplicatiei.
      this.enrollmentSlotPromise.catch(() => { this.enrollmentSlotPromise = undefined; });
    }
    return this.enrollmentSlotPromise;
  }

  /** Înrolare persoană cunoscută: returnează embedding-ul feței principale + numărul de fețe detectate (vezi worker pentru bug-ul de avertizare). */
  async computeEnrollmentEmbedding(bitmap: ImageBitmap): Promise<{ embedding: number[]; faceCount: number } | null> {
    if (this.nativeMode) {
      const slot = await this.ensureEnrollmentSlot();
      try {
        return await withTimeout(
          slot.api.computeEnrollmentEmbedding(Comlink.transfer(bitmap, [bitmap])),
          ANALYZE_TIMEOUT_MS,
          'Procesarea acestei poze de referinta a durat prea mult.'
        );
      } catch (err) {
        if (err instanceof Error && err.message.includes('a durat prea mult')) {
          try { slot.worker.terminate(); } catch { /* deja mort, nu conteaza */ }
          this.enrollmentSlot = undefined;
          this.enrollmentSlotPromise = undefined;
        }
        throw err;
      }
    }

    const slot = await this.acquire();
    try {
      return await withTimeout(
        slot.api.computeEnrollmentEmbedding(Comlink.transfer(bitmap, [bitmap])),
        ANALYZE_TIMEOUT_MS,
        'Procesarea acestei poze de referinta a durat prea mult.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('a durat prea mult')) await this.respawnSlot(slot);
      throw err;
    } finally {
      this.release(slot);
    }
  }

  /** Reface (lazy, o singura data) worker-ul Human.js 'recognitionOnly' — vezi comentariul de la `recognitionSlot`. */
  private ensureRecognitionSlot(): Promise<Slot> {
    if (this.recognitionSlot) return Promise.resolve(this.recognitionSlot);
    if (!this.recognitionSlotPromise) {
      this.recognitionSlotPromise = this.spawnSlot(undefined, true).then(async ({ slot }) => {
        // Acelasi bug real (fara timeout) ca la ensureEnrollmentSlot — vezi comentariul de acolo.
        if (this.knownPersons.length) {
          await withTimeout(slot.api.setKnownPersons(this.knownPersons), MODEL_INIT_TIMEOUT_MS, 'Configurarea persoanelor cunoscute a durat prea mult.');
        }
        this.recognitionSlot = slot;
        return slot;
      });
      // Acelasi bug real (promisiune "otravita" definitiv la primul esec) ca la
      // ensureEnrollmentSlot — vezi comentariul de acolo.
      this.recognitionSlotPromise.catch(() => { this.recognitionSlotPromise = undefined; });
    }
    return this.recognitionSlotPromise;
  }

  /**
   * Recunoastere per-fata pe native: primeste un decupaj MIC (o singura fata,
   * deja localizata de ML Kit — vezi core/nativeAnalysis.ts) si returneaza
   * embeddingul ei, folosind acelasi worker Human.js lazy pentru toate fetele
   * din TOATE pozele native — vezi comentariul de la `recognitionSlot` pentru
   * motivul serializarii stricte. Esecul (timeout/eroare) e tratat de apelant
   * (nativeAnalysis.ts) ca "nicio potrivire" pentru acea fata, nu ca eroare
   * fatala a analizei intregii poze.
   */
  async computeFaceRecognitionEmbedding(bitmap: ImageBitmap): Promise<{ embedding: number[]; faceCount: number } | null> {
    const slot = await this.ensureRecognitionSlot();
    try {
      return await withTimeout(
        slot.api.computeEnrollmentEmbedding(Comlink.transfer(bitmap, [bitmap])),
        ANALYZE_TIMEOUT_MS,
        'Recunoasterea acestei fete a durat prea mult.'
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes('a durat prea mult')) {
        try { slot.worker.terminate(); } catch { /* deja mort, nu conteaza */ }
        this.recognitionSlot = undefined;
        this.recognitionSlotPromise = undefined;
      }
      throw err;
    }
  }
}

export const analysisPool = new AnalysisPool();
