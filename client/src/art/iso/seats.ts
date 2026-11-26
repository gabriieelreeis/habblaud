// Onde fica quem senta em cada assento isométrico (puro): o centro da almofada a partir do centro do tile do assento
// (px de mundo) e a altura do quadril. O renderizador põe a âncora do personagem nesse ponto e sobe o boneco
// `hipZ − SEAT_HIP_Z`. No sofá e no banco, cada tile é um lugar.
import { FURNITURE, type Dir, type FurnitureKind } from '../api';
import { AVATAR_SEAT_HIP_Z } from '../avatar/poses';
import { BENCH_TOP } from './cafe';
import { BEANBAG_DIP } from './lounge';
import { SEAT_Z } from './office';
import { STOOL_TOP } from './office2';

export interface SeatAnchor {
  dx: number;
  dy: number;
  hipZ: number;
}

/** O quadril fica um pouco acima do topo da almofada (o assento cede sob o corpo). */
const HIP_OVER_TOP = 1.5;

const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** Direção do assento: a variante, quando ela é uma direção (cadeira de café, poltrona, sofá); senão, o olhar. */
function seatDir(variant: string | undefined, facing: Dir): Dir {
  return DIRS.includes(variant as Dir) ? (variant as Dir) : facing;
}

/** `k` px na direção do olhar (para longe do encosto). */
function ahead(d: Dir, k: number): { dx: number; dy: number } {
  return d === 'up' ? { dx: 0, dy: -k } : d === 'down' ? { dx: 0, dy: k } : d === 'left' ? { dx: -k, dy: 0 } : { dx: k, dy: 0 };
}

/** Topo da almofada (px acima do chão) de cada assento; no pufe, o fundo onde o quadril afunda. */
export function isoSeatTop(kind: FurnitureKind): number {
  switch (kind) {
    case 'bench':
      return BENCH_TOP;
    case 'stool':
      return STOOL_TOP;
    case 'beanbag':
      return BEANBAG_DIP;
    default:
      return SEAT_Z;
  }
}

/** Onde fica o quadril de quem senta, a partir do CENTRO do tile do assento (px de mundo), e a altura do quadril (px). */
export function isoSeatAnchor(kind: FurnitureKind, variant: string | undefined, facing: Dir): SeatAnchor {
  const hipZ = isoSeatTop(kind) + HIP_OVER_TOP;
  switch (kind) {
    case 'cafe_chair':
      // encosto de 2 px numa borda da almofada de 10
      return { ...ahead(seatDir(variant, facing), 0.75), hipZ };
    case 'armchair':
      // almofada de 9 px entre o encosto (4 px) e a borda da frente
      return { ...ahead(seatDir(variant, facing), 1.5), hipZ };
    case 'sofa':
      // almofadas de 10 px de fundo, encosto de 4 px
      return { ...ahead(variant === 'up' ? 'up' : 'down', 2), hipZ };
    case 'bench':
      return { dx: 0, dy: 0.75, hipZ };
    default:
      return { dx: 0, dy: 0, hipZ };
  }
}

/** No formato do contrato da arte (`isoSeatAnchor` em api.ts): quanto o personagem sentado sobe; null se não é assento. */
export function isoSeatPlacement(kind: FurnitureKind, variant: string | undefined, facing: Dir): { dx: number; dy: number; lift: number } | null {
  if (!FURNITURE[kind]?.seat) return null;
  const a = isoSeatAnchor(kind, variant, facing);
  // a base do quadril do personagem sentado fica AVATAR_SEAT_HIP_Z acima da âncora; ela vai no topo da almofada
  return { dx: a.dx, dy: a.dy, lift: a.hipZ - HIP_OVER_TOP - AVATAR_SEAT_HIP_Z };
}
