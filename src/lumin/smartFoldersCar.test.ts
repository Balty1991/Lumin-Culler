import { describe, it, expect } from 'vitest';
import { inFolder, SMART_FOLDERS } from './smartFolders';

const car = SMART_FOLDERS.find(f => f.id === 'car')!;

describe('dosarul „Mașina”', () => {
  it('ia mașinile, nu bicicletele sau roțile', () => {
    expect(inFolder({ sceneTags: ['Car', 'Wheel'] }, car)).toBe(true);
    expect(inFolder({ sceneTags: ['Vehicle', 'Bicycle'] }, car)).toBe(false);
    expect(inFolder({ sceneTags: ['Wheel', 'Tire'] }, car)).toBe(false);
  });
});
