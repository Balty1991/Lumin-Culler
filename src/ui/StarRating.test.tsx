import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StarRating } from './StarRating';
import { useStore } from '../state/store';

/**
 * Tiparul ARIA de radiogroup era pornit pe jumatate: `role="radiogroup"` +
 * `role="radio"` promiteau navigare cu sagetile si UN singur loc de oprire in
 * ordinea de Tab, dar sagetile nu faceau nimic si toate cele 5 stele erau opriri
 * separate — de doua ori pe ecran (DetailView si Workspace au fiecare un rand).
 */
describe('StarRating', () => {
  beforeEach(() => useStore.setState({ locale: 'ro' }));

  const stars = () => screen.getAllByRole('radio');

  it('are o singura oprire de Tab: steaua selectata', () => {
    render(<StarRating rating={3} onRate={() => {}} />);
    const tabbable = stars().filter(s => s.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('fara nicio nota, prima stea e oprirea de Tab', () => {
    render(<StarRating rating={0} onRate={() => {}} />);
    expect(stars()[0]).toHaveAttribute('tabindex', '0');
    expect(stars().filter(s => s.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('Sageata dreapta trece la nota urmatoare, circular de la 5 la 1', () => {
    const onRate = vi.fn();
    const { rerender } = render(<StarRating rating={3} onRate={onRate} />);
    fireEvent.keyDown(stars()[2], { key: 'ArrowRight' });
    expect(onRate).toHaveBeenCalledWith(4);

    rerender(<StarRating rating={5} onRate={onRate} />);
    fireEvent.keyDown(stars()[4], { key: 'ArrowRight' });
    expect(onRate).toHaveBeenCalledWith(1);
  });

  it('Sageata stanga trece la nota anterioara, circular de la 1 la 5', () => {
    const onRate = vi.fn();
    render(<StarRating rating={1} onRate={onRate} />);
    fireEvent.keyDown(stars()[0], { key: 'ArrowLeft' });
    expect(onRate).toHaveBeenCalledWith(5);
  });

  it('Home/End sar la prima/ultima nota', () => {
    const onRate = vi.fn();
    render(<StarRating rating={3} onRate={onRate} />);
    fireEvent.keyDown(stars()[2], { key: 'Home' });
    expect(onRate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(stars()[2], { key: 'End' });
    expect(onRate).toHaveBeenCalledWith(5);
  });

  /**
   * DetailView si Workspace asculta Sagetile pe `window` ca sa treaca la poza
   * urmatoare. Fara stopPropagation, o sageata apasata cu focusul pe stele ar
   * schimba nota SI ar sari la alt cadru in acelasi timp.
   */
  it('nu lasa sagetile sa ajunga la listenerii globali de navigare intre poze', () => {
    const globalHandler = vi.fn();
    window.addEventListener('keydown', globalHandler);
    render(<StarRating rating={2} onRate={() => {}} />);
    fireEvent.keyDown(stars()[1], { key: 'ArrowRight' });
    expect(globalHandler).not.toHaveBeenCalled();
    window.removeEventListener('keydown', globalHandler);
  });

  it('Tab NU e inghitit (altfel n-ai mai putea iesi din grup)', () => {
    const globalHandler = vi.fn();
    window.addEventListener('keydown', globalHandler);
    render(<StarRating rating={2} onRate={() => {}} />);
    fireEvent.keyDown(stars()[1], { key: 'Tab' });
    expect(globalHandler).toHaveBeenCalled();
    window.removeEventListener('keydown', globalHandler);
  });

  it('numele accesibil al stelei selectate anunta ca reapasarea sterge nota', () => {
    render(<StarRating rating={4} onRate={() => {}} />);
    const checked = stars().find(s => s.getAttribute('aria-checked') === 'true');
    expect(checked?.getAttribute('aria-label')).toContain('ștergi nota');
    // celelalte NU trebuie sa promita asta — acolo apasarea doar schimba nota
    const other = stars().find(s => s.getAttribute('aria-checked') === 'false');
    expect(other?.getAttribute('aria-label')).not.toContain('ștergi nota');
  });

  it('click pe steaua deja selectata sterge nota (0)', () => {
    const onRate = vi.fn();
    render(<StarRating rating={4} onRate={onRate} />);
    fireEvent.click(stars()[3]);
    expect(onRate).toHaveBeenCalledWith(0);
  });
});
