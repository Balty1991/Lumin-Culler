import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewClusterSummary } from './ReviewClusterSummary';
import { useStore } from '../state/store';
import type { PhotoView } from '../state/store';

/**
 * ui/ReviewClusterSummary.test.tsx
 *
 * Regula pe care o pazesc testele astea: CIFRA DIN GRUP SI CE PRIMESTI CAND O
 * APESI trebuie sa fie acelasi lucru. Aplicatia are deja filtre "neclare" si
 * "clipite", dar ele folosesc alte praguri — sunt facute pentru ce e SIGUR de
 * respins automat, nu pentru ce e un defect. Legate de ele, grupul ar fi spus
 * 30 si ar fi aratat 18. Exact felul de minciuna mica pe care aplicatia asta
 * o evita peste tot.
 */
/** O poza de verificat, cu doar campurile pe care gruparea chiar le citeste. */
function poza(over: Partial<PhotoView> & { id: string }): PhotoView {
  const baza = { status: 'review', sharpness: 80, exposure: 55, faceCount: 0, allEyesOpen: true, aiScore: 50 };
  return { ...baza, ...over } as PhotoView;
}

beforeEach(() => {
  useStore.setState({ locale: 'ro', photos: [], tiktokSortOpen: false, tiktokSortScopeIds: null });
});

describe('cand rezumatul nu spune nimic, nu apare', () => {
  it('coada scurta: nimic', () => {
    useStore.setState({ photos: [poza({ id: '1', sharpness: 10 }), poza({ id: '2' })] });
    const { container } = render(<ReviewClusterSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('coada omogena: nimic — ar repeta acelasi lucru cu mai multe cuvinte', () => {
    useStore.setState({ photos: Array.from({ length: 20 }, (_, i) => poza({ id: `${i}`, sharpness: 10 })) });
    const { container } = render(<ReviewClusterSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('numara doar pozele de VERIFICAT, nu tot ce e in biblioteca', () => {
    useStore.setState({ photos: [
      ...Array.from({ length: 20 }, (_, i) => poza({ id: `s${i}`, status: 'selected', sharpness: 10 })),
      poza({ id: 'r1' }), poza({ id: 'r2', sharpness: 10 })
    ] });
    const { container } = render(<ReviewClusterSummary />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('cand vorbeste', () => {
  const coada = [
    ...Array.from({ length: 6 }, (_, i) => poza({ id: `b${i}`, sharpness: 10 })),
    ...Array.from({ length: 3 }, (_, i) => poza({ id: `o${i}` })),
    poza({ id: 'e1', faceCount: 2, allEyesOpen: false })
  ];

  it('arata fiecare grup cu numarul lui, cel mare primul', () => {
    useStore.setState({ photos: coada });
    render(<ReviewClusterSummary />);
    const randuri = screen.getAllByRole('button');
    expect(randuri[0]).toHaveTextContent('6');
    expect(randuri[0]).toHaveTextContent('neclare');
    expect(screen.getByText(/CELE 10 DE VERIFICAT/)).toBeInTheDocument();
  });

  it('apasarea deschide sortarea EXACT pe pozele numarate', () => {
    // Piatra de temelie: 6 in grup inseamna 6 la deschidere. Nu 4, nu 9.
    useStore.setState({ photos: coada });
    render(<ReviewClusterSummary />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    const stare = useStore.getState();
    expect(stare.tiktokSortOpen).toBe(true);
    expect(stare.tiktokSortScopeIds).toHaveLength(6);
    expect(stare.tiktokSortScopeIds).toEqual(expect.arrayContaining(['b0', 'b5']));
  });

  it('suma grupurilor de pe ecran e chiar totalul anuntat', () => {
    // Un rezumat care nu se aduna e mai rau decat niciun rezumat.
    useStore.setState({ photos: coada });
    render(<ReviewClusterSummary />);
    const sume = screen.getAllByRole('button').map(b => Number(b.querySelector('b')!.textContent));
    expect(sume.reduce((a, n) => a + n, 0)).toBe(coada.length);
  });
});
