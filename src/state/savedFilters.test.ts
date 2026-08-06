import { describe, expect, it, beforeEach } from 'vitest';
import { readSavedFilters, writeSavedFilters, type SavedFilterPreset } from './savedFilters';

function makePreset(overrides: Partial<SavedFilterPreset> = {}): SavedFilterPreset {
  return {
    id: 'p1', name: 'Test', createdAt: 1000,
    personFilter: null, colorLabelFilter: null, sceneTagFilter: null, cameraFilter: null, projectFilter: null,
    searchText: '', minRating: 0,
    ...overrides
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('readSavedFilters', () => {
  it('returns [] when nothing stored', () => {
    expect(readSavedFilters()).toEqual([]);
  });

  it('round-trips presets written via writeSavedFilters', () => {
    const presets = [makePreset({ id: 'a' }), makePreset({ id: 'b', name: 'Zambet', minRating: 4, colorLabelFilter: 'red' })];
    writeSavedFilters(presets);
    expect(readSavedFilters()).toEqual(presets);
  });

  it('returns [] on corrupted JSON instead of throwing', () => {
    localStorage.setItem('lumin-saved-filters', '{not json');
    expect(readSavedFilters()).toEqual([]);
  });

  it('returns [] when stored value is not an array', () => {
    localStorage.setItem('lumin-saved-filters', JSON.stringify({ oops: true }));
    expect(readSavedFilters()).toEqual([]);
  });

  it('filters out structurally invalid entries, keeps valid ones', () => {
    const good = makePreset({ id: 'good' });
    localStorage.setItem('lumin-saved-filters', JSON.stringify([good, { id: 'bad' }, null, 'not an object']));
    expect(readSavedFilters()).toEqual([good]);
  });

  it('rejects an entry with an invalid colorLabelFilter value', () => {
    const bad = { ...makePreset(), colorLabelFilter: 'not-a-color' };
    localStorage.setItem('lumin-saved-filters', JSON.stringify([bad]));
    expect(readSavedFilters()).toEqual([]);
  });
});
