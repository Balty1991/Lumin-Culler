import { describe, it, expect } from 'vitest';
import { answer } from './assistantBrain';
import type { PhotoView } from '../state/store';

const base = { importedAt: 0, personNames: [], faceCount: 0, aiScore: 50, status: 'selected' } as unknown as PhotoView;
const p = (id: string, extra: Partial<PhotoView>): PhotoView => ({ ...base, id, ...extra } as PhotoView);
const photos = [
  p('mare', { sceneTags: ['beach'], personNames: ['Mia'], capturedAt: Date.UTC(2025, 6, 19), aiScore: 90 }),
  p('pisica', { sceneTags: ['cat'], capturedAt: Date.UTC(2026, 2, 21), aiScore: 70 }),
  p('mia2', { personNames: ['Mia'], capturedAt: Date.UTC(2026, 9, 11), aiScore: 60 }),
  p('s1', { groupId: 'g', status: 'selected', mediaUri: 'u1' }),
  p('s2', { groupId: 'g', status: 'rejected', mediaUri: 'u2' }),
  p('w', { status: 'review' })
];

describe('asistentul galeriei', () => {
  it('găsește pozele cerute în cuvinte, fără umplutură', () => {
    const r = answer('Arată-mi pozele cu Mia la mare', photos);
    expect(r.kind).toBe('results');
    if (r.kind === 'results') expect(r.photos.map(x => x.id)).toEqual(['mare']);
  });
  it('„cele mai bune poze cu Mia” le ordonează după cât de reușite sunt', () => {
    const r = answer('cele mai bune poze cu Mia', photos);
    expect(r.kind === 'results' && r.best && r.photos.map(x => x.id)).toEqual(['mare', 'mia2']);
  });
  it('înțelege curățenia, statisticile, antrenamentul și adăugarea', () => {
    const c = answer('șterge duplicatele', photos);
    expect(c.kind === 'cleanup' && c.photos.map(x => x.id)).toEqual(['s2']);
    const s = answer('câte poze am?', photos);
    expect(s.kind === 'stats' && [s.total, s.waiting, s.people]).toEqual([6, 1, 1]);
    expect(answer('antrenează-te', photos).kind).toBe('train');
    expect(answer('adaugă poze', photos).kind).toBe('add');
    expect(answer('fă-mi un film', photos).kind).toBe('studio');
  });
  it('spune cinstit când nu găsește nimic', () => {
    expect(answer('elefant roz', photos)).toEqual({ kind: 'none', query: 'elefant roz' });
  });
  it('„Ce mă așteaptă?” deschide sortarea, nu o căutare', () => {
    expect(answer('Ce mă așteaptă?', []).kind).toBe('waiting');
  });
});
