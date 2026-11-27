// Camadas de desenho do lado de fora: partição dos props (sem canvas).
import { describe, expect, it } from 'vitest';
import { isStaticProp, layerProps } from './furn-layer';

describe('props estáticos', () => {
  it('árvore, cerca e flores soltas são estáticas; poste, banco, totem, calçamento e props de sala não', () => {
    for (const kind of ['tree', 'hedge', 'flowers'] as const) expect(isStaticProp({ kind })).toBe(true);
    for (const kind of ['lamp', 'bench', 'totem', 'paving'] as const) expect(isStaticProp({ kind })).toBe(false);
    expect(isStaticProp({ kind: 'hedge', whenRoom: 0 })).toBe(false);
  });
});

describe('layerProps', () => {
  it('estático que cruza um dinâmico fica fora das camadas', () => {
    const rects = new Map<object, { x: number; y: number; w: number; h: number }>();
    const mk = (kind: 'hedge' | 'lamp' | 'tree', x: number) => {
      const p = { kind };
      rects.set(p, { x, y: 0, w: 10, h: 10 });
      return p;
    };
    const hedgeNear = mk('hedge', 5);
    const hedgeFar = mk('hedge', 50);
    const tree = mk('tree', 100);
    const lamp = mk('lamp', 0);
    const set = layerProps([hedgeNear, hedgeFar, tree, lamp], (p) => rects.get(p)!);
    expect([...set]).toEqual([hedgeFar, tree]);
  });
});
