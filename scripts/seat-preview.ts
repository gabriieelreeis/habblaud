// Prévia em PNG, sem navegador, de quem senta (base, personagem na âncora do assento e front por cima), das costas dos
// móveis de parede (ao lado da frente) e da cabine do banheiro nos 2 estados e 4 direções.
// Uso: npx tsx scripts/seat-preview.ts <pasta> [folha...] [--scale 4]
//   folhas: seats | backs | stall | corner | zoom:<kind>[,<kind>...] | seat:<kind>:<dir>[:variante]
//   (sem nada: as quatro primeiras)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { FURNITURE, type Appearance, type CharacterFrameRequest, type Dir, type FurnitureKind, type Pose } from '../client/src/art/api';
import { appearanceFromSeed } from '../client/src/art/character/appearance';
import { lookFromAppearance } from '../client/src/art/avatar/from-appearance';
import { AVATAR_SEAT_HIP_Z, renderAvatar, type ScreenDir } from '../client/src/art/avatar/render';
import { PixelBuf } from '../client/src/art/core/pixbuf';
import type { BufSprite } from '../client/src/art/core/sprite';
import { renderIsoFurniture } from '../client/src/art/iso/index';
import { isoSeatAnchor } from '../client/src/art/iso/seats';

/** A diagonal da tela de cada direção do mundo (como no jogo). */
const VIEW: Readonly<Record<Dir, ScreenDir>> = { down: 'sw', right: 'se', up: 'ne', left: 'nw' };
const args = process.argv.slice(2);
const si = args.indexOf('--scale');
const scale = si >= 0 ? Number(args[si + 1]) : 4;
const rest = args.filter((_a, i) => !(si >= 0 && (i === si || i === si + 1)));
const out = rest[0] ?? '.';
const sheets = rest.slice(1).length ? rest.slice(1) : ['seats', 'backs', 'stall', 'corner'];
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------ PNG (o mesmo de iso-preview.ts)

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

/** Piso de losangos 32x16; (ox, oy) é a tela do ponto de mundo (0, 0); o retângulo [0,w)x[0,h) em tiles fica mais escuro. */
function floor(b: PixelBuf, ox: number, oy: number, wt: number, ht: number): void {
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

const blit = (b: PixelBuf, s: BufSprite, x: number, y: number): void => b.draw(s.buf, Math.round(x - s.ax), Math.round(y - s.ay));

/** Pinta por cima, em magenta translúcido, os pixels opacos de um sprite (para ver o que é front). */
function tint(b: PixelBuf, s: BufSprite, x: number, y: number): void {
  const dx = Math.round(x - s.ax);
  const dy = Math.round(y - s.ay);
  for (let yy = 0; yy < s.buf.h; yy++) for (let xx = 0; xx < s.buf.w; xx++) if (s.buf.alpha(xx, yy) > 0) b.set(dx + xx, dy + yy, 'rgba(255,0,200,0.45)');
}

interface Sitter {
  a: Appearance;
  costume?: CharacterFrameRequest['costume'];
  pose?: Pose;
  frame?: number;
}

interface CellOpts {
  variant?: string;
  state?: number;
  seed?: number;
  /** Direção de quem senta (assentos) ou para onde o móvel aponta (móveis de parede). */
  dir: Dir;
  /** Uma pessoa por tile do assento (sofá e banco: até 3 e 2). */
  people?: Sitter[];
  /** Pinta o front de magenta. */
  showFront?: boolean;
  up?: number;
}

/** Um móvel sobre o piso, com quem senta e o front por cima. */
function cell(kind: FurnitureKind, o: CellOpts): PixelBuf {
  const fp = FURNITURE[kind].footprint;
  const W = fp.w * 16;
  const H = fp.h * 16;
  const pad = 12;
  const up = o.up ?? 58;
  const b = new PixelBuf(W + H + pad * 2, up + (W + H) / 2 + 14);
  const ax = pad + H;
  const ay = up;
  floor(b, ax, ay, fp.w, fp.h);
  const seat = !!FURNITURE[kind].seat;
  const f = renderIsoFurniture(kind, o.variant, o.state ?? 0, o.seed ?? 0, o.dir);
  blit(b, f.base, ax, ay);
  if (seat && o.people) {
    const an = isoSeatAnchor(kind, o.variant, o.dir);
    const spots: { x: number; y: number; p: Sitter }[] = [];
    o.people.slice(0, fp.w).forEach((p, i) => spots.push({ x: i * 16 + 8 + an.dx, y: 8 + an.dy, p }));
    spots.sort((p, q) => p.x + p.y - (q.x + q.y));
    for (const s of spots) {
      const c = renderAvatar(lookFromAppearance(s.p.a), VIEW[o.dir], { pose: s.p.pose ?? 'sit', frame: s.p.frame ?? 0, seated: true, costume: s.p.costume });
      blit(b, c, ax + s.x - s.y, ay + (s.x + s.y) / 2 - (an.hipZ - 1.5 - AVATAR_SEAT_HIP_Z));
    }
  }
  if (f.front) {
    blit(b, f.front, ax, ay);
    if (o.showFront) tint(b, f.front, ax, ay);
  }
  return b;
}

/** Junta células em grade. */
function grid(rows: PixelBuf[][], gap = 2, bg = '#cfc8ba'): PixelBuf {
  const W = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.w + gap, gap)));
  const H = rows.reduce((s, r) => s + Math.max(...r.map((c) => c.h)) + gap, gap);
  const g = new PixelBuf(W, H);
  g.rect(0, 0, W, H, bg);
  let y = gap;
  for (const r of rows) {
    let x = gap;
    for (const c of r) {
      g.draw(c, x, y);
      x += c.w + gap;
    }
    y += Math.max(...r.map((c) => c.h)) + gap;
  }
  return g;
}

// ------------------------------------------------------------ folhas

const LOOKS: Sitter[] = [
  { a: appearanceFromSeed(11, { look: 'm' }) },
  { a: { ...appearanceFromSeed(58, { look: 'f' }), hairStyle: 'ponytail', bottomStyle: 'skirt' } },
  { a: appearanceFromSeed(77, { look: 'm' }), costume: 'santa' },
];

/** Assentos e as direções em que a planta usa cada um. */
const SEATS: { kind: FurnitureKind; variant?: (d: Dir) => string | undefined; dirs: Dir[] }[] = [
  { kind: 'office_chair', variant: () => 'black', dirs: ['up'] },
  { kind: 'office_chair_front', variant: () => 'blue', dirs: ['down'] },
  { kind: 'cafe_chair', variant: (d) => d, dirs: ['down', 'right', 'up', 'left'] },
  { kind: 'armchair', variant: (d) => d, dirs: ['down', 'right', 'up', 'left'] },
  { kind: 'sofa', variant: (d) => d, dirs: ['up', 'down'] },
  { kind: 'bench', dirs: ['down'] },
  { kind: 'beanbag', variant: () => 'red', dirs: ['up', 'down'] },
  { kind: 'stool', dirs: ['down', 'right', 'up', 'left'] },
];

function seatsSheets(): void {
  for (const s of SEATS) {
    const multi = FURNITURE[s.kind].footprint.w > 1;
    const rows = s.dirs.map((d) => {
      const v = s.variant?.(d);
      const cs = [cell(s.kind, { dir: d, variant: v, showFront: true }), cell(s.kind, { dir: d, variant: v })];
      if (multi) cs.push(cell(s.kind, { dir: d, variant: v, people: LOOKS }), cell(s.kind, { dir: d, variant: v, people: [LOOKS[2], LOOKS[0], LOOKS[1]] }));
      else for (const p of LOOKS) cs.push(cell(s.kind, { dir: d, variant: v, people: [p] }));
      return cs;
    });
    save(`seat-${s.kind}`, grid(rows));
  }
}

const BACK_KINDS: FurnitureKind[][] = [
  ['bookshelf', 'binder_shelf', 'filing_cabinet', 'printer', 'water_cooler'],
  ['fridge', 'vending_machine', 'counter', 'counter_sink'],
  ['coffee_machine', 'microwave', 'sink', 'arcade'],
];

function backsSheets(): void {
  BACK_KINDS.forEach((kinds, i) => {
    const rows = kinds.map((k) => (['down', 'right', 'up', 'left'] as Dir[]).map((d) => cell(k, { dir: d, variant: k === 'counter' ? 'drawers' : undefined, state: k === 'coffee_machine' ? 1 : 0, up: 72 })));
    save(`backs-${i + 1}`, grid(rows));
  });
}

function stallSheet(): void {
  const rows = [0, 1].map((st) => (['down', 'right', 'up', 'left'] as Dir[]).map((d) => cell('toilet_stall', { dir: d, state: st, up: 72 })));
  const fronts = [0, 1].map((st) => (['down', 'right', 'up', 'left'] as Dir[]).map((d) => cell('toilet_stall', { dir: d, state: st, up: 72, showFront: true })));
  save('stall', grid([...rows, ...fronts]));
}

/** O canto de impressão na parede sul (de costas) e a coluna da parede leste, como nas salas. */
function cornerSheet(): void {
  const WT = 7;
  const HT = 5;
  const pad = 16;
  const up = 72;
  const b = new PixelBuf((WT + HT) * 16 + pad * 2, up + (WT + HT) * 8 + 16);
  const ox = pad + HT * 16;
  const oy = up;
  floor(b, ox, oy, WT, HT);
  const items: { kind: FurnitureKind; tx: number; ty: number; dir: Dir; seed?: number }[] = [
    { kind: 'binder_shelf', tx: 6, ty: 0, dir: 'left', seed: 1 },
    { kind: 'printer', tx: 6, ty: 1, dir: 'left' },
    { kind: 'water_cooler', tx: 6, ty: 2, dir: 'left' },
    { kind: 'printer', tx: 0, ty: 4, dir: 'up' },
    { kind: 'binder_shelf', tx: 1, ty: 4, dir: 'up', seed: 0 },
    { kind: 'binder_shelf', tx: 2, ty: 4, dir: 'up', seed: 2 },
    { kind: 'filing_cabinet', tx: 3, ty: 4, dir: 'up' },
    { kind: 'trash_bin', tx: 4, ty: 4, dir: 'down' },
    { kind: 'water_cooler', tx: 5, ty: 4, dir: 'up' },
  ];
  items.sort((p, q) => p.tx + p.ty - (q.tx + q.ty) || p.ty - q.ty);
  const person = { x: 3 * 16 + 8, y: 2 * 16 + 8 };
  let drawn = false;
  for (const it of items) {
    if (!drawn && it.ty >= 4) {
      blit(b, renderAvatar(lookFromAppearance(LOOKS[0].a), 'sw', { pose: 'stand', frame: 0 }), ox + person.x - person.y, oy + (person.x + person.y) / 2);
      drawn = true;
    }
    const f = renderIsoFurniture(it.kind, undefined, 0, it.seed ?? 0, it.dir);
    const x = it.tx * 16;
    const y = it.ty * 16;
    blit(b, f.base, ox + x - y, oy + (x + y) / 2);
    if (f.front) blit(b, f.front, ox + x - y, oy + (x + y) / 2);
  }
  save('corner', b);
}

/** Frente e costas de alguns kinds, maiores: zoom:<kind>[,<kind>...] */
function zoomSheet(list: string): void {
  const kinds = list.split(',') as FurnitureKind[];
  const rows = kinds.map((k) => (['down', 'up', 'left'] as Dir[]).map((d) => cell(k, { dir: d, up: 72 })));
  save(`zoom-${kinds.join('-')}`, grid(rows), 6);
}

/** Um assento numa direção, maior, com as 3 aparências: seat:<kind>:<dir>[:variante] */
function seatZoom(spec: string): void {
  const [kind, dir, variant] = spec.split(':') as [FurnitureKind, Dir, string | undefined];
  const v = variant ?? (kind === 'cafe_chair' || kind === 'armchair' || kind === 'sofa' ? dir : undefined);
  const multi = FURNITURE[kind].footprint.w > 1;
  const cs = [cell(kind, { dir, variant: v, showFront: true }), cell(kind, { dir, variant: v })];
  if (multi) cs.push(cell(kind, { dir, variant: v, people: LOOKS }));
  else for (const p of LOOKS) cs.push(cell(kind, { dir, variant: v, people: [p] }));
  save(`zoom-${kind}-${dir}`, grid([cs]), 7);
}

for (const s of sheets) {
  if (s === 'seats') seatsSheets();
  else if (s.startsWith('seat:')) seatZoom(s.slice(5));
  else if (s.startsWith('zoom:')) zoomSheet(s.slice(5));
  else if (s === 'backs') backsSheets();
  else if (s === 'stall') stallSheet();
  else if (s === 'corner') cornerSheet();
  else console.log(`folha desconhecida: ${s}`);
}
