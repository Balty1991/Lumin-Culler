import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStore, type PhotoView } from '../state/store';
import { useLx } from './lxStore';
import { SwipeSort } from './SwipeSort';
import { readPairs } from '../core/learning/pairs';

/**
 * Compararea din alegeri: două cadre din aceeași serie; omul atinge pe cel bun,
 * acela rămâne, celălalt iese, iar perechea se notează pentru motorul de preferințe.
 */
const photo = (id: string, aiScore: number): PhotoView => ({
  id, status: 'review', aiScore, groupId: 'g1', aiDecided: true, faceCount: 1, personNames: [], sceneTags: [], aiFactors: [], createdAt: 1_700_000_000_000
} as unknown as PhotoView);

beforeEach(() => {
  try { localStorage.clear(); } catch { /* */ }
});

describe('compararea a două cadre', () => {
  it('păstrează cadrul ales, scoate celălalt și notează perechea', async () => {
    const setStatus = vi.fn(async () => undefined);
    useStore.setState({ photos: [photo('a', 70), photo('b', 60)], setStatus, locale: 'ro' } as never);
    act(() => { useLx.getState().openSort(['a', 'b']); });
    render(<SwipeSort />);
    fireEvent.click(await screen.findByText(/Compară/));
    const picks = await screen.findAllByText(/Asta/);
    expect(picks).toHaveLength(2);
    fireEvent.click(picks[1]);
    expect(setStatus).toHaveBeenCalledWith('b', 'selected');
    expect(setStatus).toHaveBeenCalledWith('a', 'rejected');
    expect(readPairs()).toMatchObject([{ w: 'b', l: 'a' }]);
  });
});
