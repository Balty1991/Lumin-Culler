import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import { useStore, type PhotoView } from '../state/store';

/**
 * ui/BottomNav.test.tsx
 * Pastila care marcheaza tabul activ a fost mutata de pe `layoutId`
 * (framer-motion, cu tot motorul lui de proiectie in bundle) pe o pista CSS de
 * 4 coloane si o variabila `--nav-active`. Miscarea e aceeasi; ce se putea
 * strica in tacere e alinierea — pastila pe alt tab decat cel activ arata exact
 * ca o aplicatie care nu stie unde esti.
 *
 * De-aia testele verifica DOUA lucruri, nu unul:
 *  - exista mereu exact O pastila (bug-ul de care fugea si varianta cu
 *    `layoutId`: doua pastile vizibile in acelasi timp);
 *  - indexul ei e cel al tabului activ, pentru fiecare dintre cele patru
 *    taburi, plus starea "niciun tab activ" (esti pe Acasa), unde se ascunde in
 *    loc sa gliseze inapoi pe Grila.
 */
function unaPoza(): PhotoView {
  // BottomNav nu se randeaza deloc pe o biblioteca goala.
  return { id: 1, name: 'a.jpg', status: 'pending' } as unknown as PhotoView;
}

const INCHIS = {
  collectionsOpen: false, personsOpen: false, menuOpen: false,
  exportDestinationsOpen: false, homeGridOpen: false, tiktokSortOpen: false
};

function pastila(container: HTMLElement) {
  const toate = container.querySelectorAll('.bottom-nav-pill');
  expect(toate.length, 'trebuie sa existe fix o pastila').toBe(1);
  return toate[0] as HTMLElement;
}

describe('BottomNav — pastila tabului activ', () => {
  beforeEach(() => {
    useStore.setState({ locale: 'ro', photos: [unaPoza()], ...INCHIS });
  });

  it('nu randeaza nimic cat timp nu exista poze', () => {
    useStore.setState({ photos: [] });
    const { container } = render(<BottomNav />);
    expect(container.querySelector('.bottom-nav')).toBeNull();
  });

  it.each([
    ['Grila', { homeGridOpen: true }, '0'],
    ['Persoane', { personsOpen: true }, '1'],
    ['Export', { exportDestinationsOpen: true }, '2'],
    ['Setari', { menuOpen: true }, '3']
  ])('pe %s pastila sta pe coloana corespunzatoare', (_nume, stare, index) => {
    useStore.setState({ ...INCHIS, ...stare });
    const { container } = render(<BottomNav />);
    const p = pastila(container);
    expect(p.style.getPropertyValue('--nav-active')).toBe(index);
    expect(p.dataset.hidden).toBeUndefined();
  });

  it('fara niciun tab deschis (ecranul Acasa) pastila se ascunde, nu gliseaza pe Grila', () => {
    const { container } = render(<BottomNav />);
    expect(pastila(container).dataset.hidden).toBe('true');
  });

  it('sortarea rapida deschisa peste grila scoate marcajul de pe Grila', () => {
    // Aceeasi regula ca la clasa `active` a tabului: revizuirea se deschide
    // PESTE grila, deci bara n-are voie sa spuna in continuare "esti pe Grila".
    useStore.setState({ ...INCHIS, homeGridOpen: true, tiktokSortOpen: true });
    const { container } = render(<BottomNav />);
    expect(pastila(container).dataset.hidden).toBe('true');
    expect(container.querySelector('.bottom-nav-tab.active')).toBeNull();
  });
});
