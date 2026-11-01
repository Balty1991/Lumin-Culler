# Asistentul AI: de ce se oprea, și ce am schimbat

## Ce s-a întâmplat

Contul Cloudflare Workers AI gratuit are **10.000 de neuroni pe zi** (se reface la 00:00 UTC). Un apel „Auto AI” trimitea o poză la un model de vedere și, dacă limba nu era engleza, încă un apel de traducere. După aproximativ **două editări** (plus ce mai cerea aplicația în fundal: povești, supraveghere) cota se termina și serverul răspundea `budget`. Butonul părea stricat.

Nu e un bug de rețea. E plafonul planului gratuit.

## Ce face aplicația acum

1. **Corecția stă pe telefon** (`src/core/autoLook.ts`). „Mai frumoasă” și „Auto AI” au rezultat și fără rețea, și după ce s-a terminat cota. Poza nu pleacă nicăieri.
2. **Cerul nou și guma** încearcă serverul, apoi desenează pe telefon un cer (gradient) sau umplu zona ștearsă cu pixelii din jur (`fillMasked`). Omul nu rămâne cu un ecran mort.
3. **Serverul**, dacă răspunde, e un plus. Ordinea e `AI_PROVIDERS` (implicit `workers,gemini`):
   - rezultatul unei poze identice se ține 24 h în KV, ca să nu se plătească de două ori;
   - imaginea pleacă la 384 px, JPEG ~0,72, nu 512 px;
   - modelele mici sunt primele (LLaVA 7B, Llama 8B). 70B și Llama Vision 11B sunt doar rezervă;
   - dacă Workers răspunde „cotă”, se încearcă Gemini, dacă există `GEMINI_API_KEY`.
4. Limita gratuită din aplicație (`FREE_DAILY` în `src/lumin/cloud.ts`) e separată de cota Cloudflare. Premium sare peste limita din aplicație. **Cota contului Cloudflare rămâne comună pentru toți utilizatorii** până când se trece pe un plan plătit sau pe Gemini cu cheie proprie.

Cheile nu stau în repo. Se pun așa:

```bash
cd server
npx wrangler secret put GEMINI_API_KEY
# opțional, în wrangler.toml, fără secret:
# AI_PROVIDERS = "gemini,workers"
# GEMINI_MODEL = "gemini-2.5-flash"
```

## Comparație

Prețurile de mai jos sunt **ordine de mărime, de verificat în consola fiecărui furnizor** în ziua în care se plătește. Nu am putut factura nimic din agentul ăsta. Cifra „~2 editări / 10.000 neuroni” e ce s-a văzut pe contul gratuit, deci un apel de vedere + traducere poate costa mii de neuroni.

| Variantă | Calitate pentru retuș | Fiabilitate | Latență | Confidențialitate | Cost orientativ / 1.000 editări | Cont de făcut |
|---|---|---|---|---|---|---|
| Pe telefon (autoLook) | Bună la lumină, culoare, ceață, cer, portret, ochi roșii. Nu generează un cer fotorealistic din nimic. | Mereu, și offline | Zeci de ms | Poza nu pleacă | 0 | Nimic |
| Cloudflare Workers AI, gratuit | Model de vedere bun, dar se oprește | Moare după ~2 editări pe zi, pe tot contul | 2–15 s | JPEG 384 px ajunge la Cloudflare. Nu e folosit la antrenare, după documentația lor | 0 până se termină cei 10.000 neuroni/zi | Contul existent |
| Cloudflare Workers AI, plătit | La fel | Ține cât plătești | 2–15 s | La fel | Dacă un edit e ~5.000 neuroni și tariful public rămâne ~0,011 USD / 1.000 neuroni, 1.000 editări ≈ **50 USD**. Verifică tariful modelului în dashboard: neuroni/apel diferă | Același cont, card |
| Google Gemini 2.5 Flash | Vedere bună, ieftină, răspuns JSON | Tier gratuit în AI Studio, apoi plătit. Se schimbă | 1–4 s | JPEG-ul ajunge la Google | De obicei **sub 1–2 USD** / 1.000 apeluri scurte cu o poză mică. Cifra exactă e în AI Studio | Cheie `GEMINI_API_KEY` |
| fal.ai (deja legat) | Generare (stil, video, inpaint), nu reglaje | Bun dacă există credit | secunde | Poza ajunge la fal | Stil ~0,05 USD, clip ~0,45 USD (vezi `COST_USD`) | Cheie `FAL_KEY` + credit |
| Replicate, Together, OpenRouter, Stability, Clipdrop | Unele generează bine | Încă un furnizor, încă o cheie | variabil | Poza pleacă la ei | De la câțiva USD la zeci / 1.000, după model | Nu le-am legat |

## Recomandare

**Lasă corecția pe telefon.** Asta e produsul pentru care merită abonamentul împreună cu stilurile (portret, film, alb-negru) și cu textele online.

Pentru rafinarea online, **Gemini Flash** e varianta bună: mai ieftin și mai previzibil decât neuronii Workers. Workers rămâne rezervă, ca aplicația deja instalată să nu depindă de o cheie nouă.

Planul plătit Cloudflare merită doar dacă vrei să rămâi pe un singur furnizor și accepți zeci de dolari la fiecare mie de editări online. Nu îl porni „să meargă butonul”: butonul merge și fără el.

Generarea unui cer fotorealistic sau a unui clip tot are nevoie de un model generativ (fal.ai sau Gemini, când au inpaint). Fără cheie, telefonul pune un cer pictat sau umple zona ștearsă. E onest, nu e o poză nouă de la un model.

## Ce trebuie făcut de mână

1. Nimic, dacă e de ajuns corecția pe telefon.
2. Pentru rafinare online: cheie Gemini în `GEMINI_API_KEY` pe worker, apoi `npx wrangler deploy` din `server/`.
3. Pentru stiluri și clipuri: credit fal.ai și `FAL_KEY`, cum scrie `server/README.md`.
4. Nu pune cheile în git.
