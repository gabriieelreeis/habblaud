import { describe, expect, it } from 'vitest';
import { FURNITURE, type Dir, type FurnitureKind } from '../api';
import type { BufSprite } from '../core/sprite';
import { renderIsoFurniture } from './index';
import { isoSeatAnchor, isoSeatTop } from './seats';

/** Assentos, as direções em que a planta os usa e a variante de cada direção. */
const SEATS: { kind: FurnitureKind; dirs: Dir[]; variant?: (d: Dir) => string | undefined; back: boolean }[] = [
  { kind: 'office_chair', dirs: ['up'], variant: () => 'black', back: true },
  { kind: 'office_chair_front', dirs: ['down'], variant: () => 'blue', back: true },
  { kind: 'cafe_chair', dirs: ['up', 'down', 'left', 'right'], variant: (d) => d, back: true },
  { kind: 'armchair', dirs: ['up', 'down', 'left', 'right'], variant: (d) => d, back: true },
  { kind: 'sofa', dirs: ['up', 'down'], variant: (d) => d, back: true },
  { kind: 'bench', dirs: ['down'], back: true },
  { kind: 'beanbag', dirs: ['up', 'down'], variant: () => 'red', back: false },
  { kind: 'stool', dirs: ['up', 'down', 'left', 'right'], back: false },
];

const STEP: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** O sprite é opaco na projeção do ponto (x, y, z) local do móvel? */
function opaqueAt(sp: BufSprite | undefined, x: number, y: number, z: number): boolean {
  if (!sp) return false;
  return sp.buf.alpha(Math.floor(sp.ax + x - y), Math.floor(sp.ay + (x + y) / 2 - z)) > 0;
}

const cases = SEATS.flatMap((s) => s.dirs.map((d) => ({ ...s, dir: d, v: s.variant?.(d) })));

describe('quem senta: âncora do quadril', () => {
  it.each(cases.map((c) => [c.kind, c.dir, c] as const))('%s olhando %s: dentro do footprint, sobre a almofada', (_k, _d, c) => {
    const fp = FURNITURE[c.kind].footprint;
    const a = isoSeatAnchor(c.kind, c.v, c.dir);
    const f = renderIsoFurniture(c.kind, c.v, 0, 0, c.dir);
    const top = isoSeatTop(c.kind);
    // o quadril fica pouco acima do topo da almofada (cede sob o corpo); no pufe, bem mais baixo que numa cadeira
    expect(a.hipZ - top).toBeGreaterThanOrEqual(1);
    expect(a.hipZ - top).toBeLessThanOrEqual(2);
    if (c.kind === 'beanbag') expect(a.hipZ).toBeLessThan(9);
    for (let i = 0; i < fp.w; i++) {
      const x = i * 16 + 8 + a.dx;
      const y = 8 + a.dy;
      // cada lugar no próprio tile, longe das bordas
      expect(x).toBeGreaterThanOrEqual(i * 16 + 3);
      expect(x).toBeLessThanOrEqual(i * 16 + 13);
      expect(y).toBeGreaterThanOrEqual(3);
      expect(y).toBeLessThanOrEqual(fp.h * 16 - 3);
      // há assento embaixo do quadril
      expect(opaqueAt(f.base, x, y, top - 0.5)).toBe(true);
    }
  });
});

describe('quem senta: o que vai por cima (front)', () => {
  it.each(cases.filter((c) => c.back).map((c) => [c.kind, c.dir, c] as const))('%s olhando %s: encosto ao sul/leste no front, ao norte/oeste na base', (_k, _d, c) => {
    const f = renderIsoFurniture(c.kind, c.v, 0, 0, c.dir);
    const a = isoSeatAnchor(c.kind, c.v, c.dir);
    const [sx, sy] = STEP[c.dir];
    const z = isoSeatTop(c.kind) + 8;
    for (let i = 0; i < FURNITURE[c.kind].footprint.w; i++) {
      // ponto no encosto: atrás do quadril, acima da almofada
      const x = i * 16 + 8 + a.dx - sx * 6;
      const y = 8 + a.dy - sy * 6;
      if (c.dir === 'up' || c.dir === 'left') expect(opaqueAt(f.front, x, y, z)).toBe(true);
      else {
        expect(opaqueAt(f.base, x, y, z)).toBe(true);
        expect(opaqueAt(f.front, x, y, z)).toBe(false);
      }
    }
  });

  it.each(['up', 'down', 'left', 'right'] as const)('poltrona olhando %s: braço do lado leste ou sul no front, o outro na base', (d) => {
    const f = renderIsoFurniture('armchair', d, 0, 0, d);
    const a = isoSeatAnchor('armchair', d, d);
    const hx = 8 + a.dx;
    const hy = 8 + a.dy;
    // olhando para o norte ou para o sul, os braços ficam a leste e a oeste; senão, ao sul e ao norte
    const ns = d === 'up' || d === 'down';
    const near = ns ? [hx + 5.5, hy] : [hx, hy + 5.5];
    const far = ns ? [hx - 5.5, hy] : [hx, hy - 5.5];
    expect(opaqueAt(f.front, near[0], near[1], 14)).toBe(true);
    expect(opaqueAt(f.base, far[0], far[1], 14)).toBe(true);
    // olhando para a câmera, nada do braço de trás por cima do corpo
    if (d === 'down' || d === 'right') expect(opaqueAt(f.front, far[0], far[1], 14)).toBe(false);
  });

  it('sofá: o braço leste vai no front nas duas direções, o oeste fica na base', () => {
    for (const d of ['up', 'down'] as const) {
      const f = renderIsoFurniture('sofa', d, 0, 0, d);
      expect(opaqueAt(f.front, 45.5, 8, 15)).toBe(true);
      expect(opaqueAt(f.base, 2.5, 8, 15)).toBe(true);
    }
    expect(opaqueAt(renderIsoFurniture('sofa', 'down', 0, 0, 'down').front, 2.5, 8, 15)).toBe(false);
  });

  it('pufe: de costas, a borda da frente cobre o quadril; de frente, nada por cima das pernas', () => {
    const up = renderIsoFurniture('beanbag', 'red', 0, 0, 'up');
    const down = renderIsoFurniture('beanbag', 'red', 0, 0, 'down');
    const a = isoSeatAnchor('beanbag', 'red', 'up');
    expect(opaqueAt(up.front, 8, 8 + a.dy + 2, a.hipZ - 1)).toBe(true);
    expect(down.front).toBeUndefined();
    // vazio, a borda da frente não muda o desenho: os pixels dela são os do próprio pufe (fora a costura)
    let same = 0;
    let n = 0;
    for (let y = 0; y < up.front!.buf.h; y++)
      for (let x = 0; x < up.front!.buf.w; x++) {
        if (!up.front!.buf.alpha(x, y)) continue;
        n++;
        const i = (y * up.base.buf.w + x) * 4;
        const j = (y * up.front!.buf.w + x) * 4;
        if ([0, 1, 2].every((k) => up.base.buf.data[i + k] === up.front!.buf.data[j + k])) same++;
      }
    expect(same / n).toBeGreaterThan(0.75);
  });

  it('banqueta, banco e cadeira de frente para a câmera: tudo na base', () => {
    for (const d of ['up', 'down', 'left', 'right'] as const) expect(renderIsoFurniture('stool', undefined, 0, 0, d).front).toBeUndefined();
    expect(renderIsoFurniture('bench').front).toBeUndefined();
    expect(renderIsoFurniture('office_chair_front', 'blue').front).toBeUndefined();
  });
});
