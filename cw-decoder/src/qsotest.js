// Text-level simulation: the QSO engine against the practice band, with a simulated clock.
// Optional character errors stand in for imperfect decoding.
const MT = require('./morse.js'), QSO = require('./qso.js'), SIM = require('./sim.js');
let seed = Number(process.argv[3] || 7);
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

async function run(style, mode, minutes, cer) {
  let now = 0; const q = [], logs = [], trace = [];
  const busy = []; const at = (t, fn) => { q.push({ t, fn }); q.sort((a, b) => a.t - b.t); };
  const fmt = t => (t / 1000).toFixed(1).padStart(6);
  const garble = s => cer ? [...s].map(c => (c !== ' ' && rnd() < cer ? 'ETIANMSURWDKGO'[Math.floor(rnd() * 14)] : c)).join('') : s;
  const band = new SIM.Band({ now: () => now, style, my: 'KD9RDU', rnd,
    play: (text, o) => {
      const d = MT.durationMs(text, o.wpm) + 50, eot = QSO.eotMs(style, text, 1200 / o.wpm); busy.push({ tone: o.tone, from: now, to: now + d });
      at(now + d + eot, () => { const g = garble(text); trace.push(`${fmt(now)}  ${o.call.padEnd(7)} ${o.tone}Hz: ${g}`); eng.hear(o.ch, g, { tone: o.tone, wpm: o.wpm, snr: o.snr }); });
      return d;
    } });
  const eng = new QSO.Engine({ my: { call: 'KD9RDU', name: 'BOB', qth: 'IL', zone: 4, wpm: 22, maxWpm: 32 }, style,
    now: () => now, band: () => '20m', canTx: () => true, quietTone: () => { const ts = band.stations.map(s => s.tone).concat([300, 2700]).sort((a, b) => a - b); let best = 1300, gap = 0; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > gap) { gap = ts[i] - ts[i - 1]; best = Math.round((ts[i] + ts[i - 1]) / 2); } return best; },
    toneIdleMs: (tone, w) => { let m = Infinity; for (const b of busy) if (Math.abs(b.tone - tone) <= w && b.from <= now) m = Math.min(m, now < b.to ? 0 : now - b.to); return m; },
    send: (text, o) => new Promise(res => { const d = MT.durationMs(text, o.wpm) + 50; band.usStart(o.tone, d); trace.push(`${fmt(now)}  >> KD9RDU ${o.tone}Hz ${o.wpm}wpm: ${text}`); at(now + d, () => { res(); band.hearUs(text, o.tone); }); }),
    log: x => { logs.push(x); trace.push(`${fmt(now)}  ** LOGGED ${x.call} ${x.rstR} ${x.srx} ${x.name} ${x.qth} ${x.note}`); },
    event: (k, t) => { if (k === 'status') trace.push(`${fmt(now)}     [${t}]`); } });
  eng.setMode(mode);
  while (now < minutes * 60e3) {
    now += 20; band.tick(); eng.tick();
    while (q.length && q[0].t <= now) q.shift().fn();
    await null; await null;
  }
  return { logs, trace };
}
(async () => {
  const which = process.argv[2] || 'all';
  const cases = [['contest', 'answer', 6, 0], ['normal', 'answer', 6, 0], ['contest', 'cq', 4, 0], ['normal', 'cq', 4, 0], ['contest', 'answer', 6, 0.03], ['normal', 'answer', 6, 0.03]];
  for (const [style, mode, min, cer] of cases) {
    const r = await run(style, mode, min, cer);
    console.log(`\n=== ${style} ${mode} ${min} min, char errors ${cer * 100}%: ${r.logs.length} QSOs: ${r.logs.map(l => l.call + (l.srx ? '/' + l.srx : '') + (l.note ? '(' + l.note + ')' : '')).join(' ')}`);
    if (which === 'v' || which === style + mode) console.log(r.trace.slice(0, 120).join('\n'));
  }
})();
