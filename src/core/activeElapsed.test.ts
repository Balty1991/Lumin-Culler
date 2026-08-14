import { describe, it, expect } from 'vitest';
import { createActiveElapsed } from './activeElapsed';

describe('createActiveElapsed', () => {
  it('numara timpul cat aplicatia e vizibila', () => {
    const clock = createActiveElapsed(true, 1000);
    expect(clock.elapsedMs(4000)).toBe(3000);
  });

  // Cazul raportat de utilizator: 5 minute minimizat nu trebuie sa intre in rata.
  it('nu numara timpul cat aplicatia e minimizata', () => {
    const clock = createActiveElapsed(true, 0);
    clock.setVisible(false, 10_000);
    clock.setVisible(true, 310_000); // 5 minute in fundal
    expect(clock.elapsedMs(315_000)).toBe(15_000);
  });

  it('ignora marcajele redundante de vizibilitate', () => {
    const clock = createActiveElapsed(true, 0);
    clock.setVisible(true, 5_000);
    clock.setVisible(true, 8_000);
    expect(clock.elapsedMs(10_000)).toBe(10_000);
  });

  it('porneste de la zero cand importul incepe cu aplicatia deja ascunsa', () => {
    const clock = createActiveElapsed(false, 0);
    expect(clock.elapsedMs(60_000)).toBe(0);
    clock.setVisible(true, 60_000);
    expect(clock.elapsedMs(62_000)).toBe(2_000);
  });

  it('nu scade niciodata, chiar daca ceasul sistemului da inapoi', () => {
    const clock = createActiveElapsed(true, 10_000);
    expect(clock.elapsedMs(5_000)).toBe(0);
  });
});
