/**
 * core/clip/clipManifest.ts
 * Cine e modelul CLIP prezent in build — sau daca e prezent vreunul.
 *
 * DE CE UN MANIFEST, si nu constante scrise in cod. Modelul nu se comite in
 * git (are zeci de MB, exact ca modelele Human si lista de localitati): il
 * aduce CI-ul la build. Deci codul NU are voie sa presupuna ca exista, si mai
 * ales n-are voie sa presupuna CARE e. Daca maine se schimba modelul din
 * workflow, singurul loc care trebuie sa stie asta e workflow-ul; aplicatia
 * citeste ce a fost pus efectiv langa ea.
 *
 * Consecinta importanta: fara manifest valid, functia pur si simplu nu exista.
 * Nu e o eroare, nu e un mesaj, nu e un ecran gol — restul aplicatiei merge
 * exact ca acum. Asta e si modul in care ruleaza aplicatia AZI, deci calea
 * "fara CLIP" e cea testata de fiecare zi de utilizare, nu o ramura teoretica.
 *
 * `id` E PARTEA CRITICA. El se scrie langa FIECARE vector produs (vezi
 * core/db.ts, tabela clipEmbeddings) si se verifica la fiecare comparatie
 * (clipVector.ts). Doi vectori din modele diferite traiesc in spatii diferite:
 * cosinusul dintre ei e un numar perfect valid si complet fara sens. E cel mai
 * urat fel de bug posibil aici — nimic nu crapa, doar toate raspunsurile devin
 * gresite, tacut. De-aia nu se compara nimic fara acelasi `id`.
 */

/** Ce scrie CI-ul in public/models/clip/manifest.json. */
export interface ClipManifest {
  /**
   * Identitatea EXACTA a modelului, inclusiv cuantizarea si revizia — ex.
   * "mobileclip_s0.image.q8@a1b2c3d". Se schimba ori de cate ori se schimba
   * ceva ce misca vectorii, oricat de putin.
   */
  id: string;
  /** Numarul de dimensiuni al vectorului de iesire. */
  dim: number;
  /** Latura imaginii de intrare, in pixeli (patrata). */
  inputSize: number;
  /** Media pe canal, in ordinea R,G,B, pe scara 0..1 — vine din preprocesarea modelului. */
  mean: [number, number, number];
  /** Deviatia standard pe canal, aceeasi ordine si scara. */
  std: [number, number, number];
  /** Fisierul .onnx, relativ la directorul manifestului. */
  file: string;
  /** Marimea lui in octeti — ca sa putem SPUNE cat descarcam inainte s-o facem. */
  bytes: number;
}

/**
 * Unde sta tot ce tine de CLIP.
 *
 * NU o cale absoluta, si e o greseala pe care am facut-o deja o data aici:
 * `/models/clip/` pare corect si merge in dezvoltare (unde aplicatia sta in
 * radacina), dar pe GitHub Pages site-ul e servit din `/Lumin-Culler/`, deci o
 * cale absoluta cauta la `balty1991.github.io/models/clip/` — adica nicaieri.
 * Modul de esec e cel mai inselator posibil: manifestul "lipseste", functia se
 * dezactiveaza singura exact cum e proiectata s-o faca, si totul pare in regula
 * desi fisierul chiar e livrat, doua directoare mai incolo.
 *
 * `import.meta.env.BASE_URL` e acelasi mecanism prin care core/workerPool.ts
 * calculeaza deja `modelBase` pentru modelele Human — motivul pentru care ELE
 * se incarca de ani de zile si pe Pages, si in Capacitor, si in dezvoltare.
 */
export const CLIP_BASE_PATH = `${import.meta.env.BASE_URL}models/clip/`;
export const CLIP_MANIFEST_URL = `${CLIP_BASE_PATH}manifest.json`;

/**
 * Aceeasi adresa, dar ABSOLUTA. Si asta e a doua jumatate a lectiei de mai sus,
 * platita separat.
 *
 * `base: './'` (necesar pe GitHub Pages) face ca BASE_URL sa fie `./` — o cale
 * RELATIVA. In firul principal se rezolva fata de pagina, deci merge. Dar
 * adresa modelului e folosita in WORKER, iar fisierul workerului sta in
 * `assets/` — deci acolo `./models/clip/model.onnx` inseamna
 * `assets/models/clip/model.onnx`, adica un 404, adica "modelul nu a pornit".
 *
 * `new URL(..., location.href)` e chiar tiparul pe care core/workerPool.ts il
 * foloseste de ani de zile ca sa dea modelele Human workerilor lui. Prima data
 * am luat din el doar jumatate — BASE_URL, fara absolutizare — si exact
 * jumatatea lipsa a rupt functia.
 */
export function absoluteClipUrl(relative: string): string {
  return new URL(relative, location.href).href;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isTriplet(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

/**
 * Verifica un manifest venit de pe disc. Strict cu buna stiinta: un manifest
 * incomplet inseamna un build in care ceva a mers prost la descarcare, iar a
 * merge mai departe cu jumatate din el ar produce vectori gresiti in loc de
 * nicio functie. Mai bine lipseste de tot.
 */
export function parseClipManifest(raw: unknown): ClipManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || m.id.length === 0) return null;
  if (typeof m.file !== 'string' || m.file.length === 0) return null;
  // Dimensiunile trebuie sa fie intregi pozitivi: un `dim` de 0 sau fractionar
  // ar trece de o verificare lenesa si ar rupe abia la prima inferenta.
  if (!isFiniteNumber(m.dim) || m.dim <= 0 || !Number.isInteger(m.dim)) return null;
  if (!isFiniteNumber(m.inputSize) || m.inputSize <= 0 || !Number.isInteger(m.inputSize)) return null;
  if (!isFiniteNumber(m.bytes) || m.bytes <= 0) return null;
  if (!isTriplet(m.mean) || !isTriplet(m.std)) return null;
  // O deviatie standard de 0 ar da impartire la zero in preprocesare — adica
  // Infinity in tensor, si un vector de NaN-uri la iesire.
  if (m.std.some(s => s === 0)) return null;
  return {
    id: m.id, dim: m.dim, inputSize: m.inputSize,
    mean: m.mean, std: m.std, file: m.file, bytes: m.bytes
  };
}

/**
 * Citeste manifestul din build. `null` = nu exista model in acest build, si e
 * o stare normala, nu o eroare de raportat nicaieri.
 */
export async function readClipManifest(
  fetchImpl: typeof fetch = fetch
): Promise<ClipManifest | null> {
  try {
    const res = await fetchImpl(CLIP_MANIFEST_URL);
    if (!res.ok) return null;
    return parseClipManifest(await res.json());
  } catch {
    // Fisier absent, JSON stricat, retea taiata la prima pornire — toate
    // inseamna acelasi lucru pentru utilizator: functia nu e disponibila.
    return null;
  }
}

/**
 * Adresa fisierului .onnx, ABSOLUTA — fiindca cine o foloseste e workerul, iar
 * el traieste in alt director decat pagina. Vezi absoluteClipUrl.
 */
export function clipModelUrl(manifest: ClipManifest): string {
  return absoluteClipUrl(`${CLIP_BASE_PATH}${manifest.file}`);
}
