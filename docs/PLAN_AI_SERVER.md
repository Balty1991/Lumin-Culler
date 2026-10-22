# Varianta A — efecte AI generative pe server

Ce înseamnă: omul alege o poză (sau o persoană din „Cum a crescut”) și
primește un clip de 5 s în care poza „prinde viață” (zâmbește, se întoarce,
camera se mișcă), sau un stil (desen, pictură, film vechi). Telefonul nu poate
genera așa ceva; se face pe serverele unui furnizor de modele video.

## Cât costă un clip (estimări din octombrie 2026, de verificat pe paginile furnizorilor)

| Model | Preț aprox. | Un clip de 5 s, 720p, fără sunet |
|---|---|---|
| Kling 3.0 Standard (prin fal.ai) | ~0,084 $ / s | ~0,42 $ |
| Veo 3.1 Lite | ~0,03–0,05 $ / s | ~0,15–0,25 $ |
| Runway Gen-4 Turbo | ~0,05 $ / s | ~0,25 $ |
| Luma Ray | ~0,06–0,09 $ / s | ~0,30–0,45 $ |

Surse: comparații publicate de revânzători (teamday.ai, modelslab.com,
higgsfield.ai) — au interes comercial, deci prețurile se verifică direct.

## Ce înseamnă pentru bani

Fiecare generare costă bani reali. Deci planul nu poate fi „nelimitat”:

- **Gratuit:** 1 clip de probă (cu semn Lumin) — costă ~0,25–0,45 $ per om
  care încearcă. La 1.000 de instalări: ~250–450 $ doar pe probe.
- **Premium:** abonamentul include un număr de clipuri pe lună (ex. 20),
  plus pachete de credite cumpărate separat.
- Exemplu anual: 29,99 $ → după comisionul Google (15%) ~25,5 $. Dacă omul
  face 30 de clipuri pe an × 0,42 $ = 12,6 $ cost → rămân ~13 $. Un om care
  face 200 de clipuri pe an aduce pierdere — de aceea limita de credite.
- În categoria asta concurența vinde abonamente săptămânale; noi am ales să
  nu avem plan săptămânal. De rediscutat doar dacă testele arată că anualul
  nu se vinde.

## Arhitectura

1. Aplicația trimite poza (micșorată, fără date EXIF/locație) la un **server
   intermediar al nostru** — niciodată direct la furnizor, ca cheia API să nu
   stea în aplicație.
2. Serverul (Cloudflare Workers sau Firebase Functions — cost aproape zero la
   început) verifică: cererea vine din aplicația reală (Play Integrity API),
   omul are credite, nu depășește limita pe zi.
3. Serverul cere clipul de la furnizor (fal.ai sau direct Google Veo), iar la
   final aplicația îl descarcă și îl salvează în galerie.
4. Pozele și clipurile nu se păstrează pe server după livrare (șterse automat
   în 24 h), și asta se scrie în politica de confidențialitate.

## Ce trebuie decis de tine înainte să construiesc

1. **Accept să schimbăm promisiunea** „nimic nu pleacă de pe telefon” în
   „curățenia și recunoașterea rămân pe telefon; efectele AI se fac pe
   server, doar când le ceri tu, iar pozele se șterg după 24 h”.
2. **Cont la furnizor** (recomand fal.ai: un singur cont, mai multe modele,
   plată la consum) și un buget de test lunar (ex. 50 $).
3. **Cont Cloudflare sau Firebase** pentru serverul intermediar (gratuit la
   început).
4. **Prețurile și numărul de clipuri** incluse în Premium.
5. **Politica de conținut:** furnizorii refuză anumite poze (ex. minori în
   anumite efecte, nuditate). Clipurile cu copii trebuie tratate cu grijă —
   unele efecte nu se oferă pentru poze cu copii.

## Ce pot construi fără deciziile de mai sus

Interfața (alegerea pozei, efectele, ecranul de așteptare, galeria de
clipuri) și serverul intermediar, testate cu un furnizor simulat. Legarea
la furnizorul real se face în ziua în care există contul și bugetul.
