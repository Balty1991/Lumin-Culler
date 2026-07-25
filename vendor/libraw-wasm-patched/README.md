# libraw-wasm (rebuild pinning LibRaw 0.22.2)

Rebuild local al pachetului [`libraw-wasm`](https://github.com/ybouane/LibRaw-Wasm) (v1.6.0),
identic bit-cu-bit in interfata JS, dar cu libraria C++ subiacenta actualizata de la
LibRaw 0.22.1 (versiunea pinuita de pachetul npm oficial la data acestui rebuild) la
**LibRaw 0.22.2** — un release exclusiv de bugfix-uri, cu mai multe corectii de
parsare/verificare EOF ("Check for EOF in read loop", "zero all buffers before fread",
etc.), din aceeasi categorie ca eroarea raportata de utilizatori pe fisiere Nikon NEF
(`unknown file: Unexpected end of file` la `imageData()` — vezi
[LibRaw-Wasm#2](https://github.com/ybouane/LibRaw-Wasm/issues/2), inca deschisa la
1.6.0/LibRaw 0.22.1).

## De ce vendorizat, nu doar `npm install` dintr-o versiune noua

Nu exista o versiune noua PUBLICATA a pachetului `libraw-wasm` care sa pinuiasca
LibRaw 0.22.2 la data acestui rebuild — 1.6.0 (ultima de pe npm) inca pinuieste
0.22.1. Rebuild-ul foloseste exact acelasi `compileLibraw.sh` din upstream, cu
DOUA modificari minime:

1. Tag-ul clonat pentru LibRaw: `0.22.1` -> `0.22.2`.
2. Stage B (linking-ul `libraw_wrapper.cpp`) nu mai cere flag-urile Emscripten
   `USE_LIBPNG`/`USE_ZLIB` — nefolosite de `libraw_wrapper.cpp` (verificat: niciun
   apel PNG/zlib in wrapper), eliminate doar pentru ca fetch-ul portului lor
   Emscripten (`codeload.github.com`) nu era accesibil din mediul de build local;
   in CI-ul oficial (acces total la retea) ar fi functionat oricum neschimbat.

Niciun cod C++ propriu nu a fost scris — doar bump de versiune + rebuild.

## Cum se actualizeaza pe viitor

Cand pachetul npm oficial `libraw-wasm` publica o versiune care pinuieste LibRaw
>= 0.22.2 (sau mai nou), acest vendor devine inutil — revino la dependenta npm
normala (`"libraw-wasm": "^X.Y.Z"` in package.json, sterge acest folder si
sterge intrarea `overrides`/`file:` din package.json radacina).

## Verificare facuta la acest rebuild

Testat cu Playwright, in build de productie (servit dintr-un subpath, ca pe
GitHub Pages), decodare completa cu succes pentru:
- un fisier DNG lossy sintetic (acelasi caz care motivase fix-ul libjpeg din
  [LibRaw-Wasm#27](https://github.com/ybouane/LibRaw-Wasm/issues/27))
- `example-sony.ARW` (fixture-ul oficial de test al proiectului upstream)

Nu am putut testa direct cu un fisier Nikon NEF real (niciunul disponibil in
mediul de lucru) — utilizatorul care a raportat problema initiala trebuie sa
confirme daca fisierele lui specifice se decodeaza acum corect.
