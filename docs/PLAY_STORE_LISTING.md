# Texte fisa Play Store — Lumin (v4, teancul zilnic)

Numele din launcher e **Lumin**. Pachetul ramane `com.luminculler.app`.
Aplicatia nativa e tradusa in **romana si engleza**; publica fisa doar in
aceste doua limbi pana exista traducerile aplicatiei (o fisa in germana
care deschide o aplicatie in engleza aduce note de o stea).

| Limba | Titlu (≤30) | Descriere scurta (≤80) |
|---|---|---|
| ro-RO | `Lumin: Curăță Poze și Spațiu` | `Telefon plin? În 2 minute pe zi, AI găsește duplicate, poze neclare și capturi.` |
| en-US | `Lumin: Photo Cleaner & Swipe` | `2 minutes a day: AI finds duplicates, blurry shots & big videos. Swipe to clean.` |

**Ce e gratuit si ce e Premium — identic in fisa, in aplicatie si in
`cleaner/core/Plan.kt`:**

- gratuit: teancul zilnic (30 de poze), oricate stergeri din el; toate
  cosurile vizibile, cu cati GB ocupa; PRIMA curatare completa a unui cos;
- Premium: teancuri in plus in aceeasi zi; curatarea cosurilor oricand;
- planuri: lunar (`lumin_premium_monthly`), anual cu 7 zile de proba
  (`lumin_premium_yearly`), pe viata (`lumin_premium_lifetime`); fara plan
  saptamanal; anularea e in Google Play.

## Descriere lunga — romana

```
Telefonul plin de poze pe care nu le mai vezi niciodată? Lumin te ajută să faci ordine în 2 minute pe zi.

În fiecare zi primești un teanc mic de poze: o amintire din ziua de azi, de acum câțiva ani, pozele pe care AI-ul le-a găsit ca duplicate, rafale sau neclare, și cele mai noi poze. Glisezi la dreapta ca să păstrezi, la stânga ca să ștergi. La final confirmi o singură dată, iar pozele merg în coșul de gunoi al telefonului, de unde le poți recupera 30 de zile.

CE GĂSEȘTE
• Duplicate – copii ale aceleiași poze, chiar dacă sunt în foldere diferite. Originalul rămâne.
• Poze asemănătoare – rafale și cadre aproape identice. Cea mai clară rămâne, marcată cu verde.
• Poze neclare – mișcate sau nefocalizate.
• Capturi de ecran și imagini din WhatsApp, Telegram și alte aplicații de chat.
• Videoclipuri mari, cele mai mari primele.

DE CE LUMIN
• Amintiri: „Acum 3 ani” – fiecare teanc începe cu o poză din aceeași zi, din anii trecuți.
• Vezi mereu ce rămâne: la duplicate și rafale, poza păstrată stă lângă cele propuse.
• Ții minte ce ai ales: o poză păstrată nu îți mai e propusă.
• Serie de zile și memento de seară, doar dacă vrei.
• Confidențialitate: totul se analizează pe telefon. Fără cont, fără reclame, nimic nu se încarcă nicăieri.

GRATUIT ȘI PREMIUM
Teancul zilnic e gratuit, oricâte poze ștergi din el. Vezi gratuit toate categoriile și câți GB poți elibera, iar prima curățare completă a unei categorii e gratuită.
Lumin Premium curăță categorii întregi dintr-o atingere și îți dă teancuri nelimitate în fiecare zi. Planuri: lunar, anual (cu 7 zile gratuite) sau o singură plată pe viață. Prețul se vede în aplicație, în moneda contului tău. Abonamentul se reînnoiește automat până îl anulezi din Google Play → Abonamente.
```

## Full description — English

```
Is your phone full of photos you never look at? Lumin helps you clean up in 2 minutes a day.

Every day you get a small stack of photos: a memory from this day years ago, the duplicates, bursts and blurry shots the AI found, and your newest pictures. Swipe right to keep, left to delete. At the end you confirm once, and the photos go to your phone's trash, where you can restore them for 30 days.

WHAT IT FINDS
• Duplicates – copies of the same photo, even in different folders. The original stays.
• Similar shots – bursts and near-identical frames. The sharpest one stays, marked in green.
• Blurry photos – shaken or out of focus.
• Screenshots and images saved from WhatsApp, Telegram and other chat apps.
• Large videos, biggest first.

WHY LUMIN
• Memories: "3 years ago" – every stack starts with a photo from this day in past years.
• You always see what stays: for duplicates and bursts, the kept photo sits next to the suggestions.
• It remembers your choices: a photo you kept is never suggested again.
• Daily streak and an optional evening reminder.
• Privacy: everything is analyzed on your phone. No account, no ads, nothing is uploaded.

FREE AND PREMIUM
The daily stack is free, delete as many photos from it as you like. You can see every category and how many GB you can free for free, and your first full clean of a category is free.
Lumin Premium cleans whole categories with one tap and gives you unlimited stacks every day. Plans: monthly, yearly (with a 7-day free trial) or a one-time lifetime purchase. The price is shown in the app in your account's currency. Subscriptions renew automatically until you cancel in Google Play → Subscriptions.
```

## Capturi de ecran

Capturile din `store-assets/v3/` arata interfata web veche (taburi
Curata/Biblioteca/Setari) si NU mai corespund aplicatiei. Fa capturi noi din
aplicatia nativa: ecranul Azi (teancul + GB), swipe-ul cu o amintire, un cos
de duplicate cu poza „Ramane”, ecranul de final cu GB eliberati, Premium.

---

# Texte fisa (varianta anterioara, cu limita corectata)

> **ATENTIE — de aici in jos e fisa VECHE („Lumin Culler Pro”).** Titlul si
> descrierea scurta se iau DOAR din tabelul de mai sus. Descrierile lungi de
> mai jos se pot refolosi doar dupa ce le aliniezi la limitele noi (swipe si
> stergere gratuite, „Curata tot” 1 cos + 50/zi, fara plafon pe stergere).

Gata de copiat direct in Play Console (Store presence -> Main store listing).
Toate limitele de caractere de mai jos sunt cele impuse de Google Play; verificate
cu numaratoare exacta, nu estimate.

---

## Titlu aplicatie (max 30 caractere)

```
Lumin Culler Pro
```
(16 caractere — identic in RO si EN, e un nume propriu)

---

## Romana (limba principala)

### Descriere scurta (max 80 caractere)
```
Curăță galeria de duplicate și cadre ratate. AI pe telefon, fără cont.
```
(70 caractere)

De ce ASTA si nu "Sute de poze, triate în minute" (varianta dinainte): Play
indexeaza puternic descrierea scurta, iar varianta veche nu continea NICIUN
termen pe care oamenii chiar il tasteaza. Cercetarea de piata a aratat ca
intrarea in masa in categoria asta e "curat galeria / sterg duplicate /
eliberez spatiu" — "culling" il cauta doar fotografii profesionisti, adica un
public mult mai mic. Noua varianta pastreaza promisiunea (AI local, fara cont)
si adauga trei termeni cautati: curata galeria, duplicate, cadre ratate.

### Descriere lunga (max 4000 caractere)
```
Te-ai întors cu 800 de poze și nu ai chef să le treci una câte una.

Lumin Culler le trece în locul tău: găsește duplicatele, adună rafalele,
dă fiecărui cadru un scor și îți spune de ce. Tu confirmi. Nimic nu se
șterge fără acordul tău.

Toată analiza rulează pe telefonul tău. Nicio poză, niciun chip și niciun
fel de date nu pleacă de pe dispozitiv — fără upload, fără cont, fără
reclame, fără urmărire.

CE FACE

• Găsește seriile și duplicatele. Din douăzeci de cadre aproape identice
  îți propune direct pe cel bun, cu celelalte la un tap distanță.

• Dă un scor și îl explică. Claritate, expunere, compoziție, ochi
  deschiși, zâmbet, contact vizual — cu ecranul „De ce acest scor", unde
  vezi ce a cântărit în favoarea cadrului și ce împotriva lui.

• Învață cum alegi TU. Fiecare decizie antrenează un model care reține
  separat, pe tip de scenă: poate la portret îți place puțin subexpus, dar
  la peisaj vrei lumină plină. După câteva zeci de decizii, scorul începe
  să semene cu gustul tău, nu cu un manual.

• Recunoaște oamenii tăi. Înrolezi câteva poze de referință pentru copil,
  familie sau clienți, și aplicația deosebește cadrele cu ei de restul.

• Editor complet, în aceeași aplicație. Expunere, culoare, curbe, editare
  selectivă pe zone, retuș, decupare. Plus un buton Auto care judecă
  subiectul, nu histograma — pe o poză în contralumină ridică omul, nu
  întunecă tot cadrul ca să salveze un cer oricum ars.

• Separă ce nu e amintire. Capturi de ecran, documente, poze la ambalaje
  și facturi — scoase din drum, ca să nu-ți ceară o decizie de fotografie.

• Eliberează spațiu. Îți arată câți GB ocupă pozele și câți pot pleca:
  duplicatele exacte, rafalele din care ai ales deja, cadrele respinse.
  Ștergerea trece prin dialogul de confirmare al sistemului, deci nimic nu
  dispare fără să apeși tu.

• Predă mai departe. Export în format original, fișiere XMP pentru
  Lightroom, planșă de contact, galerie HTML pentru client, redenumire în
  masă.

• Merge pe mii de poze. Procesare pe mai multe fire, fără să încarce
  biblioteca în memorie.

PENTRU CINE

Pentru oricine se trezește cu sute de poze după o ieșire — părinți,
călători, oameni de la evenimente. Și pentru fotografi de nuntă, portret
sau eveniment, care predau o selecție și lucrează în Lightroom.

CE E GRATUIT

Triajul, tot. Import fără plafon, scor AI, sortare, grupare, comparare de
serii — oricâte poze, fără cont.

Premium ridică plafonul pe pozele SCOASE din aplicație și deblochează
fluxul profesional:

• Gratuit: swipe și ștergere nelimitate (ștergerea nu se numără), primul coș
  „Curăță tot” cu AI, apoi 50 de poze pe zi, 150 de exporturi la 30 de zile,
  o persoană recunoscută.
• Premium: curățare AI fără plafon, comprimare video, mementouri, export
  nelimitat, oricâte persoane, plus XMP
  pentru Lightroom, planșă de contact, dosar privat cu PIN, recap lunar,
  prezentare, locații și sugestia de combinare a două cadre.

Prețul se vede în aplicație, în moneda contului tău. Abonamentul se
reînnoiește automat până îl anulezi din Google Play → Meniu → Abonamente;
anularea are efect la finalul perioadei deja plătite.

CONFIDENȚIALITATE

Procesare integral locală. Fără reclame, fără analytics, fără servicii de
urmărire ale unor terți. Politica completă e în aplicație.
```

Numar caractere descriere lunga: 3183 din 4000 (RO) si 3598 din 4000 (EN).

ATENTIE: textul de mai sus are DIACRITICE. Versiunea publicata initial nu avea,
si se vedea imediat in fisa din magazin ("aplicatie de sortare si selectie a
fotografiilor", "gandita pentru fotografi"). Orice editare viitoare le pastreaza.

---

## English (secondary listing language, optional but recommended)

### Short description (max 80 characters)
```
Clean your gallery: find duplicates, cull bad shots, free up space. On-device.
```
(78 characters)

### Full description (max 4000 characters)
```
Lumin Culler Pro is a photo culling and selection app: you come back from a
trip, a party, or a shoot with hundreds or thousands of photos on your phone,
and you don't want to spend hours manually picking the best frames.

All the AI runs DIRECTLY ON YOUR PHONE. No photo, face, or metadata ever
leaves your device — no server upload, no mandatory account, no ads, no
tracking.

WHAT IT DOES

• Real AI face analysis — actual neural-network detection (not a simulation):
  smiles, open/closed eyes, overall frame quality.

• Geometrically computed composition — rule of thirds, headroom, and other
  criteria calculated from the subject's real position in the frame, not
  guessed.

• Known-person recognition — enroll a few reference photos for family,
  friends, or recurring clients, and the app automatically tells them apart
  from strangers in your photos.

• Personalized learning engine — every decision you make (Select/Reject)
  trains a model that learns your exact preferences: maybe you like slightly
  underexposed dramatic portraits, but bright, punchy landscapes. The app
  remembers this separately, per scene type.

• Automatic burst/duplicate grouping — out of a burst of 20 near-identical
  frames, it suggests the single best one.

• Handles thousands of photos without freezing — processing runs across
  multiple threads in parallel, without loading your whole library into
  memory at once.

• Frees up storage — shows how many GB your photos take and how many can
  go: exact duplicates, bursts you already picked from, rejected frames.
  Deletion goes through the system's own confirmation dialog, so nothing
  disappears unless you tap.

• Flexible export — selected photos in their original format (no quality
  loss), Adobe Lightroom selection lists, an HTML gallery for clients, batch
  renaming with custom templates. XMP metadata sidecars are part of Premium
  (see below).

• Batch operations — Auto-Cull by percentage, reject below a score
  threshold, saved presets per shoot type (wedding, portrait, event...).

• Optional basic edits — exposure, contrast, color — before export.

WHO IT'S FOR

Anyone who ends up with hundreds of photos after a day out — parents
photographing their kids, travelers, people covering events — just as much
as professional and enthusiast photographers doing shoots (weddings, events,
portraits, sports, landscapes). A fast, private, smart tool that learns how
YOU choose, instead of applying a generic one-size-fits-all formula.

FREE AND PREMIUM

The culling itself is free and unlimited: import as many photos as you like
and get AI scoring, sorting, burst grouping and frame comparison, with no cap
and no account.

The optional Premium subscription (monthly or yearly, via Google Play) lifts the cap on
photos taken OUT of the app and unlocks the professional workflow:

• Free: unlimited swipe and deletion (deletion does not count), the first
  full AI clean, then 50 photos a day, 150 exports every 30 days, one
  enrolled recognised person.
• Premium: unlimited AI clean-all, video compression, reminders, unlimited
  export, as many recognised people as you like, plus XMP sidecars for Lightroom, contact sheet, private vault, monthly
  recap, presentation mode, trips, and the two-frame composite suggestion.

The price is shown in the app, in your account's currency. The subscription
renews automatically until you cancel it in Google Play > Menu > Subscriptions;
cancelling takes effect at the end of the period you already paid for.

PRIVACY

Read our full privacy policy in the app or at the address listed on the
store page. In short: 100% on-device processing, no ads, no third-party
analytics/tracking services.
```

---

## Categorie
**Fotografie**

## Public tinta
Adulti — nu contine continut pentru copii, nu se adreseaza in mod special copiilor.
