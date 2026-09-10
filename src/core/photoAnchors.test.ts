import { describe, it, expect } from 'vitest';
import { containedRect, anchorsFor, estimateLabelPx, formatSmile, MAX_ANCHORS } from './photoAnchors';
import type { AnalysisRecord, FaceInsight } from './db';

function face(over: Partial<FaceInsight> = {}): FaceInsight {
  return {
    box: [0.4, 0.3, 0.2, 0.2], faceScore: 0.9, smile: 0.8,
    eyesOpen: { left: 0.9, right: 0.9 }, isBlinking: false,
    personId: null, personName: null, similarity: 0,
    ...over
  };
}
function rec(faces: FaceInsight[]): AnalysisRecord {
  return { photoId: 'p', faces, faceCount: faces.length } as AnalysisRecord;
}
/** Container 400x800, imagine patrata 1000x1000 -> banda goala sus/jos. */
const CADRU = { boxW: 400, boxH: 800, imageW: 1000, imageH: 1000 };

describe('banda goala de la object-fit: contain', () => {
  it('imaginea patrata intr-un container inalt sta pe mijloc, cu bordura sus si jos', () => {
    const r = containedRect(1000, 1000, 400, 800);
    expect(r).toEqual({ x: 0, y: 200, w: 400, h: 400 });
  });

  it('imaginea lata intr-un container patrat lasa bordura tot sus si jos', () => {
    const r = containedRect(2000, 1000, 400, 400);
    expect(r).toEqual({ x: 0, y: 100, w: 400, h: 200 });
  });

  it('aceleasi proportii = fara bordura deloc', () => {
    expect(containedRect(1000, 2000, 300, 600)).toEqual({ x: 0, y: 0, w: 300, h: 600 });
  });

  it('dimensiuni lipsa (imaginea nu s-a incarcat inca) nu produc NaN', () => {
    expect(containedRect(0, 0, 400, 800)).toEqual({ x: 0, y: 0, w: 400, h: 800 });
  });
});

describe('ancora sta unde a masurat motorul, nu unde arata bine', () => {
  it('caseta e normalizata fata de IMAGINE, deci punctul cade in banda desenata', () => {
    // Fata in centrul imaginii patrate; imaginea ocupa y 200..600 din 800.
    const [a] = anchorsFor(rec([face({ box: [0.4, 0.4, 0.2, 0.2], isBlinking: true })]), CADRU);
    expect(a.leftPct).toBeCloseTo(50, 5);
    // centrul pe verticala al fetei e la 0.4 + 0.2/3 din imagine
    const asteptat = ((200 + (0.4 + 0.2 / 3) * 400) / 800) * 100;
    expect(a.topPct).toBeCloseTo(asteptat, 5);
    // Si asta e toata miza: fara banda goala, acelasi punct ar fi cazut la
    // 46,7% — cu 13px mai sus, adica pe fruntea altcuiva intr-o poza de grup.
    const naiv = (0.4 + 0.2 / 3) * 100;
    expect(naiv).toBeCloseTo(46.67, 1);
    expect(Math.abs(a.topPct - naiv)).toBeGreaterThan(1);
  });

  /**
   * Raportat de utilizator, cu captura: pe o poza INALTA, eticheta ajungea in
   * banda neagra de langa fotografie. Presupusesem ca ecranul de detaliu isi
   * stramteaza cadrul exact pe imaginea desenata si nu-i dadeam dimensiunea
   * naturala; cand cadrul ramane mai lat, ancora arata spre nimic.
   */
  it('poza inalta intr-un cadru lat: ancora ramane PE fotografie, nu langa ea', () => {
    // Cadru 400x600, poza 3:4 verticala -> desenata 450 inaltime? nu incape:
    // scara = min(400/900, 600/1200) = 0.5 -> 450x600, banda de 25px pe laturi.
    const cadru = { boxW: 500, boxH: 600, imageW: 900, imageH: 1200 };
    const [a] = anchorsFor(rec([face({ box: [0.5, 0.4, 0.2, 0.2], isBlinking: true })]), cadru);
    // Imaginea ocupa x 25..475 din 500; centrul fetei (0.6 din imagine) cade la
    // 25 + 0.6*450 = 295, adica 59% din cadru — nu 60%.
    expect(a.leftPct).toBeCloseTo((295 / 500) * 100, 5);
    // Si, mai important, punctul e INAUNTRUL benzii desenate.
    const stanga = (25 / 500) * 100;
    const dreapta = (475 / 500) * 100;
    expect(a.leftPct).toBeGreaterThan(stanga);
    expect(a.leftPct).toBeLessThan(dreapta);
  });

  it('o fata la marginea unei poze inguste nu impinge eticheta in banda neagra', () => {
    // Poza foarte ingusta (9:16) intr-un cadru lat: banda ocupa mai mult decat
    // poza. O fata la marginea DIN DREAPTA a pozei e inca in stanga cadrului.
    const cadru = { boxW: 800, boxH: 600, imageW: 900, imageH: 1600 };
    const [a] = anchorsFor(rec([face({ box: [0.9, 0.4, 0.1, 0.1] })]), cadru);
    // scara = 600/1600 = 0.375 -> latime desenata 337.5, banda 231.25 pe laturi
    const dreaptaPozei = ((231.25 + 337.5) / 800) * 100;
    expect(a.leftPct).toBeLessThanOrEqual(dreaptaPozei);
    // ...si mai are loc la dreapta, deci eticheta pleaca intr-acolo
    expect(a.side).toBe('right');
  });

  it('fara fete nu exista nicio ancora — masuratorile pe tot cadrul nu au loc', () => {
    expect(anchorsFor(rec([]), CADRU)).toEqual([]);
    expect(anchorsFor(null, CADRU)).toEqual([]);
    // ...nici cand poza chiar are defecte de raportat: acelea stau in foaie.
    const analiza = { ...rec([]), highlightClipping: 0.4, horizonTiltDeg: 7 } as AnalysisRecord;
    expect(anchorsFor(analiza, CADRU)).toEqual([]);
  });

  it('un container inca nemasurat (0x0) nu incearca sa aseze nimic', () => {
    expect(anchorsFor(rec([face()]), { ...CADRU, boxW: 0, boxH: 0 })).toEqual([]);
  });
});

/**
 * Raportat de utilizator, cu captura: "scrie zambet si pune punctul spre ochi".
 * O ancora care arata spre altceva decat spune e mai rea decat nicio ancora —
 * invata omul sa n-o creada, si atunci nici celelalte nu mai valoreaza nimic.
 */
describe('punctul cade pe partea despre care vorbeste eticheta', () => {
  /** Caseta ocupa jumatatea de sus a unei imagini patrate, ca sa se vada usor unde cade. */
  const CASETA: [number, number, number, number] = [0.4, 0.0, 0.2, 0.5];
  const patrat = { boxW: 400, boxH: 400, imageW: 1000, imageH: 1000 };
  const punct = (f: Partial<FaceInsight>) => anchorsFor(rec([face({ box: CASETA, ...f })]), patrat)[0].topPct;

  it('zambetul arata spre GURA, nu spre ochi', () => {
    const gura = punct({ smile: 0.99 });
    const ochi = punct({ isBlinking: true });
    expect(gura).toBeGreaterThan(ochi);
    // Gura e in treimea de jos a fetei: peste 60% din inaltimea casetei.
    expect(gura).toBeGreaterThan(0.6 * 50);
  });

  it('clipitul si privirea arata spre ochi', () => {
    expect(punct({ isBlinking: true })).toBeCloseTo((0.5 / 3) * 100, 5);
    expect(punct({ smile: 0.1, eyeContact: 0.9 })).toBeCloseTo((0.5 / 3) * 100, 5);
  });

  it('un nume arata spre mijlocul fetei — el nu e o trasatura, e persoana', () => {
    expect(punct({ personId: 'p', personName: 'Ana' })).toBeCloseTo(25, 5);
  });
});

describe('eticheta spune lucrul cel mai tare pe care il stie motorul', () => {
  const eticheta = (f: Partial<FaceInsight>) => anchorsFor(rec([face(f)]), CADRU)[0];

  it('numele bate orice cifra — e singura afirmatie care nu se vede din poza', () => {
    const a = eticheta({ personName: 'Ana', personId: 'p1', smile: 0.9, isBlinking: true });
    expect(a.labelKey).toBe('anchor.person');
    expect(a.literal).toBe('Ana');
  });

  it('ochii inchisi bat un zambet — omul vrea sa stie DE CE scorul e mic', () => {
    expect(eticheta({ isBlinking: true, smile: 0.9 }).labelKey).toBe('anchor.blink');
  });

  it('un zambet slab nu se anunta ca zambet', () => {
    expect(eticheta({ smile: 0.5 }).labelKey).toBe('anchor.smile');
    // Sub prag nu mai ramane nimic de spus despre fata asta, deci nicio ancora.
    expect(anchorsFor(rec([face({ smile: 0.49 })]), CADRU)).toEqual([]);
  });

  /**
   * Procent intreg, nu doua zecimale.
   *
   * Era "0,81". Pe telefon, un zambet deplin iesea "ZÂMBET 1,00" — care nu se
   * citeste ca "cat de mult", ci ca un cod. Restul aplicatiei vorbeste in
   * procente (Zâmbete 100%, Claritate 100%), deci ancora vorbea singura alta
   * limba.
   */
  it('zambetul isi poarta cifra, si se scrie ca procent intreg', () => {
    expect(eticheta({ smile: 0.81 }).params).toEqual({ value: 0.81 });
    expect(formatSmile(0.81, 'ro')).toBe('81%');
    expect(formatSmile(0.81, 'en')).toBe('81%');
    // Cazul care a starnit schimbarea: 1,00 arata ca un cod, 100% ca o masura.
    expect(formatSmile(1, 'ro')).toBe('100%');
  });

  /**
   * Raportat de utilizator pe o fata cu OCHELARI DE SOARE opaci si pe un
   * trecator din fundal, cu spatele: ancora scria "ochi deschisi". Era eticheta
   * de rezerva — cea mai slaba afirmatie posibila si singura care se putea
   * insela, fiindca EAR-ul din mesh doar ghiceste cand ochii nu se vad.
   */
  it('fara nimic de spus, motorul TACE — nu inventeaza cea mai ieftina propozitie', () => {
    expect(anchorsFor(rec([face({ smile: 0.1 })]), CADRU)).toEqual([]);
  });

  it('o fata prea mica nu e subiect, oricat de bine ar zambi', () => {
    // Un trecator la douazeci de metri: motorul chiar l-a detectat, dar el nu
    // face parte din raspunsul la "de ce arata poza asta asa".
    expect(anchorsFor(rec([face({ box: [0.8, 0.1, 0.05, 0.05], smile: 0.95 })]), CADRU)).toEqual([]);
    expect(anchorsFor(rec([face({ box: [0.8, 0.1, 0.12, 0.12], smile: 0.95 })]), CADRU)).toHaveLength(1);
  });
});

describe('ancorele nu ies din cadru si nu se calca', () => {
  it('o fata langa marginea dreapta isi trimite eticheta spre stanga', () => {
    const a = anchorsFor(rec([face({ box: [0.85, 0.4, 0.1, 0.1] })]), CADRU)[0];
    expect(a.side).toBe('left');
  });

  it('o fata langa marginea stanga o trimite spre dreapta', () => {
    expect(anchorsFor(rec([face({ box: [0.02, 0.4, 0.1, 0.1] })]), CADRU)[0].side).toBe('right');
  });

  it('cand eticheta e scurta, incape la dreapta si acolo ramane', () => {
    const scurt = anchorsFor(rec([face({ box: [0.55, 0.4, 0.1, 0.1] })]), { ...CADRU, label: () => 'ANA' })[0];
    const lung = anchorsFor(rec([face({ box: [0.55, 0.4, 0.1, 0.1] })]), { ...CADRU, label: () => 'PRIVIRE ÎN OBIECTIV' })[0];
    expect(scurt.side).toBe('right');
    expect(lung.side).toBe('left');
  });

  it('doua fete lipite pe verticala pastreaza doar eticheta mai grea', () => {
    const rezultat = anchorsFor(rec([
      face({ box: [0.4, 0.4, 0.1, 0.1] }),                                  // "ochi deschisi", slaba
      face({ box: [0.42, 0.41, 0.1, 0.1], personName: 'Ana', personId: 'x' }) // numele, grea
    ]), CADRU);
    expect(rezultat).toHaveLength(1);
    expect(rezultat[0].literal).toBe('Ana');
  });

  it('coliziunea se judeca pe desenul intreg, nu pe latura — doua etichete opuse se pot intalni la mijloc', () => {
    // Una pleaca spre dreapta din stanga, cealalta spre stanga din dreapta,
    // la aceeasi inaltime: lateralele difera, dar desenele se suprapun.
    const rezultat = anchorsFor(rec([
      face({ box: [0.05, 0.4, 0.1, 0.1], personName: 'Ana', personId: 'x' }),
      face({ box: [0.80, 0.4, 0.1, 0.1] })
    ]), { ...CADRU, label: () => 'X'.repeat(30) });
    expect(rezultat).toHaveLength(1);
  });

  it('fete departate una de alta isi pastreaza fiecare eticheta', () => {
    // Nume diferite, nu trei zambete identice: testul asta e despre ASEZARE, iar
    // trei etichete cu acelasi text cad acum la dedublare inainte de coliziuni.
    const rezultat = anchorsFor(rec([
      face({ box: [0.1, 0.05, 0.1, 0.1], personName: 'Ana', personId: 'a' }),
      face({ box: [0.1, 0.5, 0.1, 0.1], personName: 'Ion', personId: 'b' }),
      face({ box: [0.1, 0.9, 0.1, 0.1], personName: 'Maria', personId: 'c' })
    ]), CADRU);
    expect(rezultat).toHaveLength(3);
  });

  it('nu trece niciodata de trei, oricat de multa lume ar fi in poza', () => {
    const multi = Array.from({ length: 9 }, (_, i) => face({ box: [0.1, i * 0.11, 0.1, 0.1] }));
    expect(anchorsFor(rec(multi), CADRU).length).toBeLessThanOrEqual(MAX_ANCHORS);
  });

  it('taierea la trei vine DUPA deconflictare, altfel ecranul ramane aproape gol', () => {
    // Trei fete ingramadite sus (din care trece una) si trei raspandite jos.
    const rezultat = anchorsFor(rec([
      face({ box: [0.1, 0.10, 0.1, 0.1], personName: 'Ana', personId: 'a' }),
      face({ box: [0.1, 0.11, 0.1, 0.1], personName: 'Ion', personId: 'b' }),
      face({ box: [0.1, 0.12, 0.1, 0.1], personName: 'Maria', personId: 'c' }),
      face({ box: [0.1, 0.45, 0.1, 0.1], personName: 'Dan', personId: 'd' }),
      face({ box: [0.1, 0.80, 0.1, 0.1], personName: 'Elena', personId: 'e' })
    ]), CADRU);
    expect(rezultat).toHaveLength(3);
  });

  /**
   * Aceeasi propozitie de doua ori nu e de doua ori mai multa informatie.
   *
   * Raportat cu captura: o poza de familie cu doua ancore, amandoua scriind
   * "ZÂMBET 100%". A doua masoara alta fata, dar spune exact ce spune prima —
   * si in schimb acopera inca o bucata din poza.
   */
  it('doua etichete identice devin una singura, dar doua nume raman doua', () => {
    const departe: [number, number, number, number][] = [[0.1, 0.15, 0.1, 0.1], [0.1, 0.6, 0.1, 0.1]];
    const acelasiText = anchorsFor(rec([
      face({ box: departe[0], smile: 0.9 }),
      face({ box: departe[1], smile: 0.9 })
    ]), { ...CADRU, label: a => `zâmbet ${a.params?.value}` });
    expect(acelasiText).toHaveLength(1);

    const numeDiferite = anchorsFor(rec([
      face({ box: departe[0], personName: 'Ana', personId: 'a' }),
      face({ box: departe[1], personName: 'Maria', personId: 'b' })
    ]), { ...CADRU, label: a => a.literal ?? '' });
    expect(numeDiferite).toHaveLength(2);
  });

  it('ancorele ascunse sub antet sau sub butoanele de decizie sunt aruncate, nu desenate dedesubt', () => {
    const sus = rec([face({ box: [0.4, 0.0, 0.1, 0.1] })]);
    const jos = rec([face({ box: [0.4, 0.97, 0.1, 0.1] })]);
    const benzi = { ...CADRU, imageH: 2000, imageW: 1000, safeTop: 220, safeBottom: 220 };
    expect(anchorsFor(sus, benzi)).toEqual([]);
    expect(anchorsFor(jos, benzi)).toEqual([]);
    expect(anchorsFor(rec([face({ box: [0.4, 0.5, 0.1, 0.1] })]), benzi)).toHaveLength(1);
  });
});

describe('latimea etichetei', () => {
  it('creste cu textul', () => {
    expect(estimateLabelPx('ANA')).toBeLessThan(estimateLabelPx('PRIVIRE ÎN OBIECTIV'));
  });
});
