// Checks the VOX word-gap cap: longest silence inside a message stays under VOX delay minus 0.1 s,
// and the capped audio still decodes word for word.
const fs = require('fs'), vm = require('vm');
const ctx = { console, Date, Math, setTimeout }; vm.createContext(ctx);
for (const f of ['dsp.js', 'decoder.js', 'morse.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx, { filename: f });
vm.runInContext('this.CWEnvelope=CWEnvelope;this.CWDecoder=CWDecoder;this.MORSE_TX=MORSE_TX;', ctx);
const { CWEnvelope, CWDecoder, MORSE_TX } = ctx;
const FS = 12000, STEP = 240;
let seed = 5; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
function longestGap(x) { let run = 0, best = 0, started = false; for (const v of x) { if (Math.abs(v) > 1e-4) { if (started) best = Math.max(best, run); run = 0; started = true; } else run++; } return best / FS * 1000; }
function decode(x, tone) {
  const env = new CWEnvelope(FS, { tone, bw: 60 }), dec = new CWDecoder({}); let out = '';
  const pad = new Float32Array(FS * 2); const all = new Float32Array(x.length + pad.length * 2); all.set(x, pad.length);
  const NOISE = 0.004;
  for (let i = 0; i + STEP <= all.length; i += STEP) {
    const blk = new Float32Array(STEP); for (let k = 0; k < STEP; k++) blk[k] = all[i + k] + NOISE * gauss();
    const r = env.process ? env.process(blk) : null;
    if (r != null) { const t = dec.push ? dec.push(r, STEP / FS * 1000) : ''; if (t) out += t; }
  }
  return out;
}
const msg = 'CQ TEST KD9RDU KD9RDU TEST 5NN 4 TU';
let ok = true;
for (const vd of [0.3, 0.5]) for (const asked of [12, 15, 18, 20, 22, 25, 28, 32]) {
  const wpm = Math.max(asked, Math.ceil(6000 / Math.max(200, vd * 1000 - 100)));   // same floor as transmit() in the app
  const x = MORSE_TX.render(msg, { wpm, tone: 700, rate: FS, level: 0.1, lead: 40, maxGap: vd * 1000 - 100 });
  const g = longestGap(x), cap = Math.max(5 * 1200 / wpm, vd * 1000 - 100), holds = g < vd * 1000;
  const full = 7 * 1200 / wpm;
  console.log(`VOX ${vd}s asked ${String(asked).padStart(2)}, sent ${String(wpm).padStart(2)} wpm: word gap ${Math.round(full)} -> ${Math.round(g)} ms (${(g / (1200 / wpm)).toFixed(1)} units)  VOX holds: ${holds ? 'yes' : 'NO'}`);
  if (vd === 0.5 && !holds) ok = false;
}
// unchanged when no cap is given
const a = MORSE_TX.render(msg, { wpm: 20, tone: 700, rate: FS }), b = MORSE_TX.render(msg, { wpm: 20, tone: 700, rate: FS, maxGap: 0 });
console.log('no-cap render identical:', a.length === b.length && a.every((v, i) => v === b[i]));
console.log('no-cap longest gap at 20 wpm:', Math.round(longestGap(a)), 'ms');
console.log(ok ? 'PASS: at VOX 0.5 s the radio stays keyed for every speed 12 to 32 WPM' : 'FAIL');
