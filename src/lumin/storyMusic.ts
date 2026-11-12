/**
 * lumin/storyMusic.ts
 * Muzica filmelor, compusă pe loc de telefon (nu un fișier cu drepturi de autor):
 * acorduri, bas, arpegiu și, la unele stări, tobe — toate sintetizate. Se înregistrează
 * împreună cu imaginea și poate fi pusă oriunde (Facebook, TikTok, Instagram) fără
 * probleme de copyright: nu există nicio melodie a altcuiva în ea.
 */
export interface StoryMusic { track: MediaStreamTrack; stop: () => void }

export type MusicMood = 'calm' | 'happy' | 'party' | 'summer' | 'kids' | 'romantic' | 'lofi' | 'cinematic';
export const MUSIC_MOODS: readonly MusicMood[] = ['calm', 'happy', 'party', 'summer', 'kids', 'romantic', 'lofi', 'cinematic'];

interface Preset {
  chords: number[][];       // note MIDI
  chordS: number;           // secunde pe acord
  pad: OscillatorType; padVol: number;
  arp: number; arpType: OscillatorType; arpVol: number; arpOctave?: number;
  bass: OscillatorType; bassVol: number;
  filter: number;
  kick?: number;            // lovituri pe acord
  hat?: number;             // hi-hat pe acord
  snare?: boolean;          // pe timpii 2 și 4
}

const POP = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]];          // Do–Sol–La m–Fa
const PRESETS: Record<MusicMood, Preset> = {
  calm: { chords: POP, chordS: 2.4, pad: 'triangle', padVol: 0.12, arp: 4, arpType: 'sine', arpVol: 0.07, bass: 'sine', bassVol: 0.18, filter: 2200 },
  happy: { chords: POP, chordS: 1.6, pad: 'triangle', padVol: 0.08, arp: 8, arpType: 'triangle', arpVol: 0.06, bass: 'sine', bassVol: 0.18, filter: 3200 },
  party: { chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], chordS: 1.9, pad: 'sawtooth', padVol: 0.035, arp: 8, arpType: 'square', arpVol: 0.025,
    bass: 'square', bassVol: 0.09, filter: 3600, kick: 4, hat: 8, snare: true },
  summer: { chords: POP, chordS: 1.5, pad: 'triangle', padVol: 0.06, arp: 8, arpType: 'sine', arpVol: 0.09, arpOctave: 2, bass: 'sine', bassVol: 0.16, filter: 3800, kick: 2, hat: 4 },
  kids: { chords: [[60, 64, 67], [53, 57, 60], [55, 59, 62], [60, 64, 67]], chordS: 1.6, pad: 'sine', padVol: 0.05, arp: 8, arpType: 'sine', arpVol: 0.08, arpOctave: 2,
    bass: 'triangle', bassVol: 0.12, filter: 5000 },
  romantic: { chords: [[53, 57, 60], [60, 64, 67], [50, 53, 57], [46, 50, 53]], chordS: 2.8, pad: 'triangle', padVol: 0.11, arp: 6, arpType: 'sine', arpVol: 0.06,
    bass: 'sine', bassVol: 0.16, filter: 2000 },
  lofi: { chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 48, 52, 55]], chordS: 2.2, pad: 'triangle', padVol: 0.07, arp: 4, arpType: 'sine', arpVol: 0.05,
    bass: 'sine', bassVol: 0.16, filter: 1300, kick: 2, hat: 4, snare: true },
  cinematic: { chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], chordS: 3.2, pad: 'sawtooth', padVol: 0.05, arp: 0, arpType: 'sine', arpVol: 0,
    bass: 'sine', bassVol: 0.22, filter: 1100, kick: 1 }
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * `mood`: starea muzicii (vezi MUSIC_MOODS). `speakers`: se și aude (previzualizarea
 * din aplicație), nu doar se înregistrează.
 */
export function startStoryMusic(durationMs: number, opts: { mood?: MusicMood; speakers?: boolean } = {}): StoryMusic | null {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return null;
  try {
    const ac = new Ctx();
    // Pornit după încărcarea pozelor, nu chiar din atingere: unele WebView-uri îl țin suspendat.
    void ac.resume().catch(() => {});
    const p = PRESETS[opts.mood ?? 'calm'] ?? PRESETS.calm;
    const dest = ac.createMediaStreamDestination();
    const master = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.filter;
    master.connect(filter).connect(dest);
    if (opts.speakers) filter.connect(ac.destination);
    // Tobele ocolesc filtrul (rămân clare).
    const drums = ac.createGain();
    drums.gain.value = 1;
    drums.connect(dest);
    if (opts.speakers) drums.connect(ac.destination);

    const t0 = ac.currentTime + 0.05;
    const total = durationMs / 1000;
    for (const g of [master.gain, drums.gain]) {
      g.setValueAtTime(0, t0);
      g.linearRampToValueAtTime(g === master.gain ? 0.22 : 1, t0 + 1.2);
      g.setValueAtTime(g === master.gain ? 0.22 : 1, Math.max(t0 + 1.3, t0 + total - 2));
      g.linearRampToValueAtTime(0, t0 + total);
    }

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
    let noise: AudioBuffer | null = null;
    const noiseBuf = () => {
      if (noise) return noise;
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.3), ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return noise;
    };
    const kick = (at: number) => {
      const o = ac.createOscillator(); const g = ac.createGain();
      o.frequency.setValueAtTime(140, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.15);
      g.gain.setValueAtTime(0.5, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
      o.connect(g).connect(drums); o.start(at); o.stop(at + 0.3);
    };
    const hiss = (at: number, len: number, type: BiquadFilterType, freq: number, vol: number) => {
      const s = ac.createBufferSource(); s.buffer = noiseBuf();
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ac.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
      s.connect(f).connect(g).connect(drums); s.start(at); s.stop(at + len + 0.02);
    };

    for (let c = 0, at = t0; at < t0 + total; c++, at += p.chordS) {
      const chord = p.chords[c % p.chords.length];
      for (const m of chord) note(hz(m) / 2, at, p.chordS + 0.3, p.pad, p.padVol);       // pad
      note(hz(chord[0]) / 4, at, p.chordS, p.bass, p.bassVol);                           // bas
      for (let k = 0; k < p.arp; k++) {                                                    // arpegiu
        const m = chord[(k * 2) % chord.length] + 12 * ((p.arpOctave ?? 1) - 1) + (k % 4 === 3 ? 12 : 0);
        note(hz(m), at + k * (p.chordS / p.arp), p.chordS / p.arp, p.arpType, p.arpVol);
      }
      for (let k = 0; k < (p.kick ?? 0); k++) kick(at + k * (p.chordS / p.kick!));
      for (let k = 0; k < (p.hat ?? 0); k++) hiss(at + (k + 0.5) * (p.chordS / p.hat!), 0.05, 'highpass', 7000, 0.12);
      if (p.snare) for (const k of [1, 3]) hiss(at + k * (p.chordS / 4), 0.16, 'bandpass', 1800, 0.25);
    }
    const [track] = dest.stream.getAudioTracks();
    return { track, stop: () => { void ac.close().catch(() => {}); } };
  } catch {
    return null;
  }
}
