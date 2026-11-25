// CW tone envelope detector.
// Mixes the audio down at the decode tone (quadrature), low-pass filters I and Q
// with a 4th order Butterworth, and emits the average magnitude every hopMs.
// Plain class with no imports so the same text runs in an AudioWorklet,
// in the page itself, and in Node for testing.
class CWEnvelope {
  constructor(sampleRate, opts) {
    opts = opts || {};
    this.fs = sampleRate;
    this.hopMs = opts.hopMs || 5;
    this.hop = Math.max(1, Math.round(this.fs * this.hopMs / 1000));
    this.c = 1; this.s = 0;          // oscillator phasor
    this.acc = 0; this.n = 0; this.k = 0;
    this.setTone(opts.tone || 700);
    this.setBandwidth(opts.bw || 100);
  }
  setTone(hz) {
    this.tone = hz;
    const w = 2 * Math.PI * hz / this.fs;
    this.cd = Math.cos(w); this.sd = Math.sin(w);
  }
  setBandwidth(bw) {
    this.bw = bw;
    const fc = Math.max(10, bw / 2);
    this.f1 = CWEnvelope.lp(fc, this.fs, 0.5412);
    this.f2 = CWEnvelope.lp(fc, this.fs, 1.3066);
    this.z = new Float64Array(8);
  }
  static lp(fc, fs, q) {
    const w = 2 * Math.PI * fc / fs, cw = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
  }
  process(x, emit) {
    const f1 = this.f1, f2 = this.f2, z = this.z, cd = this.cd, sd = this.sd, hop = this.hop;
    let c = this.c, s = this.s, acc = this.acc, n = this.n;
    for (let k = 0; k < x.length; k++) {
      const v = x[k];
      let i = v * c, q = -v * s;
      const nc = c * cd - s * sd; s = s * cd + c * sd; c = nc;
      let y = f1.b0 * i + z[0]; z[0] = f1.b1 * i - f1.a1 * y + z[1]; z[1] = f1.b2 * i - f1.a2 * y; i = y;
      y = f2.b0 * i + z[2]; z[2] = f2.b1 * i - f2.a1 * y + z[3]; z[3] = f2.b2 * i - f2.a2 * y; i = y;
      y = f1.b0 * q + z[4]; z[4] = f1.b1 * q - f1.a1 * y + z[5]; z[5] = f1.b2 * q - f1.a2 * y; q = y;
      y = f2.b0 * q + z[6]; z[6] = f2.b1 * q - f2.a1 * y + z[7]; z[7] = f2.b2 * q - f2.a2 * y; q = y;
      acc += Math.sqrt(i * i + q * q);
      if (++n >= hop) {
        emit(2 * acc / n); acc = 0; n = 0;
        const m = 1 / Math.sqrt(c * c + s * s); c *= m; s *= m;   // keep the phasor on the unit circle
      }
    }
    this.c = c; this.s = s; this.acc = acc; this.n = n;
  }
}
