import { describe, expect, it } from 'vitest';
import { makePdf } from './pdf';

describe('makePdf', () => {
  it('face un PDF cu o pagină pe imagine și xref corect', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = makePdf([{ jpeg, width: 10, height: 14 }, { jpeg, width: 10, height: 14 }]);
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    const xrefAt = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const first = Number(text.match(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/)![1]);
    expect(text.slice(first, first + 7)).toBe('1 0 obj');
  });
});
