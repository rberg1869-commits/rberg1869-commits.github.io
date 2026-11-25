const fs = require('fs');
const sharp = require('/opt/npm-tools/node_modules/sharp');
const out = process.argv[2] || 'dist';
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync('template.html', 'utf8');
html = html.replace('/*DSP*/', () => fs.readFileSync('dsp.js', 'utf8').trim());
html = html.replace('/*DECODER*/', () => fs.readFileSync('decoder.js', 'utf8').trim());
fs.writeFileSync(out + '/index.html', html);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0e0e0e"/>
<rect x="0" y="0" width="512" height="40" fill="#f2f2f2"/>
<circle cx="132" cy="300" r="52" fill="#e4002b"/><rect x="222" y="248" width="200" height="104" fill="#e4002b"/>
<text x="64" y="176" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="110" fill="#f2f2f2">CW</text></svg>`;
const manifest = { name: 'CW Decoder', short_name: 'CW Decoder', start_url: '.', scope: '.', display: 'standalone',
  background_color: '#0e0e0e', theme_color: '#0e0e0e', orientation: 'any',
  icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }] };
fs.writeFileSync(out + '/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
(async () => {
  for (const s of [180, 192, 512]) await sharp(Buffer.from(svg)).resize(s, s).png().toFile(`${out}/icon-${s}.png`);
  console.log('built', fs.readdirSync(out).join(', '), (html.length / 1024).toFixed(1) + ' KB');
})();
