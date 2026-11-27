// Automatic CW QSO engine. Pure logic: it reads what each signal sent (one finished
// transmission at a time), decides what to send back, and logs completed contacts.
// The page supplies send(), log(), canTx() and the clock; Node tests drive it the same way.
const QSO = (function () {
  const CALL_RE = /^(?:[A-Z0-9]{1,4}\/)?(?:[A-Z]{1,2}|[0-9][A-Z]{1,2}|[A-Z][0-9][A-Z]?)[0-9][A-Z0-9]{0,3}[A-Z](?:\/[A-Z0-9]{1,4})?$/;
  const NOT_CALLS = new Set(['5NN', '599', 'TU', 'TNX', 'CQ', 'TEST', 'QRZ', 'DE', 'AGN']);
  const CUT = { T: '0', O: '0', A: '1', U: '2', V: '3', E: '5', B: '7', D: '8', N: '9' };
  const ENDERS = new Set(['K', 'KN', 'BK', 'SK', 'AR', 'KKN']);
  const STOP = new Set(['HW', 'HW?', 'RIG', 'WX', 'ANT', 'PWR', 'K', 'KN', 'BK', 'SK', 'AR', '=', 'NAME', 'OP', 'RST', 'UR', 'TNX', 'DE', 'BTU', 'SO', 'ES']);

  function isCall(t) { return t.length >= 3 && t.length <= 12 && !NOT_CALLS.has(t) && CALL_RE.test(t); }
  function cut(s) { return s.replace(/[TOAUVEBDN]/g, c => CUT[c]); }
  function lev(a, b) {
    const d = []; for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] || a[i - 1] === '*' || b[j - 1] === '*' ? 0 : 1));
    return d[a.length][b.length];
  }
  function norm(text) {
    return String(text).toUpperCase().replace(/<KN>/g, ' KN ').replace(/<SK>/g, ' SK ').replace(/<AR>/g, ' AR ')
      .replace(/<BT>|=/g, ' = ').replace(/<[A-Z]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function rstDigits(t) { return t.length === 3 ? t[0] + cut(t.slice(1)) : t; }

  // What did they send? (tokens, calls, my call, queries, exchange, name, QTH...)
  function analyze(text, my, target) {
    const s = norm(text), tk = s ? s.split(' ') : [];
    const r = { text: s, tk };
    const counts = {};
    tk.forEach(t => { if (isCall(t)) counts[t] = (counts[t] || 0) + 1; });
    r.calls = Object.keys(counts).filter(c => c !== my); r.counts = counts;
    r.isCQ = tk.includes('CQ') || tk.includes('TEST') || tk.includes('QRZ') || tk.includes('QRZ?');
    r.myExact = tk.includes(my);
    r.myFuzzy = !r.myExact && tk.some(t => { const p = t.replace(/\?/g, ''); return p.length >= 4 && p !== target && p !== my && lev(p, my) <= 1; });
    r.partial = tk.some(t => {
      if (!t.includes('?')) return false;
      const p = t.replace(/\?/g, '');
      return p.length >= 2 && p !== my && (my.startsWith(p) || my.endsWith(p) || my.includes(p));
    });
    r.query = tk.some(t => ['?', 'AGN', 'AGN?', 'NR?', 'RPT', 'PSE?', 'NR', 'ZONE?', 'CL?', 'CALL?'].includes(t)) || /^\?+$/.test(s);
    r.other = r.calls.filter(c => c !== target && lev(c, my) > 1);
    r.tu = tk.some(t => ['TU', 'TNX', 'QSL', 'R', 'RR', 'EE', '73', 'GL', 'FB'].includes(t));
    r.ended = tk.length > 0 && ENDERS.has(tk[tk.length - 1]);
    r.signoff = tk.includes('SK') || tk.includes('73') || (tk.includes('EE') && tk.length < 6);
    // RST and the token after it (contest zone)
    const ri = tk.findIndex(t => /^[1-5][1-9NT][1-9NT]$/.test(t));
    if (ri >= 0) {
      r.rst = rstDigits(tk[ri]);
      const z = tk[ri + 1];
      if (z && /^[0-9TOAUVEBDN]{1,2}$/.test(z)) { const n = parseInt(cut(z), 10); if (n >= 1 && n <= 40) r.zone = n; }
    }
    if (!r.zone && r.myExact) {                      // "KD9RDU 14" with RST lost
      const mi = tk.indexOf(my), z = tk[mi + 1];
      if (z && /^[0-9TOAUVEBDN]{1,2}$/.test(z) && /[0-9]/.test(z)) { const n = parseInt(cut(z), 10); if (n >= 1 && n <= 40) r.zone = n; }
    }
    const pick = (keys, max) => {
      for (const k of keys) {
        let i = tk.indexOf(k); if (i < 0) continue; i++;
        while (tk[i] === 'IS' || tk[i] === 'HR' || tk[i] === 'NR' || tk[i] === 'HERE') i++;
        const out = [];
        while (i < tk.length && out.length < max && !STOP.has(tk[i]) && !isCall(tk[i]) && /^[A-Z][A-Z0-9.\/-]*$/.test(tk[i])) { if (out[out.length - 1] !== tk[i]) out.push(tk[i]); i++; }
        if (out.length) return out.join(' ');
      }
      return '';
    };
    r.name = pick(['NAME', 'OP'], 1);
    r.qth = pick(['QTH'], 3);
    return r;
  }

  // How long a signal must stay silent before its transmission counts as finished.
  function eotMs(style, text, unitMs) {
    const u = unitMs || 60;
    if (style === 'contest') return Math.max(450, 10 * u);
    const tk = norm(text).split(' ');
    return ENDERS.has(tk[tk.length - 1]) ? Math.max(600, 10 * u) : 2500;
  }

  class Engine {
    constructor(o) {
      this.o = o;
      this.my = o.my;                    // { call, name, qth, zone, wpm, maxWpm }
      this.style = o.style || 'contest'; // 'contest' | 'normal'
      this.mode = 'off';                 // 'off' | 'answer' | 'cq'
      this.maxTries = o.maxTries || 3;
      this.needTwice = o.needTwice !== false;
      this.askFirst = !!o.askFirst;
      this.heard = new Map();            // call -> { n, last }
      this.tries = new Map();            // call -> { n, last }
      this.skipUntil = new Map();        // call -> time
      this.worked = new Set();           // band|call
      this.dryAt = new Map();
      this.reset();
    }
    now() { return this.o.now(); }
    ev(kind, text, extra) { if (this.o.event) this.o.event(kind, text, extra || {}); }
    status(s) { this.statusText = s; this.ev('status', s); }
    reset() { this.state = 'idle'; this.t = null; this.txBusy = false; this.listenAt = 0; this.proposal = null; this.cqTone = 0; this.qrlDone = false; this.nextCqAt = 0; }
    setMode(m) {
      this.mode = m; this.reset();
      this.status(m === 'off' ? 'Auto is off' : m === 'answer' ? 'Listening for stations calling CQ' : 'Ready to call CQ');
    }
    stop() { this.setMode('off'); }
    markWorked(band, call) { this.worked.add(band + '|' + call); }
    isDupe(call) { return this.worked.has(this.o.band() + '|' + call); }

    wpmFor(info) {
      const max = this.my.maxWpm || 32;
      if (this.mode === 'cq') return Math.min(max, this.my.wpm || 20);
      return Math.max(12, Math.min(max, Math.round((info && info.wpm) || this.my.wpm || 20)));
    }

    async tx(text, info, ch) {
      if (!this.o.canTx()) return false;
      this.txBusy = true;
      this.ev('tx', text, { tone: info.tone, wpm: this.wpmFor(info), ch });
      try { await this.o.send(text, { tone: info.tone, wpm: this.wpmFor(info), ch }); }
      finally { this.txBusy = false; this.listenAt = this.now(); }
      return this.mode !== 'off';
    }

    eligible(call) {
      if (!call || call === this.my.call || this.isDupe(call)) return false;
      const sk = this.skipUntil.get(call); if (sk && sk > this.now()) return false;
      const tr = this.tries.get(call); if (tr && tr.n >= this.maxTries && this.now() - tr.last < 10 * 60e3) return false;
      if (this.needTwice) { const h = this.heard.get(call); if (!h || h.n < 2) return false; }
      return true;
    }
    noteHeard(r, tone) {
      const t = this.now();
      for (const c of r.calls) {
        const h = this.heard.get(c);
        if (h && t - h.last < 120e3) { h.n += r.counts[c]; h.last = t; h.tone = tone; } else this.heard.set(c, { n: r.counts[c], last: t, tone });
      }
    }
    bestCall(t) {          // a busted copy of the call gets replaced by the version heard most often on that signal
      let best = t.call, bn = (this.heard.get(t.call) || {}).n || 0;
      for (const [c, h] of this.heard) {
        if (c === best || this.now() - h.last > 180e3 || Math.abs((h.tone || 0) - t.tone) > 60) continue;
        if (lev(c, t.call) <= 1 && h.n > bn) { best = c; bn = h.n; }
      }
      return best;
    }
    cqCall(r) {        // the station calling CQ in this transmission, if any
      if (!r.isCQ && !(r.tu && r.calls.length === 1)) return null;
      if (r.myExact) return null;
      let best = null;
      for (const c of r.calls) if (!best || r.counts[c] > r.counts[best]) best = c;
      if (best && this.style === 'normal' && r.tk.includes('DX') && /^(K|N|W|A[A-L])[0-9A-Z]*$/.test(best)) return null;  // US station asking for DX
      return best;
    }

    // A finished transmission from signal channel ch. info: { tone, wpm, snr }
    hear(ch, text, info) {
      if (this.mode === 'off' || this.txBusy) return;
      const r = analyze(text, this.my.call, this.t && this.t.call);
      if (!r.tk.length) return;
      this.noteHeard(r, info.tone);
      const fromTarget = this.t && (ch === this.t.ch || (r.calls.includes(this.t.call) && Math.abs(info.tone - this.t.tone) < 60));
      switch (this.state) {
        case 'idle': return this.mode === 'answer' ? this.onIdleAnswer(ch, r, info) : this.onIdleCq(ch, r, info);
        case 'calling': if (fromTarget) return this.onCalling(r, info); return;
        case 'exch': if (fromTarget) return this.onExch(r, info); return;
        case 'report': if (fromTarget) return this.onReport(r, info); return;
        case 'cq': return this.onCqReply(ch, r, info);
        case 'run_exch': case 'run_report': if (fromTarget) return this.onRunReply(r, info); return;
      }
    }

    // ----- answering CQs -----
    onIdleAnswer(ch, r, info) {
      let call = this.cqCall(r);
      if (!call) return;
      call = this.bestCall({ call, tone: info.tone });
      if (!this.eligible(call)) {
        if (!this.isDupe(call) && this.needTwice && (this.heard.get(call) || {}).n < 2) this.status(`Heard ${call} calling CQ; waiting to copy the call a second time`);
        else if (this.isDupe(call)) this.status(`${call} is already in the log on this band`);
        return;
      }
      const t = { call, ch, tone: info.tone, wpm: info.wpm, snr: info.snr, rx: {} };
      if (!this.o.canTx()) {
        const last = this.dryAt.get(call) || 0;
        if (this.now() - last > 30e3) { this.dryAt.set(call, this.now()); this.ev('dry', `Would call ${call} now (not transmitting)`, t); }
        return;
      }
      if (this.askFirst) { this.proposal = t; this.ev('propose', `Call ${call}?`, t); this.status(`Tap Call to answer ${call}`); return; }
      this.callTarget(t);
    }
    approve() { const t = this.proposal; this.proposal = null; if (t && this.state === 'idle' && this.mode === 'answer') this.callTarget(t); }
    async callTarget(t, twice) {
      this.t = t; this.state = 'calling';
      const tr = this.tries.get(t.call); const n = tr && this.now() - tr.last < 10 * 60e3 ? tr.n + 1 : 1;
      this.tries.set(t.call, { n, last: this.now() });
      this.status(`Calling ${t.call} (try ${n} of ${this.maxTries})`);
      const my = this.my.call;
      const msg = this.style === 'contest' ? (twice ? `${my} ${my}` : my) : `${t.call} DE ${my} ${my} K`;
      await this.tx(msg, t, t.ch);
    }
    onCalling(r, info) {
      const t = this.t, my = this.my.call, z = this.my.zone;
      if (r.myExact || r.myFuzzy || r.partial) {
        if (this.style === 'contest') {
          if ((r.rst || r.zone) && (r.myExact || r.myFuzzy)) {
            if (!r.zone && !t.askedNr) { t.askedNr = true; t.rxRst = r.rst; this.status(`Zone from ${t.call} not copied; asking again`); return this.tx('NR?', t, t.ch); }
            t.rx = { rst: r.rst || t.rxRst || '599', zone: r.zone || '' };
            t.exchTries = 1; this.state = 'exch';
            this.status(`${t.call} came back; sending the exchange`);
            return this.tx(r.myExact ? `5NN ${z}` : `${my} ${my} 5NN ${z}`, t, t.ch);
          }
          return this.callTarget(t, true);                          // "KD9?" or our call without exchange: repeat it
        }
        // normal QSO: they answered with their report
        t.rx = { rst: r.rst || '599', name: r.name, qth: r.qth };
        const rst = this.rstFor(t);
        t.rstS = rst; this.state = 'report';
        this.status(`${t.call} answered; sending report ${rst}`);
        const nm = r.name ? `${r.name} ` : '';
        return this.tx(`R R ${t.call} DE ${my} TNX ${nm}FER CALL UR RST ${rst} ${rst} NAME ${this.my.name} ${this.my.name} QTH ${this.my.qth} ${this.my.qth} HW? ${t.call} DE ${my} KN`, t, t.ch);
      }
      if (t.askedNr && r.zone == null) {
        const z = r.tk.map(x => /^[0-9TOAUVEBDN]{1,2}$/.test(x) && /[0-9]/.test(x) ? parseInt(x.replace(/[TOAUVEBDN]/g, c => ({ T: 0, O: 0, A: 1, U: 2, V: 3, E: 5, B: 7, D: 8, N: 9 })[c]), 10) : 0).find(n => n >= 1 && n <= 40);
        if (z) { t.rx = { rst: t.rxRst || '599', zone: z }; t.exchTries = 1; this.state = 'exch'; return this.tx(`5NN ${this.my.zone}`, t, t.ch); }
      }
      if (r.query && !r.other.length) return this.callTarget(t, true);
      if (r.other.length || r.isCQ) {          // they worked someone else, or never heard us
        this.state = 'idle';
        const tr = this.tries.get(t.call);
        if (r.isCQ && tr && tr.n < this.maxTries && !r.other.length) return this.callTarget(t);   // still calling CQ: try again
        this.status(r.other.length ? `${t.call} is working ${r.other[0]}; will try again on the next CQ` : `${t.call} did not hear us`);
        this.t = null;
      }
    }
    onExch(r, info) {
      const t = this.t, my = this.my.call, z = this.my.zone;
      if (r.query || ((r.myExact || r.myFuzzy) && (r.rst || r.zone))) {
        if (t.exchTries >= 3) return this.finish(t, 'no TU heard');
        t.exchTries++;
        return this.tx(`5NN ${z} ${z}`, t, t.ch);
      }
      if (r.partial) return this.tx(`${my} ${my} 5NN ${z}`, t, t.ch);
      return this.finish(t, '');            // TU, a new CQ, or their next contact
    }
    onReport(r, info) {
      const t = this.t, my = this.my.call;
      if (r.query && !r.signoff) { if ((t.rep = (t.rep || 0) + 1) <= 1) return this.tx(`UR RST ${t.rstS} ${t.rstS} NAME ${this.my.name} ${this.my.name} QTH ${this.my.qth} ${this.my.qth} ${t.call} DE ${my} KN`, t, t.ch); }
      if (r.name && !t.rx.name) t.rx.name = r.name;
      this.finish(t, '');
      const nm = t.rx.name ? `${t.rx.name} ` : '';
      return this.tx(`TU ${nm}73 GL ${t.call} DE ${my} <SK> EE`, t, t.ch);
    }
    rstFor(t) { const s = t.snr || 0; return s >= 24 ? '599' : s >= 16 ? '579' : s >= 10 ? '559' : '449'; }

    finish(t, note) {
      if (!t || t.logged) return;
      t.logged = true;
      const fixed = this.bestCall(t);
      if (fixed !== t.call) {
        if (this.isDupe(fixed)) { this.status(`${fixed} was already logged; not logging twice`); this.state = 'idle'; this.t = null; return; }
        note = (note ? note + '; ' : '') + `call corrected from ${t.call}`; t.call = fixed;
      }
      const contest = this.style === 'contest';
      const q = {
        call: t.call, rstS: contest ? '599' : (t.rstS || '599'), rstR: (t.rx && t.rx.rst) || '599',
        srx: contest && t.rx ? String(t.rx.zone || '') : '', stx: contest ? String(this.my.zone) : '',
        name: (t.rx && t.rx.name) || '', qth: (t.rx && t.rx.qth) || '', wpm: Math.round(t.wpm || 0), tone: Math.round(t.tone || 0),
        contest, note, when: new Date(this.now())
      };
      this.markWorked(this.o.band(), t.call);
      this.o.log(q);
      this.status(`Logged ${t.call}${q.srx ? ' zone ' + q.srx : ''}`);
      this.state = 'idle'; this.t = null;
      if (this.mode === 'cq') this.nextCqAt = this.now() + (contest ? 300 : 3000);
    }

    // ----- calling CQ -----
    onIdleCq(ch, r, info) {
      if (this.cqTone && Math.abs(info.tone - this.cqTone) < 120) { this.busyAt = this.now(); }   // someone is near our spot
    }
    onCqReply(ch, r, info) {
      if (Math.abs(info.tone - this.cqTone) > 100 || r.isCQ || (r.rst && !r.myExact)) return;      // a CQ or another QSO nearby is not a caller
      if (this.style === 'normal' ? !(r.myExact || r.myFuzzy || r.tk.includes('DE')) : r.tk.length > 4) return;
      const cands = r.calls.filter(c => c !== this.my.call && !this.isDupe(c));
      if (!cands.length) return;
      let call = cands[0];
      for (const c of cands) if (r.counts[c] > r.counts[call]) call = c;
      const t = { call, ch, tone: this.cqTone, wpm: info.wpm, snr: info.snr, rx: {} };
      this.t = t;
      const my = this.my.call, z = this.my.zone;
      if (this.style === 'contest') {
        this.state = 'run_exch'; t.tries = 1;
        this.status(`${call} called; sending the exchange`);
        return this.tx(`${call} 5NN ${z}`, t, ch);
      }
      const rst = this.rstFor(t); t.rstS = rst; this.state = 'run_report';
      this.status(`${call} called; sending report ${rst}`);
      return this.tx(`${call} DE ${my} GM TNX FER CALL UR RST ${rst} ${rst} NAME ${this.my.name} ${this.my.name} QTH ${this.my.qth} ${this.my.qth} HW? ${call} DE ${my} KN`, t, ch);
    }
    onRunReply(r, info) {
      const t = this.t, my = this.my.call, z = this.my.zone;
      if (this.state === 'run_exch') {
        if (r.rst || r.zone || r.tu) {
          t.rx = { rst: r.rst || '599', zone: r.zone || '' };
          this.finish(t, '');
          return this.tx(`TU ${my}`, { tone: this.cqTone, wpm: t.wpm }, t.ch);
        }
        const fix = r.calls.find(c => c !== t.call && lev(c, t.call) <= 2);
        if (fix) { t.call = fix; t.tries = (t.tries || 1) + 1; return this.tx(`${fix} 5NN ${z}`, t, t.ch); }   // they repeated their call: we had it wrong
        if (r.query && (t.tries = (t.tries || 1) + 1) <= 3) return this.tx(`${t.call} 5NN ${z} ${z}`, t, t.ch);
        return;
      }
      t.rx = { rst: r.rst || '599', name: r.name, qth: r.qth };
      this.finish(t, '');
      const nm = r.name ? `${r.name} ` : '';
      return this.tx(`R TNX ${nm}73 GL ${t.call} DE ${my} <SK> EE`, t, t.ch);
    }
    async sendCq() {
      const my = this.my.call;
      const info = { tone: this.cqTone, wpm: this.my.wpm };
      if (!this.qrlDone) {
        this.qrlDone = true; this.busyAt = 0; this.state = 'qrl';
        this.status(`Checking ${this.cqTone} Hz is clear (QRL?)`);
        await this.tx(this.style === 'contest' ? 'QRL?' : 'QRL? DE ' + my, info, -1);
        this.state = 'qrl_wait'; return;
      }
      this.state = 'cq';
      this.status(`Calling CQ at ${this.cqTone} Hz`);
      await this.tx(this.style === 'contest' ? `CQ TEST ${my} ${my}` : `CQ CQ CQ DE ${my} ${my} K`, info, -1);
    }

    // Timeouts. Call often (every 100 ms or so).
    tick() {
      if (this.mode === 'off' || this.txBusy) return;
      const now = this.now(), c = this.style === 'contest';
      // Count quiet time from the end of our transmission, but never while the other side is still sending.
      const spot = this.t ? this.t.tone : this.cqTone;
      const idle = spot && this.o.toneIdleMs ? this.o.toneIdleMs(spot, 70) : Infinity;
      const since = Math.min(now - this.listenAt, idle);
      if (this.state === 'calling' && (since > (c ? 4000 : 9000) || now - this.listenAt > (c ? 20000 : 90000))) {
        const t = this.t; this.state = 'idle'; this.t = null;
        this.status(`No answer from ${t.call}; listening again`);
      } else if (this.state === 'exch' && since > 4500) {
        this.finish(this.t, 'no TU heard');
      } else if (this.state === 'report' && since > 15000) {
        this.finish(this.t, 'no reply to our report');
      } else if ((this.state === 'run_exch' || this.state === 'run_report') && since > (c ? 4000 : 12000)) {
        this.status(`${this.t.call} went quiet`); this.state = 'idle'; this.t = null; this.nextCqAt = now + 500;
      }
      if (this.mode === 'cq' && this.o.canTx()) {
        if (!this.cqTone) { this.cqTone = this.o.quietTone ? this.o.quietTone() : 700; this.qrlDone = false; }
        if (now - this.listenAt > 90000 && ['cq', 'qrl_wait', 'run_exch', 'run_report'].includes(this.state)) { this.state = 'idle'; this.t = null; this.nextCqAt = now; }
        if (this.state === 'qrl_wait' && now - this.listenAt > 3000) {
          if (this.busyAt && this.busyAt > this.listenAt) { this.status(`${this.cqTone} Hz is in use; moving`); this.cqTone = 0; this.state = 'idle'; return; }
          this.state = 'idle'; this.nextCqAt = now;
        }
        if (this.state === 'cq' && since > (c ? 2500 : 7000)) { this.state = 'idle'; this.nextCqAt = now + (c ? 200 : 2500); }
        if (this.state === 'idle' && now >= this.nextCqAt) {
          if (this.busyAt && now - this.busyAt < 4000 && this.qrlDone) { this.status('Someone is on our spot; finding a clear one'); this.cqTone = 0; return; }
          this.sendCq();
        }
      }
    }
  }
  return { Engine, analyze, isCall, eotMs, norm, lev };
})();
if (typeof module !== 'undefined') module.exports = QSO;
