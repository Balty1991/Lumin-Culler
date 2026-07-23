import { describe, expect, it } from 'vitest';
import { isRawFile } from './rawDecoder';

function file(name: string): File {
  return new File([new Uint8Array(4)], name);
}

describe('isRawFile', () => {
  it('recognizes common camera RAW extensions, case-insensitively', () => {
    for (const name of ['photo.CR2', 'photo.cr3', 'photo.NEF', 'photo.arw', 'photo.dng', 'photo.RAF', 'photo.orf', 'photo.rw2']) {
      expect(isRawFile(file(name))).toBe(true);
    }
  });

  it('does not treat regular formats as RAW', () => {
    for (const name of ['photo.jpg', 'photo.jpeg', 'photo.png', 'photo.webp', 'photo.avif', 'photo.heic']) {
      expect(isRawFile(file(name))).toBe(false);
    }
  });

  it('matches only the extension, not a substring elsewhere in the name', () => {
    expect(isRawFile(file('rawvacation.jpg'))).toBe(false);
    expect(isRawFile(file('my.raw.notes.txt'))).toBe(false);
  });
});
