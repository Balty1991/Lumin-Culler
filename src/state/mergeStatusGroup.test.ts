import { describe, expect, it } from 'vitest';
import { mergeStatusGroup } from './store';

describe('mergeStatusGroup', () => {
  const a = { id: 'a', status: 'review', groupId: undefined as string | undefined };
  const b = { id: 'b', status: 'selected', groupId: 'g1' };

  it('fără schimbări întoarce chiar aceeași listă', () => {
    const photos = [a, b];
    const out = mergeStatusGroup(photos, new Map([['a', { status: 'review' }], ['b', { status: 'selected', groupId: 'g1' }]]));
    expect(out).toBe(photos);
  });

  it('înlocuiește doar poza schimbată, restul rămân aceleași obiecte', () => {
    const out = mergeStatusGroup([a, b], new Map([['a', { status: 'rejected' }], ['b', { status: 'selected', groupId: 'g1' }]]));
    expect(out[0]).not.toBe(a);
    expect(out[0].status).toBe('rejected');
    expect(out[1]).toBe(b);
  });
});
