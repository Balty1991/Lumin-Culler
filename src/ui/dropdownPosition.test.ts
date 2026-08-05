import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { computeMenuPosition } from './dropdownPosition';

function rect(overrides: Partial<DOMRect>): DOMRect {
  return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}), ...overrides } as DOMRect;
}

describe('computeMenuPosition', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 480, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: originalHeight, configurable: true });
  });

  it('ancoreaza la stanga cand butonul e departe de marginea dreapta (comportament neschimbat)', () => {
    const pos = computeMenuPosition(rect({ left: 20, right: 60, top: 100, bottom: 140 }));
    expect(pos.left).toBe(20);
    expect(pos.right).toBeUndefined();
  });

  // Bug real gasit la verificare vizuala: CollectionPicker.tsx in DetailView —
  // ultima iconita dintr-o bara lipita de marginea dreapta a ecranului producea
  // un meniu taiat, cand pozitionarea folosea mereu `left: rect.left`.
  it('ancoreaza la dreapta cand butonul e aproape de marginea dreapta a ecranului', () => {
    const pos = computeMenuPosition(rect({ left: 430, right: 470, top: 100, bottom: 140 }));
    expect(pos.right).toBe(480 - 470);
    expect(pos.left).toBeUndefined();
  });

  it('alege directia cu mai mult spatiu orizontal, nu doar "aproape de margine"', () => {
    // trigger la mijlocul ecranului (480 latime) — spatiu aproape egal, usor mai mult la dreapta
    const posRight = computeMenuPosition(rect({ left: 230, right: 250, top: 100, bottom: 140 }));
    expect(posRight.left).toBe(230);
    // usor mai mult spatiu la stanga
    const posLeft = computeMenuPosition(rect({ left: 250, right: 270, top: 100, bottom: 140 }));
    expect(posLeft.right).toBe(480 - 270);
  });

  it('pastreaza logica verticala neschimbata (deschide in jos cand e loc)', () => {
    const pos = computeMenuPosition(rect({ left: 20, right: 60, top: 100, bottom: 140 }));
    expect(pos.top).toBe(140 + 6);
    expect(pos.bottom).toBeUndefined();
  });

  it('deschide in sus cand nu e loc dedesubt, dar e mai mult deasupra', () => {
    const pos = computeMenuPosition(rect({ left: 20, right: 60, top: 850, bottom: 890 }));
    expect(pos.bottom).toBe(900 - 850 + 6);
    expect(pos.top).toBeUndefined();
  });
});
