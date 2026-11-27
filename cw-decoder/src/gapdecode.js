// Does capped word spacing still copy word for word? Uses the app's own decoder as a stand-in for the other station.
const fs = require('fs'), vm = require('vm');
const ctx = { console, Date, Math, setTimeout }; vm.createContext(ctx);
for (const f of ['dsp.js', 'decoder.js', 'morse.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx, { filename: f });
vm.runInContext('this.CWEnvelope=CWEnvelope;this.CWDecoder=CWDecoder;this.MORSE_TX=MORSE_TX;', ctx);
const { CWEnvelope, CWDecoder, MORSE_TX } = ctx;
let seed = 9; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const TEXT = 'CQ CQ DE KD9RDU KD9RDU K N0CALL DE KD9RDU UR RST 599 599 NAME BOB BOB QTH IL IL HW? N0CALL DE KD9RDU KN';
const norm = s => s.replace(/\s+/g, ' ').trim();
let bad = 0;
for (const [label, cap] of [['standard 7-unit spacing', 0], ['VOX 0.5 s cap', 400]]) for (const wpm of [12, 15, 18, 20, 22, 25]) {
  const sw = cap ? Math.max(wpm, Math.ceil(6000 / (cap))) : wpm;
  const x = MORSE_TX.render(TEXT, { wpm: sw, tone: 700, rate: 48000, level: 0.1, maxGap: cap });
  const y = new Float32Array(x.length + 96000); y.set(x, 48000);
  for (let i = 0; i < y.length; i++) y[i] += 0.01 * gauss();
  let out = ''; const env = new CWEnvelope(48000, { tone: 700, bw: 60 }), dec = new CWDecoder({ onChar: c => { out += c; } });
  for (let i = 0; i < y.length; i += 128) env.process(y.subarray(i, i + 128), v => dec.push(v));
  if (dec.flush) dec.flush();
  const strip = t => norm(t).split(' ').slice(1).join(' '); const got = norm(out), same = strip(got) === strip(TEXT);
  if (cap && !same) bad++;
  console.log(`${label.padEnd(24)} ${String(wpm).padStart(2)} wpm asked, sent ${String(sw).padStart(2)}: ${same ? 'exact' : 'DIFF: ' + got}`);
}
console.log(bad ? `FAIL (${bad})` : 'PASS: capped spacing copies word for word');
