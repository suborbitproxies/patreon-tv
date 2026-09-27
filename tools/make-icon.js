// Draws the app icon (coral disc with a play mark) as a PNG with no dependencies.
const zlib = require('zlib'), fs = require('fs');
function png(w, h, px) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function draw(w, h) {
  const px = Buffer.alloc(w * h * 4), cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.36, S = 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const X = x + (sx + .5) / S, Y = y + (sy + .5) / S, dx = X - cx, dy = Y - cy;
      let c = [18, 18, 22];
      if (dx * dx + dy * dy < r * r) {
        c = [255, 90, 74];
        const tx = dx + r * 0.12, ty = dy; // play triangle
        if (tx > -r * 0.32 && tx < r * 0.42 && Math.abs(ty) < (r * 0.42 - tx) * 0.7) c = [255, 255, 255];
      }
      acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    const i = (y * w + x) * 4; px[i] = acc[0] / S / S; px[i + 1] = acc[1] / S / S; px[i + 2] = acc[2] / S / S; px[i + 3] = 255;
  }
  return png(w, h, px);
}
fs.writeFileSync(process.argv[2] || 'icon.png', draw(512, 423));
