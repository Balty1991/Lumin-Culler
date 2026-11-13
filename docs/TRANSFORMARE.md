# Jurnalul transformării Cherrypic

Evidența pas cu pas a transformării (planul din cercetarea din 13 nov. 2026). Fiecare pas are
data, ce s-a schimbat, cum s-a verificat și commitul. Se completează la fiecare livrare.

Legendă: ✅ gata și verificat · 🔄 în lucru · ⏳ urmează · ⚠️ decizie / risc deschis

## Etapa 1 — Licențe curate și siguranță

| # | Pas | Stare | Verificare | Commit |
| --- | --- | --- | --- | --- |
| 1.1 | Scorul estetic LAION (strat antrenat pe date cu licență neclară) înlocuit cu un scor din perechile CLIP-IQA (doar CLIP, MIT) | ✅ | 90 de poze COCO în CI: poza clară vs. estompată AUC 0,97 (LAION 0,89), normală vs. întunecată 0,89 (LAION 0,71). Ordinea pozelor bune diferă de LAION (Spearman 0,1) | (acest commit) |
| 1.2 | Greutățile LAION scoase din `clipLabels.json` | ✅ | testul verifică lipsa lor | (acest commit) |
| 1.3 | Pozele deja citite: scorul refăcut din amprenta CLIP salvată, o singură dată, apoi rescorare | ✅ | `aestheticMigrate.ts`, cheia `cp.mig.aesthetic1113` | — |
| 1.4 | Tabelul complet de licențe pentru motoarele descărcabile; mențiunea OPUS-MT (CC BY 4.0) în Setări | ✅ ⚠️ FER+ și MODNet rămân de confirmat | `docs/MODEL_LICENSES.md` | (acest commit) |
| 1.5 | Măsurători de siguranță: cât de des omul e de acord cu ce scoate AI-ul; poze cu oameni salvate de om. Afișate în ecranul AI; „decide tot” se oprește singur sub 85% sau când omul salvează poze cu oameni | ✅ | `safety.test.ts` | (acest commit) |
| 1.6 | Anulare și coș: existau deja (coșul sistemului Android, `createTrashRequest`, recuperabil 30 de zile; istoric de anulare) | ✅ | verificat în cod | — |
| 1.7 | „Cele mai frumoase” (amintiri, colaje, raport, anul, filme) ordonate și după gustul omului, când modelul lui e validat | ✅ | `beauty.test.ts` | (acest commit) |

## Etapa 2 — Redesign

| # | Pas | Stare |
| --- | --- | --- |
| 2.1 | Bară de navigare plutitoare, 4 file; cercul din mijloc: „Întreabă” cu sugestii | ⏳ |
| 2.2 | Setările în avatarul din antetul „Azi” | ⏳ |
| 2.3 | „Azi”: o carte principală, cel mult 3 secundare, starea „gata pentru azi” | ⏳ |
| 2.4 | Alegeri: anulare vizibilă, glisare în sus = „nu știu”, comparare două câte două, motive scurte | ⏳ |
| 2.5 | Editorul: reglajele de bază mereu vizibile | ⏳ |
| 2.6 | Primul rezultat util în sub un minut; pregătirea permisiunilor | ⏳ |

## Etapa 3 — Motorul de preferințe v2

| # | Pas | Stare |
| --- | --- | --- |
| 3.1 | Perechi din alegerile în serii (Bradley–Terry) | ⏳ |
| 3.2 | Validare pe evenimente lăsate deoparte + calibrare Platt | ⏳ |
| 3.3 | Prior global + capul personal | ⏳ |
| 3.4 | Pornire cu poze reprezentative, apoi dueluri | ⏳ |
| 3.5 | Model candidat rulat în umbră, promovat doar dacă se potrivește mai bine cu omul | ⏳ |

## Etapa 4 — Oameni, momente, revenire

| # | Pas | Stare |
| --- | --- | --- |
| 4.1 | Gruparea fețelor | ⏳ |
| 4.2 | „Cine e?” cu o singură întrebare | ⏳ |
| 4.3 | Widget | ⏳ |
| 4.4 | Bucla lunară pentru bunici | ⏳ |
| 4.5 | Filmul săptămânii | ⏳ |

## Etapa 5 — Căutare locală mai bună

| # | Pas | Stare |
| --- | --- | --- |
| 5.1 | SigLIP2, doar dacă licența e confirmată | ⏳ ⚠️ |
| 5.2 | Căutare semantică locală pe matrice fp16 | ⏳ |

## Etapa 6 — Explicații și rezumatul anului

| # | Pas | Stare |
| --- | --- | --- |
| 6.1 | Explicații cu un model vizual mic, descărcat la cerere, doar la încărcare | ⏳ |
| 6.2 | Rezumatul anului | ⏳ |

## Registru

- **13 nov.** Etapa 1 gata. Scorul nou prinde mai bine pozele stricate. Pentru „cea mai frumoasă” dintre pozele bune judecă altfel decât LAION, iar descrieri suplimentare (frumusețe, lumină, moment) nu au schimbat asta. De aceea ordinea de frumusețe folosește și gustul învățat al omului.
- **13 nov.** Pornit etapa 1. Comparația scorului vechi cu cel nou rulează în CI pe ~90 de poze COCO plus variante estompate și întunecate.
