import { describe, expect, it, beforeEach } from 'vitest';
import { selectActivePersons, dormantPersons, readPreferredActive, writePreferredActive } from './activePersons';
import { FREE_ENROLLED_PERSONS } from './entitlement';
import type { KnownPerson } from './db';

/**
 * Ridicat de utilizator: cineva se aboneaza o luna, isi inroleaza toti oamenii,
 * apoi renunta si ramane cu ei pentru totdeauna — recunoasterea ruleaza la
 * fiecare import viitor, deci o luna cumpara valoare permanenta.
 *
 * Profilurile NU se sterg (sunt munca omului, acelasi principiu ca la dosarul
 * privat). Se opreste doar calculul continuu, adica exact ce se plateste lunar.
 */
const om = (id: string, enrolledAt: number): KnownPerson =>
  ({ id, name: id, embeddings: [[1, 0]], updatedAt: enrolledAt, enrolledAt });

describe('selectActivePersons', () => {
  beforeEach(() => { localStorage.clear(); });

  it('cu abonament, toate profilurile raman active', () => {
    localStorage.setItem('lumin-premium', '1');
    const toti = [om('a', 1), om('b', 2), om('c', 3)];
    expect(selectActivePersons(toti)).toHaveLength(3);
  });

  it('fara abonament, doar cate permite planul gratuit', () => {
    const toti = [om('a', 1), om('b', 2), om('c', 3)];
    expect(selectActivePersons(toti)).toHaveLength(FREE_ENROLLED_PERSONS);
  });

  it('nu sterge nimic — restul raman, doar adormite', () => {
    const toti = [om('a', 1), om('b', 2), om('c', 3)];
    const activi = selectActivePersons(toti);
    const adormiti = dormantPersons(toti);
    expect(activi.length + adormiti.length).toBe(3);
  });

  it('fara nicio alegere, ramane cel inrolat primul — raspuns stabil', () => {
    const toti = [om('c', 30), om('a', 10), om('b', 20)];
    expect(selectActivePersons(toti).map(p => p.id)).toEqual(['a']);
  });

  // Partea care schimba tonul: aplicatia nu decide in locul omului cine conteaza.
  it('respecta alegerea utilizatorului, nu ordinea de inrolare', () => {
    writePreferredActive(['c']);
    const toti = [om('a', 10), om('b', 20), om('c', 30)];
    expect(selectActivePersons(toti).map(p => p.id)).toEqual(['c']);
  });

  it('reabonarea readuce totul, fara sa fi pierdut ceva', () => {
    const toti = [om('a', 1), om('b', 2), om('c', 3)];
    expect(selectActivePersons(toti)).toHaveLength(FREE_ENROLLED_PERSONS);
    localStorage.setItem('lumin-premium', '1');
    expect(selectActivePersons(toti)).toHaveLength(3);
  });

  it('inregistrarile vechi, fara enrolledAt, cad pe updatedAt', () => {
    const vechi: KnownPerson = { id: 'vechi', name: 'v', embeddings: [[1]], updatedAt: 5 };
    const nou = om('nou', 99);
    expect(selectActivePersons([nou, vechi]).map(p => p.id)).toEqual(['vechi']);
  });

  it('o alegere stricata in stocare nu darama pornirea', () => {
    localStorage.setItem('lumin-active-persons', 'nu e json');
    expect(readPreferredActive()).toEqual([]);
    expect(selectActivePersons([om('a', 1)])).toHaveLength(1);
  });
});
