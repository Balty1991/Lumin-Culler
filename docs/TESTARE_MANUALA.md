# Testare manuala pe telefon — ce s-a schimbat in sesiunea asta

Lista asta acopera EXACT ce a fost modificat in sesiunea de audit (12 commit-uri,
89 de fisiere). Nu e o testare completa a aplicatiei — e verificarea schimbarilor.

Ordinea e cea a durerii: primele sunt lucrurile care, daca sunt stricate, se vad
imediat si strica sesiuni de lucru sau bani. Ultimele sunt cele care se observa
doar daca le cauti.

Pentru fiecare punct: **ce faci** si **ce trebuie sa vezi**. Daca vezi altceva,
noteaza exact ce ai facut inainte — jumatate din defectele de aici depind de
ordinea pasilor.

Legenda de pregatire:
- **[gratuit]** = testeaza fara abonament activ
- **[abonat]** = testeaza cu abonamentul cumparat (sau pe un cont care il are)
- **[Play]** = are nevoie de build semnat, incarcat macar in Internal testing

---

## 1. Abonament, plafoane si contoare

Aici s-a schimbat cel mai mult si aici se pierd bani daca e gresit.

### 1.1 Statistici arata DOUA cifre diferite, nu una
Meniu > Statistici, deruleaza pana la sectiunea **Utilizare**.

Trebuie sa vezi **doua propozitii separate**:
- una cu **poze analizate luna aceasta** si textul ca triajul e gratuit si nelimitat;
- una cu **poze scoase din aplicatie in ultimele 30 de zile**, cu plafonul (150).

Nu trebuie sa mai apara nicaieri cifra **750** si nici textul vechi "pragul
orientativ al nivelului gratuit". Daca vezi 750 undeva, e o regresie.

### 1.2 Importul nu mai anunta niciun prag
[gratuit] Importa **peste 750 de poze** intr-o singura sesiune (sau in mai multe
importuri consecutive in aceeasi luna calendaristica).

La finalul importului trebuie sa vezi doar confirmarea normala ("s-au adaugat N
poze"). NU trebuie sa apara niciun mesaj cu "ai trecut de pragul de 750" sau
"nivel gratuit". Importul e nelimitat.

### 1.3 Contorul "poze scoase" se misca IMEDIAT dupa export
[gratuit] Meniu > Statistici, retine cifra de la "poze scoase din aplicatie".
Inchide Statistici. Selecteaza 5 poze si exporta-le. Redeschide Meniu >
Statistici.

Cifra trebuie sa fie mai mare cu 5. **Fara** sa fi repornit aplicatia.
Acelasi lucru pe ecranul Premium (randul de folosire).

### 1.4 Exportul unui folder respecta plafonul (asta era gaura)
[gratuit] [Play] Ai nevoie de o stare in care ti-au mai ramas putine poze din
cele 150 (foloseste 1.3 ca sa consumi, sau testeaza pe un cont care a exportat
deja mult).

Pune intr-un **Folder** (Meniu > Foldere) mai multe poze decat ti-au mai ramas
din plafon si apasa **Exporta** pe acel folder.

Trebuie sa vezi mesajul de plafon (acelasi ca la "Exporta selectia") **si sa se
deschida ecranul Premium**. Exportul NU trebuie sa porneasca. Inainte, drumul
asta ocolea complet plafonul.

Contra-proba: cu plafonul neatins, acelasi export trebuie sa mearga normal.

### 1.5 Ecranul Premium are trei fete
Meniu > Premium.

- [gratuit] fara cale de plata (web/PWA sau produs neconfigurat): scrie "In
  curand", **niciun buton de cumparare**, niciun pret inventat.
- [gratuit] [Play] cu plata disponibila: apare pretul REAL din Play (in moneda
  contului tau) pe butonul de abonare, iar sub el butonul discret
  **"Am deja abonament — restaureaza"**.
- [abonat]: chip-ul scrie **"Premium activ"**, textul de sus confirma ca esti
  abonat, randul de folosire scrie "fara plafon", si in locul butonului de
  cumparare apare textul despre gestionarea din Google Play. NU trebuie sa mai
  vezi "Aboneaza-te — 19,99 lei".

### 1.6 Restaurarea achizitiei
[Play] Pe un telefon unde contul ARE abonamentul dar aplicatia tocmai a fost
reinstalata: Meniu > Premium > **"Am deja abonament — restaureaza"**.

Ecranul trebuie sa treaca pe starea de abonat fara sa se inchida.
Pe un cont FARA abonament, acelasi buton trebuie sa afiseze mesajul ca Play nu
gaseste niciun abonament activ (si sa nu ramana blocat pe "se lucreaza").

### 1.7 Lacatele dispar in clipa cumpararii
[Play] Fara sa inchizi si sa redeschizi aplicatia: cumpara abonamentul din
ecranul Premium.

- Ecranul Premium trebuie sa se **transforme pe loc** in starea de abonat (nu sa
  se inchida in tacere, cum facea inainte).
- Deschide Meniu: **stelutele de lacat** de pe randurile Premium (Prezentare,
  Contact sheet, Calatorii, Dosar privat, Recap lunar) trebuie sa fi disparut
  deja.
- Deschide o serie in Comparare grup: sugestia de combinare a doua cadre nu mai
  trebuie sa fie blocata.

### 1.8 Plata intrerupta nu ingheata butonul
[Play] Apasa "Aboneaza-te", iar cand se deschide foaia de plata a lui Google
Play **roteste telefonul** (sau trage in jos bara de notificari si comuta pe
alta aplicatie, apoi revino).

Butonul NU trebuie sa ramana blocat pe "Se deschide Google Play…" pentru
totdeauna. Trebuie sa redevina apasabil.

### 1.9 Prima pornire nu mai "pierde" abonamentul
[abonat] [Play] Inchide complet aplicatia (o scoti din recente) si redeschide-o
de cateva ori la rand, cu retea buna.

De fiecare data, dupa cateva secunde, aplicatia trebuie sa te trateze ca abonat
(fara lacate). Inainte, din cand in cand, la pornire cele doua intrebari puse
simultan catre Play se incurcau una pe alta si abonatul aparea ca neabonat, sau
pretul nu se incarca deloc (si atunci butonul de cumparare nici nu aparea).

---

## 2. Import si export

### 2.1 Bara de pregatire ajunge la capat si cand ai RAW-uri in lot
Importa un lot **mixt**: cateva JPEG si cateva RAW (CR2/NEF/ARW/DNG).

In faza de pregatire ("se pre-scaneaza"), contorul trebuie sa ajunga la
**N din N**, nu sa se opreasca la jumatate. Inainte, RAW-urile nu se numarau,
deci bara ramanea inghetata la ~50% pana pornea faza urmatoare.

### 2.2 Ultimul rand de poze nu mai intra sub bara de jos
Pe un telefon cu **bara de gesturi** (fara butoane fizice): importa destule poze
cat sa fie nevoie de derulare, apoi deruleaza pana la capatul de jos al grilei.

Ultimul rand de carduri trebuie sa fie **integral vizibil**, deasupra barei de
navigare a aplicatiei. Verifica si dupa **rotirea telefonului**, in ambele
orientari.

### 2.3 Sablonul de redenumire: token-urile chiar se inlocuiesc
Meniu > Operatii in masa > **Redenumire la export**. Citeste hint-ul si copiaza
de acolo, cuvant cu cuvant, `{client}_{locatie}_{secventa}`.

Exporta o selectie de 2-3 poze. Numele fisierelor exportate trebuie sa contina
valorile reale (sau gol, daca nu ai completat metadata proiectului) si
**secventa 001, 002** — nu textul literal `{locatie}` sau `{secventa}`.
Token-urile din hint sunt acum **fara diacritice**, exact fiindca varianta cu
diacritice nu era recunoscuta de motor.

### 2.4 Modul economic conteaza in timpul importului
Porneste un import mare (cateva sute de poze) si, **la mijlocul lui**, deschide
Meniu si activeaza **modul economic**.

Telefonul trebuie sa se linisteasca vizibil (mai putin cald, mai putina
incetinire) inca din lotul curent — nu abia la urmatorul import. Inainte,
setarea nu avea niciun efect pana la finalul lotului.

### 2.5 Importuri esuate nu mai umfla memoria
Importa de 2-3 ori la rand un folder care contine **fisiere corupte sau
neacceptate** (redenumeste cateva .txt in .jpg). Aplicatia trebuie sa le
raporteze ca esuate si sa continue. Dupa cele 3 incercari, aplicatia nu trebuie
sa devina vizibil mai lenta si nici sa se inchida singura.

---

## 3. Tema

### 3.1 "Automat" urmeaza telefonul, nu ceasul
Pune telefonul pe **tema intunecata permanenta** din setarile sistemului.
Deschide aplicatia **la o ora de zi** (intre 7:00 si 20:00).
Meniu > Aspect > Tema > **Automat**.

Aplicatia trebuie sa fie **intunecata**. Inainte iesea luminoasa, fiindca se uita
doar la ceas.

Contra-proba: pune telefonul pe tema luminoasa permanenta si deschide aplicatia
**seara**. Trebuie sa fie luminoasa.

Verifica si textul optiunii: sub "Automat" trebuie sa scrie ca urmeaza setarea
telefonului (si ca intervalul orar e doar rezerva). Daca inca scrie "dupa ora",
textul n-a fost actualizat.

### 3.2 Comuta in timp real, cu aplicatia deschisa
Cu tema pe **Automat** si aplicatia deschisa in fata ta, trage in jos bara de
notificari si comuta tema intunecata a telefonului.

Aplicatia trebuie sa comute **imediat**, nu dupa 15 minute.

### 3.3 Fara palpaire la pornire
Cu tema pe **Automat** si telefonul pe tema luminoasa: inchide complet aplicatia
si redeschide-o de 3-4 ori.

Nu trebuie sa vezi niciun cadru intunecat inainte sa apara interfata luminoasa
(si invers). Daca "clipeste", scriptul de pornire si logica din aplicatie au
iesit din sincron.

---

## 4. Meniuri, dropdown-uri si derulare

### 4.1 Meniurile nu mai raman agatate la rotire
Deschide un dropdown din randul de filtre (**Scena**, **Eticheta de culoare**,
**Aparat**, **Filtre salvate**) si, cu el deschis, **roteste telefonul**.

Meniul trebuie sa se **reaseze sub butonul lui**, nu sa ramana la coordonatele
vechi (uneori pe jumatate in afara ecranului). Si trebuie sa ramana **deschis** —
nu sa se inchida.

### 4.2 Acelasi lucru la derulare
Deschide acelasi dropdown si, fara sa-l inchizi, **deruleaza randul de filtre**
lateral (sau deruleaza pagina).

Meniul trebuie sa urmareasca butonul, nu sa pluteasca peste alt continut.

### 4.3 Tastatura virtuala
Deschide o poza, apasa iconita de **folder** din bara ei de actiuni (dropdown-ul
de colectii, care are un camp de text pentru un folder nou) si atinge campul, ca
sa apara tastatura.

Meniul trebuie sa se reaseze ca sa incapa, nu sa ramana pe jumatate sub
tastatura.

### 4.4 "Mai multe filtre" — click inauntru nu inchide nimic
Apasa pe **Mai multe filtre** (butonul cu trei puncte din randul de filtre).
Din interiorul panoului, deschide dropdown-ul de **Scena** si alege o eticheta.

Filtrul trebuie sa se aplice, iar panoul "Mai multe filtre" sa ramana deschis.
(Panoul si-a schimbat rolul de accesibilitate in sesiunea asta — daca acum se
inchide singur la fiecare alegere, e o regresie.)

### 4.5 Pagina din spate nu mai fuge cand un panou e deschis
Asta e cel mai vizibil pe telefon. Deruleaza grila pana pe la mijloc si tine
minte unde esti. Apoi deschide, pe rand, fiecare din: **Meniu**, **Statistici**,
**Persoane**, **Operatii in masa**, **Premium**, **Dosar privat**, **Foldere**,
**Duplicate**, **Sortare rapida**, **Prezentare**, ecranul de **Editare**.

Cu panoul deschis, **trage cu degetul pe voal** (zona intunecata din jur) si
**trage in continuare dupa ce continutul panoului a ajuns la capat**.

Grila din spate NU trebuie sa se miste. Iar la inchiderea panoului trebuie sa te
regasesti **exact unde erai** in grila.

Verifica in special: nu trebuie sa se declanseze **"trage ca sa reimprospatezi"**
al Android-ului (care reincarca aplicatia si pierde sesiunea de triaj).

### 4.6 Derularea in interiorul listelor nu mai "trece" in pagina
In filmstrip-ul din Workspace si in randul de filtre, trage lateral pana la capat
si continua sa tragi.

Nu trebuie sa se declanseze gestul de **"inapoi"** al sistemului si nici sa se
miste pagina de dedesubt.

---

## 5. Restaurare backup

### 5.1 Un backup bun se restaureaza ca inainte
Meniu > Backup > salveaza un backup. Goleste sesiunea. Meniu >
**Restaureaza din backup**.

Mesajul trebuie sa raporteze persoanele, profilurile AI si deciziile potrivite,
la fel ca inainte de sesiunea asta.

### 5.2 Un backup stricat nu mai omoara scorarea AI (cel mai important de aici)
Ia un fisier de backup si **strica-l intentionat** intr-un editor de text de pe
telefon sau de pe calculator: sterge campul `weights` dintr-una din intrarile
`contextModels`, si sterge `embeddings` dintr-una din `persons`. Salveaza.

Restaureaza acel fisier, apoi **importa cateva poze noi**.

- Restaurarea trebuie sa reuseasca, raportand mai putine persoane/profiluri decat
  are fisierul (intrarile stricate se sar).
- Importul trebuie sa scoreze pozele **normal** (scoruri diferite de la o poza la
  alta, badge-uri verzi/rosii/galbene).
- Aplicatia NU trebuie sa ramana cu scorarea moarta. Inainte, o singura intrare
  stricata ajunsa in baza de date rupea scorarea **permanent** — nici reload,
  nici reimport nu o mai reparau.

### 5.3 Presetarile de triaj supravietuiesc unui backup stricat
Dupa 5.2, incearca sa **salvezi o presetare noua** de triaj (Operatii in masa >
presetari). Trebuie sa se salveze. Inainte, o intrare partiala facea salvarea
oricarei presetari imposibila pentru tot restul sesiunii.

---

## 6. Tastatura si accesibilitate

Punctele cu tastatura au sens daca ai o tastatura Bluetooth pe telefon, sau
daca testezi si versiunea de desktop/web. Cele cu TalkBack se fac pe telefon.

### 6.1 Escape nu mai pierde selectia (tastatura)
Intra in modul selectie multipla si bifeaza 10-15 poze, una cate una. Deschide
un panou (ex. Statistici). Apasa **Escape** o data.

Trebuie sa se inchida **doar panoul**. Selectia de 15 poze trebuie sa fie inca
acolo. Abia al doilea Escape iese din modul selectie.

### 6.2 Scurtaturile de sistem nu mai decid poze (tastatura)
In Workspace sau in vizualizarea unei poze, apasa pe rand:
**Ctrl+X**, **Ctrl+P**, **Ctrl+1**.

Poza curenta NU trebuie sa fie respinsa / selectata / notata. Inainte, dialogul
nativ al browserului aparea in fata, iar in spatele lui poza fusese deja mutata
in alt teanc.

Contra-proba: **X**, **P**, **1** simple trebuie sa functioneze in continuare.

### 6.3 Paleta de comenzi cu Caps Lock (tastatura)
Activeaza **Caps Lock** si apasa **Ctrl+K**. Paleta trebuie sa se deschida
(inainte nu facea nimic, fara niciun semn).

In paleta, tine apasata **sageata jos** pana treci de a 7-a comanda. Lista
trebuie sa **deruleze** dupa evidentiere — nu sa ramana evidentiat ceva ce nu se
vede.

Scrie in campul de cautare pana raman 1-2 rezultate, apoi sterge textul. Enter
trebuie sa execute o comanda **evidentiata vizibil**, nu nimic.

### 6.4 Stelele de rating (tastatura)
Pe o poza deschisa, ajunge cu **Tab** pana la randul de stele.

- Trebuie sa fie o **singura oprire de Tab** pentru tot randul (nu cinci).
- **Sageata dreapta/stanga** schimba nota si muta evidentierea.
- Inca un **Tab** te scoate din randul de stele (nu te plimba prin ele).
- Cu focusul pe stele, sagetile NU trebuie sa mai schimbe si poza in acelasi
  timp.

### 6.5 Filele de informatii (tastatura)
Pe o poza deschisa, trage in sus foaia de jos (metrici/file). Ajunge cu Tab la
randul de file (**Metrici / …**). Sagetile trebuie sa schimbe fila.

### 6.6 TalkBack: iconitele nu mai vorbesc singure
Porneste **TalkBack**. Parcurge bara de sus si meniul.

Fiecare buton trebuie anuntat o **singura** data, cu numele lui ("Meniu, buton").
NU trebuie sa mai auzi "grafic" / "imagine" nedenumit lipit de fiecare buton.

Verifica in special ca **niciun buton nu a ramas fara nume** — daca auzi doar
"buton" fara nimic altceva, noteaza care.

### 6.7 TalkBack: ecranul de incarcare a modelelor nu mai vorbeste continuu
Porneste TalkBack si redeschide aplicatia astfel incat sa apara ecranul
"Se pregateste AI-ul".

Trebuie sa auzi mesajul **o data**. NU trebuie sa auzi "au trecut 6 secunde… au
trecut 7 secunde…" la nesfarsit.

### 6.8 TalkBack: operatiile lungi spun ca lucreaza
Cu TalkBack pornit:
- **Dosar privat**: introdu un PIN gresit. Trebuie sa **auzi** mesajul de eroare,
  nu doar sa-l vezi.
- **Acasa > sterge pozele respinse**: butonul trebuie sa spuna ca lucreaza (nu
  doar sa se stinga).
- **Duplicate > Pastreaza cea mai buna**: la fel; si butoanele **celorlalte**
  grupuri trebuie sa apara dezactivate cat timp unul e in lucru (inainte pareau
  active si nu faceau nimic la apasare).
- **Persoane > Inroleaza**: mesajul de rezultat ("adaugat" / "nu s-a detectat
  nicio fata") trebuie **auzit**.
- **Operatii in masa**: cat timp o operatie lunga ruleaza, trebuie anuntat o data
  ca se lucreaza.

### 6.9 TalkBack: Mod Zen
Meniu > Mod Zen. Randul principal ("Mod Zen") trebuie anuntat ca **un singur
comutator**, cu starea pornit/oprit — nu ca doua tinte suprapuse. Un tap pe el
(oriunde pe rand, inclusiv pe comutator) trebuie sa comute o singura data.

### 6.10 TalkBack: ecranul de bun venit
La prima pornire (sau dupa stergerea datelor), parcurge pasii cu "Inainte".
Fiecare pas nou trebuie **anuntat** ("pasul 2 din 4"). Punctele de progres nu
trebuie anuntate ca "lista de file goala".

### 6.11 Prezentarea porneste si cu "reducere miscare"
Activeaza in setarile telefonului **reducerea animatiilor / miscarii**.
[abonat sau fara cale de plata] Meniu > Prezentare.

Prezentarea trebuie sa **avanseze singura** (la ~5 secunde per poza). Inainte nu
pornea deloc, iar butonul de pauza ramanea pe ecran complet inert. Animatia de
zoom (Ken Burns) poate lipsi — asta e corect.

Butonul de **pauza** trebuie sa opreasca avansul.

### 6.12 Zoom pe poza cu tastatura
Pe o poza deschisa, ajunge cu Tab pe suprafata imaginii si apasa **Enter** sau
**Space**. Trebuie sa mareasca/micsoreze. Conturul de focus trebuie sa fie
**vizibil pe toate laturile** (e desenat in interior acum, fiindca in afara era
taiat).

---

## 7. Verificari scurte de regresie (nimic din ele n-ar trebui sa se fi schimbat)

Rapid, doar ca sa fim siguri ca nu s-a rupt ceva la mijloc:

- Triaj normal: deschizi o poza, **P** / **X** / swipe, treci la urmatoarea.
- **Escape** din vizualizarea unei poze o inchide (cand nu e nimic deschis peste).
- Filtrele din randul de sus (Toate / Selectate / Respinse / De verificat / Serii).
- Comparare serie (grup): se deschide, se alege un cadru.
- Sortare rapida (plin ecran): swipe in sus trece la urmatoarea.
- Golire sesiune, apoi import nou.
- Salvare backup, apoi restaurare pe acelasi telefon.

---

## Ce sa notezi daca gasesti ceva

Pentru fiecare problema: **ecranul**, **pasii exacti in ordine**, **ce ai vazut**
si **ce te asteptai sa vezi**. Daca s-a intamplat dupa o rotire, dupa o intrerupere
(apel, notificare), sau in timpul unui import — scrie si asta; jumatate din
defectele reparate in sesiunea asta se declansau exact asa.
