import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Modulul tine stare la nivel de modul (sentinel + contor de detinatori), deci
 * fiecare test il importa PROASPAT (resetModules) — altfel un test l-ar lasa pe
 * urmatorul cu o blocare deja ceruta.
 */
type Listener = () => void;

function fakeWakeLock() {
  const sentinels: { released: boolean; release: ReturnType<typeof vi.fn>; listeners: Listener[] }[] = [];
  const request = vi.fn(async () => {
    const s = {
      released: false,
      listeners: [] as Listener[],
      release: vi.fn(async () => { s.released = true; }),
      addEventListener: (_type: 'release', listener: Listener) => { s.listeners.push(listener); }
    };
    sentinels.push(s);
    return s;
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, sentinels };
}

async function load() {
  vi.resetModules();
  return import('./wakeLock');
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => {
  Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'wakeLock');
});

describe('keepScreenAwake', () => {
  it('cere o blocare de ecran si o elibereaza la apelul functiei intoarse', async () => {
    const { request, sentinels } = fakeWakeLock();
    const { keepScreenAwake } = await load();

    const release = keepScreenAwake();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    release();
    await Promise.resolve();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('nu elibereaza cat timp o alta operatie inca tine ecranul aprins', async () => {
    const { sentinels } = fakeWakeLock();
    const { keepScreenAwake } = await load();

    const releaseA = keepScreenAwake();
    await Promise.resolve();
    const releaseB = keepScreenAwake();
    await Promise.resolve();

    releaseA();
    await Promise.resolve();
    expect(sentinels[0].release).not.toHaveBeenCalled();

    releaseB();
    await Promise.resolve();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('a doua eliberare a aceleiasi operatii nu scade contorul inca o data', async () => {
    const { sentinels } = fakeWakeLock();
    const { keepScreenAwake } = await load();

    const releaseA = keepScreenAwake();
    const releaseB = keepScreenAwake();
    await Promise.resolve();

    releaseA();
    releaseA();
    await Promise.resolve();
    expect(sentinels[0].release).not.toHaveBeenCalled();

    releaseB();
    await Promise.resolve();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('nu arunca si nu blocheaza importul cand API-ul lipseste (web fara suport)', async () => {
    const { keepScreenAwake, isWakeLockSupported } = await load();
    expect(isWakeLockSupported()).toBe(false);
    const release = keepScreenAwake();
    await Promise.resolve();
    expect(() => release()).not.toThrow();
  });

  it('nu arunca daca sistemul refuza cererea', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: vi.fn(async () => { throw new Error('not allowed'); }) },
      configurable: true
    });
    const { keepScreenAwake } = await load();
    const release = keepScreenAwake();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => release()).not.toThrow();
  });
});
