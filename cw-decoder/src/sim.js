// Practice band: make-believe stations that call CQ and answer what the iPad sends, so the
// whole automatic QSO can be rehearsed with no radio and no transmitting.
// play(text, {tone, wpm, snr, ch}) must start a transmission and return its length in ms.
const SIM = (function () {
  const QSO_LEV = (a, b) => { const d = []; for (let i = 0; i <= a.length; i++) d[i] = [i]; for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  const POOL = [
    ['DL1ABC', 14, 'HANS', 'BERLIN'], ['F5XYZ', 14, 'JEAN', 'PARIS'], ['G4AAA', 14, 'JOHN', 'LONDON'], ['EA3ZZ', 14, 'JOSE', 'BARCELONA'],
    ['OH2XX', 15, 'PEKKA', 'HELSINKI'], ['JA1ABC', 25, 'TARO', 'TOKYO'], ['PY2AA', 11, 'JOAO', 'SAO PAULO'], ['VK2DX', 30, 'BRUCE', 'SYDNEY'],
    ['ZS6AB', 38, 'PIET', 'PRETORIA'], ['I2ABC', 15, 'MARCO', 'MILAN'], ['SP9XYZ', 15, 'JAN', 'KRAKOW'], ['OK1AA', 15, 'PETR', 'PRAGUE'],
    ['LZ2BB', 20, 'IVAN', 'SOFIA'], ['UA3AA', 16, 'OLEG', 'MOSCOW'], ['4X4ZZ', 20, 'DAVID', 'HAIFA'], ['9A1A', 15, 'ANTE', 'ZAGREB'],
    ['EI7XX', 14, 'SEAN', 'CORK'], ['ON4ZZ', 14, 'LUC', 'GENT'], ['PA3AAA', 14, 'JAN', 'UTRECHT'], ['HA5AA', 15, 'LASZLO', 'BUDAPEST'],
    ['W1XYZ', 5, 'BILL', 'MAINE'], ['K5ABC', 4, 'TOM', 'TEXAS'], ['N4ZZ', 5, 'ED', 'OHIO'], ['W7AA', 3, 'JIM', 'OREGON'], ['KH6XX', 31, 'KEOLA', 'HONOLULU']
  ];
  class Band {
    constructor(o) {
      this.o = o; this.rnd = o.rnd || Math.random; this.my = o.my || 'KD9RDU';
      this.setStyle(o.style || 'contest');
    }
    r(a, b) { return a + (b - a) * this.rnd(); }
    pickFree(used) { let p; do { p = POOL[Math.floor(this.rnd() * POOL.length)]; } while (used.has(p[0])); used.add(p[0]); return p; }
    setStyle(s) {
      this.style = s; this.stations = []; this.callers = [];
      const used = new Set(), n = s === 'contest' ? 4 : 3, now = this.o.now();
      for (let i = 0; i < n; i++) {
        const p = this.pickFree(used);
        this.stations.push({ call: p[0], zone: p[1], name: p[2], qth: p[3], kind: s === 'contest' ? 'runner' : 'cqer',
          tone: Math.round(450 + i * (1800 / n) + this.r(0, 200)), wpm: Math.round(s === 'contest' ? this.r(24, 32) : this.r(16, 24)),
          snr: Math.round(this.r(12, 26)), state: 'idle', nextAt: now + this.r(500, 4000), busyUntil: 0, qso: null, ch: i + 100 });
      }
      this.used = used;
    }
    send(st, text, delay) {
      const go = () => { const d = this.o.play(text, { tone: st.tone, wpm: st.wpm, snr: st.snr, ch: st.ch, call: st.call }); st.busyUntil = this.o.now() + d; return d; };
      if (delay) { st.state = 'pending'; st.sendAt = this.o.now() + delay; st.sendText = text; return; }
      return go();
    }
    tick() {
      const now = this.o.now();
      for (const st of this.stations.concat(this.callers)) {
        if (st.state === 'pending' && now >= st.sendAt) { st.state = st.after || 'listen'; st.after = null; this.send(st, st.sendText); st.listenUntil = st.busyUntil + 2500; continue; }
        if (now < st.busyUntil) continue;
        if (st.kind === 'runner' || st.kind === 'cqer') {
          if ((st.state === 'idle' && now >= st.nextAt) || (st.state === 'listen' && now > st.listenUntil)) {
            if (st.kind === 'runner') {
              st.qso = null;
              if (this.rnd() < 0.2 && st.state === 'listen') {          // works somebody else now and then
                const ph = POOL[Math.floor(this.rnd() * POOL.length)][0];
                if (ph !== st.call) { this.send(st, `${ph} 5NN ${st.zone}`); st.state = 'idle'; st.nextAt = st.busyUntil + 1400; st.phantom = ph; continue; }
              }
              if (st.phantom) { this.send(st, `TU ${st.call} TEST`); st.phantom = null; st.state = 'listen'; st.listenUntil = st.busyUntil + 2200; continue; }
              const v = [`CQ TEST ${st.call}`, `${st.call} TEST`, `CQ ${st.call} TEST`, `TEST ${st.call} ${st.call}`][Math.floor(this.rnd() * 4)];
              this.send(st, v); st.state = 'listen'; st.listenUntil = st.busyUntil + 2200;
            } else {
              st.qso = null;
              this.send(st, `CQ CQ CQ DE ${st.call} ${st.call} K`); st.state = 'listen'; st.listenUntil = st.busyUntil + 7000;
            }
          }
        } else if (st.kind === 'caller' && now > (st.giveUpAt || 0)) {
          this.callers = this.callers.filter(c => c !== st);
        }
      }
    }
    // We just started sending: a station listening near our tone waits for us to finish.
    usStart(tone, durMs) {
      const now = this.o.now();
      for (const st of this.stations.concat(this.callers))
        if (Math.abs(st.tone - tone) <= 80 && st.state === 'listen' && now >= st.busyUntil) { st.listenUntil = Math.max(st.listenUntil || 0, now + durMs + 1500); if (st.kind === 'caller') st.giveUpAt = Math.max(st.giveUpAt, now + durMs + 15000); }
    }
    // Our transmission just ended.
    hearUs(text, tone) {
      const now = this.o.now(), T = String(text).toUpperCase(), my = this.my;
      for (const st of this.stations) {
        if (Math.abs(st.tone - tone) > 80 || now < st.busyUntil || st.state === 'pending') continue;
        if (st.kind === 'runner') {
          if (!st.qso && T.includes(my) && !T.includes('5NN') && st.state === 'listen') {
            const p = this.rnd();
            if (p < 0.78) { st.qso = 'exch'; this.send(st, `${my} 5NN ${st.zone}`, this.r(250, 600)); }
            else if (p < 0.88) { st.qso = 'part'; this.send(st, `${my.slice(0, 3)}?`, this.r(250, 600)); }
            else if (p < 0.94) { st.qso = 'exch'; this.send(st, `${my.slice(0, 5)}V 5NN ${st.zone}`, this.r(250, 600)); }
          } else if (st.qso === 'part' && T.includes(my)) {
            st.qso = 'exch'; this.send(st, `${my} 5NN ${st.zone}`, this.r(250, 600));
          } else if (st.qso === 'exch' && /5NN|599/.test(T)) {
            if (this.rnd() < 0.85) { st.qso = null; this.send(st, `TU ${st.call} TEST`, this.r(200, 500)); }
            else this.send(st, '?', this.r(200, 500));
          }
        } else if (st.kind === 'cqer') {
          if (!st.qso && T.includes(st.call) && T.includes(my)) {
            st.qso = 'report';
            this.send(st, `${my} DE ${st.call} GM TNX FER CALL UR RST 579 579 NAME ${st.name} ${st.name} QTH ${st.qth} HW? ${my} DE ${st.call} KN`, this.r(800, 1500));
          } else if (st.qso === 'report' && T.includes('RST')) {
            st.qso = 'done';
            this.send(st, `R TNX FB QSO 73 ${my} DE ${st.call} <SK> EE`, this.r(800, 1500));
            st.after = 'idle'; st.nextAt = now + 25000;
          }
        }
      }
      // Our CQ: sometimes somebody answers
      if (/\bCQ\b/.test(T) && T.includes(my) && this.rnd() < 0.75) {
        const p = this.pickFree(this.used);
        const c = { call: p[0], zone: p[1], name: p[2], qth: p[3], kind: 'caller', tone: Math.round(tone + this.r(-40, 40)),
          wpm: Math.round(this.style === 'contest' ? this.r(24, 30) : this.r(16, 22)), snr: Math.round(this.r(10, 24)),
          state: 'listen', busyUntil: 0, ch: 200 + this.callers.length, giveUpAt: now + 30000 };
        this.callers.push(c);
        this.send(c, this.style === 'contest' ? (this.rnd() < 0.5 ? c.call : `${c.call} ${c.call}`) : `${my} DE ${c.call} ${c.call} K`, this.r(400, 1200));
      }
      for (const c of this.callers) {
        if (Math.abs(c.tone - tone) > 80 || c.state === 'pending') continue;
        const close = T.split(/\s+/).some(w => w !== c.call && w.length >= 4 && QSO_LEV(w, c.call) <= 2);
        if (!T.includes(c.call) && close && /5NN|599|RST/.test(T)) { this.send(c, `${c.call} ${c.call}`, this.r(300, 700)); continue; }
        if (T.includes(c.call) && /5NN|599|RST/.test(T)) {
          this.send(c, this.style === 'contest' ? `TU 5NN ${c.zone}` : `R ${my} DE ${c.call} TNX UR RST 589 589 NAME ${c.name} QTH ${c.qth} 73 <SK>`, this.r(300, 900));
          c.giveUpAt = now + 60000;
        }
      }
    }
  }
  return { Band, POOL };
})();
if (typeof module !== 'undefined') module.exports = SIM;
