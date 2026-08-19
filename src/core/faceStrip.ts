/**
 * core/faceStrip.ts
 *
 * "Cine are ochii inchisi?" — pe randuri, nu pe cadre.
 *
 * Cand compari o serie de portrete de grup, intrebarea nu e "care cadru e mai
 * bun" in general, ci "in care cadru iese BINE fiecare persoana". Cu cadrele
 * puse unul langa altul, ochiul trebuie sa caute aceeasi fata in fiecare poza,
 * la alta pozitie si alta marime de fiecare data — de aceea comparatia de grup
 * e obositoare si de aceea oamenii renunta si pastreaza tot.
 *
 * Modulul intoarce o matrice transpusa: cate un RAND per persoana, cu decupajul
 * fetei ei din fiecare cadru, in aceeasi ordine. Asa "Ana clipeste in cadrele 2
 * si 3" se citeste dintr-o privire, fara sa cauti nimic.
 *
 * IDENTIFICAREA aceleiasi persoane intre cadre merge in trei trepte, de la cea
 * mai sigura la cea mai slaba:
 *   1. `personId` — persoana e inrolata, deci stim exact cine e.
 *   2. embedding — aceeasi fata recunoscuta prin similitudine cosinus, chiar
 *      daca nu are nume.
 *   3. pozitie in cadru — ultima solutie, pentru fete fara embedding.
 * Treapta a treia poate gresi daca oamenii se muta mult intre cadre; de aceea e
 * marcata in rezultat (`match`) si interfata poate spune ce nivel de siguranta
 * are randul, in loc sa pretinda ca toate sunt la fel.
 *
 * Fara DOM si fara acces la imagini: doar aritmetica peste cutii si vectori.
 */

export interface StripFace {
  box: [number, number, number, number];
  isBlinking: boolean;
  smile: number;
  personId: string | null;
  personName: string | null;
  embedding?: number[];
}

export interface StripFrame {
  photoId: string;
  /** Eticheta cadrului asa cum o vede utilizatorul (1, 2, 3…). */
  label: string;
  faces: StripFace[];
}

export interface StripCell {
  photoId: string;
  label: string;
  /** Absent = persoana nu a fost gasita in acest cadru (a iesit din cadru, sau nu a fost detectata). */
  face?: StripFace;
}

export interface StripRow {
  /** Numele persoanei, cand e cunoscut. */
  personName: string | null;
  /** Cheia interna a randului — personId, sau un id sintetic pentru persoane nerecunoscute. */
  key: string;
  /** Cum au fost legate fetele intre cadre — vezi comentariul din capul fisierului. */
  match: 'person' | 'embedding' | 'position';
  cells: StripCell[];
  /** In cate cadre clipeste persoana asta. Ordoneaza randurile: problema sus. */
  blinkCount: number;
}

/** Peste acest prag, doua embedding-uri sunt considerate aceeasi persoana. Acelasi prag ca gruparea de fete. */
export const SAME_PERSON_SIMILARITY = 0.62;

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Centrul cutiei, in coordonate relative 0..1. */
function center(box: [number, number, number, number]): [number, number] {
  return [box[0] + box[2] / 2, box[1] + box[3] / 2];
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Peste atat, doua fete sunt prea departe una de alta ca sa fie aceeasi persoana care nu s-a miscat. */
export const MAX_POSITION_DRIFT = 0.18;

/**
 * Construieste fasia de comparatie pentru o serie.
 *
 * `frames` sunt cadrele in ordinea in care le vede utilizatorul. Primul cadru
 * da randurile: fiecare fata din el devine o persoana de urmarit. Fetele care
 * apar abia mai tarziu NU deschid randuri noi — ar produce randuri aproape
 * goale, cu o singura celula, care nu ajuta la nicio comparatie.
 */
export function buildFaceStrip(frames: StripFrame[]): StripRow[] {
  if (frames.length < 2) return [];
  const [first, ...rest] = frames;
  if (!first.faces.length) return [];

  const rows: StripRow[] = first.faces.map((face, i) => ({
    personName: face.personName,
    key: face.personId ?? `pos-${i}`,
    match: face.personId ? 'person' : (face.embedding?.length ? 'embedding' : 'position'),
    cells: [{ photoId: first.photoId, label: first.label, face }],
    blinkCount: face.isBlinking ? 1 : 0
  }));

  for (const frame of rest) {
    // O fata poate fi folosita o singura data per cadru: fara asta, doua
    // persoane asemanatoare (frati, gemeni) ar putea primi amandoua acelasi
    // decupaj, iar utilizatorul ar compara aceeasi fata cu ea insasi.
    const taken = new Set<number>();
    for (const row of rows) {
      const seed = row.cells[0].face!;
      let bestIdx = -1;
      let bestScore = -Infinity;
      let how: StripRow['match'] = 'position';

      // 1. persoana inrolata
      if (seed.personId) {
        bestIdx = frame.faces.findIndex((f, i) => !taken.has(i) && f.personId === seed.personId);
        if (bestIdx >= 0) how = 'person';
      }
      // 2. embedding
      // Bucle simple, nu forEach: analiza de flux a TypeScript nu urmareste
      // atribuirile facute intr-un callback, deci `how` ar ramane ingustat
      // gresit dupa blocul de mai sus.
      if (bestIdx < 0 && seed.embedding?.length) {
        for (let i = 0; i < frame.faces.length; i++) {
          const f = frame.faces[i];
          if (taken.has(i) || !f.embedding?.length) continue;
          const sim = cosine(seed.embedding, f.embedding);
          if (sim >= SAME_PERSON_SIMILARITY && sim > bestScore) { bestScore = sim; bestIdx = i; how = 'embedding'; }
        }
      }
      // 3. pozitie in cadru
      if (bestIdx < 0) {
        const seedCenter = center(seed.box);
        let bestDist = Infinity;
        for (let i = 0; i < frame.faces.length; i++) {
          if (taken.has(i)) continue;
          const d = distance(seedCenter, center(frame.faces[i].box));
          if (d <= MAX_POSITION_DRIFT && d < bestDist) { bestDist = d; bestIdx = i; how = 'position'; }
        }
      }

      if (bestIdx >= 0) {
        taken.add(bestIdx);
        const face = frame.faces[bestIdx];
        row.cells.push({ photoId: frame.photoId, label: frame.label, face });
        if (face.isBlinking) row.blinkCount++;
        // Randul e la fel de sigur ca cea mai SLABA legatura din el — o singura
        // potrivire pe pozitie face tot randul discutabil, si asta trebuie spus.
        if (how === 'position') row.match = 'position';
        else if (how === 'embedding' && row.match === 'person') row.match = 'embedding';
      } else {
        row.cells.push({ photoId: frame.photoId, label: frame.label });
      }
    }
  }

  // Problema sus: mai intai persoanele care clipesc in cele mai multe cadre,
  // apoi cele cu nume (mai usor de recunoscut), apoi ordinea din primul cadru.
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) =>
      b.row.blinkCount - a.row.blinkCount ||
      Number(Boolean(b.row.personName)) - Number(Boolean(a.row.personName)) ||
      a.i - b.i)
    .map(x => x.row);
}

/**
 * Cadrul in care persoana asta iese cel mai bine: nu clipeste si are cel mai
 * mare zambet. `null` daca in niciun cadru nu are ochii deschisi — caz in care
 * nu exista raspuns bun, si e mai cinstit sa nu propunem unul.
 */
export function bestFrameForRow(row: StripRow): string | null {
  const open = row.cells.filter(c => c.face && !c.face.isBlinking);
  if (!open.length) return null;
  return open.reduce((best, c) => (c.face!.smile > best.face!.smile ? c : best)).photoId;
}
