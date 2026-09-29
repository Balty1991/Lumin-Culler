import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsPanel } from './StatsPanel';
import { useStore } from '../state/store';

/**
 * Randurile despre opriri din "Ultimul import" — vezi core/stallTally.ts.
 *
 * Doua reguli: se arata doar cand chiar au fost opriri (un "0 opriri" la fiecare
 * import e zgomot), si cele doua feluri stau separat, fiindca cer lucruri
 * diferite: una se trateaza din Setarile telefonului, cealalta e un defect al
 * nostru.
 */
const FARA_OPRIRI = { hiddenMs: 0, hiddenCount: 0, visibleMs: 0, visibleCount: 0 };

function cuImport(stalls: typeof FARA_OPRIRI) {
  useStore.setState({
    locale: 'ro',
    statsOpen: true,
    lastImportStats: {
      count: 87, durationMs: 9 * 60_000,
      throttledMs: 0, throttledCap: null, normalCap: 4,
      stalls
    }
  });
}

describe('StatsPanel — opririle analizei', () => {
  beforeEach(() => { localStorage.clear(); });

  it('fara opriri, nu apare niciun rand despre ele', () => {
    cuImport(FARA_OPRIRI);
    render(<StatsPanel />);
    expect(screen.queryByText(/a stat pe loc/)).not.toBeInTheDocument();
  });

  it('cazul raportat: opriri in fundal, cu trimitere la setarea de baterie', () => {
    cuImport({ ...FARA_OPRIRI, hiddenMs: 7 * 60_000, hiddenCount: 2 });
    render(<StatsPanel />);
    const rand = screen.getByText(/cât aplicația nu era pe ecran/);
    expect(rand.textContent).toContain('opriri: 2');
    expect(rand.textContent).toContain('Analiză în fundal');
    expect(screen.queryByText(/și cu aplicația deschisă/)).not.toBeInTheDocument();
  });

  it('o oprire cu aplicatia deschisa are randul ei — e un defect de-al nostru', () => {
    cuImport({ ...FARA_OPRIRI, visibleMs: 80_000, visibleCount: 1 });
    render(<StatsPanel />);
    expect(screen.getByText(/și cu aplicația deschisă/).textContent).toContain('opriri: 1');
    expect(screen.queryByText(/cât aplicația nu era pe ecran/)).not.toBeInTheDocument();
  });
});
