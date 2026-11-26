// Para onde cada móvel está virado (puro). A planta vista de cima mostrava tudo de frente para a câmera; na visão
// isométrica a direção precisa ser explícita. Regras, em ordem:
// 1. Assentos com a direção na variante (cadeira de café, poltrona, sofá): a variante é para onde quem senta olha.
// 2. Cadeiras e mesas do posto de trabalho: a cadeira olha para a mesa e a tela da mesa olha para a cadeira.
// 3. Móveis encostados na parede (estantes, arquivos, impressora, bebedouro, bancada...): de costas para a parede que
//    tocam, na ordem norte, oeste, leste, sul.
// 4. O resto (mesas soltas, plantas, banquetas, puffs) não tem frente: 'down'.
import { FURNITURE, type Dir, type FurnitureKind } from '../../art/api';
import type { AreaLayout, FurniturePlacement } from './types';

/** Móveis que têm frente e ficam de costas para a parede em que encostam. */
export const WALL_FACING: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>([
  'bookshelf',
  'binder_shelf',
  'filing_cabinet',
  'printer',
  'water_cooler',
  'fridge',
  'vending_machine',
  'counter',
  'counter_sink',
  'coffee_machine',
  'microwave',
  'sink',
  'arcade',
  'toilet_stall',
]);

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export function opposite(d: Dir): Dir {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left';
}

/** Passo (tiles) de uma direção no plano do mundo. */
export function dirStep(d: Dir): [number, number] {
  return d === 'up' ? [0, -1] : d === 'down' ? [0, 1] : d === 'left' ? [-1, 0] : [1, 0];
}

/**
 * Paredes que o footprint toca, pela borda do interior da área: as duas linhas da face norte, a parede sul de uma
 * linha e as laterais de meio tile.
 */
export function touchedWalls(area: AreaLayout, f: Pick<FurniturePlacement, 'kind' | 'tx' | 'ty'>): Dir[] {
  const r = area.rect;
  const fp = FURNITURE[f.kind].footprint;
  const lx = f.tx - r.x;
  const ly = f.ty - r.y;
  const out: Dir[] = [];
  const hasFace = area.walls.some((w) => w.kind === 'face');
  if (ly <= (hasFace ? 2 : 0)) out.push('up');
  if (lx <= 1) out.push('left');
  if (lx + fp.w >= r.w - 1) out.push('right');
  if (ly + fp.h >= r.h - 1) out.push('down');
  return out;
}

/** Direção (no plano do mundo) para onde a frente do móvel aponta. */
export function furnitureFacing(area: AreaLayout, f: FurniturePlacement): Dir {
  switch (f.kind) {
    case 'cafe_chair':
    case 'armchair':
      return DIRS.includes(f.variant as Dir) ? (f.variant as Dir) : 'down';
    case 'sofa':
      return f.variant === 'up' ? 'up' : 'down';
    case 'office_chair':
      return 'up';
    case 'office_chair_front':
      return 'down';
    case 'bench':
      return 'down';
    case 'desk':
      return 'down';
    case 'desk_back':
      return 'up';
  }
  if (!WALL_FACING.has(f.kind)) return 'down';
  const walls = touchedWalls(area, f);
  for (const w of ['up', 'left', 'right', 'down'] as const) if (walls.includes(w)) return opposite(w);
  return 'down';
}
