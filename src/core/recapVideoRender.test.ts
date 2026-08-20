import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickMimeType, extensionFor, isRecapVideoSupported } from './recapVideoRender';

const originalMR = globalThis.MediaRecorder;
afterEach(() => { globalThis.MediaRecorder = originalMR; });

function fakeRecorder(supported: string[]) {
  globalThis.MediaRecorder = Object.assign(
    vi.fn(),
    { isTypeSupported: (t: string) => supported.includes(t) }
  ) as unknown as typeof MediaRecorder;
}

describe('pickMimeType', () => {
  it('prefera mp4 cu H.264 — singurul redat peste tot', () => {
    fakeRecorder(['video/webm;codecs=vp9', 'video/mp4;codecs=avc1']);
    expect(pickMimeType()).toBe('video/mp4;codecs=avc1');
  });

  it('REFUZA mp4 fara codec cerut — Chromium livreaza VP9 in container mp4', () => {
    // Capcana reala, prinsa la verificare: fisierul are extensia .mp4 si nu-l
    // reda nimic, nici macar browserul care l-a scris. Un webm cinstit e mai bun.
    fakeRecorder(['video/mp4', 'video/webm;codecs=vp9']);
    expect(pickMimeType()).toBe('video/webm;codecs=vp9');
  });

  it('cade pe webm cand mp4 nu exista, in loc sa renunte', () => {
    fakeRecorder(['video/webm;codecs=vp8', 'video/webm']);
    expect(pickMimeType()).toBe('video/webm;codecs=vp8');
  });

  it('intoarce null cand nu se poate inregistra nimic', () => {
    fakeRecorder([]);
    expect(pickMimeType()).toBeNull();
  });

  it('nu arunca pe un mediu fara MediaRecorder deloc', () => {
    // @ts-expect-error stergem deliberat, ca pe un browser vechi
    delete globalThis.MediaRecorder;
    expect(pickMimeType()).toBeNull();
    expect(isRecapVideoSupported()).toBe(false);
  });
});

describe('extensionFor', () => {
  it('da extensia care se potriveste cu ce s-a inregistrat', () => {
    expect(extensionFor('video/mp4;codecs=avc1')).toBe('mp4');
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionFor('video/webm')).toBe('webm');
  });
});
