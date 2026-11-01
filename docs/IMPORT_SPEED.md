# Viteză la citirea pozelor

## Înainte (telefonul proprietarului, 8 poze de azi)

Mesajul de pe ecran:

```text
Analizat 8 poze în 16 s (1,98 s/poză)
pregătire 0,2 s · treapta 1 0,2 s · treapta 2 14 s · disc 0,0 s
```

Treapta 1 (amprenta) era deja scurtă. Cele 14 secunde erau treapta 2: pentru pozele dintr-o serie se aștepta analiza completă (fețe, etichete, postură, embedding) **înainte** ca importul să se termine, iar apoi, în același ceas, mai rulau ochii și animalele, una-două deodată.

## Ce s-a schimbat

1. **Miniatura MediaStore** (`StageOnePlugin.kt`). Amprenta, previzualizarea și metricile de lumină/claritate se iau din miniatura deja făcută de Android (`loadThumbnail`, 480 px), nu din decodarea JPEG-ului de 12 MP. Dacă miniatura lipsește, rămâne decodarea veche, cu `inSampleSize`.
2. **Rezultatul apare din treapta ușoară.** Fiecare poză primește decizia din claritate și expunere imediat. Modelele grele pornesc doar pentru serii (sau poze deja în bibliotecă) și **nu mai țin ceasul** mesajului „Analizat…”. În teste sunt așteptate, ca verificările să vadă scorul final.
3. **Ochii, persoanele și animalele** continuă după ce importul a raportat decizia. Pleacă câte 4, nu câte 2 (`POST_CONCURRENCY`). Lotul se pregătește pe 4 benzi (`IMPORT_LANES`).
4. Pozele deja importate se sar în continuare (`alreadyImported`). Amprenta de treaptă 1 rămâne în cache.

## După, ce se poate spune fără telefonul acela

Nu am putut rula cele 8 poze pe același aparat. Pe cod:

- Ceasul mesajului nu mai include modelele grele și coada de ochi/animale. Pe captura veche, alea erau 14 din 16 secunde. Decizia care rămâne în mesaj e pregătirea + amprenta + treapta ușoară (pe captura: sub 0,5 s în total pentru 8 poze, plus citirea EXIF).
- Ținta „sub 0,5 s/poză” e pentru **prima decizie pe ecran**, nu pentru recunoașterea feței dintr-o serie. Aia încă costă modelele native și rulează în fundal; scorul se actualizează când termină.
- Corecția din editor, măsurată pe scenele de test de 120×90 px, stă în `docs/auto-look-samples.json` (de obicei câteva zeci de milisecunde pe scenă, în Node, nu pe telefon).

Pe un telefon mediu, primul rând de poze ar trebui să apară în câteva secunde și pentru un lot mai mare, pentru că nu se mai așteaptă fața fiecărei poze din rafală.
