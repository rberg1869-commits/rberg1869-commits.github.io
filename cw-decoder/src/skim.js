// One decoded signal ("channel"): a CWDecoder plus the logic that cuts its text into finished
// transmissions for the QSO engine. The envelope for each channel runs in the audio worklet.
class CWChannel {
  constructor(id, tone, o) {
    this.id = id; this.tone = tone; this.o = o;        // o: { style(), onSegment(ch, text), onChar(ch, c), muted() }
    this.buf = ''; this.text = ''; this.calls = []; this.lastAt = 0; this.born = Date.now();
    this.dec = new CWDecoder({ squelch: o.squelch || 9, onChar: c => this.char(c) });
  }
  char(c) {
    if (this.o.muted && this.o.muted()) return;            // ignore our own signal coming back while we transmit
    if (c === ' ' && (!this.buf || this.buf.endsWith(' '))) return;
    this.buf += c; this.text = (this.text + c).slice(-160); this.lastAt = Date.now();
    if (this.o.onChar) this.o.onChar(this, c);
  }
  frame(v) {
    const d = this.dec;
    d.push(v);
    if (d.state) return;
    if (!this.buf.trim() && !d.pending.length) return;
    const unit = d.unit || 60;
    if (d.sinceMark >= QSO.eotMs(this.o.style(), this.buf, unit)) {
      d.flush();
      const t = this.buf.trim(); this.buf = '';
      if (t && !(this.o.muted && this.o.muted())) this.o.onSegment(this, t);
      if (!this.text.endsWith(' ')) this.text += ' ';
    }
  }
  clear() { this.buf = ''; this.dec.pending = []; }
  get wpm() { return this.dec.wpm; }
  get snr() { return this.dec.markLevel; }
  get idleMs() { return this.dec.state ? 0 : this.dec.sinceMark; }
}

// Picks which tones in the receiver passband deserve a channel, from a dB spectrum.
// spec: Float32Array of dB per FFT bin; binHz: Hz per bin. Returns peaks [{ tone, db }].
function findPeaks(spec, binHz, lo, hi, opts) {
  opts = opts || {};
  const a = Math.ceil(lo / binHz), b = Math.floor(hi / binHz);
  const vals = Array.prototype.slice.call(spec, a, b).filter(isFinite).sort((x, y) => x - y);
  if (!vals.length) return [];
  const med = vals[vals.length >> 1], need = med + (opts.snr || 12), sep = Math.round((opts.sep || 90) / binHz);
  const peaks = [];
  for (let i = a + 1; i < b - 1; i++) {
    const v = spec[i];
    if (v < need || v < spec[i - 1] || v < spec[i + 1]) continue;
    peaks.push({ i, db: v });
  }
  peaks.sort((x, y) => y.db - x.db);
  const out = [];
  for (const p of peaks) {
    if (out.some(q => Math.abs(q.i - p.i) < sep)) continue;
    const y0 = spec[p.i - 1], y1 = spec[p.i], y2 = spec[p.i + 1], den = y0 - 2 * y1 + y2;
    out.push({ i: p.i, tone: (p.i + (den ? 0.5 * (y0 - y2) / den : 0)) * binHz, db: p.db - med });
    if (out.length >= (opts.max || 8)) break;
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { CWChannel, findPeaks };
