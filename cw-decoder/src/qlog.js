// Contact log: keeps every QSO on the iPad, writes ADIF, and posts each new QSO to the
// QRZ.com Logbook API. QRZ does not allow web pages to read its replies, so the post is sent
// "no-cors": QRZ receives and stores it, but the page cannot see the answer.
const QLOG = (function () {
  const pad = (n, w) => String(n).padStart(w, '0');
  function field(k, v) { v = v == null ? '' : String(v); return v === '' ? '' : `<${k}:${v.length}>${v}`; }
  const BANDS = { '160m': [1.8, 2], '80m': [3.5, 4], '40m': [7, 7.3], '30m': [10.1, 10.15], '20m': [14, 14.35], '17m': [18.068, 18.168],
    '15m': [21, 21.45], '12m': [24.89, 24.99], '10m': [28, 29.7], '6m': [50, 54] };

  function adif(q, st) {
    const d = q.when instanceof Date ? q.when : new Date(q.when);
    const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCDate(), 2)}`;
    const time = `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}`;
    const parts = [
      field('call', q.call), field('qso_date', date), field('time_on', time), field('band', q.band), field('mode', 'CW'),
      q.freq ? field('freq', Number(q.freq).toFixed(6)) : '',
      field('rst_sent', q.rstS), field('rst_rcvd', q.rstR),
      field('station_callsign', st.call), field('operator', st.call), field('my_gridsquare', st.grid),
      q.contest ? field('contest_id', 'CQ-WW-CW') : '', q.srx ? field('srx_string', q.srx) : '', q.stx ? field('stx_string', q.stx) : '',
      q.name ? field('name', q.name) : '', q.qth ? field('qth', q.qth) : '',
      field('comment', ('Auto CW iPad' + (q.note ? '; ' + q.note : '')).slice(0, 80)), '<eor>'
    ];
    return parts.filter(Boolean).join(' ');
  }
  function file(list, st) {
    const head = `KD9RDU iPad CW log\n<adif_ver:5>3.1.4 <programid:13>KD9RDU-CW-iPad <eoh>\n`;
    return head + list.map(q => adif(q, st)).join('\n') + '\n';
  }
  async function toQRZ(q, st, key, fetchFn) {
    if (!key) return 'no key';
    const body = new URLSearchParams({ KEY: key, ACTION: 'INSERT', ADIF: adif(q, st) });
    try { await (fetchFn || fetch)('https://logbook.qrz.com/api', { method: 'POST', mode: 'no-cors', body }); return 'sent'; }
    catch (e) { return 'failed'; }
  }
  return { adif, file, toQRZ, BANDS };
})();
if (typeof module !== 'undefined') module.exports = QLOG;
