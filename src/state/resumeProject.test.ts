import { describe, it, expect } from 'vitest';
import { findResumableProjects, pickResumeTarget, MIN_REMAINING, MIN_PERCENT, type ProjectPhoto } from './resumeProject';

const make = (project: string | undefined, statuses: ProjectPhoto['status'][]): ProjectPhoto[] =>
  statuses.map(status => ({ project, status }));

describe('findResumableProjects', () => {
  it('nu propune nimic pentru o biblioteca fara proiecte', () => {
    expect(findResumableProjects(make(undefined, ['pending', 'pending']))).toEqual([]);
  });

  it('ignora numele goale sau numai cu spatii', () => {
    expect(findResumableProjects([
      { project: '   ', status: 'pending' }, { project: '', status: 'selected' }
    ])).toEqual([]);
  });

  it('nu propune un proiect terminat', () => {
    expect(findResumableProjects(make('Nunta', ['selected', 'rejected', 'selected']))).toEqual([]);
  });

  it('nu propune un proiect abia inceput — altfel orice import netriat devine restanta', () => {
    const photos = make('Vacanta', Array(20).fill('pending') as ProjectPhoto['status'][]);
    photos[0].status = 'selected'; // 5%, sub prag
    expect(findResumableProjects(photos)).toEqual([]);
  });

  it('nu propune un proiect caruia i-au ramas prea putine cadre', () => {
    const photos = make('Botez', ['selected', 'selected', 'selected', 'selected', 'pending']);
    expect(photos.filter(p => p.status === 'pending').length).toBeLessThan(MIN_REMAINING);
    expect(findResumableProjects(photos)).toEqual([]);
  });

  it('propune un proiect intrerupt la mijloc, cu cifrele corecte', () => {
    const photos = make('Nunta', [
      'selected', 'selected', 'rejected', 'rejected', 'rejected',
      'pending', 'pending', 'pending', 'pending', 'pending'
    ]);
    const [c] = findResumableProjects(photos);
    expect(c).toEqual({ project: 'Nunta', remaining: 5, decided: 5, total: 10, percent: 50 });
  });

  it('"de verificat" e decizie inceputa, nu luata — ramane de facut', () => {
    const photos = make('Serie', ['selected', 'selected', 'review', 'review', 'review']);
    const [c] = findResumableProjects(photos);
    expect(c.decided).toBe(2);
    expect(c.remaining).toBe(3);
  });

  it('cel mai avansat proiect primul — e mai usor sa termini ce era aproape gata', () => {
    const photos = [
      ...make('Aproape', ['selected', 'selected', 'selected', 'selected', 'selected', 'selected', 'selected', 'pending', 'pending', 'pending']),
      ...make('Inceput', ['selected', 'selected', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'])
    ];
    expect(findResumableProjects(photos).map(c => c.project)).toEqual(['Aproape', 'Inceput']);
  });

  it('la progres egal, propune proiectul cu mai putin de terminat', () => {
    const photos = [
      ...make('Mic', ['selected', 'pending', 'pending', 'pending']),
      ...make('Mare', ['selected', 'selected', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'])
    ];
    const names = findResumableProjects(photos).map(c => c.project);
    expect(names[0]).toBe('Mic');
  });

  it('pragurile sunt cele declarate', () => {
    expect(MIN_REMAINING).toBeGreaterThan(0);
    expect(MIN_PERCENT).toBeGreaterThan(0);
  });
});

describe('pickResumeTarget', () => {
  it('intoarce null cand nu e nimic de reluat', () => {
    expect(pickResumeTarget(make('Gata', ['selected', 'selected']))).toBeNull();
  });

  it('intoarce primul candidat', () => {
    const photos = make('Nunta', ['selected', 'selected', 'pending', 'pending', 'pending']);
    expect(pickResumeTarget(photos)?.project).toBe('Nunta');
  });
});
