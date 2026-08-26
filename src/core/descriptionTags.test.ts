import { describe, it, expect } from 'vitest';
import { descriptionTags, subjectTags } from './descriptionTags';

describe('descriptionTags', () => {
  it('scoate subiectele dintr-o descriere reala', () => {
    // Descrierea chiar produsa de model pe telefonul utilizatorului.
    const tags = descriptionTags('A double rainbow arches over a residential street with a fence and a parked van.');
    expect(tags).toContain('rainbow');
    expect(tags).toContain('street');
    expect(tags).toContain('fence');
    expect(tags).toContain('van');
    // "a", "over", "with", "and" n-au ce cauta: ar deveni cele mai frecvente
    // "subiecte" din biblioteca si ar ingropa semnalul real.
    expect(tags).not.toContain('with');
    expect(tags).not.toContain('over');
  });

  it('aduce pluralul la forma de la ML Kit', () => {
    expect(descriptionTags('Two rainbows and several flowers')).toContain('rainbow');
    expect(descriptionTags('Two rainbows and several flowers')).toContain('flower');
  });

  it('nu strica cuvintele care se termina in s fara sa fie plural', () => {
    expect(descriptionTags('A glass on the grass')).toContain('glass');
    expect(descriptionTags('A glass on the grass')).toContain('grass');
  });

  it('fara descriere, lista e goala', () => {
    expect(descriptionTags(undefined)).toEqual([]);
    expect(descriptionTags('')).toEqual([]);
  });

  it('o propozitie lunga nu domina memoria', () => {
    const long = Array.from({ length: 40 }, (_, i) => `subiect${i}`).join(' ');
    expect(descriptionTags(long).length).toBeLessThanOrEqual(8);
  });
});

describe('subjectTags', () => {
  it('uneste etichetele modelului cu cele din descriere, fara duplicate', () => {
    const tags = subjectTags({ sceneTags: ['sky', 'rainbow'], aiDescription: 'A rainbow over a street' });
    expect(tags).toContain('sky');
    expect(tags).toContain('street');
    expect(tags.filter(t => t === 'rainbow')).toHaveLength(1);
  });

  it('merge si fara descriere, si fara etichete', () => {
    expect(subjectTags({ sceneTags: ['dog'] })).toEqual(['dog']);
    expect(subjectTags({})).toEqual([]);
  });
});
