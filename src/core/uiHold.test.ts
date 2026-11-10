import { describe, it, expect } from 'vitest';
import { analysisPool } from './workerPool';

describe('ecranele grele opresc lucrul din fundal', () => {
  it('waitWhileUiHeld așteaptă doar cât citirea din fundal e ținută de un ecran', async () => {
    // Fără citire în fundal (import cerut de om): nu așteaptă.
    const release = analysisPool.holdForUi();
    await analysisPool.waitWhileUiHeld();
    analysisPool.setGentle(true);
    let passed = false;
    const waiting = analysisPool.waitWhileUiHeld().then(() => { passed = true; });
    await new Promise(r => setTimeout(r, 450));
    expect(passed).toBe(false);
    release();
    await waiting;
    expect(passed).toBe(true);
    analysisPool.setGentle(false);
  });
});
