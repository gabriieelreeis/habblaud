import { describe, expect, it } from 'vitest';
import { boxOrder, drawsBefore, fromIso, isoBounds, isoSort, isoX, isoY, type Box, type Sortable } from './iso';

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
const item = (name: string, b: Box, bias = 0): Sortable & { name: string } => ({ name, box: b, rect: isoBounds(b, 40), bias });

describe('projeção', () => {
  it('ida e volta no chão', () => {
    for (const [x, y] of [
      [0, 0],
      [16, 0],
      [37, 91],
      [-5, 12],
    ]) {
      const p = fromIso(isoX(x, y), isoY(x, y));
      expect(p.x).toBeCloseTo(x);
      expect(p.y).toBeCloseTo(y);
    }
  });

  it('um tile vira um losango 32x16', () => {
    const r = isoBounds(box(0, 0, 16, 16));
    expect(r).toEqual({ x: -16, y: 0, w: 32, h: 16 });
  });
});

describe('ordem', () => {
  const desk = box(32, 32, 64, 48);
  it('quem está ao sul da mesa fica na frente', () => {
    expect(boxOrder(box(40, 52, 48, 60), desk)).toBe(1);
  });
  it('quem está ao norte fica atrás', () => {
    expect(boxOrder(box(40, 20, 48, 28), desk)).toBe(-1);
  });
  it('a leste fica na frente, a oeste atrás', () => {
    expect(boxOrder(box(68, 36, 76, 44), desk)).toBe(1);
    expect(boxOrder(box(20, 36, 28, 44), desk)).toBe(-1);
  });
  it('ao norte da ponta leste de um sofá comprido fica atrás', () => {
    const sofa = box(0, 16, 48, 32);
    expect(boxOrder(box(36, 4, 44, 12), sofa)).toBe(-1);
  });
  it('caixas cruzadas desempatam pelo bias', () => {
    const seat = item('assento', box(0, 0, 16, 16));
    const back = item('encosto', box(0, 0, 16, 16), 1);
    const person = item('pessoa', box(4, 4, 12, 12), 0.5);
    expect(drawsBefore(seat, person)).toBe(true);
    expect(drawsBefore(person, back)).toBe(true);
  });
});

describe('isoSort', () => {
  it('desenha de trás para a frente quem se cruza', () => {
    const a = item('fundo', box(0, 0, 16, 16));
    const b = item('meio', box(16, 0, 32, 16));
    const c = item('frente', box(16, 16, 32, 32));
    const out = isoSort([c, a, b]).map((i) => i.name);
    expect(out.indexOf('fundo')).toBeLessThan(out.indexOf('meio'));
    expect(out.indexOf('meio')).toBeLessThan(out.indexOf('frente'));
  });

  it('respeita a separação mesmo quando o centro engana', () => {
    // estante comprida ao norte e vaso logo ao sul da ponta oeste: o vaso tem centro "mais raso" que a estante
    const shelf = item('estante', box(0, 0, 96, 16));
    const pot = item('vaso', box(0, 16, 16, 32));
    const out = isoSort([pot, shelf]).map((i) => i.name);
    expect(out).toEqual(['estante', 'vaso']);
  });
});
