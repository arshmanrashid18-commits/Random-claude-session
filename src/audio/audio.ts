/**
 * Procedural audio: an adaptive generative score, layered ambience driven by
 * what the camera sees, spatialised effects for every divine act and
 * disaster, and interface sounds. Pure WebAudio — every sound is synthesised
 * at runtime; there are no audio files.
 *
 * Mix: sources → (music | ambience | sfx | ui) buses → master → soft limiter.
 */
import * as THREE from 'three';

export type Mood = 'calm' | 'wonder' | 'tension' | 'dread' | 'war' | 'night';

const MODES: Record<Mood, { scale: number[]; prog: number[][]; tempo: number; bright: number; density: number }> = {
  calm: { scale: [0, 2, 4, 7, 9], prog: [[0, 4, 7], [5, 9, 12], [9, 12, 16], [7, 11, 14]], tempo: 76, bright: 1800, density: 0.5 },
  wonder: { scale: [0, 2, 4, 6, 7, 9, 11], prog: [[0, 4, 7, 11], [2, 6, 9, 14], [7, 11, 14, 18], [4, 7, 11, 14]], tempo: 70, bright: 2600, density: 0.65 },
  tension: { scale: [0, 2, 3, 5, 7, 9, 10], prog: [[0, 3, 7], [5, 8, 12], [10, 14, 17], [7, 10, 14]], tempo: 84, bright: 1500, density: 0.55 },
  dread: { scale: [0, 1, 3, 5, 7, 8, 10], prog: [[0, 3, 7], [1, 5, 8], [0, 3, 6], [-2, 1, 5]], tempo: 60, bright: 900, density: 0.35 },
  war: { scale: [0, 2, 3, 5, 7, 8, 10], prog: [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]], tempo: 96, bright: 1700, density: 0.7 },
  night: { scale: [0, 2, 4, 7, 9], prog: [[0, 7, 16], [5, 12, 16], [9, 16, 19], [4, 11, 16]], tempo: 58, bright: 1000, density: 0.3 },
};

const ROOT = 50; // D3

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export interface AudioView {
  camera: THREE.PerspectiveCamera;
  altitude: number;
  oceanNear: number;
  forestNear: number;
  settlementNear: number;
  fireNear: number;
  rain: number;
  night: number;
  storm: number;
  paused: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private amb!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private layers: Record<string, { gain: GainNode; filter: BiquadFilterNode; src: AudioBufferSourceNode }> = {};
  mood: Mood = 'calm';
  private moodScore: Record<Mood, number> = { calm: 1, wonder: 0, tension: 0, dread: 0, war: 0, night: 0 };
  private nextChord = 0;
  private chordIdx = 0;
  private nextBeat = 0;
  private beat = 0;
  private padVoices: { osc: OscillatorNode[]; gain: GainNode }[] = [];
  private padFilter!: BiquadFilterNode;
  private drone: { osc: OscillatorNode; gain: GainNode } | null = null;
  private delay!: DelayNode;
  private volumes = { master: 0.8, music: 0.6, sfx: 0.8, ui: 0.6 };
  private chirpAt = 0;
  private cricketAt = 0;
  private started = false;
  enabled = true;

  /** Must be called from a user gesture (autoplay policy). */
  start(): void {
    if (this.started) { void this.ctx?.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.started = true;
    const ctx = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.music = ctx.createGain();
    this.amb = ctx.createGain();
    this.sfx = ctx.createGain();
    this.ui = ctx.createGain();
    for (const g of [this.music, this.amb, this.sfx, this.ui]) g.connect(this.master);
    // Reverb: a synthesized hall.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.master);
    // Echo for plucks.
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2400;
    this.delay.connect(dl);
    dl.connect(fb);
    fb.connect(this.delay);
    dl.connect(this.music);
    dl.connect(this.reverbSend);
    // Noise source shared by ambience and effects.
    this.noise = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = this.noise.getChannelData(ch);
      let b = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; b = 0.985 * b + 0.015 * w; d[i] = w * 0.55 + b * 3.5; }
    }
    // Ambience beds.
    this.layer('wind', 'bandpass', 420, 0.8);
    this.layer('ocean', 'lowpass', 520, 0.7);
    this.layer('rain', 'highpass', 1800, 0.5);
    this.layer('fire', 'bandpass', 900, 1.5);
    this.layer('town', 'bandpass', 700, 2.5);
    // Pads.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1400;
    this.padFilter.Q.value = 0.6;
    this.padFilter.connect(this.music);
    this.padFilter.connect(this.reverbSend);
    this.applyVolumes();
    this.nextChord = ctx.currentTime + 0.5;
    this.nextBeat = ctx.currentTime + 1;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); else void this.ctx.resume();
    });
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.5;
    }
    return buf;
  }

  private layer(name: string, type: BiquadFilterType, freq: number, q: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.amb);
    src.start(0, Math.random() * 3);
    this.layers[name] = { gain, filter, src };
  }

  setVolumes(v: { master: number; music: number; sfx: number; ui: number }): void {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = this.volumes;
    this.master.gain.setTargetAtTime(this.enabled ? v.master : 0, t, 0.1);
    this.music.gain.setTargetAtTime(v.music * 0.55, t, 0.2);
    this.amb.gain.setTargetAtTime(v.sfx * 0.6, t, 0.2);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.ui.gain.setTargetAtTime(v.ui * 0.5, t, 0.05);
  }

  /** Push the mood toward a state (events call this; it decays back to calm/night). */
  nudge(m: Mood, amount: number): void {
    this.moodScore[m] = Math.min(3, this.moodScore[m] + amount);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number, v: AudioView): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    // Listener = camera.
    const L = ctx.listener;
    const p = v.camera.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(v.camera.quaternion);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(v.camera.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.05); L.positionY.setTargetAtTime(p.y, t, 0.05); L.positionZ.setTargetAtTime(p.z, t, 0.05);
      L.forwardX.setTargetAtTime(f.x, t, 0.05); L.forwardY.setTargetAtTime(f.y, t, 0.05); L.forwardZ.setTargetAtTime(f.z, t, 0.05);
      L.upX.setTargetAtTime(u.x, t, 0.05); L.upY.setTargetAtTime(u.y, t, 0.05); L.upZ.setTargetAtTime(u.z, t, 0.05);
    }
    // Ambience beds follow the view.
    const low = Math.max(0, 1 - v.altitude / 300);
    const set = (name: string, g: number, freq?: number) => {
      const l = this.layers[name];
      if (!l) return;
      l.gain.gain.setTargetAtTime(g, t, 0.6);
      if (freq !== undefined) l.filter.frequency.setTargetAtTime(freq, t, 0.8);
    };
    const orbit = Math.min(1, v.altitude / 1500);
    set('wind', 0.05 + orbit * 0.12 + v.storm * 0.25 + low * 0.03, 300 + orbit * 500 + v.storm * 400);
    const swell = 0.55 + 0.45 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
    set('ocean', v.oceanNear * low * 0.35 * swell, 400 + swell * 300);
    set('rain', v.rain * (0.08 + low * 0.3));
    set('fire', v.fireNear * low * 0.5 * (0.6 + Math.random() * 0.8));
    set('town', v.settlementNear * low * 0.12 * (v.night > 0.5 ? 0.4 : 1));
    // Birds by day, crickets by night, in green places.
    if (low > 0.3 && v.forestNear > 0.15 && !v.paused) {
      if (v.night < 0.5 && t > this.chirpAt) { this.chirp(v.forestNear * low); this.chirpAt = t + 0.6 + Math.random() * 3.5 / (0.2 + v.forestNear); }
      if (v.night >= 0.5 && t > this.cricketAt) { this.cricket(low); this.cricketAt = t + 0.35 + Math.random() * 0.6; }
    }
    // Mood.
    for (const k of Object.keys(this.moodScore) as Mood[]) if (k !== 'calm') this.moodScore[k] *= Math.exp(-dt / 40);
    this.moodScore.night = v.night * 0.9;
    this.moodScore.calm = 0.8;
    let best: Mood = 'calm', bs = 0;
    for (const [k, s] of Object.entries(this.moodScore) as [Mood, number][]) if (s > bs) { bs = s; best = k; }
    this.mood = best;
    this.music.gain.setTargetAtTime((v.paused ? 0.6 : 1) * this.volumes.music * 0.55, t, 0.8);
    this.score(t);
  }

  // ------------------------------------------------------------------ music
  private score(t: number): void {
    const m = MODES[this.mood];
    if (t >= this.nextChord) {
      const chord = m.prog[this.chordIdx % m.prog.length];
      this.chordIdx++;
      this.pad(chord.map((n) => ROOT + n), t, 9);
      this.bass(ROOT - 12 + chord[0], t, 9);
      this.padFilter.frequency.setTargetAtTime(m.bright, t, 2);
      this.nextChord = t + 8 + (this.mood === 'dread' ? 4 : 0);
    }
    if (t >= this.nextBeat) {
      const beatLen = 60 / m.tempo;
      this.beat++;
      const chord = m.prog[(this.chordIdx + m.prog.length - 1) % m.prog.length];
      if (Math.random() < m.density * 0.55) {
        const deg = m.scale[Math.floor(Math.random() * m.scale.length)];
        const useChord = Math.random() < 0.6;
        const note = ROOT + 12 + (useChord ? chord[Math.floor(Math.random() * chord.length)] : deg) + (Math.random() < 0.25 ? 12 : 0);
        this.pluck(note, t, this.mood === 'wonder' ? 'bell' : 'pluck');
      }
      if (this.mood === 'war' && (this.beat % 4 === 0 || (this.beat % 8 === 6))) this.drum(t, this.beat % 8 === 0 ? 1 : 0.6);
      if (this.mood === 'wonder' && this.beat % 16 === 0) this.shimmer(t);
      this.nextBeat = t + beatLen * (Math.random() < 0.15 ? 0.5 : 1);
    }
  }

  private pad(notes: number[], t: number, dur: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 3);
    g.gain.setValueAtTime(0.05, t + dur - 1);
    g.gain.linearRampToValueAtTime(0, t + dur + 4);
    g.connect(this.padFilter);
    const oscs: OscillatorNode[] = [];
    for (const n of notes) {
      for (const [type, det, lvl] of [['sawtooth', -7, 0.35], ['triangle', 5, 0.8], ['sine', 0, 0.6]] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(n);
        o.detune.value = det + (Math.random() - 0.5) * 4;
        const og = ctx.createGain();
        og.gain.value = lvl / notes.length;
        o.connect(og);
        og.connect(g);
        o.start(t);
        o.stop(t + dur + 4.5);
        oscs.push(o);
      }
    }
    this.padVoices.push({ osc: oscs, gain: g });
    if (this.padVoices.length > 4) this.padVoices.shift();
  }

  private bass(n: number, t: number, dur: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 2.5);
    g.gain.linearRampToValueAtTime(0, t + dur + 2);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + dur + 2.2);
    void this.drone;
  }

  private pluck(n: number, t: number, kind: 'pluck' | 'bell'): void {
    const ctx = this.ctx!;
    const f = mtof(n);
    const g = ctx.createGain();
    const dur = kind === 'bell' ? 3.5 : 1.6;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(kind === 'bell' ? 0.05 : 0.07, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const o = ctx.createOscillator();
    o.type = kind === 'bell' ? 'sine' : 'triangle';
    o.frequency.value = f;
    if (kind === 'bell') {
      // FM for a glassy bell.
      const mod = ctx.createOscillator();
      mod.frequency.value = f * 3.5;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 1.2, t);
      mg.gain.exponentialRampToValueAtTime(1, t + dur);
      mod.connect(mg);
      mg.connect(o.frequency);
      mod.start(t);
      mod.stop(t + dur);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 0.8;
    o.connect(g);
    g.connect(pan);
    pan.connect(this.music);
    pan.connect(this.delay);
    pan.connect(this.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private shimmer(t: number): void {
    const m = MODES[this.mood];
    for (let i = 0; i < 5; i++) this.pluck(ROOT + 24 + m.scale[(i * 2) % m.scale.length], t + i * 0.12, 'bell');
  }

  private drum(t: number, vel: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.28 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    g.connect(this.music);
    g.connect(this.reverbSend);
    o.start(t);
    o.stop(t + 0.65);
    this.noiseBurst(t, 0.12, 'bandpass', 180, 0.12 * vel, this.music);
  }

  // ------------------------------------------------------------------ ambience events
  private chirp(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const base = 2200 + Math.random() * 2600;
    const n = 1 + Math.floor(Math.random() * 4);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.amb);
    pan.connect(this.reverbSend);
    for (let i = 0; i < n; i++) {
      const s = t + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base, s);
      o.frequency.exponentialRampToValueAtTime(base * (0.6 + Math.random() * 0.8), s + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.03 * level, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0005, s + 0.08);
      o.connect(g);
      g.connect(pan);
      o.start(s);
      o.stop(s + 0.1);
    }
  }

  private cricket(level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 4200 + Math.random() * 400;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    for (let i = 0; i < 3; i++) {
      g.gain.setValueAtTime(0.012 * level, t + i * 0.045);
      g.gain.setValueAtTime(0, t + i * 0.045 + 0.025);
    }
    o.connect(g);
    g.connect(pan);
    pan.connect(this.amb);
    o.start(t);
    o.stop(t + 0.16);
  }

  // ------------------------------------------------------------------ effects
  private spatial(pos: THREE.Vector3 | null, out: AudioNode): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return out;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 40;
    p.rolloffFactor = 0.9;
    p.maxDistance = 20000;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    p.connect(out);
    return p;
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, level: number, out: AudioNode, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t, Math.random() * 3, dur + 0.1);
  }

  private tone(t: number, freq: number, dur: number, level: number, out: AudioNode, type: OscillatorType = 'sine', attack = 0.01, glideTo?: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  thunder(pos: THREE.Vector3, power: number, cameraPos: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const d = pos.distanceTo(cameraPos);
    const t = ctx.currentTime;
    const out = this.spatial(pos, this.sfx);
    const delay = Math.min(4, d * 0.0035);
    // Crack (only when close), then the rolling rumble.
    if (d < 400) this.noiseBurst(t, 0.25, 'highpass', 1500, 0.6 * power, out);
    this.noiseBurst(t + delay, 3.2 + power, 'lowpass', 380, 0.75 * power, out, 90);
    this.noiseBurst(t + delay + 0.3, 2.4, 'lowpass', 160, 0.5 * power, this.reverbSend);
  }

  /** A divine act or disaster at a place. */
  effect(kind: string, pos: THREE.Vector3 | null): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = this.spatial(pos, this.sfx);
    const rev = this.reverbSend;
    switch (kind) {
      case 'meteor-fall': this.noiseBurst(t, 3.5, 'bandpass', 400, 0.35, out, 2400); break;
      case 'meteor':
        this.tone(t, 70, 3.5, 0.9, out, 'sine', 0.005, 22);
        this.noiseBurst(t, 4.5, 'lowpass', 900, 1.0, out, 60);
        this.noiseBurst(t + 0.05, 3, 'lowpass', 300, 0.6, rev);
        this.nudge('dread', 2);
        break;
      case 'earthquake':
        for (let i = 0; i < 6; i++) this.noiseBurst(t + i * 0.45, 1.4, 'lowpass', 120, 0.55, out, 45);
        this.tone(t, 38, 3.5, 0.5, out, 'sine', 0.4);
        this.nudge('dread', 1.2);
        break;
      case 'volcano':
        this.noiseBurst(t, 6, 'lowpass', 500, 0.7, out, 80);
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.9, 55, 1.5, 0.45, out, 'sine', 0.01, 30);
        this.nudge('dread', 1.5);
        break;
      case 'tsunami':
        this.noiseBurst(t, 5, 'lowpass', 700, 0.7, out, 200);
        this.noiseBurst(t + 1.5, 4, 'bandpass', 900, 0.3, out, 300);
        this.nudge('dread', 1.2);
        break;
      case 'rain': case 'mercy':
        [0, 4, 7, 12].forEach((n, i) => this.tone(t + i * 0.18, mtof(ROOT + 24 + n), 2.4, 0.05, rev, 'sine', 0.02));
        this.nudge('wonder', kind === 'mercy' ? 1.5 : 0.4);
        break;
      case 'bloom': case 'sanctuary':
        [0, 2, 4, 7, 9, 12, 14].forEach((n, i) => this.pluck(ROOT + 24 + n, t + i * 0.09, 'bell'));
        this.nudge('wonder', 1);
        break;
      case 'blessing': case 'resurrection': case 'harmony': {
        const chord = kind === 'resurrection' ? [0, 7, 12, 16, 19, 24] : [0, 4, 7, 12, 16];
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 1.5);
        g.gain.linearRampToValueAtTime(0, t + 6);
        const fl = ctx.createBiquadFilter();
        fl.type = 'bandpass';
        fl.frequency.value = 900;
        fl.Q.value = 1.2;
        g.connect(fl);
        fl.connect(out);
        fl.connect(rev);
        for (const n of chord) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(ROOT + 12 + n);
          o.detune.value = (Math.random() - 0.5) * 14;
          const lfo = ctx.createOscillator();
          lfo.frequency.value = 5 + Math.random();
          const lg = ctx.createGain();
          lg.gain.value = 6;
          lfo.connect(lg);
          lg.connect(o.detune);
          o.connect(g);
          o.start(t); o.stop(t + 6.2);
          lfo.start(t); lfo.stop(t + 6.2);
        }
        this.nudge('wonder', 2);
        break;
      }
      case 'plague': case 'locusts':
        [0, 1, 6].forEach((n) => this.tone(t, mtof(ROOT - 12 + n), 4, 0.1, out, 'sawtooth', 1.2));
        if (kind === 'locusts') this.noiseBurst(t, 5, 'bandpass', 3200, 0.2, out);
        this.nudge('dread', 1);
        break;
      case 'drought': case 'wildfire':
        this.noiseBurst(t, 2.5, 'bandpass', 1400, 0.3, out, 500);
        this.nudge('tension', 1);
        break;
      case 'iceage': case 'eclipse':
        [0, 3, 7, 10].forEach((n, i) => this.tone(t + i * 0.4, mtof(ROOT - 12 + n), 7, 0.1, rev, 'triangle', 1.5));
        this.nudge(kind === 'eclipse' ? 'dread' : 'tension', 2);
        break;
      case 'inspiration': case 'prophet': case 'beacon':
        [12, 16, 19, 23, 26].forEach((n, i) => this.pluck(ROOT + 12 + n, t + i * 0.14, 'bell'));
        this.nudge('wonder', 1);
        break;
      case 'war': this.nudge('war', 2); break;
      case 'battle': this.nudge('war', 1); for (let i = 0; i < 3; i++) this.noiseBurst(t + i * 0.2, 0.15, 'bandpass', 2500, 0.08, out); break;
      case 'peace': this.nudge('war', -3); this.nudge('wonder', 1); break;
      case 'age': [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.pluck(ROOT + n, t + i * 0.1, 'bell')); this.nudge('wonder', 2); break;
      case 'extinction': this.tone(t, mtof(ROOT - 5), 6, 0.12, rev, 'triangle', 0.8); this.nudge('dread', 1); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ interface
  uiSound(kind: 'click' | 'hover' | 'open' | 'close' | 'error' | 'select'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const out = this.ui;
    switch (kind) {
      case 'click': this.tone(t, 1300, 0.06, 0.12, out, 'sine', 0.002, 900); break;
      case 'hover': this.tone(t, 2400, 0.03, 0.03, out, 'sine', 0.002); break;
      case 'select': this.tone(t, mtof(ROOT + 31), 0.35, 0.08, out, 'sine', 0.004); this.tone(t + 0.07, mtof(ROOT + 36), 0.45, 0.07, out, 'sine', 0.004); break;
      case 'open': this.noiseBurst(t, 0.3, 'bandpass', 900, 0.1, out, 2600); break;
      case 'close': this.noiseBurst(t, 0.25, 'bandpass', 2400, 0.08, out, 700); break;
      case 'error': this.tone(t, 150, 0.22, 0.12, out, 'square', 0.004); this.tone(t + 0.1, 120, 0.25, 0.1, out, 'square', 0.004); break;
    }
  }
}
