# Specificație de concept vizual — LuminCuller

**Sursă:** capturi confirmate de utilizator la 18 august 2026. Acest document este etalonul de implementare pentru noua experiență mobilă.

## Principii transversale

Interfața este întunecată, premium și editorială, cu suprafețe aproape negre, contururi discrete gri-albăstrui, accente aqua/mentă și o nuanță violetă folosită în gradiente sau semnale premium. Tipografia combină titluri mari, foarte clare, cu etichete monospațiate și spațiate. Controalele mari au colțuri rotunjite, umbră blândă și zone de atingere generoase. Fundalul foto rămâne dominant în fluxul de sortare; acțiunile sunt un panou solid, distinct și constant.

## Ecran de început

Ecranul gol trebuie să comunice imediat propunerea de valoare: "STUDIO LOCAL · FĂRĂ UPLOAD", titlul "Transformă un lot într-o selecție", descrierea despre prima trecere realizată de AI și trei carduri egale: **PRIVAT — Pozele rămân pe telefon**, **RAPID — AI-ul face prima trecere** și **CONTROL — Tu confirmi și poți corecta**. Sub acestea apare mesajul explicativ despre selecție revizuibilă, CTA-ul gradient aqua–violet "Pornește selecția", CTA secundar "Importă o perioadă" și nota de siguranță că nimic nu se șterge fără confirmare.

## Pregătirea și analiza sesiunii

Importul/analiza se reprezintă ca o experiență "ANALYSIS STUDIO" într-un card mare, cu contor în colț (de exemplu 6/6), grafic orbital luminos, titlu "Pregătim sesiunea", mesaj dinamic despre operația curentă, o bară gradient de progres și trei etape etichetate: **IMPORT**, **ANALIZĂ LOCALĂ**, **SERII**. Ecranul păstrează navigația și FAB-ul, fără a bloca identitatea aplicației.

## Home după import: Review Desk

În partea superioară există brandingul, căutare, indicator/context de export și meniu. Zona principală se schimbă într-un "REVIEW DESK" cu contor de progres, acțiune "Golește sesiunea", rezumat de selecție/respingere și un card foto dominant pentru următoarea decizie. Cardul include eticheta "Sortare rapidă", numele fișierului, eticheta "URMĂTOAREA DECIZIE", numărul mare de fotografii rămase, text explicativ și trei acțiuni ordonate: CTA primar gradient "Continuă", acțiune secundară conturată "Sortare rapidă" și acțiune de bibliotecă "Vezi toate fotografiile". Jos se află un rezumat al deciziilor rămase/pozelor selectate, FAB-ul plus și navigația inferioară într-un container unificat.

## Sortare rapidă

Fotografia ocupă aproape întreg ecranul. Sus se află progresul pe segmente și controlul de închidere cu indexul curent. Peste partea de jos a fotografiei apar: badge-ul cu recomandarea și scorul AI, factorii principali, data și butonul "Vezi metricile și editarea". Bara de decizie rămâne fixă la bază într-un panou întunecat cu margine/umbră și patru acțiuni identificate prin etichetă și icon: **Păstrez** (inimă aqua), **Album** (folder), **Șterg** (buton coral cu X) și **Anulează** (săgeată înapoi). Eticheta trebuie să stea deasupra iconului și să rămână lizibilă pe toate dispozitivele.

## Inspector / Metrici

Inspectorul este o foaie suprapusă, întunecată, cu mâner central, eticheta monospațiată "INSPECTOR" și tab-uri mari: **Metrici**, **De ce acest scor**, **Persoane**, **Istoric**. Tab-ul activ folosește o suprafață mai luminoasă și indicator aqua. Panoul Metrici începe cu cardul "VERDICT AI", verdict textual mare (de exemplu "Verifică"), explicații condensate, badge-uri de factori pozitivi/negativi și indicator circular de scor. Urmează CTA-ul "Deschide Edit Studio" și grila de metrici cu valori mari: claritate, expunere, fețe, zâmbet, ochi, treimi/cadraj. Inspectorul trebuie să poată fi închis explicit și să nu modifice stilul global al temei.

## Meniu

Meniul este un ecran/fundal opac cu titlu mare "Meniu" și buton X de închidere. Cardul Premium este vizibil la început, cu icon, eticheta "LUMIN PRO", starea factuală "Premium disponibil — activează după cumpărare" și acțiunea "VEZI". Apoi apar două acțiuni rapide egale: **Sortare rapidă** și **Căutare vizuală**. Secțiunile acordion sunt ample și ritmate: **ORGANIZARE**, **CURĂȚARE AI**, **VEZI ȘI PREZINTĂ**, **EXPORT ȘI BACKUP**, **SETĂRI**, **AJUTOR**. Zona Ajutor deschisă afișează „Scurtături tastatură” și nota de confidențialitate locală.

## Criterii obligatorii pentru validare

1. Ecranul gol are identitate editorială și cele trei carduri de valoare.
2. Progresul analizei are card Analysis Studio și comunică explicit etapele.
3. Home după import este Review Desk, nu un rezumat generic cu carduri disparate.
4. Sortarea rapidă păstrează fotografia dominantă și bara de decizie ordonată pe mobil.
5. Inspectorul are ierarhia Verdict → Edit Studio → metrici, cu tab-uri coerente.
6. Meniul are card Premium factual, acțiuni rapide și secțiuni accordion lizibile.
7. Tema luminoasă trebuie să păstreze contrastul, fără a schimba intenția zonei foto întunecate.
8. Nicio funcție nu este simulată: toate acțiunile rămân conectate la store, import, scor AI, entitlement și pluginurile native existente.

## Addendum — "Lumin Culler PRO" (28 august 2026)

Al doilea val de mockup-uri confirmate de utilizator (ecran de întâmpinare cu
marca "LC", grilă cu inele de scor, Persoane, Detaliu cu scor AI mare, Export
cu progres circular) a devenit **aspectul implicit** al aplicației, nu doar o
variantă opțională:

- **Accent implicit**: gradient violet→cyan (`--accent`/`--accent-2` în
  `styles.css`, `--atelier-teal`/`--atelier-violet` în `styles.concept.css`),
  în locul turcoazului-violet-indigo de dinainte. Vechiul aspect rămâne
  selectabil instant din Aspect/Meniu sub id-ul `legacy` — cerință directă a
  utilizatorului ("posibilitatea de anulare"), nu doar o remediere tehnică.
- **Insigna "PRO"** de lângă wordmark (`brand-pro-badge`) e nume de produs,
  nu un indicator de drepturi — starea reală de Premium rămâne exclusiv în
  `drawer-pro-card` (Meniu), unde "cumpărat/nu" chiar contează.
- **Cutia de față reală** din Detaliu (`detail-face-box`) desenează
  `FaceInsight.box` (coordonate reale, din analiza pe dispozitiv) cu un
  contur luminos — NU un mesh de puncte decorativ: aplicația nu expune
  coordonate de landmark către JS (vezi `core/nativeFaceMesh.ts`), deci un
  mesh literal ca în mockup ar fi fost simulat, împotriva criteriului 8 de
  mai sus.
- **Inelul de progres din Export** (`export-progress-ring`,
  `ExportDestinations.tsx`) arată procentul REAL al exportului curent, nu o
  animație — vezi `onProgress` în `core/exportPhotos.ts` și `exportProgress`
  în `state/store.ts`.
- Cardurile din grilă capătă contur luminos verde/ambră/roșu după status
  (nu doar bara subțire de sus de dinainte), iar Persoane primește avatare
  cu inițială (nu fotografii — profilele salvează doar embedding-uri, nu
  imaginile de înrolare) și un chip de încredere (%) lângă fiecare persoană.

Onboarding-ul cu trei carduri de valoare ("Privat/Rapid/Control") din primul
mockup NU a fost reprodus literal ca ecran static: fluxul existent e un
wizard cu pași reali (permisiuni, scor AI, persoane, Premium), nu un ecran
de tip paywall — a forța un al treilea model de conținut peste el ar fi
însemnat fie să inventăm text fără acoperire, fie să rescriem fluxul de
permisiuni deja testat pe device. Identitatea vizuală (marcă rotundă cu
halou, titlu în gradient, CTA plin) a fost portată pe pașii existenți.
