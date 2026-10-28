import { describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false } }));
vi.mock('../core/db', () => ({ db: {} }));
vi.mock('../state/store', () => ({ useStore: { getState: () => ({}) } }));
import { clusterFaces, cosine } from './faceIdentity';

const face = (id: string, e: number[]) => ({ photoId: id, faceIndex: 0, box: [0, 0, 0.2, 0.2] as [number, number, number, number], embedding: e });

describe('faceIdentity', () => {
  it('cosine', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1], [1, 2])).toBe(0);
  });
  it('grupează fețele care seamănă, cele mai mari grupuri primele', () => {
    const groups = clusterFaces([face('a', [1, 0.1]), face('b', [0, 1]), face('c', [0.95, 0.15]), face('d', [1, 0])]);
    expect(groups.map(g => g.map(f => f.photoId).sort())).toEqual([['a', 'c', 'd'], ['b']]);
  });
});
