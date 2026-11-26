// Prévia da arte isométrica em PNG, sem navegador: cada móvel (todas as variantes) numa folha ampliada, sobre um
// piso de losangos, com a âncora marcada. Uso: npx tsx scripts/iso-preview.ts <pasta> [kind...] [--scale 3]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { FURNITURE, type FurnitureKind } from '../client/src/art/api';
import { PixelBuf } from '../client/src/art/core/pixbuf';
import { renderIsoFurniture } from '../client/src/art/iso/index';

const args = process.argv.slice(2);
const si = args.indexOf('--scale');
const scale = si >= 0 ? Number(args[si + 1]) : 3;
const rest = args.filter((a, i) => !(si >= 0 && (i === si || i === si + 1)));
const out = rest[0] ?? '.';
const only = rest.slice(1) as FurnitureKind[];
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

/** Piso de losangos 32x16 sob o footprint (para ver se o móvel assenta no lugar). */
function floor(b: PixelBuf, ax: number, ay: number, wt: number, ht: number): void {
  for (let py = 0; py < b.h; py++) {
    for (let px = 0; px < b.w; px++) {
      const a = px + 0.5 - ax;
      const bb = 2 * (py + 0.5 - ay);
      const x = (bb + a) / 2;
      const y = (bb - a) / 2;
      const tx = Math.floor(x / 16);
      const ty = Math.floor(y / 16);
      const inside = tx >= 0 && ty >= 0 && tx < wt && ty < ht;
      const odd = (tx + ty) & 1;
      b.set(px, py, inside ? (odd ? '#c9cdd6' : '#d6dae2') : odd ? '#e8e2d6' : '#efe9dd');
    }
  }
}

const kinds = (only.length ? only : (Object.keys(FURNITURE) as FurnitureKind[])).filter((k) => FURNITURE[k].mount === 'floor');
for (const kind of kinds) {
  const def = FURNITURE[kind];
  const variants = def.variants ?? [undefined];
  const states = def.states ?? 1;
  const cells: PixelBuf[] = [];
  for (const v of variants) {
    for (let st = 0; st < states; st++) {
      for (const seed of [0, 1]) {
        const f = renderIsoFurniture(kind, v, st, seed);
        const pad = 24;
        const W = Math.max(f.base.buf.w, f.front?.buf.w ?? 0) + pad * 2;
        const H = Math.max(f.base.buf.h, f.front?.buf.h ?? 0) + pad * 2;
        const cell = new PixelBuf(W, H);
        const ax = pad + Math.max(f.base.ax, f.front?.ax ?? 0);
        const ay = pad + Math.max(f.base.ay, f.front?.ay ?? 0);
        floor(cell, ax, ay, def.footprint.w, def.footprint.h);
        cell.draw(f.base.buf, ax - f.base.ax, ay - f.base.ay);
        if (f.front) cell.draw(f.front.buf, ax - f.front.ax, ay - f.front.ay);
        cell.set(ax, ay, '#ff00ff');
        for (const r of Object.values(f.base.rects ?? {})) {
          if (!r) continue;
          for (let i = 0; i < r.w; i++) {
            const dy = Math.round(i * (r.skew ?? 0));
            cell.set(ax - f.base.ax + r.x + i, ay - f.base.ay + r.y + dy, 'rgba(255,0,255,0.6)');
            cell.set(ax - f.base.ax + r.x + i, ay - f.base.ay + r.y + dy + r.h - 1, 'rgba(255,0,255,0.6)');
          }
        }
        cells.push(cell);
      }
    }
  }
  const W = cells.reduce((s, c) => s + c.w, 0);
  const H = Math.max(...cells.map((c) => c.h));
  const sheet = new PixelBuf(W, H);
  let x = 0;
  for (const c of cells) {
    sheet.draw(c, x, 0);
    x += c.w;
  }
  writeFileSync(join(out, `${kind}.png`), png(sheet, scale));
}
console.log(`${kinds.length} folhas em ${out}`);
