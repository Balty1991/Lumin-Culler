import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PremiumPanel } from './PremiumPanel';
import { useStore } from '../state/store';
import * as billing from '../core/billing';

/**
 * ui/PremiumPanel.test.tsx
 * Ecranul pe care se incaseaza. Ce se poate strica aici nu da eroare si nu pica
 * niciun alt test — doar incaseaza gresit, sau nu incaseaza deloc:
 *
 *  - butonul deschide alt plan decat cel bifat;
 *  - randul de pret ramane pe lunar cand e bifat anualul (scrie 19,99 lei
 *    deasupra unui buton care ia 199,99);
 *  - se afiseaza un selector de planuri cand exista un singur plan;
 *  - nu apare niciun buton desi Play chiar are ce vinde.
 *
 * Tot ce vine din Play e mimat aici: pe web nu exista plugin, deci fara
 * `vi.spyOn` panoul ar vedea mereu "niciun plan" si n-ar avea ce testa.
 */
const LUNAR: billing.PremiumPlan = {
  id: 'lumin_premium_monthly', price: '19,99 lei', priceMicros: 19_990_000,
  currency: 'RON', periodDays: 30
};
const ANUAL: billing.PremiumPlan = {
  id: 'lumin_premium_yearly', price: '199,99 lei', priceMicros: 199_990_000,
  currency: 'RON', periodDays: 365
};

function mockPlay(plans: billing.PremiumPlan[], price: string | null = '19,99 lei') {
  vi.spyOn(billing, 'isBillingAvailable').mockReturnValue(true);
  vi.spyOn(billing, 'queryPremiumPrice').mockResolvedValue(price);
  vi.spyOn(billing, 'queryPlansAnswer').mockResolvedValue({ answered: true, plans });
  return vi.spyOn(billing, 'startSubscription').mockResolvedValue('cancelled');
}

describe('PremiumPanel — alegerea planului', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useStore.setState({ locale: 'ro', premiumOpen: true, premium: false, premiumReason: null, persons: [] });
  });

  it('arata ambele planuri cu preturile primite de la Play, si eticheta de economie pe anual', async () => {
    mockPlay([LUNAR, ANUAL]);
    render(<PremiumPanel />);

    expect(await screen.findByText('199,99 lei')).toBeInTheDocument();
    expect(screen.getByText('19,99 lei')).toBeInTheDocument();
    // 19,99/30 = 0,666/zi fata de 199,99/365 = 0,548/zi -> 17%.
    expect(screen.getByText('−17%')).toBeInTheDocument();
    // Pretul pe luna al anualului, derivat si formatat in moneda contului.
    expect(screen.getByText(/≈.*16[.,]6/)).toBeInTheDocument();
  });

  it('bifeaza din start planul cu economie reala, si scrie pretul LUI in randul de sus', async () => {
    mockPlay([LUNAR, ANUAL]);
    render(<PremiumPanel />);

    const anual = await screen.findByRole('radio', { name: /Anual/ });
    expect(anual).toBeChecked();
    expect(screen.getByText('199,99 lei pe an · anulezi oricând din Google Play')).toBeInTheDocument();
  });

  it('comutarea pe lunar schimba si randul de pret, si suma de pe buton', async () => {
    mockPlay([LUNAR, ANUAL]);
    render(<PremiumPanel />);

    fireEvent.click(await screen.findByRole('radio', { name: /Lunar/ }));
    expect(screen.getByText('19,99 lei pe lună · anulezi oricând din Google Play')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abonează-te — 19,99 lei' })).toBeInTheDocument();
  });

  it('cumpara EXACT planul bifat, nu pe cel implicit', async () => {
    const subscribe = mockPlay([LUNAR, ANUAL]);
    render(<PremiumPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Abonează-te — 199,99 lei' }));
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith('lumin_premium_yearly'));

    fireEvent.click(screen.getByRole('radio', { name: /Lunar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Abonează-te — 19,99 lei' }));
    await waitFor(() => expect(subscribe).toHaveBeenLastCalledWith('lumin_premium_monthly'));
  });

  it('cu un singur plan configurat in Play Console nu arata niciun selector', async () => {
    mockPlay([LUNAR]);
    render(<PremiumPanel />);

    expect(await screen.findByRole('button', { name: 'Abonează-te — 19,99 lei' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('perioada de proba se spune pe card SI pe buton, cand oferta o are', async () => {
    mockPlay([LUNAR, { ...ANUAL, trialDays: 7 }]);
    render(<PremiumPanel />);

    expect(await screen.findByText('primele 7 zile gratuite')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Începe gratuit — apoi 199,99 lei' })).toBeInTheDocument();
  });

  it('fara niciun plan si fara pret, nu apare niciun buton de plata', async () => {
    // Produse neconfigurate in Play Console, sau build nesemnat. Un buton care
    // deschide un flux inexistent e mai rau decat un anunt.
    mockPlay([], null);
    render(<PremiumPanel />);

    await waitFor(() => expect(billing.queryPlansAnswer).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Abonează-te/ })).not.toBeInTheDocument();
  });

  it('cand plans() esueaza dar pretul exista, butonul ramane si cumpara planul implicit', async () => {
    // Regresie de compatibilitate: `plans()` e o metoda noua a plugin-ului. Pe
    // un build mai vechi al partii native ea lipseste, deci raspunsul e
    // `answered: false` — fara aceasta cale, ecranul Premium ar fi ramas fara
    // buton exact la utilizatorii care au deja aplicatia instalata.
    vi.spyOn(billing, 'isBillingAvailable').mockReturnValue(true);
    vi.spyOn(billing, 'queryPremiumPrice').mockResolvedValue('19,99 lei');
    vi.spyOn(billing, 'queryPlansAnswer').mockResolvedValue({ answered: false, plans: [] });
    const subscribe = vi.spyOn(billing, 'startSubscription').mockResolvedValue('cancelled');
    render(<PremiumPanel />);

    fireEvent.click(await screen.findByRole('button', { name: 'Abonează-te — 19,99 lei' }));
    // `undefined` = "planul implicit", pe care partea nativa il rezolva la lunar.
    await waitFor(() => expect(subscribe).toHaveBeenCalledWith(undefined));
  });
});
