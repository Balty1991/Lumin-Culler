import { describe, expect, it } from 'vitest';
import { parseIptc } from './iptcParser';

/** Un singur "dataset" IPTC-IIM: marcaj 0x1C, record, dataset, lungime (2 octeti, big-endian), date ASCII. */
function encodeIptcRecord(record: number, dataset: number, value: string): Uint8Array {
  const bytes = Uint8Array.from(value, c => c.charCodeAt(0));
  const out = new Uint8Array(5 + bytes.length);
  out[0] = 0x1c;
  out[1] = record;
  out[2] = dataset;
  out[3] = (bytes.length >> 8) & 0xff;
  out[4] = bytes.length & 0xff;
  out.set(bytes, 5);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

/**
 * Construieste un buffer JPEG minim, valid structural, cu un segment APP13
 * ("Photoshop 3.0\0" + bloc de resursa 8BIM 0x0404 + inregistrari IPTC-IIM) —
 * nu foloseste nicio librarie, ca sa verifice parserul impotriva unei surse
 * independente (nu impotriva propriei sale logici).
 */
function buildJpegWithIptc(records: Uint8Array): ArrayBuffer {
  const signature = Uint8Array.from('Photoshop 3.0\0', c => c.charCodeAt(0));
  // bloc 8BIM: "8BIM" + resource id (2, BE) + nume pascal gol (1 octet, padat la 2) + lungime date (4, BE) + date
  const header = new Uint8Array(4 + 2 + 2 + 4);
  header.set(Uint8Array.from('8BIM', c => c.charCodeAt(0)), 0);
  header[4] = 0x04; header[5] = 0x04; // resource id 0x0404
  header[6] = 0x00; header[7] = 0x00; // nume pascal gol, padat la 2 octeti
  const len = records.length;
  header[8] = (len >>> 24) & 0xff; header[9] = (len >>> 16) & 0xff;
  header[10] = (len >>> 8) & 0xff; header[11] = len & 0xff;

  const psBlock = concatBytes([signature, header, records]);
  const appDataLength = 2 + psBlock.length; // lungimea segmentului INCLUDE cei 2 octeti de lungime, dar NU markerul
  const app13 = new Uint8Array(2 + 2 + psBlock.length);
  app13[0] = 0xff; app13[1] = 0xed;
  app13[2] = (appDataLength >>> 8) & 0xff; app13[3] = appDataLength & 0xff;
  app13.set(psBlock, 4);

  const soi = Uint8Array.from([0xff, 0xd8]);
  const eoi = Uint8Array.from([0xff, 0xd9]);
  const full = concatBytes([soi, app13, eoi]);
  return full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength) as ArrayBuffer;
}

describe('parseIptc', () => {
  it('extrage campurile simple din Record 2 (Application Record)', () => {
    const records = concatBytes([
      encodeIptcRecord(2, 80, 'Ion Popescu'),
      encodeIptcRecord(2, 120, 'Poza de test la o nunta'),
      encodeIptcRecord(2, 105, 'Nunta Ana & Mihai'),
      encodeIptcRecord(2, 110, 'Studio Foto X'),
      encodeIptcRecord(2, 115, 'Agentie Foto Y'),
      encodeIptcRecord(2, 116, '(c) 2026 Ion Popescu'),
      encodeIptcRecord(2, 90, 'Brasov'),
      encodeIptcRecord(2, 101, 'Romania')
    ]);
    const result = parseIptc(buildJpegWithIptc(records));
    expect(result.byline).toBe('Ion Popescu');
    expect(result.caption).toBe('Poza de test la o nunta');
    expect(result.headline).toBe('Nunta Ana & Mihai');
    expect(result.credit).toBe('Studio Foto X');
    expect(result.source).toBe('Agentie Foto Y');
    expect(result.copyright).toBe('(c) 2026 Ion Popescu');
    expect(result.city).toBe('Brasov');
    expect(result.country).toBe('Romania');
  });

  it('colecteaza toate aparitiile repetate ale cuvintelor-cheie (2:25)', () => {
    const records = concatBytes([
      encodeIptcRecord(2, 25, 'nunta'),
      encodeIptcRecord(2, 25, 'exterior'),
      encodeIptcRecord(2, 25, 'portret')
    ]);
    const result = parseIptc(buildJpegWithIptc(records));
    expect(result.keywords).toEqual(['nunta', 'exterior', 'portret']);
  });

  it('foloseste Object Name (2:5) ca fallback pentru headline, daca 2:105 lipseste', () => {
    const records = encodeIptcRecord(2, 5, 'Titlu din Object Name');
    const result = parseIptc(buildJpegWithIptc(records));
    expect(result.headline).toBe('Titlu din Object Name');
  });

  it('ignora inregistrarile din alte record-uri (ex. Record 1, Envelope)', () => {
    const records = concatBytes([
      encodeIptcRecord(1, 90, 'ISO-8859-1'), // Record 1 (Envelope) — nu Application Record
      encodeIptcRecord(2, 80, 'Autor Real')
    ]);
    const result = parseIptc(buildJpegWithIptc(records));
    expect(result.byline).toBe('Autor Real');
    expect(Object.keys(result)).toEqual(['byline']);
  });

  it('returneaza obiect gol pentru un JPEG fara segment APP13', () => {
    const soi = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = parseIptc(soi.buffer);
    expect(result).toEqual({});
  });

  it('returneaza obiect gol pentru un buffer care nu e deloc JPEG', () => {
    const result = parseIptc(new Uint8Array([0, 1, 2, 3]).buffer);
    expect(result).toEqual({});
  });

  it('trunchiaza spatiile albe din valori', () => {
    const records = encodeIptcRecord(2, 80, '  Ion Popescu  ');
    const result = parseIptc(buildJpegWithIptc(records));
    expect(result.byline).toBe('Ion Popescu');
  });
});
