# Checklist publicare pe Google Play

Ghid concret pentru a duce Lumin Culler Pro de la "cod care merge" la "aplicatie live
pe Play Store". Impartit in ce e deja gata (facut de Claude in repo) si ce ramane de
facut manual de tine (necesita contul tau Google/Play Console, decizii de business,
sau artefacte pe care nu ai voie sa le generezi/tii altundeva decat la tine).

## Deja gata in repo

- **Icon aplicatie**: `public/icon-*.png` + iconitele native Android (`android/app/src/main/res/mipmap-*`) — deja generate, nu sunt placeholder-uri Capacitor.
- **Manifest PWA**: `vite.config.ts` (VitePWA) — nume, descriere, culori, iconite.
- **Configurare de semnare release**: `android/app/build.gradle` citeste automat `android/app/keystore.properties` daca exista (vezi `keystore.properties.example` din acelasi folder pentru cum il generezi). Fara acel fisier, build-ul de release ramane nesemnat ca inainte — nu strica nimic pana esti gata.
- **Politica de confidentialitate**: `public/privacy-policy.html`, publicata automat la fiecare push pe `main` (workflow-ul existent `Build & Deploy`) la adresa:
  `https://balty1991.github.io/Lumin-Culler/privacy-policy.html`
  Verifica manual ca link-ul chiar functioneaza dupa urmatorul deploy, inainte sa-l pui in Play Console.
- **Fara tracking/reclame**: aplicatia nu are SDK-uri de analytics/publicitate — simplifica mult raspunsurile din formularul "Data Safety" (mai jos).

## Ce trebuie sa faci TU (nu poate face Claude pentru tine)

### 1. Cont Google Play Console
- [play.google.com/console](https://play.google.com/console) — taxa unica **25 USD**.
- Verificare de identitate (poate dura cateva zile pentru conturi noi) — fa asta cat mai devreme, e pe drumul critic.

### 2. Genereaza cheia de semnare (keystore) — CRITIC, ireversibil
- Ruleaza **local, pe calculatorul tau** (nu intr-un mediu temporar/cloud):
  ```
  keytool -genkey -v -keystore lumin-culler-release.jks -alias lumin-culler -keyalg RSA -keysize 2048 -validity 10000
  ```
- **Fa imediat backup** al fisierului `.jks` + parolelor (manager de parole + o copie separata, offline). Daca il pierzi si nu ai activat Play App Signing, nu mai poti niciodata publica o actualizare la aceeasi aplicatie — doar o listare noua, fara review-urile/istoricul actual.
- La primul upload in Play Console, accepta **Play App Signing** (Google pastreaza o copie securizata a cheii de semnare finala) — reduce riscul de mai sus.
- Completeaza `android/app/keystore.properties` (copie din `.example`) cu caile/parolele reale — fisierul e deja in `.gitignore`, nu ajunge niciodata in GitHub.

### 3. Build de productie (.aab)

**Optiunea recomandata — automat prin GitHub Actions** (`.github/workflows/release-android.yml`, deja in repo), fara sa instalezi Android Studio local:
1. In acest repo, Settings → Secrets and variables → Actions, adauga 4 secrete: `ANDROID_KEYSTORE_BASE64` (rezultatul din `base64 -w0 lumin-culler-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
2. Actions → "Build signed Android release" → Run workflow (sau push un tag `v1.0.0`).
3. Descarci `.aab`-ul din artifacts-urile rularii (pastrat 90 de zile) si-l urci direct in Play Console.

**Optiunea locala** (daca ai deja Android Studio):
```
npm run build
npx cap sync android
cd android && ./gradlew bundleRelease
```
Rezultatul (`android/app/build/outputs/bundle/release/app-release.aab`) e fisierul pe care-l urci in Play Console.

### 4. Assets grafice pentru fisa Play Store
- **Feature graphic**: 1024×500 px — gata generat, `public/store/feature-graphic.png` (foloseste iconita si paleta reala a aplicatiei). Verifica-l vizual inainte sa-l urci, il poti regenera/ajusta oricand.
- **Screenshot-uri telefon**: gata 5, in `public/store/screenshots/` — din aplicatia instalata (fara interfata browserului), cu poze fara continut personal. Acopera minimul de 2 cerut de Play Console; poti adauga altele daca vrei sa arati si alte ecrane (Persoane cunoscute, Statistici etc.).
- Optional: screenshot-uri tableta, video demo.

### 5. Fisa aplicatiei (Store listing)
- Titlu, descriere scurta si lunga (RO + EN) — gata scrise in `docs/PLAY_STORE_LISTING.md`, gata de copiat in Play Console.
- Categorie: **Fotografie**.
- Email de contact: foloseste-l pe cel real de business, nu neaparat cel personal.
- URL politica de confidentialitate: link-ul de mai sus.

### 6. Formularul "Data Safety" (obligatoriu, Google verifica manual)
Pe baza a ce chiar face aplicatia (vezi `public/privacy-policy.html`):
- **Colectare date**: NU colectezi/transmiti date catre servere — totul e procesat si stocat local pe dispozitiv.
- **Poze**: procesate local, nu sunt incarcate.
- **Date faciale ("persoane cunoscute")**: declara-le ca informatie sensibila procesata **doar local, niciodata transmisa** — Google Play e strict aici, raspunde cu atentie, nu bifa "nu se aplica".
- **Permisiuni**: verifica lista REALA in `android/app/src/main/AndroidManifest.xml`, nu din memorie. Azi sunt patru: `INTERNET` (incarcare resurse aplicatie, nu date personale), `READ_MEDIA_IMAGES`, `READ_MEDIA_VISUAL_USER_SELECTED` (Android 14+, cazul "acces limitat") si `READ_EXTERNAL_STORAGE` (`maxSdkVersion="32"`). Cele trei de acces la poze sunt cerute de Supervizorul galeriei si de "Adu pe perioade" (`MediaLibraryPlugin.kt`), care citesc din MediaStore pe intervale de timp — deci aplicatia CHIAR cere acces la galerie, pe langa selectorul de sistem, iar formularul trebuie sa spuna asta. Pozele raman procesate local; permisiunea e despre citire, nu despre transmitere. `com.android.vending.BILLING` se adauga singura la merge-ul de manifest, din biblioteca Play Billing.
- Daca in viitor adaugi sincronizarea prin GitHub (sau alt cloud), formularul trebuie actualizat ATUNCI, inainte de urmatorul update — sa reflecte ca acele date (setari + model AI, fara nume/poze) pot fi transmise optional, la cererea utilizatorului.

### 7. Content rating questionnaire
Completezi un chestionar standard Google (violenta/continut adult/etc.) — pentru o aplicatie de organizare foto, ar trebui sa iasa ratingul cel mai permisiv ("Everyone"/"3+"), dar raspunde onest la fiecare intrebare.

### 8. Track de testare inainte de productie
Recomandat: **Internal testing** (cativa testeri, tu insuti) → **Closed testing** (grup mai larg, cateva zile/saptamani) → **Production**. Nu trece direct la productie fara sa fi rulat macar internal testing pe un telefon real.

### 9. Monetizare — DECISA SI IMPLEMENTATA

Sectiunea asta era scrisa ca o decizie inca neluata ("inainte de a scrie cod de
billing"). Intre timp codul exista si e complet, deci mai jos e ce e chiar in
aplicatie, nu variante de ales.

**Modelul ales: freemium, cu plafon pe IESIRE, nu pe intrare.**
Triajul e gratuit si nelimitat — import, scor AI, sortare, grupare, comparare
serii, oricate poze. Se plateste pentru ce faci cu rezultatul:

| Ce | Gratuit | Premium |
|---|---|---|
| Poze scoase din aplicatie (exportate **sau** sterse din telefon) | 150 la fiecare 30 de zile (fereastra glisanta) | nelimitat |
| Persoane recunoscute inrolate | 1 | oricate |
| Predare Lightroom (XMP), plansa de contact, dosar privat | — | da |
| Recap lunar, prezentare, calatorii | — | da |
| Sugestia de combinare a doua cadre | — | da |

Numerele traiesc in `src/core/entitlement.ts` (`FREE_PHOTOS_PER_MONTH`,
`FREE_ENROLLED_PERSONS`) — se schimba acolo, intr-un singur loc.

**Ce e deja scris:**
- `android/.../plugins/BillingPlugin.kt` — Play Billing scris de mana
  (status/price/subscribe + confirmarea achizitiei, fara care Google
  ramburseaza automat in 3 zile).
- `src/core/billing.ts` + `src/core/entitlement.ts` — puntea si cache-ul local.
- `src/ui/PremiumPanel.tsx` — cele trei stari (abonat / cumparabil / in curand)
  si butonul de restaurare a achizitiei.

**Regula care tine tot modelul, si care nu trebuie stricata:** nimic nu se
blocheaza cat timp nu exista o cale reala de plata pe dispozitiv (vezi
`isPurchasable()`). Pe web/PWA, si pe orice build in care produsul nu e inca
publicat in Play Console, plafoanele doar informeaza. Un plafon care opreste
utilizatorul fara sa-i dea cum sa treaca de el nu e freemium, e un perete.

**Ce a mai ramas de facut, si e in AFARA codului:**
1. In Play Console, un abonament cu ID-ul **`lumin_premium_monthly`** (exact
   acesta — vezi `subscriptionId` in BillingPlugin.kt), cu cel putin un plan de
   baza activ. Fara el, `price()` intoarce gol si butonul de cumparare nici nu
   se afiseaza.
2. Build **semnat cu cheia de release**, incarcat macar pe internal testing.
   Play Billing nu raspunde niciodata unui APK de debug instalat cu adb.
3. Contul de test adaugat ca **licensed tester** in Play Console.
4. In fisa din Store: mentionarea explicita a abonamentului si a pretului in
   descriere, plus sectiunea de preturi completata. `docs/PLAY_STORE_LISTING.md`
   nu spune azi nimic despre abonament — de completat inainte de publicare.
5. De testat pe device, in ordinea asta: cumparare → repornire aplicatie
   (abonamentul trebuie sa persiste) → "Am deja abonament — restaureaza" pe o
   instalare curata → anulare din Play (dupa expirare, aplicatia trebuie sa
   revina la gratuit singura, la prima pornire cu retea).

## Ordinea recomandata

1. Cont Play Console (verificarea de identitate poate dura — porneste-o primul).
2. Keystore + build de productie functional local.
3. Internal testing pe un telefon real — prinde bug-urile reale de packaging inainte de orice altceva.
4. Assets grafice + fisa Store + Data Safety + content rating.
5. Monetizare: codul e scris (vezi 9) — mai raman configurarea produsului in Play Console, un build semnat si testarea fluxului pe device.
