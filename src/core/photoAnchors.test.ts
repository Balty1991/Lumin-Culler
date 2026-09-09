import { describe, it, expect } from 'vitest';
import { containedRect, anchorsFor, estimateLabelPx, formatSmile, MAX_ANCHORS } from './photoAnchors';
import type { AnalysisRecord, FaceInsight } from './db';

function face(over: Partial<FaceInsight> = {}): FaceInsight {
  return {
    box: [0.4, 0.3, 0.2, 0.2], faceScore: 0.9, smile: 0.2,
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
    const [a] = anchorsFor(rec([face({ box: [0.4, 0.4, 0.2, 0.2] })]), CADRU);
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
    const [a] = anchorsFor(rec([face({ box: [0.5, 0.4, 0.2, 0.2] })]), cadru);
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
    const [a] = anchorsFor(rec([face({ box: [0.9, 0.4, 0.08, 0.08] })]), cadru);
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
    expect(eticheta({ smile: 0.49 }).labelKey).not.toBe('anchor.smile');
    expect(eticheta({ smile: 0.5 }).labelKey).toBe('anchor.smile');
  });

  it('zambetul isi poarta cifra, iar ea se formateaza dupa limba', () => {
    expect(eticheta({ smile: 0.81 }).params).toEqual({ value: 0.81 });
    expect(formatSmile(0.81, 'ro')).toBe('0,81');
    expect(formatSmile(0.81, 'en')).toBe('0.81');
  });

  it('fara nimic de spus, ramane ce e adevarat si util: ochii sunt deschisi', () => {
    expect(eticheta({}).labelKey).toBe('anchor.eyesOpen');
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
      face({ box: [0.4, 0.4, 0.08, 0.08] }),                                  // "ochi deschisi", slaba
      face({ box: [0.42, 0.41, 0.08, 0.08], personName: 'Ana', personId: 'x' }) // numele, grea
    ]), CADRU);
    expect(rezultat).toHaveLength(1);
    expect(rezultat[0].literal).toBe('Ana');
  });

  it('coliziunea se judeca pe desenul intreg, nu pe latura — doua etichete opuse se pot intalni la mijloc', () => {
    // Una pleaca spre dreapta din stanga, cealalta spre stanga din dreapta,
    // la aceeasi inaltime: lateralele difera, dar desenele se suprapun.
    const rezultat = anchorsFor(rec([
      face({ box: [0.05, 0.4, 0.06, 0.06], personName: 'Ana', personId: 'x' }),
      face({ box: [0.80, 0.4, 0.06, 0.06] })
    ]), { ...CADRU, label: () => 'X'.repeat(30) });
    expect(rezultat).toHaveLength(1);
  });

  it('fete departate una de alta isi pastreaza fiecare eticheta', () => {
    const rezultat = anchorsFor(rec([
      face({ box: [0.1, 0.05, 0.08, 0.08] }),
      face({ box: [0.1, 0.5, 0.08, 0.08] }),
      face({ box: [0.1, 0.9, 0.08, 0.08] })
    ]), CADRU);
    expect(rezultat).toHaveLength(3);
  });

  it('nu trece niciodata de trei, oricat de multa lume ar fi in poza', () => {
    const multi = Array.from({ length: 9 }, (_, i) => face({ box: [0.1, i * 0.11, 0.05, 0.05] }));
    expect(anchorsFor(rec(multi), CADRU).length).toBeLessThanOrEqual(MAX_ANCHORS);
  });

  it('taierea la trei vine DUPA deconflictare, altfel ecranul ramane aproape gol', () => {
    // Trei fete ingramadite sus (din care trece una) si trei raspandite jos.
    const rezultat = anchorsFor(rec([
      face({ box: [0.1, 0.10, 0.04, 0.04] }),
      face({ box: [0.1, 0.11, 0.04, 0.04] }),
      face({ box: [0.1, 0.12, 0.04, 0.04] }),
      face({ box: [0.1, 0.45, 0.04, 0.04] }),
      face({ box: [0.1, 0.80, 0.04, 0.04] })
    ]), CADRU);
    expect(rezultat).toHaveLength(3);
  });

  it('ancorele ascunse sub antet sau sub butoanele de decizie sunt aruncate, nu desenate dedesubt', () => {
    const sus = rec([face({ box: [0.4, 0.0, 0.04, 0.04] })]);
    const jos = rec([face({ box: [0.4, 0.97, 0.04, 0.04] })]);
    const benzi = { ...CADRU, imageH: 2000, imageW: 1000, safeTop: 220, safeBottom: 220 };
    expect(anchorsFor(sus, benzi)).toEqual([]);
    expect(anchorsFor(jos, benzi)).toEqual([]);
    expect(anchorsFor(rec([face({ box: [0.4, 0.5, 0.04, 0.04] })]), benzi)).toHaveLength(1);
  });
});

describe('latimea etichetei', () => {
  it('creste cu textul', () => {
    expect(estimateLabelPx('ANA')).toBeLessThan(estimateLabelPx('PRIVIRE ÎN OBIECTIV'));
  });
});
