import { describe, expect, it } from 'vitest';
import { FURNITURE, type FurnitureKind } from '../api';
import { renderIsoCar } from './car';
import { renderTallElevator } from './elevator';
import { renderIsoFurniture } from './index';
import { Iso } from './kit';
import { renderIsoWall, renderLowWall } from './walls';

const floorKinds = (Object.keys(FURNITURE) as FurnitureKind[]).filter((k) => FURNITURE[k].mount === 'floor');

describe('kit isométrico', () => {
  it('um tile 1x1 sem altura vira um losango de 32x16', () => {
    const s = new Iso(1, 1, 0, 0);
    s.top(0, 0, 16, 16, 0, '#ff0000');
    const b = s.buf.bounds()!;
    expect(b.w).toBe(32);
    expect(b.h).toBe(16);
  });

  it('caixa: faces sul e leste e topo sem buracos na aresta', () => {
    const s = new Iso(1, 1, 20, 2);
    s.box(0, 0, 0, 16, 16, 10, { top: '#ff0000', south: '#00ff00', east: '#0000ff' });
    // coluna do meio (a aresta da frente): tudo pintado do topo até a base
    const x = s.sx(16, 16);
    let gaps = 0;
    for (let y = s.sy(16, 16, 10) + 1; y < s.sy(16, 16, 0) - 1; y++) if (!s.buf.alpha(Math.floor(x) - 1, Math.floor(y))) gaps++;
    expect(gaps).toBe(0);
  });
});

describe('móveis isométricos', () => {
  it.each(floorKinds)('%s: todas as variantes e estados desenham, com a âncora dentro da folha', (kind) => {
    const def = FURNITURE[kind];
    for (const v of def.variants ?? [undefined]) {
      for (let st = 0; st < (def.states ?? 1); st++) {
        const f = renderIsoFurniture(kind, v, st, 0);
        expect(f.base.buf.countOpaque()).toBeGreaterThan(20);
        expect(f.base.ax).toBeGreaterThanOrEqual(0);
        expect(f.base.ax).toBeLessThanOrEqual(f.base.buf.w);
        expect(f.base.ay).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('encostos ao sul e ao leste ficam no front (desenhados por cima de quem senta)', () => {
    expect(renderIsoFurniture('office_chair').front).toBeDefined();
    expect(renderIsoFurniture('office_chair_front').front).toBeUndefined();
    expect(renderIsoFurniture('sofa', 'up').front).toBeDefined();
    expect(renderIsoFurniture('sofa', 'down').front).toBeUndefined();
    expect(renderIsoFurniture('toilet_stall', undefined, 1).front).toBeDefined();
  });

  it('a mesa expõe a tela inclinada na face sul', () => {
    const r = renderIsoFurniture('desk', 'wood', 0, 0).base.rects?.screen;
    expect(r).toBeDefined();
    expect(r!.skew).toBe(0.5);
    expect(r!.w).toBeGreaterThan(6);
  });
});

describe('paredes, elevador e carros', () => {
  const style = { base: '#eef1f4', trim: '#9fb0c4', pattern: 'brick' as const };

  it('o vão da porta fica vazado até a altura da porta', () => {
    const s = renderIsoWall(style, { facing: 'south', length: 64, height: 64, thickness: 4, doorways: [[16, 48]] });
    const full = renderIsoWall(style, { facing: 'south', length: 64, height: 64, thickness: 4 });
    expect(s.buf.countOpaque()).toBeLessThan(full.buf.countOpaque() - 32 * 40);
  });

  it('mureta baixa e parede voltada para leste desenham', () => {
    expect(renderLowWall(style, { along: 'y', length: 48, height: 10, thickness: 4 }).buf.countOpaque()).toBeGreaterThan(100);
    expect(renderIsoWall(style, { facing: 'east', length: 48, height: 64, thickness: 8 }).buf.countOpaque()).toBeGreaterThan(1000);
  });

  it('elevador abre em 5 estados e carros nas duas direções', () => {
    const closed = renderTallElevator(0);
    const open = renderTallElevator(4);
    expect(closed.buf.h).toBeGreaterThan(56);
    expect(closed.buf.countOpaque()).toBeGreaterThan(0);
    expect(open.buf.countOpaque()).toBeGreaterThan(0);
    for (const dir of [1, -1] as const) expect(renderIsoCar(3, dir).buf.countOpaque()).toBeGreaterThan(100);
  });
});
