import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AdjustedImage } from './AdjustedImage';
import { NEUTRAL_ADJUSTMENTS } from '../core/imageAdjust';

const EDITED = { ...NEUTRAL_ADJUSTMENTS, exposure: 40 };

/**
 * O poza cu ajustari era randata ca <canvas>, iar toate regulile de asezare
 * din foile de stil sunt scrise pe `img`. Rezultatul, vazut pe telefon in
 * compararea unei serii: cadrul editat iesea la marimea lui naturala, lung
 * cat cateva ecrane. Nodul din DOM trebuie sa ramana <img> in ambele cazuri.
 */
describe('AdjustedImage', () => {
  it('fara ajustari randeaza un img', () => {
    const { container } = render(<AdjustedImage src="blob:a" alt="poza" className="x" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('cu ajustari randeaza tot un img, nu canvas', () => {
    const { container } = render(
      <AdjustedImage src="blob:a" alt="poza" className="x" edits={EDITED} />
    );
    expect(container.querySelector('canvas')).toBeNull();
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.className).toBe('x');
  });

  it('pana se calculeaza versiunea ajustata arata originalul, nu un gol', () => {
    const { container } = render(
      <AdjustedImage src="blob:original" alt="poza" edits={EDITED} />
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:original');
  });
});
