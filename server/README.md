# Serverul de efecte AI Lumin (Cloudflare Worker)

Face legătura între aplicație și fal.ai pentru „Prinde viață” (poză → clip
de 5 s) și „Stiluri artistice”. Cheia fal.ai stă doar aici, niciodată în
aplicație. Pozele nu se salvează: trec direct spre fal.ai; serverul ține doar
adresele lucrării, 24 de ore. Rapoartele de conținut (cerute de Google Play
pentru aplicațiile cu AI generativ) se păstrează 90 de zile.

## Pornire, o singură dată (≈15 minute)

1. Cont gratuit la https://dash.cloudflare.com și la https://fal.ai
   (pe fal.ai: Billing → adaugi credit, apoi Keys → creezi o cheie).
2. Pe calculator, în folderul `server/`:
   ```
   npm install
   npx wrangler login
   npx wrangler kv namespace create LIMITS     # copiezi id-ul în wrangler.toml
   npx wrangler secret put FAL_KEY             # lipești cheia fal.ai
   npx wrangler deploy
   ```
   La final primești o adresă de forma `https://lumin-ai.<cont>.workers.dev`.
3. Adresa o pui în build-ul aplicației: în `android/gradle.properties`
   adaugi `luminAiUrl=https://lumin-ai.<cont>.workers.dev` (sau ca secret în
   GitHub Actions, vezi `release-android.yml`). Fără ea, efectele apar în
   aplicație ca „În curând” și nu se trimite nimic nicăieri.

## Costuri și limite

- `DAILY_BUDGET_USD` (în `wrangler.toml`, implicit 5 $) oprește toate
  lucrările noi după ce s-a cheltuit atât într-o zi.
- Fiecare instalare: cel mult 3 clipuri și 20 de stiluri pe zi (`logic.ts`).
  Creditele lunare (gratuit / Premium) le ține aplicația.
- Modelele se schimbă din `wrangler.toml` (`ALIVE_MODEL`, `STYLE_MODEL`),
  fără versiune nouă de aplicație. Verifică ID-ul exact și prețul pe pagina
  modelului de pe fal.ai înainte de lansare.

## Teste

`npx vitest run server/test` din rădăcina proiectului.
