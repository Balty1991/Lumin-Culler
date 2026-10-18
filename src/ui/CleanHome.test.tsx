import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CleanHome } from './CleanHome';
import { useStore, type PhotoView } from '../state/store';

function poza(over: Partial<PhotoView> & { id: string }): PhotoView {
  return {
    fileName: 'a.jpg',
    status: 'review',
    sharpness: 80,
    faceCount: 0,
    allEyesOpen: true,
    ...over
  } as PhotoView;
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    locale: 'en',
    photos: [],
    welcomeSeen: true,
    proMode: false,
    premium: false,
    premiumLocked: false,
    tiktokSortOpen: false,
    tiktokSortScopeIds: null
  });
});

describe('CleanHome', () => {
  it('shows a blurry imported photo as a basket and keeps manual review free', () => {
    useStore.setState({ photos: [poza({ id: 'blur', sharpness: 10, fileName: 'soft.jpg' })] });
    render(<CleanHome />);
    expect(screen.getByRole('heading', { name: 'Clean your gallery' })).toBeInTheDocument();
    expect(screen.getByText('Blurry')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review with swipe' }));
    expect(useStore.getState().tiktokSortOpen).toBe(true);
    expect(useStore.getState().tiktokSortScopeIds).toEqual(['blur']);
  });

  it('sends clean-all of imported photos to the same free swipe, without opening Premium', () => {
    useStore.setState({
      photos: [poza({ id: 'blur', sharpness: 10 })],
      premiumOpen: false,
      premiumReason: null
    });
    render(<CleanHome />);
    fireEvent.click(screen.getByRole('button', { name: 'Clean all (AI)' }));
    expect(useStore.getState().tiktokSortOpen).toBe(true);
    expect(useStore.getState().premiumOpen).toBe(false);
  });
});
