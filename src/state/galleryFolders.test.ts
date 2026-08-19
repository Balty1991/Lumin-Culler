import { describe, it, expect, beforeEach } from 'vitest';
import {
  readExcludedFolderIds, writeExcludedFolderIds, suggestExcluded, sortFolders, includedPhotoCount,
  type GalleryFolder
} from './galleryFolders';

const f = (id: string, name: string, count: number): GalleryFolder => ({ id, name, count });

describe('galleryFolders', () => {
  beforeEach(() => localStorage.clear());

  it('fara nimic salvat, nimic nu e exclus', () => {
    expect(readExcludedFolderIds().size).toBe(0);
  });

  it('excluderile supravietuiesc unei reincarcari', () => {
    writeExcludedFolderIds(new Set(['a', 'b']));
    expect([...readExcludedFolderIds()].sort()).toEqual(['a', 'b']);
  });

  it('ignora o valoare corupta in loc sa arunce', () => {
    localStorage.setItem('lumin-excluded-folders', '{nu e json');
    expect(readExcludedFolderIds().size).toBe(0);
    localStorage.setItem('lumin-excluded-folders', '{"a":1}');
    expect(readExcludedFolderIds().size).toBe(0);
    localStorage.setItem('lumin-excluded-folders', '["a", 7, "", "b"]');
    expect([...readExcludedFolderIds()].sort()).toEqual(['a', 'b']);
  });

  it('propune folderele de trafic, nu pe cele de amintiri', () => {
    const s = suggestExcluded([
      f('1', 'Camera', 900), f('2', 'Screenshots', 400), f('3', 'WhatsApp Images', 1200),
      f('4', 'DCIM', 50), f('5', 'Download', 30), f('6', 'Vacanta Grecia', 200)
    ]);
    expect([...s].sort()).toEqual(['2', '3', '5']);
  });

  it('propunerea nu e sensibila la majuscule sau spatii', () => {
    const s = suggestExcluded([f('1', '  SCREENSHOTS ', 10), f('2', 'whatsapp images', 10)]);
    expect(s.size).toBe(2);
  });

  it('nu exclude un folder doar pentru ca numele lui contine un cuvant din lista', () => {
    // "Download" da; "Downloadable art" nu — altfel am ascunde foldere personale
    const s = suggestExcluded([f('1', 'Downloadable art', 10), f('2', 'Poze download vechi', 10)]);
    expect(s.size).toBe(0);
  });

  it('ordoneaza folderele incluse inaintea celor excluse, dupa marime', () => {
    const folders = [f('a', 'A', 10), f('b', 'B', 900), f('c', 'C', 500)];
    const sorted = sortFolders(folders, new Set(['b']));
    expect(sorted.map(x => x.id)).toEqual(['c', 'a', 'b']);
  });

  it('numara doar pozele din folderele incluse', () => {
    const folders = [f('a', 'A', 10), f('b', 'B', 900), f('c', 'C', 500)];
    expect(includedPhotoCount(folders, new Set(['b']))).toBe(510);
    expect(includedPhotoCount(folders, new Set())).toBe(1410);
    expect(includedPhotoCount(folders, new Set(['a', 'b', 'c']))).toBe(0);
  });
});
