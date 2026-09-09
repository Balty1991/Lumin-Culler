# Lumin Culler Pro — cercetare tehnică, produs și conținut
**Data:** 8 septembrie 2026 · **Ramura:** `claude/app-market-research-improvements-javylj` · **Niciun fișier din repo nu a fost modificat.**

---

## 0. Legenda de dovadă (se aplică la fiecare afirmație din raport)

| Marcaj | Ce înseamnă |
|---|---|
| **[M]** | **Măsurat** — cifră din măsurătoarea ta de pe telefon real, sau dintr-o comandă rulată de mine aici (`npm test`, `tsc`, `wc`, `grep`). |
| **[C]** | **Citit din cod** — am deschis fișierul și linia. Dau calea și linia. |
| **[D]** | **Documentat de o sursă** — link la sfârșit. |
| **[X]** | **Calculat** — aritmetică pe [M] + [C]. Arăt calculul ca să-l poți verifica. |
| **[?]** | **Presupus** — nu am dovadă. Spun explicit ce experiment îl confirmă sau îl infirmă. |

Verificări de igienă rulate azi, pe ramura ta, fără să ating nimic:
- `npx tsc --noEmit` → curat **[M]**
- `npm run lint` (eslint src) → curat **[M]**
- `npm test` → **186 fișiere, 2217 teste, toate trec, 89s** **[M]**

Codul e sănătos. Nimic din raportul ăsta nu e despre „e prost scris". E despre arhitectură, despre unde se duce timpul, și despre ce se vinde.

---

# PARTEA I — IPOTEZA DE PARALELISM: **INFIRMATĂ ÎN FORMA EI, ÎNLOCUITĂ CU O CAUZĂ MAI PROASTĂ ȘI MAI REPARABILĂ**

Ipoteza ta: *„ML Kit și MediaPipe sunt deja multi-fir intern și saturează procesorul cu o singură poză. Dacă e adevărată, singurul lucru care mai ajută e reducerea muncii PE POZĂ."*

**Nu e adevărată așa cum e formulată.** Nu procesorul e saturat. Sunt saturate **trei fire unice**, prin construcție, iar două dintre ele nici măcar nu execută modele — doar le dispecerizează.

## 1.1 Firul unic al Capacitorului — dovedit din sursă, nu presupus

`node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java` **[C]**:

```java
138:  private final HandlerThread handlerThread = new HandlerThread("CapacitorPlugins");
217:  taskHandler = new Handler(handlerThread.getLooper());
...
839:  Runnable currentThreadTask = () -> { plugin.invoke(methodName, call); ... };
854:  taskHandler.post(currentThreadTask);
```

**Fiecare apel de plugin din toată aplicația trece prin `taskHandler`, adică prin UN SINGUR `HandlerThread`.** Nu e o opinie, sunt 4 linii de cod. Este și o limitare cunoscută public: ionic-team/capacitor#6861 descrie exact același simptom (un plugin lung blochează în coadă toate celelalte apeluri de plugin), iar soluția propusă acolo e înlocuirea `HandlerThread`-ului cu un `ExecutorService` **[D]**.

Acum: care dintre plugin-urile tale își fac treaba **sincron, în corpul metodei**, adică **pe acel fir unic**?

| Plugin | Sincron pe firul Capacitor? | Sursă **[C]** |
|---|---|---|
| `FaceMeshPlugin.analyzeFaceMesh` | **DA** — `faceLandmarkerHolder.use { it.detect(mpImage) }` direct în `analyze()`, apelat sincron din metodă | `FaceMeshPlugin.kt:53-63` |
| `PoseDetectionPlugin.detectPose` | **DA** — `poseLandmarkerHolder.use { it.detect(mpImage) }` | `PoseDetectionPlugin.kt:52-62` |
| `ImageEmbedderPlugin.embedImage` | **DA** — `imageEmbedderHolder.use { it.embed(mpImage) }` | `ImageEmbedderPlugin.kt:52-62` |
| `ImageAnalysisPlugin.analyze` | **DA** pe calea normală — `call.resolve(runAnalysis(bitmap, primite))` direct | `ImageAnalysisPlugin.kt:92-101` |
| `FaceDetectionPlugin` | NU pentru inferență (ML Kit întoarce un `Task`) — **DAR decodarea nativă rămâne sincronă** | `FaceDetectionPlugin.kt:79` → `resolveInputBitmap` |
| `ImageLabelingPlugin` | idem | `ImageLabelingPlugin.kt:85` |
| `TextRecognitionPlugin` | idem | — |

Și, **pentru toate șapte**, `resolveInputBitmap(context, call)` → `decodeUriCached(...)` → `decodeUri(...)` rulează **sincron pe același fir unic**: `BitmapFactory.decodeStream` + `Bitmap.createScaledBitmap` + rotație EXIF (`BitmapUtils.kt:150-195`, `290-320`) **[C]**.

**Suma modelelor care rulează sincron pe firul unic al Capacitorului, din tabelul tău [M]:**

```
ImageAnalysis    133,2 s
PoseDetection     73,7 s
FaceMesh          54,5 s
ImageEmbedder     13,7 s
─────────────────────────
TOTAL            275,1 s   = 40% din munca modelelor, pe UN singur fir
```

...plus decodarea nativă a fiecărei poze pentru fiecare dintre cele 4-7 apeluri, plus dispecerizarea celor 3 apeluri ML Kit, **plus** o scriere pe disc cu lacăt global la fiecare intrare și ieșire din model (vezi 1.4).

Peste asta: **`ImageAnalysis` a devenit sincron abia recent.** Commit-ul `fe5a1f1` „O singură detecție de fețe pe poză, nu două" a scos detectorul FAST propriu al lui `ImageAnalysisPlugin` și a mutat plugin-ul pe calea `cutiiPrimite(call) != null` → `runAnalysis()` sincron **[C]** (`ImageAnalysisPlugin.kt:92-101`). Înainte, munca de matematică se făcea în `addOnSuccessListener`, adică **pe firul ML Kit, nu pe firul Capacitorului**. Schimbarea a redus munca totală (o detecție în loc de două — corect), dar a mutat 133 s de calcul pur pe firul care era deja gâtul sticlei. **Este posibil ca acel commit să fi făcut importul mai lent, nu mai rapid, în ciuda faptului că face mai puțină muncă.** **[?]** — testul e trivial: măsoară un import înainte și după `fe5a1f1`.

## 1.2 Firul principal JS — al doilea gât de sticlă

Pe Android nativ, `AnalysisPool.doInit()` iese devreme și **nu pornește niciun Web Worker** (`workerPool.ts:222-232`) **[C]**. Deci **tot** ce face `importPipeline.ts` + `nativeAnalysis.ts` rulează pe firul principal al WebView-ului, alături de randarea UI-ului și a barei de progres:

- `decode()` → `createImageBitmap(file, {resizeWidth: 2048})` + `capToPreviewSize` (canvas 2048px) — `importPipeline.ts:334-393` **[C]**
- `makeDerivatives()` — **patru canvas-uri**, dintre care unul la 2048px plin, plus `getImageData` + `toDataURL` — `importPipeline.ts:538-582` **[C]**
- `drawToCanvas(bitmap)` — **al cincilea canvas**, iarăși la rezoluție plină — `nativeAnalysis.ts:130-136` **[C]**
- parsarea JSON a fiecărui răspuns de plugin (FaceMesh: până la 15 fețe cu blendshapes; Pose: până la 8 persoane × 33 puncte × 4 câmpuri ≈ 1000+ numere per poză)
- EXIF + IPTC, tranzacția Dexie, `contextEngine.predict()`

## 1.3 Al treilea gât de sticlă: worker-ul de recunoaștere, **și el nu apare deloc în tabelul tău**

`workerPool.ts:451-476` **[C]**: `computeFaceRecognitionEmbedding()` folosește **un singur** worker Human.js/TFJS (`recognitionSlot`), strict serializat pentru **toate fețele din toate pozele**, indiferent de `nativeAnalysisConcurrency`. Comentariul din cod spune explicit de ce: presiunea de GPU/RAM.

`nativeAnalysis.ts:283-315` (`recognizeFaces`) **NU e învelit în `timedModel()`** **[C]**. Până la 6 fețe per poză, fiecare cu un `createImageBitmap` de decupaj + o inferență TFJS completă, **serializate global** — și **invizibile în cele 692,4 s**.

Dacă testerul avea măcar o persoană înrolată, asta e cea mai mare gaură din măsurătoare.

## 1.4 Instrumentul de diagnostic e el însuși o serializare

`CrashLog.pas()` (`CrashLog.kt:88-98`) **[C]**: `synchronized(lacat) { f.appendText(text + "\n") }` — **lacăt global + scriere pe disc**, chemată la `>NUME` și `<NUME` pentru fiecare model. Asta înseamnă **~14 scrieri sincronizate pe disc per poză**, din 3-4 fire, adică ~2800 pe un lot de 201. Comentariul recunoaște costul („Îl plătim bucuroși"), dar a fost scris când modelele rulau strict secvențial. Acum e un mutex global pe calea fierbinte.

## 1.5 Aritmetica: unde se duc de fapt secundele **[X]**

Pornesc de la cifrele tale **[M]** și de la cod **[C]**:

```
201 poze / 495 s                          = 0,406 poze/s
Sumă timpi de model / poză = 692,4 / 201  = 3,44 s
importFiles concurrency = analysisPool.size + 1     (importPipeline.ts:955)
analysisPool.size (native) = max(2, min(4, cores/2)) (workerPool.ts:139-142)
  → pe un telefon cu 8 nuclee: 4 permise, 5 lucrători în buclă
```

Faza „analiză" ia 85% din timpul pe poză, deci **numărul mediu de poze aflate simultan în faza de analiză = 5 × 0,85 = 4,25**. Verificare încrucișată cu măsurătoarea ta: 10,9 s (analiză/poză) × 0,406 poze/s = **4,43**. Se potrivesc. ✔ Modelul e corect.

Din cele 4,25, **4** stau în permis (plafonul) și ~0,25 așteaptă. Deci:

```
timp în permis / poză = 4 permise / 0,406 poze-s⁻¹ = 9,85 s
sumă timpi de model / poză                        = 3,44 s
────────────────────────────────────────────────────────────
NEMĂSURAT, în interiorul analizei                 ≈ 6,4 s / poză  (65%)
```

Și e o limită inferioară: în interiorul unei poze, `timedModel`-urile **se suprapun** (`labelPromise` merge în paralel cu `FaceDetection`; `FaceMesh`+`Embedder`+`Pose` sunt într-un `Promise.all`) **[C]** — deci drumul critic al modelelor e **sub** 3,44 s, iar gaura e **peste** 6,4 s.

**Aproape două treimi din faza de analiză nu sunt măsurate de niciun `timedModel()`.** Candidații, în ordinea probabilității:
1. worker-ul de recunoaștere serializat (1.3) — dacă există persoane înrolate;
2. `drawToCanvas` + parsarea JSON + marshalling-ul punții, pe firul principal JS;
3. așteptarea în coada firului Capacitor **între** apeluri (partea dinaintea dispecerizării).

## 1.6 Și o distorsiune a tabelului însuși

`timedModel()` măsoară **de la cererea JS până la răspunsul JS** (`analysisTiming.ts:44-52`) **[C]**. Pe un fir unic, asta include **așteptarea în spatele celorlalte 3 poze din zbor**. Deci:

> **„FaceDetection = 33%" nu înseamnă „detectorul de fețe consumă 33% din CPU".** Înseamnă „primul apel din lanțul fiecărei poze absoarbe coada acelei poze".

`FaceDetection` e primul `await` din `analyzeNative` (`nativeAnalysis.ts:398`) **[C]** — exact poziția care încasează toată coada. Asta explică de ce un detector ML Kit ACCURATE, care pe un telefon modern costă de obicei 60-150 ms per cadru, apare aici la **1,13 s per poză** (227,4/201).

**Concluzie fermă:** ordinea din tabel e ordinea **poziției în lanț**, nu a costului real. Orice decizie luată doar pe procentele alea (inclusiv „GPU nu merită", care se poate totuși să fie corectă din alte motive) stă pe o măsurătoare care amestecă lucru cu așteptare.

## 1.7 Ce infirmă concret partea „ML Kit e multi-fir și saturează CPU"

Documentația `FaceDetectorOptions.Builder.setExecutor(Executor)` există și spune că, în lipsa unuia, ML Kit folosește **„an internal background thread pool"** — un pool, nu un fir, și nu o promisiune că saturează procesorul **[D]**. Deci ML Kit **poate** rula mai multe detecții în paralel; nimic nu-l oprește la nivel de API. Iar cele patru modele care chiar sunt serializate prin construcție (1.1) nu sunt ML Kit, ci MediaPipe și Kotlin propriu, ținute în loc de Capacitor.

## 1.8 Încălzirea nu e un efect secundar, e o parte din cifră

Nu există **nicio** gestionare termică: `PowerManager`, `getCurrentThermalStatus`, `addThermalStatusListener`, `getThermalHeadroom` — **zero apariții** în tot `android/` **[M]** (`grep -rn` peste tot arborele).

Sursă: pe un flux susținut de inferență, un Snapdragon 8 Gen 2 care atinge `THERMAL_STATUS_MODERATE` pierde tipic **30-40% din debit**, iar coborârea la un mod mai ieftin recuperează cea mai mare parte, fiindcă scade și presiunea pe lățimea de bandă a memoriei, nu doar pe calcul **[D]**.

**Deci cei 2,46 s/poză nu sunt un cost de calcul — sunt un cost de calcul plus o penalizare termică crescătoare.** Un import de 8 minute își petrece a doua jumătate throttled. Asta înseamnă și că orice reducere de muncă are **randament supraunitar**: mai puțin lucru → telefon mai rece → restul lotului merge mai repede decât aritmetica simplă prezice.

---

# PARTEA A — INVENTAR ȘI EVALUARE

## A.1 Motoarele de analiză (Android nativ)

Legenda coloanei „Cost": secundele sunt din tabelul tău **[M]**, cu avertismentul de la 1.6 (includ coadă).

### 1. `FaceDetection` — ML Kit `face-detection:16.1.7`, bundled
- **Ce face [C]:** două detectoare. Cel principal: `PERFORMANCE_MODE_ACCURATE` + `CLASSIFICATION_MODE_ALL` → cutii + `smilingProbability` + `leftEyeOpenProbability`/`rightEyeOpen…`. Al doilea (`fast`): `FAST` + fără clasificare/contur/landmark, doar pentru pre-scanarea de ordonare.
- **Cost [M]:** 227,4 s (33%) — **dar vezi 1.6**; e primul din lanț și încasează coada.
- **Cât de bine [D/C]:** modelul bundled e cel din exemplul oficial Google (`googlesamples/mlkit` fixează tot `face-detection:16.1.7` — verificat azi din `build.gradle`-ul lor **[M]**). Deci nu ești în urmă cu versiunea. `faceScore: 1` e o constantă, nu o măsurătoare (`nativeAnalysis.ts:216`) — corect documentat în cod, dar înseamnă că `PRIOR_WEIGHTS.faceScore: 0.4` (`ContextEngine.ts`) se aplică peste o valoare fixă, adică **e o pondere care nu face nimic pe Android**. **[C]** Pe web are sens; pe native, e o trăsătură moartă.
- **Ce se strică fără el:** tot. Fețe, zâmbete, ochi, `sceneType`, recunoaștere, cutiile pentru `ImageAnalysis`, gruparea. E fundația.
- **`setMinFaceSize` nu e setat** → implicit 0,1 (fața ≥10% din latura imaginii) **[D]**. Ridicarea lui ar accelera detecția vizibil, dar **schimbă rezultatele**. Nu înainte de lansare.

### 2. `ImageLabeling` — ML Kit `image-labeling:17.0.9`, bundled
- **Ce face [C]:** ~400+ etichete Open Images, prag 0,6, max 8 returnate.
- **Cost [M]:** 170,3 s (25%).
- **Cât de bine:** înlocuirea COCO-SSD (80 clase, fără clasă de rezervă) a fost decizia corectă și e bine documentată în cod. Versiunea e cea din exemplul oficial Google **[M]**.
- **Ce se strică fără el:** căutarea după subiect, numele folderelor la export, gruparea pe cauze, `hasManufacturedTag` (declanșatorul OCR), `subjectAffinity`/`contentAffinity` din ContextEngine, filtrul de etichete de scenă. **Ai dreptate că nu poate fi sărit.** Confirmat prin urmărirea consumatorilor **[C]**.
- **Observație:** rulează în paralel cu `FaceDetection` (`labelPromise`) — corect ca intenție, dar pe firul unic Capacitor ambele se pun oricum la coadă.

### 3. `ImageAnalysis` — Kotlin propriu, `ImageMath.kt`
- **Ce face [C]:** claritate (Laplacian + subiect), expunere, clipping, Sobel → linii directoare / simetrie / spațiu negativ / calitatea luminii, focus/bokeh, culoare + golden hour, orizont (doar fără fețe), agregare compoziție. Toate pe un buffer **320×320** (+ 360px separat pentru orizont).
- **Cost [M]:** 133,2 s (19%) = **663 ms per poză**.
- **Aici e cea mai mare anomalie din tot raportul.** 320×320 = 102 400 pixeli. Vreo 10-12 treceri peste bufferul ăsta înseamnă ~1,2 milioane de operații în Kotlin compilat AOT. Pe un telefon modern asta e **de ordinul a 10-30 ms**, nu 663. **[?]** Diferența de ~20-60× nu poate veni din matematică. Vine din: (a) coada firului Capacitor, (b) `resolveInputBitmap` → decodarea nativă (care **și ea** e pe firul ăla și e atribuită primului apelant care ratează cache-ul), (c) `Bitmap.createScaledBitmap(bitmap, 320, 320, true)` cu filtrare, plus `getPixels` (409 KB de `IntArray`).
  → **Verificare directă, ieftină:** pune un `System.nanoTime()` în jurul lui `runAnalysis()` (doar el, nu și decodarea) și loghează. Dacă iese sub 50 ms, cele 133 s sunt **aproape în întregime coadă și decodare**, și atunci mutarea de fire (§C.1) le șterge fără să atingi o formulă.
- **Ce se strică fără el:** claritatea, expunerea, compoziția, bokeh-ul, culoarea, orizontul — adică jumătate din scor și aproape toate „De ce acest scor". Indispensabil.

### 4. `PoseDetection` — MediaPipe `pose_landmarker_lite.task`
- **Ce face [C]:** 33 de puncte × până la 8 persoane → **un singur boolean**, `bodyCroppedAtEdge` (`nativeAnalysis.ts:262-274`).
- **Cost [M]:** 73,7 s (11%).
- **Cât de bine:** comentariul din propriul tău cod spune „**NEVERIFICAT pe un set mare de poze reale**" **[C]**. Ponderea e −0,3 în `PRIOR_WEIGHTS`, plus intră în `decisionReasons` (`pose`) și în lista de trăsături ContextEngine **[C]**.
- **Raportul valoare/cost e cel mai prost din toată aplicația:** 11% din munca modelelor pentru un bit necalibrat. Plus `pose_landmarker_lite.task` în APK, plus JSON-ul de ~1000 de numere per poză peste punte, parsat pe firul principal.
- **Ce se strică fără el:** scorurile se schimbă (deci nu se poate scoate înainte de 30 septembrie). După lansare: candidatul nr. 1 la „calibrează-l sau scoate-l".

### 5. `FaceMesh` — MediaPipe `face_landmarker.task`, `numFaces=15`, blendshapes + matrici
- **Ce face [C]:** 478 puncte + 52 blendshapes + matrice de transformare per față → agregat în `groupGenuineSmileRatio`, `groupAwkwardRatio`, `avgEngagement`, `avgEyeContact`.
- **Cost [M]:** 54,5 s (8%).
- **Cât de bine:** `groupGenuineSmileRatio` (marker Duchenne) e, după propriile comentarii, **calibrat pe date reale** — spre deosebire de restul. E semnalul „de calitate" al aplicației. `eyeContact` din matricea de transformare e curat.
- **Redundanță deliberată și scumpă [C]:** rulează un **al doilea detector de fețe complet independent** pe același cadru, iar codul recunoaște explicit că nu potrivește fețele 1:1 cu ML Kit („ar necesita o euristică de suprapunere casete fragilă"). Deci plătești două detecții de fețe pe fiecare poză cu oameni — exact ce commit-ul `fe5a1f1` tocmai a eliminat pentru `ImageAnalysis`, dar rămâne aici.
- **Ce se strică fără el:** zâmbetul autentic, expresia stânjenitoare, contactul vizual, angajamentul — semnale care apar direct în explicații și în badge-urile de pe carduri.

### 6. `TextRecognition` — ML Kit `text-recognition:16.0.1`, bundled
- **Cost [M]:** 19,6 s (3%). Rulează rar și condiționat (`faces.length === 0 && (!pickFolderSceneTag || hasManufacturedTag)`) **[C]**.
- **Evaluare: excelent raport preț/valoare.** Alimentează `textCoverage` (scutul de documente), `ocrText` (căutarea „bonul de la service"), și e singurul model care primește rezoluție mai mare (2560px). Nu-l atinge.

### 7. `ImageEmbedder` — MediaPipe `mobilenet_v3_small.tflite`
- **Cost [M]:** 13,7 s (2%). Doar pe poze fără fețe **[C]**.
- **Evaluare: bun.** Dă „a doua opinie" la gruparea rafalelor fără oameni în `hashCompare.worker.ts:269,302`. Ieftin, cu consumator real. Nu-l atinge.

### 8. `Segmentation` — MediaPipe `selfie_segmenter.tflite` (**în afara lanțului de import**)
- Header-ul din `nativeAnalysis.ts` spune că a fost **ȘTERS** — dar `SegmentationPlugin` e încă înregistrat (`MainActivity.java:113`), `selfie_segmenter.tflite` e încă descărcat de `release-android.yml:166`, și `EditPanel.tsx:781,827` chiar îl folosește pentru bokeh **[C]**. **Comentariul e greșit, codul e corect.** De reparat comentariul, nu codul.

### 9. `ImageDescription` — ML Kit GenAI / Gemini Nano prin AICore, `1.0.0-beta1`
- **Ce face [C]:** descriere scrisă a unei poze, la cerere, din `ContextMenu`, o poză odată, cu descărcare de model separată.
- **Cost:** zero în import (nu e în lanț).
- **Evaluare: cea mai subutilizată piesă din toată aplicația.** Vezi §F.

### 10. `MediaLibrary`, `HeicDecoder`, `Billing`, `Diagnostics`, `FolderExport`, `Notifications`
- Infrastructură, corect făcută. `BillingPlugin` e pe Play Billing 9.0.0, cu suport complet de oferte/probe gratuite deja implementat (`BillingPlugin.kt:245-310`) **[C]** — vezi §F.3, e o pârghie de venit fără nicio linie de cod nouă.

## A.2 Costuri care nu apar în tabel

| Element | Cost | Sursă |
|---|---|---|
| `prioritizeFacesFirst` — pre-scanare pe primele **150** poze, decodare 640px + detecție FAST | faza „pregătire", **nemăsurată în tabel**; codul citează un raport de utilizator de „~2 minute" pe un lot de 437 înainte de optimizare | `importPipeline.ts:427-535` **[C]** |
| `recognizeFaces` — până la 6 fețe/poză, TFJS, **serializat global** | **nemăsurat** | `nativeAnalysis.ts:283-315` **[C]** |
| `drawToCanvas` — canvas 2048px pe firul principal, **complet nefolosit** dacă ai `mediaUri` și zero persoane înrolate | nemăsurat | `nativeAnalysis.ts:130-136, 380-390` **[C]** |
| `makeDerivatives` — 4 canvas-uri, unul la 2048px | 1% („derivate") | `importPipeline.ts:538-582` **[C]** |
| `CrashLog.pas` — lacăt global + scriere pe disc, ~14×/poză | nemăsurat | `CrashLog.kt:88-98` **[C]** |
| `toFiles` — `fetch(convertFileSrc(uri))` citește **toți octeții** fiecărei poze în JS înainte de import | faza „citire" | `nativeMediaLibrary.ts:196-222` **[C]** |

---

# PARTEA B — ALTERNATIVE ȘI CORECȚII TEHNICE

## B.1 Versiuni: ești la zi, cu o excepție de discutat

Verificat azi din `build.gradle`-ul repo-ului oficial de exemple Google (`googlesamples/mlkit`, branch master) **[M]**:

| Dependință | Tu ai | Exemplul oficial Google | Verdict |
|---|---|---|---|
| `com.google.mlkit:face-detection` | 16.1.7 | **16.1.7** | la zi |
| `com.google.mlkit:image-labeling` | 17.0.9 | **17.0.9** | la zi |
| `com.google.mlkit:text-recognition` | 16.0.1 | **16.0.1** | la zi |
| `com.google.mediapipe:tasks-vision` | 0.10.29 | — | vezi mai jos |

**Excepția:** există și varianta *neîmpachetată*, livrată prin Play Services — `com.google.android.gms:play-services-mlkit-face-detection:17.1.0`. Notele de versiune ML Kit descriu pentru varianta actualizată **„improved recall, latency for accurate mode, and reduced apk size impact from 11.6 MB to 6.9 MB"** **[D]**.
- **Câștig așteptat:** latență mai bună exact în modul pe care îl folosești (ACCURATE) + APK mai mic.
- **Risc: MARE, și de produs, nu tehnic.** Rupe promisiunea „100% pe dispozitiv, funcționează imediat după instalare, fără Play Services" — care e chiar tagline-ul tău și e scrisă în comentariile din `build.gradle`. Modelul se descarcă la prima folosire.
- **Recomandare: NU.** Nu strica argumentul de vânzare pentru 5% viteză.

MediaPipe: stiva din 2026 e **LiteRT 2.x** ca runtime, MediaPipe Tasks pentru vision, Gemini Nano prin ML Kit pentru limbaj; noutatea principală din LiteRT 2.x e API-ul `CompiledModel` pentru accelerare hardware, plus delegați NPU furnizați de producătorii de cipuri (ex. Qualcomm AI Engine Direct) **[D]**. **Nu recomand mutarea acum** — e o rescriere, iar decizia ta despre GPU (că nu merită la 21% din timp) se aplică la fel și aici, cu risc mai mare.

## B.2 Alternativa mare: **FaceLandmarker în locul lui FaceDetection + FaceMesh**

MediaPipe Face Landmarker întoarce, într-un singur apel, pentru **fiecare** față: 478 de puncte, **52 de blendshapes** (inclusiv `mouthSmileLeft/Right`, `eyeBlinkLeft/Right`) și matricea de transformare **[D]**. Adică:

| Ce iei azi din ML Kit FaceDetection | Se poate lua din FaceLandmarker? |
|---|---|
| cutie de încadrare | **da** — anvelopa punctelor (o ai deja normalizată în `FaceMeshPlugin.kt:74-76`) |
| `smilingProbability` | **da** — `mouthSmileLeft/Right` (deja citite în `FaceMeshMath.approximateEmotion`) |
| `left/rightEyeOpenProbability` | **da** — `eyeBlinkLeft/Right`, plus `FaceMeshMath.eyeOpenness` geometric, deja implementat |
| `faceScore` | irelevant — pe Android e constanta 1 oricum |

**Câștig așteptat [X]:** elimini un model întreg din lanț. În cifrele tale, FaceDetection = 227,4 s și FaceMesh = 54,5 s. Chiar dacă FaceLandmarker devine mai scump când preia și rolul de detector, plafonul superior al câștigului e **~180 s din 692**, adică **~26% din munca modelelor** — mai mult decât orice altă idee din raport. **Și scade și numărul de decodări native și de treceri peste punte.**
**Risc: MARE.** Schimbă **toate** scorurile de zâmbet și de ochi (scale diferite, praguri diferite: `ML_KIT_EYE_OPEN_THRESHOLD = 0.5` e o probabilitate de clasificare, blendshape-urile sunt altceva). Cere recalibrare completă și retestare a lui `groupSmileRatio`, `allEyesOpen`, `bestSmile`.
**Efort:** 4-7 zile, plus calibrare pe un set real.
**Afectează rezultatele: DA, masiv.** → **Strict după lansare.**

## B.3 Alternativa reală, fără schimbarea rezultatelor: **scoate munca de pe firul Capacitorului**

Nu e o alternativă de model. E singura schimbare cu câștig mare și **zero** efect asupra scorurilor.

Pentru fiecare plugin sincron (FaceMesh, Pose, Embedder, ImageAnalysis) și pentru decodarea nativă, tiparul e:

```kotlin
// în loc de: call.resolve(runAnalysis(...))   ← pe firul CapacitorPlugins
private val executor = Executors.newFixedThreadPool(
    (Runtime.getRuntime().availableProcessors() / 2).coerceIn(2, 4)
)
@PluginMethod fun analyze(call: PluginCall) {
    executor.execute {
        val bitmap = resolveInputBitmap(context, call) ?: return@execute
        try { call.resolve(runAnalysis(bitmap, cutiiPrimite(call) ?: emptyList())) }
        catch (e: Exception) { call.reject("...", e) }
        finally { recycleIfOwned(bitmap) }
    }
}
```

**Atenție, capcana:** `FaceLandmarker.detect()` / `PoseLandmarker.detect()` / `ImageEmbedder.embed()` **nu sunt sigure la apeluri concurente pe aceeași instanță**. `ReleasableModel.use{}` sincronizează doar achiziția, nu inferența **[C]** (`ModelRegistry.kt:120-127` — `use` cheamă `block(model)` **în afara** lacătului). Deci ori:
- **(a)** un `synchronized` per instanță de model — atunci MediaPipe rămâne serializat, dar **decodarea, `ImageAnalysis` și dispecerizarea ML Kit se eliberează**; sau
- **(b)** o mică piscină de instanțe per model (2, nu 4 — memoria nativă contează), fiecare folosită de un singur fir odată.

**Câștig așteptat [X]:** ținta directă sunt cei ~6,4 s/poză nemăsurați (§1.5) plus partea de coadă din cele 692 s. Estimarea mea onestă, cu (a): **−25…40% pe durata importului**. Cu (b) și cu recunoașterea depinsă (B.4): **−40…55%**.
**Risc: MEDIU** — e cod de concurență nativă, iar clasa de bug pe care o riști (folosirea unei resurse native în paralel) omoară procesul fără excepție, exact ca istoricul din `ModelRegistry.kt`. Se face cu (a), care e conservator, **nu** cu (b), înainte de lansare.
**Efort:** 1-2 zile pentru (a), inclusiv un import de test de 500 de poze.
**Afectează rezultatele: NU.** Aceleași modele, aceiași pixeli, aceeași ordine logică.

## B.4 Recunoașterea facială: singurul loc unde chiar ai nevoie de un model nou

Azi: ML Kit găsește fața → decupezi → **Human.js/TFJS**, un singur worker, serializat global, pe fiecare față din fiecare poză **[C]**. E cea mai scumpă și mai fragilă piesă din lanț, și nici măcar nu e măsurată.

Alternative reale, în ordinea raportului câștig/risc:
1. **MobileFaceNet / ArcFace-mobile ca `.tflite`, rulat prin `ImageEmbedder`-ul MediaPipe pe care îl ai deja.** Un embedder facial de 4-6 MB, inferență de ordinul a 5-15 ms per față pe CPU, **nativ**, fără TFJS, fără worker serializat, fără cele 8,9 MB de modele Human.js (vezi B.5). **[?]** — trebuie ales un model cu licență clară și evaluat pragul de similaritate; `NATIVE_RECOGNITION_THRESHOLD = 0.55` e calibrat pentru embedding-urile Human.js și **nu se transferă**.
   - Câștig: elimină un gât de sticlă global + ~9 MB din APK. Risc: mare (schimbă identificarea persoanelor, adică o funcție premium). Efort: 3-5 zile. **După lansare.**
2. **Depinde recunoașterea de import.** Azi rulează în linie, în interiorul permisului, blocând poza. Ar putea rula ca o a doua trecere, **după** ce importul s-a terminat, pe pozele cu fețe, cu UI-ul deja utilizabil. Câștig: scoate un fir serializat din calea critică. Risc: mic. Efort: 1-2 zile. **Afectează rezultatele: nu** (aceleași embedding-uri, doar mai târziu) — dar schimbă momentul în care apar numele pe carduri.

## B.5 ~9 MB de model livrați degeaba pe Android

`release-android.yml:74-80` copiază în APK **6 modele Human.js**: blazeface, facemesh, iris, emotion, faceres, centernet = **16,4 MB** **[M]** (măsurat cu `ls` pe `node_modules`).
Pe Android, workerul de recunoaștere folosește config-ul `recognitionOnly` — **mesh/iris/emoție/CenterNet dezactivate** **[C]** (`workerPool.ts:428`). Singurul care le mai încarcă e `ensureEnrollmentSlot()`, care cheamă `spawnSlot()` **fără** `recognitionOnly` **[C]** (`workerPool.ts:404`) — deși înrolarea are nevoie doar de detecție + embedding.

**Propunere:** `ensureEnrollmentSlot()` să folosească și el `recognitionOnly`. Atunci `iris.bin` (2,6 MB) + `emotion.bin` (0,8 MB) + `centernet.bin` (4,0 MB) + `facemesh.bin` (1,5 MB) = **8,9 MB** ies din APK-ul Android.
**Câștig:** −8,9 MB. **Risc: mic** (de verificat că înrolarea încă găsește fața cu BlazeFace singur — worker-ul `recognitionOnly` deja face exact asta pe fiecare decupaj, deci calea e dovedită). **Efort: 2-4 ore.** **Afectează rezultatele: nu** (embedding-ul `faceres` e același).

## B.6 Ce fac concurenții — și ce înseamnă pentru tine

| Produs | Platformă | Preț (2026) **[D]** | Ce vinde de fapt |
|---|---|---|---|
| **Aftershoot** Selects | desktop | 14,99 $/lună (9,99 $ anual); Pro 47,99/39,99 $ | culling nelimitat + profil AI personal de editare |
| **Narrative Select** | desktop | Lite 10 $ → Ultra 60 $/lună | *Scenes View* (triaj în ordinea poveștii), *Close-ups Panel* (expresia fiecărei persoane fără zoom manual) |
| **FilterPixel** | cloud | Standard 19,99 $ (14,99 anual), cotă DeepCull | **modele AI pe gen** + **„score and reason transparency"** + „92-97% acord cu selecția manuală" |
| **Optyx** | desktop | **99 $ perpetuu** sau 9 $/lună | grupare + rating în catalogul Lightroom |
| **Imagen** | cloud | **0,05 $/poză**, minim 7 $/lună | precizie tehnică + flux cull→edit integrat |
| **Tidy** | **Android/iOS** | **gratuit**, procesare pe dispozitiv, „no hidden weekly subscription" | curățare galerie |
| **Google Photos** | Android/iOS | **gratuit** | Photo Stacks + „Top pick" |

**Ce citesc eu aici, direct:**
1. Nimeni dintre cei care iau bani nu e pe telefon. Toți concurenții plătiți sunt desktop sau cloud, pentru fotografi profesioniști cu RAW-uri.
2. **Pe telefon, prețul pieței e zero.** Google Photos face stacks + top pick gratuit, în sistem. Tidy își face din „gratuit, pe dispozitiv, fără abonament săptămânal ascuns" **argumentul principal de marketing**.
3. **FilterPixel vinde exact lucrurile pe care tu deja le ai și nu le vinzi**: transparența scorului și modele pe gen. Tu ai `decisionReasons.ts`, `aiExplanationGenerator.ts`, `scoreCounterfactual.ts` și contexte per gen în `ContextEngine` — și niciunul nu apare ca **argument de cumpărare**.
4. Narrative vinde „Close-ups Panel" — expresia fiecărei persoane fără zoom. Tu ai `FaceCompareStrip.tsx`, `faceStrip.ts`, `FaceCropThumb.tsx` **[C]**. Aceeași funcție, nevândută.

---

# PARTEA C — VITEZĂ: CE FACI, ÎN CE ORDINE

Regula pe care ai pus-o singur: **înainte de 30 septembrie, nimic care schimbă scorurile.** Tot ce urmează în lista „înainte" respectă asta.

## C.0 Mai întâi: astupă gaura din măsurătoare (o zi, dar câștigă toate deciziile următoare)

Fără asta, optimizezi pe un tabel care confundă lucrul cu așteptarea (§1.6).
1. Învelește `recognizeFaces` în `timedModel('FaceRecognition', …)`. **[C]** — azi nu e.
2. Învelește `drawToCanvas` + `makeDerivatives` + parsarea răspunsului.
3. Pe partea Kotlin, cronometrează **doar** `runAnalysis()` și **doar** `detect()`/`embed()`, separat de `resolveInputBitmap`, și raportează cifra înapoi în rezultatul plugin-ului. Atunci ai, pentru fiecare model, **cost real vs. coadă** — două numere, nu unul.
4. Adaugă `navigator.hardwareConcurrency` și `analysisPool.size` în `ImportOutcome` — azi nu știi câte permise a avut telefonul pe care ai măsurat, deci nu poți verifica aritmetica din §1.5 pe date reale.

**Experimentul care închide discuția, fără nicio linie de cod:** `adb shell top -H -p <pid>` în timpul unui import.
- Dacă ipoteza ta e corectă → multe fire ocupate, procesorul aproape de 100% pe toate nucleele.
- Dacă diagnosticul meu e corect → vezi **`CapacitorPlugins` și firul principal al WebView-ului aproape de 100%**, restul aproape inactive.
Cinci minute. Nu presupune niciunul dintre noi mai departe fără el.

## C.1 ÎNAINTE DE 30 SEPTEMBRIE — ordonat după (câștig × încredere) ÷ risc

| # | Ce | Câștig așteptat | Încredere | Risc | Efort | Schimbă scorurile? |
|---|---|---|---|---|---|---|
| **1** | **Scoate `drawToCanvas` când nu e nevoie de el** — cu `mediaUri` prezent și fără persoane înrolate, canvas-ul de 2048px nu e citit de nimeni (`nativeAnalysis.ts:133`; folosit doar în `recognizeFaces` și în ramura OCR fără URI). Creează-l leneș. | mic-mediu, pe firul principal | **mare** — se vede din cod | **foarte mic** | 2-3 h | **NU** |
| **2** | **Refolosește canvas-ul de preview din `makeDerivatives`** în loc să desenezi al doilea la rezoluție plină. | mic-mediu | mare | mic | 3-4 h | **NU** |
| **3** | **Gestionare termică** — `PowerManager.addThermalStatusListener`; la `THERMAL_STATUS_MODERATE`, coboară `nativeAnalysisConcurrency` la 2 și arată în UI „telefonul s-a încălzit, merg mai încet ca să nu se oprească". | **posibil pozitiv net** (recuperezi 30-40% din throttling **[D]**) + rezolvă plângerea de încălzire | mediu-mare | mic | 1 zi | **NU** |
| **4** | **Mută munca sincronă de pe firul Capacitor, varianta conservatoare (a)** — executor per plugin + `synchronized` per instanță de model. | **−25…40% pe import** **[X]** | mediu-mare | **mediu** | 1-2 zile + test pe device | **NU** |
| **5** | **Fă `CrashLog` ieftin** — tampon în memorie cu `flush` la fiecare N linii sau la `onPause`, în loc de scriere+lacăt la fiecare marcaj. Păstrează scrierea imediată doar pentru `>NUME` (intrarea), care e singura care contează la o cădere. | mic, dar scoate un mutex global | mare | mic | 3-4 h | **NU** |
| **6** | **Coboară `FACE_PRESCAN_MAX` de la 150 la ~40-60** — pre-scanarea decide doar ordinea; primele 40-60 de poze cu oameni sunt suficiente ca utilizatorul să aibă ce tria imediat, iar restul lotului se completează oricum înainte să ajungă acolo. | scoate ~60% dintr-o fază întreagă, nemăsurată | mediu | mic | 1 h | **NU** (doar ordinea) |
| **7** | **Depinde recunoașterea de calea critică** (B.4.2) — a doua trecere după import. | scoate un fir global serializat din import | mediu | mic-mediu | 1-2 zile | **NU** |

**Cumulat, realist: import de 201 poze de la 8m15s la ~4m30-5m00, și telefonul vizibil mai puțin fierbinte.** **[X]** — estimare, nu măsurătoare; de aceea C.0 vine prima.

## C.2 DUPĂ LANSARE

| Ce | Câștig | Risc | Efort | Schimbă scorurile? |
|---|---|---|---|---|
| **FaceLandmarker în loc de FaceDetection+FaceMesh** (B.2) | **până la −26% din munca modelelor** | mare | 4-7 zile + calibrare | **DA** |
| **Recunoaștere nativă (MobileFaceNet/ArcFace tflite)** (B.4.1) | scoate TFJS de pe Android, −9 MB APK | mare | 3-5 zile | **DA** |
| **Piscină de instanțe MediaPipe** (B.3 varianta b) | încă −10…15% | mediu | 2 zile | NU |
| **Calibrează sau scoate `bodyCroppedAtEdge`** — 11% din timp pentru un bit necalibrat | −11% dacă îl scoți | mediu | 2 zile (evaluare pe set real) | **DA** |
| **`setMinFaceSize` mai mare la detecție** | mediu | mediu | 1 zi | **DA** |
| **Scoate cele 8,9 MB de modele Human.js** (B.5) | −8,9 MB APK | mic | 2-4 h | NU |
| **Preview nativ**: `MediaLibraryPlugin` să întoarcă direct JPEG-ul de 2048px + miniatura, în loc ca JS să citească toți octeții (`toFiles`) și să decodeze de două ori (o dată în JS, o dată nativ) | mare pe faza „citire" + „decodare" | mediu | 3-4 zile | NU |

## C.3 Ce am verificat că **nu** merită

- **GPU/NNAPI pentru MediaPipe** — ești deja pe decizia corectă, și pentru un motiv în plus față de al tău: instanțele sunt partajate și, până rezolvi §B.3, apelate din fire concurente pe o resursă nesigură la concurență. GPU acolo ar face fragilitatea mai rea, nu mai bună.
- **Trecerea la ML Kit prin Play Services** — vezi B.1. Rupe promisiunea de produs.
- **LiteRT 2.x / delegați NPU** — rescriere completă pentru un procent din procesor care nu e gâtul sticlei azi. **[D]**

---

# PARTEA D — GRAFIC ȘI VIZUAL

## D.1 Problema de fond: două sisteme de design care se bat, și cel documentat pierde

`src/styles.css:8-22` **[C]** descrie direcția: *„Lumin Culler Pro v3 — Obsidian Studio… accent semnătură teal→indigo (înlocuiește cyan→violet)"*.
`src/styles.concept.css:1-15` **[C]** spune: *„Stratul vizual de concept, portat CA ATARE din build-ul de referință… NU edita regulile de mai jos ca să «repari» ceva punctual"*, și e încărcat **după** (`main.tsx:7,10`).

Rezultat concret, verificabil:

```
src/styles.css:83          --desk-aqua: #67e4cf;    ← "Obsidian Studio", teal
src/styles.concept.css:948 --desk-aqua: #22d3ee;    ← concept, cyan  ← ACESTA CÂȘTIGĂ
```

**Culoarea de accent pe care o descrie fișierul de design nu ajunge niciodată pe ecran.** Același token, două valori, în două fișiere, ambele încărcate. Asta nu e o inconsecvență de detaliu — e motivul pentru care aplicația *arată* nefinisată: două direcții cromatice suprapuse, cu a doua câștigând prin ordinea de import, nu prin decizie.

**Ce aș face (post-lansare, 2-3 zile):** alege UNA. Dacă „Obsidian Studio" e direcția, mută tokenii câștigători în `styles.css` și taie stratul de concept. Dacă stratul de concept e cel aprobat vizual, **șterge direcția din header-ul lui `styles.css`** ca să nu mai mintă următorul om care deschide fișierul.

## D.2 Un sistem de design întreg, mort în bundle

`.atelier-*` — **168 de linii** în `styles.concept.css` (începând de la `:root` linia 17, apoi `.atelier-home`, `.atelier-brief`, `.atelier-ledger`, `.atelier-primary-action`, `.atelier-maintenance`, `.atelier-index`…).
`grep -rn "atelier" src --include=*.tsx --include=*.ts index.html` → **zero rezultate** **[M]**.

Ecranul „Atelier" a fost înlocuit de `lc-home-*` (commit `138ba12`, „Grila, refăcută din build-ul cu «Acasă» în bara de jos"), dar CSS-ul a rămas. Tokenii `--atelier-teal/violet/coral` **sunt** încă folosiți (liniile 6169, 6190, 6228) — deci nu se poate șterge blocul întreg orbește, dar clasele da.

Total: **145 de clase CSS definite și nefolosite nicăieri în TSX** **[M]**. CSS-ul construit: **273 KB** (`dist/assets/index-*.css`) **[M]**.

## D.3 Nu există o scară de rotunjimi

`grep -ohE 'border-radius: ?[^;]+;'` peste ambele foi **[M]**:

```
85×  50%          75×  999px       54×  var(--radius)     27×  8px
22×  99px         21×  14px        21×  10px              18×  12px
15×  13px         14×  var(--radius-lg)   11× 9px   11× 6px   11× 16px
10×  18px          6×  inherit      4×  4px   4× 2px   4× 24px   4× 22px
```

**19 valori distincte.** `999px` și `99px` fac același lucru (97 de utilizări între ele). `14px` scris de mână de 21 de ori e exact `var(--radius)`. `8/9/10/12/13/14/16/18/22/24` nu formează nicio scară. Ochiul nu poate să nu vadă asta — nu ca „e 13 în loc de 12", ci ca „lucrurile nu par făcute de aceeași mână".

**Ce aș face:** `--r-xs: 6px; --r-sm: 10px; --r-md: 14px; --r-lg: 20px; --r-pill: 999px`, și o singură trecere de căutare-și-înlocuire. **Post-lansare, 1 zi**, pur cosmetic, zero risc funcțional.

## D.4 Tema luminoasă e o listă de excepții, nu un sistem

**164 de selectoare `[data-theme="light"]`** peste cele două foi (112 în concept + 52 în styles.css) **[M]**, multe cu `!important`:

```
src/styles.concept.css:3686  :root[data-theme="light"] .review-desk-continue { color: #06100e !important; }
src/styles.concept.css:3688  :root[data-theme="light"] .tiktok-rail-label { color:#fff !important; text-shadow:… !important; }
src/styles.concept.css:3692  :root[data-theme="light"] .tiktok-rail { background:…!important; border-color:…!important; box-shadow:…!important; }
src/styles.concept.css:3698  :root[data-theme="light"] .filters .chip.active { color:#063c36 !important; background:#a7eee1 !important; … }
src/styles.concept.css:3709  :root[data-theme="light"] .drawer-head > span { color: #14151a !important; }
```

Culoarea de text pentru tema luminoasă e `#14151a`, **scrisă de mână de 11 ori** **[M]**, nu ca token. Asta e semnătura exactă a unei teme luminoase „terminate prin corecții": tema întunecată are tokeni, cea luminoasă are patch-uri.

**Consecință practică:** orice ecran nou pornește corect pe întuneric și greșit pe lumină, până când cineva îi adaugă manual excepția. La 12 testeri e o chestiune de noroc dacă cineva rulează pe lumină.

**Ce aș face:** redefinește **tokenii** sub `[data-theme="light"]` (`--desk-panel`, `--desk-ink`, `--desk-muted`, `--line`, `--surface*`), și șterge excepțiile pe componentă pe măsură ce devin redundante. **Post-lansare, 2-3 zile.** Înainte de lansare: doar verifică pe telefon fiecare ecran în modul luminos — e cel mai probabil loc unde un tester vede ceva rupt.

## D.5 Bug-uri vizuale concrete, cu fișier și linie

| Fișier:linie | Ce | De ce contează |
|---|---|---|
| `src/ui/PremiumProof.tsx:103` | `<text …>Roșiori · România</text>` **hardcodat** în miniatura „Locații" | **Pe ecranul de plată.** Un utilizator din 177 de țări, cu telefonul în engleză, vede numele unui oraș din Teleorman în ilustrația funcției pe care i-o vinzi. Nu e o glumă — e exact genul de detaliu care spune „aplicație locală, făcută pentru altcineva". **Reparație: 15 minute** (`t(locale, 'premium.proof.locationExample')` cu „Lisbon · Portugal" / „Roșiori · România"). **Înainte de lansare.** |
| `src/ui/PremiumProof.tsx:79` | `<rect x="84" y="46" width="0" height="0" />` | Element SVG de dimensiune zero, rămas dintr-o iterație. Inofensiv, dar e murdărie exact în componenta „dovada premium". |
| `src/styles.css:83` vs `src/styles.concept.css:948` | `--desk-aqua` cu două valori | §D.1 |
| `src/styles.concept.css` (168 linii `.atelier-*`) | cod mort | §D.2 |

## D.6 Ce ar ridica-o la nivel de aplicație plătită

Nu mai multă decorație. Trei lucruri, în ordine:
1. **O singură scară** (rotunjimi, spațiere, tipografie) aplicată consecvent — asta e diferența perceptibilă între „aplicație de hobby" și „produs".
2. **Tema luminoasă construită pe tokeni**, nu pe excepții.
3. **Un moment de spectacol pe minut de folosire.** Aplicația are `AnimatedNumber`, `CullGauge`, `SessionOutcome`, `LifetimeProof` — piese bune, dar risipite. Momentul cel mai important din toată aplicația (sfârșitul unui triaj: „ai trecut prin 340 de poze în 9 minute, ai păstrat 61") merită să fie **cea mai frumoasă secundă din produs**, nu un panou printre altele. Azi `SessionOutcome.tsx` e un card.

---

# PARTEA E — CONȚINUT ȘI CONTEXT

## E.1 Infrastructura de limbă e mai bună decât la majoritatea aplicațiilor plătite

- **Paritate perfectă RO/EN:** 1847 de chei fiecare, **zero** chei lipsă în oricare direcție, **zero** duplicate **[M]** (verificat programatic, nu doar prin `parity.test.ts`).
- `necesitaDe()` + `{countDe}` — clasele CLDR „few"/„other" pentru română, implementate corect, cu explicația în cod **[C]**. „2 poze" vs „20 **de** poze". Foarte puține aplicații fac asta.
- Limba urmează telefonul (`deviceLocale()`, `navigator.languages` înaintea lui `navigator.language`) **[C]**, cu comentariul care spune cinstit că e o schimbare de comportament pentru cei care au deja aplicația.
- `applyLocale()` setează `<html lang>` — WCAG 3.1.1 **[C]**.
- Dicționarul englez e încărcat leneș (119 KB) **[M]** — corect.

**Verdictul meu: partea de i18n nu are nevoie de nimic.** Ceea ce e remarcabil.

## E.2 Explicațiile AI: **nu sunt umplutură.** Sunt cel mai bun activ nevândut al aplicației.

Am citit `aiExplanationGenerator.ts` în întregime. Nu e un generator de propoziții goale. Trei dovezi:

1. **Refuză să afirme ce nu poate măsura.** `aiExplain.smile.groupHigh` („zâmbesc **natural**") se folosește doar când `groupGenuineSmileRatio / smileFrac >= 0.6` — adică doar când markerul Duchenne susține cuvântul. Altfel cade pe `groupHighUnsure` („zâmbesc **larg**"). Comentariul spune că prima variantă a fost un bug raportat de tine la testare **[C]** (liniile 143-153). **Asta e onestitate scrisă în cod**, și e exact ce diferențiază o explicație de un slogan.
2. **Corectează direcția, nu doar mărimea.** `headroomDirection()` recalculează din poziția brută a cutiei dacă spațiul deasupra capului e „prea strâns" sau „prea gol" — pentru că scorul simetric `headroom` nu poate spune direcția, și înainte dădea sfatul invers **[C]** (liniile 47-64).
3. **Folosește aceeași curbă ca motorul de scor.** `effectiveSharpness()` aplică `landscapeSharpness()` pentru peisaje, ca explicația să nu contrazică decizia **[C]** (liniile 26-38).

Un singur reproș de conținut, real:

```
src/i18n/ro.ts:1927   'aiExplain.strangers': '{countDe} persoană(e) necunoscută(e) alături de cele cunoscute',
```
**„persoană(e) necunoscută(e)"** e limbaj de formular administrativ, într-o aplicație care în rest scrie frumos. Ai `plural()` în `i18n/index.ts` și îl folosești în altă parte. **Reparație: 10 minute**, două chei (`…strangers.one` / `…strangers.other`). **Înainte de lansare** — e fraza care apare în „De ce acest scor" pe orice poză de grup cu un necunoscut, deci se vede des.

## E.3 Ton: unde e neuniform

Aplicația are trei registre de voce care nu sunt aceeași persoană:
- **Registrul cald, foarte bun** — `PremiumPanel`, `FreeAllowanceNotice`, `SessionOutcome`. Scurt, direct, fără hype. Ex.: „Triajul rămâne gratuit, Premium e pentru ce faci cu rezultatul."
- **Registrul tehnic** — mesajele de eroare de import: *„Motiv: TimeoutError: Analiza acestei fotografii a durat prea mult (posibil fișier problematic) — sărită. (x3)"* **[C]** (`importPipeline.ts`, `failureWarning`). Corect pentru diagnostic de la distanță, dar utilizatorul primește un nume de excepție JavaScript. **Sugestie:** păstrează motivul tehnic în „Statistici → ultimele importuri" (unde deja stă, în `ImportOutcome`) și pune în toast doar propoziția omenească.
- **Registrul de manual** — unele texte din `MenuDrawer` și `PhotoInfoTabs` explică metrica în loc să spună ce înseamnă pentru poză.

## E.4 O afirmație de verificat înainte de lansare

`README.md` și mesajul de eroare din `importPipeline.ts:918-920` spun încă *„HEIC/HEIF de pe iPhone nu e suportat încă — convertește-le în JPEG"*, dar codul **chiar suportă HEIC** de la Android 9 în sus prin `HeicDecoderPlugin` (`heicOk` la linia 899) **[C]**. Mesajul apare doar când `heicOk` e fals, deci nu e un bug — dar README-ul e greșit, iar mesajul e formulat ca și cum ar fi o limitare a aplicației, nu a telefonului.

---

# PARTEA F — DE CE AR PLĂTI CINEVA. Răspunsul cinstit.

## F.1 Diagnosticul, spus direct

> **Ai dat gratis produsul și vinzi ambalajul.**

Triajul — importul, scorul AI, motorul care învață, gruparea rafalelor, comparația de serii, explicațiile, ștergerea respinselor, supervizorul galeriei — **e gratuit și nelimitat** **[C]** (`entitlement.ts`, comentariul de la `isPremiumFeatureLocked`).

Ce se plătește: XMP, planșă de contact, dosar cu PIN, recap lunar, prezentare, locații, combinarea a două cadre, a doua persoană recunoscută, și pozele **peste 150 la 30 de zile**.

Toate șapte funcțiile plătite sunt **după** triaj. Sunt garnitură. Iar plafonul de 150 e singura care doare — dar doare **la sfârșit**, după ce omul a primit deja toată valoarea.

Comentariul tău din cod o spune cel mai clar, fără să-și dea seama: *„Toate vin DUPĂ ce triajul s-a terminat — sunt despre ce faci cu rezultatul, nu despre a-l obține."* Asta e o filozofie corectă și generoasă. **Ca model de venit, e o problemă**, pentru că „a-l obține" e singurul lucru pentru care lumea plătește la concurență.

## F.2 Ce spun cifrele pieței, și nu sunt măgulitoare **[D]**

- **Paywall dur: 10,7% conversie trial→plată la ziua 35. Freemium: 2,1%.** Un raport de ~5×.
- **Photo & Video are cea mai scăzută rată trial→abonament dintre toate categoriile.**
- Trial de 3 zile: ~26% anulări. Trial de 30 de zile: ~51%.
- Aplicațiile care rulează 4+ teste de paywall pe lună compun 45-70% creștere anuală de venit; fiecare test individual, 3-8%.

Tradus: ești în categoria care convertește cel mai prost, cu modelul care convertește cel mai prost, într-o piață mobilă unde prețul de referință e zero (Google Photos, Tidy) **[D]**.

**Asta nu înseamnă că modelul e greșit.** Înseamnă că **generozitatea trebuie să fie o alegere de marketing pe care o comunici**, nu o consecință tăcută a arhitecturii. Tidy își face din exact asta argumentul principal — și nu vinde abonament.

## F.3 Ce ar schimba decizia — ordonat după impact asupra conversiei

### 🥇 1. **Viteza. Nu e o funcție, e condiția de existență a abonamentului.**
201 poze în 8m15s, cu telefonul fierbinte **[M]**. Extrapolat: **o nuntă de 2000 de cadre = ~82 de minute** de telefon încins, în care nu poți face altceva cu el.

Nimeni nu plătește abonament lunar pentru un flux pe care îl abandonează la jumătate. Și, mai rău: plafonul gratuit de 150 de poze/30 de zile e calibrat pentru **cine termină triajul**. Cine renunță la poza 300 din 2000 nu ajunge niciodată să scoată 150 de poze, deci **nu lovește niciodată plafonul, deci nu vede niciodată motivul să plătească.**

**Lentoarea nu e doar un defect de UX. E o scurgere directă în pâlnia de conversie.** De asta Partea C e prima parte a acestui raport, nu ultima.
**Efort: 3-5 zile (C.1). Impact pe conversie: cel mai mare din listă.**

### 🥈 2. **Pornește perioada de probă. Cod: zero.**
`BillingPlugin.kt:245-310` **[C]** citește deja `subscriptionOfferDetails`, preferă oferta cu fază gratuită, calculează `trialDays` și le trimite în UI; `PremiumPanel` le afișează. **Totul e construit și netestat în producție pentru că nu există o ofertă configurată în Play Console.**
Un trial de 7-14 zile mută conversia de la „download→plată" (procente mici) la „trial→plată" (38-54% pe iOS pentru 7-14 zile) **[D]**.
**Efort: o oră în Play Console + un import de test. Impact: mare. Risc: zero.** **Fă-o săptămâna asta.**

### 🥉 3. **Vinde ce ai deja și nu spui.**
FilterPixel își face reclamă cu **„score and reason transparency"** și cu **modele AI pe gen** **[D]**. Tu ai:
- `aiExplanationGenerator.ts` — explicații pe patru axe, care refuză să afirme ce nu pot măsura (§E.2);
- `scoreCounterfactual.ts` — „ce ar fi trebuit să fie altfel ca să treacă";
- `ContextEngine` — **regresie logistică online, un model per context** (`portrait:known`, `landscape`, `group:mixed`…), cu `personalDelta` care spune cât din scor vine din **gustul tău** vs. din manualul de fotografie **[C]**;
- `LifetimeProof` — dovada, pe telefonul tău, a timpului economisit.

**Niciunul dintre concurenții mobili nu are așa ceva. Niciunul dintre concurenții desktop nu îl are pe telefon.** Iar tu îl dai gratis și nici măcar nu-l numești.

**Propunere concretă:** „**Profilul tău AI**" ca funcție cu nume, cu ecran propriu, cu vizualizarea a ce a învățat despre tine, cu export/import (îl ai — `personProfileTransfer.ts`, `backupService.ts`). Rămâne gratuit să învețe (e etic și e corect — sunt deciziile omului). Se plătește pentru: **al doilea profil** (nuntă vs. familie), **export/backup al profilului**, și **„aplică profilul unui prieten"**.
**Efort: 3-5 zile (mai ales UI, motorul există). Impact: mare — e singurul lucru pe care nimeni altcineva nu-l poate copia rapid.**

### 4. **Descrierea și căutarea semantică — Gemini Nano, deja în APK, folosit o poză odată.**
`ImageDescriptionPlugin` + `mlkit:genai-image-description:1.0.0-beta1` sunt în build **[C]**, folosite dintr-un meniu contextual, pe o singură poză.
Google Photos vinde căutarea („arată-mi câinele la mare"). Tu ai OCR (`ocrText`), etichete (`sceneTags`), embedding-uri (`imageEmbedding`), CLIP experimental (`src/core/clip/`) **[C]** și Gemini Nano — **complet pe dispozitiv**, ceea ce Google Photos nu poate promite.
**„Căutare care nu pleacă de pe telefon" e o funcție premium pe care o poți apăra.**
**Efort: 5-8 zile. Impact: mare. Risc: mediu** (`beta1`, disponibil doar pe telefoane cu AICore).

### 5. **Mută o parte din valoare ÎNAINTE de plafon.**
Nu strica promisiunea „triajul e gratuit". Dar plafonul care doare azi (poze scoase) doare **la final**. Adaugă unul care doare **la mijloc**, fără să blocheze triajul:
- **gratuit:** un import de până la N poze odată (ex. 500) — peste, se împarte în loturi;
- **premium:** loturi nelimitate + **triaj în fundal** (importul continuă cu ecranul stins).
„Continuă cât timp telefonul stă în buzunar" e o funcție pe care oamenii chiar o plătesc, e vizibilă **în timpul** valorii, nu după, și e o consecință naturală a Părții C.
**Efort: 4-6 zile (necesită un foreground service). Impact: mediu-mare.**

### 6. **Prețul anual, arătat ca alegerea implicită.**
`defaultPlanId()` bifează cel mai ieftin pe zi doar când economia depășește 5% **[C]** — logică bună. Dar tot depinde de ce configurezi în Play Console. Anualul aduce încasarea în ziua 1 și scoate 11 din 12 ocazii de renunțare (îți spune propriul comentariu din `premiumPlans.ts`). **Configurează un anual cu 30-40% reducere reală.** **Efort: o oră. Impact: mediu.**

### 7. **Un al doilea „prin ce se vede că merită", în cifre.**
FilterPixel spune „92-97% acord cu selecția manuală" **[D]**. Tu poți spune ceva mai bun, pentru că îl măsori **pe telefonul omului**: `aiFeedback.ts`, `sessionOutcome.ts`, `LifetimeProof` **[C]**.
„AI-ul a fost de acord cu tine în 89% din decizii, pe ultimele 1200 de poze" e un număr pe care nimeni nu-l poate contesta și nimeni nu-l poate copia. **Efort: 2-3 zile. Impact: mediu-mare** (e argumentul care închide vânzarea, pus în paywall).

## F.4 Ce e prost împachetat în ce ai deja

| Ai construit | Se vinde ca | Ar trebui să se vândă ca |
|---|---|---|
| `ContextEngine` — model per context, `personalDelta`, backup/transfer | nimic (gratuit, fără nume) | **„Profilul tău AI"** — funcția-semnătură |
| `aiExplanationGenerator` + `decisionReasons` + `scoreCounterfactual` | nimic | **„De ce"** — exact ce vinde FilterPixel |
| `FaceCompareStrip` / `faceStrip` / `FaceCropThumb` | ascunse în comparație | **„Fețele, una lângă alta"** — exact ce vinde Narrative (Close-ups Panel) |
| `recapVideo` + `PresentationMode` | două intrări separate în meniu | **un singur lucru**: „ce trimiți familiei" |
| `vault` + PIN | „dosar privat" | e o funcție de aplicație de securitate, nu de culling — **cea mai slabă din pachet**; ține-o, dar n-o mai pune pe primul ecran |
| `LifetimeProof` | un bloc în ecranul Premium | **notificarea de după fiecare sesiune** |
| `locations` (GeoNames offline, mondial, 150k+ localități) | „călătorii" | **„Locuri — fără să plece nimic de pe telefon"**; e o promisiune de intimitate, nu o hartă |

## F.5 Ce aș tăia

- **`SegmentationPlugin` + `selfie_segmenter.tflite`** dacă bokeh-ul din editor nu e folosit — dar verifică întâi telemetria; azi **e** conectat, deci nu tăia orbește.
- **Editorul complet** (`EditPanel.tsx`, 1833 de linii; `imageAdjust.ts`, 1967) — e cea mai mare investiție de cod din aplicație pentru o funcție care **nu e nici gratuită ca argument, nici plătită ca venit**, și pentru care concurența (Lightroom Mobile, Snapseed) e strivitoare. Nu-l șterge — dar nu mai investi în el, și nu-l pune în fișa din magazin ca argument.

## F.6 Tabelul de decizie, ordonat după (impact × încredere) ÷ efort

| # | Acțiune | Impact conversie | Încredere | Efort | Când |
|---|---|---|---|---|---|
| 1 | **Perioadă de probă în Play Console** (cod: zero) | **mare** | mare | 1 h | **acum** |
| 2 | **Plan anual cu reducere reală 30-40%** | mediu | mare | 1 h | **acum** |
| 3 | **„Roșiori · România" scos din paywall** (D.5) | mic dar jenant | mare | 15 min | **înainte de 30.09** |
| 4 | **Viteza: pachetul C.1** | **cel mai mare** | mediu-mare | 3-5 zile | **înainte de 30.09** |
| 5 | **Gestionare termică + mesaj onest** (C.1 #3) | mediu | mare | 1 zi | **înainte de 30.09** |
| 6 | **„Profilul tău AI" ca funcție cu nume** | **mare** | mediu-mare | 3-5 zile | după lansare, primul |
| 7 | **Numărul de acord AI↔tu, în paywall** | mediu-mare | mediu | 2-3 zile | după lansare |
| 8 | **Triaj în fundal + loturi nelimitate ca premium** | mediu-mare | mediu | 4-6 zile | după lansare |
| 9 | **Căutare semantică pe dispozitiv (Gemini Nano)** | mare | mediu | 5-8 zile | după lansare |
| 10 | **Reîmpachetarea din F.4** (fără cod nou, doar denumiri și locuri) | mediu | mediu | 2-3 zile | după lansare |

---

# PARTEA G — CE FACI ÎN URMĂTOARELE TREI SĂPTĂMÂNI

## Săptămâna 1 — măsoară și repară ce nu poate strica nimic
- [ ] `adb shell top -H` în timpul unui import. **Cinci minute care decid tot restul.** (C.0)
- [ ] Perioadă de probă + plan anual în Play Console. (F.6 #1, #2)
- [ ] `timedModel` peste `recognizeFaces`; cronometru nativ separat pentru `runAnalysis()` vs. decodare; `hardwareConcurrency` în `ImportOutcome`. (C.0)
- [ ] „Roșiori · România" → cheie i18n. `persoană(e) necunoscută(e)` → `plural()`. (D.5, E.2)
- [ ] `drawToCanvas` leneș; refolosirea canvas-ului de preview. (C.1 #1, #2)

## Săptămâna 2 — firele
- [ ] Executor per plugin, varianta conservatoare cu `synchronized` per model. (C.1 #4)
- [ ] `CrashLog` cu tampon. (C.1 #5)
- [ ] `FACE_PRESCAN_MAX` 150 → 50. (C.1 #6)
- [ ] **Remăsoară același lot de 201 poze.** Dacă nu vezi cel puțin −20%, oprește-te și recitește `top -H`.

## Săptămâna 3 — termic, verificare, fișă
- [ ] `addThermalStatusListener` + coborârea concurenței + mesajul onest în UI. (C.1 #3)
- [ ] Recunoașterea depinsă de calea critică. (C.1 #7)
- [ ] Trecere completă prin **toate** ecranele în **tema luminoasă**, pe telefon. (D.4)
- [ ] Fișa din magazin: mută „învață gustul tău" și „explică fiecare scor" în primele două rânduri ale descrierii.
- [ ] `npm test` + `tsc` + `lint` verzi înainte de fiecare AAB (workflow-ul le are deja ca porți blocante — bine făcut).

## Ce **nu** faci înainte de 30 septembrie
- Nu atinge `PERFORMANCE_MODE_ACCURATE`, `setMinFaceSize`, `NATIVE_ANALYZE_MAX_SIDE`, `PREVIEW_MAX_SIDE`.
- Nu scoate PoseDetection, FaceMesh sau ImageLabeling.
- Nu porni R8 (istoricul din `build.gradle` e clar și decizia e corectă).
- Nu reactiva `ModelRegistry.releaseAll()` în `onTrimMemory`.
- Nu porni piscina de instanțe MediaPipe (varianta B.3.b).
- Nu rescrie CSS-ul.

---

## Anexă — surse

- Capacitor Bridge, fir unic de plugin-uri: https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/Bridge.java
- Blocare în coadă a apelurilor de plugin pe Android: https://github.com/ionic-team/capacitor/issues/6861
- ML Kit release notes: https://developers.google.com/ml-kit/release-notes
- `FaceDetectorOptions.Builder` (`setExecutor`, `setMinFaceSize`): https://developers.google.com/android/reference/com/google/mlkit/vision/face/FaceDetectorOptions.Builder
- Concepte de detecție a fețelor (FAST vs ACCURATE): https://developers.google.com/ml-kit/vision/face-detection/face-detection-concepts
- Versiunile din exemplul oficial ML Kit: https://github.com/googlesamples/mlkit/blob/master/android/vision-quickstart/app/build.gradle
- MediaPipe Face Landmarker (478 puncte, 52 blendshapes, matrici): https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- Model card blendshapes: https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf
- Thermal API Android (headroom, listener): https://developer.android.com/games/optimize/adpf/thermal
- `PowerManager.OnThermalStatusChangedListener`: https://developer.android.com/reference/android/os/PowerManager.OnThermalStatusChangedListener
- Thermal mitigation (AOSP): https://source.android.com/docs/core/power/thermal-mitigation
- LiteRT NPU delegates: https://developers.google.com/edge/litert/android/npu/overview
- Stiva on-device Android 2026 (LiteRT 2.x / MediaPipe Tasks / Gemini Nano): https://www.forasoft.com/blog/article/neural-networks-on-android-369
- Aftershoot, prețuri: https://account.aftershoot.com/pricing
- Narrative Select, prețuri: https://narrative.so/pricing
- FilterPixel (DeepCull, transparența scorului, modele pe gen): https://filterpixel.com/ai-photo-culling-software
- Optyx: https://sourceforge.net/software/product/Optyx/
- Imagen (0,05 $/poză): https://imagen-ai.com/valuable-tips/photo-culling-app/
- Tidy (mobil, gratuit, pe dispozitiv): https://tidy.gallery/blog/what-is-photo-cleaner-app/
- Google Photos Stacks / Top pick: https://www.androidcentral.com/apps-software/how-use-photo-stacks-google-photos
- Benchmark-uri abonamente 2026 (paywall dur vs freemium, Photo & Video): https://www.revenuecat.com/state-of-subscription-apps
- Benchmark-uri perioade de probă: https://www.businessofapps.com/data/app-subscription-trial-benchmarks/
