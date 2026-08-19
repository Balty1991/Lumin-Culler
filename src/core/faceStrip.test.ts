import { describe, it, expect } from 'vitest';
import { buildFaceStrip, bestFrameForRow, type StripFrame, type StripFace, MAX_POSITION_DRIFT } from './faceStrip';

function face(over: Partial<StripFace> = {}): StripFace {
  return {
    box: [0.1, 0.1, 0.2, 0.2], isBlinking: false, smile: 0.5,
    personId: null, personName: null, ...over
  };
}
function frame(photoId: string, label: string, faces: StripFace[]): StripFrame {
  return { photoId, label, faces };
}

describe('buildFaceStrip', () => {
  it('nu construieste nimic pentru un singur cadru — nu exista comparatie', () => {
    expect(buildFaceStrip([frame('a', '1', [face()])])).toEqual([]);
  });

  it('nu construieste nimic daca primul cadru nu are fete', () => {
    expect(buildFaceStrip([frame('a', '1', []), frame('b', '2', [face()])])).toEqual([]);
  });

  it('leaga aceeasi persoana inrolata intre cadre, oriunde s-ar afla', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ personId: 'p1', personName: 'Ana', box: [0.1, 0.1, 0.2, 0.2] })]),
      // in al doilea cadru s-a mutat in partea opusa: pozitia n-ar gasi-o, identitatea da
      frame('b', '2', [face({ personId: 'p1', personName: 'Ana', box: [0.7, 0.6, 0.2, 0.2] })])
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].match).toBe('person');
    expect(rows[0].cells.map(c => c.photoId)).toEqual(['a', 'b']);
  });

  it('leaga prin embedding cand persoana nu are nume', () => {
    const e = [1, 0, 0, 0];
    const rows = buildFaceStrip([
      frame('a', '1', [face({ embedding: e, box: [0.1, 0.1, 0.2, 0.2] })]),
      frame('b', '2', [face({ embedding: [0.98, 0.02, 0, 0], box: [0.7, 0.6, 0.2, 0.2] })])
    ]);
    expect(rows[0].match).toBe('embedding');
    expect(rows[0].cells[1].face).toBeDefined();
  });

  it('nu leaga doua embedding-uri prea diferite', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ embedding: [1, 0, 0, 0], box: [0.1, 0.1, 0.2, 0.2] })]),
      frame('b', '2', [face({ embedding: [0, 1, 0, 0], box: [0.7, 0.6, 0.2, 0.2] })])
    ]);
    expect(rows[0].cells[1].face).toBeUndefined();
  });

  it('cade pe pozitie doar pentru fete fara embedding si fara nume', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ box: [0.1, 0.1, 0.2, 0.2] })]),
      frame('b', '2', [face({ box: [0.12, 0.11, 0.2, 0.2] })])
    ]);
    expect(rows[0].match).toBe('position');
    expect(rows[0].cells[1].face).toBeDefined();
  });

  it('nu leaga pe pozitie doua fete prea departate', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ box: [0.05, 0.05, 0.2, 0.2] })]),
      frame('b', '2', [face({ box: [0.05 + MAX_POSITION_DRIFT + 0.1, 0.05, 0.2, 0.2] })])
    ]);
    expect(rows[0].cells[1].face).toBeUndefined();
  });

  it('o fata nu poate fi folosita de doua randuri in acelasi cadru', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ box: [0.1, 0.1, 0.2, 0.2] }), face({ box: [0.15, 0.12, 0.2, 0.2] })]),
      // un singur candidat in cadrul doi: primul rand il ia, al doilea ramane gol
      frame('b', '2', [face({ box: [0.11, 0.1, 0.2, 0.2] })])
    ]);
    const filled = rows.filter(r => r.cells[1].face);
    expect(filled).toHaveLength(1);
  });

  it('nu deschide randuri pentru fete care apar abia in cadre ulterioare', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ box: [0.1, 0.1, 0.2, 0.2] })]),
      frame('b', '2', [face({ box: [0.1, 0.1, 0.2, 0.2] }), face({ box: [0.8, 0.8, 0.1, 0.1] })])
    ]);
    expect(rows).toHaveLength(1);
  });

  it('fiecare rand are cate o celula per cadru, chiar cand persoana lipseste', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ personId: 'p1' })]),
      frame('b', '2', []),
      frame('c', '3', [face({ personId: 'p1' })])
    ]);
    expect(rows[0].cells.map(c => c.label)).toEqual(['1', '2', '3']);
    expect(rows[0].cells[1].face).toBeUndefined();
  });

  it('numara clipitul si pune sus persoana cu cele mai multe probleme', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [
        face({ personId: 'ok', personName: 'Ok', box: [0.1, 0.1, 0.2, 0.2] }),
        face({ personId: 'blink', personName: 'Blink', box: [0.6, 0.1, 0.2, 0.2], isBlinking: true })
      ]),
      frame('b', '2', [
        face({ personId: 'ok', personName: 'Ok', box: [0.1, 0.1, 0.2, 0.2] }),
        face({ personId: 'blink', personName: 'Blink', box: [0.6, 0.1, 0.2, 0.2], isBlinking: true })
      ])
    ]);
    expect(rows[0].personName).toBe('Blink');
    expect(rows[0].blinkCount).toBe(2);
    expect(rows[1].blinkCount).toBe(0);
  });

  it('randul e la fel de sigur ca cea mai slaba legatura din el', () => {
    const rows = buildFaceStrip([
      frame('a', '1', [face({ personId: 'p1', box: [0.1, 0.1, 0.2, 0.2] })]),
      frame('b', '2', [face({ personId: 'p1', box: [0.1, 0.1, 0.2, 0.2] })]),
      // al treilea cadru: aceeasi pozitie, dar fara identitate — legatura slaba
      frame('c', '3', [face({ box: [0.1, 0.1, 0.2, 0.2] })])
    ]);
    expect(rows[0].cells).toHaveLength(3);
    expect(rows[0].match).toBe('position');
  });
});

describe('bestFrameForRow', () => {
  const row = (cells: { photoId: string; face?: StripFace }[]) => ({
    personName: null, key: 'k', match: 'person' as const, blinkCount: 0,
    cells: cells.map(c => ({ ...c, label: c.photoId }))
  });

  it('alege cadrul fara clipit cu cel mai mare zambet', () => {
    expect(bestFrameForRow(row([
      { photoId: 'a', face: face({ smile: 0.2 }) },
      { photoId: 'b', face: face({ smile: 0.9 }) },
      { photoId: 'c', face: face({ smile: 1, isBlinking: true }) }
    ]))).toBe('b');
  });

  it('nu propune nimic daca persoana clipeste in toate cadrele', () => {
    expect(bestFrameForRow(row([
      { photoId: 'a', face: face({ isBlinking: true }) },
      { photoId: 'b', face: face({ isBlinking: true }) }
    ]))).toBeNull();
  });

  it('sare peste cadrele in care persoana lipseste', () => {
    expect(bestFrameForRow(row([
      { photoId: 'a' },
      { photoId: 'b', face: face({ smile: 0.4 }) }
    ]))).toBe('b');
  });
});
