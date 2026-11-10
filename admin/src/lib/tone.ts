// =====================================================================
//  TONE ZA COOPLINK — sauti ya kukaribisha mtumiaji akiingia kwenye mfumo.
//  Tone 4 zinapokezana: kila mtumiaji akiingia anasikia inayofuata (1 → 2 → 3 → 4 → 1 …).
//  Zinatengenezwa na kivinjari (Web Audio) — hakuna faili la kupakua.
//  Kivinjari kinaruhusu sauti tu baada ya mtumiaji kubonyeza kitu ("Ingia" inatosha).
// =====================================================================

let ctx: AudioContext | null = null;

type Ctx = AudioContext;
interface Kit { c: Ctx; out: GainNode; t0: number }

function nextIndex(): number {
  try {
    const i = (Number(localStorage.getItem('cl_tone_i') ?? '-1') + 1) % TONES.length;
    localStorage.setItem('cl_tone_i', String(i));
    return Number.isFinite(i) ? i : 0;
  } catch {
    return Math.floor(Math.random() * TONES.length);
  }
}

/** Mnyororo wa sauti: sauti kuu + mwangwi (echo) mdogo + compressor ili isikike vizuri bila kukwaruza */
function chain(c: Ctx, volume: number, echo = 0.22): GainNode {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.25;
  comp.connect(c.destination);
  const out = c.createGain();
  out.gain.value = volume;
  out.connect(comp);
  const d = c.createDelay(); d.delayTime.value = 0.21;
  const fb = c.createGain(); fb.gain.value = echo;
  const wet = c.createGain(); wet.gain.value = 0.28;
  out.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(comp);
  return out;
}

function voice(k: Kit, at: number, f: number, type: OscillatorType, peak: number, attack: number, decay: number, detune = 0) {
  const { c, out } = k;
  const t = k.t0 + at;
  const o = c.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + attack + decay + 0.05);
}
const marimba = (k: Kit, at: number, f: number, v: number) => {
  voice(k, at, f, 'sine', v, 0.006, 0.9);
  voice(k, at, f * 4, 'sine', v * 0.16, 0.004, 0.22);
  voice(k, at, f * 10, 'sine', v * 0.04, 0.002, 0.06);
};
const bell = (k: Kit, at: number, f: number, v: number) => {
  voice(k, at, f, 'sine', v, 0.004, 1.6);
  voice(k, at, f * 2.76, 'sine', v * 0.28, 0.003, 0.9);
  voice(k, at, f * 5.4, 'sine', v * 0.1, 0.002, 0.4);
};
const kalimba = (k: Kit, at: number, f: number, v: number) => {
  voice(k, at, f, 'triangle', v, 0.003, 0.55);
  voice(k, at, f * 3.01, 'sine', v * 0.22, 0.002, 0.18);
};
const pad = (k: Kit, at: number, f: number, v: number, dur: number) => {
  voice(k, at, f, 'triangle', v, 0.25, dur, -6);
  voice(k, at, f, 'sine', v * 0.7, 0.25, dur, 7);
};
/** Ngoma laini (kick) kwa mdundo */
const drum = (k: Kit, at: number, v: number) => {
  const { c, out } = k;
  const t = k.t0 + at;
  const o = c.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.4);
};

// Noti (Hz)
const N = { D3: 146.83, G3: 196, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, Fs5: 739.99, G5: 783.99, A5: 880, B5: 987.77, D6: 1174.66, E6: 1318.51, Fs6: 1479.98, G6: 1567.98 };

/** Tone 4: majina yanaonyesha hisia ya kila moja */
const TONES: { name: string; play: (k: Kit) => void }[] = [
  // 1. Majani — marimba tatu (majani matatu ya alama) zinafunguka kuwa kord ya joto
  { name: 'Majani', play: (k) => {
    marimba(k, 0.05, N.D5, 0.42); marimba(k, 0.27, N.Fs5, 0.4); marimba(k, 0.49, N.A5, 0.4);
    pad(k, 0.85, N.D3, 0.16, 2.2); pad(k, 0.85, N.D4, 0.13, 2.0); pad(k, 0.85, N.A4, 0.08, 1.8);
    marimba(k, 0.85, N.D6, 0.3); marimba(k, 1.1, N.A5, 0.18); marimba(k, 1.22, N.D6, 0.16); marimba(k, 1.42, N.Fs6, 0.14);
  } },
  // 2. Alfajiri — kengele laini zinapanda juu ya ukungu wa asubuhi
  { name: 'Alfajiri', play: (k) => {
    pad(k, 0, N.G3, 0.14, 2.6); pad(k, 0, N.D4, 0.11, 2.6); pad(k, 0.1, N.B4, 0.07, 2.4);
    bell(k, 0.15, N.G5, 0.3); bell(k, 0.45, N.B5, 0.26); bell(k, 0.75, N.D6, 0.24); bell(k, 1.1, N.G6, 0.2);
  } },
  // 3. Kalimba — mdundo mchangamfu wa kiafrika (pentatoniki ya C)
  { name: 'Kalimba', play: (k) => {
    const seq: [number, number][] = [[0, N.C5], [0.13, N.E5], [0.26, N.G5], [0.39, N.A5], [0.52, N.G5], [0.72, N.C5], [0.85, N.E6 / 2], [1.0, N.G5]];
    for (const [at, f] of seq) kalimba(k, at, f, 0.34);
    kalimba(k, 1.2, N.C5 * 2, 0.3); kalimba(k, 1.2, N.G5, 0.2);
    pad(k, 1.15, N.C4, 0.1, 1.6);
  } },
  // 4. Ngoma — marimba yenye mdundo wa ngoma, inamalizika kwa kishindo kifupi cha furaha
  { name: 'Ngoma', play: (k) => {
    drum(k, 0, 0.5); drum(k, 0.36, 0.38); drum(k, 0.54, 0.38); drum(k, 0.9, 0.55);
    marimba(k, 0.0, N.A4, 0.36); marimba(k, 0.18, N.C5, 0.34); marimba(k, 0.36, N.E5, 0.36); marimba(k, 0.54, N.D5, 0.32);
    marimba(k, 0.72, N.E5, 0.34); marimba(k, 0.9, N.A5, 0.42); marimba(k, 0.9, N.E5, 0.22);
    pad(k, 0.9, N.A3, 0.12, 1.6); pad(k, 0.9, N.E4, 0.09, 1.5);
  } },
];

/**
 * Fungua sauti ndani ya mbofyo wa mtumiaji (kitufe "Ingia"). Simu (hasa iPhone/Safari) zinaruhusu sauti
 * tu ikiwa imefunguliwa wakati huo huo wa kubofya — tone yenyewe inachezwa baadaye kuingia kukifaulu.
 */
export function unlockAudio() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx = ctx ?? new AC();
    void ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050); const src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0);
  } catch { /* hakuna sauti */ }
}

/** Cheza tone inayofuata (inapokezana kila mtumiaji akiingia). */
export function playTone(volume = 0.75) {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx = ctx ?? new AC();
    void ctx.resume();
    const k: Kit = { c: ctx, out: chain(ctx, volume), t0: ctx.currentTime + 0.05 };
    TONES[nextIndex()].play(k);
  } catch {
    /* sauti si muhimu — usivunje app */
  }
}

/** Kwa majaribio: cheza tone fulani (0–3) */
export function playToneAt(i: number, volume = 0.75) {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = ctx ?? new AC();
  void ctx.resume();
  TONES[((i % TONES.length) + TONES.length) % TONES.length].play({ c: ctx, out: chain(ctx, volume), t0: ctx.currentTime + 0.05 });
}
export const TONE_NAMES = () => TONES.map((t) => t.name);
