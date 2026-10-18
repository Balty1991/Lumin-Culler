import { describe, expect, it, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { BottomNav } from './BottomNav';
import { setLuminSettingsOpen } from './shellState';
import { useStore, type PhotoView } from '../state/store';

/**
 * Trei taburi: Curăță, Bibliotecă, Setări. Pastila trebuie să stea pe coloana
 * tabului activ. Indexul e contractul cu grila de 3 coloane din CSS.
 */
function unaPoza(): PhotoView {
  return { id: 1, name: 'a.jpg', status: 'pending' } as unknown as PhotoView;
}

const INCHIS = {
  collectionsOpen: false, personsOpen: false, menuOpen: false,
  exportDestinationsOpen: false, homeGridOpen: false, tiktokSortOpen: false,
  proMode: false
};

function pastila(container: HTMLElement) {
  const toate = container.querySelectorAll('.bottom-nav-pill');
  expect(toate.length, 'trebuie sa existe fix o pastila').toBe(1);
  return toate[0] as HTMLElement;
}

describe('BottomNav — trei destinații', () => {
  beforeEach(() => {
    setLuminSettingsOpen(false);
    useStore.setState({ locale: 'ro', photos: [unaPoza()], ...INCHIS });
  });

  it('randeaza bara si pe o biblioteca goala: Curăță e mereu o destinație', () => {
    useStore.setState({ photos: [] });
    const { container } = render(<BottomNav />);
    expect(container.querySelectorAll('.bottom-nav-tab')).toHaveLength(3);
  });

  it.each([
    ['Curăță', {}, '0'],
    ['Bibliotecă', { homeGridOpen: true, proMode: true }, '1'],
    ['Setări', {}, '2']
  ])('pe %s pastila sta pe coloana corespunzatoare', (_nume, stare, index) => {
    if (index === '2') setLuminSettingsOpen(true);
    useStore.setState({ ...INCHIS, ...stare });
    const { container } = render(<BottomNav />);
    const p = pastila(container);
    expect(p.style.getPropertyValue('--nav-active')).toBe(index);
    expect(p.dataset.hidden).toBeUndefined();
  });

  it('are exact trei taburi, iar Curăță și Biblioteca nu sunt active deodată', () => {
    const { container } = render(<BottomNav />);
    expect(container.querySelectorAll('.bottom-nav-tab')).toHaveLength(3);
    for (const homeGridOpen of [false, true]) {
      act(() => { useStore.setState({ ...INCHIS, homeGridOpen, proMode: homeGridOpen }); });
      const view = render(<BottomNav />);
      expect(view.container.querySelectorAll('.bottom-nav-tab.active')).toHaveLength(1);
      view.unmount();
    }
  });

  it('sortarea rapida deschisa peste grila scoate marcajul', () => {
    useStore.setState({ ...INCHIS, homeGridOpen: true, proMode: true, tiktokSortOpen: true });
    const { container } = render(<BottomNav />);
    expect(pastila(container).dataset.hidden).toBe('true');
    expect(container.querySelector('.bottom-nav-tab.active')).toBeNull();
  });
});
