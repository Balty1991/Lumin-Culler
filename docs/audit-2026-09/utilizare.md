# Lumin Culler Pro — audit de utilizare, ca utilizator real

**Data:** 9 septembrie 2026 · **Ramura:** `claude/app-market-research-improvements-javylj` · **Niciun fișier din repo nu a fost modificat, niciun commit, niciun push.**

Raportul ăsta continuă munca unei sesiuni anterioare care a strâns dovezile (capturi + ~37 de scripturi Playwright în `scratchpad/audit/`) dar n-a apucat să scrie. Am recuperat dovezile, le-am completat cu rulări noi, și scriu incremental.

Complementar cu `cercetare-tehnica.md` (viteză, arhitectură, design system, monetizare strategică). **Nu repet ce s-a spus acolo.** Unde un lucru se vede și în utilizare, îl leg de secțiunea de acolo și adaug doar ce se vede cu ochiul.

---

## 0. Legenda de dovadă

| Marcaj | Ce înseamnă |
|---|---|
| **[V]** | **Văzut** — am rulat aplicația și am văzut cu ochii mei, într-o captură pe care o numesc. |
| **[C]** | **Citit din cod** — `fișier.ts:linie`. |
| **[P]** | **Presupus** — n-am dovadă directă. Spun ce ar confirma-o. |

**Cum am testat:** build de producție (`npm run build` → `vite preview` pe 4173), Chromium 1194 prin Playwright, viewport **412×915** (telefon Android tipic), `deviceScaleFactor: 1`, locale `ro-RO` și `en-US`. Profiluri persistente separate per flux, ca a doua sesiune să fie chiar a doua sesiune.

**20 de poze de test** generate cu Pillow (`audit/genphotos.py`): 4 bune, o serie de 3 aproape identice, 3 grade de blur, 2 întunecate, 2 arse, un document/factură cu text, ceață plată, una minusculă, un „portret" desenat, o copie exactă a unei poze, o captură de ecran PNG.

### Ce n-am putut exercita — spus limpede

1. **Fețe reale.** Nu pot genera fețe. Deci: **detecția de fețe, recunoașterea persoanelor, Persoane/înrolare, zâmbet/ochi/privire, headroom, FaceCompareStrip, „a doua persoană = premium"** — toate au fost exercitate doar pe drumul „nicio față găsită". Fluxul Persoane e evaluat din cod și din ecranele goale, nu din utilizare. Marcat explicit oriunde apare.
2. **Plugin-urile native Kotlin** (billing real, MediaLibrary, SAF, HEIC, notificări, Gemini Nano). Deci: **cumpărarea propriu-zisă nu a fost testată**, doar panoul care o cere.
3. **Telefon real** — deci nimic despre termic, baterie, gesturi de swipe reale (am simulat cu tastatură/click unde se putea), sau despre foaia de partajare Android.
4. **Volume mari.** 20 de poze, nu 800 sau 2000. Tot ce ține de scară (grilă lungă, memorie, timp) e marcat [P] și trimis la măsurătorile din `cercetare-tehnica.md`.

---

## 1. Cei trei oameni, și unde se împiedică fiecare — pe scurt

Detaliile sunt în secțiunile 2-14. Ăsta e răspunsul la întrebarea din brief.

### Părintele cu 800 de poze după vacanță
**Unde se împiedică:** la minutul 30 al analizei, cu telefonul fierbinte, când încă nu a văzut nicio poză. `cercetare-tehnica.md` măsoară 201 poze în 8m15s → **800 de poze ≈ 33 de minute** [X, din raportul anterior]. Aplicația nu-i spune niciodată **cât mai durează** — arată doar timpul SCURS („`ANALYSIS STUDIO … 37s`", captură `p1-05-analysis-t35`) [V]. Un contor care crește la nesfârșit fără estimare e cea mai proastă formă de așteptare.
**A doua împiedicare:** dacă anulează (și va anula), pierde tot ce n-a fost procesat, **fără nicio ofertă de reluare** — §9.
**A treia:** nu va lovi niciodată plafonul de 150, pentru că nu ajunge la export. Deci nu vede niciodată de ce ar plăti — §13.

### Fotograful de nuntă care predă o selecție și lucrează în Lightroom
**Unde se împiedică:** la exportul XMP. Foaia se numește „**Export selecție**", scrie „**4 poze selectate**" — dar `exportXMP()` scrie sidecar-uri pentru **TOATE pozele decise**, inclusiv respinsele (`src/state/store.ts:4552-4554`, comentariul o spune explicit) [C]. Din 4 fișiere așteptate primește 20. Pe o nuntă: crede că predă 60 de cadre alese și scrie 2000 de sidecar-uri lângă originale.
**A doua împiedicare:** comutatorul „Etichete Lightroom (.xmp)" e **bifat implicit** și **nu are lacăt** (`ExportDestinations.tsx:198-201`) [C+V, captură `p2-02-export-zero`], dar `exportXMP` începe cu `gatePremium('xmp')` (`store.ts:4551`) [C]. Deci la prima apăsare pe START EXPORT i se deschide panoul Premium **peste un export care pornește oricum** — §7.3.
**A treia:** 2000 de cadre × ~2,5 s/cadru = peste o oră de telefon blocat, pe un flux unde concurența (desktop) face asta în minute.

### Cineva care vrea doar spațiu liber pe telefon
**Unde se împiedică:** aplicația nu e construită pentru el. Ecranul de pornire îi promite triaj, nu spațiu. Cifra pe care o vrea — „câți GB eliberezi" — apare, dar ca detaliu într-un card de analiză („`202 KB ocupați de 1 copie identică, deja găsită`", captură `p1-05-analysis-t35`) [V], nu ca promisiune și nu ca rezultat.
**A doua împiedicare:** ștergerea reală de pe telefon **consumă din plafonul de 150** (`core/entitlement.ts:63-72`, comentariul spune de ce) [C]. E o decizie apărabilă, dar înseamnă că **exact acest utilizator lovește plafonul primul** — și lovește la 150 de fișiere, adică după vreo 400 MB. Un om care voia să elibereze 12 GB primește un zid la 3% din drum.
**Al treilea:** nu are nevoie de niciuna dintre cele șapte funcții premium. Nici XMP, nici planșă de contact, nici prezentare. Pentru el, abonamentul e **doar ridicarea unui zid pe care aplicația l-a ridicat** — cea mai proastă formă de propunere de valoare.

---

## 2. Pornire și onboarding

### 2.1 Ce funcționează
- Comutatorul **RO/EN e pe primul ecran, sus-stânga** (captură `p1-01-welcome`) [V]. Foarte puține aplicații fac asta; e corect.
- Cele patru pagini de coach sunt scurte, bine scrise, cu o pagină finală onestă despre bani: „**Premium, când ești pregătit** — Triezi gratuit oricâte poze. Premium ridică exportul și adaugă uneltele de după triaj." (captură `p1-01-coach-3`) [V]. E rar și e bine să spui asta **înainte** de folosire, nu la primul zid.
- Ecranul „acasă gol" spune limpede ce e aplicația și are un al doilea drum, „**Am deja o sesiune**" (captură `p1-03-home-empty`) [V].

### 2.2 Probleme

**[A] „Trecere rapidă — AI-ul analizează tot lotul dintr-o dată" e o promisiune pe care produsul n-o ține.**
Al doilea din cele trei argumente de pe ecranul de pornire e **viteza** (captură `p1-03-home-empty` / `L-02-home-empty`) [V]. Măsurătoarea din `cercetare-tehnica.md` e 201 poze / 8m15s. Pentru părintele cu 800 de poze, prima propoziție a aplicației e contrazisă de primul lucru pe care îl face. **Asta nu e o problemă de copy, e o problemă de așteptări** — și e cel mai ieftin loc unde poate fi reparată (schimbă argumentul, nu promite viteză până n-o ai).
*Ce aș pune în loc, din ce e deja adevărat:* „Nu se uită nimeni la pozele tale" e argumentul pe care îl ai și pe care Google Photos nu-l poate face.

**[B] Butonul mare de închidere (X) de pe onboarding e mai proeminent decât „Următorul".**
Captură `p1-01-welcome` [V]: X-ul e sus-dreapta, cu contur luminos, 56×56, în colțul unde degetul stă oricum. „Următorul" e jos, în centru. Rata de citire a celor patru pagini o poți verifica singur, dar designul îl invită pe om să sară. Pagina 4 (cea despre bani) e cea pe care o pierzi.

**[C] Ecranul de bun-venit are ~40% spațiu gol dedesubt.**
Capturi `p1-01-welcome`, `L-01-welcome` [V]: conținutul e centrat pe verticală în treimea de mijloc, sub buton rămân ~280 px goi pe 915 px înălțime. Nu e un bug, dar arată ca o pagină nefinisată — și e primul lucru pe care îl vede fiecare tester.

### 2.3 Tema luminoasă la pornire — **verificat, și nu e catastrofa așteptată**
Am măsurat contrastul programatic pe fiecare element de text vizibil de pe ecranul „Acasă", în tema luminoasă (`audit/u02-a11y.cjs`, rezultat în `audit/a11y-light.txt`) [V]:

> **Un singur element sub AA pe tot ecranul: insigna „PRO" din antet — 1,66:1** (`#22d3ee` pe `#f5f5f7`), `.brand-pro-badge`. Pragul e 4,5:1.

Bara de jos, „Golește sesiunea", contoarele, cardurile — **toate trec** (verificat și pe decupaje mărite: `shots/crop-nav-L-04-after-analysis.png`, `shots/crop-top-L-04-after-analysis.png`) [V]. Regula `:root[data-theme="light"] .bottom-nav-tab { color: var(--text-dim); }` din `src/styles.concept.css:3981` chiar face treaba, iar comentariul de deasupra ei documentează cifra veche (2,97:1). **Cineva a trecut deja prin asta cu un contrastometru.** Corectez aici o impresie greșită pe care am avut-o la prima privire: la rezoluția capturii bara de jos *pare* albă pe alb; mărită, nu e.

**Ce rămâne prost în tema luminoasă, și se vede:**
1. **Insigna „PRO"** — 1,66:1, în antet, pe fiecare ecran. Cea mai vizibilă cădere din aplicație și cea mai ieftin de reparat.
2. **Marca aplicației își pierde identitatea**: pe întuneric e o roată albă pe un disc violet-albastru; pe lumină e o roată **neagră pe un disc alb** (captură `L-02-home-empty` vs `p1-03-home-empty`) [V]. Nu e ilizibil, dar e alt logo.
3. **Butonul plutitor „+" (FAB) aproape dispare pe ecranul de analiză** — lavandă foarte pal pe fundal foarte pal, cu „+" alb (captură `L-03-analysis`) [V]. Pe întuneric e un gradient viu (captură `p1-05-analysis-t35`). E **acțiunea principală a aplicației**, și e cel mai slab element de pe ecran exact în tema unde ar trebui să fie cel mai puternic.
4. **Cusătura din antet**: banda de sus rămâne gri-deschis peste un conținut alb-albăstrui în gradient (captură `L-02-home-empty`) [V].

---

## 3. Import și ecranul de analiză

### 3.1 Ce funcționează
- **Notificarea de capabilitate e onestă și rară în industrie.** După analiză, pe web: „**Analiza merge, dar fără fețe** — Telefonul ăsta nu poate accelera detecția de fețe, deci scorurile se sprijină pe claritate, expunere și compoziție. Zâmbetul, ochii închiși și persoanele cunoscute rămân pe dinafară. Restul — serii, duplicate, sortare, editor — funcționează normal." [V, rulare `u01-light.cjs`]. Spune ce nu merge, de ce, și ce merge în continuare. Ăsta e registrul care ar trebui să fie peste tot.
- **Duplicatele exacte sunt prinse înainte de analiză** și raportate în KB: „`202 KB ocupați de 1 copie identică, deja găsită`" [V].
- Cele trei etichete de fază (`DETECȚIE FEȚE · COMPOZIȚIE · CLARITATE`) dau o idee despre ce se întâmplă.

### 3.2 **[BUG-1 · cel mai important din raport] Ecranul de analiză nu spune niciodată cât mai durează.**
Capturi `p1-05-analysis-t5` … `p1-05-analysis-t110` [V]: colțul dreapta-sus arată **timpul scurs** (`5s`, `20s`, `35s`, … `110s`), niciodată timpul rămas, niciodată „poza N din 800". Bara de progres există, dar sub un titlu care în primele zeci de secunde spune „Se încarcă modelele AI (prima dată poate dura, verifică conexiunea)…", deci nu e clar dacă bara e pentru modele sau pentru poze.

**Pași de reproducere:** pornire curată → import 20 de poze → privește colțul dreapta-sus.
**De ce e primul pe listă:** părintele cu 800 de poze stă ~33 de minute (extrapolat din măsurătoarea din `cercetare-tehnica.md`) în fața unui contor care crește. Nu are cum să decidă dacă lasă telefonul jos sau dacă abandonează. **Abandonul la mijlocul primei analize e cel mai scump eșec posibil**, pentru că se întâmplă înainte de orice valoare livrată și înainte de orice motiv de a plăti (§13).
**Ce lipsește, concret:** „poza 312 din 800 · ~19 min rămase". Datele există — `store.ts:316` ține deja `viteza ultimului import (poze procesate + durata)` [C], deci o estimare pe media curentă e aritmetică, nu cercetare.

### 3.3 **[BUG-2] „verifică conexiunea" contrazice promisiunea centrală a aplicației.**
Text văzut pe ecranul de analiză: „*Se încarcă modelele AI (prima dată poate dura, verifică conexiunea)…*" [V, captură `p1-05-analysis-t35`].
Trei ecrane mai devreme aplicația promite „**100% privat — Pozele nu părăsesc dispozitivul**" și, în subsolul meniului, „*Analiza AI, recunoașterea persoanelor și motorul de învățare rulează integral pe telefonul tău — nicio poză nu pleacă nicăieri*" [V, captură `W-light-04-Setări`].
Ambele sunt adevărate (se descarcă modelele, nu pozele) — dar utilizatorul nu face distincția. Prima dată când aplicația vorbește despre rețea e **imediat după** ce a promis că nu are nevoie de rețea. Pentru un produs a cărui singură propunere de valoare apărabilă e intimitatea, asta e o fisură exact în locul greșit.
**Reparație:** o propoziție — „Se descarcă o dată motorul AI (~X MB). Pozele tale rămân pe telefon."

### 3.4 Ce lipsește la import
- **Nu poți importa în loturi și nu poți relua.** Vezi §9 (anularea).
- **Niciun feedback despre ce s-a sărit.** Din 20 de fișiere, 20 au intrat; dar dacă unul e corupt sau prea mare, mesajul de eroare e cel semnalat în `cercetare-tehnica.md` §E.3 (nume de excepție JavaScript în fața utilizatorului).
- **Analiza nu poate rula cu ecranul stins / în fundal.** [P] — nu pot verifica pe web; dar e exact funcția pe care `cercetare-tehnica.md` §F.3-5 o propune ca premium, și e cea mai bună idee din acel raport din punctul de vedere al utilizării.

---

## 4. Text prost — ambele limbi. Cu fișier și linie.

Ordonat după cât de des îl vede utilizatorul.

### 4.1 **[BUG-3] Frază ruptă gramatical, în AMBELE limbi, pe orice peisaj cu orizont strâmb**
```
src/i18n/ro.ts:1911   'aiExplain.comp.scene.sentence': 'Compozițional, cadrul are {notes}.'
src/i18n/ro.ts:1910   'aiExplain.comp.horizonTilt':    'orizontul e înclinat cu {deg}°'
```
→ **„Compozițional, cadrul are orizontul e înclinat cu 3.4°."** [V, captură `p1-25-De`, fila „De ce acest scor"]

Identic în engleză:
```
src/i18n/en.ts:1842   'aiExplain.comp.scene.sentence': 'Compositionally, the frame has {notes}.'
src/i18n/en.ts:1841   'aiExplain.comp.horizonTilt':    'the horizon is tilted by {deg}°'
```
→ **„Compositionally, the frame has the horizon is tilted by 3.4°."**

Celelalte două note se potrivesc cu șablonul („cadrul are *linii directoare vizibile*", „cadrul are *o compoziție simetrică*"); doar `horizonTilt` e scris ca propoziție, nu ca grup nominal. **Apare pe orice peisaj cu orizontul strâmb — adică pe foarte multe poze de vacanță.** Și apare exact în ecranul pe care `cercetare-tehnica.md` §F.3-3 îl numește „cel mai bun activ nevândut al aplicației". Un argument de vânzare scris agramat nu mai e un argument.
**Reparație: 5 minute** — `'aiExplain.comp.horizonTilt': 'orizontul înclinat cu {deg}°'` / `'the horizon tilted by {deg}°'`.

### 4.2 **[BUG-4] Mesajul de anulare a importului nu e tradus și n-are diacritice**
```
src/core/importPipeline.ts:976
stopReason = `Import anulat — ${done}/${images.length} poze procesate pana la anulare.`;
```
[C, confirmat vizual: captură `e-17-cancel-final` → „Import anulat — 4/20 poze procesate pana la anulare."] [V]

Două probleme într-o linie: **„pana"** în loc de „până" (singura scăpare de diacritice pe care am găsit-o într-un text vizibil), și **string hardcodat în afara dicționarului** — deci un utilizator cu telefonul în engleză, care anulează un import, primește o propoziție în română. Vezi §4.3: nu e singurul.

### 4.3 **[BUG-5] Tot fluxul „Persoane → înrolare" răspunde numai în română**
`PersonsPanel.tsx:147` ia `result.message` de la `addPerson` și îl afișează la `PersonsPanel.tsx:377` [C]. Toate mesajele sunt construite prin concatenare, hardcodat, în `src/state/store.ts`:

| Linie | Text | Ce lipsește |
|---|---|---|
| `store.ts:4033` | `'Nicio față detectată în pozele de referință. Alege poze clare, frontale.'` | traducere |
| `store.ts:4036` | `` `(${skipped} poze ignorate, plafon ${MAX} per inrolare)` `` | traducere + diacritice („inrolare") |
| `store.ts:4038` | `` `Atenție: ${n} poze au conținut mai multe fețe — s-a folosit automat cea mai mare…` `` | traducere |
| `store.ts:4048` | `` `${nume}: +${n} referinte noi adaugate la profilul existent (total ${m}).` `` | traducere + diacritice („referinte", „adaugate") |
| `store.ts:4063` | `` `${nume}: ${n} referinte salvate.` `` | traducere + diacritice |

`cercetare-tehnica.md` §E.1 constată — corect — **paritate perfectă RO/EN, 1847 de chei, zero lipsă**. Gaura nu e în dicționar; e în **codul care nu-l folosește deloc**. Și cade exact peste funcția care e gard de plată (a doua persoană = Premium). Un tester englez care înrolează pe cineva primește un mesaj în română **și apoi** panoul de plată.
**Reparație: ~1 oră**, 5 chei noi.

### 4.4 „persoană(e) necunoscută(e)" — în ambele limbi
```
src/i18n/ro.ts:1927   '{countDe} persoană(e) necunoscută(e) alături de cele cunoscute'
src/i18n/en.ts:1858   '{count} unknown person(s) alongside the known ones'
```
`cercetare-tehnica.md` §E.2 semnalează varianta română. **Adaug: engleza are exact aceeași problemă**, iar acolo nu există scuza claselor CLDR — `plural()` din `i18n/index.ts` rezolvă englezescul cu două chei banale.

### 4.5 Diacritice lipsă în dicționar (rare, dar există)
```
src/i18n/ro.ts:1933  'aiExplain.colorHarmony.good': 'o paleta de culori armonioasă'   → paletă
src/i18n/ro.ts:1934  'aiExplain.colorHarmony.poor': '…fără o paleta clară'            → paletă
src/i18n/ro.ts:1926  'aiExplain.eyeContact.away':   'privirea nu e ațintită spre camera' → cameră
```
Toate trei apar în „De ce acest scor". Prima am văzut-o pe ecran [V, captură `p1-25-De`: „*o paleta de culori armonioasă*"). **Reparație: 3 minute.**

### 4.6 Nepotrivire singular/plural la exportul XMP
```
src/i18n/ro.ts:1757  'store.exportXmp.exportedSingle':
   '{countDe} sidecar-uri XMP exportate (descărcare directă) — mută-l lângă poza ORIGINALĂ…'
```
Cheia se numește `…Single` și e apelată doar când `result.exported === 1` (`store.ts:4600`) [C], dar textul e la plural („sidecar-**uri** … export**ate**") cu un pronume la singular („mută-**l**"). Rezultat pentru un fișier: „**1 sidecar-uri XMP exportate … mută-l**".

### 4.7 Registrul butoanelor de decizie
Butoanele mari din ecranul de triaj sunt „**RESPING**" / „**PĂSTREZ**" (captură `p1-20-decide-1`) [V] — persoana I singular, indicativ prezent. Restul aplicației vorbește la persoana a II-a („Continuă", „Editează", „Compară", „Golește sesiunea"). Nu e greșit — e o alegere de voce („eu, utilizatorul, declar") — dar e **singurul loc** unde vocea se schimbă, pe cel mai apăsat buton din produs. Fie o duci peste tot, fie o aduci la „Respinge / Păstrează".

---

## 5. Decizia poză-cu-poză (ecranul de triaj)

Ăsta e „produsul". Aici se petrece tot ce e gratuit și tot ce face aplicația să merite deschisă.

### 5.1 **[BUG-6] Fotografia primește ~35% din ecran într-o aplicație despre a te uita la fotografii**
Captură `p1-20-decide-1`, viewport 412×915 [V]. Măsurat pe captură:

| Zonă | px pe verticală |
|---|---|
| Bară de sus (logo, „Toate 20", „1/10", `⋯`) | ~90 |
| **Bandă neagră goală** | ~190 |
| **FOTOGRAFIA** | **~320** |
| Chips (`De verificat · 38`, `Serie de 2`, `Metrici`) + dată + miniaturi serie | ~130 |
| Card de scor (inel 38, „Claritate 48%", „Context: Peisaj", „Fără date de aparat foto…") | ~110 |
| Text-indiciu „glisează sus/jos…" | ~20 |
| Butoane RESPING / PĂSTREZ | ~55 |

**190 px de negru gol deasupra pozei**, cât 60% din înălțimea pozei înseși. Judeci o fotografie uitându-te la o bandă de 320 px. Concurența desktop (FilterPixel, Narrative) vinde exact opusul: cadrul mare, metrica mică.
**De ce contează pentru bani:** ăsta e ecranul în care omul petrece 90% din timp. Dacă aici pare o unealtă de tabelat, nu o unealtă de privit, restul argumentelor nu mai contează.

### 5.2 **[Confuzie-1] „Toate 20" și „1/10" pe aceeași bară**
Captură `p1-20-decide-1` [V]. Sus: pastila „**Toate 20**" (filtrul) și contorul „**1 / 10**" (poziția în coadă). Ai importat 20 de poze, ecranul spune și 20 și 10, la 40 px distanță, fără nicio etichetă care să spună că sunt lucruri diferite. Primul gând al oricui: „unde s-au dus 10 poze?"

### 5.3 **[Confuzie-2] Cardul „CÂT DE EXIGENT E AI-UL" se contrazice singur**
Text văzut, integral [V, rulare `u04-paywall.cjs`]:
```
CÂT DE EXIGENT E AI-UL
din 10 poze rămase de verificat
   Îngăduitor  10 ÎȚI RĂMÂN
   Echilibrat  10 ÎȚI RĂMÂN
   Sever       10 ÎȚI RĂMÂN
0 păstrate · 10 respinse
```
„**10 ÎȚI RĂMÂN**" (de trei ori) urmat imediat de „**0 păstrate · 10 respinse**". Prima cifră vorbește despre pozele *nedecise*, a doua despre cele *deja decise* — două populații diferite, lipite fără etichetă. Un om citește „îmi rămân 10" și „am 10 respinse" și trage concluzia că a pierdut ceva.
Nota de dedesubt e, în schimb, **excelentă** și onestă: „*La lotul ăsta, cele trei niveluri dau același rezultat: nicio poză nedecisă nu e destul de aproape de prag cât să se mute. Contează la loturi mai mari sau mai amestecate.*" Foarte puține produse admit „reglajul ăsta nu face nimic acum".

### 5.4 Ce funcționează, și e mai bun decât la concurență
- **Chip-urile de verdict pe poză** (`− Fără date de aparat foto`, `− Compoziție`, `+ Expunere echilibrată`, `+ Armonie cromatică`) — semn, culoare, cuvânt. Se citesc dintr-o privire [V, captură `p1-25-De`].
- **„AI a greșit?"** sub metrici [V, captură `p1-26-detailtab-0-Metrici`] — o buclă de corecție la un tap distanță. Rar și corect.
- **Miniaturile seriei sub poză** — vezi frații cadrului fără să pleci din ecran.
- **„Serie de 2" / „Compară toată seria"** — pentru fotograful de nuntă, asta e funcția.

### 5.5 Ce lipsește în ecranul de decizie
1. **Nu vezi câte ai făcut și cât mai ai, în timp.** „1/10" e poziția, nu progresul cu ritm. La 800 de poze, un „ai decis 210 în 6 min — mai ai ~18 min" ar ține omul în flux.
2. **Nicio comandă „decide-le pe toate cele evidente".** Există Auto-Cull în meniu, dar nu aici, unde se pune întrebarea.
3. **Text-indiciul „glisează sus/jos pentru poza următoare/anterioară" e permanent, în italice, cu contrast mic** [V]. Ori e o dată, ori nu e.

---

## 6. Grila și filtrele

### 6.1 Ce e bun
- Insignele de scor pe miniatură, colorate pe prag (85 verde, 38-51 chihlimbariu) [V, captură `W-light-01-Grilă10`] — citești un lot dintr-o privire.
- Separatorul „**DECIZI TU** — 9 poze pe care AI-ul nu se poate baza pe ce vede" [V]. Ăsta e cel mai bun text din aplicație: nu spune „scor mic", spune **de ce te întreabă pe tine**. E onestitate despre incertitudine, exact ce lipsește la concurență.
- Insignele de serie (`3`, `2`) pe cadrul-cap de serie.
- Căutare + „Filtre" în capul grilei, ambele la îndemână.

### 6.2 Probleme
- **[Confuzie-3] Prea multe numere care nu se împacă la prima citire.** În capul grilei: `50% DECISE`, `20`, `20`, `0`, `De verificat 10 10`, `Filtre`, apoi `22` (scorul primei poze) [V]. Șapte numere în 200 px, fără o ierarhie clară. Cel puțin unul (`0`) n-are etichetă vizibilă lângă el.
- **[A11y-1] „DECIZI TU" — 3,88:1 pe tema luminoasă** (`#8b5cf6` pe `#f3f5f8`, `.plan-separator-title`), sub pragul AA de 4,5:1 [V, măsurat, `audit/walk-light.txt`]. E titlul care organizează toată grila.
- **[A11y-2] Chip-ul „Selectate: 0" e 43×44 px** — sub minimul de 44×44 [V, măsurat]. Un pixel, dar e chiar butonul prin care intri în selecția multiplă.

---

## 7. Export — unde se împiedică fotograful

### 7.1 **[BUG-7 · cel mai scump pentru persona 2] „Etichete Lightroom (.xmp)" nu exportă selecția, exportă tot**
```
src/state/store.ts:4551-4555
exportXMP: async () => {
  if (get().gatePremium('xmp')) return;
  const allPhotos = outsideVault(get().photos, get().collections);
  const decided = allPhotos.filter(p => p.status !== 'pending');   // ← TOATE, nu selecția
```
[C] Comentariul de deasupra o spune explicit: „*pentru TOATE pozele decise (selectate/respinse/de verificat) — nu doar selectia, spre deosebire de exportSelection*".

**Ce vede utilizatorul:** o foaie intitulată „**Export selecție**", cu scris mare „**4 poze selectate · 809 KB**", o listă cu exact acele 4 fișiere, și trei comutatoare — dintre care al treilea lucrează pe alt set [V, captură `p2-07-export-4kept`].
**Pași de reproducere:** păstrează 4 poze din 20 → Export → lasă „Etichete Lightroom (.xmp)" bifat → START EXPORT → primești **20** de sidecar-uri, nu 4.
**La scara unei nunți:** crezi că predai 60 de cadre alese; scrii ~2000 de fișiere `.xmp` lângă originalele clientului, dintre care ~1940 marchează cadre **respinse**. În Lightroom, sidecar-urile respinse **se citesc**: ratingurile și etichetele de culoare apar pe cadrele pe care fotograful voia să le lase deoparte.
**Decizia de proiectare e apărabilă** (a preda și respingerile e util) — **eticheta e cea greșită.** Reparație de 20 de minute: schimbă textul comutatorului în „Etichete Lightroom (.xmp) — pentru toate cele {n} poze decise" și arată numărul.

### 7.2 **[BUG-8] Bifarea ambelor destinații: a doua e ignorată în tăcere**
```
src/ui/ExportDestinations.tsx:100-103
if (toFolder) void exportSelection('folder');
else if (individually) void exportSelection('apps');
```
[C] Cele trei rânduri sunt **comutatoare independente** (`<input type="checkbox">`, `ExportDestinations.tsx:181-201`), nu butoane radio. Un utilizator care bifează și „Copiază în folder" și „Descarcă individual" primește **doar** folderul, fără niciun mesaj. Comportamentul e de radio, interfața e de checkbox.
**Reparație:** ori grup radio, ori execută-le pe amândouă.

### 7.3 **[BUG-9] Panoul Premium se deschide peste un export care pornește oricum**
```
src/ui/ExportDestinations.tsx:99-103
if (xmpList) void exportXMP();        // → gatePremium('xmp') → deschide panoul Premium
if (toFolder) void exportSelection('folder');   // ← rulează în continuare
```
[C] Comutatorul XMP e **bifat implicit** (`useState(true)`, `ExportDestinations.tsx:76`) și **n-are lacăt, insignă „PRO" sau orice alt semn** că e o funcție plătită [C + V, captură `p2-02-export-zero`]. Pentru un utilizator gratuit pe un telefon cu Play, primul export din viață arată așa: apeși START EXPORT → sare panoul de plată → în spatele lui, exportul de fișiere chiar rulează. Nu e clar ce s-a întâmplat și ce nu.
**N-am putut confirma vizual** — pe web `isBillingAvailable()` e fals, deci nimic nu se blochează (§12). Este [C], nu [V].
**Reparație:** lacăt pe rândul XMP, și `gatePremium` verificat **înainte** de a porni orice.

### 7.4 **[Fundătură-1] Tabul „Export" din bara de jos nu duce nicăieri pentru un om nou**
[V, rulare `u04-paywall.cjs`] Apeși „Export" în bara de jos cu 0 poze păstrate. Primești foaia „Export selecție · **0 poze selectate**", trei comutatoare, o notă despre confidențialitate, și un buton START EXPORT dezactivat (`disabled` la `ExportDestinations.tsx:217`, stilat cu `opacity:.42` la `styles.concept.css:6070`). **Niciun cuvânt despre cum se selectează o poză.** Nicio legătură către Grilă, niciun „păstrează întâi câteva poze".
Unul din cinci taburi principale e, pentru primele minute de folosire, o ușă închisă fără indicație. Persona 3 (spațiu liber) ajunge aici primul, pentru că „Export" sună a „scoate pozele de pe telefon".

### 7.5 Ce e bun la Export
- **Nota de confidențialitate e la locul potrivit**, chiar deasupra butonului: „*Fișierele pleacă în formatul original, cu editările coapte în ele. Nu ne conectăm la niciun cont și nu păstrăm niciun token — destinația o alege sistemul, nu aplicația.*" [V].
- **Plafonul e anunțat înainte, nu după.** Cu 145/150 consumate, ecranul Acasă arată „*Îți mai rămân 5 din 150 de poze de scos luna asta. Vezi ce include Premium*" [V, rulare `u04-paywall.cjs` cu jurnal de consum injectat]. Comentariul din `ExportDestinations.tsx:159-163` explică de ce s-a mutat mesajul acolo, și are dreptate.
- Lista de fișiere cu miniaturi reale, plafonată la 8 + „încă N" [C, `EXPORT_FILE_LIST_MAX`].

---

## 8. Meniu, Setări, Statistici — și **cel mai scump defect de produs din aplicație**

### 8.1 **[BUG-10 · impact direct pe venit] Toate cele șapte funcții plătite trăiesc într-un sertar pe care nimeni n-are motiv să-l deschidă**

**Ce am văzut** [V, capturi `p3-01-menu`, `p3-02-menu-expanded`, `W-light-04-Setări`]: apeși „**Setări**" în bara de jos. Se deschide un sertar intitulat „**Meniu**", cu șase acordeoane **toate închise**:
```
ORGANIZARE  ·  CURĂȚARE AI  ·  VEZI ȘI PREZINTĂ  ·  EXPORT ȘI BACKUP  ·  SETĂRI  ·  AJUTOR
```
Desfășurate, înăuntru stau: Statistici, Preferințe AI, **Recap lunar**, **Prezentare**, **Locații**, **Planșă de contact**, **Dosar privat**, Protecție documente, Operații în masă, Aplică editările în galerie, Backup complet, Restaurează.

**Cinci din cele șapte funcții pentru care ceri bani sunt aici**, la trei atingeri de la ecranul principal (tab → acordeon → element), fără nicio urmă în fluxul normal. Nimic din Acasă, Grilă, ecranul de decizie sau Export nu duce spre ele. Panoul Premium le **descrie** frumos, dar nu duce la niciuna.

**De ce e cel mai scump defect din raport:** un abonament se cumpără de către cineva care a **atins** funcția și i-a lipsit, nu de către cineva care a **citit despre ea** într-o listă. Azi drumul e invers: singura cale spre funcția plătită trece prin ecranul de plată. Asta e literalmente cea mai proastă pâlnie posibilă.
*(`cercetare-tehnica.md` §F.4 ajunge la aceeași concluzie pe alt drum — reîmpachetare — și greșește doar în a o numi „fără cod nou, doar denumiri și locuri". Nu denumirile sunt problema. **Locul** e.)*

### 8.2 **[Confuzie-4] Trei nume pentru același lucru**
Bara de jos zice „**Setări**". Ce se deschide se numește „**Meniu**". Setările propriu-zise sunt un acordeon numit „**SETĂRI**" înăuntru. Un utilizator care caută tema deschisă trebuie să treacă prin toate trei.

### 8.3 Ce e bun în sertar
- **„LUMIN PRO · PREVIZUALIZARE — Totul e deblocat, fără abonament"**, cu bifă [V]. Aplicația spune singură când nu are cale de plată, în loc să se prefacă. Onest, și rar.
- **Subsolul permanent:** „*Analiza AI, recunoașterea persoanelor și motorul de învățare rulează integral pe telefonul tău — nicio poză nu pleacă nicăieri*" [V]. Propoziția asta e cel mai bun argument comercial al produsului și e pusă în subsolul unui sertar.
- Cele două scurtături din capul sertarului („Sortare rapidă", „Căutare vizuală") sunt mari, cu țintă bună.

### 8.4 Panoul Premium — citit ca un client
Textul integral, așa cum l-am citit [V, rulare `u04-paywall.cjs`]:

> **Triajul rămâne gratuit, oricâte poze ai. Premium e pentru ce faci cu rezultatul.**
> · Export și ștergere nelimitate — *gratuit: 150 de poze scoase la fiecare 30 de zile, exportate sau șterse*
> · Oricâte persoane recunoscute — *gratuit: 1 persoană înrolată*
> · Fluxul profesional — *predare către Lightroom (XMP), planșă de contact, dosar privat*
> · Partea de arătat altora — *recap lunar, prezentare*
> · Locații · Combinarea a două cadre
> **RĂMÂNE GRATUIT, MEREU:** import, scor AI, sortare, grupare, comparare serii — oricâte poze, fără plafon
> **CONSUM ÎN ULTIMELE 30 DE ZILE:** Ai scos 145 din 150 de poze · 0 din 1 persoane înrolate

**Ce e bine:** e cel mai cinstit paywall pe care l-am citit într-o aplicație foto. Spune ce rămâne gratuit **înainte** să ceară bani. Secțiunea de consum arată cifra reală, nu o amenințare. Zero hype, zero „PRO!!!".

**Ce lipsește, ca să convingă:**
1. **Niciun preț și niciun buton de abonare** — și nu doar pe web. Prețul apare numai când `isBillingAvailable() && (picked ?? price)` (`PremiumPanel.tsx:299`) [C]. Vezi §12: **riscul e ca cei 12 testeri să nu poată cumpăra nimic.**
2. **Nicio perioadă de probă** menționată. (`cercetare-tehnica.md` §F.3-2 arată că infrastructura există și e neconfigurată.)
3. **Nicio dovadă**, doar promisiuni. `LifetimeProof` există în cod, dar în panou n-am văzut nicio cifră de tipul „aplicația a decis în locul tău X poze, ți-a economisit Y minute".
4. **„Roșiori · România" hardcodat** în miniatura Locații, și în engleză [V, captură `p4-05-en-premium`: „*Locations … looked up on your phone … `Roșiori · România`*"]. Confirm vizual constatarea din `cercetare-tehnica.md` §D.5 — **e pe ecranul de plată, în versiunea engleză.**
5. **Insigna „PRO" din antet: 1,66:1 pe tema luminoasă** [V, măsurat]. Cuvântul care denumește produsul plătit e cel mai puțin lizibil element din aplicație.

### 8.5 Statistici
N-am exercitat panoul cu date suficiente ca să judec (20 de poze, o sesiune). Din cod: `StatsPanel.tsx:373` are un comentariu despre o cifră „de 750 de poze procesate, care nu exista nicaieri in cod ca limita" [C] — merită verificat de proprietar dacă ecranul mai afișează un plafon inventat.

---

## 9. Anularea la mijloc — ce lucra predecesorul meu, dus până la capăt

Am rulat testul decisiv (`audit/u07-cancel.cjs`, jurnal complet în `audit/cancel9.txt`, capturi `X-01`…`X-03`) [V]: import de 20 de poze, anulare la mijloc, apoi **re-import al acelorași 20 de fișiere** — exact ce face un părinte al cărui telefon s-a încins.

### 9.1 **[BUG-13 · cel mai grav bug funcțional din raport] Re-importul după anulare DUPLICĂ pozele deja intrate**

**Ce am măsurat, pas cu pas** [V]:
```
t=108s   anulare apăsată     → 5 poze în IndexedDB
t=120s   importul s-a oprit  → 9 poze în IndexedDB
         notificare: „Import anulat — 6/20 poze procesate pana la anulare."
         re-import al ACELORAȘI 20 de fișiere
t=+92s   → 29 de poze în IndexedDB
         notificare: „20 de poze importate cu succes."
```
**9 + 20 = 29. Niciun duplicat detectat, niciun avertisment.**

**Cauza, în cod:** aplicația are **două** mecanisme de duplicate, și **niciunul nu se uită la ce e deja importat, în momentul importului**:
- `src/core/quickDuplicateScan.ts` — compară fișierele **din lotul curent între ele** (mărime în octeți + două felii de 64 KB). Nu primește niciodată biblioteca existentă, și oricum doar **numără**, nu sare peste nimic (`QuickScanResult` = `{duplicates, wastedBytes, groups}`) [C].
- `src/core/exactDuplicates.ts` — lucrează pe biblioteca **deja importată**, și comentariul propriu spune „**CE FACE CU ELE: nimic, singur. Propune si atat.**" [C]. E un panou separat, în sertar (`App.tsx:888` / `ExactDupesPanel`), pe care utilizatorul trebuie să știe să-l deschidă.

**Ce înseamnă la scara părintelui cu 800 de poze:**
telefonul se încinge la poza 300 → anulează → reia importul → **1100 de poze în bibliotecă, 300 duplicate**, fără niciun cuvânt. Analiza celor 300 se face **a doua oară** (încă ~12 minute de telefon fierbinte). Ca să curețe, trebuie să găsească un panou din sertar — iar **ștergerea copiilor consumă din plafonul de 150** (`core/entitlement.ts:63-72`: „*a scoate acopera si exportul, si stergerea din telefon*") [C].
Adică: **un utilizator care a anulat o dată își consumă plafonul gratuit reparând o problemă pe care aplicația i-a făcut-o.** Ăsta e cel mai prost lucru pe care l-am găsit în tot produsul.

**Reparație:** la import, sare peste fișierele cu (nume + mărime + dată) deja în bibliotecă, sau extinde `quickDuplicateScan` să primească amprentele existente. E aceeași bucată de cod care există deja, cu alt set de intrare.

### 9.2 **[BUG-14] Primele ~105 de secunde nu se pot anula deloc**
[V, `cancel9.txt`] Butonul „Anulează" **nu există în DOM** cât timp ecranul spune „Se încarcă modelele AI". A apărut abia la `t=108s`, odată cu prima poză procesată:
```
t=3s … t=93s   n=0   cancel=-        ← niciun buton
t=108s         n=5   cancel={"t":"Anulează","d":false}
```
Faza cea mai lungă și cea mai opacă a fluxului (§3.2, §3.3) e și singura din care nu poți ieși. Pe telefon durata diferă, dar structura e aceeași: **se poate anula abia după ce nu mai e cazul.**

### 9.3 **[BUG-15] Notificarea de anulare raportează un număr care nu se potrivește cu nimic de pe ecran**
[V] Notificarea: „**6/20** poze procesate". În aceeași secundă: **9** poze în bază, iar antetul scrie „SELECȚIA TA **2/9**" și „Bibliotecă … **9**".
Utilizatorul citește 6, vede 9. `done` numără pozele **analizate** complet, iar în bibliotecă ajung și cele **importate dar neanalizate**. Nu e o pierdere de date — e o cifră care contrazice ecranul.

### 9.4 **[Fundătură-2] Nu există nicio reluare a unui import întrerupt**
[V, verificat: ecranul de după anulare nu conține „Reia", „neterminat", „continuă importul" sau echivalent.]
Cardul „**Ai lăsat ceva neterminat**" există (`ro.ts:211-213`), dar `HomeDashboard.tsx:259-275` îl arată doar pentru un **proiect** de revizuit (`resumeTarget` → `setProjectFilter` + `setFilter('review')`) [C] — nu pentru un import oprit. Cele 11 poze care n-au apucat să intre pur și simplu nu există, și singura cale înapoi la ele e re-importul, adică §9.1.

### 9.5 Ce funcționează la anulare
- **Anularea chiar oprește lucrul**, în ~12 secunde de la apăsare [V].
- **Ce s-a procesat rămâne** — nu se pierde munca făcută [V].
- Butonul trece prin starea „Se anulează…" [V, captură `e-16-cancelling` a predecesorului].
- Textul e (aproape) bun; problemele sunt cifra (§9.3) și limba/diacriticele (§4.2).

---

## 10. Accesibilitate — măsurată, nu bănuită

Am rulat un audit programatic pe fiecare element de text vizibil și pe fiecare control interactiv, în ambele teme (`audit/a11y-expr.js`, rezultate în `audit/walk-light.txt` și `audit/kbd.txt`) [V].

### 10.1 Ce e **foarte bun** — mai bun decât la majoritatea aplicațiilor plătite

| Verificare | Rezultat |
|---|---|
| **Inel de focus la tastatură** | `outline: 2px solid rgb(34,211,238)` pe **fiecare** din cele 19 controale parcurse cu Tab. Zero excepții. |
| **Ordinea de Tab** | Logică de sus în jos, fără capcane, fără sărituri în afara ecranului (`inViewport=true` la toate 19). |
| **Nume accesibile** | **Zero** controale fără nume pe ecranele parcurse. Chiar și celulele de exigență au etichete complete: `"Îngăduitor: îți rămân 10 de verificat, 0 păstrate…"`. |
| **Escape** | Închide foaia de export. Focus trap prezent (`useModalFocusTrap`). |
| **`alt` pe imagini** | 0 imagini fără `alt`. |
| **`<html lang>`** | `ro`, corect, comutat la schimbarea limbii. |
| **`<nav aria-label>`** | `BottomNav.tsx:134`, etichetat. |

**Observație care merită spusă separat:** eticheta pentru cititorul de ecran a celulelor de exigență („*îți rămân 10 **de verificat**, 0 păstrate*") e **mai clară decât textul vizibil** („10 ÎȚI RĂMÂN"). Cineva a scris eticheta cu grijă și a lăsat textul vizibil ambiguu. Fixul pentru §5.3 e deja scris — trebuie doar mutat pe ecran.

### 10.2 Ce cade, exact

| # | Element | Măsurat | Prag | Unde |
|---|---|---|---|---|
| **A1** | Insigna „**PRO**" din antet, temă luminoasă | **1,66:1** (`#22d3ee` pe `#f5f5f7`) | 4,5:1 | `.brand-pro-badge`, pe **fiecare** ecran |
| **A2** | „**DECIZI TU**", temă luminoasă | **3,88:1** (`#8b5cf6` pe `#f3f5f8`) | 4,5:1 | `.plan-separator-title`, capul grilei |
| **A3** | Cifrele mov de grupare (`5`, `4`), temă **întunecată** | **3,93:1** (`#8b5cf6` pe `#1c1e25`) | 4,5:1 | `.review-cluster`, ecranul Acasă |
| **A4** | Butonul-marcă (logo → Acasă) | **31×31 px** | 44×44 | `.brand-mark-wrap.brand-home-btn`, **fiecare** ecran |
| **A5** | Chip „Selectate: 0" | **43×44 px** | 44×44 | `.chip.chip-compact`, capul grilei |
| **A6** | Comutatoarele din Export | **42×25 px** | 44×44 | `.export-toggle-switch` — atenuat: rândul întreg e `<label>`, deci ținta reală e mare |
| **A7** | Butonul plutitor „+" (FAB), temă luminoasă, ecran de analiză | „+" alb pe lavandă foarte pal | — | [V, captură `L-03-analysis`] — nemăsurabil automat (SVG), dar vizibil slab |

**Comentariu:** A1 și A2 sunt aceeași boală descrisă în `cercetare-tehnica.md` §D.4 — accentul întunecat folosit ca atare pe fundal deschis. Interesant e că bara de jos, semnalată ca risc acolo, **a fost deja reparată** cu cifra scrisă în comentariu (`styles.concept.css:3979-3981`). Deci există deja un obicei bun în echipă; A1/A2/A3 sunt doar locurile unde nu s-a ajuns.

### 10.3 Lipsuri structurale
- **Niciun `<main>` în toată aplicația** [C, `grep '<main' src/` → zero rezultate; doar `<nav>` în trei locuri]. Un cititor de ecran n-are cum să sară peste antet direct la conținut.
- **3 titluri `h1`-`h6` pe tot ecranul Acasă** [V]. „URMĂTOAREA DECIZIE", „CELE 10 DE VERIFICAT, PE CAUZE", „CÂT DE EXIGENT E AI-UL", „Bibliotecă" arată ca titluri, dar nu sunt marcate ca atare — deci nu există navigare pe titluri.
- **Un singur `role=status`/`aria-live`** pe ecranul principal [V]. Notificările („20 de poze importate cu succes", „Import anulat…") și progresul analizei — nu am putut confirma că sunt anunțate.

---

## 11. Tema luminoasă — verificată ecran cu ecran

Briefingul cerea atenție aici, pentru cele 164 de selectoare `[data-theme="light"]` scrise ca excepții (`cercetare-tehnica.md` §D.4). **Concluzia mea e nuanțată și în două direcții.**

### 11.1 Vestea bună: acolo unde cineva a trecut cu un contrastometru, e reparat bine
Am măsurat toate ecranele principale (Acasă, Grilă, Persoane, Export, Meniu, Premium) în temă luminoasă [V]. Rezultat: **un singur element sub AA pe fiecare** (insigna „PRO"), plus „DECIZI TU" în grilă. Bara de jos, cardurile, contoarele, sertarul, panoul Premium — toate trec. Comentariile din `styles.concept.css:3979-3999` arată de ce: cineva a măsurat („*ies la 2,97:1 la 9,9px*", „*ieșea la 1,63:1*", „*micșorate la 42x42, sub minimul de 44x44*") și a reparat cu cifra în mână. **Ăsta e un obicei bun și merită păstrat.**

### 11.2 Vestea proastă: **[BUG-11] ecranul cel mai folosit din aplicație ignoră tema luminoasă**

**Ce am văzut** [V, captură `LP-03-decide`, cu `data-theme="light"` activ pe `<html>`, verificat programatic]: ecranul de decizie poză-cu-poză arată **identic cu varianta întunecată** — fundal negru, card de scor negru, chip-uri negre — **cu excepția barei de acțiune de jos, care e albă.**

**Cauza, în cod:**
```
src/styles.concept.css:1771-1773   .tiktok-sort { background: #050608; }      ← nicio variantă luminoasă
src/styles.concept.css:3692        :root[data-theme="light"] .tiktok-rail { background: rgba(255,255,255,.96) !important; }
src/styles.concept.css:3688        :root[data-theme="light"] .tiktok-rail-label { color:#fff !important; text-shadow:0 1px 5px #000 !important; }
```
[C] Tema luminoasă a fost aplicată **doar** barei de jos, etichetelor ei și chip-ului de metrici (`:3902`). Scena, învelișul, cardul de scor — nu. Rezultatul e o cusătură pe orizontală: **negru sus, alb jos**, pe ecranul unde utilizatorul stă cel mai mult.

**Două citiri, ambele cer o acțiune:**
- *Dacă e intenționat* (o „cameră obscură" pentru privit poze, ca loupe-ul din Lightroom) — atunci **bara de jos albă e greșeala**, nu scena. Și tranziția din grila luminoasă în ecranul negru trebuie să fie o alegere anunțată, nu o surpriză.
- *Dacă nu e intenționat* — e cea mai mare scăpare de temă din aplicație, și e exact unde briefingul a bănuit că sunt.

Regula `text-shadow: 0 1px 5px #000 !important` pe text alb (`:3688`) e semnătura celui de-al doilea caz: e un text alb salvat cu o umbră pentru că fundalul de sub el nu e sigur.

### 11.3 **[BUG-12] Butonul „RESPING" cade sub AA în AMBELE teme**
**2,69:1** — alb (`#ffffff`) pe `#fb7185` [V, măsurat, `audit/lightpanels.txt`]. Pragul e 4,5:1 (text de 14px, nu „mare").
E unul din cele două butoane pe care se apasă de sute de ori într-o sesiune. Reparație: text mai închis (`#4c0519`) sau fundal mai închis (`#e11d48` → 4,7:1 cu alb).

### 11.4 Ținte de atingere pe ecranul de decizie — cele mai proaste din aplicație
[V, măsurat pe `LP-03-decide`]:

| Element | Dimensiune | Problemă |
|---|---|---|
| `.tiktok-filmstrip-item` (miniaturile seriei) | **32×32** | **și fără nume accesibil** — două butoane fără etichetă |
| `.tiktok-more-trigger` (`⋯`) | 36×36 | sub 44 |
| `.tiktok-ai-chip` („Serie de 2", „Metrici") | 32 înălțime | sub 44 |
| `.tiktok-review-all-chip` („Toate 20") | 75×40 | sub 44 |

Șapte controale sub prag pe un singur ecran, față de unul singur pe restul aplicației. Ecranul de decizie **n-a trecut prin aceeași revizie** ca restul — nici la contrast, nici la ținte, nici la temă. E un tipar consecvent, și e semnalul cel mai clar din tot auditul: **`TikTokSort.tsx` (868 de linii) e partea cea mai puțin îngrijită a produsului, și e partea cea mai folosită.**

### 11.5 Restul scăpărilor de temă luminoasă (vizuale, nemăsurabile automat)
1. **Insigna „PRO", 1,66:1**, în antet, pe fiecare ecran.
2. **Marca aplicației își schimbă identitatea** — roată albă pe disc violet (întuneric) → roată neagră pe disc alb (lumină) [V].
3. **FAB-ul „+" aproape dispare** pe ecranul de analiză [V, captură `L-03-analysis`].
4. **Cusătura de antet** pe ecranul gol [V, captură `L-02-home-empty`].

---

## 12. Riscul de lansare pe care nu l-am putut testa, dar trebuie spus

**Ce am văzut** [V]: pe fiecare rulare, sertarul arată „**LUMIN PRO · PREVIZUALIZARE — Totul e deblocat, fără abonament**", iar panoul Premium se termină cu „*În curând. Pe acest dispozitiv nu există (încă) o cale de plată, deci nu îți cerem nimic — până atunci, plafoanele doar te informează, nu blochează nimic.*"

**De ce, în cod** [C]: `isPremiumFeatureLocked()` și `isCapEnforced()` (`core/entitlement.ts:199,225`) returnează `false` cât timp Play n-a confirmat că **există un produs de cumpărat**. Prețul și butonul de abonare se randează doar la `isBillingAvailable() && (picked ?? price)` (`PremiumPanel.tsx:299`). Pe web nu există billing, deci **tot ce ține de bani a fost invizibil în toată testarea mea.** Toate observațiile din §7.1-7.3 și §14 despre garduri sunt [C], nu [V] — le-am marcat ca atare.

**Riscul, spus limpede** [P, dar cu consecință mare]: dacă abonamentul nu e **publicat și activ** în Play Console pentru pista de test închis, cei **12 testeri primesc exact ecranul de mai sus** — totul deblocat, niciun preț, niciun buton, niciun plafon. Adică testarea închisă validează un produs **fără partea pentru care ceri bani**: nimeni nu vede paywall-ul, nimeni nu lovește plafonul de 150, nimeni nu poate raporta că fluxul de cumpărare e rupt. Cu lansarea pe 30 septembrie 2026, e singurul lucru din acest raport care poate strica lansarea în întregime.

**Cum verifici în cinci minute:** pe telefonul unui tester, Meniu → dacă scrie „PREVIZUALIZARE · Totul e deblocat", produsul nu e activ. `cercetare-tehnica.md` §F.3-2 spune deja același lucru dinspre perioada de probă — **e aceeași cauză, o oră de lucru în Play Console.**

Există și o inconsecvență de text pentru cazul intermediar [C]: `premium.soon` afirmă „*plafoanele doar te informează, nu blochează nimic*", dar el se afișează ori de câte ori lipsește **prețul** — inclusiv când `isPurchasable()` e deja `1` din cache și `isCapEnforced()` e **adevărat**. Un abonat-potențial fără rețea poate citi „nu blochează nimic" pe un ecran unde plafonul chiar blochează.

---

## 13. A doua sesiune

**Ce se întâmplă** [V, capturi `p1-07-second-session-boot`, plus fiecare rulare a mea cu profil persistent]: aplicația se redeschide **direct în starea de dinainte** — biblioteca, contoarele, „7 poze de trecut în revistă". Datele supraviețuiesc perfect, inclusiv peste reîncărcare.

**Ce lipsește:** **nimic nu marchează că e o revenire.** Fără „bine ai revenit", fără „data trecută ai trecut prin 13 poze în 4 minute", fără o propunere de continuare care să spună de unde. `SessionOutcome` există și e randat sus, imediat sub salut (`HomeDashboard.tsx:253`) [C] — dar rezumă **sesiunea tocmai terminată**, nu revenirea.

`cercetare-tehnica.md` §D.6-3 spune că sfârșitul unui triaj merită să fie „cea mai frumoasă secundă din produs". Sunt de acord, și adaug: **începutul celei de-a doua sesiuni e la fel de important și e complet gol.** E momentul în care omul decide dacă aplicația asta e un obicei sau o încercare. Azi îl întâmpină aceleași carduri ca prima dată, plus (pe web) un banner de instalare.

*Notă pentru proprietar:* bannerul „Instalează LuminCuller ca aplicație" apare în aproape toate capturile mele, dar e corect construit — se închide definitiv (`state/installPrompt.ts`), nu apare înainte de primul import, și **nu va apărea deloc în build-ul din Play** (`beforeinstallprompt` nu se emite într-un WebView Capacitor) [C, `InstallPrompt.tsx:11-36`]. **Nu e o problemă de lansare** — o spun ca să nu fie urmărită degeaba.

---

## 14. Ce ar face abonamentul să merite. Răspunsul cinstit: **aș plăti?**

`cercetare-tehnica.md` §F răspunde din partea pieței și a arhitecturii. Eu răspund din partea celui care a folosit aplicația. Cele două se întâlnesc într-un singur punct, și e altul decât cel din raportul acela.

### 14.1 Ca **părinte cu 800 de poze**: **nu.**
1. Probabil **abandonez în prima analiză** (§3.2). Nu ajung la nicio decizie de plată.
2. Dacă termin, **am primit deja tot ce voiam**: pozele triate. Panoul Premium mi-o și spune, cinstit: „*Triajul rămâne gratuit, oricâte poze ai*".
3. Din cele șapte funcții plătite, **șase nu-mi spun nimic** — XMP pentru Lightroom, planșă de contact, dosar cu PIN, combinarea a două cadre, locații, oricâte persoane. A șaptea, „recap lunar / prezentare", o am gratis în Google Photos.
4. Plafonul de 150 nu mă atinge: după vacanță **țin** pozele pe telefon, nu le scot.

**Ce m-ar face să plătesc, un singur lucru:** **să nu țin telefonul în mână.** „Pune telefonul în buzunar, îți spun când e gata." Analiză în fundal + loturi nelimitate + reluare după întrerupere. Asta e o funcție pe care o simt **în timpul** valorii, nu după — și e singura pentru care aș scoate cardul după o vacanță.
*(Aceeași concluzie ca `cercetare-tehnica.md` §F.3-5, ajunsă pe alt drum: acolo e o idee de împachetare, aici e singurul lucru care m-a durut personal.)*

**Al doilea, mai slab:** „oricâte persoane recunoscute" **e** corect ca funcție plătită — o familie are 4-5 oameni, iar 1 e evident prea puțin. Dar azi n-o simt niciodată, pentru că nu ajung la înrolare. `EnrollPeopleNudge` (`App.tsx:849`) e bine gândit — apare doar după ce am triat ceva și doar dacă biblioteca chiar are oameni în ea [C, n-am putut să-l declanșez: pozele mele de test n-au fețe]. **Dar zidul cade după muncă, nu înainte:** verificarea de plafon din `store.ts:4056` se face **după** ce s-au calculat toate amprentele faciale (`store.ts:4018-4031`) [C]. Aleg pozele, aștept, și abia apoi aflu că nu se poate. Zidul trebuie mutat **înaintea** selecției de fișiere, cu un rând care spune de la început „gratuit: 1 persoană".

### 14.2 Ca **fotograf de nuntă**: **poate — dar nu versiunea asta.**
Cârligul e corect: **predarea către Lightroom e literalmente fluxul meu de lucru.** E singura funcție plătită din aplicație care atinge munca pentru care sunt plătit. Dar:
1. **Eticheta minte despre ce exportă** (§7.1). Prima dată când asta îmi umple folderul clientului cu 2000 de sidecar-uri, dintre care 1940 marchează cadre respinse, **dezinstalez.** Nu e o iritare — e o pagubă la client.
2. **2000 de cadre pe telefon** = peste o oră (extrapolat din `cercetare-tehnica.md`). Photo Mechanic face asta pe desktop în minute. Ca să aleg telefonul, trebuie să câștig altceva — și acel altceva nu poate fi „mai lent, dar pe telefon".
3. **Nu văd proiecte/clienți în flux.** `ProjectsPanel` există, dar în sertar (§8.1). Un fotograf gândește în „nunta Popescu", nu în „sesiune".
4. **XMP e bifat implicit, fără lacăt** (§7.3) — deci prima mea întâlnire cu paywall-ul e o fereastră care sare peste un export deja pornit. E cea mai proastă primă impresie posibilă pentru un profesionist.

**Ce m-ar face să plătesc:**
- **Un flux „Predare" cu nume**, cu domeniul spus: „*XMP pentru cele 62 de poze păstrate*" — un singur buton, un singur set, cifra pe el.
- **Cifra de acord.** „AI-ul a fost de acord cu tine în 89% din 1200 de decizii." Pentru un profesionist, ăsta **e** argumentul de cumpărare — pentru că îmi spune cât pot să nu mă mai uit. Aplicația măsoară deja asta (`aiFeedback.ts`, `sessionOutcome.ts`) [C] și n-o arată nicăieri unde contează.
- **„Compară toată seria" scos din spatele unui tap.** E cea mai bună funcție din aplicație pentru mine, și e un chip mic pe un ecran aglomerat (§5.1).

### 14.3 Ca **cineva care vrea doar spațiu**: **nu, și m-aș simți păcălit.**
Singurul lucru pe care îl vreau — să șterg gunoiul și să eliberez GB — **e exact lucrul contorizat**: „a scoate" acoperă și ștergerea (`entitlement.ts:63-72`) [C]. 150 de fișiere pe 30 de zile e, pentru mine, sub 500 MB dintr-o galerie de 20 GB.
Și, cu §9.1, se închide un cerc urât: anulez importul → reimport → 300 de duplicate pe care nu le-am cerut → ca să le șterg, **îmi consum plafonul gratuit**.

**Aici nu văd un abonament care să merite, și cred că e corect să spun asta:** persona 3 nu e un client, e un canal de recomandare. „Aplicația care mi-a eliberat 12 GB" e cea mai bună propoziție de gură-în-gură pe care o poate produce produsul ăsta, și e **mai valoroasă gratis**. Aș da ștergerea nelimitată, aș ține plafonul doar pe **export**, și aș pune „ai eliberat 12,4 GB" ca rezultat de final de sesiune, cu numele aplicației pe el.

### 14.4 Diagnosticul meu, care diferă de cel din raportul tehnic

`cercetare-tehnica.md` §F.1 spune: **„Ai dat gratis produsul și vinzi ambalajul."** E adevărat. Adaug ce am văzut folosind, și e ceva ce nu se vede citind codul:

> **Cele șapte funcții plătite nu sunt doar „după triaj". Sunt și în altă parte a aplicației.**

Toate stau într-un sertar deschis dintr-un tab numit „Setări", în spatele a șase acordeoane închise (§8.1). Un utilizator nu le **atinge** niciodată. Nu le atinge nici din greșeală. Panoul Premium le descrie, dar nu duce la ele.

**Un abonament se cumpără de la ceva ce ai atins și ți-a lipsit — nu de la o listă pe care ai citit-o.** Azi, singurul drum spre o funcție plătită trece prin ecranul de plată. Asta e o pâlnie inversată, și niciun preț, nicio perioadă de probă și nicio reîmpachetare nu o repară cât timp funcțiile stau în sertar.

**Prin urmare, ordinea mea de priorități pe venit e:**

| # | Ce | De ce, din utilizare |
|---|---|---|
| 1 | **Verifică azi că abonamentul e activ în Play Console** (§12) | Altfel testarea închisă validează un produs fără paywall. O oră. |
| 2 | **Scoate funcțiile plătite din sertar, în flux** (§8.1) | „Predare Lightroom" pe ecranul de Export. „Planșă de contact" lângă selecție. „Locații" în grilă. **Fără cod nou de funcție** — doar puncte de intrare. |
| 3 | **Repară exportul XMP** (§7.1, §7.3) | E singura funcție plătită care atinge o muncă plătită, și azi minte despre ce face. |
| 4 | **Vinde „nu ține telefonul în mână"** (analiză în fundal + reluare) | Singura funcție pentru care **eu** aș plăti, ca părinte. Rezolvă și §3.2 și §9.4. |
| 5 | **Pune cifra de acord AI↔tu în paywall** | Argumentul care închide vânzarea pentru profesionist. Datele există. |
| 6 | **Ridică plafonul de pe ștergere, ține-l pe export** (§14.3) | Transformă persona 3 din client frustrat în canal de recomandare. |

---

## 15. Erori și stări goale

### 15.1 **[BUG-16] Toate avertismentele de import sunt hardcodate în română, fără diacritice, cu numele excepției JavaScript în față**

**Ce am văzut** [V, rulare `u09-errors.cjs`, sesiune **în engleză**, `<html lang="en">`, 5 fișiere dintre care 2 stricate intenționat]:

> **„2 din 5 poze nu au putut fi procesate — restul au fost adaugate. Motiv: InvalidStateError: The source image could not be decoded. [fisier real: necunoscut, etichetat "image/jpeg"] (x2)"**

Restul ecranului e integral în engleză. Trei probleme într-o singură propoziție:
1. **Nu e tradusă.** Un tester englez primește română.
2. **N-are diacritice** („adaugate", „fisier").
3. **Începe cu `InvalidStateError:`** — un nume de excepție JavaScript, pus în fața utilizatorului.

**Sursa, toate trei avertismentele** [C]:
```
src/core/importPipeline.ts:976    `Import anulat — ${done}/${images.length} poze procesate pana la anulare.`
src/core/importPipeline.ts:1102   `Niciuna dintre cele ${images.length} poze nu a putut fi procesata.`
src/core/importPipeline.ts:1103   `${failed} din ${images.length} poze nu au putut fi procesate — restul au fost adaugate.`
src/core/importPipeline.ts:1104   ` Motiv: ${topReasons}`         ← topReasons conține mesajul brut al excepției
src/core/importPipeline.ts:1107-8 `${n} fisiere alese nu sunt poze (video, HEIC etc.) — au fost sarite.`
```
**Fiecare mesaj de eroare pe care îl vede un utilizator la import ocolește complet dicționarul.** `cercetare-tehnica.md` §E.3 a semnalat **tonul** acestor mesaje („registrul tehnic"); ele sunt, în plus, **netraduse**. Împreună cu §4.2 și §4.3, asta face **trei zone** în care i18n-ul (altfel impecabil, 1847 de chei, paritate perfectă) e pur și simplu **ocolit de cod**: importul, anularea, înrolarea persoanelor.

**Reparație: ~2 ore**, ~10 chei. Sugestia din `cercetare-tehnica.md` §E.3 rămâne bună: propoziția omenească în notificare, motivul tehnic în „Statistici → ultimele importuri".

### 15.2 Ce funcționează bine la erori
- **Fișierele corupte nu opresc importul.** Din 5 fișiere (unul cu 200 KB de zgomot, unul cu text în loc de imagine), 2 au eșuat și **3 au intrat normal** [V]. Aplicația a continuat, a raportat, n-a căzut. Zero erori de pagină, zero `ErrorBoundary`.
- **Motivul e agregat** (`(x2)`), nu repetat de N ori.
- **Detectarea formatului real** („*fisier real: necunoscut, etichetat "image/jpeg"*") — diagnostic bun, doar pus în locul greșit.
- O poză de **4×4 px** a fost acceptată și scorată fără să strice nimic [V].

### 15.3 Stări goale
- **Acasă gol** — bun: ce e aplicația, trei argumente, o acțiune principală, o alternativă („Am deja o sesiune") [V, captură `e-01-empty-home`].
- **Persoane gol** — textul e printre cele mai bune din aplicație [V, captură `tab-Persoane`]: „*Nicio persoană înrolată. Adaugă-i pe cei dragi (ex. Ami) cu câteva poze clare, frontale — AI-ul îi va recunoaște și va separa străinii automat.*", plus subsolul „*Amprentele faciale rămân pe telefonul ăsta și nu pleacă nicăieri. Se șterg din Meniu → Setări, împreună cu restul datelor.*"
  **Ce lipsește:** nicăieri pe ecran nu scrie **„gratuit: 1 persoană"**. Cheia există (`premium.perk.persons.sub`, `ro.ts:374`) și e folosită doar în panoul Premium [C]. Limita se află **după** ce ai ales pozele și ai așteptat analiza (§14.1).
- **Export gol** — **fundătură** (§7.4). E singura stare goală din aplicație care nu spune ce să faci.

---

## 16. Detaliul, „De ce acest scor", editorul

### 16.1 **[BUG-17] Două file alăturate spun lucruri opuse despre aceeași poză**
**Ce am văzut, pe o singură poză, la un tap distanță** [V, rulare `u11-edit.cjs`, capturi `D-11-tab0`, `D-11-tab1`]:

| Fila **Metrici** | Fila **De ce acest scor** |
|---|---|
| `VERDICT AI: Respinge` · `34/100 claritate` | `TEHNIC: Fotografia este **suficient de clară**, cu o expunere echilibrată.` |
| `− Claritate` (motiv împotrivă) | |
| `CLARITATE 34 — Contur moale. Poate fi mișcare sau focus ratat…` | |

**Cauza, în același fișier** [C]:
```
src/ui/PhotoInfoTabs.tsx:550   const effectiveSharpness = photo.faceCount > 0 ? photo.sharpness : landscapeSharpness(photo.sharpness) * 100;   ← fila "De ce"
src/ui/PhotoInfoTabs.tsx:625   tr('inspector.verdict.metrics', { sharpness: Math.round(photo.sharpness), … })                                  ← claritate BRUTĂ
src/ui/PhotoInfoTabs.tsx:644-645  value={photo.sharpness}  note={photo.sharpness < 40 ? … }                                                   ← claritate BRUTĂ
src/core/aiExplanationGenerator.ts:85-88   sharpness >= 45 ? 'suficient de clară' : 'neclară, cu blur vizibil'
```
Peisajele (fără fețe) primesc corecția de perspectivă atmosferică `landscapeSharpness()` **doar în proza explicativă**; fila Metrici arată cifra brută. 34 brut → ~≥45 corectat → trece pragul și devine „suficient de clară", în timp ce alături scrie 34 și „Contur moale".

**Comentariul din `aiExplanationGenerator.ts:27-36` spune că fix asta a fost reparat o dată**, în sens invers (proza spunea „neclar" când motorul era indulgent). Reparația a mutat contradicția, n-a eliminat-o. **`cercetare-tehnica.md` §E.2 laudă `effectiveSharpness()` ca dovadă că explicația nu contrazice decizia — pe fluxul ăsta, o contrazice.**
**Reparație:** arată aceeași cifră în ambele file (cea corectată, cu o notă „ajustat pentru peisaj"), sau spune diferența pe față.

### 16.2 **[BUG-18] Toate cele trei butoane de decizie cad sub AA**
[V, măsurat, `audit/edit3.txt`]:

| Buton | Contrast | Culori |
|---|---|---|
| **„Selectează (P)"** (păstrează) | **1,74:1** | alb pe `#4ade80` |
| **„Respinge (X)"** | **2,82:1** | alb pe `#ff686d` |
| **„RESPING"** (ecranul de triaj) | **2,69:1** | alb pe `#fb7185` |

Pragul e 4,5:1. Butonul verde de păstrare, la **1,74:1**, e practic text alb pe verde deschis — la soare, pe telefon, e ilizibil. Astea sunt **cele trei butoane pe care se apasă de sute de ori pe sesiune**, în ambele teme.
**Reparație:** text închis pe fundalurile deschise (`#052e16` pe verde = 8,9:1) sau fundaluri mai închise. 15 minute.

### 16.3 Ce e **foarte bun** în „De ce acest scor"
Textul integral, citit live [V]:
> **Verdictul vine din reguli generale de fotografie. Din deciziile tale pe acest tip de cadru am strâns 0 — încă nu destule cât să am o părere proprie.**
> **Fără „Fără date de aparat foto", ar fi ajuns la 40 și ar fi scăpat de respinse.**
> CE A CÂNTĂRIT: *Principalii factori care au cântărit în scor — în favoarea ei: Expunere echilibrată; împotriva ei: Fără date de aparat foto, Claritate și Compoziție.*

**Contrafactualul** („fără X, ar fi ajuns la 40 și ar fi scăpat de respinse") e cea mai bună funcție din tot produsul. Nimeni pe mobil nu are așa ceva. Și **declararea propriei incertitudini** („am strâns 0 — încă nu destule cât să am o părere proprie") e onestitate pe care nicio aplicație de consum n-o scrie.
**Și e gratuită, fără nume, la trei taps de grilă.** (§14.4.)

Notele din fila Metrici sunt în același registru bun: „*Nu am găsit o axă de simetrie. **Multe cadre bune nu au una.***", „*Nu am găsit linii care duc privirea spre subiect. **Nu scade valoarea momentului.***" — fiecare metrică negativă vine cu o propoziție care oprește utilizatorul să o citească drept condamnare. Excelent.

### 16.4 Editorul
**Exercitat** [V, captură `D-12-editor`]: se deschide corect din „Deschide Edit Studio", e organizat curat (`Auto` / `Stil` / `Aplică`, presetări *Natural · Portret · Peisaj · Alb-negru · Apus · Interior*, grupuri **LUMINĂ / CULOARE / DETALIU** cu 13 cursoare, toate la 0), și dă o citire utilă a histogramei: „*Histogramă: nimic lipit de capete.*"

**Observația mea, ca utilizator:** e o unealtă serioasă și e **în drumul greșit**. Ca să ajung aici: grilă → poză → chip „Metrici" → „Deschide Edit Studio" = patru atingeri, printr-un ecran de decizie. Iar în momentul în care triez 800 de poze, **ultimul lucru pe care vreau să-l fac e să editez una.**
Sunt de acord cu `cercetare-tehnica.md` §F.5: nu-l șterge, dar nu mai investi în el. **Adaug un motiv de utilizare:** editorul e singura parte a aplicației care îmi cere să ies din ritm. Triajul e un flux; editarea e o oprire. Puse pe același drum, se strică fluxul.

**A11y editor** [V]: `.ghost.icon-btn` „Închide" și „Resetează" sunt **40×44** — sub prag pe lățime; restul e curat (zero controale fără nume).

---

## 17. Tabelul de priorități — ordonat după impact pe **abandon** și pe **decizia de a plăti**

Nu după cât de ușor e de reparat. Coloana „efort" e informativă, nu ordonatoare.

### Înainte de 30 septembrie 2026

| # | Ce | Impact | Dovadă | Efort |
|---|---|---|---|---|
| **1** | **Verifică azi că abonamentul e ACTIV în Play Console.** Dacă Meniul unui tester scrie „PREVIZUALIZARE · Totul e deblocat", testarea închisă nu validează niciun paywall. | **poate strica lansarea** | §12 [V+C] | 1 h |
| **2** | **Import: sari peste fișierele deja în bibliotecă.** Azi, anulare + re-import = duplicate 1:1, analizate a doua oară, iar curățarea lor consumă plafonul gratuit. | **cel mai grav bug funcțional** | §9.1 [V] | 1-2 zile |
| **3** | **Ecranul de analiză: „poza N din M · ~T min rămase".** Azi arată doar timpul scurs. La 800 de poze e ~33 de minute fără nicio estimare. | **abandonul #1** | §3.2 [V] | 0,5-1 zi |
| **4** | **Repară eticheta exportului XMP** — spune că exportă selecția, exportă tot ce e decis. La o nuntă, umple folderul clientului cu sidecar-uri de cadre respinse. | **pierzi profesionistul** | §7.1 [C+V] | 20 min (text) |
| **5** | **Butoanele de decizie sub AA:** 1,74:1 (păstrează), 2,82:1, 2,69:1 (respinge). Cele mai apăsate butoane din produs, în ambele teme. | mare (folosire zilnică) | §16.2 [V, măsurat] | 15 min |
| **6** | **„Compozițional, cadrul are orizontul e înclinat cu 3.3°"** — agramat în RO **și** EN, pe orice peisaj strâmb, chiar în funcția-vitrină. | mare (credibilitate) | §4.1 [V] | 5 min |
| **7** | **Toate avertismentele de import + anulare + înrolare persoane: hardcodate în română, fără diacritice, cu `InvalidStateError:` în față.** Un tester englez le vede în română. | mare (i18n, 3 zone) | §15.1, §4.2, §4.3 [V+C] | 2 h |
| **8** | **Buton de anulare disponibil din prima secundă**, nu după ~105 s de „Se încarcă modelele AI". | mediu-mare | §9.2 [V] | 0,5 zi |
| **9** | **Notificarea de anulare raportează 6 când pe ecran sunt 9.** | mediu | §9.3 [V] | 1 h |
| **10** | **XMP: lacăt vizibil pe comutator + `gatePremium` verificat ÎNAINTE de a porni exportul.** Azi paywall-ul sare peste un export deja pornit. | mediu-mare | §7.3 [C] | 2 h |
| **11** | **Fila Metrici și fila „De ce" spun lucruri opuse despre claritate.** | mediu-mare (credibilitate AI) | §16.1 [V+C] | 0,5 zi |
| **12** | **„Roșiori · România" scos din panoul Premium** (confirmat vizual, inclusiv în engleză). | mic dar jenant, pe ecranul de plată | §8.4 [V] | 15 min |
| **13** | **Insigna „PRO" — 1,66:1 pe tema luminoasă**, pe fiecare ecran. | mic-mediu | §10.2 [V] | 10 min |
| **14** | **Export gol: spune cum se selectează o poză.** Azi e o fundătură într-unul din cele 5 taburi principale. | mediu | §7.4 [V] | 2 h |
| **15** | **Butonul-marcă 31×31** (sub 44×44), pe fiecare ecran. | mic | §10.2 [V] | 10 min |
| **16** | **Diacritice:** „o paleta de culori armonioasă", „spre camera", „pana la anulare". | mic | §4.5, §4.2 [V] | 5 min |

### După lansare, ordonat după venit

| # | Ce | De ce |
|---|---|---|
| **17** | **Scoate funcțiile plătite din sertar, în flux** — „Predare Lightroom" pe ecranul Export, „Planșă de contact" lângă selecție, „Locații" în grilă. | §8.1, §14.4. **Cel mai mare efect pe conversie din tot raportul.** Fără cod nou de funcție. |
| **18** | **Analiză în fundal + reluarea unui import întrerupt, ca funcție premium.** | §14.1. Singurul lucru pentru care **aș** plăti ca părinte. Rezolvă și #3 și #2. |
| **19** | **Cifra de acord AI↔tu, în paywall.** | §14.2. Argumentul de închidere pentru profesionist; datele există. |
| **20** | **Ecranul de decizie, refăcut:** fotografia să ocupe >60% din ecran (azi ~35%), ținte de 44px, temă luminoasă reală. | §5.1, §11.2, §11.4. E ecranul cel mai folosit și cel mai puțin îngrijit. |
| **21** | **Zidul „a doua persoană" mutat ÎNAINTE de alegerea pozelor**, cu „gratuit: 1 persoană" scris pe ecranul Persoane. | §14.1, §15.3 |
| **22** | **Plafonul ridicat de pe ștergere, ținut pe export.** | §14.3 — transformă persona 3 din client frustrat în canal de recomandare. |
| **23** | **Un moment de revenire la a doua sesiune.** | §13 — azi e complet gol. |
| **24** | **Structură pentru cititoarele de ecran:** un `<main>`, titluri reale. | §10.3 |

---

## 18. Ce am lăsat neverificat, ca să nu se creadă că e verificat

1. **Orice flux cu fețe** — Persoane, recunoaștere, zâmbet/ochi/privire, headroom, `FaceCompareStrip`, `EnrollPeopleNudge`, zidul „a doua persoană". Nu pot genera fețe. Tot ce spun despre ele e [C].
2. **Orice flux cu bani** — cumpărare, restaurare, prețuri, perioadă de probă, plafoane **care chiar blochează**. Pe web nu există billing (§12). Am putut vedea doar **avertismentul** de plafon (145/150), injectând jurnalul de consum.
3. **Scara reală** — 20 de poze, nu 800 sau 2000. Timpii pe care îi citez pentru volume mari sunt extrapolări din măsurătorile din `cercetare-tehnica.md`, marcate ca atare.
4. **Telefon real** — termic, baterie, gesturi de swipe reale, foaia de partajare Android, SAF, HEIC, notificări, Gemini Nano.
5. **Panourile secundare** — Colecții, Proiecte, Momente, Smart Inbox, Rescue Queue, Vault, Protecție documente, Prezentare, Recap, Locații, Planșă de contact, ClipLab, Supervizorul galeriei. Le-am văzut ca intrări în sertar (§8.1), nu le-am folosit.
6. **Statistici** — n-am reușit să-l deschid programatic și n-am date de o singură sesiune cât să-l judec. Merită verificat de proprietar comentariul de la `StatsPanel.tsx:373` despre o cifră de „750 de poze procesate, care nu exista nicaieri in cod ca limita".

---

## 19. Concluzie, în trei propoziții

**Aplicația e mult mai bună decât modelul ei de venit.** Explicațiile care își declară incertitudinea, contrafactualul „ce ar fi trebuit să fie altfel", notele care te opresc să citești o metrică drept condamnare, avertismentul onest despre ce nu poate face telefonul — sunt lucruri pe care nu le are nimeni pe mobil, și toate sunt gratuite, fără nume, la trei atingeri distanță.

**Ce se vinde stă într-un sertar deschis dintr-un tab numit „Setări", în spatele a șase acordeoane închise** — deci nimeni nu atinge niciodată funcția pentru care i se cere să plătească.

**Iar între utilizator și oricare dintre astea stau ~33 de minute de așteptare fără estimare, o anulare din care nu se poate reveni, și un re-import care duplică tot.** Reparate în ordinea din §17, lucrurile 1-4 costă câteva zile și scot cele mai mari trei găuri prin care se scurg oamenii înainte de a apuca să vadă ce are aplicația bun.
