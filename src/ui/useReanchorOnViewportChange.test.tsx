import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, act } from '@testing-library/react';
import { useReanchorOnViewportChange } from './dropdownPosition';

function Anchored({ open, place }: { open: boolean; place: (rect: DOMRect) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useReanchorOnViewportChange(open, ref, place);
  return <button ref={ref}>declansator</button>;
}

/** Ruleaza toate rAF-urile in asteptare — hook-ul limiteaza recalcularea la un cadru. */
function flushFrames() {
  act(() => { vi.advanceTimersByTime(32); });
}

/**
 * Bug real comun tuturor celor sase meniuri randate prin portal: pozitia se
 * calcula O SINGURA DATA, la deschidere, dar meniul e `position: fixed`, deci nu
 * se mai misca dupa aceea. Rotirea telefonului sau derularea randului de filtre
 * il lasau agatat, detasat de butonul lui.
 */
describe('useReanchorOnViewportChange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom nu are rAF cu cronometre false — il legam de setTimeout ca sa poata fi avansat.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reancoreaza la redimensionarea ferestrei', () => {
    const place = vi.fn();
    render(<Anchored open place={place} />);
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushFrames();
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('reancoreaza la rotirea ecranului', () => {
    const place = vi.fn();
    render(<Anchored open place={place} />);
    act(() => { window.dispatchEvent(new Event('orientationchange')); });
    flushFrames();
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('vede si derularea unui container interior (ascultare in faza de captura)', () => {
    const place = vi.fn();
    const scroller = document.createElement('div');
    document.body.appendChild(scroller);
    render(<Anchored open place={place} />);
    // `bubbles: false` — exact cum se comporta evenimentele de scroll reale
    act(() => { scroller.dispatchEvent(new Event('scroll', { bubbles: false })); });
    flushFrames();
    expect(place).toHaveBeenCalledTimes(1);
    scroller.remove();
  });

  it('nu face nimic cat timp meniul e inchis', () => {
    const place = vi.fn();
    render(<Anchored open={false} place={place} />);
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushFrames();
    expect(place).not.toHaveBeenCalled();
  });

  it('mai multe evenimente in acelasi cadru produc UN SINGUR recalcul', () => {
    const place = vi.fn();
    render(<Anchored open place={place} />);
    act(() => {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
    });
    flushFrames();
    expect(place).toHaveBeenCalledTimes(1);
  });

  it('se dezaboneaza la demontare', () => {
    const place = vi.fn();
    const { unmount } = render(<Anchored open place={place} />);
    unmount();
    act(() => { window.dispatchEvent(new Event('resize')); });
    flushFrames();
    expect(place).not.toHaveBeenCalled();
  });
});
