import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Workspace } from './Workspace';
import { useStore, type PhotoView } from '../state/store';

function makePhoto(id: string): PhotoView {
  return {
    id,
    fileName: `${id}.jpg`,
    importedAt: 1,
    status: 'review',
    rating: 0,
    aiScore: 50,
    sceneType: 'portrait',
    contextKey: 'portrait:known',
    faceCount: 1,
    knownFaceCount: 1,
    strangerCount: 0,
    bestSmile: 0.5,
    allEyesOpen: true,
    sharpness: 80,
    exposure: 50,
    ruleOfThirds: 0.5,
    headroom: 0.5,
    personNames: []
  } as unknown as PhotoView;
}

/**
 * Regresie pentru un bug real gasit de auditul UI: scurtaturile din Workspace
 * (P/X/0-5/Sageti) sunt definite ca taste SIMPLE, dar nu verificau deloc
 * modificatorii. Orice combinatie de sistem care contine acele litere lua in
 * acelasi timp si o decizie ireversibila asupra pozei curente — Ctrl/Cmd+X
 * (taie) o respingea si sarea mai departe, Ctrl/Cmd+P (tipareste) o selecta,
 * Ctrl/Cmd+1..5 (schimba fila din browser) ii schimba nota. Utilizatorul vedea
 * doar dialogul nativ al browserului, nu si ce se intamplase in spatele lui.
 */
describe('Workspace — scurtaturi de tastatura', () => {
  // jsdom nu are ResizeObserver, iar Workspace il foloseste prin useHeaderBottomVar
  // (masoara inaltimea antetului). Un stub inert e suficient: testele de aici nu
  // depind deloc de layout.
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    } as unknown as typeof ResizeObserver;
  });

  const setStatus = vi.fn(() => Promise.resolve());
  const setRating = vi.fn(() => Promise.resolve());
  const stepDetail = vi.fn();

  beforeEach(() => {
    setStatus.mockClear(); setRating.mockClear(); stepDetail.mockClear();
    useStore.setState({
      locale: 'ro',
      photos: [makePhoto('a'), makePhoto('b')],
      detailId: 'a',
      progress: null,
      setStatus: setStatus as never,
      setRating: setRating as never,
      stepDetail: stepDetail as never
    });
  });

  it('"X" simplu respinge poza curenta si avanseaza', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'x' });
    expect(setStatus).toHaveBeenCalledWith('a', 'rejected');
    expect(stepDetail).toHaveBeenCalledWith(1);
  });

  it('"P" simplu selecteaza poza curenta', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'p' });
    expect(setStatus).toHaveBeenCalledWith('a', 'selected');
  });

  it('Ctrl+X (taie) NU respinge poza', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true });
    expect(setStatus).not.toHaveBeenCalled();
    expect(stepDetail).not.toHaveBeenCalled();
  });

  it('Cmd+P (tipareste) NU selecteaza poza', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'p', metaKey: true });
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('Ctrl+3 (schimba fila din browser) NU schimba nota pozei', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    expect(setRating).not.toHaveBeenCalled();
  });

  it('"3" simplu tot schimba nota', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: '3' });
    expect(setRating).toHaveBeenCalledWith('a', 3);
  });

  it('Alt+Sageata (navigare inapoi in istoricul browserului) NU muta cursorul', () => {
    render(<Workspace />);
    fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    expect(stepDetail).not.toHaveBeenCalled();
  });

  it('tastarea intr-un camp text nu declanseaza scurtaturile', () => {
    render(<Workspace />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'x' });
    expect(setStatus).not.toHaveBeenCalled();
    input.remove();
  });
});
