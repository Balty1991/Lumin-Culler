# Fișa Play Store, varianta 3: „Lumin AI — AI-ul care îți alege pozele”

## Înlocuirea aplicației existente (versiunea 3.0.0)

Lumin AI e o ACTUALIZARE a aplicației deja publicate, nu o aplicație nouă:

- același identificator de pachet: `com.luminculler.app` (nu se poate și nu
  trebuie schimbat — altfel Play o tratează ca altă aplicație);
- `versionCode` mai mare decât cel din magazin (CI-ul de release îl pune
  singur din numărul rulării), `versionName` 3.0.0;
- semnată cu aceeași cheie de upload ca până acum;
- numele, sigla și textele se schimbă din Play Console → Prezența în magazin.
  Redenumirea e permisă; nu folosi nume de alte branduri (Google, Apple,
  Samsung) în titlu sau sigla;
- sigla pentru magazin (512×512, fără transparență): `docs/play/icon-512.png`;
- aceleași produse de abonament în Play Billing (prețurile mai jos);
- Data safety și declarația pentru permisiunea de poze rămân cum sunt (vezi
  secțiunile de mai jos); nicio funcție nouă nu trimite date de pe telefon;
- politica de confidențialitate: `public/privacy-policy.html` (numele e
  actualizat la Lumin AI).

Ce verifică Play la aprobare și cum stă aplicația:
- READ_MEDIA_IMAGES: funcția de bază e sortarea galeriei (alegerea zilei),
  deci declarația „acces larg la poze” e justificată; textul pentru formular
  e mai jos;
- POST_NOTIFICATIONS: cerută cu motivul spus pe ecran (progresul analizei și
  alegerea de seară);
- FOREGROUND_SERVICE_DATA_SYNC: analiza în fundal a pozelor alese de om, cu
  notificare vizibilă cât rulează — se declară în Play Console la
  „Foreground service permissions” cu un clip scurt al notificării;
- abonamentul: prețul și reînnoirea afișate înainte de cumpărare, butonul de
  închidere vizibil (PremiumPanel), anularea prin Play.

### Text pentru declarația de acces la poze
```
Lumin AI sorts the user's own photo gallery: every day it groups new photos
into bursts, detects blurry/duplicate shots and suggests the best ones to
keep. This core feature needs to read all photos taken each day, which the
photo picker cannot provide. All processing happens on the device; no photo
is uploaded.
```


De ce o variantă nouă: fișa veche vindea „curăță galeria / eliberează
spațiu”, o categorie plină de aplicații mari (AI Photo Cleaner, Similar Photo
Cleaner, Gallery Cleaner…), unde Lumin arăta ca încă una. Aplicațiile care
chiar ALEG cea mai bună poză (Aftershoot, FilterPixel, Narrative Select) sunt
doar pe calculator, la 10–15 $/lună. Pe telefon, pentru pozele de zi cu zi,
locul e liber. Promisiunea nouă: nu „spațiu”, ci „timp și amintiri curate”.

Limitele sunt numărate exact (Play: titlu 30, descriere scurtă 80, lungă 4000).

---

## Română

### Titlu (27/30)
```
Lumin AI: îți alege pozele
```

### Descriere scurtă (77/80)
```
Din 30 de poze pe zi, AI-ul îți păstrează cele 4 bune. Pe telefon, fără cont.
```

### Descriere lungă
```
Faci multe poze. Nu ai timp să le sortezi. Galeria se umple de cadre mișcate,
rafale de 10 poze aproape identice și selfie-uri cu ochii închiși.

Lumin e AI-ul tău de sortare: în fiecare seară îți alege cele mai bune poze
ale zilei, iar tu doar confirmi. 30 de secunde, nu o oră.

CUM FUNCȚIONEAZĂ

• Ziua de azi. Seara primești „Azi ai făcut 27 de poze”. O atingere și AI-ul
  le sortează: păstrează cele bune, pune deoparte ratările.

• Din fiecare rafală rămâne una. Din zece cadre aproape identice, AI-ul o
  păstrează pe cea mai bună: claritate, ochi deschiși, zâmbet, încadrare.

• Mișcate, întunecate, cu ochii închiși: găsite singure, cu motivul spus pe
  față („mișcată”, „ochi închiși”), nu doar un scor.

• Te învață pe tine. La prima deschidere îți arată 16 perechi din pozele tale.
  Înainte să alegi tu, AI-ul ghicește, și vezi pe loc „a ghicit 12 din 16”.
  De acolo alege ca tine și se corectează cu fiecare decizie.

• Bonuri, capturi, documente: puse deoparte, în albume separate, ca să nu-ți
  ceară o decizie de fotografie.

• Albume care se fac singure: oameni, evenimente, animale. Nimic nu se mută
  din galeria ta.

PE TELEFONUL TĂU, NU ÎN CLOUD

Toată analiza rulează pe telefon. Nicio poză nu pleacă de pe dispozitiv:
fără cont, fără upload, fără reclame. Nimic nu se șterge fără confirmarea ta.

GRATUIT, FĂRĂ LIMITE ASCUNSE

Analiza, AI-ul care te învață, rafalele, Ziua de azi și exportul sunt
gratuite, oricâte poze. Pro adaugă „Acceptă tot” (ziua sortată dintr-o
atingere) și uneltele de după sortare.
```

---

## English

### Title (28/30)
```
Lumin AI: Best Photo Picker
```

### Short description (70/80)
```
From 30 photos a day, the AI keeps your best 4. On-device, no account.
```

### Full description
```
You take lots of photos. You never have time to sort them. Your gallery fills
up with blurry shots, bursts of ten near-identical frames and selfies with
closed eyes.

Lumin is your personal photo-sorting AI: every evening it picks the best
photos of your day, and you just confirm. 30 seconds, not an hour.

HOW IT WORKS

• Today. Each evening: "You took 27 photos today". One tap and the AI sorts
  them, keeping the good ones and setting the misses aside.

• One keeper per burst. Out of ten near-identical frames, the AI keeps the
  best: sharpness, open eyes, smile, framing.

• Blurry, dark, eyes closed: found automatically, with the reason spelled out
  ("blurry", "eyes closed"), not just a score.

• It learns you. On first launch it shows 16 pairs from your own photos.
  Before you choose, the AI guesses, and you see "guessed 12 of 16" live.
  From then on it chooses like you, and keeps learning.

• Receipts, screenshots, documents: set aside in their own albums, so they
  never ask for a photo decision.

• Albums that build themselves: people, events, pets. Nothing is moved in
  your gallery.

ON YOUR PHONE, NOT IN THE CLOUD

All analysis runs on your phone. No photo leaves your device: no account, no
upload, no ads. Nothing is deleted without your confirmation.

FREE, NO HIDDEN LIMITS

Analysis, the AI that learns you, bursts, Today and export are free, for any
number of photos. Pro adds "Accept all" (your day sorted in one tap) and the
after-sorting tools.
```

---

## Capturi de ecran (ordinea contează: primele 3 se văd în căutare)

1. „25 de poze aproape la fel → 3 păstrate”: cardul Azi cu cele 3–4 alese.
   Text: „AI-ul îți alege pozele zilei”.
2. Sortarea: o poză cu „Păstrez / Nu azi” și motivul AI-ului. Text: „Un minut
   pe seară”.
3. Antrenamentul: două poze, insigna „AI ✓ a ghicit” și contorul. Text: „Te
   învață pe tine, și îți arată cât de bine”.
4. Mișcate / ochi închiși cu motivul afișat. Text: „Știe de ce e ratată”.
5. Albumele (Oameni, Documente). Text: „Bonurile, separat. Amintirile, curate”.
6. „Nimic nu pleacă de pe telefon”.

## Prețuri (setate manual în Play Console, fără conversia automată)

| Piață | Lunar | Anual (trial 14 zile) | Pe viață |
|---|---|---|---|
| România | 14,99 RON | 99,99 RON | 199 RON |
| UE (EUR) | 3,99 € | 24,99 € | 49,99 € |

Fără abonament săptămânal. Trialul doar pe anual. Abonamentul se oferă o
singură dată după primul antrenament (se poate închide), apoi doar la
„Acceptă tot” și la uneltele Pro. Detalii și calcule: raportul de direcție
(Lumin-Culler, reports/Direcție Lumin AI de sortare.md).

## Data safety

Analiza rulează pe telefon (ML Kit, MediaPipe, modele locale), aplicația nu
are server și nu folosește SDK-uri de analytics, reclame sau crash reporting.
De verificat înainte de declarația „nu colectăm date”: ce trimit singure
bibliotecile Google (ML Kit, Play Billing) — conform documentației lor, se
declară separat. Permisiunea READ_MEDIA_IMAGES trebuie justificată în Play
Console: aplicația citește galeria ca să pregătească alegerea fiecărei zile.

## Înainte de publicare (deschis)

- Modelul de recunoaștere a fețelor `faceres` NU intră în build-ul pentru Play
  (licență necomercială, vezi docs/MODEL_LICENSES.md). Fișa nu promite
  „recunoaște persoanele după nume” până nu e înlocuit.
- Capturile de mai sus trebuie făcute pe APK-ul nou, după testul pe telefon.
