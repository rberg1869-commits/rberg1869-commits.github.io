// Adaptive Morse decoder. Takes envelope frames (one every frameMs) from CWEnvelope,
// decides key up or key down against a self-adjusting threshold, measures the
// timing, learns the sending speed and spacing, and emits characters as they complete.
const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H',
  '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P',
  '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z', '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
  '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9', '.-.-.-': '.', '--..--': ',',
  '..--..': '?', '-..-.': '/', '-...-': '=', '-....-': '-', '---...': ':', '-.-.-.': ';', '.----.': "'",
  '.-..-.': '"', '-.--.-': ')', '.--.-.': '@', '-.-.--': '!', '..--.-': '_',
  '.-.-.': '<AR>', '...-.-': '<SK>', '-.--.': '<KN>', '.-...': '<AS>', '-.-.-': '<KA>', '...-.': '<SN>',
  '........': '<HH>'
};

function twoMeans(vals) {               // 2-cluster k-means on log values; returns null if one cluster
  const L = vals.map(Math.log);
  let lo = Math.min.apply(null, L), hi = Math.max.apply(null, L), nl = 0, nh = 0;
  if (hi - lo < Math.log(1.6)) return null;
  for (let it = 0; it < 10; it++) {
    const mid = (lo + hi) / 2; let sl = 0, sh = 0; nl = 0; nh = 0;
    for (const x of L) { if (x < mid) { sl += x; nl++; } else { sh += x; nh++; } }
    if (!nl || !nh) return null;
    lo = sl / nl; hi = sh / nh;
  }
  return { lo: Math.exp(lo), hi: Math.exp(hi), nl, nh };
}

class CWDecoder {
  constructor(opts) {
    opts = opts || {};
    this.frameMs = opts.frameMs || 5;
    this.onChar = opts.onChar || function () {};
    this.onKey = opts.onKey || function () {};
    this.squelch = opts.squelch != null ? opts.squelch : 9;  // mark level above the floor needed to print
    this.fixedWpm = opts.fixedWpm || 0;                         // 0 means learn the speed
    this.reset(opts.startWpm || 18);
  }
  reset(wpm) {
    this.dit = this.fixedWpm ? 1200 / this.fixedWpm : 1200 / (wpm || 18);
    this.boundary = 2 * this.dit;
    this.gapUnit = this.dit; this.wordGap = 0; this.showDit = 0;
    this.floor = null; this.peak = null; this.count = 0;
    this.state = false; this.cand = false; this.candRun = 0; this.runMs = 0;
    this.marks = []; this.gaps = []; this.longGaps = [];
    this.elems = []; this.wordPending = false;
    this.markSum = 0; this.markN = 0;
    this.markLevel = 0; this.open = false;
    this.pending = []; this.sinceOpen = 0; this.sinceMark = 1e9; this.openChar = false;
  }
  setFixedWpm(w) {
    this.fixedWpm = w || 0;
    if (w) { this.dit = 1200 / w; this.boundary = 2 * this.dit; this.gapUnit = this.dit; }
  }
  get wpm() { const d = !this.fixedWpm && this.showDit && Math.abs(this.showDit / this.dit - 1) < 0.35 ? this.showDit : this.dit; return 1200 / d; }
  get snr() { return this.open ? Math.max(0, this.markLevel) : 0; }
  get unit() { return 0.5 * (this.dit + this.gapUnit); }

  push(v) {
    const fm = this.frameMs;
    this.count++;
    if (this.count < 10) return;                              // let the filters settle
    const db = Math.max(-160, 20 * Math.log10(v + 1e-12));
    if (this.count < 40) { this.initSum = (this.initSum || 0) + db; return; }
    if (this.floor == null) { this.floor = this.initSum / 30 - 3; this.peak = this.floor; }
    // Noise floor: running 20th percentile of the level, in dB.
    // Learn the floor from key-up time only (skipping the filter's decay tail), or from a long carrier.
    if (db > this.floor) this.floor += 0.03; else this.floor -= 0.12;   // running 20th percentile
    // Signal peak: fast attack, follows fading while keyed, sinks to the floor when idle.
    if (db > this.peak) this.peak += (db - this.peak) * 0.3;
    else if (this.state) this.peak += (db - this.peak) * 0.08;
    else this.peak -= (this.peak - this.floor) * 0.002;
    if (this.peak < this.floor) this.peak = this.floor;

    const S = this.peak - this.floor;
    const ref = Math.max(this.markLevel, S - 4);          // typical keyed level above the floor
    const thr = this.floor + Math.max(4, (5.5 + ref) / 2, ref - 6);
    const hyst = Math.min(2, 0.1 * S);
    const want = this.state ? db > thr - hyst : db > thr;
    this.lastDb = db; this.lastThr = thr;               // for the keying display

    const minRun = Math.min(40, Math.max(2 * fm, 0.25 * this.dit));
    if (want !== this.state) {
      if (want === this.cand) this.candRun += fm; else { this.cand = want; this.candRun = fm; }
      if (this.candRun >= minRun) {
        const prior = this.runMs - this.candRun + fm;
        if (this.state) this.endMark(prior); else this.endGap(prior);
        this.state = want; this.runMs = this.candRun; this.candRun = 0;
        if (this.state) { this.markSum = 0; this.markN = 0; }
        this.onKey(this.state && this.open);
        return;
      }
    } else { this.cand = this.state; this.candRun = 0; }
    this.runMs += fm;
    this.sinceMark = this.state ? 0 : this.sinceMark + fm;
    if (this.state) { this.markSum += db - this.floor; this.markN++; }
    else this.idle(this.runMs);
  }

  endMark(ms) {
    const lvl = this.markN ? this.markSum / this.markN : 0;
    this.markLevel = 0.6 * this.markLevel + 0.4 * lvl;
    const wasOpen = this.open;
    if (!this.open && this.markLevel > this.squelch) this.open = true;
    else if (this.open && this.markLevel < this.squelch - 2) this.open = false;
    if (this.open && !wasOpen) { if (this.marks.length > 6) this.marks = this.marks.slice(-6); this.sinceOpen = 0; this.openChar = true; }
    if (this.open) this.sinceOpen++;
    if (ms > Math.max(10 * this.dit, 600)) { this.elems = []; return; }   // a carrier or tune-up
    this.elems.push({ ms: ms, lvl: lvl });
    if (this.open) {
      this.marks.push(ms); if (this.marks.length > 24) this.marks.shift(); this.learn();
      if (this.sinceOpen >= 10 && this.pending.length) this.flush();
    }
  }

  endGap(ms) {
    if (!this.open) return;
    const u = this.unit;
    if (ms < 2 * u) { this.gaps.push(ms); if (this.gaps.length > 24) this.gaps.shift(); }
    else if (ms < 40 * u) { this.longGaps.push(ms); if (this.longGaps.length > 30) this.longGaps.shift(); this.learnSpacing(); }
  }

  idle(ms) {
    const u = this.unit;
    if (this.elems.length && ms > 2 * u) { this.emit(); }
    const wg = this.wordGap || 5 * u;
    if (this.wordPending && ms > wg) { this.out(' '); this.wordPending = false; }
    if (ms > 2000) this.flush();
    if (ms > 3000 && this.open) { this.open = false; this.markLevel = Math.min(this.markLevel, this.squelch - 2); }
  }

  decodeElems(el) {
    const b = this.boundary;
    const code = el.map(d => (d.ms < b ? '.' : '-')).join('');
    return code.length > 8 ? '*' : (MORSE[code] || '*');
  }

  emit() {
    let el = this.elems; this.elems = [];
    if (!this.open) return;
    if (this.openChar) {                       // drop noise blips caught just before the signal began
      const keep = 0.6 * Math.max.apply(null, el.map(e => e.lvl));
      el = el.filter(e => e.lvl >= keep);
      this.openChar = false;
      if (!el.length) return;
    }
    this.wordPending = true;
    if (this.sinceOpen < 10 && !this.fixedWpm) { this.pending.push(el); return; }   // speed not settled yet
    this.flush();
    this.onChar(this.decodeElems(el));
  }

  out(c) { if (this.pending.length) this.pending.push(c); else this.onChar(c); }

  flush() {
    if (!this.pending.length) return;
    const p = this.pending; this.pending = [];
    for (const t of p) this.onChar(typeof t === 'string' ? t : this.decodeElems(t));
  }

  learn() {
    if (this.fixedWpm) return;
    let m = this.marks;
    const w = m.length < 10 ? 0.8 : 0.4;
    let c = m.length >= 3 ? twoMeans(m) : null;
    if (c && m.length >= 8 && Math.min(c.nl, c.nh) <= Math.max(1, Math.floor(0.12 * m.length))) {
      // one or two stray marks (a click, a noise blip, a burst of QRN) must not drag the speed estimate
      const cut = Math.sqrt(c.lo * c.hi), dropLo = c.nl < c.nh;
      m = m.filter(x => (dropLo ? x >= cut : x < cut));
      c = twoMeans(m);
    }
    if (c && c.hi / c.lo > 1.8 && c.hi / c.lo < 5) {
      const est = (c.nl * c.lo + c.nh * c.hi / 3) / (c.nl + c.nh);
      this.dit = (1 - w) * this.dit + w * est;
      this.boundary = Math.sqrt(c.lo * c.hi);
      // For the speed readout: a dah is exactly two units longer than a dit, and that difference
      // cancels the few milliseconds every keyed element gains from the receive filter.
      const u2 = (c.hi - c.lo) / 2;
      if (c.nl >= 2 && c.nh >= 2 && u2 > 0.6 * est && u2 < 1.4 * est) this.showDit = this.showDit ? 0.7 * this.showDit + 0.3 * u2 : u2;
    } else if (m.length) {
      const recent = m.slice(-4);
      const mean = Math.exp(recent.map(Math.log).reduce((a, b) => a + b, 0) / recent.length);
      const isDash = mean > 2 * this.dit;
      this.dit = 0.75 * this.dit + 0.25 * (isDash ? mean / 3 : mean);
      this.boundary = 2 * this.dit;
    }
    this.dit = Math.min(240, Math.max(20, this.dit));
    if (this.boundary < 1.5 * this.dit || this.boundary > 3.2 * this.dit) this.boundary = 2 * this.dit;
    if (this.gaps.length >= 3) {
      const g = this.gaps.slice().sort((a, b) => a - b);
      this.gapUnit = Math.min(1.5 * this.dit, Math.max(0.6 * this.dit, g[g.length >> 1]));
    }
  }

  learnSpacing() {
    let g = this.longGaps;
    const u = this.unit;
    if (g.length < 3) { this.wordGap = 0; return; }
    let c = twoMeans(g);
    const few = Math.max(2, 0.12 * g.length);
    if (c && (c.nl < few || c.nh < few) && g.length >= 8) {          // drop a handful of stray gaps and retry
      const cut = Math.sqrt(c.lo * c.hi);
      g = g.filter(x => (c.nl < few ? x >= cut : x < cut));
      c = twoMeans(g);
      if (c && (c.nl < 2 || c.nh < 2)) c = null;
    }
    if (c && c.hi / c.lo > 1.7) this.wordGap = Math.max(4 * u, Math.sqrt(c.lo * c.hi));
    else {
      const s = g.slice().sort((a, b) => a - b), med = s[s.length >> 1];
      this.wordGap = med > 6 * u ? 1.6 * med : 5 * u;   // all character gaps (Farnsworth) or all normal
    }
  }
}
