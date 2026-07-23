import { describe, expect, it } from 'vitest';
import { pushHistory, popHistory, MAX_HISTORY, type HistoryEvent } from './history';

function makeEvent(photoId: string, ts = 0): HistoryEvent {
  return { photoId, previousStatus: 'review', newStatus: 'selected', ts };
}

describe('pushHistory', () => {
  it('appends to an empty stack', () => {
    const stack = pushHistory([], makeEvent('a'));
    expect(stack).toEqual([makeEvent('a')]);
  });

  it('appends in order, most recent last', () => {
    let stack: HistoryEvent[] = [];
    stack = pushHistory(stack, makeEvent('a'));
    stack = pushHistory(stack, makeEvent('b'));
    expect(stack.map(e => e.photoId)).toEqual(['a', 'b']);
  });

  it('caps at MAX_HISTORY, dropping the oldest entries', () => {
    let stack: HistoryEvent[] = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) stack = pushHistory(stack, makeEvent('p' + i));
    expect(stack).toHaveLength(MAX_HISTORY);
    // primele 5 (p0..p4) trebuie sa fi fost eliminate, ramane p5..p14
    expect(stack.map(e => e.photoId)).toEqual(
      Array.from({ length: MAX_HISTORY }, (_, i) => 'p' + (i + 5))
    );
  });

  it('does not mutate the input array', () => {
    const original: HistoryEvent[] = [makeEvent('a')];
    const next = pushHistory(original, makeEvent('b'));
    expect(original).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe('popHistory', () => {
  it('returns null event and the same (empty) stack when empty', () => {
    const { event, rest } = popHistory([]);
    expect(event).toBeNull();
    expect(rest).toEqual([]);
  });

  it('removes and returns the LAST (most recent) event', () => {
    const stack = [makeEvent('a', 1), makeEvent('b', 2), makeEvent('c', 3)];
    const { event, rest } = popHistory(stack);
    expect(event?.photoId).toBe('c');
    expect(rest.map(e => e.photoId)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const original = [makeEvent('a'), makeEvent('b')];
    popHistory(original);
    expect(original).toHaveLength(2);
  });

  it('supports repeated pops down to empty (undo N times)', () => {
    let stack = [makeEvent('a'), makeEvent('b'), makeEvent('c')];
    const order: string[] = [];
    while (stack.length) {
      const { event, rest } = popHistory(stack);
      if (event) order.push(event.photoId);
      stack = rest;
    }
    expect(order).toEqual(['c', 'b', 'a']);
  });
});
