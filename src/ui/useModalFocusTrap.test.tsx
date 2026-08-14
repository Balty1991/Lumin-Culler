import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent } from '@testing-library/react';
import { useModalFocusTrap } from './useModalFocusTrap';

function Modal({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocusTrap(ref, active);
  return (
    <div ref={ref} tabIndex={-1} data-testid="modal">
      {/* Butonul ascuns e ULTIMUL in DOM intentionat: daca filtrul de
          vizibilitate n-ar functiona, el ar deveni capatul ciclului si Tab de pe
          "ultimul" real n-ar mai fi prins deloc de capcana. */}
      <button data-testid="first">primul</button>
      <button data-testid="middle">mijloc</button>
      <button data-testid="last">ultimul</button>
      <button data-testid="hidden-btn" style={{ visibility: 'hidden' }}>ascuns</button>
    </div>
  );
}

/**
 * Capcana filtra elementele cu `el.offsetParent !== null`, un test care greseste
 * in ambele sensuri: `offsetParent` e null si pentru un element `position: fixed`
 * perfect vizibil (ex. X-ul din ecranul de bun venit, exclus astfel din lista) si
 * NU e null pentru `visibility: hidden`, peste care browserul chiar sare la Tab.
 * In ambele cazuri `first`/`last` nu erau capetele reale ale ciclului, deci la
 * capat Tab-ul iesea din panou in pagina de dedesubt.
 */
describe('useModalFocusTrap', () => {
  const rects = [{ x: 0, y: 0, width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, toJSON: () => ({}) }] as unknown as DOMRectList;

  beforeEach(() => {
    // jsdom nu calculeaza layout: fara asta `getClientRects()` intoarce mereu gol
    // si hook-ul cade pe lista bruta (rezerva lui deliberata pentru teste).
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue(rects);
  });
  afterEach(() => vi.restoreAllMocks());

  it('Tab de pe ultimul element vizibil se intoarce la primul', () => {
    const { getByTestId } = render(<Modal />);
    getByTestId('last').focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(getByTestId('first'));
  });

  it('Shift+Tab de pe primul element sare la ultimul vizibil', () => {
    const { getByTestId } = render(<Modal />);
    getByTestId('first').focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(getByTestId('last'));
  });

  it('un buton `position: fixed` ramane in ciclu (offsetParent e null pentru el)', () => {
    const { getByTestId } = render(<Modal />);
    const fixed = getByTestId('first');
    fixed.style.position = 'fixed';
    fixed.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    // e tot primul din lista, deci Shift+Tab de pe el trebuie sa sara la ultimul
    expect(document.activeElement).toBe(getByTestId('last'));
  });

  it('restaureaza focusul pe elementul de dinainte cand panoul se inchide', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<Modal active />);
    rerender(<Modal active={false} />);

    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('nu face nimic cat timp panoul e inactiv', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    render(<Modal active={false} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
