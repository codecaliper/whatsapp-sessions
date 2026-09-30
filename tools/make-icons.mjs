// Draws the toolbar icon (two overlapping chat bubbles on a green tile) at every size Chrome asks for.
// Run: node tools/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rows.set(pixel(x, y).map((value) => Math.round(Math.max(0, Math.min(255, value)))), y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle centred at the origin. */
function roundedBox(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - halfW + radius;
  const qy = Math.abs(y) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** A speech bubble: a rounded box with a small tail at the bottom-left or bottom-right. */
function bubble(u, v, cx, cy, flip) {
  if (roundedBox(u - cx, v - cy, 0.24, 0.17, 0.1) < 0) return true;
  const tx = flip ? cx + 0.17 - u : u - (cx - 0.17);
  const ty = v - (cy + 0.12);
  return ty > 0 && ty < 0.13 && tx > -0.02 && tx < 0.1 - ty * 0.75;
}

const over = (base, [r, g, b], a) => [base[0] * (1 - a) + r * a, base[1] * (1 - a) + g * a, base[2] * (1 - a) + b * a, base[3] + (1 - base[3]) * a];

/** Colour at a point in a 1x1 unit square. */
function shade(u, v) {
  let color = [0, 0, 0, 0];
  if (roundedBox(u - 0.5, v - 0.5, 0.5, 0.5, 0.22) < 0) {
    const t = (u + v) / 2;
    color = [37 - 20 * t, 211 - 60 * t, 102 - 10 * t, 1];
  }
  if (bubble(u, v, 0.38, 0.36, false)) color = over(color, [255, 255, 255], 0.55);
  if (bubble(u, v, 0.6, 0.6, true)) {
    color = over(color, [255, 255, 255], 1);
    for (const dx of [-0.1, 0, 0.1]) {
      if (Math.hypot(u - (0.6 + dx), v - 0.6) < 0.035) color = over(color, [18, 140, 126], 1);
    }
  }
  return color;
}

for (const size of SIZES) {
  const png = encodePng(size, size, (x, y) => {
    let sum = [0, 0, 0, 0];
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const [r, g, b, a] = shade((x + (sx + 0.5) / SAMPLES) / size, (y + (sy + 0.5) / SAMPLES) / size);
        sum = [sum[0] + r * a, sum[1] + g * a, sum[2] + b * a, sum[3] + a];
      }
    }
    const a = sum[3] / (SAMPLES * SAMPLES);
    return a ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3], a * 255] : [0, 0, 0, 0];
  });
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), png);
}
console.log(`wrote icons/icon{${SIZES.join(",")}}.png`);
