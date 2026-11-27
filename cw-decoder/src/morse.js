// Morse sender: turns text into keyed-tone audio with clean, click-free edges.
// The radio sits in USB, so a tone at the same audio pitch as the other station puts our
// signal exactly on their frequency (a J2A emission, which Part 97 counts as CW).
const MORSE_TX = (function () {
  const T = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
    0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-', '-': '-....-', '+': '.-.-.',
    '<AR>': '.-.-.', '<SK>': '...-.-', '<KN>': '-.--.', '<BT>': '-...-', '<AS>': '.-...'
  };
  // Split text into tokens: prosigns in angle brackets stay whole.
  function tokens(word) { return word.toUpperCase().match(/<[A-Z]+>|[A-Z0-9.,?\/=+\-]/g) || []; }

  // Returns [[on, units], ...] for the text, standard 1:3:7 spacing.
  function units(text) {
    const out = [];
    const words = String(text).trim().split(/\s+/).filter(Boolean);
    words.forEach((w, wi) => {
      const tk = tokens(w).filter(t => T[t]);
      tk.forEach((t, ti) => {
        const code = T[t];
        for (let i = 0; i < code.length; i++) {
          out.push([1, code[i] === '.' ? 1 : 3]);
          if (i < code.length - 1) out.push([0, 1]);
        }
        if (ti < tk.length - 1) out.push([0, 3]);
      });
      if (wi < words.length - 1) out.push([0, 7]);
    });
    return out;
  }

  function durationMs(text, wpm) { return units(text).reduce((a, s) => a + s[1], 0) * 1200 / wpm; }

  // Render keyed tone into a Float32Array.
  // opts: { wpm, tone, rate, level, rise (ms), lead (ms of extra first element),
  //         maxGap (ms): longest silence allowed between words, so radio VOX never drops out mid-message;
  //                      never shorter than 5 units, so words stay apart }
  function render(text, opts) {
    const rate = opts.rate || 48000, wpm = opts.wpm || 20, tone = opts.tone || 700;
    const level = opts.level != null ? opts.level : 0.5, riseMs = opts.rise || 5;
    const u = 1200 / wpm / 1000, segs = units(text);
    const gapCap = opts.maxGap ? Math.max(5 * u, opts.maxGap / 1000) : Infinity;
    const secs = segs.map(([on, len]) => (!on && len === 7) ? Math.min(len * u, gapCap) : len * u);
    const pre = 0.02, post = 0.03;                                     // a little silence either side
    const total = pre + post + secs.reduce((a, s) => a + s, 0) + (opts.lead || 0) / 1000;
    const n = Math.ceil(total * rate), x = new Float32Array(n);
    const w = 2 * Math.PI * tone / rate, rise = Math.max(1, Math.round(riseMs / 1000 * rate));
    let i = Math.round(pre * rate), first = true;
    for (let si = 0; si < segs.length; si++) {
      const on = segs[si][0];
      let m = Math.round(secs[si] * rate);
      if (on && first && opts.lead) { m += Math.round(opts.lead / 1000 * rate); }
      if (on) {
        first = false;
        for (let k = 0; k < m && i < n; k++, i++) {
          // raised-cosine edges keep the signal narrow (no key clicks)
          let e = 1;
          if (k < rise) e = 0.5 - 0.5 * Math.cos(Math.PI * k / rise);
          else if (k > m - rise) e = 0.5 - 0.5 * Math.cos(Math.PI * (m - k) / rise);
          x[i] = level * e * Math.sin(w * i);
        }
      } else i += m;
    }
    return x;
  }
  return { units, durationMs, render, table: T };
})();
if (typeof module !== 'undefined') module.exports = MORSE_TX;
