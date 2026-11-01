# Audit ca utilizator

Nu am putut instala APK-ul pe un telefon și să apăs prin toate ecranele. Am parcurs fluxurile în cod (pornire, import, Azi, galerie, recenzie, editor, asistent, plată, setări, cele 6 limbi) și am reparat ce ținea de cererea asta. Restul e mai jos, neschimbat.

## Pornire

Prima deschidere arată turul și ecranul Azi. Restul ecranelor se încarcă la prima atingere. Textul de prezentare din toate cele șase limbi descrie acum trierea asistată: AI-ul învață din alegeri, grupează duplicatele/rafalele/pozele mișcate pentru revizuire și nu promite ștergere automată. Limba română păstrează diacriticele corecte.

## Import și Azi

Pozele noi de azi se citesc din galerie. Înainte, mesajul „Analizat…” aștepta modelele grele (vezi `docs/IMPORT_SPEED.md`). Acum decizia ușoară apare, iar seriile se completează în fundal. Riscul rămas: alegerea „cea mai bună din rafală” se face întâi din claritate și expunere; scorul cu fețe sosește după. Dacă o poză cu ochii închiși e aleasă și apoi coborâtă, omul poate vedea o clipă decizia veche.

## Galerie

Căutarea, momentele, zilele, lunile și oamenii rămân ecranele existente; identitatea roz-violet și dock-ul din captura Android sunt păstrate. Pe „Azi”, starea de analiză, fotografiile alese și decizia asupra celor neclare apar înaintea propunerilor de partajare/memorii. În timpul scanării, cardurile secundare sunt ascunse ca să nu concureze cu progresul. Grila foto nu a fost redesenată structural; am adăugat doar focus vizibil, feedback subtil pe hover și suport pentru `prefers-reduced-motion`. Derularea taburilor rămâne doar pe opacitate, ca să nu strice elementele `position: fixed`.

## Recenzie (Păstrez / Nu azi)

Fluxul de card rămâne. Explicația AI e tot cea de pe telefon. Nu am mutat decizia pe server: cota Cloudflare nu trebuie să stea între om și o poză.

## Editor

„Mai frumoasă” măsoară poza și spune ce a reparat (întuneric, contralumină, culoare, ceață, zgomot, cer, ten, ochi roșii). Linia înainte/după pornește de la „doar după” și alunecă la jumătate. Îndreptarea se activează singură când orizontul e înclinat cu cel puțin 1,5°. Decupajul inteligent nu se aplică singur: ar tăia comparația și, pe un corp întreg, a mai tăiat picioare. Rămâne în fila Cadru.

În browser, compararea înainte/după coalescează mișcările într-un `requestAnimationFrame` și mută separatorul/decuparea direct în DOM; dragul nu mai re-randează toată foaia React la fiecare eveniment. Am păstrat testul final pe telefon ca verificare necesară.

Stilurile Portret, Retuș, Clară, Film, Alb-negru și Dramatică cer Premium la salvare. Natural, Vie și Caldă rămân gratuite, la fel ca toată corecția automată.

## Asistent online

Auto AI nu mai depinde de cotă. Dacă serverul tace, telefonul corectă și spune asta. Cerul și guma fac la fel. Detaliile de plată sunt în `docs/AI_PROVIDERS.md`.

## Plată

`applicationId` rămâne `com.luminculler.app`. Produsele rămân `lumin_premium_monthly`, `lumin_premium_yearly`, `lumin_premium_lifetime`. `versionCode` local e 6 (`versionName` 3.2.0). Pachetul din Play e construit de workflow, care pune `versionCode` din numărul rulării GitHub, nu din cifra asta.

Premium deblochează stilurile, textele online fără plafonul din aplicație, filmul zilei, acceptarea tuturor și curățenia. Triajul și corecția automată rămân gratuite: altfel abonamentul s-ar vinde pe ceva ce telefonul face oricum.

## Setări și limbi

Șase limbi, căderea pe engleză pentru cheile lipsă. Nu am retestat fiecare ecran în fiecare limbă pe un dispozitiv.

## Ce rămâne de făcut pe un telefon

- Confirmat viteza pe aceleași 8 poze (mesajul nou ar trebui să fie mult sub 2 s/poză; seriile se termină în fundal).
- Sunt adăugate probe locale înainte/după pe fotografii reale în `docs/real-photo-samples/`; ele exercită `renderLook`, nu întregul ecran nativ „Mai frumoasă”. Trebuie confirmat pe telefon că importul, afișarea, atingerea butoanelor și salvarea merg pe fotografii dintr-o galerie reală.
- Testul fizic pe un Android nu a fost făcut: mediul de dezvoltare nu are dispozitiv ADB sau emulator Android disponibil.
- Cheie Gemini dacă se vrea rafinarea online după ce cota Cloudflare moare.
- Semnarea de release: fără `keystore.properties`, `assembleRelease` iese nesemnat, cum era și înainte.
- Play Console: data safety neschimbată dacă nu se pornește Gemini. Cu Gemini, poza mică pleacă la Google și declarația trebuie să o spună.
