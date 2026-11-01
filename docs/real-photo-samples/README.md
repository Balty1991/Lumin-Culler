# Probe foto reale pentru editorul automat

Fotografiile de aici sunt exemple reale, nu imagini desenate. Sunt folosite ca material de verificare vizuală locală pentru aceeași funcție `renderLook` folosită de testele editorului. Nicio fotografie nu este trimisă la server de aplicație.

Pentru a recrea rezultatele înainte/după:

```bash
python3 -m pip install Pillow
npx --yes tsx scripts/render-real-photo-samples.ts
```

Scriptul citește cele trei fișiere JPEG, aplică algoritmul local din `src/core/renderLook.ts` și scrie versiunile „după” în `rendered/` plus valorile măsurate în `results.json`. Fotografia portret are o regiune a feței delimitată manual ca input de test; algoritmul nu a activat relight-ul în această probă (`relight: 0`), deci portretul nu demonstrează corecția feței. Nu este testată detectarea automată a fețelor.

![Comparație înainte și după pe cele trei fotografii reale](preview.jpg)

În rularea de referință, algoritmul a ridicat luminanța medie a fotografiei subexpuse de la 0,2158 la 0,3398 și a cadrului urban de la 0,2994 la 0,3969. Pe portret a detectat dominanta de culoare, claritatea redusă și tonul pielii; rezultatul a rămas aproape la aceeași luminanță. Regiunea feței este doar o etichetă manuală, iar relight-ul nu a fost activat de rețetă în această probă (`relight: 0`). Datele complete sunt în [`results.json`](results.json).

## Imagini și licențe

Toate copiile din această mapă au fost redimensionate pentru teste și salvate fără metadate EXIF. Copiile și rezultatele derivate sunt distribuite conform licenței CC BY-SA 4.0 indicate pentru fiecare sursă. Autorii nu susțin și nu au aprobat aplicația.

- `underexposed-photo.jpg` — Dawid Skalec, [Underexposed photo](https://commons.wikimedia.org/wiki/File:Underexposed_photo.JPG), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Fotografie subexpusă a unui sat.
- `backlit-headshot.jpg` — SugarShackfilm / Guochen Wang, [MoBradleyHeadShot backlit small](https://commons.wikimedia.org/wiki/File:MoBradleyHeadShot_backlit_small.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Portret în contralumină.
- `city-backlight.jpg` — Ddgfoto, [City backlight](https://commons.wikimedia.org/wiki/File:City_backlight.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Oraș fotografiat în contralumină la apus.

## Limită de validare

Aceste exemple arată ce produce rutina locală pe fotografii reale. Nu acoperă întregul `autoEnhance` din interfață, detectarea nativă a feței sau variația dintre telefoane. Nu înlocuiesc testarea pe un telefon Android cu fotografii dintr-o galerie reală și nu sunt un test de acceptanță realizat de utilizator. Înaintea unei lansări trebuie verificată vizual fiecare pereche înainte/după și întregul flux de import, selecție și salvare pe telefon.
