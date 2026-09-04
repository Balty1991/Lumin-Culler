import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CullStrengthBar } from './CullStrengthBar';
import { useStore } from '../state/store';
import type { PhotoView } from '../state/store';

/**
 * ui/CullStrengthBar.test.tsx
 *
 * Cazul pazit aici a fost gasit rezultand aplicatia cap-coada cu poze reale,
 * nu citind cod: bara arata "4 / 4 / 4" — trei butoane care promit exact
 * acelasi lucru. Cifrele erau corecte, si tocmai de-aia era mai rau. Un om care
 * apasa si nu vede nicio schimbare invata ca setarea nu face nimic si n-o mai
 * atinge niciodata, inclusiv cand ar conta.
 */
function poza(over: Partial<PhotoView> & { id: string }): PhotoView {
  const baza = { status: 'review', aiScore: 50, sharpness: 70, exposure: 55, faceCount: 0, allEyesOpen: true };
  return { ...baza, ...over } as PhotoView;
}

beforeEach(() => {
  useStore.setState({ locale: 'ro', cullingStrictness: 'balanced' });
});

describe('cand cele trei trepte dau acelasi rezultat', () => {
  it('SPUNE de ce sunt egale, in loc sa lase trei cifre identice', () => {
    // Scoruri departe de orice prag: nicio deplasare de opt puncte nu misca
    // vreo poza, deci toate trei trepte dau acelasi numar.
    useStore.setState({ photos: Array.from({ length: 4 }, (_, i) => poza({ id: `${i}`, aiScore: 50 })) });
    render(<CullStrengthBar />);
    expect(screen.getByText(/cele trei niveluri dau același rezultat/)).toBeInTheDocument();
  });

  it('cifrele NU se ascund — sunt adevarate, doar aveau nevoie de explicatie', () => {
    useStore.setState({ photos: Array.from({ length: 4 }, (_, i) => poza({ id: `${i}`, aiScore: 50 })) });
    render(<CullStrengthBar />);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});

describe('cand treptele chiar difera', () => {
  it('ramane indiciul obisnuit, nu explicatia', () => {
    // Scoruri imprastiate chiar peste praguri SI cate o fata in fiecare cadru.
    // Fata nu e decor in acest test: fara ea, decidePhotoStatus refuza
    // auto-selectarea indiferent de scor (vezi core/subjectGuard.test.ts), deci
    // toate cele trei trepte ar da acelasi numar si testul ar masura altceva
    // decat crede ca masoara.
    useStore.setState({
      photos: Array.from({ length: 30 }, (_, i) => poza({ id: `${i}`, aiScore: 20 + i * 2, faceCount: 1 }))
    });
    render(<CullStrengthBar />);
    expect(screen.queryByText(/cele trei niveluri dau același rezultat/)).not.toBeInTheDocument();
  });
});

describe('bara nu apare cand n-are ce prezice', () => {
  it('fara poze nedecise, nimic', () => {
    useStore.setState({ photos: [poza({ id: '1', status: 'selected' }), poza({ id: '2', status: 'rejected' })] });
    const { container } = render(<CullStrengthBar />);
    expect(container).toBeEmptyDOMElement();
  });
});
