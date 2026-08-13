import { describe, expect, it, beforeEach } from 'vitest';
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
