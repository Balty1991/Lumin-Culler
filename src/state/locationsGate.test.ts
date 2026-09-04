import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from './store';

/**
 * state/locationsGate.test.ts
 * UNDE sta poarta Premium pentru ecranul Locatii.
 *
 * Aici contradictia dintre modelul scris al aplicatiei (plafon pe IESIRE, nu
 * pe intrare) si felul in care erau blocate functiile costa cel mai mult:
 * harta locurilor tale e cel mai puternic moment de "aa!" din toata aplicatia
 * — oamenii isi recunosc vacantele intr-o lista de nume de orase — si tocmai
 * el statea in intregime dupa lacat. Omul apasa "Locatii", primea un ecran
 * care ii cerea bani, si nu afla niciodata ca aplicatia lui stie in ce orase
 * a fost.
 *
 * Ambele capete sunt pazite: si ca ecranul se deschide, si ca "Fa folder" nu.
 * Mutarea se poate "repara" inapoi dintr-o singura linie, de catre cineva care
 * crede ca lipseste o poarta.
 */
const gatePremium = vi.fn(() => true);

beforeEach(() => {
  gatePremium.mockClear();
  gatePremium.mockReturnValue(true);
  useStore.setState({ locationsOpen: false, gatePremium, collections: [] });
});

describe('harta locurilor se vede liber', () => {
  it('ecranul se deschide chiar cand functiile premium sunt blocate', () => {
    useStore.getState().setLocationsOpen(true);
    expect(useStore.getState().locationsOpen).toBe(true);
    expect(gatePremium).not.toHaveBeenCalled();
  });
});

describe('transformarea unui loc in album E poarta', () => {
  it('blocata: cere abonament si NU creeaza nimic', async () => {
    const rezultat = await useStore.getState().createCollectionFromLocation('Sinaia', ['1', '2']);
    expect(gatePremium).toHaveBeenCalledWith('locations');
    expect(rezultat).toBeNull();
    expect(useStore.getState().collections).toHaveLength(0);
  });

  it('deblocata: albumul chiar se creeaza', async () => {
    gatePremium.mockReturnValue(false);
    const rezultat = await useStore.getState().createCollectionFromLocation('Sinaia', ['1']);
    expect(gatePremium).toHaveBeenCalledWith('locations');
    expect(rezultat?.name).toBe('Sinaia');
  });
});
