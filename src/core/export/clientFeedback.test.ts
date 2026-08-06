import { describe, expect, it } from 'vitest';
import { parseClientFeedbackFile } from './clientFeedback';

function jsonFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], 'feedback.json', { type: 'application/json' });
}

describe('parseClientFeedbackFile', () => {
  it('parses a well-formed feedback file produced by the client gallery HTML', async () => {
    const data = await parseClientFeedbackFile(jsonFile({
      version: 1, galleryId: 'lc-abc123', exportedAt: '2026-08-06T00:00:00.000Z',
      photos: [{ id: 'p1', fileName: 'a.jpg', decision: 'like' }, { id: 'p2', fileName: 'b.jpg', decision: 'dislike' }]
    }));
    expect(data.photos).toHaveLength(2);
    expect(data.photos[0]).toEqual({ id: 'p1', fileName: 'a.jpg', decision: 'like' });
  });

  it('accepts a file with zero picks (client marked nothing)', async () => {
    const data = await parseClientFeedbackFile(jsonFile({ version: 1, photos: [] }));
    expect(data.photos).toEqual([]);
  });

  it('rejects a file that is not valid JSON', async () => {
    await expect(parseClientFeedbackFile(new File(['not json'], 'f.json'))).rejects.toThrow('nu este un JSON valid');
  });

  it('rejects a wrong/future version number', async () => {
    await expect(parseClientFeedbackFile(jsonFile({ version: 2, photos: [] }))).rejects.toThrow('nerecunoscut');
  });

  it('rejects a payload missing the photos array', async () => {
    await expect(parseClientFeedbackFile(jsonFile({ version: 1 }))).rejects.toThrow('nerecunoscut');
  });

  it('rejects an entry with an invalid decision value', async () => {
    await expect(parseClientFeedbackFile(jsonFile({
      version: 1, photos: [{ id: 'p1', fileName: 'a.jpg', decision: 'maybe' }]
    }))).rejects.toThrow('nerecunoscut');
  });

  it('rejects an entry missing id or fileName', async () => {
    await expect(parseClientFeedbackFile(jsonFile({
      version: 1, photos: [{ fileName: 'a.jpg', decision: 'like' }]
    }))).rejects.toThrow('nerecunoscut');
  });
});
