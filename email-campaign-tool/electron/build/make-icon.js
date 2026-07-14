// Generates electron/build/icon.png (256x256, RGBA) with no external deps.
// A rounded indigo tile with a white ring ("O" for OutreachFlow).
// Run: node electron/build/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const BG = [79, 70, 229];     // indigo #4f46e5
const FG = [255, 255, 255];   // white

function insideRoundedRect(x, y, size, r) {
  const min = r, max = size - 1 - r;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function buildPixels() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const c = (SIZE - 1) / 2;
  const corner = 48, outerR = 92, innerR = 56;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (!insideRoundedRect(x, y, SIZE, corner)) { px[i + 3] = 0; continue; }
      const d = Math.hypot(x - c, y - c);
      const col = d <= outerR && d >= innerR ? FG : BG;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    }
  }
  return px;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(px) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const stride = SIZE * 4 + 1;
  const raw = Buffer.alloc(SIZE * stride);
  for (let y = 0; y < SIZE; y++) {
    raw[y * stride] = 0; // filter: none
    px.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, encodePng(buildPixels()));
console.log('Wrote', out);
