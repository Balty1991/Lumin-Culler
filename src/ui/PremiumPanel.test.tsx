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

  it('spune conditiile de reinnoire sub buton, cu cifra planului bifat', async () => {
    // Cerinta Play pentru orice aplicatie cu abonamente, si unul dintre motivele
    // obisnuite de respingere la review: pretul, perioada si faptul ca se
    // REINNOIESTE SINGUR trebuie sa fie vizibile INAINTE de plata.
    mockPlay([LUNAR, ANUAL]);
    render(<PremiumPanel />);

    expect(await screen.findByText(/se reînnoiește automat cu 199,99 lei în fiecare an/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Lunar/ }));
    expect(screen.getByText(/se reînnoiește automat cu 19,99 lei în fiecare lună/)).toBeInTheDocument();
  });

  it('cu perioada de proba, conditiile spun ca proba devine plata si cu cat', async () => {
    mockPlay([LUNAR, { ...ANUAL, trialDays: 7 }]);
    render(<PremiumPanel />);

    expect(await screen.findByText(/Cele 7 zile gratuite se transformă automat în abonament plătit, 199,99 lei/))
      .toBeInTheDocument();
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

/**
 * Ce se intampla DUPA plata — bugul gasit auditand drumul complet: omul lovea o
 * poarta, platea, primea confirmarea, si functia pentru care platise nu pornea.
 */
describe('PremiumPanel — calea inapoi dupa plata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useStore.setState({ locale: 'ro', premiumOpen: true, premium: false, premiumReason: null, persons: [] });
  });

  it('dupa plata, duce inapoi exact la functia ceruta', () => {
    useStore.setState({ premium: true, premiumReason: 'contactSheet' });
    render(<PremiumPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Deschide planșa de contact/ }));
    expect(useStore.getState().contactSheetOpen).toBe(true);
    // Si inchide ecranul de plata: functia ceruta e acum deasupra, iar un panou
    // de vanzare ramas dedesubt n-are ce cauta acolo.
    expect(useStore.getState().premiumOpen).toBe(false);
  });

  it('la plafonul de export redeschide foaia de export, cu selectia intacta', () => {
    // Singurul caz in care nu se poate relua chiar actiunea: destinatia aleasa
    // nu s-a retinut. Un pas inapoi, nu zero — pozele sunt tot selectate.
    useStore.setState({ premium: true, premiumReason: 'cap' });
    render(<PremiumPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Reia exportul/ }));
    expect(useStore.getState().exportDestinationsOpen).toBe(true);
  });

  it('deschis din meniu, fara nicio poarta lovita, nu propune nicio reluare', () => {
    // N-a cerut nimic anume; un buton care duce undeva la intamplare ar fi mai
    // rau decat lipsa lui.
    useStore.setState({ premium: true, premiumReason: null });
    render(<PremiumPanel />);
    expect(screen.queryByRole('button', { name: /→/ })).not.toBeInTheDocument();
  });

  it('cat timp NU e abonat, nu apare nicio cale inapoi — poarta e inca inchisa', () => {
    // Bugul in oglinda: un buton "Deschide planșa de contact" langa unul de
    // cumparare ar promite functia inainte de plata.
    mockPlay([LUNAR]);
    useStore.setState({ premium: false, premiumReason: 'contactSheet' });
    render(<PremiumPanel />);
    expect(screen.queryByRole('button', { name: /Deschide planșa de contact/ })).not.toBeInTheDocument();
  });
});
