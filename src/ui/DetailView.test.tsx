import 'fake-indexeddb/auto';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DetailView } from './DetailView';
import { useStore, type PhotoView } from '../state/store';

function makePhoto(id: string): PhotoView {
  return {
    id, fileName: `${id}.jpg`, importedAt: 1, status: 'review', rating: 0, aiScore: 50,
    sceneType: 'portrait', contextKey: 'portrait:known', faceCount: 1, knownFaceCount: 1,
    strangerCount: 0, bestSmile: 0.5, allEyesOpen: true, sharpness: 80, exposure: 50,
    ruleOfThirds: 0.5, headroom: 0.5, personNames: [], aiFactors: []
  } as unknown as PhotoView;
}

/**
 * Regresie: butonul "Vezi metricile si editarea" din sortarea rapida cere
 * explicit metricile, deci foaia trebuie sa se deschida DESFASURATA. Altfel
 * utilizatorul apasa "metrici", ajunge pe alt ecran si trebuie sa mai apese o
 * data "METRICI" ca sa vada exact ce a cerut.
 */
describe('DetailView — foaia de metrici la deschidere', () => {
  beforeAll(() => {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  });
  beforeEach(() => {
    useStore.setState({ locale: 'ro', photos: [makePhoto('a'), makePhoto('b')], detailId: null, detailExpandMetrics: false });
  });

  it('deschiderea normala lasa foaia stransa', () => {
    const { container, rerender } = render(<DetailView />);
    useStore.getState().openDetail('a');
    rerender(<DetailView />);
    expect(container.querySelector('.detail-sheet')?.classList.contains('expanded')).toBe(false);
  });

  it('deschiderea cu expandMetrics arata metricile direct', () => {
    const { container, rerender } = render(<DetailView />);
    useStore.getState().openDetail('a', { expandMetrics: true });
    rerender(<DetailView />);
    expect(container.querySelector('.detail-sheet')?.classList.contains('expanded')).toBe(true);
  });
});
