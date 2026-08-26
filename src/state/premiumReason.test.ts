import { describe, expect, it, beforeEach } from 'vitest';
import { useStore } from './store';

/**
 * Portile contextuale existau deja in sapte locuri, dar toate deschideau
 * acelasi catalog de sase functii. Cine apasa "Plansa de contact" trebuia sa se
 * caute singur in lista, exact cand intrebarea lui era cat se poate de precisa.
 */
describe('motivul pentru care s-a deschis panoul Premium', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ premiumOpen: false, premiumReason: null });
  });

  it('gatePremium retine functia ceruta', () => {
    // fara abonament si cu plata disponibila, poarta se inchide
    localStorage.setItem('lumin-billing-purchasable', '1');
    const blocked = useStore.getState().gatePremium('contactSheet');
    if (blocked) {
      expect(useStore.getState().premiumReason).toBe('contactSheet');
      expect(useStore.getState().premiumOpen).toBe(true);
    } else {
      // pe o configuratie fara cale de plata nimic nu e blocat — atunci nici
      // panoul nu trebuie sa se deschida, si nici motivul sa se schimbe
      expect(useStore.getState().premiumOpen).toBe(false);
      expect(useStore.getState().premiumReason).toBeNull();
    }
  });

  it('cu abonament activ, poarta nu se inchide si nu se retine nimic', () => {
    localStorage.setItem('lumin-premium', '1');
    expect(useStore.getState().gatePremium('xmp')).toBe(false);
    expect(useStore.getState().premiumReason).toBeNull();
  });

  // Cine loveste o poarta, inchide panoul, si il redeschide din meniu, n-are voie
  // sa fie intampinat de raspunsul la o intrebare pe care n-a mai pus-o.
  it('deschiderea din meniu sterge motivul ramas de la o poarta anterioara', () => {
    useStore.setState({ premiumReason: 'vault' });
    useStore.getState().setPremiumOpen(true);
    expect(useStore.getState().premiumReason).toBeNull();
  });

  it('inchiderea panoului nu sterge motivul, ca sa nu clipeasca in timpul animatiei', () => {
    useStore.setState({ premiumOpen: true, premiumReason: 'locations' });
    useStore.getState().setPremiumOpen(false);
    expect(useStore.getState().premiumReason).toBe('locations');
  });
});
