// Despacho dos móveis isométricos por kind (puro). Kinds ainda sem desenho próprio saem como uma caixa neutra do
// tamanho do footprint, para o mundo nunca ficar sem o móvel.
import { FURNITURE, type Dir, type FurnitureKind, type Rect } from '../api';
import type { BufFurniture, BufSprite, Rects } from '../core/sprite';
import { normalizeFurniture } from '../furniture/index';
import { M } from '../furniture/kit';
import { Iso, tone } from './kit';
import { cafeKinds } from './cafe';
import { loungeKinds } from './lounge';
import * as O from './office';
import { officeMore } from './office2';

/** Altura aproximada (px) de cada móvel de chão: usada pela caixa provisória e pelo mundo (luz, cliques). */
export const ISO_HEIGHT: Partial<Record<FurnitureKind, number>> = {
  desk: 36,
  desk_back: 36,
  office_chair: 26,
  office_chair_front: 26,
  bookshelf: 52,
  filing_cabinet: 22,
  printer: 22,
  trash_bin: 9,
  plant_small: 16,
  plant_tall: 40,
  glass_partition: 34,
  binder_shelf: 52,
  meeting_table: 18,
  stool: 12,
  floor_lamp: 46,
  water_cooler: 34,
  counter: 20,
  counter_sink: 20,
  coffee_machine: 30,
  microwave: 28,
  fridge: 52,
  vending_machine: 54,
  cafe_table: 17,
  cafe_chair: 22,
  sofa: 20,
  armchair: 20,
  coffee_table: 10,
  pingpong_table: 17,
  beanbag: 12,
  arcade: 50,
  toilet_stall: 50,
  sink: 22,
  reception_desk: 22,
  bench: 12,
};

function placeholder(kind: FurnitureKind): BufFurniture {
  const fp = FURNITURE[kind].footprint;
  const h = ISO_HEIGHT[kind] ?? 16;
  const s = new Iso(fp.w, fp.h, h + 8);
  s.shadow(1, 1, fp.w * 16 - 1, fp.h * 16 - 1, 0.2);
  s.box(2, 2, 0, fp.w * 16 - 2, fp.h * 16 - 2, h, M.plastic);
  return { base: s.finish() };
}

function build(kind: FurnitureKind, variant: string | undefined, state: number, seed: number): BufFurniture | null {
  switch (kind) {
    case 'desk':
      return O.desk(variant, seed);
    case 'desk_back':
      return O.deskBack(variant, seed);
    case 'office_chair':
      return O.officeChair(variant);
    case 'office_chair_front':
      return O.officeChairFront(variant);
    case 'bookshelf':
      return O.bookshelf(seed);
    case 'plant_tall':
      return O.plantTall(variant, seed);
    default:
      return officeMore(kind, variant, state, seed) ?? cafeKinds(kind, variant, state, seed) ?? loungeKinds(kind, variant, state, seed);
  }
}

/** Material das costas (cor e altura) dos móveis que podem ficar de costas para a câmera. */
const BACKS: Partial<Record<FurnitureKind, { color: string; top?: string; inset?: number }>> = {
  bookshelf: { color: '#c79f72', top: '#d9b88e', inset: 2 },
  binder_shelf: { color: '#dddcd6', top: '#ecebe6', inset: 2 },
  filing_cabinet: { color: '#a9b0bb', top: '#c4cad3', inset: 2 },
  printer: { color: '#d9dbe0', top: '#7d8592', inset: 2 },
  water_cooler: { color: '#e4e6ea', top: '#9fd0f2', inset: 4 },
  fridge: { color: '#e3e5e8', top: '#f0f1f3', inset: 2 },
  vending_machine: { color: '#b84a4a', top: '#cf6a6a', inset: 2 },
  counter: { color: '#d8d6d0', top: '#eceae4', inset: 0 },
  counter_sink: { color: '#d8d6d0', top: '#eceae4', inset: 0 },
  coffee_machine: { color: '#d8d6d0', top: '#474d5c', inset: 0 },
  microwave: { color: '#d8d6d0', top: '#e9e8e4', inset: 0 },
  sink: { color: '#e4e2dc', top: '#f2f1ec', inset: 1 },
  arcade: { color: '#2d3550', top: '#f2c14e', inset: 2 },
  toilet_stall: { color: '#c9ced6', top: '#dfe3e8', inset: 0 },
};

/** Costas lisas de um móvel (para quando ele está de frente para a parede do fundo ou para a esquerda). */
function backView(kind: FurnitureKind): BufFurniture {
  const fp = FURNITURE[kind].footprint;
  const h = ISO_HEIGHT[kind] ?? 16;
  const b = BACKS[kind] ?? { color: '#d9dbe0' };
  const i = b.inset ?? 2;
  const s = new Iso(fp.w, fp.h, h + 8);
  const W = fp.w * 16;
  const D = fp.h * 16;
  s.shadow(i, i, W - i, D - i, 0.2);
  const m = tone(b.color, 0.06);
  s.box(i, i, 0, W - i, D - i, h, {
    top: b.top ?? m.lt,
    // painel de costas: emendas verticais e um rodapé escuro
    south: (u, v, w, hh) => (hh - v < 2 ? m.dk : Math.floor(u) % 16 === 15 ? m.dk : v < 1 ? m.lt : m.base),
    east: (u, v, w, hh) => (hh - v < 2 ? m.dd : Math.floor(u) % 16 === 15 ? m.dd : m.dk),
  });
  return { base: s.finish() };
}

/** Espelha um sprite na horizontal: no plano isométrico, troca x por y (vira de frente para o leste). */
function mirror(f: BufFurniture): BufFurniture {
  const flip = (sp: BufSprite): BufSprite => {
    const rects: Rects = {};
    for (const [k, r] of Object.entries(sp.rects ?? {})) if (r) (rects as Record<string, Rect>)[k] = { ...r, x: sp.buf.w - r.x - r.w, y: r.y + (r.skew ?? 0) * r.w, skew: r.skew !== undefined ? -r.skew : undefined };
    return { buf: sp.buf.flipped(), ax: sp.buf.w - sp.ax, ay: sp.ay, rects };
  };
  return { base: flip(f.base), front: f.front ? flip(f.front) : undefined };
}

/**
 * Móvel de chão isométrico (âncora no canto de trás do footprint). Itens de parede não passam por aqui. `facing` (para
 * onde a frente aponta, no plano do mundo) vale para os móveis encostados na parede: 'down' é o desenho de sempre,
 * 'right' é o espelho dele, 'up' são as costas e 'left' o espelho das costas. Assentos e mesas usam a variante.
 */
export function renderIsoFurniture(kind: FurnitureKind, variant?: string, state?: number, seed?: number, facing: Dir = 'down'): BufFurniture {
  const n = normalizeFurniture(kind, variant, state, seed);
  const front = () => build(kind, n.variant, n.state, n.vseed) ?? placeholder(kind);
  if (!BACKS[kind] || facing === 'down') return front();
  if (facing === 'right') return mirror(front());
  if (facing === 'up') return backView(kind);
  return mirror(backView(kind));
}
