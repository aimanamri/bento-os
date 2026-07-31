'use strict';

// Generates the PWA icon set into src/assets/icons/ — run with `npm run icons`
// after changing the mark or the palette, then commit the PNGs.
//
// Zero dependencies on purpose: the icons are drawn into a pixel buffer and
// encoded as PNG with node's own zlib, so the build has no image toolchain
// and produces byte-identical output on every machine. Everything is drawn at
// 4x and box-filtered down, which is what gives the edges their antialiasing.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // supersample factor

/* ── palette (the Bento tokens from src/css/input.css, dark variant) ── */
const BG_TOP = [27, 34, 44];
const BG_BOTTOM = [14, 17, 22];
const RICE = [231, 235, 239]; // --c-ink
const ACCENT = [96, 165, 250]; // --c-accent
const GREEN = [52, 199, 123]; // --c-ok

/* ── tiny raster surface ───────────────────────────────────── */

function createCanvas(size) {
  return { size, px: new Float64Array(size * size * 4) };
}

function blend(c, i, [r, g, b], a) {
  const inv = 1 - a;
  c.px[i] = c.px[i] * inv + r * a;
  c.px[i + 1] = c.px[i + 1] * inv + g * a;
  c.px[i + 2] = c.px[i + 2] * inv + b * a;
  c.px[i + 3] = c.px[i + 3] * inv + 255 * a;
}

// Rounded rectangle in pixel units; `color` may be a function of the
// vertical position (0..1) so a panel can carry a gradient.
function roundRect(c, x, y, w, h, r, color) {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(c.size, Math.ceil(x + w));
  const y1 = Math.min(c.size, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      // Distance from the rect's rounded boundary, corner-aware
      const dx = Math.max(x + r - (px + 0.5), px + 0.5 - (x + w - r), 0);
      const dy = Math.max(y + r - (py + 0.5), py + 0.5 - (y + h - r), 0);
      if (dx * dx + dy * dy > r * r) continue;
      const rgb = typeof color === 'function' ? color((py - y) / h) : color;
      blend(c, (py * c.size + px) * 4, rgb, 1);
    }
  }
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/* ── the mark: a bento box seen top-down, three compartments ── */

function drawIcon(size, { bleed, maskable }) {
  const c = createCanvas(size * SS);
  const S = size * SS;

  // Full-bleed for anything the platform masks itself (Android adaptive
  // icons, iOS home screen); otherwise the plate draws its own rounded
  // square so the icon looks finished on a plain background.
  const plate = bleed || maskable ? 0 : 0.055 * S;
  const plateR = bleed || maskable ? 0 : 0.225 * S;
  roundRect(c, plate, plate, S - plate * 2, S - plate * 2, plateR,
    (t) => lerp(BG_TOP, BG_BOTTOM, t));

  // A maskable icon can be cropped to a circle of 80% diameter — the largest
  // square that survives that is ~0.566 wide, hence the deeper inset. iOS
  // only rounds the corners, so its icon keeps the standard framing.
  const inset = maskable ? 0.217 * S : 0.20 * S;
  const box = S - inset * 2;
  const gap = 0.052 * S;
  const r = 0.055 * S;
  const leftW = box * 0.46;
  const rightW = box - leftW - gap;
  const rightH = (box - gap) / 2;

  roundRect(c, inset, inset, leftW, box, r, ACCENT);
  roundRect(c, inset + leftW + gap, inset, rightW, rightH, r, RICE);
  roundRect(c, inset + leftW + gap, inset + rightH + gap, rightW, rightH, r, GREEN);

  return downsample(c, size);
}

function downsample(c, size) {
  const out = Buffer.alloc(size * size * 4);
  const n = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * c.size + (x * SS + sx)) * 4;
          r += c.px[i]; g += c.px[i + 1]; b += c.px[i + 2]; a += c.px[i + 3];
        }
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/* ── PNG encoding (RGBA8, no interlace) ────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── output ────────────────────────────────────────────────── */

const out = path.join(__dirname, '..', 'src', 'assets', 'icons');
fs.mkdirSync(out, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { bleed: true }], // iOS rounds the corners itself
];

for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(out, name), encodePng(drawIcon(size, opts), size));
  console.log(`[icons] ${name} (${size}×${size})`);
}
