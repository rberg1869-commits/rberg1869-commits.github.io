// Test harness: synthesize CW audio, run it through CWEnvelope + CWDecoder, score the text.
const fs = require('fs');
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/dsp.js', 'utf8') + '\n' + fs.readFileSync(__dirname + '/decoder.js', 'utf8') + '\nthis.CWEnvelope=CWEnvelope;this.CWDecoder=CWDecoder;this.MORSE=MORSE;', ctx);
const { CWEnvelope, CWDecoder, MORSE } = ctx;
const TO = {}; for (const k in MORSE) TO[MORSE[k]] = k;

let seed = 12345;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function gauss() { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Build a list of [on/off, ms] segments.
function keying(text, p) {
  const u = 1200 / p.wpm;
  const fu = p.fwpm ? (60 / p.fwpm - 37.2 / p.wpm) * 1000 / 19 : u; // Farnsworth spacing unit
  const j = () => 1 + (p.jitter || 0) * gauss();
  const segs = [[0, 600]];
  const words = text.split(' ');
  words.forEach((w, wi) => {
    const toks = w.match(/<[A-Z]+>|./g) || [];
    toks.forEach((ch, ci) => {
      const code = TO[ch];
      [...code].forEach((e, ei) => {
        segs.push([1, (e === '.' ? u : u * (p.dah || 3)) * j()]);
        if (ei < code.length - 1) segs.push([0, u * j()]);
      });
      if (ci < toks.length - 1) segs.push([0, 3 * fu * j()]);
    });
    if (wi < words.length - 1) segs.push([0, 7 * fu * j()]);
  });
  segs.push([0, 1500]);
  return segs;
}

function synth(text, p) {
  const fs = 48000, segs = keying(text, p);
  const total = segs.reduce((a, s) => a + s[1], 0);
  const N = Math.ceil(total / 1000 * fs);
  const x = new Float32Array(N);
  const A = 0.1;
  const sigma = Math.sqrt((A * A / 2) / Math.pow(10, p.snr / 10) / (2500 / (fs / 2)));
  const rise = 0.005 * fs;
  let idx = 0, ph = rnd() * 6.28;
  const w = 2 * Math.PI * p.tone / fs;
  let env = 0;
  for (const [on, ms] of segs) {
    const n = Math.round(ms / 1000 * fs);
    for (let k = 0; k < n && idx < N; k++, idx++) {
      env += on ? 1 / rise : -1 / rise; env = Math.max(0, Math.min(1, env));
      const sh = 0.5 - 0.5 * Math.cos(Math.PI * env);
      const fade = p.qsb ? 1 - p.qsb * (0.5 + 0.5 * Math.sin(2 * Math.PI * idx / fs / (p.qsbT || 4))) : 1;
      let v = A * fade * sh * Math.sin(ph) + sigma * gauss();
      if (p.qrm) v += A * 0.7 * Math.sin(2 * Math.PI * (p.tone + p.qrm) * idx / fs);
      x[idx] = v; ph += w;
    }
  }
  return x;
}

function decode(x, p) {
  let out = '';
  const env = new CWEnvelope(48000, { tone: p.decTone || p.tone, bw: p.bw || 60 });
  const dec = new CWDecoder({ squelch: p.squelch, variant: p.variant, onChar: c => { out += c; } });
  for (let i = 0; i < x.length; i += 128) env.process(x.subarray(i, i + 128), v => dec.push(v));
  return { out, wpm: dec.wpm, snr: dec.snr };
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const norm = s => s.replace(/\s+/g, ' ').trim();

const TEXT = 'CQ CQ CQ DE KD9RDU KD9RDU K KD9RDU DE N0CALL GM OM TNX FER CALL UR RST 579 579 = NAME ED ED QTH OHIO = HW? KD9RDU DE N0CALL <KN>';

module.exports = { synth, decode, lev, norm, TEXT, keying };

if (require.main === module) {
  const cases = [];
  for (const wpm of [12, 18, 25, 32, 40]) for (const snr of [20, 5, 0, -3, -6]) cases.push({ wpm, snr, tone: 700 });
  cases.push({ wpm: 20, snr: 5, tone: 700, jitter: 0.12, name: 'hand sent' });
  cases.push({ wpm: 15, snr: 5, tone: 700, jitter: 0.2, dah: 2.6, name: 'sloppy fist' });
  cases.push({ wpm: 18, fwpm: 10, snr: 5, tone: 700, name: 'farnsworth 18/10' });
  cases.push({ wpm: 22, snr: 5, tone: 700, qsb: 0.8, name: 'QSB deep 4 s' });
  cases.push({ wpm: 22, snr: 10, tone: 700, qsb: 0.6, qsbT: 10, name: 'QSB 8 dB 10 s' });
  cases.push({ wpm: 22, snr: 5, tone: 715, decTone: 700, name: 'tone off 15 Hz' });
  cases.push({ wpm: 22, snr: 5, tone: 700, qrm: 250, name: 'QRM 250 Hz away' });
  cases.push({ wpm: 22, snr: 5, tone: 700, qrm: 120, name: 'QRM 120 Hz away' });
  let tot = 0, err = 0;
  const variant = process.argv[2] ? JSON.parse(process.argv[2]) : undefined;
  for (const c of cases) {
    c.variant = variant;
    seed = 777;
    const x = synth(TEXT, c);
    const r = decode(x, c);
    const e = lev(norm(r.out), norm(TEXT));
    tot += TEXT.length; err += e;
    console.log(`${(c.name || '').padEnd(18)} wpm ${String(c.wpm).padStart(2)} snr ${String(c.snr).padStart(3)}  CER ${(100 * e / TEXT.length).toFixed(1).padStart(5)}%  est ${r.wpm.toFixed(1)} wpm  | ${norm(r.out).slice(0, 90)}`);
  }
  // Pure noise: nothing should come out.
  seed = 99;
  const fsr = 48000, noise = new Float32Array(fsr * 30);
  for (let i = 0; i < noise.length; i++) noise[i] = 0.05 * gauss();
  const rn = decode(noise, { tone: 700 });
  console.log(`noise only 30 s -> ${JSON.stringify(rn.out)} (snr ${rn.snr.toFixed(1)})`);
  console.log(`overall CER ${(100 * err / tot).toFixed(2)}%`);
}
