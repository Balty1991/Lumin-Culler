import { describe, expect, it, beforeEach } from 'vitest';
import { readLifetime, recordLifetimeSession, hasLifetimeStory, MIN_SESSIONS_FOR_TOTAL } from './lifetimeSavings';

/**
 * state/lifetimeSavings.test.ts
 * Totalul cumulat din capul ecranului Premium.
 *
 * Ce se poate strica aici nu da nicio eroare: cifra devine pur si simplu mai
 * mare decat adevarul. Iar asta e cel mai scump fel de bug din toata
 * aplicatia — un total umflat intr-un ecran care cere bani se verifica singur,
 * de catre exact utilizatorul pe care incercai sa-l convingi.
 */
beforeEach(() => localStorage.clear());

describe('recordLifetimeSession', () => {
  it('aduna loturile, si numara sedintele separat de poze', () => {
    recordLifetimeSession({ imported: 120, autoDecided: 100 });
    const total = recordLifetimeSession({ imported: 80, autoDecided: 60 });
    expect(total).toMatchObject({ sessions: 2, imported: 200, autoDecided: 160 });
    expect(readLifetime()).toMatchObject({ sessions: 2, imported: 200, autoDecided: 160 });
  });

  it('un lot gol nu se numara nici macar ca sedinta', () => {
    // Un import anulat inainte sa intre ceva in baza nu e o sedinta de lucru.
    // Numarat, ar umfla exact cifra care trebuie sa ramana credibila.
    recordLifetimeSession({ imported: 0, autoDecided: 0 });
    expect(readLifetime()).toMatchObject({ sessions: 0, imported: 0 });
  });

  it('retine momentul PRIMEI sedinte si nu-l mai rescrie', () => {
    recordLifetimeSession({ imported: 10, autoDecided: 8 }, 1000);
    recordLifetimeSession({ imported: 10, autoDecided: 8 }, 9999);
    expect(readLifetime().firstTs).toBe(1000);
  });

  it('nu arunca si nu opreste importul cand localStorage refuza sa scrie', () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new Error('cota plina'); };
    try {
      expect(() => recordLifetimeSession({ imported: 5, autoDecided: 5 })).not.toThrow();
    } finally {
      localStorage.setItem = original;
    }
  });
});

describe('readLifetime', () => {
  it('intoarce zero, nu null, cand nu s-a scris nimic', () => {
    expect(readLifetime()).toEqual({ sessions: 0, imported: 0, autoDecided: 0, firstTs: 0 });
  });

  it('trateaza o cheie stricata ca pe un total gol, nu ca pe o eroare', () => {
    // Cheia poate fi editata de mana, sau lasata de o versiune veche. Un JSON
    // invalid n-are voie sa arunce intr-un ecran care se deschide la o apasare.
    localStorage.setItem('lumin-lifetime-savings', '{nu e json');
    expect(readLifetime().sessions).toBe(0);
  });

  it('ignora valorile imposibile in loc sa le afiseze', () => {
    // Un `imported: -5` sau `"multe"` ar ajunge direct in propozitia aratata
    // utilizatorului. Aici se opresc.
    localStorage.setItem('lumin-lifetime-savings', JSON.stringify({
      sessions: -3, imported: 'multe', autoDecided: Infinity, firstTs: null
    }));
    expect(readLifetime()).toEqual({ sessions: 0, imported: 0, autoDecided: 0, firstTs: 0 });
  });

  it('rotunjeste in jos, ca sa nu apara vreodata "1.5 sedinte"', () => {
    localStorage.setItem('lumin-lifetime-savings', JSON.stringify({ sessions: 2.7, imported: 10.9, autoDecided: 9.5 }));
    expect(readLifetime()).toMatchObject({ sessions: 2, imported: 10, autoDecided: 9 });
  });
});

describe('hasLifetimeStory', () => {
  it('tace dupa o singura sedinta — cardul de import tocmai a spus-o mai bine', () => {
    recordLifetimeSession({ imported: 400, autoDecided: 380 });
    expect(readLifetime().sessions).toBeLessThan(MIN_SESSIONS_FOR_TOTAL);
    expect(hasLifetimeStory(readLifetime())).toBe(false);
  });

  it('vorbeste de la a doua sedinta incolo', () => {
    recordLifetimeSession({ imported: 400, autoDecided: 380 });
    recordLifetimeSession({ imported: 100, autoDecided: 90 });
    expect(hasLifetimeStory(readLifetime())).toBe(true);
  });

  it('tace cand motorul n-a decis nimic singur, oricate sedinte ar fi', () => {
    // Fara nicio decizie automata nu exista nici timp economisit, nici merit de
    // raportat: ar fi un bloc de lauda pentru o munca facuta integral de om.
    recordLifetimeSession({ imported: 30, autoDecided: 0 });
    recordLifetimeSession({ imported: 30, autoDecided: 0 });
    expect(hasLifetimeStory(readLifetime())).toBe(false);
  });
});
