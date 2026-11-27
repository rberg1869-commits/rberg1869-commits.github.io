const fs = require('fs');
const sharp = require('/opt/npm-tools/node_modules/sharp');
const out = process.argv[2] || 'dist';
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync('template.html', 'utf8');
html = html.replace('/*DSP*/', () => fs.readFileSync('dsp.js', 'utf8').trim());
html = html.replace('/*DECODER*/', () => fs.readFileSync('decoder.js', 'utf8').trim());
html = html.replace('/*LIBS*/', () => ['qso.js', 'skim.js', 'morse.js', 'qlog.js', 'sim.js'].map(f => fs.readFileSync(f, 'utf8').trim()).join('\n\n'));
fs.writeFileSync(out + '/index.html', html);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16263a"/><stop offset="1" stop-color="#070b11"/></linearGradient>
<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd400"/><stop offset=".35" stop-color="#00d7ff"/><stop offset=".75" stop-color="#0069ff"/><stop offset="1" stop-color="#001c6e"/></linearGradient></defs>
<rect width="512" height="512" fill="url(#g)"/>
<rect x="226" y="300" width="60" height="212" fill="url(#w)" opacity=".9"/>
<text x="256" y="215" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="150" fill="#e7eef7">CW</text>
<rect x="96" y="250" width="70" height="30" rx="15" fill="#33c9ff"/><rect x="186" y="250" width="230" height="30" rx="15" fill="#33c9ff"/></svg>`;
const manifest = { name: 'CW Decoder', short_name: 'CW Decoder', start_url: '.', scope: '.', display: 'standalone',
  background_color: '#0a0d12', theme_color: '#0a0d12', orientation: 'any',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] };
fs.writeFileSync(out + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
(async () => {
  for (const s of [180, 192, 512]) await sharp(Buffer.from(svg)).resize(s, s).png().toFile(`${out}/icon-${s}.png`);
  console.log('built', fs.readdirSync(out).join(', '), (html.length / 1024).toFixed(1) + ' KB');
})();
