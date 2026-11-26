// Prévia dos personagens isométricos em PNG, sem navegador: folhas por pose (linhas = direções, colunas = quadros),
// elenco, sentado na cadeira diante da mesa e comparação de escala com os móveis.
// Uso: npx tsx scripts/char-iso-preview.ts <pasta> [folha...] [--scale 3]
//   folhas: first | cast | scale | poses | pose:<nome> | items | looks | old  (sem nada: first cast scale)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { Appearance, CharacterFrameRequest, Dir, FurnitureKind, HeldItem, Pose } from '../client/src/art/api';
import { appearanceFromSeed } from '../client/src/art/character/appearance';
import { POSE_FRAMES, isSeated, renderCharacter } from '../client/src/art/character/render';
import { renderIsoCharacter } from '../client/src/art/character-iso/render';
import { PixelBuf } from '../client/src/art/core/pixbuf';
import { renderIsoFurniture } from '../client/src/art/iso/index';

const args = process.argv.slice(2);
const si = args.indexOf('--scale');
const scale = si >= 0 ? Number(args[si + 1]) : 3;
const rest = args.filter((_a, i) => !(si >= 0 && (i === si || i === si + 1)));
const out = rest[0] ?? '.';
const sheets = rest.slice(1).length ? rest.slice(1) : ['first', 'cast', 'scale'];
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
      const si2 = ((Math.floor(y / k) * b.w + Math.floor(x / k)) * 4) | 0;
      const di = y * (w * 4 + 1) + 1 + x * 4;
      raw[di] = b.data[si2];
      raw[di + 1] = b.data[si2 + 1];
      raw[di + 2] = b.data[si2 + 2];
      raw[di + 3] = b.data[si2 + 3];
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
  console.log(`${name}.png ${b.w}x${b.h}`);
}

// ------------------------------------------------------------ cena

const DIRS: Dir[] = ['down', 'right', 'up', 'left'];
const BG = '#efe9dd';

/** Piso de losangos 32x16: (ox, oy) é a posição de tela do ponto de mundo (0, 0). */
function floor(b: PixelBuf, ox: number, oy: number): void {
  for (let py = 0; py < b.h; py++) {
    for (let px = 0; px < b.w; px++) {
      const a = px + 0.5 - ox;
      const bb = 2 * (py + 0.5 - oy);
      const tx = Math.floor((bb + a) / 2 / 16);
      const ty = Math.floor((bb - a) / 2 / 16);
      b.set(px, py, (tx + ty) & 1 ? '#e4ddcf' : BG);
    }
  }
}

/** Tela de um ponto de mundo (x, y) a partir da origem (ox, oy). */
const S = (ox: number, oy: number, x: number, y: number): [number, number] => [ox + x - y, oy + (x + y) / 2];

function furn(b: PixelBuf, kind: FurnitureKind, variant: string | undefined, ox: number, oy: number, wx: number, wy: number, part: 'base' | 'front' = 'base', seed = 0): void {
  const f = renderIsoFurniture(kind, variant, 0, seed);
  const s = part === 'base' ? f.base : f.front;
  if (!s) return;
  const [x, y] = S(ox, oy, wx, wy);
  b.draw(s.buf, Math.round(x - s.ax), Math.round(y - s.ay));
}

function char(b: PixelBuf, req: CharacterFrameRequest, x: number, y: number): void {
  const s = renderIsoCharacter(req);
  b.draw(s.buf, Math.round(x - s.ax), Math.round(y - s.ay));
}

const CW = 34;
const CH = 54;

/** Célula com um personagem em pé sobre o piso (âncora em (17, 48)). */
function cell(req: CharacterFrameRequest): PixelBuf {
  const b = new PixelBuf(CW, CH);
  floor(b, 17, 48 - 8);
  char(b, req, 17, 48);
  return b;
}

/** Sentado na office_chair diante da desk (dir up) ou na office_chair_front atrás da desk_back (dir down). */
function deskScene(a: Appearance, dir: 'up' | 'down', pose: Pose, frame: number, extra: Partial<CharacterFrameRequest> = {}): PixelBuf {
  const b = new PixelBuf(76, 76);
  const ox = dir === 'up' ? 38 : 30;
  const oy = dir === 'up' ? 26 : 38;
  floor(b, ox, oy);
  const req: CharacterFrameRequest = { appearance: a, dir, pose, frame, ...extra };
  if (dir === 'up') {
    furn(b, 'desk', 'wood', ox, oy, 0, 0, 'base', 1);
    furn(b, 'office_chair', 'black', ox, oy, 8, 16);
    const [x, y] = S(ox, oy, 16, 24);
    char(b, req, x, y);
    furn(b, 'office_chair', 'black', ox, oy, 8, 16, 'front');
  } else {
    furn(b, 'office_chair_front', 'blue', ox, oy, 8, -16);
    const [x, y] = S(ox, oy, 16, -8);
    char(b, req, x, y);
    furn(b, 'desk_back', 'wood', ox, oy, 0, 0);
  }
  return b;
}

/** Sentado numa banqueta (qualquer direção). */
function stoolScene(a: Appearance, dir: Dir, pose: Pose, frame: number, extra: Partial<CharacterFrameRequest> = {}): PixelBuf {
  const b = new PixelBuf(40, 54);
  const ox = 20;
  const oy = 40;
  floor(b, ox, oy - 8);
  furn(b, 'stool', undefined, ox, oy - 8, 0, 0);
  char(b, { appearance: a, dir, pose, frame, ...extra }, ox, oy);
  return b;
}

/** Junta células em grade (linhas de alturas variadas). */
function grid(rows: PixelBuf[][], gap = 2, bg = '#d8d2c6'): PixelBuf {
  const W = Math.max(...rows.map((r) => r.reduce((s, c) => s + c.w + gap, gap)));
  const H = rows.reduce((s, r) => s + Math.max(...r.map((c) => c.h)) + gap, gap);
  const out2 = new PixelBuf(W, H);
  out2.rect(0, 0, W, H, bg);
  let y = gap;
  for (const r of rows) {
    let x = gap;
    for (const c of r) {
      out2.draw(c, x, y);
      x += c.w + gap;
    }
    y += Math.max(...r.map((c) => c.h)) + gap;
  }
  return out2;
}

function stack(cells: PixelBuf[], gap = 0): PixelBuf {
  return grid([cells], gap, BG);
}

function col(cells: PixelBuf[], gap = 0): PixelBuf {
  return grid(cells.map((c) => [c]), gap, BG);
}

// ------------------------------------------------------------ aparências

const LOOKS: { a: Appearance; costume?: CharacterFrameRequest['costume'] }[] = [
  { a: appearanceFromSeed(3, { look: 'f' }) },
  { a: appearanceFromSeed(11, { look: 'm' }) },
  { a: appearanceFromSeed(27, { look: 'f' }) },
  { a: appearanceFromSeed(42, { look: 'm' }) },
  { a: { ...appearanceFromSeed(58, { look: 'f' }), hairStyle: 'ponytail' } },
  { a: appearanceFromSeed(77, { look: 'm' }), costume: 'santa' },
];

function block(a: Appearance, costume?: CharacterFrameRequest['costume']): PixelBuf {
  const rows: PixelBuf[][] = DIRS.map((dir) => {
    const cs: PixelBuf[] = [];
    for (let f = 0; f < 2; f++) cs.push(cell({ appearance: a, dir, pose: 'stand', frame: f, costume }));
    for (let f = 0; f < 4; f++) cs.push(cell({ appearance: a, dir, pose: 'walk', frame: f, costume }));
    return cs;
  });
  const left = grid(rows, 0, BG);
  const right = col([deskScene(a, 'up', 'sit', 0, { costume }), deskScene(a, 'down', 'sit', 0, { costume })]);
  const st = col([stoolScene(a, 'right', 'sit', 0, { costume }), stoolScene(a, 'left', 'sit', 0, { costume }), stoolScene(a, 'up', 'sit', 1, { costume }), stoolScene(a, 'down', 'sit', 1, { costume })]);
  return grid([[left, right, st]], 2);
}

function first(): void {
  const blocks = LOOKS.map((l) => block(l.a, l.costume));
  save('first-a', grid([[blocks[0]], [blocks[1]], [blocks[2]]], 4));
  save('first-b', grid([[blocks[3]], [blocks[4]], [blocks[5]]], 4));
  // close-up de rostos (frente e costas) para conferir os detalhes
  const faces = LOOKS.map((l) => stack(DIRS.map((dir) => cell({ appearance: l.a, dir, pose: 'stand', frame: 0, costume: l.costume }))));
  save('first-zoom', grid(faces.map((f) => [f]), 2), 5);
  const seats = LOOKS.slice(0, 3).map((l) => [deskScene(l.a, 'up', 'sit', 0, { costume: l.costume }), deskScene(l.a, 'down', 'sit', 0, { costume: l.costume }), ...DIRS.map((d) => stoolScene(l.a, d, 'sit', 0, { costume: l.costume }))]);
  save('first-seat', grid(seats, 2), 4);
}

function cast(): void {
  const rows: PixelBuf[][] = [];
  for (let r = 0; r < 2; r++) {
    const cs: PixelBuf[] = [];
    for (let i = 0; i < 8; i++) {
      const seed = 100 + r * 8 + i;
      cs.push(cell({ appearance: appearanceFromSeed(seed * 7 + 1, { look: i % 2 ? 'm' : 'f' }), dir: r % 2 ? 'right' : 'down', pose: 'stand', frame: 0 }));
    }
    rows.push(cs);
  }
  for (let r = 0; r < 2; r++) {
    const cs: PixelBuf[] = [];
    for (let i = 0; i < 8; i++) {
      const seed = 100 + r * 8 + i;
      cs.push(cell({ appearance: appearanceFromSeed(seed * 7 + 1, { look: i % 2 ? 'm' : 'f' }), dir: r % 2 ? 'left' : 'up', pose: 'stand', frame: 0 }));
    }
    rows.push(cs);
  }
  save('cast', grid(rows, 1));
}

/** Escala: personagens ao lado da estante, da mesa e da cadeira. */
function scaleSheet(): void {
  const b = new PixelBuf(200, 110);
  const ox = 80;
  const oy = 30;
  floor(b, ox, oy);
  furn(b, 'bookshelf', undefined, ox, oy, 0, 0);
  furn(b, 'desk', 'white', ox, oy, 48, 0, 'base', 1);
  furn(b, 'office_chair', 'blue', ox, oy, 56, 16);
  const people = [
    { a: LOOKS[0].a, x: 16, y: 24, dir: 'down' as Dir },
    { a: LOOKS[1].a, x: 40, y: 24, dir: 'right' as Dir },
    { a: LOOKS[3].a, x: 24, y: 40, dir: 'up' as Dir },
  ];
  for (const p of people) {
    const [x, y] = S(ox, oy, p.x, p.y);
    char(b, { appearance: p.a, dir: p.dir, pose: 'stand', frame: 0 }, x, y);
  }
  const [cx, cy] = S(ox, oy, 64, 24);
  char(b, { appearance: LOOKS[2].a, dir: 'up', pose: 'type', frame: 0 }, cx, cy);
  furn(b, 'office_chair', 'blue', ox, oy, 56, 16, 'front');
  save('scale', b);
}

const POSES = Object.keys(POSE_FRAMES) as Pose[];
const DEFAULT_HELD: Partial<Record<Pose, HeldItem>> = { drink: 'coffee', read: 'book', play: 'paddle', game: 'controller', groom: 'comb' };

/** Folha de uma pose: 3 aparências lado a lado, linhas = direções, colunas = quadros. */
function poseSheet(pose: Pose, held?: HeldItem, seatedFlag?: boolean): PixelBuf {
  const n = POSE_FRAMES[pose];
  const looks = [LOOKS[0], LOOKS[1], LOOKS[4]];
  const h = held ?? DEFAULT_HELD[pose];
  const seated = isSeated(pose, seatedFlag);
  const blocks = looks.map((l) =>
    grid(
      DIRS.map((dir) => {
        const cs: PixelBuf[] = [];
        for (let f = 0; f < n; f++) {
          const req = { appearance: l.a, dir, pose, frame: f, held: h, seated: seatedFlag, costume: l.costume };
          cs.push(seated ? stoolScene(l.a, dir, pose, f, { held: h, seated: seatedFlag }) : cell(req));
        }
        return cs;
      }),
      0,
      BG,
    ),
  );
  const rows: PixelBuf[][] = [blocks];
  if (seated) {
    const sc: PixelBuf[] = [];
    for (let f = 0; f < Math.min(n, 2); f++) {
      sc.push(deskScene(looks[0].a, 'up', pose, f, { held: h }));
      sc.push(deskScene(looks[1].a, 'down', pose, f, { held: h }));
    }
    rows.push(sc);
  }
  return grid(rows, 3);
}

function poses(only?: string): void {
  const list = only ? [only as Pose] : POSES;
  for (const p of list) {
    save(`pose-${p}`, poseSheet(p));
    if (p === 'raise_hand' || p === 'talk' || p === 'read' || p === 'cheer' || p === 'laugh' || p === 'game' || p === 'sulk' || p === 'drink') save(`pose-${p}-seated`, poseSheet(p, undefined, true));
  }
  save('pose-wait-popcorn', poseSheet('wait', 'popcorn'));
  save('pose-read-phone', poseSheet('read', 'phone'));
  for (const g of ['rock', 'paper', 'scissors'] as const) save(`pose-rps-${g}`, poseSheet('rps', g));
  save('pose-groom-lipstick', poseSheet('groom', 'lipstick'));
}

/** Visão geral: todas as poses de uma aparência (frente e costas, quadros 0 e 1), em duas colunas de poses. */
function overview(idx = 1): void {
  const l = LOOKS[idx];
  const extra: [Pose, HeldItem | undefined, boolean | undefined][] = POSES.map((p) => [p, DEFAULT_HELD[p], undefined]);
  extra.push(['wait', 'popcorn', undefined], ['read', 'phone', undefined], ['rps', 'rock', undefined], ['rps', 'paper', undefined], ['rps', 'scissors', undefined], ['groom', 'lipstick', undefined], ['cheer', undefined, true], ['laugh', undefined, true], ['game', undefined, true], ['raise_hand', undefined, true], ['drink', 'water', true], ['read', 'papers', true]);
  const rowOf = ([pose, held, seatedFlag]: [Pose, HeldItem | undefined, boolean | undefined]) => {
    const seated = isSeated(pose, seatedFlag);
    const mk = (dir: Dir, f: number) => (seated ? stoolScene(l.a, dir, pose, f, { held, seated: seatedFlag }) : cell({ appearance: l.a, dir, pose, frame: f, held, seated: seatedFlag }));
    return [mk('down', 0), mk('down', 1), mk('right', 0), mk('up', 0), mk('up', 1), mk('left', 1)];
  };
  const half = Math.ceil(extra.length / 2);
  const a = grid(extra.slice(0, half).map(rowOf), 0, BG);
  const b = grid(extra.slice(half).map(rowOf), 0, BG);
  save(`overview-${idx}`, grid([[a, b]], 3), 2);
}

/** Itens na mão (em pé, andando) nas 4 direções. */
function items(): void {
  const list: HeldItem[] = ['coffee', 'water', 'papers', 'laptop', 'book', 'box', 'paddle', 'popcorn', 'controller', 'phone'];
  const rows = list.map((it) => DIRS.flatMap((dir) => [cell({ appearance: LOOKS[1].a, dir, pose: 'stand', frame: 0, held: it }), cell({ appearance: LOOKS[0].a, dir, pose: 'walk', frame: 1, held: it })]));
  save('items', grid(rows, 1));
}

/** Penteados, roupas, partes de baixo, acessórios, barbas, crachá e fantasias. */
function looks(): void {
  const base = appearanceFromSeed(5, { look: 'f' });
  const hairs = ['short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'pigtails', 'mohawk', 'bald', 'wavy'] as const;
  const hairRows = [hairs.slice(0, 7), hairs.slice(7)].map((hs) => hs.flatMap((h) => [cell({ appearance: { ...base, hairStyle: h }, dir: 'down', pose: 'stand', frame: 0 }), cell({ appearance: { ...base, hairStyle: h }, dir: 'up', pose: 'stand', frame: 0 })]));
  save('looks-hair', grid(hairRows, 1), 4);
  const tops = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'blouse', 'polo'] as const;
  const m = appearanceFromSeed(8, { look: 'm' });
  save('looks-tops', grid([tops.flatMap((t) => [cell({ appearance: { ...m, topStyle: t, lanyard: null }, dir: 'down', pose: 'stand', frame: 0 }), cell({ appearance: { ...m, topStyle: t, lanyard: null }, dir: 'up', pose: 'stand', frame: 0 })]), tops.flatMap((t) => [cell({ appearance: { ...m, topStyle: t, lanyard: '#3f7fd8' }, dir: 'down', pose: 'stand', frame: 0 }), cell({ appearance: { ...m, topStyle: t, lanyard: '#e05a5a' }, dir: 'right', pose: 'walk', frame: 0 })])], 1), 4);
  const accs = ['none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'earrings', 'bow'] as const;
  const facial = ['none', 'stubble', 'beard', 'mustache', 'goatee'] as const;
  const bottoms = ['pants', 'shorts', 'skirt'] as const;
  save('looks-acc', grid([accs.flatMap((ac) => [cell({ appearance: { ...base, accessory: ac }, dir: 'down', pose: 'stand', frame: 0 }), cell({ appearance: { ...base, accessory: ac }, dir: 'up', pose: 'stand', frame: 0 })]), [...facial.flatMap((fh) => [cell({ appearance: { ...m, facialHair: fh }, dir: 'down', pose: 'stand', frame: 0 })]), ...bottoms.flatMap((bs) => [cell({ appearance: { ...base, bottomStyle: bs }, dir: 'down', pose: 'walk', frame: 0 }), stoolScene({ ...base, bottomStyle: bs }, 'down', 'sit', 0)])]], 1), 4);
  const costumes = ['santa', 'witch', 'pumpkin', 'vampire'] as const;
  save('looks-costume', grid([costumes.flatMap((cst) => DIRS.map((d) => cell({ appearance: m, dir: d, pose: 'stand', frame: 0, costume: cst })))], 1), 4);
}

/** Personagens atuais (vista de cima) para comparar identidade. */
function old(): void {
  const rows = LOOKS.map((l) =>
    DIRS.map((dir) => {
      const s = renderCharacter({ appearance: l.a, dir, pose: 'stand', frame: 0, costume: l.costume });
      const b = new PixelBuf(28, 38);
      b.rect(0, 0, 28, 38, BG);
      b.draw(s.buf, 2, 2);
      return b;
    }).concat(DIRS.map((dir) => cell({ appearance: l.a, dir, pose: 'stand', frame: 0, costume: l.costume }))),
  );
  save('old-vs-new', grid(rows, 1), 4);
}

for (const s of sheets) {
  if (s === 'first') first();
  else if (s === 'cast') cast();
  else if (s === 'scale') scaleSheet();
  else if (s === 'poses') poses();
  else if (s.startsWith('pose:')) poses(s.slice(5));
  else if (s === 'items') items();
  else if (s === 'looks') looks();
  else if (s === 'old') old();
  else if (s.startsWith('zoom:')) {
    // zoom:<pose>[:held[:seated]] — uma aparência, 4 direções x quadros, ampliado
    const [, pose, held, st] = s.split(':');
    const n = POSE_FRAMES[pose as Pose];
    const seatedFlag = st === 'seated' ? true : undefined;
    const rows = [LOOKS[1], LOOKS[0]].map((l) =>
      DIRS.flatMap((dir) => Array.from({ length: n }, (_x, f) => (isSeated(pose as Pose, seatedFlag) ? stoolScene(l.a, dir, pose as Pose, f, { held: (held || undefined) as HeldItem | undefined, seated: seatedFlag }) : cell({ appearance: l.a, dir, pose: pose as Pose, frame: f, held: (held || undefined) as HeldItem | undefined, seated: seatedFlag })))),
    );
    save(`zoom-${pose}${held ? '-' + held : ''}${st ? '-' + st : ''}`, grid(rows, 1), 5);
  } else if (s.startsWith('overview')) overview(Number(s.split(':')[1] ?? 1));
  else console.log(`folha desconhecida: ${s}`);
}
