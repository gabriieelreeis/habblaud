// Prévia dos carros e do elevador alto (arquivos extras da visão isométrica).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { PixelBuf } from '../client/src/art/core/pixbuf';
import { renderIsoCar } from '../client/src/art/iso/car';
import { renderTallElevator } from '../client/src/art/iso/elevator';

const out = process.argv[2] ?? '.';
mkdirSync(out, { recursive: true });
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function png(b: PixelBuf, k = 1): Buffer {
  const w = b.w * k;
  const h = b.h * k;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const si = ((Math.floor(y / k) * b.w + Math.floor(x / k)) * 4) | 0;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      raw[di] = b.data[si];
      raw[di + 1] = b.data[si + 1];
      raw[di + 2] = b.data[si + 2];
      raw[di + 3] = b.data[si + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function row(cells: PixelBuf[]): PixelBuf {
  const sheet = new PixelBuf(cells.reduce((s, c) => s + c.w, 0), Math.max(...cells.map((c) => c.h)));
  let x = 0;
  for (const c of cells) {
    sheet.draw(c, x, 0);
    x += c.w;
  }
  return sheet;
}

// carros: losango do footprint 2x1 sob cada um, âncora em magenta
const cars: PixelBuf[] = [];
for (const dir of [1, -1] as const) {
  for (let v = 0; v < 6; v++) {
    const f = renderIsoCar(v, dir);
    const W = 80;
    const H = 60;
    const cell = new PixelBuf(W, H);
    const ax = 40;
    const ay = 34;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const a = px + 0.5 - (ax - 8);
        const bb = 2 * (py + 0.5 - (ay - 4));
        const x = (bb + a) / 2;
        const y = (bb - a) / 2;
        const inside = x >= 0 && y >= 0 && x < 32 && y < 16;
        cell.set(px, py, inside ? '#d6dae2' : '#efe9dd');
      }
    }
    cell.draw(f.buf, ax - f.ax, ay - f.ay);
    cell.set(ax, ay, '#ff00ff');
    cars.push(cell);
  }
}
const half = cars.length / 2;
const carSheet = new PixelBuf(80 * half, 60 * 2);
cars.forEach((c, i) => carSheet.draw(c, (i % half) * 80, Math.floor(i / half) * 60));
writeFileSync(join(out, 'cars.png'), png(carSheet, 3));

const els = [0, 1, 2, 3, 4].map((st) => {
  const f = renderTallElevator(st);
  const cell = new PixelBuf(f.buf.w + 6, f.buf.h + 6);
  cell.rect(0, 0, cell.w, cell.h, '#8a93b0');
  cell.draw(f.buf, 3, 3);
  cell.set(3 + f.ax, 3 + f.ay, '#ff00ff');
  return cell;
});
writeFileSync(join(out, 'elevator.png'), png(row(els), 3));
console.log('ok', out);
