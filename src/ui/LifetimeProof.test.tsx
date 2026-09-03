// Dexie real peste fake-indexeddb: ritmul se citeste din db.corrections, iar un
// dublu de-al bazei ar testa dublul, nu drumul pe care merge aplicatia.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LifetimeProof } from './LifetimeProof';
import { recordLifetimeSession } from '../state/lifetimeSavings';
import { MIN_GAPS } from '../core/decisionPace';
import { db } from '../core/db';

/**
 * ui/LifetimeProof.test.tsx
 * Blocul de dovada din capul ecranului Premium.
 *
 * Testele de aici nu verifica aspectul, ci CE ARE VOIE sa scrie blocul asta.
 * E singurul loc din aplicatie in care o cifra sta imediat deasupra unui buton
 * de plata, deci singurul in care o exagerare ar semana cu o inselatorie, nu cu
 * o eroare de afisare.
 */
async function writeDecisions(count: number, gapMs: number): Promise<void> {
  await db.corrections.clear();
  const base = 1_700_000_000_000;
  await db.corrections.bulkAdd(
    Array.from({ length: count }, (_, i) => ({
      photoId: `p${i}`, contextKey: 'x', features: {},
      aiDecision: true, userDecision: false, ts: base + i * gapMs
    }))
  );
}

beforeEach(async () => {
  localStorage.clear();
  await db.corrections.clear();
});

describe('cand nu are ce spune, nu spune nimic', () => {
  it('nu randeaza nimic fara nicio sedinta', () => {
    const { container } = render(<LifetimeProof locale="ro" premium={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nu randeaza nimic dupa o singura sedinta, oricat de mare', () => {
    // 4 000 de poze intr-un singur import nu sunt un "total": sunt ultimul
    // import spus a doua oara, iar cardul de dupa import l-a spus deja mai bine.
    recordLifetimeSession({ imported: 4000, autoDecided: 3900 });
    const { container } = render(<LifetimeProof locale="ro" premium={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('cifrele aratate sunt cele numarate', () => {
  it('fara un ritm masurat nu apare NICIUN timp — doar ce s-a numarat', async () => {
    // Regula centrala. Fara destule decizii ale utilizatorului, orice "≈ 2 ore
    // economisite" ar fi inventat. Blocul nu tace de tot: ramane cu pozele si
    // sedintele, care sunt numarate, nu estimate.
    await writeDecisions(MIN_GAPS - 5, 4000);
    recordLifetimeSession({ imported: 200, autoDecided: 180 });
    recordLifetimeSession({ imported: 100, autoDecided: 90 });
    render(<LifetimeProof locale="ro" premium={false} />);

    expect(await screen.findByText(/300 de poze triate până acum/)).toBeInTheDocument();
    expect(screen.getByText(/300 de poze triate în 2 sesiuni/)).toBeInTheDocument();
    expect(screen.queryByText(/economisite până acum/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ritmul tău măsurat/)).not.toBeInTheDocument();
  });

  it('cu ritm masurat arata timpul SI baza din care iese', async () => {
    // 4 s pe decizie x 270 de decizii automate = 1 080 s = 18 minute.
    await writeDecisions(MIN_GAPS + 10, 4000);
    recordLifetimeSession({ imported: 200, autoDecided: 180 });
    recordLifetimeSession({ imported: 100, autoDecided: 90 });
    render(<LifetimeProof locale="ro" premium={false} />);

    expect(await screen.findByText(/18 min economisite până acum/)).toBeInTheDocument();
    // Baza sta MEREU langa cifra: cine vede din ce iese numarul il poate judeca
    // singur, si asta e diferenta dintre o masuratoare si o reclama.
    expect(screen.getByText(/ritmul tău măsurat, 4\.0 s pe decizie/)).toBeInTheDocument();
  });

  it('timpul urmeaza deciziile AUTOMATE, nu pozele importate', async () => {
    // Poza pe care ai decis-o tu n-a fost economisita de nimeni. Daca inmultirea
    // s-ar face pe `imported`, cifra ar fi umflata exact cu munca ta.
    await writeDecisions(MIN_GAPS + 10, 10_000);
    recordLifetimeSession({ imported: 1000, autoDecided: 6 });
    recordLifetimeSession({ imported: 1000, autoDecided: 6 });
    render(<LifetimeProof locale="ro" premium={false} />);
    // 12 decizii automate x 10 s = 2 minute, nu 2 000 de poze x 10 s.
    expect(await screen.findByText(/2 min economisite până acum/)).toBeInTheDocument();
  });
});

describe('formularea urmeaza starea reala a abonamentului', () => {
  it('unui neabonat i se spune ca n-a platit nimic', async () => {
    recordLifetimeSession({ imported: 50, autoDecided: 40 });
    recordLifetimeSession({ imported: 50, autoDecided: 40 });
    render(<LifetimeProof locale="ro" premium={false} />);
    expect(await screen.findByText(/fără să plătești nimic/)).toBeInTheDocument();
  });

  it('unui abonat NU i se spune asta — el chiar plateste', async () => {
    recordLifetimeSession({ imported: 50, autoDecided: 40 });
    recordLifetimeSession({ imported: 50, autoDecided: 40 });
    render(<LifetimeProof locale="ro" premium={true} />);
    expect(await screen.findByText(/de când folosești aplicația/)).toBeInTheDocument();
    expect(screen.queryByText(/fără să plătești nimic/)).not.toBeInTheDocument();
  });

  it('merge si in engleza, unde nu exista particula "de"', async () => {
    recordLifetimeSession({ imported: 50, autoDecided: 40 });
    recordLifetimeSession({ imported: 50, autoDecided: 40 });
    render(<LifetimeProof locale="en" premium={false} />);
    expect(await screen.findByText(/100 photos culled across 2 sessions/)).toBeInTheDocument();
  });
});
