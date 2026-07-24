import { describe, expect, it, vi, beforeEach } from 'vitest';

const previewsGet = vi.fn<(id: string) => Promise<{ photoId: string; blob: Blob } | undefined>>();
const thumbnailsGet = vi.fn<(id: string) => Promise<{ photoId: string; blob: Blob } | undefined>>();

vi.mock('./db', () => ({
  db: {
    previews: { get: (id: string) => previewsGet(id) },
    thumbnails: { get: (id: string) => thumbnailsGet(id) }
  }
}));

import { getCachedPreviewUrl, clearPreviewUrlCache } from './previewUrlCache';

function fakeBlob(): Blob {
  return new Blob(['x'], { type: 'image/jpeg' });
}

describe('getCachedPreviewUrl', () => {
  beforeEach(() => {
    clearPreviewUrlCache();
    previewsGet.mockReset();
    thumbnailsGet.mockReset();
    let counter = 0;
    URL.createObjectURL = vi.fn(() => `blob:mock-${++counter}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('fetches from db.previews and creates an object URL on first call', async () => {
    previewsGet.mockResolvedValue({ photoId: 'p1', blob: fakeBlob() });
    const url = await getCachedPreviewUrl('p1');
    expect(url).toBe('blob:mock-1');
    expect(previewsGet).toHaveBeenCalledWith('p1');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('reuses the SAME object URL on a second call for the same photo, without re-reading the blob', async () => {
    previewsGet.mockResolvedValue({ photoId: 'p1', blob: fakeBlob() });
    const first = await getCachedPreviewUrl('p1');
    const second = await getCachedPreviewUrl('p1');
    expect(second).toBe(first);
    expect(previewsGet).toHaveBeenCalledTimes(1); // NOT called again on the cache hit
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('falls back to db.thumbnails when no preview exists (older imports)', async () => {
    previewsGet.mockResolvedValue(undefined);
    thumbnailsGet.mockResolvedValue({ photoId: 'p2', blob: fakeBlob() });
    const url = await getCachedPreviewUrl('p2');
    expect(url).toBe('blob:mock-1');
    expect(thumbnailsGet).toHaveBeenCalledWith('p2');
  });

  it('returns null when the photo has neither a preview nor a thumbnail', async () => {
    previewsGet.mockResolvedValue(undefined);
    thumbnailsGet.mockResolvedValue(undefined);
    expect(await getCachedPreviewUrl('missing')).toBeNull();
  });

  it('evicts and revokes the least-recently-used entry once the cache exceeds its cap', async () => {
    previewsGet.mockImplementation(async (id: string) => ({ photoId: id, blob: fakeBlob() }));
    // fill the cache past its 40-entry cap
    for (let i = 0; i < 41; i++) await getCachedPreviewUrl(`p${i}`);
    // the very first entry (p0) should have been evicted + revoked
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
    // re-requesting p0 must hit the DB again (it's no longer cached) and create a fresh URL
    previewsGet.mockClear();
    await getCachedPreviewUrl('p0');
    expect(previewsGet).toHaveBeenCalledWith('p0');
  });

  it('touching a cached entry protects it from eviction (moves it to most-recently-used)', async () => {
    previewsGet.mockImplementation(async (id: string) => ({ photoId: id, blob: fakeBlob() }));
    // p0 and p1 both inserted, p0 first (oldest so far)
    await getCachedPreviewUrl('p0');
    await getCachedPreviewUrl('p1');
    // re-touch p0 — it moves PAST p1 in LRU order, so p1 becomes the oldest instead
    await getCachedPreviewUrl('p0');
    // fill up to the 40-entry cap with fresh distinct ids — this should evict p1 (now oldest), not p0
    for (let i = 2; i <= 40; i++) await getCachedPreviewUrl(`p${i}`);
    previewsGet.mockClear();
    await getCachedPreviewUrl('p0');
    expect(previewsGet).not.toHaveBeenCalled(); // still cached — was protected by the touch
    await getCachedPreviewUrl('p1');
    expect(previewsGet).toHaveBeenCalledWith('p1'); // evicted instead, since it was oldest after p0's touch
  });

  it('clearPreviewUrlCache revokes every cached URL and empties the cache', async () => {
    previewsGet.mockResolvedValue({ photoId: 'p1', blob: fakeBlob() });
    const url = await getCachedPreviewUrl('p1');
    clearPreviewUrlCache();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    previewsGet.mockClear();
    await getCachedPreviewUrl('p1');
    expect(previewsGet).toHaveBeenCalledWith('p1'); // cache was emptied, must re-fetch
  });
});
