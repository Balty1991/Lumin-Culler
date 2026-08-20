/**
 * core/quickDuplicateScan.ts
 *
 * Cifra din primele zece secunde.
 *
 * Analiza AI e serioasa — patruzeci de semnale pe fiecare poza — dar pana se
 * termina, utilizatorul se uita la o bara de progres si nu primeste nimic.
 * Aplicatiile concurente ii spun "ai 340 de duplicate, 1,2 GB" in cateva
 * secunde. Momentul acela decide daca omul ramane.
 *
 * Modulul asta gaseste copiile IDENTICE fara sa decodeze nicio imagine:
 *
 *  1. Grupeaza dupa marimea in octeti. E gratuit — obiectele File poarta deja
 *     `size`, deci nu se citeste absolut nimic de pe disc. Pe o galerie fara
 *     duplicate, aici se si termina: fiecare fisier ramane singur in grupa lui.
 *  2. Doar pentru fisierele care IMPART o marime, citeste cate o felie mica de
 *     la inceput si de la sfarsit si o amprenteaza. Doua fisiere cu aceeasi
 *     marime la octet SI aceleasi felii sunt, practic sigur, acelasi fisier.
 *
 * De ce nu dHash: amprenta perceptuala cere decodarea imaginii la 2048px, adica
 * exact partea scumpa pe care incercam s-o ocolim. Aici nu ne intereseaza pozele
 * ASEMANATOARE (aia e treaba gruparii de serii, dupa analiza) — ci fisierul
 * acelasi, salvat de doua ori.
 *
 * NU inlocuieste core/exactDuplicates.ts, care lucreaza pe biblioteca deja
 * importata si e cel care chiar propune stergeri. Asta e doar promisiunea de la
 * inceput, facuta cat timp analiza abia porneste.
 */

/** Cati octeti citim de la fiecare capat al fisierului. Destul cat sa nu existe coincidente reale, putin cat sa nu coste. */
const SAMPLE_BYTES = 65536;

/** Sub atatea fisiere nu merita pornita: costul e mai mare decat ce afla. */
export const MIN_FILES_FOR_SCAN = 10;

export interface ScannableFile {
  name: string;
  size: number;
  slice(start: number, end: number): Blob;
}

export interface QuickScanResult {
  /** Cate fisiere sunt copii in plus (nu si originalul pastrat din fiecare grup). */
  duplicates: number;
  /** Cati octeti s-ar elibera scotandu-le. */
  wastedBytes: number;
  /** Cate grupuri de copii s-au gasit. */
  groups: number;
}

export const EMPTY_SCAN: QuickScanResult = { duplicates: 0, wastedBytes: 0, groups: 0 };

async function sampleDigest(file: ScannableFile): Promise<string | null> {
  try {
    const head = file.slice(0, Math.min(SAMPLE_BYTES, file.size));
    const tail = file.size > SAMPLE_BYTES
      ? file.slice(Math.max(0, file.size - SAMPLE_BYTES), file.size)
      : new Blob([]);
    const buf = await new Blob([head, tail]).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fisier ilizibil (permisiune retrasa, sters intre timp) sau crypto.subtle
    // indisponibil: il lasam necomparat, nu inventam o potrivire.
    return null;
  }
}

/**
 * Copiile identice din lotul care tocmai a fost ales.
 *
 * Nu arunca niciodata: pe orice problema intoarce ce a apucat sa afle. E o
 * informatie in plus data la inceput, nu un pas de care depinde importul.
 */
export async function quickDuplicateScan(files: ScannableFile[]): Promise<QuickScanResult> {
  if (files.length < MIN_FILES_FOR_SCAN) return EMPTY_SCAN;
  if (typeof crypto === 'undefined' || !crypto.subtle) return EMPTY_SCAN;

  // Pasul 1, gratuit: cine imparte o marime cu altcineva.
  const bySize = new Map<number, ScannableFile[]>();
  for (const f of files) {
    if (!f.size) continue;
    const list = bySize.get(f.size);
    if (list) list.push(f); else bySize.set(f.size, [f]);
  }

  let duplicates = 0, wastedBytes = 0, groups = 0;

  // Pasul 2, doar pe suspecti.
  for (const [size, candidates] of bySize) {
    if (candidates.length < 2) continue;
    const byDigest = new Map<string, number>();
    for (const f of candidates) {
      const digest = await sampleDigest(f);
      if (!digest) continue;
      byDigest.set(digest, (byDigest.get(digest) ?? 0) + 1);
    }
    for (const count of byDigest.values()) {
      if (count < 2) continue;
      groups++;
      duplicates += count - 1;
      wastedBytes += size * (count - 1);
    }
  }

  return { duplicates, wastedBytes, groups };
}
