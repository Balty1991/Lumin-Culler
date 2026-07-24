import { describe, expect, it } from 'vitest';
import { buildPersonProfilesExport, personProfilesFileName, parsePersonProfilesFile } from './personProfileTransfer';
import type { KnownPerson } from './db';

function person(name: string, embeddings: number[][] = [[0.1, 0.2]]): KnownPerson {
  return { id: crypto.randomUUID(), name, embeddings, updatedAt: Date.now() };
}

describe('buildPersonProfilesExport', () => {
  it('exports only name and embeddings, not id/updatedAt', () => {
    const data = buildPersonProfilesExport([person('Ami', [[1, 2]])]);
    expect(data.version).toBe(1);
    expect(data.persons).toEqual([{ name: 'Ami', embeddings: [[1, 2]] }]);
  });
});

describe('personProfilesFileName', () => {
  it('uses the person name for a single-person export', () => {
    expect(personProfilesFileName([person('Ami')])).toBe('lumin-culler-persoana-Ami.json');
  });

  it('uses a generic dated name for multiple persons', () => {
    expect(personProfilesFileName([person('Ami'), person('Angi')])).toMatch(/^lumin-culler-persoane-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('sanitizes filesystem-unsafe characters in the name', () => {
    expect(personProfilesFileName([person('A/B:C')])).toBe('lumin-culler-persoana-A-B-C.json');
  });
});

describe('parsePersonProfilesFile', () => {
  it('parses a valid export round-tripped through buildPersonProfilesExport', async () => {
    const data = buildPersonProfilesExport([person('Ami', [[1, 2]])]);
    const file = new File([JSON.stringify(data)], 'x.json', { type: 'application/json' });
    const parsed = await parsePersonProfilesFile(file);
    expect(parsed.persons).toEqual([{ name: 'Ami', embeddings: [[1, 2]] }]);
  });

  it('rejects invalid JSON', async () => {
    const file = new File(['not json{{'], 'x.json');
    await expect(parsePersonProfilesFile(file)).rejects.toThrow();
  });

  it('rejects a wrong-shaped or wrong-version file', async () => {
    const file = new File([JSON.stringify({ version: 2, persons: [] })], 'x.json');
    await expect(parsePersonProfilesFile(file)).rejects.toThrow();
  });
});
