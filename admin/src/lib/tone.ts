// Tone rasmi ya CoopLink (sonic logo) — inatengenezwa na kivinjari kwa Web Audio.
// Noti tatu za marimba (D, F#, A) kwa majani matatu, kord ya joto kwa kiini cha chama,
// na mng'ao mdogo wa mwisho. Faili sawa liko public/cooplink-tone.mp3 kwa app ya Flutter.
// Kivinjari kinaruhusu sauti tu baada ya mtumiaji kubonyeza kitu (mf. "Ingia").

let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem('cl_sound') !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem('cl_sound', on ? 'on' : 'off');
  } catch {
    /* hakuna storage — sawa */
  }
}

export function playTone(volume = 0.6) {
  if (!soundEnabled()) return;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try {
    ctx = ctx ?? new AC();
    void ctx.resume();
    const c = ctx;
    const t0 = c.currentTime + 0.04;

    const master = c.createGain();
    master.gain.value = volume;
    const delay = c.createDelay();
    delay.delayTime.value = 0.19;
    const fb = c.createGain();
    fb.gain.value = 0.28;
    const wet = c.createGain();
    wet.gain.value = 0.32;
    master.connect(c.destination);
    master.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(c.destination);

    const voice = (t: number, f: number, type: OscillatorType, peak: number, attack: number, decay: number) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
      o.connect(g);
      g.connect(master);
      o.start(t);
      o.stop(t + attack + decay + 0.05);
    };
    const marimba = (t: number, f: number, v: number) => {
      voice(t, f, 'sine', v, 0.006, 0.9);
      voice(t, f * 4, 'sine', v * 0.16, 0.004, 0.22);
      voice(t, f * 10, 'sine', v * 0.04, 0.002, 0.06);
    };
    const pad = (t: number, f: number, v: number, dur: number) => voice(t, f, 'triangle', v, 0.14, dur);

    marimba(t0 + 0.25, 587.33, 0.42);
    marimba(t0 + 0.47, 739.99, 0.4);
    marimba(t0 + 0.69, 880.0, 0.4);
    pad(t0 + 1.05, 146.83, 0.2, 2.2);
    pad(t0 + 1.05, 293.66, 0.16, 2.0);
    pad(t0 + 1.05, 440.0, 0.1, 1.8);
    marimba(t0 + 1.05, 1174.66, 0.3);
    marimba(t0 + 1.3, 880.0, 0.18);
    marimba(t0 + 1.42, 1174.66, 0.16);
    marimba(t0 + 1.62, 1479.98, 0.14);
    marimba(t0 + 1.62, 2349.32, 0.06);
  } catch {
    /* sauti si muhimu — usivunje app */
  }
}
