import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EngineRing, arcOffset, CIRCUMFERENCE } from './EngineRing';

describe('arcul inelului', () => {
  it('gol la 0, plin la 100', () => {
    expect(arcOffset(0)).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(arcOffset(100)).toBeCloseTo(0, 5);
  });

  it('jumatate la 50', () => {
    expect(arcOffset(50)).toBeCloseTo(CIRCUMFERENCE / 2, 5);
  });

  it('valorile din afara intervalului se string la capete, nu deseneaza peste ele insele', () => {
    expect(arcOffset(-30)).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(arcOffset(140)).toBeCloseTo(0, 5);
    // Un dashoffset negativ ar insemna un arc mai lung decat cercul.
    expect(arcOffset(140)).toBeGreaterThanOrEqual(0);
  });
});

describe('EngineRing', () => {
  it('doua inele pe acelasi ecran nu-si fura gradientul', () => {
    const { container } = render(<><EngineRing percent={20} /><EngineRing percent={80} /></>);
    const ids = [...container.querySelectorAll('linearGradient')].map(g => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // ...si fiecare arc chiar trimite la gradientul lui.
    const arcs = [...container.querySelectorAll('circle[stroke^="url("]')].map(c => c.getAttribute('stroke'));
    expect(arcs).toEqual(ids.map(id => `url(#${id})`));
  });

  it('scrie eticheta in mijloc, cand primeste una', () => {
    const { container } = render(<EngineRing percent={89} label="89" />);
    expect(container.querySelector('.engine-ring b')?.textContent).toBe('89');
  });

  it('fara eticheta ramane doar inelul', () => {
    const { container } = render(<EngineRing percent={89} />);
    expect(container.querySelector('.engine-ring b')).toBeNull();
  });
});
