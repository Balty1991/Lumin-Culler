import type { AnalysisRecord, FaceInsight } from './db';

/**
 * core/photoAnchors.ts
 * Ancorele de pe fotografie: motorul arata UNDE anume a masurat.
 *
 * Redesign "Camera obscura", faza 2. Pana acum, tot ce aflase analiza despre o
 * poza ajungea la om ca text intr-o foaie: "zambet 0,81", "ochi deschisi". Cifra
 * era corecta, dar plutea — nu spunea pe CINE. Ancora leaga masuratoarea de
 * locul din cadru de unde a fost luata: un punct, o linie scurta care se stinge,
 * si eticheta.
 *
 * REGULA CARE TINE TOT MODULUL, si singurul motiv pentru care e un modul si nu
 * cateva div-uri: se ancoreaza DOAR masuratorile care au un loc.
 *
 * `faces[i].box` are unul — de acolo a fost citit zambetul, clipitul, numele.
 * `highlightClipping`, `shadowClipping`, `sharpness`, `horizonTiltDeg` NU au:
 * sunt numere pe tot cadrul. Un punct desenat pentru ele ar fi asezat undeva
 * ales de mine, nu de motor, iar ancora ar deveni exact ce nu trebuie sa fie —
 * decor care mimeaza o dovada. Raman in foaia de metrici, unde sunt adevarate.
 * (Inclinarea orizontului e cazul cel mai ispititor: e o DIRECTIE masurata real,
 * dar fara pozitie — stim cu cate grade e stramb, nu pe unde trece.)
 */

/** Dreptunghi in pixeli, relativ la coltul stanga-sus al containerului. */
export interface Rect { x: number; y: number; w: number; h: number }

/**
 * Unde ajunge efectiv imaginea in cutia ei, cu `object-fit: contain` — adica
 * fara benzile goale de pe laturi. Casetele fetelor sunt normalizate fata de
 * IMAGINE, nu fata de container; fara pasul asta, orice ancora s-ar aseza
 * gresit exact cat de neincadrata e poza (o verticala intr-un ecran lat poate
 * greşi cu jumatate de latime).
 */
export function containedRect(imageW: number, imageH: number, boxW: number, boxH: number): Rect {
  if (imageW <= 0 || imageH <= 0 || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const scale = Math.min(boxW / imageW, boxH / imageH);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

export type AnchorSide = 'right' | 'left';

export interface Anchor {
  /** Stabil pe aceeasi poza: indicele fetei. Cheie de randare, nu identitate globala. */
  id: string;
  /** Cheia de traducere a etichetei si parametrii ei — traducerea se face in componenta. */
  labelKey: string;
  params?: Record<string, string | number>;
  /** Textul deja gata, cand eticheta e un nume propriu (nu se traduce). */
  literal?: string;
  /** Procente fata de container — direct in `style`, deci rezista la redimensionare. */
  leftPct: number;
  topPct: number;
  side: AnchorSide;
  /** Cat de mult schimba verdictul. Ordoneaza selectia si decide cine cade la coliziune. */
  weight: number;
}

/**
 * Sub atat dintr-o latura a cadrului, o fata nu e subiectul pozei.
 *
 * Raportat de utilizator: o ancora aterizase pe un trecator din fundal, cu
 * spatele. Motorul chiar detectase acolo o fata — deci nu e o eroare de
 * masurare — dar ancora nu e o lista de detectii, e un raspuns la "de ce arata
 * poza asta asa". Un om la douazeci de metri nu face parte din raspuns.
 *
 * 9% din latura mai scurta: un portret are fata la 25-60%, un grup de cinci la
 * 12-20%, iar un trecator sub 6%. Pragul taie clar intre ele fara sa fie atat
 * de sus incat sa piarda pe cineva dintr-o poza de grup mare.
 */
const SUBIECT_MIN_LATURA = 0.09;

/**
 * Cel mult trei. Nu e o limita de spatiu — patru incap pe ecran. E ca ancorele
 * sa ramana ce sustin ca sunt: dovezile care conteaza. Daca fiecare fata dintr-o
 * poza de grup isi primeste eticheta, ecranul devine o diagrama, iar ochiul
 * inceteaza sa le mai citeasca.
 */
export const MAX_ANCHORS = 3;

/** Sub atat, doua etichete se ating. Masurat pe randul de 9px + respiro. */
const MIN_SEPARATION_PX = 34;

/**
 * Latimea desenului fara eticheta: reticul + spatiu + linie + spatiu (vezi
 * .lc-anchor).
 *
 * Linia era de 38px si traversa fata pana ajungea la eticheta — pe o poza de
 * grup, doua ancore isi trimiteau etichetele peste obrazul vecinului. Acum e
 * scurta: eticheta sta LANGA masuratoare, nu la capatul unui fir.
 */
const ANCHOR_STEM_PX = 7 + 5 + 14 + 5;

/**
 * Latimea unei etichete micro, estimata din numarul de caractere. Estimata, nu
 * masurata: masurarea ar cere un pas de layout per ancora, la fiecare poza si
 * la fiecare redimensionare, ca sa alegem o latura — mult prea scump pentru
 * ceva ce se poate gresi cu cateva pixeli fara nicio consecinta (partea proasta
 * a unei estimari gresite e o eticheta cu 3px mai aproape de margine).
 * 9px mono, majuscule, urmarire 0.14em.
 */
export function estimateLabelPx(text: string): number {
  return text.length * 7.4;
}

/**
 * Cate caractere presupunem cand apelantul nu ne da textul tradus. E lungimea
 * celei mai lungi etichete din dictionar ("PRIVIRE ÎN OBIECTIV"), adica partea
 * prudenta a greselii: supraestimarea impinge ancora spre latura larga, unde
 * oricum incape.
 */
const FALLBACK_LABEL_CHARS = 19;

/**
 * Zambetul, ca PROCENT intreg.
 *
 * Era "0,81" — doua zecimale si virgula, cum arata pe macheta. Pe telefon, un
 * zambet deplin iesea "ZÂMBET 1,00", care nu se citeste ca "cat de mult", ci ca
 * un cod. Restul aplicatiei vorbeste in procente (Zâmbete 100%, Claritate
 * 100%), deci ancora vorbea singura alta limba.
 *
 * `locale` ramane in semnatura: procentul se scrie la fel in ambele limbi acum,
 * dar apelantul nu trebuie sa afle asta si sa inceteze sa-l trimita.
 */
export function formatSmile(smile: number, _locale: string): string {
  return `${Math.round(smile * 100)}%`;
}

/**
 * Ce are de spus motorul despre ACEASTA fata, in ordinea in care merita spus.
 *
 * Un nume bate orice cifra: recunoasterea persoanei e afirmatia cea mai tare pe
 * care o face aplicatia, si singura care nu se poate deduce uitandu-te la poza.
 * Apoi defectul (ochii inchisi explica un scor mic — omul vrea sa stie de ce),
 * apoi dovada pozitiva cea mai puternica.
 */
/**
 * Pe ce parte a fetei se citeste semnalul, ca fractiune din inaltimea casetei.
 *
 * Exista fiindca ancora promite un lucru foarte precis — "AICI am masurat" —
 * iar pana acum minta: punctul cadea mereu la nivelul ochilor, si pe o
 * eticheta care scria "zambet 0,99". Raportat de utilizator exact asa: "scrie
 * zambet si pune punctul spre ochi". O ancora care arata spre altceva decat
 * spune e mai rea decat nicio ancora, fiindca invata omul sa n-o creada.
 */
const NIVEL_OCHI = 1 / 3;
const NIVEL_GURA = 0.72;
const NIVEL_FATA = 0.5;

function labelFor(face: FaceInsight): { labelKey: string; literal?: string; params?: Record<string, string | number>; weight: number; nivel: number } | null {
  if (face.personName) return { labelKey: 'anchor.person', literal: face.personName, weight: 100, nivel: NIVEL_FATA };
  if (face.isBlinking) return { labelKey: 'anchor.blink', weight: 90, nivel: NIVEL_OCHI };
  // Pragul e cel de la care un zambet chiar e vizibil ca zambet, nu o gura
  // relaxata — sub el, "zâmbet 0,12" ar fi o cifra adevarata care spune ceva fals.
  if (face.smile >= 0.5) return { labelKey: 'anchor.smile', params: { value: face.smile }, weight: 60 + face.smile * 10, nivel: NIVEL_GURA };
  if (face.catchlight) return { labelKey: 'anchor.catchlight', weight: 55, nivel: NIVEL_OCHI };
  if (face.eyeContact !== undefined && face.eyeContact >= 0.7) return { labelKey: 'anchor.eyeContact', weight: 50, nivel: NIVEL_OCHI };
  // FARA REZERVA. Pana acum, o fata despre care nu stiam nimic anume primea
  // totusi "ochi deschisi" — cea mai slaba afirmatie posibila, si singura care
  // se putea si insela: raportat de utilizator pe o fata cu OCHELARI DE SOARE
  // opaci (unde ochii nu se vad deloc, iar EAR-ul din mesh doar ghiceste) si pe
  // un trecator din fundal, cu spatele.
  //
  // O ancora exista ca sa arate ce a masurat motorul. Cand n-a masurat nimic
  // care sa merite spus, raspunsul onest e tacerea, nu cea mai ieftina
  // propozitie adevarata-in-medie. Mai putine ancore, dar niciuna de necrezut.
  return null;
}

export interface AnchorOptions {
  /** Dimensiunea containerului in care se deseneaza (px). */
  boxW: number;
  boxH: number;
  /**
   * Dimensiunea NATURALA a imaginii — pentru banda goala lasata de `contain`.
   * Optionale: pe ecranele unde containerul se stramteaza chiar pe imaginea
   * desenata (`.detail-face-frame`, inline-flex peste un img cu max-width),
   * banda nu exista, iar containerul ESTE imaginea. Unde imaginea umple o
   * cutie fixa (`.tiktok-stage`, width/height 100%), sunt obligatorii.
   */
  imageW?: number;
  imageH?: number;
  /** Benzi acoperite de comenzi (antet sus, motiv + butoane jos), in px. */
  safeTop?: number;
  safeBottom?: number;
  /**
   * Textul final al etichetei, deja tradus — doar pentru latimea reala la
   * alegerea laturii. Optional pentru ca geometria sa nu depinda de i18n:
   * fara el se foloseste FALLBACK_LABEL_CHARS, si singura urmare e ca o ancora
   * poate alege latura larga cand ar fi incaput si pe cealalta.
   */
  label?: (a: Pick<Anchor, 'labelKey' | 'literal' | 'params'>) => string;
}

/**
 * Ancorele pentru o poza, gata de asezat.
 *
 * Ordinea operatiilor conteaza: alegem eticheta -> asezam punctul -> aruncam ce
 * cade sub comenzi -> sortam dupa greutate -> deconflictam -> taiem la
 * MAX_ANCHORS. Taierea la sfarsit, nu la inceput: altfel trei ancore care se
 * suprapun ar consuma toate locurile si am ramane cu una singura pe ecran.
 */
export function anchorsFor(analysis: AnalysisRecord | null | undefined, opts: AnchorOptions): Anchor[] {
  if (!analysis?.faces?.length) return [];
  const { boxW, boxH, imageW = 0, imageH = 0, safeTop = 0, safeBottom = 0, label } = opts;
  if (boxW <= 0 || boxH <= 0) return [];
  // Fara dimensiuni naturale, containerul e chiar imaginea (vezi AnchorOptions).
  const drawn = imageW && imageH ? containedRect(imageW, imageH, boxW, boxH) : { x: 0, y: 0, w: boxW, h: boxH };

  const candidates = analysis.faces.flatMap((face, i) => {
    const [fx, fy, fw, fh] = face.box;
    // Prea mica pentru a fi subiect (vezi SUBIECT_MIN_LATURA), sau motorul
    // n-are nimic de spus despre ea (vezi labelFor): nicio ancora.
    if (Math.max(fw, fh) < SUBIECT_MIN_LATURA) return [];
    const chosen = labelFor(face);
    if (!chosen) return [];
    // Centrul pe orizontala, iar pe verticala EXACT partea despre care vorbeste
    // eticheta (vezi NIVEL_*): ochii pentru clipit/privire, gura pentru zambet,
    // mijlocul fetei pentru un nume.
    const px = drawn.x + (fx + fw / 2) * drawn.w;
    const py = drawn.y + (fy + fh * chosen.nivel) * drawn.h;
    const parte = { labelKey: chosen.labelKey, literal: chosen.literal, params: chosen.params };
    const text = label ? label(parte) : 'x'.repeat(FALLBACK_LABEL_CHARS);
    const needPx = ANCHOR_STEM_PX + estimateLabelPx(text) + 12;
    // Implicit spre dreapta (ca pe macheta, si in sensul citirii); spre stanga
    // doar cand acolo chiar incape si la dreapta nu. Cand nu incape nicaieri —
    // container ingust, fata langa margine — ramane latura mai larga: o
    // eticheta stramtorata spune totusi ceva, una aruncata nu spune nimic.
    const roomRight = boxW - px;
    const roomLeft = px;
    const side: AnchorSide = roomRight >= needPx || roomRight >= roomLeft ? 'right' : 'left';
    return [{
      id: String(i),
      ...parte,
      leftPct: (px / boxW) * 100,
      topPct: (py / boxH) * 100,
      side,
      weight: chosen.weight,
      py,
      /**
       * Cheia de dedublare — vezi bucla de mai jos.
       *
       * Textul randat cand apelantul chiar il da; altfel identitatea semantica
       * a etichetei. Distinctia conteaza: fara `label`, `text` e un sir de
       * umplutura, IDENTIC pentru toate ancorele (serveste doar la estimarea
       * latimii), deci dedublarea pe el ar sterge orice a doua ancora indiferent
       * ce spune. Doua zambete de 0,812 si 0,814 se scriu la fel — "81%" — deci
       * pe text cad corect; pe parametri bruti n-ar cadea.
       */
      cheie: label
        ? text
        : `${chosen.labelKey}|${chosen.literal ?? ''}|${JSON.stringify(chosen.params ?? {})}`,
      // Cat loc ocupa desenul pe orizontala — pentru coliziuni, mai jos.
      x0: side === 'right' ? px : px - needPx,
      x1: side === 'right' ? px + needPx : px
    }];
  });

  const vizibile = candidates.filter(a => a.py >= safeTop && a.py <= boxH - safeBottom);
  vizibile.sort((a, b) => b.weight - a.weight);

  const pastrate: typeof vizibile = [];
  /**
   * Aceeasi propozitie de doua ori nu e de doua ori mai multa informatie.
   *
   * Raportat cu captura: o poza de familie cu doua ancore, amandoua scriind
   * "ZÂMBET 100%". A doua nu adauga nimic — masoara alta fata, dar spune exact
   * ce spune prima, si in schimb acopera inca o bucata de poza. Ramane cea mai
   * puternica (lista e deja sortata dupa greutate).
   *
   * Numele NU cad aici: "ANA" si "MARIA" sunt texte diferite, deci amandoua
   * raman — si acolo chiar sunt doua afirmatii diferite.
   */
  const texteFolosite = new Set<string>();
  for (const a of vizibile) {
    if (pastrate.length >= MAX_ANCHORS) break;
    if (texteFolosite.has(a.cheie)) continue;
    // Doua etichete aproape pe aceeasi linie se acopera daca desenele lor se
    // suprapun si pe orizontala. Nu ajunge sa comparam latura: o ancora care
    // pleaca spre stanga dintr-un punct si una care pleaca spre dreapta dintr-un
    // punct mai la stanga se intalnesc la mijloc, desi lateralele difera.
    // Cade cea mai slaba — lista e deja sortata, deci "cea de acum".
    if (pastrate.some(p => Math.abs(p.py - a.py) < MIN_SEPARATION_PX && p.x0 < a.x1 && a.x0 < p.x1)) continue;
    pastrate.push(a);
    texteFolosite.add(a.cheie);
  }
  return pastrate.map(({ py: _py, x0: _x0, x1: _x1, cheie: _cheie, ...rest }) => rest);
}
