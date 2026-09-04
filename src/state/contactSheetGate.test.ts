import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useStore } from './store';

/**
 * state/contactSheetGate.test.ts
 * UNDE sta poarta Premium pentru plansa de contact.
 *
 * Aplicatia are un principiu de monetizare scris peste tot (core/entitlement.ts,
 * fisa din magazin): plafon pe IESIRE, nu pe intrare — triezi gratis oricate
 * poze, platesti pentru ce SCOTI din aplicatie. Functiile rezervate abonatilor
 * il incalcau exact invers: poarta statea pe DESCHIDEREA panoului, deci nimeni
 * n-a vazut vreodata o plansa de contact, iar ecranul Premium cerea bani pentru
 * un substantiv.
 *
 * Mutarea portii de pe usa pe butonul de printare e o schimbare pe care nimic
 * nu o tine pe loc: se poate "repara" inapoi dintr-o singura linie, de catre
 * cineva care crede ca lipseste o poarta. De-aia sunt pazite AMANDOUA capetele
 * — si ca usa se deschide, si ca printarea nu.
 */
const gatePremium = vi.fn(() => true);
const print = vi.fn();

beforeEach(() => {
  gatePremium.mockClear();
  gatePremium.mockReturnValue(true);
  print.mockClear();
  vi.stubGlobal('print', print);
  useStore.setState({ contactSheetOpen: false, gatePremium });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usa nu mai e poarta', () => {
  it('plansa se deschide chiar cand functiile premium sunt blocate', () => {
    useStore.getState().setContactSheetOpen(true);
    expect(useStore.getState().contactSheetOpen).toBe(true);
    expect(gatePremium).not.toHaveBeenCalled();
  });
});

describe('printarea E poarta', () => {
  it('blocata: cere abonament, si NU printeaza', () => {
    useStore.getState().printContactSheet();
    expect(gatePremium).toHaveBeenCalledWith('contactSheet');
    expect(print).not.toHaveBeenCalled();
  });

  it('deblocata: printeaza', () => {
    gatePremium.mockReturnValue(false);
    useStore.getState().printContactSheet();
    expect(print).toHaveBeenCalled();
  });
});
