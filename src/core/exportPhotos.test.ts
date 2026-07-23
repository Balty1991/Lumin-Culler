import { describe, expect, it, vi, beforeEach } from 'vitest';

const getDirectoryPicker = vi.fn<() => null>(() => null);
const downloadZip = vi.fn<(name: string, entries: { path: string; data: Uint8Array }[]) => Promise<void>>(async () => {});

vi.mock('./export/directoryPicker', () => ({
  getDirectoryPicker: () => getDirectoryPicker(),
  downloadZip: (name: string, entries: { path: string; data: Uint8Array }[]) => downloadZip(name, entries)
}));

// exportOriginalFiles cade pe db.originals.get() DOAR daca fisierul nu e in
// originalFiles (Map in memorie) — populam Map-ul direct, deci Dexie/IndexedDB
// nu e niciodata atins in acest test.
import { originalFiles } from './importPipeline';
import { exportOriginalFiles } from './exportPhotos';

function fakeFile(name: string): File {
  return new File(['continut-fals'], name, { type: 'image/jpeg' });
}

describe('exportOriginalFiles (fallback fara File System Access API)', () => {
  beforeEach(() => {
    originalFiles.clear();
    getDirectoryPicker.mockReturnValue(null);
    downloadZip.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('exporta un singur fisier printr-o descarcare directa, NU printr-un zip', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(1);
    expect(result.grouped).toBe(false);
    expect(downloadZip).not.toHaveBeenCalled();
  });

  it('exporta mai multe fisiere printr-o SINGURA arhiva .zip, nu prin descarcari secventiale', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    originalFiles.set('p3', fakeFile('c.jpg'));
    const result = await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p2', fileName: 'b.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p3', fileName: 'c.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    expect(result.exported).toBe(3);
    expect(result.grouped).toBe(true);
    // exact O SINGURA arhiva, cu toate cele 3 fisiere in ea — nu 3 descarcari separate
    // (bug real reparat: descarcarile secventiale sunt blocate silentios pe multe browsere mobile)
    expect(downloadZip).toHaveBeenCalledTimes(1);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries).toHaveLength(3);
  });

  it('grupeaza corect caile din zip pe folderul de persoana/scena', async () => {
    originalFiles.set('p1', fakeFile('a.jpg'));
    originalFiles.set('p2', fakeFile('b.jpg'));
    await exportOriginalFiles([
      { id: 'p1', fileName: 'a.jpg', personNames: ['Ami'], faceCount: 1, strangerCount: 0, sceneType: 'portrait' },
      { id: 'p2', fileName: 'b.jpg', personNames: [], faceCount: 0, strangerCount: 0, sceneType: 'landscape' }
    ]);
    const entries = downloadZip.mock.calls[0][1];
    expect(entries.some(e => e.path === 'Ami/a.jpg')).toBe(true);
    expect(entries.some(e => e.path === 'Peisaje/b.jpg')).toBe(true);
  });
});
