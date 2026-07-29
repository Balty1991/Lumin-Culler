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
```
npm run build
npx cap sync android
cd android && ./gradlew bundleRelease
```
Rezultatul (`android/app/build/outputs/bundle/release/app-release.aab`) e fisierul pe care-l urci in Play Console. Necesita Android SDK/Gradle instalate local (Android Studio e cel mai simplu).

### 4. Assets grafice pentru fisa Play Store
- **Feature graphic**: 1024×500 px (banner afisat in Store).
- **Screenshot-uri telefon**: minim 2 (recomandat 4-8), din aplicatia reala.
- Optional: screenshot-uri tableta, video demo.
- Astea chiar au nevoie de ochiul tau/designer — nu sunt ceva ce ar trebui generat automat pentru o fisa de Store serioasa.

### 5. Fisa aplicatiei (Store listing)
- Titlu, descriere scurta (80 caractere) si lunga (4000 caractere) — RO + EN daca vrei piata internationala.
- Categorie: **Fotografie**.
- Email de contact: foloseste-l pe cel real de business, nu neaparat cel personal.
- URL politica de confidentialitate: link-ul de mai sus.

### 6. Formularul "Data Safety" (obligatoriu, Google verifica manual)
Pe baza a ce chiar face aplicatia (vezi `public/privacy-policy.html`):
- **Colectare date**: NU colectezi/transmiti date catre servere — totul e procesat si stocat local pe dispozitiv.
- **Poze**: procesate local, nu sunt incarcate.
- **Date faciale ("persoane cunoscute")**: declara-le ca informatie sensibila procesata **doar local, niciodata transmisa** — Google Play e strict aici, raspunde cu atentie, nu bifa "nu se aplica".
- **Permisiuni**: doar INTERNET (incarcare resurse aplicatie, nu date personale) — fara acces global la galerie (foloseste selectorul de sistem).
- Daca in viitor adaugi sincronizarea prin GitHub (sau alt cloud), formularul trebuie actualizat ATUNCI, inainte de urmatorul update — sa reflecte ca acele date (setari + model AI, fara nume/poze) pot fi transmise optional, la cererea utilizatorului.

### 7. Content rating questionnaire
Completezi un chestionar standard Google (violenta/continut adult/etc.) — pentru o aplicatie de organizare foto, ar trebui sa iasa ratingul cel mai permisiv ("Everyone"/"3+"), dar raspunde onest la fiecare intrebare.

### 8. Track de testare inainte de productie
Recomandat: **Internal testing** (cativa testeri, tu insuti) → **Closed testing** (grup mai larg, cateva zile/saptamani) → **Production**. Nu trece direct la productie fara sa fi rulat macar internal testing pe un telefon real.

### 9. Decizie de monetizare (inainte de a scrie cod de billing)
Google Play NU permite plati directe (Stripe etc.) pentru continut/functii digitale in-aplicatie — trebuie **Google Play Billing**. Decide intai:
- Gratuit la inceput, monetizare mai tarziu (recomandat daca nu esti sigur de cerere)?
- Cumparare unica (o singura plata, deblocheaza tot)?
- Abonament (lunar/anual, functii premium continue — ex. sincronizare cloud pentru clienti)?
- Freemium (gratuit cu limite — ex. numar de poze/luna — plus upgrade platit)?

Raspunsul aici schimba mult ce construim la pasul de "backend + conturi utilizatori" discutat separat.

## Ordinea recomandata

1. Cont Play Console (verificarea de identitate poate dura — porneste-o primul).
2. Keystore + build de productie functional local.
3. Internal testing pe un telefon real — prinde bug-urile reale de packaging inainte de orice altceva.
4. Assets grafice + fisa Store + Data Safety + content rating.
5. Decizie de monetizare → abia apoi billing/backend, ca sa nu construim ceva ce se schimba dupa.
