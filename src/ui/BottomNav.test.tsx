import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import { useStore, type PhotoView } from '../state/store';

/**
 * ui/BottomNav.test.tsx
 * Pastila care marcheaza tabul activ a fost mutata de pe `layoutId`
 * (framer-motion, cu tot motorul lui de proiectie in bundle) pe o pista CSS cu
 * o coloana per tab si o variabila `--nav-active`. Miscarea e aceeasi; ce se putea
 * strica in tacere e alinierea — pastila pe alt tab decat cel activ arata exact
 * ca o aplicatie care nu stie unde esti.
 *
 * De-aia testele verifica DOUA lucruri, nu unul:
 *  - exista mereu exact O pastila (bug-ul de care fugea si varianta cu
 *    `layoutId`: doua pastile vizibile in acelasi timp);
 *  - indexul ei e cel al tabului activ, pentru FIECARE tab, plus starile in
 *    care niciunul nu e activ (un panou deschis peste grila).
 *
 * Indicii de mai jos sunt si garda pentru nepotrivirea dintre numarul de taburi
 * din BottomNav.tsx si `grid-template-columns` al pistei din CSS: cand "Acasa"
 * a primit tab propriu, testele astea au picat toate cinci pe loc, exact cum
 * trebuia — o pastila oprita LANGA tabul activ nu da nicio eroare, doar arata
 * ca o aplicatie care nu stie unde esti.
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
    ['Acasa', {}, '0'],
    ['Grila', { homeGridOpen: true }, '1'],
    ['Persoane', { personsOpen: true }, '2'],
    ['Export', { exportDestinationsOpen: true }, '3'],
    ['Setari', { menuOpen: true }, '4']
  ])('pe %s pastila sta pe coloana corespunzatoare', (_nume, stare, index) => {
    useStore.setState({ ...INCHIS, ...stare });
    const { container } = render(<BottomNav />);
    const p = pastila(container);
    expect(p.style.getPropertyValue('--nav-active')).toBe(index);
    expect(p.dataset.hidden).toBeUndefined();
  });

  it('"Acasa" e un tab ca oricare altul, nu absenta tuturor', () => {
    // A stat in coltul din dreapta sus al antetului, unde degetul mare nu
    // ajunge fara sa muti mana. Mutat in bara, ecranul Acasa nu mai e "niciun
    // tab activ" — e tabul zero, marcat ca atare.
    const { container } = render(<BottomNav />);
    expect(pastila(container).dataset.hidden).toBeUndefined();
    expect(container.querySelectorAll('.bottom-nav-tab')).toHaveLength(5);
  });

  it('Acasa si Grila nu pot fi active amandoua, si nici stinse amandoua', () => {
    // Sunt doua fete ale aceleiasi stari (`homeGridOpen`). Daca vreodata s-ar
    // desparti, bara ar arata doua taburi active sau niciunul, si n-ar mai
    // spune unde esti.
    for (const homeGridOpen of [false, true]) {
      useStore.setState({ ...INCHIS, homeGridOpen });
      const { container, unmount } = render(<BottomNav />);
      expect(container.querySelectorAll('.bottom-nav-tab.active')).toHaveLength(1);
      unmount();
    }
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
