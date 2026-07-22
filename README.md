# Lumin Culler Pro v2.0

Aplicatie profesionala de **sortare si alegere fotografii** (culling) pentru fotografi.
AI real (TensorFlow.js) ruleaza **100% local, in browser** — pozele nu parasesc niciodata dispozitivul.

## Ce face

- **Detectie AI reala a fetelor** (BlazeFace + Face Mesh 468 puncte): zambete, ochi deschisi/inchisi (EAR pe landmark-uri), calitatea fetei.
- **Recunoastere persoane cunoscute**: inrolezi familia (ex. Ami, sotia) cu cateva poze de referinta; AI-ul separa automat pozele cu cei dragi de cele cu straini (embeddings 1024-dim + similaritate cosinus).
- **1000+ poze fara blocare**: toata inferenta ruleaza in Web Workers (pool pe N-1 nuclee), imaginile se transfera zero-copy, miniaturile si metadatele stau in IndexedDB, nu in RAM.
- **Motor de invatare per context**: fiecare decizie manuala (Selecteaza/Respinge) antreneaza un model de regresie logistica online separat pe context (`portrait:known`, `landscape`, `group:mixed`...). Invata preferinte de tipul „portrete dramatice usor subexpuse, dar peisaje luminoase si clare".
- **Grupare serii/duplicate** (dHash perceptual): din rafale pastreaza propusa doar cea mai buna.
- **Export selectie**: JSON cu lista fisierelor alese, pentru importul in Lightroom/editor.

## Structura proiectului (ce urci in GitHub)

```
lumin-culler-pro/
├── .github/workflows/deploy.yml      # build + deploy automat (Actions)
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── capacitor.config.ts               # packaging Android (Capacitor)
├── android/                          # proiect nativ Android (generat, vezi mai jos)
├── src-tauri/                        # packaging Desktop (Tauri) — tauri.conf.json, Cargo.toml
└── src/
    ├── main.tsx                      # bootstrap React
    ├── App.tsx                       # shell UI (fara logica)
    ├── styles.css
    ├── vite-env.d.ts
    ├── state/
    │   └── store.ts                  # Zustand — starea, separata de UI
    ├── core/
    │   ├── db.ts                     # schema IndexedDB (Dexie)
    │   ├── workerPool.ts             # pool de Web Workers
    │   ├── importPipeline.ts         # decodare → analiza → scor → persistare
    │   └── learning/
    │       └── ContextEngine.ts      # ML activ: invata din corectii, per context
    ├── workers/
    │   └── faceAnalysis.worker.ts    # TF.js: fete, zambete, ochi, recunoastere
    └── ui/
        ├── PhotoCard.tsx
        ├── DetailView.tsx
        └── PersonsPanel.tsx
```

**NU urci:** `node_modules/`, `dist/`, `public/models/` — workflow-ul le genereaza singur la build.

## Instalare pe GitHub (pas cu pas, de pe Android)

1. **Creeaza repo nou** pe github.com (ex. `lumin-culler`), Public, fara README.
2. **Urca fisierele** pastrand structura de foldere de mai sus (Add file → Upload files,
   sau creeaza fiecare fisier cu Add file → Create new file, scriind calea completa
   ex. `src/core/db.ts` — editorul creeaza folderele automat).
3. **Activeaza Pages cu Actions**: Settings → Pages → Source: **GitHub Actions** (nu „Deploy from a branch"!).
4. La primul push pe `main`, tab-ul **Actions** porneste „Build & Deploy" (~2-3 min).
5. Aplicatia e live la `https://USERNAME.github.io/NUMELE-REPO/`.

Orice modificare ulterioara: editezi fisierul in web editor → Commit → Actions redeplioaza automat.

## Cum se foloseste

1. **Inroleaza persoanele cunoscute** (butonul ★ Persoane): nume + 2-4 poze clare, frontale
   pentru fiecare. Fa asta INAINTE de primul import mare.
2. **Alege fotografiile** (JPEG/PNG/WebP/AVIF). Progresul apare in timp real; UI-ul ramane fluid.
3. AI-ul propune automat: **verde = selectata** (scor ≥ 65), **rosu = respinsa** (≤ 35),
   **galben = de verificat**. Insigne pe carduri: ★ persoana cunoscuta, ? strain, ◑ ochi inchisi, ≡ serie.
4. **Deschide orice poza** → vezi metricile AI → decide cu **Selecteaza (P)** / **Respinge (X)**;
   pe desktop navighezi cu sagetile. Fiecare decizie antreneaza motorul pentru acel context.
5. **Exporta selectia** → JSON cu numele fisierelor alese.

## Limitari cunoscute

- **RAW (.CR3/.NEF/.ARW) nu se decodeaza in browser.** Foloseste JPEG-urile (shooting RAW+JPEG
  sau extrage preview-urile). Suport RAW vine odata cu impachetarea desktop (Tauri + librarie nativa).
- Prima incarcare descarca ~12 MB de modele ML (apoi sunt in cache).
- Recunoasterea are prag de similaritate 0.55 — daca apar confuzii, adauga mai multe
  poze de referinta per persoana (unghiuri/lumini diferite).

## Drumul spre Desktop si Mobil

Arhitectura e web-first cu logica separata de UI, deci impachetarea e deja pregatita in repo:
- **Desktop (Tauri)**: `src-tauri/` (identifier `com.luminculler.app`).
  `npm run tauri:dev` porneste Vite + fereastra nativa; `npm run tauri:build`
  produce instalatorul. Necesita toolchain Rust local sau in CI
  (`rustup` + `cargo`) — nu e inclus in acest repo.
- **Android (Capacitor)**: `capacitor.config.ts` + `android/` (appId
  `com.luminculler.app`). `npm run cap:sync` face build-ul web si sincronizeaza
  `dist/` in proiectul nativ; `npm run cap:android` deschide Android Studio.
  Necesita Android SDK local sau in CI.

Fisierele generate de build (`android/app/build`, `android/app/src/main/assets/public`,
`src-tauri/target`) sunt in `.gitignore` — nu se urca in repo, se regenereaza la fiecare build.
