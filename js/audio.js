/**
 * Tiny WebAudio sound effects.
 *
 * The AudioContext is created lazily on the first user gesture (browsers block
 * it otherwise) and every call is guarded, so a blocked or unsupported audio
 * stack silently disables sound instead of throwing.
 */

export class AudioEngine {
  constructor({ muted = false } = {}) {
    this.muted = Boolean(muted);
    this.ctx = null;
    this.master = null;
    this.unsupported = false;
  }

  /** Call from a real user gesture (click, keydown, touch). Safe to call often. */
  unlock() {
    if (this.ctx || this.unsupported) {
      this.resume();
      return Boolean(this.ctx);
    }

    try {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) {
        this.unsupported = true;
        return false;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.18;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      this.unsupported = true;
      this.ctx = null;
      this.master = null;
      return false;
    }
  }

  resume() {
    try {
      if (this.ctx && this.ctx.state === 'suspended') {
        const result = this.ctx.resume();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    } catch {
      /* ignore: audio is a nice-to-have */
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  /**
   * One short enveloped oscillator. Everything is wrapped because node
   * creation can throw once a context has been closed by the browser.
   */
  tone({ freq = 440, endFreq = null, duration = 0.12, type = 'square', gain = 1, delay = 0 } = {}) {
    if (this.muted || this.unsupported || !this.ctx || !this.master) return;

    try {
      const ctx = this.ctx;
      if (ctx.state === 'closed') return;

      const start = ctx.currentTime + Math.max(0, delay);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), start);
      if (endFreq && endFreq > 20) {
        osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
      }

      const peak = Math.max(0.0001, gain);
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(peak, start + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(env);
      env.connect(this.master);
      osc.start(start);
      osc.stop(start + duration + 0.02);

      osc.onended = () => {
        try {
          osc.disconnect();
          env.disconnect();
        } catch {
          /* already torn down */
        }
      };
    } catch {
      /* ignore */
    }
  }

  eat() {
    this.tone({ freq: 620, endFreq: 980, duration: 0.09, type: 'square', gain: 0.9 });
  }

  bonus() {
    this.tone({ freq: 740, duration: 0.08, type: 'triangle', gain: 1 });
    this.tone({ freq: 988, duration: 0.08, type: 'triangle', gain: 1, delay: 0.07 });
    this.tone({ freq: 1319, duration: 0.14, type: 'triangle', gain: 0.9, delay: 0.14 });
  }

  level() {
    this.tone({ freq: 523, duration: 0.1, type: 'sine', gain: 0.8 });
    this.tone({ freq: 784, duration: 0.14, type: 'sine', gain: 0.7, delay: 0.09 });
  }

  start() {
    this.tone({ freq: 392, duration: 0.09, type: 'triangle', gain: 0.8 });
    this.tone({ freq: 587, duration: 0.12, type: 'triangle', gain: 0.8, delay: 0.08 });
  }

  die() {
    this.tone({ freq: 330, endFreq: 70, duration: 0.5, type: 'sawtooth', gain: 0.8 });
  }

  win() {
    [523, 659, 784, 1047].forEach((freq, i) => {
      this.tone({ freq, duration: 0.16, type: 'triangle', gain: 0.8, delay: i * 0.11 });
    });
  }

  /** Releases the audio hardware. Called when the page goes away. */
  dispose() {
    try {
      if (this.ctx && typeof this.ctx.close === 'function' && this.ctx.state !== 'closed') {
        const result = this.ctx.close();
        if (result && typeof result.catch === 'function') result.catch(() => {});
      }
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }
}
