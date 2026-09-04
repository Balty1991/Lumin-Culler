import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from './store';

/**
 * state/presentationGate.test.ts
 * UNDE sta poarta Premium pentru prezentare.
 *
 * Al treilea ecran mutat de pe "lacat la usa" pe "lacat la iesire" (dupa
 * plansa de contact si locatii), si cel la care lacatul de la usa costa cel
 * mai mult — nu din cauza conversiei.
 *
 * Codul insusi spune de ce, langa exportul clipului: "un clip scurt cu cele
 * mai bune poze e ceva ce omul trimite in familie, si fiecare trimitere e
 * reclama pentru aplicatie". Poarta statea insa INAINTEA prezentarii, deci un
 * neabonat nu vedea prezentarea, nu facea niciun clip, si nu-l trimitea
 * nimanui. Se bloca deopotriva incantarea si singurul canal prin care
 * aplicatia se raspandeste singura.
 */
const gatePremium = vi.fn(() => true);

beforeEach(() => {
  gatePremium.mockClear();
  gatePremium.mockReturnValue(true);
  useStore.setState({ presentationOpen: false, gatePremium });
});

describe('prezentarea se priveste liber', () => {
  it('ecranul se deschide chiar cand functiile premium sunt blocate', () => {
    useStore.getState().setPresentationOpen(true);
    expect(useStore.getState().presentationOpen).toBe(true);
    expect(gatePremium).not.toHaveBeenCalled();
  });

  it('si se inchide fara sa intrebe nimic', () => {
    useStore.getState().setPresentationOpen(true);
    useStore.getState().setPresentationOpen(false);
    expect(useStore.getState().presentationOpen).toBe(false);
    expect(gatePremium).not.toHaveBeenCalled();
  });
});
