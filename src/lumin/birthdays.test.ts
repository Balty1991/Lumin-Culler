import { describe, expect, it } from 'vitest';
import { nextBirthday, parseBirthday } from './birthdays';

describe('birthdays', () => {
  it('citește ziua în formele obișnuite', () => {
    expect(parseBirthday('12.03')).toEqual({ month: 3, day: 12 });
    expect(parseBirthday('5/11/2021')).toEqual({ month: 11, day: 5, year: 2021 });
    expect(parseBirthday('31.02')).toBeNull();
    expect(parseBirthday('ieri')).toBeNull();
  });

  it('câte zile până la următoarea și câți ani împlinește', () => {
    const now = new Date(2026, 9, 29, 15).getTime();
    expect(nextBirthday({ month: 10, day: 29 }, now)).toEqual({ days: 0 });
    expect(nextBirthday({ month: 10, day: 31, year: 2021 }, now)).toEqual({ days: 2, turns: 5 });
    expect(nextBirthday({ month: 10, day: 28 }, now).days).toBe(364);
  });
});
