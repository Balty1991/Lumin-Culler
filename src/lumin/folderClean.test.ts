import { describe, it, expect } from 'vitest';
import { summarizeFolders } from './folderClean';
import type { PhotoView } from '../state/store';

const base = { importedAt: 0, personNames: [], faceCount: 0, aiScore: 50, status: 'review', sizeBytes: 1000 } as unknown as PhotoView;
const p = (uri: string, extra: Partial<PhotoView> = {}): PhotoView => ({ ...base, id: uri, mediaUri: uri, ...extra } as PhotoView);
const uris = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('curățenia pe dosare', () => {
  const photos = [p('w0'), p('w1', { status: 'selected' }), p('w2', { status: 'rejected' }), p('w3', { personNames: ['Mia'] }), p('w4', { faceCount: 2 }), p('c0')];
  const folders = [
    { id: '1', name: 'Camera', count: 400, uris: ['c0'] },
    { id: '2', name: 'WhatsApp Images', count: 120, uris: uris('w', 6) },
    { id: '3', name: 'Vacanță', count: 30, uris: [] },
    { id: '4', name: 'Mic', count: 2, uris: [] }
  ];
  it('lasă deoparte camera și dosarele mici, cu pozele primite primele', () => {
    expect(summarizeFolders(folders, photos).map(f => f.name)).toEqual(['WhatsApp Images', 'Vacanță']);
  });
  it('se poate scoate doar ce nu e păstrat și n-are oameni (nici nenumiți)', () => {
    const w = summarizeFolders(folders, photos)[0];
    expect(w).toMatchObject({ inGallery: 120, read: 5, bytes: 2000, received: true });
    expect(w.removable.map(x => x.id)).toEqual(['w0', 'w2']);
  });
});
