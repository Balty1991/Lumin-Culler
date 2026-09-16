import { describe, expect, it, beforeEach, vi } from 'vitest';

/** Cererile de permisiune plecate, si raspunsul pe care il primesc. */
const cereri: string[] = [];
let notificariNative = false;
let raspuns = 'granted';
vi.mock('../core/nativeNotifications', () => ({
  isNativeNotificationsAvailable: () => notificariNative,
  requestNotificationAccess: () => { cereri.push('cerut'); return Promise.resolve(raspuns); }
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeOnboarding } from './WelcomeOnboarding';
import { useStore } from '../state/store';

describe('WelcomeOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    // welcomeSeen e citit din localStorage O SINGURA DATA, la crearea store-ului
    // (modul singleton), deci fiecare test trebuie sa il reaseze explicit — altfel
    // primul test care inchide ecranul l-ar tine inchis pentru toate urmatoarele.
    useStore.setState({ locale: 'ro', welcomeSeen: false });
  });

  it('se afiseaza la prima vizita, pe primul pas', () => {
    render(<WelcomeOnboarding />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('AI-ul îți pune pozele în ordine. Tu decizi ce rămâne.')).toBeInTheDocument();
  });

  it('nu se mai afiseaza deloc daca a fost deja vazut', () => {
    useStore.setState({ welcomeSeen: true });
    render(<WelcomeOnboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Urmatorul" avanseaza prin toti cei 4 pasi, iar ultimul pas ofera "Sa incepem" in loc', () => {
    render(<WelcomeOnboarding />);
    expect(screen.queryByRole('button', { name: 'Înapoi' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    expect(screen.getByText('Totul rămâne pe telefonul tău')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    expect(screen.getByText('Recunoaște-ți oamenii')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    expect(screen.getByText('Premium, când ești pregătit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Să începem' })).toBeInTheDocument();
  });

  it('"Inapoi" revine la pasul anterior fara sa inchida ecranul', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Înapoi' }));
    expect(screen.getByText('AI-ul îți pune pozele în ordine. Tu decizi ce rămâne.')).toBeInTheDocument();
  });

  it('finalizarea de pe ultimul pas ("Sa incepem") marcheaza ecranul ca vazut si il ascunde', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Să începem' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
  });

  it('butonul de sarit (X) inchide ecranul si il marcheaza ca vazut, indiferent de pas', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' })); // pasul 2, nu ultimul
    fireEvent.click(screen.getByRole('button', { name: 'Sari peste' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
  });

  it('Escape inchide ecranul la fel ca butonul de sarit', () => {
    render(<WelcomeOnboarding />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
  });
});

/**
 * Permisiunea de notificari se CERE, nu se presupune.
 *
 * Raportat de utilizator, cu capturi: comutatorul "Notificari inteligente"
 * arata PORNIT, dar bara de stare nu afisa nimic in timpul unui import in
 * fundal. `POST_NOTIFICATIONS` se cerea doar din acel comutator, iar pe
 * Android 13+ o permisiune necerută e refuzata implicit — deci serviciul de
 * analiza lucra, dar notificarea lui era invizibila.
 *
 * Permisiunea de galerie are un declansator natural (prima citire din
 * galerie). Notificarile n-aveau niciunul, si de-aia le trebuie un pas.
 */
describe('WelcomeOnboarding — pasul de notificari', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ locale: 'ro', welcomeSeen: false });
    cereri.length = 0;
  });

  it('pe o platforma fara notificari native, pasul nu exista deloc', () => {
    // Implicit in teste: plugin-ul nativ nu e disponibil (vezi mock-ul de sus).
    render(<WelcomeOnboarding />);
    expect(screen.queryByText(/Analiza merge și cu telefonul în buzunar/)).not.toBeInTheDocument();
  });

  it('cand pasul exista, plecarea de pe el cere permisiunea O SINGURA DATA', async () => {
    notificariNative = true;
    render(<WelcomeOnboarding />);
    // Pasul 1 -> pasul de notificari
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    expect(screen.getByText(/Analiza merge și cu telefonul în buzunar/)).toBeInTheDocument();
    expect(cereri).toHaveLength(0); // inca n-a plecat de pe el

    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    await screen.findByText(/Totul rămâne pe telefonul tău/);
    expect(cereri).toHaveLength(1);
  });

  it('un refuz nu opreste intampinarea — se merge mai departe oricum', async () => {
    notificariNative = true;
    raspuns = 'blocked';
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    // A avansat, desi permisiunea a fost refuzata.
    await screen.findByText(/Totul rămâne pe telefonul tău/);
    expect(cereri).toHaveLength(1);
  });
});
