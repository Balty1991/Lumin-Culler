import { beforeEach, describe, expect, it } from 'vitest';
import { getProjectMetadata, setProjectMetadata } from './projectMetadata';

beforeEach(() => localStorage.clear());

describe('projectMetadata', () => {
  it('returns an empty object for a project with nothing saved', () => {
    expect(getProjectMetadata('Nunta Ana')).toEqual({});
  });

  it('saves and retrieves client/event/location for a given project name', () => {
    setProjectMetadata('Nunta Ana', { client: 'Ana & Mihai', event: 'Nunta', location: 'Brasov' });
    expect(getProjectMetadata('Nunta Ana')).toEqual({ client: 'Ana & Mihai', event: 'Nunta', location: 'Brasov' });
  });

  it('trims whitespace and drops empty fields entirely', () => {
    setProjectMetadata('P1', { client: '  Ana  ', event: '', location: '   ' });
    expect(getProjectMetadata('P1')).toEqual({ client: 'Ana' });
  });

  it('removes the project entry entirely once all fields are cleared', () => {
    setProjectMetadata('P1', { client: 'Ana' });
    setProjectMetadata('P1', {});
    expect(getProjectMetadata('P1')).toEqual({});
  });

  it('keeps metadata for different projects independent', () => {
    setProjectMetadata('P1', { client: 'Ana' });
    setProjectMetadata('P2', { client: 'Radu' });
    expect(getProjectMetadata('P1')).toEqual({ client: 'Ana' });
    expect(getProjectMetadata('P2')).toEqual({ client: 'Radu' });
  });
});
