/**
 * Audio. Every sound is synthesised at runtime: there are no audio assets in
 * this project, so the gun is a filtered noise burst with a body thump, the
 * spikes are band-passed noise transients, and the crowd is looping pink noise
 * shaped by a slow random envelope.
 *
 * The context starts suspended and is only resumed from a user gesture, which
 * is what browsers require and also what keeps the menu silent until the player
 * has interacted.
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private crowdSource: AudioBufferSourceNode | null = null;
  private breathTimer = 0;
  private started = false;
  muted = false;
  volume = 0.75;

  get ready(): boolean {
    return this.started && this.ctx !== null;
  }

  /** must be called from a user gesture */
  async start(): Promise<void> {
    if (this.started) {
      await this.ctx?.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // 2 s of pink-ish noise, reused by every noise voice
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099;
      b1 = 0.963 * b1 + white * 0.2965;
      b2 = 0.57 * b2 + white * 1.0526;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
    }
    this.noise = buf;

    /* crowd bed: noise through a wandering band-pass */
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 620;
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    this.crowdSource = src;
    this.crowdGain = g;
    this.crowdFilter = filt;

    this.started = true;
    await ctx.resume().catch(() => undefined);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
    }
  }

  setVolume(v: number): void {
    this.volume = clamp01(v);
    if (this.master && this.ctx && !this.muted) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  /** continuous crowd level, 0..1, plus a 0..1 excitement tilt */
  setCrowd(level: number, excite = 0.5): void {
    if (!this.ctx || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(clamp01(level) * 0.5, t, 0.6);
    if (this.crowdFilter) {
      this.crowdFilter.frequency.setTargetAtTime(520 + excite * 900, t, 0.8);
    }
  }

  /** the starting pistol: a crack, a slap-back off the stands, a body thump */
  shot(): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const burst = ctx.createBufferSource();
    burst.buffer = this.noise;
    burst.playbackRate.value = 1.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.35);
    bp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    burst.connect(bp).connect(g).connect(this.master);
    burst.start(t, Math.random());
    burst.stop(t + 0.6);

    // low body
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.55, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.45);

    // the stands answer
    const echo = ctx.createBufferSource();
    echo.buffer = this.noise;
    echo.playbackRate.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0.0001, t + 0.09);
    eg.gain.exponentialRampToValueAtTime(0.4, t + 0.16);
    eg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    echo.connect(lp).connect(eg).connect(this.master);
    echo.start(t + 0.09, Math.random());
    echo.stop(t + 1.2);
  }

  /** a spike plate biting: short, bright, and pitched by the load */
  step(load: number, pitch = 1): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 1.1 + Math.random() * 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    const f = (1500 + Math.random() * 1800) * pitch;
    hp.frequency.setValueAtTime(f, t);
    hp.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.09);
    hp.Q.value = 1.1;
    const g = ctx.createGain();
    const amp = 0.1 + clamp01(load) * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.16);
  }

  /** a breath, driven by the athlete's effort */
  breath(intensity: number): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1300, t + 0.18);
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05 + clamp01(intensity) * 0.07, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.32);
  }

  /** called every frame; paces the breathing from the athlete's effort */
  updateBreath(dt: number, effort: number): void {
    if (!this.ready) return;
    const rate = 0.55 + clamp01(effort) * 2.1;
    this.breathTimer -= dt;
    if (this.breathTimer <= 0) {
      this.breathTimer = 1 / rate;
      if (effort > 0.15) this.breath(effort);
    }
  }

  /** a crowd swell, for the finish and for the near-miss */
  cheer(size = 1): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.9;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.linearRampToValueAtTime(1500, t + 0.5);
    bp.frequency.linearRampToValueAtTime(700, t + 2.4);
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.34 * size, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 2.7);
  }

  /** UI blip */
  click(freq = 660, dur = 0.06): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** the finish bell: a bright inharmonic stack with a long tail */
  bell(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const partials = [1, 2.01, 2.98, 4.21, 5.44];
    const base = 784;
    partials.forEach((p, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * p;
      const g = ctx.createGain();
      const amp = 0.16 / (i + 1.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + i * 0.2);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 2.2);
    });
  }

  /** a dull buzz for a false start */
  buzz(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(90, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  dispose(): void {
    try {
      this.crowdSource?.stop();
    } catch {
      /* already stopped */
    }
    this.crowdSource = null;
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

export const audio = new Audio();
