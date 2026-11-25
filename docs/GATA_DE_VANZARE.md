# Când e Cherrypic „versiunea pentru care plătesc oamenii”

Criterii verificabile, nu impresii. Bifate = verificate în CI sau pe telefon.

## Verificate automat (CI, la fiecare push)

- [x] Build-ul de release trece prin R8 cu regulile reale; ≥25% din cod redenumit (48% la 3.6.2).
- [x] Pe emulator (copie identică cu release-ul): pornește, primește poze, analizează fără să cadă.
- [x] Modelele native merg toate în release: fețe, etichete ML Kit, postură, decupare (autotest).
- [x] Turul ecranelor (scripts/smoke-tour.mjs): bun venit → pas 2 → motor AI → Azi → Curățenie →
      Studio, fără cădere sau ANR; capturile în ramura `ci-ecrane`.
- [x] Primul ecran: „Începe” vizibil fără derulare pe telefoanele obișnuite.
- [x] Căutarea „pisică/câine” măsurată pe COCO (scripts/species-eval): pisică lângă oameni 71%,
      pisică singură 91%, poze fără animal 0–1%.

## Se verifică pe telefon (omul, înainte de lansare)

- [ ] „pisică” / „câine” pe galeria reală, după un minut de reetichetare.
- [ ] Fețe, „Mai multe detalii”, decupare, portret, gumă.
- [ ] Oferta Pro: prețul apare, perioada de probă pornește, „Restabilește” merge.

## Se verifică în Play Console după lansare (2–3 săptămâni)

- [ ] Căderi < 1,09% și ANR < 0,47% (pragurile Play; ținta noastră: sub 0,5% / 0,3%).
- [ ] Retenție ziua 7 măsurată; conversie probă → plată măsurată.

Limita cunoscută a testului din CI: emulatorul fără placă video oprește randarea paginii după
câteva ecrane (capturi negre, apoi cade); de aceea Galeria e la finalul turului.
