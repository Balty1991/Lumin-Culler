import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeOnboarding } from './WelcomeOnboarding';
import { useStore } from '../state/store';

describe('WelcomeOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ locale: 'ro' });
  });

  it('se afiseaza la prima vizita, pe primul pas', () => {
    render(<WelcomeOnboarding />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Bun venit in Lumin Culler')).toBeInTheDocument();
  });

  it('nu se mai afiseaza deloc daca a fost deja vazut (localStorage)', () => {
    localStorage.setItem('lumin-welcome-seen', '1');
    render(<WelcomeOnboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('"Urmatorul" avanseaza prin toti cei 4 pasi, iar ultimul pas ofera "Sa incepem" in loc', () => {
    render(<WelcomeOnboarding />);
    expect(screen.queryByRole('button', { name: 'Inapoi' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    expect(screen.getByText('Totul ramane pe telefonul tau')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    expect(screen.getByText('Recunoaste-ti oamenii')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    expect(screen.getByText('Premium, cand esti pregatit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sa incepem' })).toBeInTheDocument();
  });

  it('"Inapoi" revine la pasul anterior fara sa inchida ecranul', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inapoi' }));
    expect(screen.getByText('Bun venit in Lumin Culler')).toBeInTheDocument();
  });

  it('finalizarea de pe ultimul pas ("Sa incepem") marcheaza ecranul ca vazut si il ascunde', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sa incepem' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
  });

  it('butonul de sarit (X) inchide ecranul si il marcheaza ca vazut, indiferent de pas', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Urmatorul' })); // pasul 2, nu ultimul
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
