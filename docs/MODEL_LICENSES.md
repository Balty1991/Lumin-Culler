# Licențe modele

Ce intră în aplicație, și ce a fost scos.

## Rămân, pe telefon

| Model | Unde | Licență |
| --- | --- | --- |
| MediaPipe Face Landmarker (`face_landmarker.task`) | etapa 2, fețe | Apache 2.0 (Google, modelul public MediaPipe) |
| MediaPipe Pose Landmarker lite | etapa 2, doar pe serii cu fețe | Apache 2.0 |
| MediaPipe Image Embedder (MobileNetV3-small) | etapa 2, cadre fără oameni | Apache 2.0 |
| ML Kit Image Labeling, modelul de bază din SDK | etichete de scenă, inclusiv animale | inclus în ML Kit, gratuit, offline, fără fișier separat. Termenii ML Kit (Google): folosire în aplicație, fără a redistribui modelul de unul singur |
| ML Kit Image Analysis, text, față (calea veche, doar dacă e aleasă) | rezervă | aceiași termeni ML Kit |
| Selfie segmenter | bokeh în editor | Apache 2.0, model MediaPipe |

## Scoase din pachetul Android

| Ce | De ce |
| --- | --- |
| Human.js (`blazeface`, `faceres`, mesh, iris, emoție, CenterNet) | pe scanare nu mai e nevoie de ele. `faceres` e un embedding de identitate fără licență confirmată pentru o aplicație comercială. TODO: un model de „cine e” cu licență clară. PWA-ul încă le are, pentru analiza din browser |
| MobileCLIP-S0 și `onnxruntime-web` | licență de cercetare, runtime wasm de ~25 MB, nefolosit pe drumul de triere |

## Ce nu măsurăm pe o poză fără serie

O poză care nu face parte dintr-o rafală nu trece prin modele. Nu i se scriu `highlightClipping`, `shadowClipping`, `horizonTiltDeg`, `ruleOfThirds` și `faceCount`. Coada „se poate salva” nu o propune. Seriile trec prin analiza completă și păstrează toate semnalele.
