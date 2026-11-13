# Licențe modele

Ce intră în aplicație, și ce a fost scos.

## Rămân, pe telefon

| Model | Unde | Licență |
| --- | --- | --- |
| MediaPipe Face Landmarker (`face_landmarker.task`) | etapa 2, fețe | Apache 2.0 (Google, modelul public MediaPipe) |
| MediaPipe Pose Landmarker lite | etapa 2, doar pe serii cu fețe | Apache 2.0 |
| MediaPipe Image Embedder (`mobilenet_v3_small.tflite`, float32, fișierul oficial MediaPipe) | etapa 2, similaritate de scenă; în fundal, și pe decupajul unui animal | Apache 2.0. Confirmat: modelul public MediaPipe Image Embedder, nu un checkpoint terț. Nu e o biometrică de animal. |
| ML Kit Image Labeling, modelul de bază din SDK | etichete de scenă, inclusiv animale | inclus în ML Kit, gratuit, offline, fără fișier separat. Termenii ML Kit (Google): folosire în aplicație, fără a redistribui modelul de unul singur |
| ML Kit Object Detection, modelul de bază din SDK | cutia animalului, ca să nu înglobăm tot cadrul | aceiași termeni ML Kit. Clasificatorul implicit e grosier; specia vine din Image Labeling |
| ML Kit Image Analysis, text (fața ML Kit a ieșit din APK) | rezervă | aceiași termeni ML Kit |
| Selfie segmenter | bokeh în editor | Apache 2.0, model MediaPipe |

## Doar APK-ul de test, nu în Play

| Ce | De ce |
| --- | --- |
| Human.js `faceres` (~7 MB) și `blazeface` (~0,5 MB) | Ca persoanele să poată fi grupate și numite pe telefonul de test. Pornește în fundal, pe fețele găsite de MediaPipe, la 480 px, după primul rezultat. Nu e în treapta 1 și nu e în `analyze()`. **Licență DESCHISĂ:** `faceres.json` indică HSE_FaceRec_tf (cod Apache 2.0). Greutățile sunt antrenate pe VGGFace2, publicat pentru cercetare non-comercială. Nu se publică pe Play până nu e înlocuit. |

## Înlocuire pentru identitate, sub ~5 MB

Nu există un checkpoint public de MobileFaceNet pe care să-l băgăm în Play doar pentru că fișierul scrie Apache 2.0.

- MobileFaceNet (Chen et al., ~4 MB, 128 de dimensiuni, 112×112) are cod Apache 2.0 în mai multe porturi, iar Qualcomm AI Hub marchează un export tot Apache 2.0. Antrenarea citată e pe MS-Celeb-1M, set retras de Microsoft și publicat pentru cercetare. Licența fișierului nu șterge termenii setului.
- Variantele InsightFace (ArcFace / buffalo) au, pe model zoo, termeni de cercetare non-comercială. Nu intră.
- MediaPipe nu publică un embedder de identitate.

Înlocuirea de urmărit: aceeași arhitectură MobileFaceNet (~4 MB), reantrenată pe un set cu drept de redistribuire, sau un model de furnizor cu grant comercial scris. Până atunci, `faceres` rămâne doar în APK-ul de test.

## Scoase din pachetul Android

| Ce | De ce |
| --- | --- |
| Human.js mesh, iris, emoție, CenterNet | nu sunt citite pe Android. Nu intră nici în APK-ul de test |
| Human.js `faceres` și `blazeface` în release | licența de mai sus. Workflow-ul de release nu le copiază și nu setează `VITE_TEST_IDENTITY` |
| MobileCLIP-S0 și `onnxruntime-web` | licență de cercetare, runtime wasm de ~25 MB, nefolosit pe drumul de triere |

## Ce nu măsurăm pe o poză fără serie

O poză care nu face parte dintr-o rafală nu trece prin modele în treapta 1. Nu i se scriu `highlightClipping`, `shadowClipping`, `horizonTiltDeg`, `ruleOfThirds` și `faceCount` înainte de primul rezultat. Coada „se poate salva” nu o propune. Seriile trec prin analiza completă.

Pe APK-ul de test, după ce rezultatul e deja pe ecran, un pas de fundal (concurență 1, numărat la treapta 2) pune embeddingul feței. Animalul (etichetă ML Kit, decupaj, MobileNet) rulează în același pas și pe release, fiindcă modelul e deja în APK și are licență Apache 2.0. `faceres` nu.

## Verificate pe 13 nov. 2026

| Model | Unde | Ce scrie la sursă | Decizie |
| --- | --- | --- | --- |
| SFace int8 (`face_sface_int8.onnx`, OpenCV Zoo) | recunoașterea fețelor (`FaceEmbedPlugin.kt`), în APK | README-ul OpenCV Zoo: „All files in this directory are licensed under Apache 2.0”. Nicio restricție comercială scrisă. Setul de antrenare al fișierului nu e numit; lucrarea SFace folosește CASIA-WebFace, VGGFace2, MS1M | **păstrat** (avem voie după licența declarată; rămâne o notă despre datele de antrenare) |
| Zero-DCE (`zerodce_512_fp16.tflite`) | luminarea pozelor întunecate | depozitul autorilor: „for non-commercial use only”, CC BY-NC 4.0 | **scos**. Lumina se calculează acum fără model (lumină locală + curbă gamma, `EditModelsPlugin.lowLight`) |

## Motoarele descărcabile (Setări → Motoare AI)

Nu sunt în APK. Se descarcă la cerere, de pe pagina publică a modelului. Licențele sunt cele declarate pe fișa modelului. „De confirmat” înseamnă că fișa nu spune clar pe ce date a fost antrenat modelul, sau că licența datelor diferă de cea a fișierului.

| Motor | Model | Licență declarată | Stare |
| --- | --- | --- | --- |
| clip | OpenAI CLIP ViT-B/32 (export Xenova) | MIT | ok |
| search | clip-ViT-B-32-multilingual-v1 (sentence-transformers) | Apache 2.0 | ok |
| describe | Florence-2-base-ft (Microsoft, export onnx-community) | MIT | ok |
| joy | FER+ (`emotion-ferplus-8`, ONNX Model Zoo) | MIT pentru model și etichetele FER+; imaginile FER2013 de sub ele nu au o licență clară | ⚠️ de confirmat. Doar semnal de bucurie, opțional; se poate opri fără să strice trierea |
| select | SlimSAM-77 | Apache 2.0 | ok |
| portrait | MODNet | de confirmat pe depozitul original | ⚠️ |
| portrait | Depth Anything V2 Small | Apache 2.0 (doar varianta Small) | ok |
| eraser | MI-GAN | MIT | ok |
| eraserHd | LaMa | Apache 2.0 | ok |
| clarity | Real-ESRGAN general x4v3 | BSD-3-Clause | ok |
| cutout | U²-Net-p | Apache 2.0 | ok |
| film | RIFE 4.9 | MIT | ok |
| translate_* | OPUS-MT (Helsinki-NLP) | CC BY 4.0: cere menționarea autorilor | ok, cu mențiune în „Despre” |

## Scorul estetic

Capul liniar LAION (`sa_0_4_vit_b_32_linear`) a ieșit pe 13 nov. 2026. Codul lui are licență deschisă, dar datele pe care a fost antrenat nu au o licență clară pentru folosire comercială. Scorul estetic se calculează acum doar din CLIP (MIT), din perechi de descrieri scrise de noi (CLIP-IQA: clar/mișcat, bine expus/întunecat, reușit/nereușit, intenționat/accidental). Pozele deja citite primesc scorul nou din amprenta salvată, o singură dată.
