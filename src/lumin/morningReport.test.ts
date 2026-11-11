import { describe, it, expect } from 'vitest';
import { buildMorningReport } from './morningReport';
import type { PhotoView } from '../state/store';

const now = new Date(2026, 10, 11, 8).getTime();
const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
const base = { importedAt: 0, personNames: [], faceCount: 0, aiScore: 50, status: 'review' } as unknown as PhotoView;
const p = (id: string, extra: Partial<PhotoView>): PhotoView => ({ ...base, id, capturedAt: at(10, 12), ...extra } as PhotoView);

describe('raportul de dimineață', () => {
  it('numără ziua de ieri: păstrate (cele mai bune primele), de hotărât, puse deoparte', () => {
    const r = buildMorningReport([
      p('a', { status: 'selected', aiScore: 60 }), p('b', { status: 'selected', aiScore: 95 }),
      p('c', {}), p('d', { status: 'rejected' }), p('e', { status: 'rejected' }),
      p('azi', { capturedAt: at(11, 7) }), p('bon', { aside: 'document' })
    ], now);
    expect(r).toMatchObject({ total: 5, dropped: 2 });
    expect(r?.kept.map(x => x.id)).toEqual(['b', 'a']);
    expect(r?.waiting.map(x => x.id)).toEqual(['c']);
  });
  it('tace când ieri au fost prea puține poze', () => {
    expect(buildMorningReport([p('a', {}), p('b', {})], now)).toBeNull();
  });
});
