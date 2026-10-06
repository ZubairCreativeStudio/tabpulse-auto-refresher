const fs = require("node:fs");
const zlib = require("node:zlib");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const body = Buffer.concat([name, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), 8 + data.length);
  return result;
}

function makePng(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 128;
  const setPixel = (x, y, color, alpha = 255) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = (y * size + x) * 4;
    const mix = alpha / 255;
    pixels[index] = Math.round(pixels[index] * (1 - mix) + color[0] * mix);
    pixels[index + 1] = Math.round(pixels[index + 1] * (1 - mix) + color[1] * mix);
    pixels[index + 2] = Math.round(pixels[index + 2] * (1 - mix) + color[2] * mix);
    pixels[index + 3] = 255;
  };
  const circle = (cx, cy, radius, color, alpha = 255) => {
    const r = radius * scale;
    const x0 = Math.floor((cx - radius) * scale);
    const x1 = Math.ceil((cx + radius) * scale);
    const y0 = Math.floor((cy - radius) * scale);
    const y1 = Math.ceil((cy + radius) * scale);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        if ((x - cx * scale) ** 2 + (y - cy * scale) ** 2 <= r ** 2) setPixel(x, y, color, alpha);
      }
    }
  };
  const line = (x1, y1, x2, y2, width, color, alpha = 255) => {
    const steps = Math.ceil(Math.hypot((x2 - x1) * scale, (y2 - y1) * scale) * 1.5);
    for (let step = 0; step <= steps; step += 1) {
      const ratio = steps ? step / steps : 0;
      circle(x1 + (x2 - x1) * ratio, y1 + (y2 - y1) * ratio, width / 2, color, alpha);
    }
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      setPixel(x, y, [11, 18, 29]);
    }
  }

  const center = 64;
  const shield = [[64, 12], [104, 34], [104, 78], [64, 112], [24, 78], [24, 34], [64, 12]];
  for (let i = 0; i < shield.length - 1; i += 1) {
    line(shield[i][0], shield[i][1], shield[i + 1][0], shield[i + 1][1], 7, [33, 75, 78], 255);
  }
  for (let radius = 19; radius >= 8; radius -= 1) {
    circle(center, center, radius, [26, 207, 164], Math.max(2, 30 - radius));
  }
  const wave = [[31, 65], [44, 65], [52, 48], [65, 83], [76, 54], [84, 65], [97, 65]];
  for (let i = 0; i < wave.length - 1; i += 1) {
    line(wave[i][0], wave[i][1], wave[i + 1][0], wave[i + 1][1], 6, [74, 240, 194]);
  }

  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const source = (y * size + x) * 4;
      pixels.copy(row, 1 + x * 4, source, source + 4);
    }
    rows.push(row);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

for (const size of [16, 48, 128]) {
  fs.writeFileSync(`icon${size}.png`, makePng(size));
}
