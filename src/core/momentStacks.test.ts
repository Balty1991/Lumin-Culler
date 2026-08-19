import { describe, it, expect } from 'vitest';
import {
  buildMomentStacks, pickTopFrames, momentOf, countOpenMoments,
  MOMENT_GAP_MS, MIN_MOMENT_SIZE, MAX_TOP_PICKS, type MomentPhoto
} from './momentStacks';

const MIN = 60 * 1000;
function p(id: string, minutes: number, over: Partial<MomentPhoto> = {}): MomentPhoto {
  return { id, capturedAt: minutes * MIN, aiScore: 50, status: 'pending', ...over };
}
/** N cadre la un minut distanta, incepand de la `startMin`. */
function burst(prefix: string, startMin: number, n: number, over: Partial<MomentPhoto> = {}): MomentPhoto[] {
  return Array.from({ length: n }, (_, i) => p(`${prefix}${i}`, startMin + i, over));
}

describe('buildMomentStacks', () => {
  it('nu construieste nimic sub pragul de marime', () => {
    expect(buildMomentStacks(burst('a', 0, MIN_MOMENT_SIZE - 1))).toEqual([]);
  });

  it('grupeaza cadrele apropiate in timp intr-un singur moment', () => {
    const stacks = buildMomentStacks(burst('a', 0, 6));
    expect(stacks).toHaveLength(1);
    expect(stacks[0].ids).toHaveLength(6);
    expect(stacks[0].startMs).toBe(0);
    expect(stacks[0].endMs).toBe(5 * MIN);
  });

  it('rupe momentul la o pauza mai mare decat pragul', () => {
    const stacks = buildMomentStacks([
      ...burst('dimineata', 0, 5),
      ...burst('seara', 0 + MOMENT_GAP_MS / MIN + 60, 5)
    ]);
    expect(stacks).toHaveLength(2);
  });

  it('nu rupe momentul la o pauza exact cat pragul', () => {
    const gapMin = MOMENT_GAP_MS / MIN;
    const stacks = buildMomentStacks([
      p('a', 0), p('b', 1), p('c', 2), p('d', 3), p('e', 3 + gapMin)
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].ids).toHaveLength(5);
  });

  it('arunca momentele prea mici, pastrandu-le pe celelalte', () => {
    const stacks = buildMomentStacks([
      ...burst('mare', 0, 8),
      ...burst('mic', 1000, 2)
    ]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].ids[0]).toBe('mare0');
  });

  it('lasa pe dinafara pozele fara ora de captura — o grupare inventata e mai rea decat lipsa ei', () => {
    const stacks = buildMomentStacks([
      ...burst('a', 0, 5),
      { id: 'fara-ora', aiScore: 99, status: 'pending' }
    ]);
    expect(stacks[0].ids).not.toContain('fara-ora');
    expect(stacks[0].ids).toHaveLength(5);
  });

  it('nu depinde de ordinea din care primeste pozele', () => {
    const ordered = buildMomentStacks(burst('a', 0, 6));
    const shuffled = buildMomentStacks([...burst('a', 0, 6)].reverse());
    expect(shuffled[0].ids).toEqual(ordered[0].ids);
  });

  it('numara cadrele nedecise; "de verificat" inseamna inca nedecis', () => {
    const stacks = buildMomentStacks([
      p('a', 0, { status: 'selected' }), p('b', 1, { status: 'rejected' }),
      p('c', 2, { status: 'review' }), p('d', 3, { status: 'pending' }), p('e', 4, { status: 'pending' })
    ]);
    expect(stacks[0].undecided).toBe(3);
  });

  it('momentele cu cel mai mult de decis primele', () => {
    const stacks = buildMomentStacks([
      ...burst('gata', 0, 5, { status: 'selected' }),
      ...burst('detriat', 1000, 5, { status: 'pending' })
    ]);
    expect(stacks[0].ids[0]).toBe('detriat0');
  });

  it('cheia e stabila intre rulari', () => {
    const a = buildMomentStacks(burst('x', 0, 5));
    const b = buildMomentStacks(burst('x', 0, 5));
    expect(a[0].key).toBe(b[0].key);
  });
});

describe('pickTopFrames', () => {
  it('alege cele mai bune cadre, in ordine descrescatoare de scor', () => {
    expect(pickTopFrames([
      p('slab', 0, { aiScore: 30 }), p('bun', 1, { aiScore: 90 }), p('mediu', 2, { aiScore: 60 })
    ])).toEqual(['bun', 'mediu', 'slab']);
  });

  it('nu propune doua cadre din aceeasi serie — n-ar mai fi o alegere', () => {
    const picks = pickTopFrames([
      p('serie-a1', 0, { aiScore: 95, groupId: 'A' }),
      p('serie-a2', 1, { aiScore: 94, groupId: 'A' }),
      p('serie-a3', 2, { aiScore: 93, groupId: 'A' }),
      p('alta', 3, { aiScore: 50, groupId: 'B' })
    ]);
    expect(picks).toEqual(['serie-a1', 'alta']);
  });

  it('pozele fara serie conteaza fiecare ca serie proprie', () => {
    const picks = pickTopFrames([
      p('a', 0, { aiScore: 90 }), p('b', 1, { aiScore: 80 }), p('c', 2, { aiScore: 70 })
    ]);
    expect(picks).toHaveLength(3);
  });

  it('respecta limita', () => {
    const many = Array.from({ length: 10 }, (_, i) => p(`p${i}`, i, { aiScore: 100 - i }));
    expect(pickTopFrames(many)).toHaveLength(MAX_TOP_PICKS);
    expect(pickTopFrames(many, 1)).toEqual(['p0']);
  });

  it('la scor egal, ordinea e stabila', () => {
    expect(pickTopFrames([p('b', 1), p('a', 0)])).toEqual(['a', 'b']);
  });
});

describe('momentOf si countOpenMoments', () => {
  const stacks = buildMomentStacks([
    ...burst('unu', 0, 5, { status: 'pending' }),
    ...burst('doi', 1000, 5, { status: 'selected' })
  ]);

  it('gaseste momentul unei poze', () => {
    expect(momentOf(stacks, 'unu2')?.ids).toContain('unu0');
    expect(momentOf(stacks, 'inexistent')).toBeNull();
  });

  it('numara doar momentele cu ceva de decis', () => {
    expect(countOpenMoments(stacks)).toBe(1);
  });
});
