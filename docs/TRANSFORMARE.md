# Jurnalul transformării Cherrypic

Evidența pas cu pas a transformării (planul din cercetarea din 13 nov. 2026). Fiecare pas are
data, ce s-a schimbat, cum s-a verificat și commitul. Se completează la fiecare livrare.

Legendă: ✅ gata și verificat · 🔄 în lucru · ⏳ urmează · ⏸️ amânat, cu motiv · ⚠️ decizie / risc deschis

## Etapa 1 — Licențe curate și siguranță

| # | Pas | Stare | Verificare | Commit |
| --- | --- | --- | --- | --- |
| 1.1 | Scorul estetic LAION (strat antrenat pe date cu licență neclară) înlocuit cu un scor din perechile CLIP-IQA (doar CLIP, MIT) | ✅ | 90 de poze COCO în CI: poza clară vs. estompată AUC 0,97 (LAION 0,89), normală vs. întunecată 0,89 (LAION 0,71). Ordinea pozelor bune diferă de LAION (Spearman 0,1) | (acest commit) |
| 1.2 | Greutățile LAION scoase din `clipLabels.json` | ✅ | testul verifică lipsa lor | (acest commit) |
| 1.3 | Pozele deja citite: scorul refăcut din amprenta CLIP salvată, o singură dată, apoi rescorare | ✅ | `aestheticMigrate.ts`, cheia `cp.mig.aesthetic1113` | — |
| 1.4 | Tabelul complet de licențe pentru motoarele descărcabile; mențiunea OPUS-MT (CC BY 4.0) în Setări | ✅ FER+ (MIT) și MODNet (Apache 2.0) verificate la sursă pe 13 nov. | `docs/MODEL_LICENSES.md` | (acest commit) |
| 1.5 | Măsurători de siguranță: cât de des omul e de acord cu ce scoate AI-ul; poze cu oameni salvate de om. Afișate în ecranul AI; „decide tot” se oprește singur sub 85% sau când omul salvează poze cu oameni | ✅ | `safety.test.ts` | (acest commit) |
| 1.6 | Anulare și coș: existau deja (coșul sistemului Android, `createTrashRequest`, recuperabil 30 de zile; istoric de anulare) | ✅ | verificat în cod | — |
| 1.8 | Ecranul „Licențe” în Setări: modelele AI, bibliotecile Android și cele 73 de biblioteci JavaScript (lista generată la fiecare build), cu textul licențelor. Cerut de MIT / Apache / BSD / CC BY | ✅ captură | (acest commit) |
| 1.7 | „Cele mai frumoase” (amintiri, colaje, raport, anul, filme) ordonate și după gustul omului, când modelul lui e validat | ✅ | `beauty.test.ts` | (acest commit) |

## Etapa 2 — Redesign

| # | Pas | Stare |
| --- | --- | --- |
| 2.1 | Bară de navigare plutitoare, 4 file; cercul din mijloc: „Întreabă” cu sugestii | ✅ exista deja (verificat pe capturi) |
| 2.2 | Setările în antetul „Azi” | ✅ exista deja: rotița din colț |
| 2.3 | „Azi”: o carte principală, cel mult 3 secundare | ✅ exista deja (capturi: o carte principală + 2) |
| 2.4 | Alegeri: glisare în sus = „Mai târziu”; „Compară” două cadre din serie (perechile se salvează pentru etapa 3). Anularea și motivele existau | ✅ test `SwipeSort.compare.test.tsx`, captură |
| 2.5 | Editorul: reglajele de bază mereu vizibile | ⏳ |
| 2.6 | Primul rezultat util în sub un minut; pregătirea permisiunilor | ⏳ |

## Etapa 3 — Motorul de preferințe v2

| # | Pas | Stare |
| --- | --- | --- |
| 3.1 | Perechi „asta, nu aia” (Bradley–Terry), învățate cu aceleași greutăți ca pozele păstrate/scoase | ✅ test |
| 3.2 | Validare pe zile lăsate deoparte (testul dovedește că nu mai e păcălită de poze aproape identice) + calibrare Platt | ✅ test |
| 3.3 | Prior: cu puține exemple, părerea e trasă spre scorul general (la 30 de exemple jumătate-jumătate) | ✅ test |
| 3.4 | Antrenament cu poze tipice (TypiClust pe CLIP), apoi compararea din alegeri | ✅ test |
| 3.1b | Perechi implicite din serii: în aceeași rafală, poza păstrată de om față de cea scoasă de om (fără să apese „Compară”) | ✅ test |
| 3.5 | Modelul nou în umbră: îl înlocuiește pe cel vechi doar dacă ghicește zilele nevăzute cel puțin la fel de bine (v1, testat fără grupuri, e înlocuit) | ✅ test |

## Etapa 4 — Oameni, momente, revenire

| # | Pas | Stare |
| --- | --- | --- |
| 4.1 | Gruparea fețelor | ✅ exista (`faceIdentity.ts`, SFace, Apache 2.0, verificat și păstrat) |
| 4.2 | „Cine e?” cu o singură întrebare | ✅ exista (`WhoIsThis.tsx`) |
| 4.3 | Widget | ✅ existau două, cu fixare pe ecranul principal |
| 4.4 | Bucla lunară pentru bunici | ✅ exista („Luna noastră”) |
| 4.5 | Filmul săptămânii | ✅ exista (povestea „cele mai bune din săptămână”, film din ea) |

## Etapa 5 — Căutare locală mai bună

| # | Pas | Stare |
| --- | --- | --- |
| 5.1 | SigLIP2 | ⏸️ amânat: înseamnă un model nou (~400 MB), refacerea amprentelor pentru toată galeria și recalibrarea etichetelor, a calității și a căutării. Merită doar după o comparație pe telefon real |
| 5.2 | Căutare: toate amprentele într-o singură matrice Float32, refăcută doar când se schimbă numărul de poze | ✅ test |

## Etapa 6 — Explicații și rezumatul anului

| # | Pas | Stare |
| --- | --- | --- |
| 6.1 | Explicații cu un model vizual mic | ⏸️ amânat: Florence-2 descrie deja pozele; un model ca SmolVLM2 / Gemma 3n înseamnă 0,5–3 GB și trebuie măsurat întâi pe telefon |
| 6.2 | Rezumatul anului | ✅ exista (`yearBook`, `yearStats`, `EmotionYear`) |

## Registru

- **13 nov.** FER+ (MIT) și MODNet (Apache 2.0) verificate la sursă: rămân.
- **13 nov.** Licențe verificate la sursă. SFace: Apache 2.0, păstrat. Zero-DCE: doar necomercial, scos și înlocuit cu SCI (MIT), scris direct în Kotlin și testat față de modelul original.
- **13 nov.** Etapele 4–6 verificate: cea mai mare parte exista deja. Nou: căutarea pe matrice. Găsit: SFace și Zero-DCE sunt în APK-ul de Play cu licență neclară (decizie pentru proprietar).
- **13 nov.** Etapa 3 gata: motorul de preferințe v2. Efect așteptat: procentul „ghicesc X%” poate scădea puțin, pentru că acum e măsurat cinstit, pe zile nevăzute.
- **13 nov.** Build #835 (etapa 1) verde. Etapa 2: alegerile primesc glisarea în sus și compararea.
- **13 nov.** Etapa 1 gata. Scorul nou prinde mai bine pozele stricate. Pentru „cea mai frumoasă” dintre pozele bune judecă altfel decât LAION, iar descrieri suplimentare (frumusețe, lumină, moment) nu au schimbat asta. De aceea ordinea de frumusețe folosește și gustul învățat al omului.
- **13 nov.** Pornit etapa 1. Comparația scorului vechi cu cel nou rulează în CI pe ~90 de poze COCO plus variante estompate și întunecate.
