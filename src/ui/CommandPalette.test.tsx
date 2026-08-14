import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandPalette } from './CommandPalette';
import { useStore } from '../state/store';

describe('CommandPalette', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ locale: 'ro', paletteOpen: false, photos: [], history: [] });
  });

  it('se deschide cu Ctrl+K', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(useStore.getState().paletteOpen).toBe(true);
  });

  /**
   * Regresie: `e.key` raporteaza litera EFECTIVA, nu tasta fizica. Cu Caps Lock
   * activ (sau cu Shift apasat din reflex) devine 'K', iar scurtatura anuntata
   * ca "Ctrl/Cmd+K" pur si simplu nu mai facea nimic, fara niciun semn.
   */
  it('se deschide si cu Ctrl+Shift/CapsLock+K (litera mare)', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true });
    expect(useStore.getState().paletteOpen).toBe(true);
  });

  it('se deschide si cu Cmd+K (macOS)', () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(useStore.getState().paletteOpen).toBe(true);
  });

  it('Escape o inchide', () => {
    useStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useStore.getState().paletteOpen).toBe(false);
  });

  /**
   * Regresie: dupa o filtrare care scurteaza lista, `activeIndex` putea ramane
   * in afara ei — niciun rand nu mai aparea evidentiat si Enter nu mai executa
   * nimic, fara nicio explicatie pe ecran.
   */
  it('evidentierea ramane mereu pe un rand real, chiar dupa ce filtrarea scurteaza lista', () => {
    useStore.setState({ paletteOpen: true });
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');

    // coboara cateva randuri in lista completa
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    // apoi restrange lista la un singur rezultat
    fireEvent.change(input, { target: { value: 'Persoane' } });

    const options = screen.queryAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter(o => o.getAttribute('aria-selected') === 'true')).toHaveLength(1);
  });
});
