// Prévia do personagem por peças em PNG (sem navegador): elenco (6 looks x 8 direções), caminhada (4 quadros em sw e se)
// e escala (piso de 3x3 tiles ao lado de móveis reais e do personagem antigo).
// Uso: npx tsx scripts/avatar-preview.ts <pasta> [--scale 4]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { appearanceFromSeed } from '../client/src/art/character/appearance';
import { PixelBuf } from '../client/src/art/core/pixbuf';
import { renderIsoFurniture } from '../client/src/art/iso/index';
import type { HeldItem, Pose } from '../client/src/art/api';
import { AVATAR_SEAT_HIP_Z, POSE_FRAMES, SCREEN_DIRS, isAvatarSeated, renderAvatar, type AvatarRequest, type ScreenDir } from '../client/src/art/avatar/render';
import { BOTTOMS, EXTRAS, GLASSES, HAIRS, HATS, SHOES, TOPS, BEARDS, makeLook, type Look } from '../client/src/art/avatar/look';

const args = process.argv.slice(2);
const si = args.indexOf('--scale');
const scale = si >= 0 ? Number(args[si + 1]) : 4;
const oi = args.indexOf('--only');
const only = oi >= 0 ? args[oi + 1] : '';
const rest = args.filter((_a, i) => !(si >= 0 && (i === si || i === si + 1)) && !(oi >= 0 && (i === oi || i === oi + 1)));
/** Escala dos catálogos (3, ou a de --scale). */
const sc = si >= 0 ? scale : 3;
const out = rest[0] ?? '.';
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------ PNG

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

function png(b: PixelBuf, k = 1): Buffer {
  const w = b.w * k;
  const h = b.h * k;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = ((Math.floor(y / k) * b.w + Math.floor(x / k)) * 4) | 0;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      raw[di] = b.data[s];
      raw[di + 1] = b.data[s + 1];
      raw[di + 2] = b.data[s + 2];
      raw[di + 3] = b.data[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function save(name: string, b: PixelBuf, k = scale): void {
  writeFileSync(join(out, `${name}.png`), png(b, k));
  console.log(`${name}.png ${b.w}x${b.h} (x${k})`);
}

// ------------------------------------------------------------ cena

const BG = '#efe9dd';

/** Piso de losangos 32x16: (ox, oy) é a posição de tela do ponto de mundo (0, 0); tiles em [0, wt) x [0, ht). */
function floor(b: PixelBuf, ox: number, oy: number, wt = 0, ht = 0): void {
  for (let py = 0; py < b.h; py++) {
    for (let px = 0; px < b.w; px++) {
      const a = px + 0.5 - ox;
      const bb = 2 * (py + 0.5 - oy);
      const tx = Math.floor((bb + a) / 2 / 16);
      const ty = Math.floor((bb - a) / 2 / 16);
      const inside = tx >= 0 && ty >= 0 && tx < wt && ty < ht;
      const odd = (tx + ty) & 1;
      b.set(px, py, inside ? (odd ? '#c9cdd6' : '#d6dae2') : odd ? '#e4ddcf' : BG);
    }
  }
}

/** Tela de um ponto de mundo (x, y) a partir da origem (ox, oy). */
const S = (ox: number, oy: number, x: number, y: number): [number, number] => [ox + x - y, oy + (x + y) / 2];

function grid(rows: PixelBuf[][], gap = 2, bg = '#d8d2c6'): PixelBuf {
  const W = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.w + gap, gap)));
  const H = rows.reduce((s, r) => s + Math.max(...r.map((c) => c.h)) + gap, gap);
  const o = new PixelBuf(W, H);
  o.rect(0, 0, W, H, bg);
  let y = gap;
  for (const r of rows) {
    let x = gap;
    for (const c of r) {
      o.draw(c, x, y);
      x += c.w + gap;
    }
    y += Math.max(...r.map((c) => c.h)) + gap;
  }
  return o;
}

/** Célula com o personagem sobre um tile (âncora no centro do losango). */
function cell(look: Look, dir: ScreenDir, pose: Pose, frame: number, extra: Partial<AvatarRequest> = {}): PixelBuf {
  const s = renderAvatar(look, dir, { pose, frame, ...extra });
  const b = new PixelBuf(s.buf.w, s.buf.h);
  floor(b, s.ax, s.ay - 8, 1, 1);
  // sentado: um banco simples na altura que o jogo usa para assentar o boneco
  if (isAvatarSeated(pose, extra.seated)) {
    const top = s.ay - AVATAR_SEAT_HIP_Z;
    for (let y = top - 4; y <= s.ay; y++) {
      for (let x = s.ax - 9; x <= s.ax + 9; x++) {
        const u = (x + 0.5 - s.ax) / 9;
        const v = (y + 0.5 - top) / 4.4;
        if (y <= top + 0.5 ? u * u + v * v <= 1 : Math.abs(u) < 0.62 && y < s.ay - 1) b.set(x, y, y <= top + 0.5 ? '#6a5a8a' : '#4a4466');
      }
    }
  }
  b.draw(s.buf, 0, 0);
  return b;
}

// ------------------------------------------------------------ elenco

const CAST: Look[] = [
  makeLook({ skin: '#fbe3d0', body: 'b', hair: 'long', hairColor: '#8a3d22', top: 'dress', topColor: '#c8456b', shoes: 'boots', shoesColor: '#5a3a2c', extra: 'necklace', extraColor: '#e8c050' }),
  makeLook({ skin: '#684025', body: 'a', hair: 'afro', hairColor: '#1d1612', glasses: 'glasses', top: 'hoodie', topColor: '#3e8f6a', bottom: 'jeans', bottomColor: '#2f3f66', shoes: 'sneakers', shoesColor: '#f0f0f4' }),
  makeLook({ skin: '#e6b48c', body: 'a', hair: 'short', hairColor: '#d9a441', hat: 'cap', hatColor: '#d94c3c', top: 'polo', topColor: '#f1c23a', bottom: 'shorts', bottomColor: '#4a6a9c', shoes: 'sneakers', shoesColor: '#35384a', extra: 'backpack', extraColor: '#3d4f8a' }),
  makeLook({ skin: '#b27749', body: 'b', hair: 'bun', hairColor: '#2a1b18', top: 'tank', topColor: '#8c5ad0', bottom: 'skirt', bottomColor: '#2e2f42', shoes: 'dress', shoesColor: '#a93a52', extra: 'earring', extraColor: '#f1cf5a' }),
  makeLook({ skin: '#8d5a35', body: 'a', hair: 'mohawk', hairColor: '#35c0a8', glasses: 'shades', top: 'jacket', topColor: '#4a4f66', bottom: 'slacks', bottomColor: '#25283a', shoes: 'boots', shoesColor: '#2c2a2a', extra: 'headphones', extraColor: '#d8483c' }),
  makeLook({ skin: '#f4cfae', body: 'a', hair: 'curly', hairColor: '#6b3f26', hat: 'top', hatColor: '#272a36', top: 'suit', topColor: '#33384e', bottom: 'slacks', bottomColor: '#33384e', shoes: 'dress', shoesColor: '#1f1e26' }),
];

function castSheet(): void {
  const rows = CAST.map((l) => SCREEN_DIRS.map((d) => cell(l, d, 'stand', 0)));
  save('elenco', grid(rows, 1, BG));
}

function walkSheet(): void {
  const rows = CAST.map((l) => {
    const cs: PixelBuf[] = [];
    for (const d of ['sw', 'se'] as ScreenDir[]) for (let f = 0; f < 4; f++) cs.push(cell(l, d, 'walk', f));
    return cs;
  });
  save('andando', grid(rows, 1, BG));
}

// ------------------------------------------------------------ escala

function furn(b: PixelBuf, kind: 'desk' | 'office_chair', variant: string, ox: number, oy: number, wx: number, wy: number, part: 'base' | 'front' = 'base'): void {
  const f = renderIsoFurniture(kind, variant, 0, 1);
  const s = part === 'base' ? f.base : f.front;
  if (!s) return;
  const [x, y] = S(ox, oy, wx, wy);
  b.draw(s.buf, Math.round(x - s.ax), Math.round(y - s.ay));
}

function scaleSheet(): void {
  const b = new PixelBuf(150, 96);
  const ox = 64;
  const oy = 34;
  floor(b, ox, oy, 3, 3);
  furn(b, 'desk', 'wood', ox, oy, 0, 0);
  furn(b, 'office_chair', 'blue', ox, oy, 8, 16);
  furn(b, 'office_chair', 'blue', ox, oy, 8, 16, 'front');
  const put = (look: Look, dir: ScreenDir, wx: number, wy: number) => {
    const [x, y] = S(ox, oy, wx, wy);
    const s = renderAvatar(look, dir, { pose: 'stand', frame: 0 });
    b.draw(s.buf, Math.round(x - s.ax), Math.round(y - s.ay));
  };
  // três pessoas no mesmo piso, ao lado dos móveis, para conferir a escala
  put(CAST[0], 'sw', 8, 40);
  put(CAST[1], 'sw', 24, 24);
  put(CAST[2], 'sw', 40, 8);
  save('escala', b);
}

// ------------------------------------------------------------ poses, itens, fantasias e catálogo

const HERO = makeLook({ skin: '#e6b48c', hair: 'side_part', hairColor: '#4a3020', top: 'shirt_tie', topColor: '#6f9ad8', accent: '#b8334a', bottom: 'slacks', bottomColor: '#35466e', shoes: 'dress', shoesColor: '#3a2a24', beard: 'stubble', lanyard: '#e0a030' });
const ALL_POSES = Object.keys(POSE_FRAMES) as Pose[];
const POSE_ITEM: Partial<Record<Pose, HeldItem>> = { drink: 'coffee', play: 'paddle', game: 'controller', rps: 'rock', groom: 'lipstick', read: 'book' };

function posesSheet(): void {
  const rows: PixelBuf[][] = [];
  for (const half of [ALL_POSES.slice(0, 10), ALL_POSES.slice(10)]) {
    for (const seated of [false, true]) {
      rows.push(half.map((p) => (seated && !isAvatarSeated(p, true) ? new PixelBuf(40, 64) : cell(HERO, 'sw', p, 1, { seated, held: POSE_ITEM[p] }))));
    }
  }
  save('poses', grid(rows, 1, BG), sc);
}

const ITEM_POSE: [HeldItem, Pose][] = [
  ['coffee', 'drink'], ['water', 'drink'], ['papers', 'read'], ['laptop', 'stand'], ['book', 'read'], ['box', 'stand'], ['paddle', 'play'], ['popcorn', 'wait'],
  ['controller', 'game'], ['rock', 'rps'], ['paper', 'rps'], ['scissors', 'rps'], ['phone', 'read'], ['lipstick', 'groom'], ['comb', 'groom'],
];

function itemsSheet(): void {
  const rows: PixelBuf[][] = [];
  for (const dirs of [['sw', 'ne'], ['s', 'n']] as ScreenDir[][]) {
    for (const part of [ITEM_POSE.slice(0, 8), ITEM_POSE.slice(8)]) {
      rows.push(part.flatMap(([it, pose]) => dirs.map((d) => cell(HERO, d, pose, 0, { held: it }).crop(4, 12, 32, 42))));
    }
  }
  save('itens', grid(rows, 1, BG), si >= 0 ? scale : 4);
}

function costumesSheet(): void {
  const rows = (['santa', 'witch', 'pumpkin', 'vampire'] as const).map((costume) => (['s', 'sw', 'w', 'nw', 'n'] as ScreenDir[]).map((d) => cell(HERO, d, 'stand', 0, { costume })));
  save('fantasias', grid(rows, 1, BG), sc);
}

function hairSheet(): void {
  const rows: PixelBuf[][] = [];
  for (const d of ['s', 'sw', 'n'] as ScreenDir[]) {
    for (let i = 0; i < HAIRS.length; i += 7) rows.push(HAIRS.slice(i, i + 7).map((h) => cell(makeLook({ skin: '#e6b48c', hair: h.id, hairColor: '#6b3f26', top: 'tee', topColor: '#6f9ad8' }), d, 'stand', 0)));
  }
  save('catalogo-cabelos', grid(rows, 1, BG), sc);
}

function clothesSheet(): void {
  const base = makeLook({ skin: '#e6b48c', hair: 'short', hairColor: '#4a3020' });
  const row = (list: readonly { id: string }[], key: keyof Look, dir: ScreenDir, over: Partial<Look> = {}) => list.map((o) => cell({ ...base, ...over, [key]: o.id } as Look, dir, 'stand', 0));
  const colored: Partial<Look> = { hatColor: '#d9a441', extraColor: '#c8453b' };
  const rows = [
    row(TOPS, 'top', 's', { topColor: '#4f86d0' }),
    row(TOPS, 'top', 'sw', { topColor: '#4f86d0' }),
    row(BOTTOMS, 'bottom', 's'),
    row(SHOES, 'shoes', 'sw', { shoesColor: '#8a4a3a' }),
    row(EXTRAS, 'extra', 's', colored),
    row(EXTRAS, 'extra', 'n', colored),
    row(HATS, 'hat', 's', colored),
    row(HATS, 'hat', 'sw', colored),
    row(GLASSES, 'glasses', 's'),
    row(BEARDS, 'beard', 's'),
    row(BEARDS, 'beard', 'sw'),
  ];
  save('catalogo-roupas', grid(rows, 1, BG), sc);
}

const SHEETS: Record<string, () => void> = { elenco: castSheet, andando: walkSheet, escala: scaleSheet, poses: posesSheet, itens: itemsSheet, fantasias: costumesSheet, cabelos: hairSheet, roupas: clothesSheet };
for (const [name, fn] of Object.entries(SHEETS)) if (!only || only === name) fn();
