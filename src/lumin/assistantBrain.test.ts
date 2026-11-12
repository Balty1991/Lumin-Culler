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
    expect(answer('fă-mi un film', photos).kind).toBe('reel');
    expect(answer('fă-mi un colaj', photos).kind).toBe('studio');
  });
  it('spune cinstit când nu găsește nimic', () => {
    expect(answer('elefant roz', photos)).toMatchObject({ kind: 'none', query: 'elefant roz', partial: [] });
  });
  it('„Ce mă așteaptă?” deschide sortarea, nu o căutare', () => {
    expect(answer('Ce mă așteaptă?', []).kind).toBe('waiting');
  });
});

import { searchPhotos, termOptions } from './textSearch';
describe('căutarea după ce se vede', () => {
  const cat = p('pisica', { sceneTags: ['cat'], capturedAt: Date.UTC(2026, 2, 21) });
  const bon = p('bon', { sceneTags: ['receipt'], ocrText: 'WHISKAS hrana pisici 12,99', capturedAt: Date.UTC(2026, 3, 2) } as Partial<PhotoView>);
  it('pluralul românesc ajunge la cuvântul de bază', () => {
    expect(termOptions('pisici')).toContain('cat');
    expect(termOptions('caini')).toContain('dog');
    expect(termOptions('torturi')).toContain('cake');
    expect(termOptions('masinile')).toContain('car');
  });
  it('„pisici” găsește pisica, nu bonul pe care scrie „pisici”', () => {
    expect(searchPhotos([cat, bon], 'pisici').map(x => x.id)).toEqual(['pisica']);
  });
  it('când nimic nu se vede în poze, textul citit de pe ele rămâne de folos', () => {
    expect(searchPhotos([cat, bon], 'whiskas').map(x => x.id)).toEqual(['bon']);
  });
});

describe('pisicile nu aduc câinii', () => {
  it('„pisici” nu găsește un câine etichetat și „pet”', () => {
    const dog = p('caine', { sceneTags: ['dog', 'pet'], capturedAt: Date.UTC(2026, 4, 1) });
    const cat = p('pisica', { sceneTags: ['cat', 'pet'], capturedAt: Date.UTC(2026, 4, 2) });
    expect(searchPhotos([dog, cat], 'pisici').map(x => x.id)).toEqual(['pisica']);
    expect(searchPhotos([dog, cat], 'caini').map(x => x.id)).toEqual(['caine']);
  });
});
