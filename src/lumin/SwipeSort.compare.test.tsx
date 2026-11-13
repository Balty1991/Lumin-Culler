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

  it('tras la dreapta = păstrez, în sus = mai târziu, puțin = revine', async () => {
    (HTMLElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => undefined;
    const setStatus = vi.fn(async () => undefined);
    const solo = (id: string) => ({ ...photo(id, 60), groupId: undefined }) as unknown as PhotoView;
    useStore.setState({ photos: [solo('x'), solo('y'), solo('z')], setStatus, locale: 'ro' } as never);
    act(() => { useLx.getState().openSort(['x', 'y', 'z']); });
    const { container } = render(<SwipeSort />);
    const card = () => container.ownerDocument.querySelector('.lx-card-photo.top') as HTMLElement;
    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(card(), { pointerId: 1, clientX: 100, clientY: 300 });
      fireEvent.pointerMove(card(), { pointerId: 1, clientX: 100 + dx, clientY: 300 + dy });
      fireEvent.pointerUp(card(), { pointerId: 1, clientX: 100 + dx, clientY: 300 + dy });
    };
    swipe(20, 0);
    expect(setStatus).not.toHaveBeenCalled();
    swipe(200, 0);
    expect(setStatus).toHaveBeenLastCalledWith('x', 'selected');
    await act(async () => { await new Promise(r => setTimeout(r, 300)); });
    swipe(0, -200);
    expect(setStatus).toHaveBeenLastCalledWith('y', 'candidate');
  });
});
