import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LazyThumb, thumbSrc } from './LazyThumb';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LazyThumb', () => {
  it('builds a tiny mark only once the row is near the screen', () => {
    expect(thumbSrc('v1').length).toBeLessThan(400);
    const observe = vi.fn();
    class FakeObserver {
      observe = observe;
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(_callback: IntersectionObserverCallback) { /* held until the row intersects */ }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const { container } = render(<LazyThumb id="v1" />);
    expect(container.querySelector('img')).toBeNull();
    expect(observe).toHaveBeenCalledOnce();
  });
});
