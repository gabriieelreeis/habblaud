import { describe, expect, it } from 'vitest';
import { FURNITURE, type Dir, type FurnitureKind } from '../api';
import { PixelBuf } from '../core/pixbuf';
import type { BufFurniture } from '../core/sprite';
import { ISO_BACK_KINDS, renderIsoFurniture } from './index';

/** Base e front juntos numa folha, com a âncora em (ox, oy). */
function compose(f: BufFurniture): { buf: PixelBuf; ox: number; oy: number } {
  const ox = 90;
  const oy = 100;
  const buf = new PixelBuf(180, 150);
  buf.draw(f.base.buf, ox - f.base.ax, oy - f.base.ay);
  if (f.front) buf.draw(f.front.buf, ox - f.front.ax, oy - f.front.ay);
  return { buf, ox, oy };
}

/** Cores opacas distintas. */
function colors(b: PixelBuf): number {
  const set = new Set<number>();
  for (let i = 0; i < b.data.length; i += 4) if (b.data[i + 3] === 255) set.add((b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2]);
  return set.size;
}

const render = (k: FurnitureKind, d: Dir, st = 0): BufFurniture => renderIsoFurniture(k, FURNITURE[k].variants?.[0], st, 0, d);

describe('costas dos móveis de parede', () => {
  it('todos os móveis de parede da planta têm costas próprias', () => {
    for (const k of ['bookshelf', 'binder_shelf', 'filing_cabinet', 'printer', 'water_cooler', 'fridge', 'vending_machine', 'counter', 'counter_sink', 'coffee_machine', 'microwave', 'sink', 'arcade', 'toilet_stall'] as const)
      expect(ISO_BACK_KINDS).toContain(k);
  });

  it.each(ISO_BACK_KINDS)('%s: costas cheias, do tamanho da frente e com detalhe (não uma caixa lisa)', (k) => {
    const front = compose(render(k, 'down'));
    const back = compose(render(k, 'up'));
    const fb = front.buf.bounds()!;
    const bb = back.buf.bounds()!;
    expect(back.buf.countOpaque()).toBeGreaterThan(200);
    // mesma silhueta aproximada: largura, altura e o alto do desenho em relação à âncora (na cabine, as divisórias altas
    // de trás vêm para a frente e o desenho fica 8 px mais baixo na tela)
    expect(Math.abs(bb.w - fb.w)).toBeLessThanOrEqual(4);
    expect(Math.abs(bb.h - fb.h)).toBeLessThanOrEqual(8);
    expect(Math.abs(bb.y - fb.y)).toBeLessThanOrEqual(8);
    // várias cores: a caixa lisa de antes tinha 10
    expect(colors(back.buf)).toBeGreaterThanOrEqual(13);
    // e não é a frente espelhada
    const mirrored = compose(render(k, 'right'));
    let diff = 0;
    for (let i = 0; i < back.buf.data.length; i += 4) if (back.buf.data[i + 3] !== mirrored.buf.data[i + 3] || back.buf.data[i] !== mirrored.buf.data[i]) diff++;
    expect(diff).toBeGreaterThan(40);
  });

  it.each(ISO_BACK_KINDS)('%s: para o oeste, o espelho das costas', (k) => {
    const up = render(k, 'up');
    const left = render(k, 'left');
    expect(left.base.buf.w).toBe(up.base.buf.w);
    expect(left.base.ax).toBe(up.base.buf.w - up.base.ax);
  });

  it('o galão azul do bebedouro aparece por cima nas costas', () => {
    const { buf, oy } = compose(render('water_cooler', 'up'));
    let blue = 0;
    for (let y = 0; y < oy - 20; y++)
      for (let x = 0; x < buf.w; x++) {
        const i = (y * buf.w + x) * 4;
        const [r, g, b, a] = [buf.data[i], buf.data[i + 1], buf.data[i + 2], buf.data[i + 3]];
        if (a && b > r + 40 && b > g) blue++;
      }
    expect(blue).toBeGreaterThan(40);
  });

  it('estante de pastas por trás: as cores das pastas aparecem', () => {
    const { buf } = compose(render('binder_shelf', 'up'));
    let vivid = 0;
    for (let i = 0; i < buf.data.length; i += 4) {
      const [r, g, b] = [buf.data[i], buf.data[i + 1], buf.data[i + 2]];
      if (buf.data[i + 3] && Math.max(r, g, b) - Math.min(r, g, b) > 80) vivid++;
    }
    expect(vivid).toBeGreaterThan(60);
  });
});

describe('cabine do banheiro', () => {
  it('livre e ocupada só diferem no indicador da porta (verde e vermelho), com a porta fechada', () => {
    const free = render('toilet_stall', 'down', 0);
    const busy = render('toilet_stall', 'down', 1);
    expect(free.base.buf.data).toEqual(busy.base.buf.data);
    expect(free.front!.buf.w).toBe(busy.front!.buf.w);
    expect(free.front!.buf.h).toBe(busy.front!.buf.h);
    const a = free.front!.buf;
    const b = busy.front!.buf;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let y = 0; y < a.h; y++)
      for (let x = 0; x < a.w; x++) {
        const i = (y * a.w + x) * 4;
        if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] && a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue;
        xs.push(x);
        ys.push(y);
        expect(a.data[i + 1]).toBeGreaterThan(a.data[i]);
        expect(b.data[i]).toBeGreaterThan(b.data[i + 1]);
      }
    expect(xs.length).toBeGreaterThan(3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(4);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(6);
  });

  it('nas 4 direções: de frente, espelho, costas e espelho das costas', () => {
    for (const st of [0, 1]) {
      const down = render('toilet_stall', 'down', st);
      const up = render('toilet_stall', 'up', st);
      expect(up.front).toBeDefined();
      expect(colors(compose(up).buf)).toBeGreaterThanOrEqual(13);
      expect(render('toilet_stall', 'right', st).base.ax).toBe(down.base.buf.w - down.base.ax);
      expect(render('toilet_stall', 'left', st).base.ax).toBe(up.base.buf.w - up.base.ax);
    }
  });
});
