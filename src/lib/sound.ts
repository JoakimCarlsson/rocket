/** Every sound the app can trigger. Hooks are fire-and-forget and silent when muted. */
export type SoundCue =
  | "click"
  | "snap"
  | "whoosh"
  | "beep"
  | "ignition"
  | "liftoff"
  | "separation"
  | "explosion"
  | "success"
  | "fail"
  | "achievement";

type Listener = (cue: SoundCue) => void;

/** Browsers refuse audio before the first interaction, so stay silent until then. */
function hasUserGesture(): boolean {
  if (typeof navigator === "undefined") return false;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
}

/**
 * Tiny synthesised sound engine. Everything is generated with WebAudio so no assets ship;
 * other code only calls `play(cue)`, which keeps the door open for real samples later.
 */
class SoundBus {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private rumble: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private listeners = new Set<Listener>();
  muted = false;

  /** Lazily creates the audio graph; must follow a user gesture in most browsers. */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  /** Subscribes to cues, e.g. for haptics or analytics. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Mutes or unmutes everything. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stopRumble();
  }

  /** Plays a cue. */
  play(cue: SoundCue): void {
    this.listeners.forEach((l) => l(cue));
    if (this.muted || !hasUserGesture()) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    switch (cue) {
      case "click":
        this.tone(ctx, 880, 0.04, "square", 0.08);
        break;
      case "snap":
        this.tone(ctx, 1400, 0.05, "triangle", 0.12);
        this.noise(ctx, 0.05, 4000, 0.15);
        break;
      case "whoosh":
        this.noise(ctx, 0.5, 900, 0.25, true);
        break;
      case "beep":
        this.tone(ctx, 1046, 0.12, "sine", 0.3);
        break;
      case "ignition":
        this.startRumble(ctx);
        this.noise(ctx, 1.2, 300, 0.8);
        break;
      case "liftoff":
        this.noise(ctx, 2.5, 500, 0.9);
        break;
      case "separation":
        this.tone(ctx, 120, 0.25, "sawtooth", 0.3);
        this.noise(ctx, 0.3, 2000, 0.4);
        break;
      case "explosion":
        this.stopRumble();
        this.noise(ctx, 2.8, 180, 1.4);
        this.tone(ctx, 55, 1.2, "sine", 0.9);
        break;
      case "success":
        this.stopRumble();
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(ctx, f, 0.35, "triangle", 0.22), i * 110));
        break;
      case "fail":
        this.stopRumble();
        [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(ctx, f, 0.4, "sawtooth", 0.12), i * 160));
        break;
      case "achievement":
        [784, 1175].forEach((f, i) => setTimeout(() => this.tone(ctx, f, 0.25, "triangle", 0.2), i * 90));
        break;
    }
  }

  /** Fades out the engine rumble. */
  stopRumble(): void {
    if (!this.rumble || !this.context) return;
    const { source, gain } = this.rumble;
    gain.gain.setTargetAtTime(0, this.context.currentTime, 0.4);
    setTimeout(() => source.stop(), 2000);
    this.rumble = null;
  }

  /** Starts a looping low rumble for burning engines. */
  private startRumble(ctx: AudioContext): void {
    if (this.rumble || !this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx, 2);
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 160;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.9, ctx.currentTime, 0.5);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    this.rumble = { source, gain };
  }

  /** Plays an enveloped oscillator tone. */
  private tone(ctx: AudioContext, frequency: number, duration: number, type: OscillatorType, volume: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  /** Plays a filtered noise burst. */
  private noise(ctx: AudioContext, duration: number, cutoff: number, volume: number, sweep = false): void {
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx, duration);
    const filter = ctx.createBiquadFilter();
    filter.type = sweep ? "bandpass" : "lowpass";
    filter.frequency.value = cutoff;
    if (sweep) filter.frequency.exponentialRampToValueAtTime(cutoff * 4, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
  }

  /** Creates a buffer of white noise. */
  private noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}

/** Shared sound bus. */
export const sound = new SoundBus();
