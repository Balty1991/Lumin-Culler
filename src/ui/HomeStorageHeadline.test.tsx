import { describe, expect, it } from 'vitest';
import { formatGB } from '../state/storageStats';
import { ro } from '../i18n/ro';
import { en } from '../i18n/en';
import { t } from '../i18n';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ui/HomeStorageHeadline.test.tsx
 * Spatiul eliberat, promovat de la subtitlu la titlu pe ecranul principal.
 *
 * DE CE MERITA UN TEST. Nu e o rearanjare vizuala: e singura propozitie din
 * aplicatie care raspunde la intrebarea pentru care majoritatea oamenilor
 * instaleaza asa ceva ("mi s-a umplut telefonul"). Ce se poate strica aici nu
 * da nicio eroare — cardul arata pur si simplu iar vocabularul aplicatiei
 * ("37 de poze respinse") in loc de castigul utilizatorului ("eliberezi 2,4 GB").
 *
 * Si o capcana concreta, deja evitata o data in cod: cand nu stim octetii,
 * "eliberezi 0,0 GB" nu e un argument, e o gluma involuntara.
 */
const sursa = readFileSync(resolve(__dirname, 'HomeDashboard.tsx'), 'utf8');

describe('ierarhia cardului de stergere', () => {
  it('titlul e spatiul, subtitlul e numarul de poze — nu invers', () => {
    // `<b>` e titlul cardului. Trebuie sa contina cheia de spatiu, iar cea de
    // numarare sa fie in `<span>`-ul de dedesubt.
    const zona = sursa.slice(sursa.indexOf('home-delete-text'), sursa.indexOf('home-delete-go'));
    expect(zona.indexOf('home.delete.titleSpace')).toBeLessThan(zona.indexOf('home.delete.sub.'));
    expect(zona).toMatch(/<b>\{tr\('home\.delete\.titleSpace'/);
  });

  it('fara octeti cunoscuti NU se afiseaza o cifra de spatiu', () => {
    // Poze importate inainte ca marimea sa fie retinuta: acolo se cade inapoi
    // pe numarul de poze, care e mereu adevarat.
    const zona = sursa.slice(sursa.indexOf('home-delete-text'), sursa.indexOf('home-delete-go'));
    expect(zona).toContain('hasKnownFreed ?');
    expect(zona).toContain('home.delete.title.one');
  });

  it('pragul de "stim octetii" exclude exact zeroul', () => {
    // `formatGB` rotunjeste la o zecimala, deci orice sub 50 MB devine "0.0".
    expect(formatGB(0)).toBe('0.0');
    expect(formatGB(10 * 1024 * 1024)).toBe('0.0');
    expect(sursa).toContain("const hasKnownFreed = freedGB !== '0.0'");
  });
});

describe('cardul de sus spune ce POATE elibera, nu ce a adus', () => {
  it('cand exista ceva de eliberat, aia se afiseaza', () => {
    const zona = sursa.slice(sursa.indexOf('home-hero-text'), sursa.indexOf('home-hero-ring'));
    expect(zona.indexOf('home.hero.freeable')).toBeLessThan(zona.indexOf('home.hero.size'));
  });

  it('altfel ramane randul vechi, care e tot adevarat', () => {
    const zona = sursa.slice(sursa.indexOf('home-hero-text'), sursa.indexOf('home-hero-ring'));
    expect(zona).toContain('hasKnownSize &&');
  });
});

describe('textele exista in ambele limbi si spun ce trebuie', () => {
  it.each(['home.hero.freeable', 'home.delete.titleSpace', 'home.delete.sub.one', 'home.delete.sub.other'])(
    '%s e tradusa peste tot', cheie => {
      expect(ro[cheie as keyof typeof ro], `lipseste ${cheie} in romana`).toBeTruthy();
      expect(en[cheie as keyof typeof en], `lipseste ${cheie} in engleza`).toBeTruthy();
    }
  );

  it('titlul contine chiar cifra, nu o promisiune vaga', () => {
    expect(t('ro', 'home.delete.titleSpace', { gb: '2.4' })).toBe('Eliberezi 2.4 GB');
    expect(t('en', 'home.delete.titleSpace', { gb: '2.4' })).toBe('Free up 2.4 GB');
  });

  it('subtitlul spune de UNDE se elibereaza — de pe telefon, nu din aplicatie', () => {
    // Distinctia conteaza: concurenta "elibereaza spatiu" urcand pozele in cloud
    // si stergand copiile locale. Aici gunoiul chiar dispare, si asta trebuie sa
    // reiasa din propozitie.
    expect(t('ro', 'home.delete.sub.other', { count: 37 })).toContain('de pe telefon');
    expect(t('en', 'home.delete.sub.other', { count: 37 })).toContain('from your phone');
  });
});
