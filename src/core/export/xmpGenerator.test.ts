import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateXMPSidecar, deriveXmpKeywords, deriveAiScoreKeyword, deriveSeriesKeyword, exportXMPSidecars } from './xmpGenerator';

const getDirectoryPicker = vi.fn<() => null>(() => null);
const downloadZip = vi.fn<(name: string, entries: { path: string; data: Uint8Array }[]) => Promise<{ cancelled: boolean }>>(async () => ({ cancelled: false }));
const downloadBlob = vi.fn<(name: string, blob: Blob) => Promise<{ cancelled: boolean }>>(async () => ({ cancelled: false }));

vi.mock('./directoryPicker', async importOriginal => {
  const actual = await importOriginal<typeof import('./directoryPicker')>();
  return {
    ...actual,
    getDirectoryPicker: () => getDirectoryPicker(),
    downloadZip: (name: string, entries: { path: string; data: Uint8Array }[]) => downloadZip(name, entries),
    downloadBlob: (name: string, blob: Blob) => downloadBlob(name, blob)
  };
});

describe('generateXMPSidecar', () => {
  it('uses the manual star rating when present', () => {
    expect(generateXMPSidecar('selected', 3)).toContain('xmp:Rating="3"');
  });

  it('falls back to the status convention when no manual rating exists', () => {
    expect(generateXMPSidecar('selected')).toContain('xmp:Rating="5"');
    expect(generateXMPSidecar('review')).toContain('xmp:Rating="0"');
  });

  it('ignores a 0 rating (treated as "no rating"), falling back to the status convention', () => {
    expect(generateXMPSidecar('selected', 0)).toContain('xmp:Rating="5"');
  });

  it('a rejected photo always gets -1, even with a leftover star rating', () => {
    const xmp = generateXMPSidecar('rejected', 4);
    expect(xmp).toContain('xmp:Rating="-1"');
    expect(xmp).not.toContain('xmp:Rating="4"');
  });

  it('always writes the status color label regardless of rating', () => {
    expect(generateXMPSidecar('selected', 2)).toContain('xmp:Label="Green"');
    expect(generateXMPSidecar('rejected', 2)).toContain('xmp:Label="Red"');
  });

  it('omits dc:subject entirely when there are no keywords', () => {
    expect(generateXMPSidecar('selected', 3)).not.toContain('dc:subject');
  });

  it('writes each keyword as an rdf:li inside dc:subject/rdf:Bag', () => {
    const xmp = generateXMPSidecar('selected', 3, ['Ami', 'Portret copil']);
    expect(xmp).toContain('<dc:subject>');
    expect(xmp).toContain('<rdf:li>Ami</rdf:li>');
    expect(xmp).toContain('<rdf:li>Portret copil</rdf:li>');
  });

  it('escapes XML-sensitive characters in keywords', () => {
    const xmp = generateXMPSidecar('selected', 3, ['Tom & Jerry <2>']);
    expect(xmp).toContain('Tom &amp; Jerry &lt;2&gt;');
    expect(xmp).not.toContain('Tom & Jerry <2>');
  });

  it('omits AI metadata when none is given', () => {
    const xmp = generateXMPSidecar('selected', 3);
    expect(xmp).not.toContain('lc:AIScore');
    expect(xmp).not.toContain('lc:SeriesId');
    expect(xmp).not.toContain('lc:AIFactors');
    expect(xmp).not.toContain('Iptc4xmpCore:Location');
    expect(xmp).not.toContain('Iptc4xmpExt:Event');
  });

  // Bug real gasit de auditul QA: Location era scris ca photoshop:Location,
  // dar "Location" NU e o proprietate reala a schemei Photoshop (aceea
  // defineste doar City/State/Country/Headline etc.) — apartine schemei
  // Iptc4xmpCore, singurul namespace pe care Lightroom chiar il citeste
  // pentru panoul de metadate "Locatie". Event e Lang Alt in schema IPTC
  // Extension (ca dc:description), nu text simplu.
  it('embeds location as the standard Iptc4xmpCore:Location field and event as an Iptc4xmpExt:Event Lang Alt', () => {
    const xmp = generateXMPSidecar('selected', 3, undefined, { location: 'Brasov', event: 'Nunta', client: 'Ana & Mihai' });
    expect(xmp).toContain('xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/"');
    expect(xmp).toContain('xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"');
    expect(xmp).toContain('<Iptc4xmpCore:Location>Brasov</Iptc4xmpCore:Location>');
    expect(xmp).toContain('<Iptc4xmpExt:Event>\n     <rdf:Alt>\n      <rdf:li xml:lang="x-default">Nunta</rdf:li>\n     </rdf:Alt>\n    </Iptc4xmpExt:Event>');
    expect(xmp).toContain('lc:Client="Ana &amp; Mihai"');
  });

  it('embeds AI score, series id and decision factors in the lc: namespace when given', () => {
    const xmp = generateXMPSidecar('selected', 3, undefined, {
      aiScore: 87.4,
      groupId: 'g-abcdef01',
      aiFactors: ['Claritate (+)', 'Ochi inchisi (-)']
    });
    expect(xmp).toContain('xmlns:lc="https://luminculler.app/xmp/1.0/"');
    expect(xmp).toContain('lc:AIScore="87"');
    expect(xmp).toContain('lc:SeriesId="g-abcdef01"');
    expect(xmp).toContain('<lc:AIFactors>');
    expect(xmp).toContain('<rdf:li>Claritate (+)</rdf:li>');
    expect(xmp).toContain('<rdf:li>Ochi inchisi (-)</rdf:li>');
  });

  it('omits dc:description entirely when no caption is given', () => {
    const xmp = generateXMPSidecar('selected', 3);
    expect(xmp).not.toContain('dc:description');
  });

  it('writes the caption as a Dublin Core dc:description Lang Alt (x-default), the format Lightroom/Bridge read as "Caption"', () => {
    const xmp = generateXMPSidecar('selected', 3, undefined, { caption: 'Mireasa la altar' });
    expect(xmp).toContain('<dc:description>');
    expect(xmp).toContain('<rdf:Alt>');
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Mireasa la altar</rdf:li>');
  });

  it('escapes XML-sensitive characters in the caption', () => {
    const xmp = generateXMPSidecar('selected', 3, undefined, { caption: 'Tom & Jerry <2>' });
    expect(xmp).toContain('Tom &amp; Jerry &lt;2&gt;');
    expect(xmp).not.toContain('Tom & Jerry <2>');
  });
});

describe('deriveAiScoreKeyword', () => {
  it('buckets the raw score into a decile range', () => {
    expect(deriveAiScoreKeyword(87)).toBe('IA 80-89');
    expect(deriveAiScoreKeyword(0)).toBe('IA 0-9');
    expect(deriveAiScoreKeyword(100)).toBe('IA 90-99');
  });
});

describe('deriveSeriesKeyword', () => {
  it('prefixes the group id so it is searchable in Lightroom keywords', () => {
    expect(deriveSeriesKeyword('g-abcdef01')).toBe('Serie g-abcdef01');
  });
});

describe('deriveXmpKeywords', () => {
  it('includes known person names', () => {
    expect(deriveXmpKeywords(['Ami', 'Radu'], undefined)).toEqual(['Ami', 'Radu']);
  });

  it('appends the Romanian scene label when recognized', () => {
    expect(deriveXmpKeywords([], 'child_portrait')).toEqual(['Portret copil']);
    expect(deriveXmpKeywords(['Ami'], 'family_group')).toEqual(['Ami', 'Grup familie']);
  });

  it('ignores an unrecognized scene semantic', () => {
    expect(deriveXmpKeywords(['Ami'], 'something_unknown')).toEqual(['Ami']);
  });
});

describe('exportXMPSidecars (fallback fara File System Access API)', () => {
  beforeEach(() => {
    getDirectoryPicker.mockReturnValue(null);
    downloadZip.mockClear();
    downloadBlob.mockClear();
  });

  it('un singur sidecar: descarcare directa, NU zip', async () => {
    const result = await exportXMPSidecars([{ fileName: 'a.jpg', status: 'selected', rating: 5 }]);
    expect(result.exported).toBe(1);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadZip).not.toHaveBeenCalled();
  });

  it('mai multe sidecar-uri: O SINGURA arhiva .zip, nu descarcari secventiale', async () => {
    const result = await exportXMPSidecars([
      { fileName: 'a.jpg', status: 'selected', rating: 5 },
      { fileName: 'b.jpg', status: 'rejected' },
      { fileName: 'c.jpg', status: 'review', rating: 3 }
    ]);
    expect(result.exported).toBe(3);
    expect(downloadZip).toHaveBeenCalledTimes(1);
    expect(downloadBlob).not.toHaveBeenCalled();
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.map(e => e.path).sort()).toEqual(['a.xmp', 'b.xmp', 'c.xmp']);
  });

  // Bug real gasit de auditul QA: exportul XMP e mereu plat, deci doua poze
  // cu acelasi nume de fisier (carduri de memorie diferite) generau acelasi
  // "nume.xmp" si se suprascriau silentios una pe alta in zip.
  it('dezambiguizeaza doua poze cu acelasi nume de fisier (exportul XMP e mereu plat)', async () => {
    const result = await exportXMPSidecars([
      { fileName: 'IMG_0001.jpg', status: 'selected', rating: 5 },
      { fileName: 'IMG_0001.jpg', status: 'rejected' }
    ]);
    expect(result.exported).toBe(2);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.map(e => e.path).sort()).toEqual(['IMG_0001 (2).xmp', 'IMG_0001.xmp']);
  });

  it('un singur sidecar: raporteaza 0 exportate (nu 1) daca utilizatorul anuleaza dialogul de salvare', async () => {
    downloadBlob.mockResolvedValueOnce({ cancelled: true });
    const result = await exportXMPSidecars([{ fileName: 'a.jpg', status: 'selected', rating: 5 }]);
    expect(result).toEqual({ exported: 0, method: 'downloads', cancelled: true });
  });

  it('mai multe sidecar-uri: raporteaza 0 exportate daca utilizatorul anuleaza dialogul de salvare al arhivei .zip', async () => {
    downloadZip.mockResolvedValueOnce({ cancelled: true });
    const result = await exportXMPSidecars([
      { fileName: 'a.jpg', status: 'selected', rating: 5 },
      { fileName: 'b.jpg', status: 'rejected' }
    ]);
    expect(result).toEqual({ exported: 0, method: 'downloads', cancelled: true });
  });
});
