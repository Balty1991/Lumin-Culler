// Dexie real peste fake-indexeddb: cardul isi ia datele din db.corrections, iar
// un dublu de-al bazei ar testa dublul, nu drumul pe care merge aplicatia.
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiProfileCard } from './AiProfileCard';
import { db } from '../core/db';
import { useStore } from '../state/store';
import { MIN_DECISIONS_FOR_ACCURACY, RECENT_WINDOW } from '../core/learning/accuracy';

/**
 * ui/AiProfileCard.test.tsx
 * Cardul care spune cat de des a avut motorul dreptate.
 *
 * Testele de aici pazesc UN singur lucru, dar cel mai important: cifra e o
 * afirmatie despre incredere, deci n-are voie nici sa apara prea devreme (cand
 * ar fi zgomot), nici sa taca atunci cand e proasta.
 */
let seq = 0;
/** `agreed` decizii in care motorul a nimerit, `wrong` in care nu — in ordinea data. */
async function writeCorrections(agreed: number, wrong: number): Promise<void> {
  const rows = [
    ...Array.from({ length: agreed }, () => ({ ai: true, user: true })),
    ...Array.from({ length: wrong }, () => ({ ai: true, user: false }))
  ];
  await db.corrections.bulkAdd(rows.map(r => ({
    photoId: `p${seq++}`, contextKey: 'x', features: {},
    aiDecision: r.ai, userDecision: r.user, ts: 1_700_000_000_000 + seq * 1000
  })));
}

beforeEach(async () => {
  seq = 0;
  await db.corrections.clear();
  useStore.setState({ insightsOpen: false });
});

describe('cand cifra n-ar insemna nimic, nu se arata nicio cifra', () => {
  it('pe un telefon pe care n-ai decis nimic nu randeaza nimic', async () => {
    // O promisiune fara nicio acoperire n-are ce cauta pe ecranul principal.
    const { container } = render(<AiProfileCard />);
    // Randare asincrona: asteptam ciclul de citire din baza inainte sa concluzionam.
    await new Promise(r => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('sub pragul motorului NU arata niciun procent — arata cat mai lipseste', async () => {
    // Un procent din cateva decizii e o coincidenta afisata ca statistica. Dar
    // nici tacerea totala nu era buna: cardul lipsea exact in sesiunea in care
    // omul hotaraste daca are incredere in aplicatie. Contorul nu e o estimare.
    await writeCorrections(6, 0);
    render(<AiProfileCard />);
    expect(await screen.findByText(/Învăț din deciziile tale/)).toBeInTheDocument();
    expect(screen.getByText(/încă 14 decizii/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('la o singura decizie ramasa vorbeste la singular', async () => {
    await writeCorrections(MIN_DECISIONS_FOR_ACCURACY - 1, 0);
    render(<AiProfileCard />);
    expect(await screen.findByText(/încă o decizie/)).toBeInTheDocument();
  });

  it('contorul arata si numitorul, ca sa se vada ca nu e un procent', async () => {
    await writeCorrections(6, 0);
    render(<AiProfileCard />);
    const contor = await screen.findByText(/^6/);
    expect(contor.textContent).toBe(`6/${MIN_DECISIONS_FOR_ACCURACY}`);
  });
});

describe('cifrele aratate', () => {
  it('arata acordul si pe cate decizii ale TALE se bazeaza', async () => {
    await writeCorrections(18, 6); // 24 de decizii, 75% acord
    render(<AiProfileCard />);
    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/24 de decizii luate de tine/)).toBeInTheDocument();
  });

  it('nu inventeaza o tendinta din prea putine decizii', async () => {
    // Sub doua ferestre pline, "tendinta" ar compara aceleasi decizii cu ele
    // insele si ar arata mereu o miscare mica — vezi accuracy.ts.
    await writeCorrections(20, 4);
    render(<AiProfileCard />);
    await screen.findByText(/decizii luate de tine/);
    expect(screen.queryByText(/decât la început|sub cum începuse|constant/)).not.toBeInTheDocument();
  });

  it('arata cresterea cand motorul chiar s-a adaptat la tine', async () => {
    // Fereastra veche: jumatate gresite. Fereastra recenta: toate bune.
    await writeCorrections(RECENT_WINDOW / 2, RECENT_WINDOW / 2);
    await writeCorrections(RECENT_WINDOW, 0);
    render(<AiProfileCard />);
    expect(await screen.findByText(/50 de puncte mai bine decât la început/)).toBeInTheDocument();
  });

  it('arata SCADEREA la fel de clar — asta face cifra credibila', async () => {
    // Un indicator care nu poate arata rau nu e un indicator, e o reclama.
    await writeCorrections(RECENT_WINDOW, 0);
    await writeCorrections(RECENT_WINDOW / 2, RECENT_WINDOW / 2);
    render(<AiProfileCard />);
    const trend = await screen.findByText(/50 de puncte sub cum începuse/);
    expect(trend).toHaveAttribute('data-dir', 'down');
  });

  it('o diferenta de un punct e zgomot, nu o tendinta', async () => {
    await writeCorrections(RECENT_WINDOW, 0);
    await writeCorrections(RECENT_WINDOW, 0);
    render(<AiProfileCard />);
    expect(await screen.findByText(/la fel de constant ca la început/)).toBeInTheDocument();
  });
});

describe('cardul duce undeva', () => {
  it('deschide panoul care chiar explica ce a invatat motorul', async () => {
    await writeCorrections(20, 4);
    render(<AiProfileCard />);
    fireEvent.click(await screen.findByRole('button'));
    expect(useStore.getState().insightsOpen).toBe(true);
  });
});
