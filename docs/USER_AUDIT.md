# Audit ca utilizator — 9 noiembrie 2026

Parcurs în build-ul web de producție (ecranele goale și cu poze de probă) și în cod. Nu există telefon ADB în mediul ăsta, deci fluxurile native (coșul Android, Play Billing, camera pentru „Refă poza”) nu au fost apăsate pe un dispozitiv.

## Ce s-a schimbat

- Meniul de jos: Azi, Galerie, Studio, Setări. Studio înlocuiește „AI-ul tău” și începe cu „Mai frumoasă”, apoi filme, „Cu cine seamănă”, anul în zâmbete, capsula, coperta. Ce a învățat AI-ul rămâne dedesubt.
- Galerie: căutarea stă deasupra filtrelor când ești pe Poze. Ordinea filtrelor: Poze, Momente, Oameni, Zile, Deoparte, Luni, Hartă.
- Azi nu mai îngroapă filmele și duelul. Curățenia și „Acum un an” (cu „Refă poza”, dacă telefonul are cameră) rămân aici.
- Paywall-ul nu se mai deschide la primul antrenament și nici singur după sortarea automată de dimineață. Apare după cel puțin 7 alegeri Păstrez/Nu azi sau după o curățenie terminată, cel mult o dată pe zi. „Nu acum” și butonul de plată stau deasupra listei lungi de beneficii. Planul implicit rămâne anualul când economia față de lunar e de cel puțin 5%, cu zilele de probă venite de la Play, nu scrise în cod.
- Evenimentele `paywall_shown`, `paywall_dismissed`, `trial_started`, `purchase_monthly|yearly|lifetime` se scriu doar pe telefon și se citesc din Setări → Diagnostic.
- Carduri de partajare, desenate pe dispozitiv: spațiul eliberat, înainte/după din editor, „Cu cine seamănă” și „Atunci și acum”. Legătura e fișa Play (`com.luminculler.app`).
- Autopilotul nu trimite în coș, în bloc, pozele cu oameni înrolați. Documentele și capturile rămân la Deoparte. După ștergere, textul spune câte au plecat în coș, câte fețe au fost protejate și că se pot pune înapoi. „Sortează tot” cu „Decid tot” privește galeria vizibilă, nu doar ziua.

## Ce rămâne pentru proprietar

- În Play Console, produsele trebuie să existe cu ID-urile din cod: `lumin_premium_monthly`, `lumin_premium_yearly` (probă 7 zile doar pe anual, pentru utilizatori noi), `cherrypic_pro_forever` (produs unic). Documentația veche mai scria `lumin_premium_lifetime` — ăla e ID-ul istoric al aplicației înlocuite, nu ID-ul din `BillingPlugin.kt`. Nu redenumi ID-urile în cod: creează în Console exact șirurile de mai sus. `cherrypic_pro_lifetime` e ocupat greșit ca abonament și nu se refolosește.
- Prețurile din fișă (12,99 RON / 69,99 RON / 149,99 RON și echivalentele EUR/USD) se pun în Console. Aplicația arată doar ce răspunde Play.
- Oferta de recâștigare pe anual, listingurile RO/EN, experimentul de fișă și clipul de 15–30 s sunt în Play Console, nu în cod. Vezi `docs/PLAY_STORE_LISTING_CHERRYPIC.md`.
- Semnarea: fără `keystore.properties`, AAB-ul de release iese nesemnat. Billing nu răspunde unui APK de debug.
- `versionCode` local e 7, `versionName` 3.3.0. Workflow-ul de release suprascrie `versionCode` cu `GITHUB_RUN_NUMBER`.
- Editorul automat are 3 fotografii reale licențiate în `docs/real-photo-samples/`, nu 12. Pe portretul în contralumină, rețeta de probă nu a activat relight-ul. Confirmarea „wow” pe un telefon, cu poze de 12 MP din galerie, rămâne de făcut. Nu promitem super-rezoluție de tip Remini.
- Viteza de import nu a fost remăsurată pe telefonul proprietarului. Ținta din roadmap (sub 0,5 s/poză pentru prima decizie) rămâne nemăsurată aici.
- Data safety rămâne „nu colectăm” cât timp Cloud e oprit. Un furnizor Gemini schimbă declarația înainte de publicare.
