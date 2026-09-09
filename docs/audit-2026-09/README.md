# Auditul de dinaintea lansării — septembrie 2026

Două audituri rulate în paralel peste noaptea de 8 spre 9 septembrie 2026, cu
trei săptămâni înainte de lansarea țintită.

- **`utilizare.md`** — aplicația folosită cap-coadă ca trei oameni diferiți (un
  părinte cu 800 de poze după vacanță, un fotograf de nuntă care predă o
  selecție, cineva care vrea doar spațiu liber). 109 capturi, 37 de scripturi
  Playwright, 19 secțiuni. Bug-uri cu pași de reproducere, momente de confuzie,
  fundături, accesibilitate măsurată, și răspunsul direct la „aș plăti?".
- **`motoare-si-functii.md`** — fiecare funcție și fiecare motor, cu alternative
  căutate în documentația curentă. Aici stau măsurătorile pe care se sprijină
  restul: 2,46 s/poză, defalcarea pe cele șapte modele, paralelismul efectiv de
  1,4 și cauza lui.

Lista de acțiune, ordonată și cu bifă pe fiecare item, e o pagină separată:
https://claude.ai/code/artifact/461bbe10-f950-450d-ac6f-e996f910e45e

## Cum se citesc

Fiecare afirmație e marcată cu felul în care e cunoscută: **[V]** văzut rulând,
**[M]** măsurat, **[C]** citit din cod, **[D]** sursă documentată, **[?]**
presupus. Marcajele nu sunt decor — sunt singurul lucru care distinge o
constatare de o părere, iar rapoartele au și una, și alta.

## Ce NU e adevărat în ele

Trei afirmații au picat la verificare și rămân în text neatinse, ca să nu se
piardă contextul. Nu le reintroduce:

1. **XMP-ul care „exportă tot" nu e un bug.** E intenționat, documentat în cod,
   și e comportamentul corect pentru Lightroom — vrei și respinsele marcate ca
   respinse. Greșită e doar eticheta din interfață.
2. **Commit-ul care a scos detectorul duplicat nu e o regresie.** Raportul spune
   că a mutat calculele pe firul aglomerat al Capacitor. Codul vechi le rula
   într-un `addOnSuccessListener` fără executor, adică pe firul PRINCIPAL, cu
   WebView-ul cu tot. S-au mutat de pe firul de interfață, nu pe el.
3. **Cei 8,7 MB de modele nu sunt „livrați degeaba".** Versiunea web îi
   folosește la analiza normală. Corectarea `ensureEnrollmentSlot()` deschide
   posibilitatea excluderii lor din pachetul Android — nu o face singură.

## Ce n-a fost verificat

Niciun flux cu fețe (nu se pot genera fețe de test), niciun flux cu bani (pe web
nu există billing), scara reală (20 de poze, nu 800), telefonul real, și vreo
douăsprezece panouri secundare. Secțiunea 18 din `utilizare.md` le enumeră.
