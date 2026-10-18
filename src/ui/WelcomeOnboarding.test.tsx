import { describe, expect, it, beforeEach, vi } from 'vitest';

/** Cererea "ce lipseste", plecata pe ORICE drum de inchidere — inclusiv X. */
const cereriLipsa: number[] = [];
vi.mock('../core/appPermissions', () => ({
  requestMissingPermissions: () => {
    cereriLipsa.push(1);
    return Promise.resolve({ stare: { galerie: 'full', notificari: 'granted', video: 'full' }, complet: true });
  }
}));
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeOnboarding } from './WelcomeOnboarding';
import { useStore } from '../state/store';

describe('WelcomeOnboarding', () => {
  beforeEach(() => {
    localStorage.clear();
    cereriLipsa.length = 0;
    useStore.setState({ locale: 'ro', welcomeSeen: false });
  });

  it('se afiseaza la prima vizita, pe primul pas', () => {
    render(<WelcomeOnboarding />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Telefon plin? Hai să vedem cât poți elibera.')).toBeInTheDocument();
  });

  it('nu se mai afiseaza deloc daca a fost deja vazut', () => {
    useStore.setState({ welcomeSeen: true });
    render(<WelcomeOnboarding />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('trece prin trei pasi, iar ultimul ofera "Sa incepem"', () => {
    render(<WelcomeOnboarding />);
    expect(screen.queryByRole('button', { name: 'Înapoi' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    expect(screen.getByText('Totul rămâne pe telefon')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    expect(screen.getByText('Spațiul eliberat e recompensa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Să începem' })).toBeInTheDocument();
  });

  it('"Inapoi" revine la pasul anterior fara sa inchida ecranul', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Înapoi' }));
    expect(screen.getByText('Telefon plin? Hai să vedem cât poți elibera.')).toBeInTheDocument();
  });

  it('finalizarea de pe ultimul pas marcheaza ecranul ca vazut', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Să începem' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
    expect(cereriLipsa).toHaveLength(1);
  });

  it('butonul de sarit (X) inchide ecranul si cere permisiunile ramase', () => {
    render(<WelcomeOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Următorul' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sari peste' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
    expect(cereriLipsa).toHaveLength(1);
  });

  it('Escape inchide ecranul si cere aceleasi permisiuni', () => {
    render(<WelcomeOnboarding />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('lumin-welcome-seen')).toBe('1');
    expect(cereriLipsa).toHaveLength(1);
  });
});
