import { describe, expect, it } from 'vitest';
import { buildExportFileName } from './renameTemplate';

describe('buildExportFileName', () => {
  it('pastreaza numele original cand sablonul e gol sau doar spatii', () => {
    expect(buildExportFileName('', {}, 1, 'IMG_1234.jpg')).toBe('IMG_1234.jpg');
    expect(buildExportFileName('   ', {}, 1, 'IMG_1234.jpg')).toBe('IMG_1234.jpg');
  });

  it('expandeaza toate token-urile si pastreaza extensia originala', () => {
    const name = buildExportFileName(
      '{client}_{eveniment}_{data}_{secventa}',
      { client: 'Ana', event: 'Nunta', capturedAt: new Date('2026-05-10T12:00:00Z').getTime() },
      7,
      'IMG_9999.CR2'
    );
    expect(name).toBe('Ana_Nunta_2026-05-10_007.CR2');
  });

  it('zero-padeaza secventa la 3 cifre', () => {
    expect(buildExportFileName('{secventa}', {}, 1, 'a.jpg')).toBe('001.jpg');
    expect(buildExportFileName('{secventa}', {}, 42, 'a.jpg')).toBe('042.jpg');
    expect(buildExportFileName('{secventa}', {}, 1234, 'a.jpg')).toBe('1234.jpg');
  });

  it('token {nume} insereaza numele original fara extensie', () => {
    expect(buildExportFileName('vechi-{nume}', {}, 1, 'poza.png')).toBe('vechi-poza.png');
  });

  it('sanitizeaza caractere ilegale de path din valorile token-urilor', () => {
    const name = buildExportFileName('{client}', { client: 'A/B:C' }, 1, 'x.jpg');
    expect(name).toBe('A-B-C.jpg');
  });

  it('colapseaza separatori repetati cand un token lipseste (ex. fara client)', () => {
    const name = buildExportFileName('{client}_{eveniment}_{secventa}', { event: 'Botez' }, 3, 'x.jpg');
    expect(name).toBe('Botez_003.jpg');
  });

  it('cade pe numele original (fara extensie schimbata) daca expansiunea rezulta complet goala', () => {
    const name = buildExportFileName('{client}', {}, 1, 'x.jpg');
    expect(name).toBe('x.jpg');
  });

  it('fisier fara extensie ramane fara extensie dupa expansiune', () => {
    expect(buildExportFileName('{secventa}', {}, 1, 'README')).toBe('001');
  });
});
