import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZenModePanel } from './ZenModePanel';
import { useStore } from '../state/store';

/**
 * Regresie pentru bug-ul gasit de auditul UI: randul "master" al panoului era un
 * <button> care CONTINEA un al doilea <button role="switch"> (comutatorul). HTML
 * invalid, anuntat confuz de cititoarele de ecran, si un tap chiar pe comutator
 * declansa ambele handlere — se salva doar din faptul ca amandoua calculau
 * aceeasi valoare noua din acelasi render.
 */
describe('ZenModePanel', () => {
  beforeEach(() => {
    localStorage.clear();
    useStore.setState({ locale: 'ro', zenPanelOpen: true, zenMode: false, zenAutoDeleteObvious: false, zenAskOnUncertain: false });
  });

  it('nu contine niciun buton imbricat in alt buton', () => {
    const { container } = render(<ZenModePanel />);
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.querySelector('button')).toBeNull();
    }
  });

  it('randul master e el insusi comutatorul (role="switch"), nu doar un container', () => {
    render(<ZenModePanel />);
    const master = screen.getByRole('switch', { name: 'Mod Zen' });
    expect(master).toHaveAttribute('aria-checked', 'false');
  });

  it('un click pe randul master comuta starea exact O DATA (nu de doua ori)', () => {
    render(<ZenModePanel />);
    fireEvent.click(screen.getByRole('switch', { name: 'Mod Zen' }));
    expect(useStore.getState().zenMode).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Mod Zen' }));
    expect(useStore.getState().zenMode).toBe(false);
  });

  it('comutatoarele secundare raman dezactivate cat timp modul master e oprit', () => {
    render(<ZenModePanel />);
    const secondary = screen.getAllByRole('switch').filter(el => el.hasAttribute('disabled'));
    expect(secondary).toHaveLength(2);
  });
});
