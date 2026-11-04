/**
 * lumin/storyMusic.ts
 * Muzica filmelor, compusă pe loc de telefon (nu un fișier cu drepturi de
 * autor): o progresie liniștită de acorduri (Do–Sol–La minor–Fa), un pad moale
 * și un arpegiu discret, cu intrare și ieșire lină. Se înregistrează împreună
 * cu imaginea; poate fi trimisă oriunde, fără probleme de copyright.
 */
const CHORDS = [
  [261.63, 329.63, 392.0],  // Do
  [196.0, 246.94, 392.0],   // Sol
  [220.0, 261.63, 329.63],  // La minor
  [174.61, 220.0, 349.23]   // Fa
];
const CHORD_S = 2.4;

export interface StoryMusic { track: MediaStreamTrack; stop: () => void }

export type MusicMood = 'calm' | 'happy';

/**
 * `mood`: „calm” = cea de până acum; „happy” = aceleași acorduri, mai repede, cu
 * arpegiu vioi. `speakers`: se și aude (previzualizarea din aplicație), nu doar
 * se înregistrează.
 */
export function startStoryMusic(durationMs: number, opts: { mood?: MusicMood; speakers?: boolean } = {}): StoryMusic | null {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return null;
  try {
    const ac = new Ctx();
    // Pornit după încărcarea pozelor, nu chiar din atingere: unele WebView-uri îl țin suspendat.
    void ac.resume().catch(() => {});
    const dest = ac.createMediaStreamDestination();
    const master = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    master.connect(filter).connect(dest);
    if (opts.speakers) filter.connect(ac.destination);
    const happy = opts.mood === 'happy';
    const chordS = happy ? 1.6 : CHORD_S;
    if (happy) filter.frequency.value = 3200;
    const t0 = ac.currentTime + 0.05;
    const total = durationMs / 1000;
    master.gain.setValueAtTime(0, t0);
    master.gain.linearRampToValueAtTime(0.22, t0 + 1.5);
    master.gain.setValueAtTime(0.22, Math.max(t0 + 1.6, t0 + total - 2));
    master.gain.linearRampToValueAtTime(0, t0 + total);

    const note = (freq: number, at: number, len: number, type: OscillatorType, vol: number) => {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + Math.min(0.4, len / 3));
      g.gain.setValueAtTime(vol, at + len * 0.6);
      g.gain.linearRampToValueAtTime(0, at + len);
      o.connect(g).connect(master);
      o.start(at);
      o.stop(at + len + 0.05);
    };
    for (let c = 0, at = t0; at < t0 + total; c++, at += chordS) {
      const chord = CHORDS[c % CHORDS.length];
      for (const f of chord) note(f / 2, at, chordS + 0.3, 'triangle', happy ? 0.08 : 0.12);  // pad
      note(chord[0] / 4, at, chordS, 'sine', 0.18);                                          // bas
      const n = happy ? 8 : 4;
      for (let k = 0; k < n; k++) note(chord[(k * 2) % 3] * (k % 4 === 3 ? 2 : 1), at + k * (chordS / n), chordS / n, happy ? 'triangle' : 'sine', happy ? 0.06 : 0.07); // arpegiu
    }
    const [track] = dest.stream.getAudioTracks();
    return { track, stop: () => { void ac.close().catch(() => {}); } };
  } catch {
    return null;
  }
}
