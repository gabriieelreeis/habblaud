// Despacho dos móveis isométricos por kind (puro). Kinds ainda sem desenho próprio saem como uma caixa neutra do
// tamanho do footprint, para o mundo nunca ficar sem o móvel.
import { FURNITURE, type FurnitureKind } from '../api';
import type { BufFurniture } from '../core/sprite';
import { normalizeFurniture } from '../furniture/index';
import { M } from '../furniture/kit';
import { Iso } from './kit';
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

/** Móvel de chão isométrico (âncora no canto de trás do footprint). Itens de parede não passam por aqui. */
export function renderIsoFurniture(kind: FurnitureKind, variant?: string, state?: number, seed?: number): BufFurniture {
  const n = normalizeFurniture(kind, variant, state, seed);
  return build(kind, n.variant, n.state, n.vseed) ?? placeholder(kind);
}
