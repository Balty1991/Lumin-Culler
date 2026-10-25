# Scanare în două trepte

## Ce arăta 2.1.2

Același import, în **Statistici → Ultimul import**:

> {N} poze în {durată} ({rată} poze/secundă).

- Durata e ceasul de perete de la pornirea importului până la revenire, inclusiv încărcarea modelelor.
- Rata e `N / (durată în secunde)`, o zecimală, punct zecimal. Sub un minut, durata e `48.0s` (fără spațiu).
- Nu există trepte. Nu apare în Despre. Dispare la repornire.

Exemplu pe 1.240 de poze în 48 de secunde: `1240 de poze în 48.0s (25.8 poze/secundă).`

## Ce arată build-ul ăsta

Aceeași durată, scrisă și invers, plus cele două trepte (ceas de perete, nu sumă per poză):

> Analizat 1.240 de poze în 48 s (0,04 s/poză) · treapta 1: 12 s, treapta 2: 36 s

`0,04 s/poză` este `1 / 25,8`. Aceeași măsurătoare, două scrieri.

În build-ul de debug (variabila `VITE_SCAN_SUMMARY`) propoziția apare la finalul importului. În release stă ca rând mic în **Setări → Despre**, împreună cu fraza din 2.1.2, și rămâne după repornire.

## Unde se duce timpul

1. **Treapta 1**, toată galeria: decodare redusă (pe telefon, din `content://`, fără fișierul original peste punte), dHash 9×8, previzualizare. Rezultatul se ține minte. A doua trecere pe același fișier nu mai decodează.
2. **Treapta 2**, doar seriile (distanță Hamming ≤ 12, sau continuare a unei serii deja în bibliotecă): analiza de până acum, neschimbată. Fețe (Face Landmarker, GPU, apoi CPU), etichete, claritate, expunere, clipping, orizont, regula treimilor.

O poză singură nu pornește modelele. Primește claritatea și expunerea de pe miniatură.

## Ce se pierde, și unde nu

Coada „se poate salva” (`src/core/rescueQueue.ts`) are nevoie de `sharpness`, `exposure`, `highlightClipping`, `shadowClipping`, `horizonTiltDeg`, `ruleOfThirds`, `faceCount`.

- **Seriile (treapta 2), inclusiv cadrul păstrat și variantele respinse, le au pe toate.** Analiza completă nu a fost tăiată.
- **Pozele fără vecini nu le au.** Nu se scrie 0 în loc de „nemăsurat” la clipping, ca să nu pară că s-a verificat. O poză singură, strâmbă sau cu cerul ars, nu intră în coada de salvare. Asta e pierderea.

## Proxy pe mașina de build, nu pe telefon

`node scripts/scan-benchmark.mjs` (acest mediu):

| Lucru | Timp |
| --- | --- |
| Parcurgerea unui cadru 2048×2048 | 2,81 ms |
| dHash 9×8 | 0,002 ms |

Auditul vechi, pe telefon, pentru analiza completă 2.1.2: **~9,9 s/poză**, din care ML Kit Face (modul precis) era cam **33%**. Treapta 2 nu mai plătește asta pe pozele fără serie, iar fețele din serii merg pe Face Landmarker cu GPU.

Mărime scoasă din APK, din fișiere, nu dintr-un APK asamblat aici (Maven-ul Google nu e disponibil în acest mediu):

- `faceres.bin` + json: 7.050.246 octeți
- `blazeface.bin` + json: 617.966 octeți
- împreună: **7,3 MB** de Human.js
- `onnxruntime-web` nu mai e dependență, deci wasm-ul de ~25 MB nu mai e emis

Cifra de pe telefonul proprietarului e rândul din Despre, după un import real.
