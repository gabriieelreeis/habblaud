// Despacho dos móveis isométricos por kind (puro). Kinds ainda sem desenho próprio saem como uma caixa neutra do
// tamanho do footprint, para o mundo nunca ficar sem o móvel.
import { FURNITURE, type Dir, type FurnitureKind, type Rect } from '../api';
import type { BufFurniture, BufSprite, Rects } from '../core/sprite';
import { normalizeFurniture } from '../furniture/index';
import { M } from '../furniture/kit';
import { Iso } from './kit';
import { cafeBack, cafeKinds } from './cafe';
import { loungeBack, loungeKinds } from './lounge';
import * as O from './office';
import { officeMore, officeMoreBack } from './office2';

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

function build(kind: FurnitureKind, variant: string | undefined, state: number, seed: number, facing: Dir): BufFurniture | null {
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
      return officeMore(kind, variant, state, seed) ?? cafeKinds(kind, variant, state, seed) ?? loungeKinds(kind, variant, state, seed, facing);
  }
}

type BackFn = (variant: string | undefined, state: number, seed: number) => BufFurniture | null;

/**
 * Desenho de costas (o móvel de frente para o norte, encostado na parede sul) de cada móvel de parede: mesmo footprint
 * e mesma altura da frente, com o que identifica o móvel visto por trás.
 */
const BACKS: Partial<Record<FurnitureKind, BackFn>> = {
  bookshelf: (_v, _st, seed) => O.bookshelfBack(seed),
  binder_shelf: (_v, _st, seed) => officeMoreBack('binder_shelf', seed),
  filing_cabinet: (_v, _st, seed) => officeMoreBack('filing_cabinet', seed),
  printer: (_v, _st, seed) => officeMoreBack('printer', seed),
  water_cooler: (_v, _st, seed) => officeMoreBack('water_cooler', seed),
  fridge: (_v, st) => cafeBack('fridge', st),
  vending_machine: (_v, st) => cafeBack('vending_machine', st),
  counter: (_v, st) => cafeBack('counter', st),
  counter_sink: (_v, st) => cafeBack('counter_sink', st),
  coffee_machine: (_v, st) => cafeBack('coffee_machine', st),
  microwave: (_v, st) => cafeBack('microwave', st),
  sink: (_v, st) => cafeBack('sink', st),
  arcade: () => loungeBack('arcade'),
  toilet_stall: (_v, st) => cafeBack('toilet_stall', st),
};

/** Kinds com desenho de costas próprio (os que viram de costas para a câmera na parede sul ou leste). */
export const ISO_BACK_KINDS = Object.keys(BACKS) as FurnitureKind[];

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
 * 'right' é o espelho dele, 'up' são as costas e 'left' o espelho das costas. Assentos e mesas usam a variante; o pufe,
 * cuja variante é a cor, usa `facing` como a direção de quem senta.
 */
export function renderIsoFurniture(kind: FurnitureKind, variant?: string, state?: number, seed?: number, facing: Dir = 'down'): BufFurniture {
  const n = normalizeFurniture(kind, variant, state, seed);
  const front = () => build(kind, n.variant, n.state, n.vseed, facing) ?? placeholder(kind);
  const backFn = BACKS[kind];
  if (!backFn || facing === 'down') return front();
  if (facing === 'right') return mirror(front());
  const back = backFn(n.variant, n.state, n.vseed) ?? front();
  return facing === 'up' ? back : mirror(back);
}
