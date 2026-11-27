// Audio-level rehearsal: practice-band stations are rendered as real Morse audio in noise,
// each signal is decoded by the real envelope + decoder, and the QSO engine answers.
const fs = require('fs'), vm = require('vm');
const ctx = { console, Date, Math, setTimeout };
vm.createContext(ctx);
for (const f of ['dsp.js', 'decoder.js', 'morse.js', 'qso.js', 'skim.js', 'sim.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx, { filename: f });
vm.runInContext('this.CWEnvelope=CWEnvelope;this.CWDecoder=CWDecoder;this.MORSE_TX=MORSE_TX;this.QSO=QSO;this.CWChannel=CWChannel;this.SIM=SIM;', ctx);
const { CWEnvelope, MORSE_TX, QSO, CWChannel, SIM } = ctx;

const style = process.argv[2] || 'contest', mode = process.argv[3] || 'answer', minutes = +(process.argv[4] || 5);
let seed = +(process.argv[5] || 11);
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const FS = 12000, STEP = 240;                  // 20 ms steps at 12 kHz keeps the test quick
let sample = 0; const now = () => sample / FS * 1000;
const A = 0.1, NOISE = Math.sqrt((A * A / 2) / Math.pow(10, 15 / 10) / (2500 / (FS / 2)));  // 15 dB SNR in 2.5 kHz for amp A
const active = [], chans = [], logs = [], trace = [];
let txUntil = 0, txText = '';
const fmt = t => (t / 1000).toFixed(1).padStart(6);

function chanFor(tone) {
  let c = chans.find(c => Math.abs(c.tone - tone) <= 22);
  if (c) return c;
  c = new CWChannel(chans.length, tone, { style: () => style, muted: () => now() < txUntil + 250,
    onSegment: (ch, text) => { trace.push(`${fmt(now())}  ch${ch.id} ${Math.round(ch.tone)}Hz ${Math.round(ch.wpm)}wpm: ${text}`); eng.hear(ch.id, text, { tone: ch.tone, wpm: ch.wpm, snr: ch.snr }); } });
  c.env = new CWEnvelope(FS, { tone, bw: 60 });
  chans.push(c); return c;
}
const band = new SIM.Band({ now, style, my: 'KD9RDU', rnd,
  play: (text, o) => {
    const amp = A * Math.pow(10, (o.snr - 15) / 20);
    const x = MORSE_TX.render(text, { wpm: o.wpm, tone: o.tone, rate: FS, level: amp });
    active.push({ x, at: sample }); chanFor(o.tone);
    trace.push(`${fmt(now())}  (${o.call} starts: ${text})`);
    return x.length / FS * 1000;
  } });
const eng = new QSO.Engine({ my: { call: 'KD9RDU', name: 'BOB', qth: 'IL', zone: 4, wpm: 22, maxWpm: 32 }, style, now, band: () => '20m', canTx: () => true,
  quietTone: () => { const ts = band.stations.map(s => s.tone).concat([300, 2700]).sort((a, b) => a - b); let best = 1300, gap = 0; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > gap) { gap = ts[i] - ts[i - 1]; best = Math.round((ts[i] + ts[i - 1]) / 2); } for (const o of [-60, -20, 20, 60]) chanFor(best + o); return best; },
  toneIdleMs: (tone, w) => { let m = Infinity; for (const c of chans) if (Math.abs(c.tone - tone) <= w) m = Math.min(m, c.idleMs); return m; },
  send: (text, o) => new Promise(res => {
    const d = MORSE_TX.durationMs(text, o.wpm) + 60; band.usStart(o.tone, d);
    txUntil = now() + d; txText = text; trace.push(`${fmt(now())}  >> KD9RDU ${Math.round(o.tone)}Hz ${o.wpm}wpm: ${text}`);
    pend.push({ t: now() + d, fn: () => { res(); band.hearUs(text, o.tone); } });
  }),
  log: q => { logs.push(q); trace.push(`${fmt(now())}  ** LOGGED ${q.call} rst ${q.rstR} ${q.srx} ${q.name} ${q.qth} ${q.note}`); },
  event: (k, t) => { if (k === 'status') trace.push(`${fmt(now())}     [${t}]`); } });
const pend = [];
(async () => {
  eng.setMode(mode);
  const buf = new Float32Array(STEP);
  while (now() < minutes * 60e3) {
    for (let i = 0; i < STEP; i++) buf[i] = NOISE * gauss();
    for (let k = active.length - 1; k >= 0; k--) {
      const s = active[k], off = sample - s.at;
      for (let i = 0; i < STEP; i++) { const j = off + i; if (j >= 0 && j < s.x.length) buf[i] += s.x[j]; }
      if (off > s.x.length) active.splice(k, 1);
    }
    for (const c of chans) c.env.process(buf, v => c.frame(v));
    sample += STEP;
    band.tick(); eng.tick();
    for (let k = pend.length - 1; k >= 0; k--) if (pend[k].t <= now()) { const p = pend.splice(k, 1)[0]; p.fn(); }
    await null; await null;
  }
  console.log(`=== audio ${style} ${mode} ${minutes} min seed ${process.argv[5] || 11}: ${logs.length} QSOs: ${logs.map(l => l.call + (l.srx ? '/' + l.srx : '') + (l.name ? ' ' + l.name : '') + (l.note ? ' (' + l.note + ')' : '')).join(', ')}`);
  if (process.argv[6] === 'v') console.log(trace.join('\n'));
})();
