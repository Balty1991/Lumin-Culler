#!/usr/bin/env node
/**
 * scripts/fetch-clip-model.mjs
 * Aduce variantele modelului CLIP in build si scrie manifestul pe care il
 * citeste aplicatia.
 *
 * Rulat de CI (unde exista retea), exact ca pasii care aduc modelele Human si
 * lista de localitati. Modelele NU se comit in git.
 *
 * NEFATAL PE DOUA NIVELURI:
 *  - o varianta care nu se poate aduce e sarita, si build-ul continua cu
 *    celelalte;
 *  - daca NICIUNA nu se poate aduce, nu se scrie manifestul si scriptul iese cu
 *    0. Aplicatia construita atunci e pur si simplu aplicatia de azi, fara
 *    functia optionala. O functie in plus n-are voie sa opreasca livrarea a tot
 *    restul.
 *
 * DE CE MAI MULTE VARIANTE. Prima masuratoare pe telefon real a dat 1404 ms pe
 * poza cu modelul cuantizat pe 8 biti, pe WebGPU — de zeci de ori mai lent
 * decat ar trebui. Explicatia probabila e ca un model cuantizat e facut pentru
 * procesor, iar backend-ul WebGPU nu-i cunoaste o parte din operatii si le
 * trimite inapoi pe CPU. Dar "probabil" nu e o cifra: se aduc amandoua
 * variantele si le masoara utilizatorul, pe telefonul lui.
 *
 * IDENTITATEA fiecarei variante se calculeaza din SHA-256-ul fisierului, nu se
 * scrie de mana: orice schimbare produce alt `id`, iar vectorii vechi devin
 * recunoscut-straini la comparatie (vezi core/clip/clipVector.ts).
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const reteta = JSON.parse(readFileSync(resolve(here, 'clip-model.json'), 'utf8'));
const outDir = resolve(here, '..', 'public', 'models', 'clip');

/**
 * Verifica preprocesarea declarata in reteta fata de fisa publicata langa model.
 * Numere gresite aici nu dau eroare la rulare — dau vectori plauzibili si
 * complet gresiti (vezi core/clip/clipPreprocess.ts).
 */
async function verificaPreprocesarea(v) {
  if (!v.preprocessorUrl) return { verificat: false, motiv: 'fara fisa in reteta' };
  let fisa;
  try {
    const r = await fetch(v.preprocessorUrl);
    if (!r.ok) return { verificat: false, motiv: `HTTP ${r.status} la fisa` };
    fisa = await r.json();
  } catch (err) {
    return { verificat: false, motiv: `retea: ${err.message}` };
  }
  const aproape = (a, b) => Math.abs(a - b) < 1e-3;
  const nepotriviri = [];
  // `do_normalize: false` = pixelii doar scalati la 0..1, adica media 0 si deviatia 1.
  const normalizeaza = fisa.do_normalize !== false;
  const meanAsteptat = normalizeaza && Array.isArray(fisa.image_mean) ? fisa.image_mean : [0, 0, 0];
  const stdAsteptat = normalizeaza && Array.isArray(fisa.image_std) ? fisa.image_std : [1, 1, 1];
  for (let i = 0; i < 3; i++) {
    if (!aproape(v.mean[i], meanAsteptat[i])) nepotriviri.push(`mean[${i}]: reteta ${v.mean[i]}, model ${meanAsteptat[i]}`);
    if (!aproape(v.std[i], stdAsteptat[i])) nepotriviri.push(`std[${i}]: reteta ${v.std[i]}, model ${stdAsteptat[i]}`);
  }
  const latura = fisa.crop_size?.height ?? fisa.crop_size ?? fisa.size?.shortest_edge ?? fisa.size?.height;
  if (typeof latura === 'number' && latura !== v.inputSize) {
    nepotriviri.push(`inputSize: reteta ${v.inputSize}, model ${latura}`);
  }
  return { verificat: true, nepotriviri };
}

/** Aduce o varianta. `null` cand nu se poate — si atunci se trece la urmatoarea. */
async function aduVarianta(v, index) {
  const sari = motiv => { console.warn(`[clip] "${v.name}" SARIT: ${motiv}`); return null; };

  let raspuns;
  try {
    raspuns = await fetch(v.url);
  } catch (err) {
    return sari(`retea: ${err.message}`);
  }
  if (!raspuns.ok) return sari(`HTTP ${raspuns.status}`);

  const octeti = Buffer.from(await raspuns.arrayBuffer());
  // `fetch` reuseste si cand primeste o pagina de eroare HTML in loc de model.
  if (octeti.length < v.minBytes) return sari(`prea mic (${octeti.length} octeti) — probabil o pagina de eroare`);
  if (octeti.length > v.maxBytes) return sari(`prea mare (${octeti.length} octeti)`);
  // Un .onnx e protobuf: primul camp (ir_version, varint) da octetul 0x08. Un HTML incepe cu '<'.
  if (octeti[0] !== 0x08) return sari(`nu arata a ONNX (primul octet 0x${octeti[0].toString(16)})`);

  const pre = await verificaPreprocesarea(v);
  if (pre.verificat && pre.nepotriviri.length) {
    for (const n of pre.nepotriviri) console.error(`[clip]   ${n}`);
    return sari('preprocesarea nu se potriveste cu fisa modelului — ar da vectori plauzibili si gresiti');
  }
  if (!pre.verificat) console.warn(`[clip] "${v.name}": preprocesare NEVERIFICATA (${pre.motiv})`);

  const sha = createHash('sha256').update(octeti).digest('hex');
  const file = `model-${index}.onnx`;
  await writeFile(resolve(outDir, file), octeti);
  console.log(`[clip] ${v.name}@${sha.slice(0, 12)} — ${(octeti.length / 1048576).toFixed(1)} MB${pre.verificat ? ', preprocesare confirmata' : ''}`);
  return {
    id: `${v.name}@${sha.slice(0, 12)}`,
    label: v.eticheta ?? v.name,
    dim: v.dim, inputSize: v.inputSize, mean: v.mean, std: v.std,
    file, bytes: octeti.length
  };
}

await mkdir(outDir, { recursive: true });
const variante = [];
for (const [i, v] of reteta.variants.entries()) {
  const rezultat = await aduVarianta(v, i);
  if (rezultat) variante.push(rezultat);
}

if (variante.length === 0) {
  console.warn('[clip] Nicio varianta adusa. Build-ul continua fara functia optionala.');
  process.exit(0);
}

// Manifestul se scrie ULTIMUL: cat timp lipseste, aplicatia considera ca nu
// exista model, deci un build intrerupt la mijloc nu lasa in urma ceva folosibil pe jumatate.
await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify({ variants: variante }, null, 2));
console.log(`[clip] ${variante.length} varianta(e) in manifest.`);
