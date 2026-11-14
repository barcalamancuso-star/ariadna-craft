class VoxelAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  unlock() {
    if (this.muted) return;
    if (!this.ctx && typeof window !== "undefined") {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  tone(freq, duration, type = "triangle", gainVal = 0.08, slideTo = null) {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    }
    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  playPlace() {
    this.tone(240, 0.07, "square", 0.05, 360);
  }

  playBreak() {
    this.tone(170, 0.09, "sawtooth", 0.06, 75);
  }

  playAiBuild() {
    this.tone(420, 0.12, "sine", 0.06, 680);
    setTimeout(() => this.tone(640, 0.16, "triangle", 0.05, 920), 90);
  }
}

export const soundFX = new VoxelAudio();
