import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { PhotoAnchors } from './PhotoAnchors';
import { useStore } from '../state/store';
import { db, type AnalysisRecord, type FaceInsight } from '../core/db';

function face(over: Partial<FaceInsight> = {}): FaceInsight {
  return {
    // Zambet peste prag: de cand eticheta de rezerva a disparut (vezi
    // labelFor), o fata fara nimic de spus nu mai produce nicio ancora.
    box: [0.4, 0.3, 0.2, 0.2], faceScore: 0.9, smile: 0.8,
    eyesOpen: { left: 0.9, right: 0.9 }, isBlinking: false,
    personId: null, personName: null, similarity: 0, ...over
  };
}

const LATIME = 400;
const INALTIME = 600;

/**
 * jsdom nu face layout: fara asta orice element are 0x0, deci componenta ar
 * iesi devreme si testul ar trece degeaba, indiferent ce randeaza.
 */
function stubLayout() {
  globalThis.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { this.cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = function () {
    return { width: LATIME, height: INALTIME, top: 0, left: 0, right: LATIME, bottom: INALTIME, x: 0, y: 0, toJSON: () => ({}) };
  };
}

function Gazda({ photoId, safeBottom }: { photoId: string; safeBottom?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref}><PhotoAnchors photoId={photoId} containerRef={ref} safeBottom={safeBottom} /></div>;
}

/**
 * Lasa sa se rezolve citirea din Dexie SI efectul de masurare care o urmeaza.
 * In `act`, altfel React avertizeaza pe buna dreptate: setarea de stare vine
 * dintr-o promisiune, adica din afara oricarei randari pe care testul o stie.
 */
async function seAseaza() {
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

async function pune(photoId: string, faces: FaceInsight[]) {
  await db.analyses.put({ photoId, faces, faceCount: faces.length } as AnalysisRecord);
}

describe('PhotoAnchors', () => {
  const rectOriginal = Element.prototype.getBoundingClientRect;
  beforeEach(async () => {
    stubLayout();
    await db.analyses.clear();
    useStore.setState({ locale: 'ro', showAnchors: true });
  });
  afterEach(() => { cleanup(); Element.prototype.getBoundingClientRect = rectOriginal; });

  it('deseneaza eticheta tradusa, la procentele calculate de motor', async () => {
    await pune('a', [face({ box: [0.4, 0.3, 0.2, 0.2], isBlinking: true })]);
    const { container } = render(<Gazda photoId="a" />);
    await waitFor(() => expect(container.querySelectorAll('.lc-anchor')).toHaveLength(1));
    const ancora = container.querySelector('.lc-anchor') as HTMLElement;
    expect(ancora.querySelector('b')?.textContent).toBe('ochi închiși');
    expect(ancora.style.left).toBe('50%');
  });

  it('numele persoanei trece prin nemodificat, nu prin dictionar', async () => {
    await pune('a', [face({ personId: 'p1', personName: 'Ana' })]);
    const { container } = render(<Gazda photoId="a" />);
    await waitFor(() => expect(container.querySelector('.lc-anchor b')?.textContent).toBe('Ana'));
  });

  it('zambetul isi primeste virgula zecimala romaneasca', async () => {
    await pune('a', [face({ smile: 0.81 })]);
    const { container } = render(<Gazda photoId="a" />);
    await waitFor(() => expect(container.querySelector('.lc-anchor b')?.textContent).toBe('zâmbet 0,81'));
  });

  it('comutatorul le stinge de tot — vezi core/showAnchors.ts pentru de ce exista', async () => {
    await pune('a', [face({ personId: 'p1', personName: 'Ana' })]);
    useStore.setState({ showAnchors: false });
    const { container } = render(<Gazda photoId="a" />);
    await seAseaza();
    expect(container.querySelectorAll('.lc-anchor')).toHaveLength(0);
  });

  it('o poza fara analiza nu lasa niciun rest pe ecran', async () => {
    const { container } = render(<Gazda photoId="fara-analiza" />);
    await seAseaza();
    expect(container.querySelectorAll('.lc-anchor')).toHaveLength(0);
  });

  it('nu inghite niciun pointer — sub el se ia decizia prin swipe', async () => {
    await pune('a', [face()]);
    const { container } = render(<Gazda photoId="a" />);
    await waitFor(() => expect(container.querySelector('.lc-anchors')).toBeTruthy());
    // Regula chiar traieste in foaie (.lc-anchors { pointer-events: none }),
    // pe care jsdom n-o incarca — verificam ca stratul e marcat ca atare si
    // ca nu si-a pus niciun handler.
    const strat = container.querySelector('.lc-anchors') as HTMLElement;
    expect(strat.getAttribute('aria-hidden')).toBe('true');
    expect(strat.onclick).toBeNull();
    expect(strat.onpointerdown).toBeNull();
  });

  it('banda de jos, data fata de fereastra, chiar ascunde o ancora joasa', async () => {
    await pune('a', [face({ box: [0.4, 0.9, 0.08, 0.08] })]);
    vi.stubGlobal('innerHeight', INALTIME);
    const { container } = render(<Gazda photoId="a" safeBottom={200} />);
    await seAseaza();
    expect(container.querySelectorAll('.lc-anchor')).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('schimbarea pozei nu lasa ancorele celei vechi peste chipul nou', async () => {
    await pune('a', [face({ personId: 'p1', personName: 'Ana' })]);
    await pune('b', []);
    const { container, rerender } = render(<Gazda photoId="a" />);
    await waitFor(() => expect(container.querySelector('.lc-anchor b')?.textContent).toBe('Ana'));
    rerender(<Gazda photoId="b" />);
    await waitFor(() => expect(container.querySelectorAll('.lc-anchor')).toHaveLength(0));
  });
});
