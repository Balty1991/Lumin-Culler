#!/usr/bin/env node
/**
 * scripts/fetch-clip-model.mjs
 * Aduce modelul CLIP in build si scrie manifestul pe care il citeste aplicatia.
 *
 * Rulat de CI (unde exista retea), exact ca pasii care aduc modelele Human si
 * lista de localitati. Modelul NU se comite in git.
 *
 * NEFATAL CU BUNA STIINTA. Daca descarcarea esueaza — adresa mutata, HuggingFace
 * picat, retea taiata in CI — scriptul se opreste, NU scrie manifestul, si iese
 * cu 0. Aplicatia construita atunci e pur si simplu aplicatia de azi, fara
 * functia optionala. Alternativa (build rosu) ar insemna ca o functie
 * suplimentara poate opri livrarea a tot restul, ceea ce ar fi o prostie.
 *
 * IDENTITATEA MODELULUI se calculeaza din SHA-256-ul fisierului descarcat, nu
 * se scrie de mana. Consecinta: orice schimbare, oricat de mica, produce alt
 * `id`, iar vectorii calculati cu modelul vechi sunt recunoscuti automat ca
 * straini si ignorati la comparatie (vezi core/clip/clipVector.ts). Nimeni nu
 * trebuie sa-si aminteasca sa incrementeze ceva.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const recipe = JSON.parse(readFileSync(resolve(here, 'clip-model.json'), 'utf8'));
const outDir = resolve(here, '..', 'public', 'models', 'clip');

/** Iese fara eroare: lipsa modelului e o stare valida, nu un build stricat. */
function renunta(motiv) {
  console.warn(`[clip] Model NEadus: ${motiv}`);
  console.warn('[clip] Build-ul continua fara functia optionala de intelegere semantica.');
  process.exit(0);
}

const raspuns = await fetch(recipe.url).catch(err => renunta(`retea: ${err.message}`));
if (!raspuns?.ok) renunta(`HTTP ${raspuns?.status} pentru ${recipe.url}`);

const octeti = Buffer.from(await raspuns.arrayBuffer());

// `fetch` reuseste si cand primeste o pagina de eroare HTML in loc de model.
// Trei verificari ieftine care prind exact asta:
if (octeti.length < recipe.minBytes) renunta(`fisier prea mic (${octeti.length} octeti) — probabil o pagina de eroare`);
if (octeti.length > recipe.maxBytes) renunta(`fisier prea mare (${octeti.length} octeti) — nu e ce asteptam`);
// Un .onnx e un protobuf: primul camp (ir_version, varint) da octetul 0x08.
// Un HTML incepe cu '<'. Verificarea nu valideaza modelul, dar exclude sigur
// cazul in care am salvat o pagina web cu extensia .onnx.
if (octeti[0] !== 0x08) renunta(`nu arata a fisier ONNX (primul octet 0x${octeti[0].toString(16)})`);

const sha = createHash('sha256').update(octeti).digest('hex');
const manifest = {
  id: `${recipe.name}@${sha.slice(0, 12)}`,
  dim: recipe.dim,
  inputSize: recipe.inputSize,
  mean: recipe.mean,
  std: recipe.std,
  file: 'model.onnx',
  bytes: octeti.length
};

await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, 'model.onnx'), octeti);
// Manifestul se scrie ULTIMUL: cat timp lipseste, aplicatia considera ca nu
// exista model — deci un build intrerupt la mijloc nu lasa in urma un model
// pe jumatate scris pe care cineva sa incerce sa-l foloseasca.
await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const mb = (octeti.length / 1048576).toFixed(1);
console.log(`[clip] ${manifest.id} — ${mb} MB, ${manifest.dim} dimensiuni, intrare ${manifest.inputSize}px`);
console.log(`[clip] sha256 complet: ${sha}`);
await stat(resolve(outDir, 'model.onnx'));
