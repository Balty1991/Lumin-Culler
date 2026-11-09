# Cherrypic

Asistentul foto cu AI care rulează pe telefon. Alege pozele zilei, grupează seriile, face curățenie în galerie și poate înfrumuseța o poză — fără să urce fotografiile pe un server. Pe Google Play înlocuiește Lumin Culler, cu același pachet `com.luminculler.app`.

Versiunea afișată vine din `package.json` (acum 3.3.0). `versionCode`-ul local din `android/app/build.gradle` crește la fiecare încărcare; pachetul din Play e construit de `.github/workflows/release-android.yml`, care pune `versionCode` din numărul rulării GitHub.

## Ce rămâne neschimbat la publicare

- Pachet: `com.luminculler.app`. Semnarea de release citește `android/app/keystore.properties` (nu e în git).
- Abonamente: `lumin_premium_monthly`, `lumin_premium_yearly`.
- Produs unic: `cherrypic_pro_forever`. ID-ul `lumin_premium_lifetime` a fost folosit de aplicația pe care o înlocuiește; `cherrypic_pro_lifetime` e ocupat greșit ca abonament. Nu le redenumi în cod fără un produs nou în Play Console.
- Fără reclame, fără plan săptămânal. Sortarea, galeria, căutarea, oamenii, corecția automată și stilurile Natural / Vie / Caldă rămân gratuite. O curățenie mare pe lună e gratuită.
- Dacă Play nu răspunde cu produse (web, build nesemnat), nimic nu se blochează.

## Ecrane

Patru locuri, jos: **Azi**, **Galerie**, **Studio**, **Setări**. Sortarea, curățenia, editorul și Pro se ating în cel mult două atingeri. Oferta Pro apare după un rezultat văzut (o curățenie sau cel puțin șapte alegeri), nu la prima deschidere.

## Dezvoltare

```bash
npm ci
npm test
npm run dev
npm run build
```

Android: `npm run cap:sync`, apoi Android Studio. Fără `keystore.properties`, build-ul de release rămâne nesemnat.

Pozele de probă pentru editor stau în `docs/real-photo-samples/` (licențe CC BY-SA, nu o galerie de 12 fotografii de pe telefon). Rezultatul pe un telefon real rămâne de confirmat de proprietar.
