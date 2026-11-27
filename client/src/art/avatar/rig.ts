// Esqueleto e projeção: o personagem vive num espaço (l, f, z) — l = lateral (para a direita da tela quando de frente),
// f = para a frente do personagem, z = altura do chão — e `proj` leva um ponto dele para a tela, para um ângulo de giro
// phi (0 = de frente para o observador, 90 = olhando para a esquerda da tela, 180 = de costas).
// As poses (poses.ts) só devolvem um Rig; braços e pernas são resolvidos por cinemática inversa de dois ossos.
import type { PixelBuf } from '../core/pixbuf';
import type { CharacterFrameRequest, HeldItem } from '../api';
import type { Look } from './look';
import { AX, AY } from './paint';

export interface View {
  phi: number;
  c: number;
  s: number;
}

export function makeView(phiDeg: number): View {
  const r = (phiDeg * Math.PI) / 180;
  return { phi: phiDeg, c: Math.round(Math.cos(r) * 1e6) / 1e6, s: Math.round(Math.sin(r) * 1e6) / 1e6 };
}

export interface Joint {
  l: number;
  f: number;
  z: number;
}

/** Membro de dois ossos: raiz (ombro/quadril), articulação (cotovelo/joelho) e ponta (mão/tornozelo). */
export interface Limb {
  root: Joint;
  mid: Joint;
  end: Joint;
}

/** Fantasia de época (o tipo do campo costume da API do jogo). */
export type Costume = NonNullable<CharacterFrameRequest['costume']>;
export type Eyes = 'open' | 'half' | 'closed' | 'arc';
export type Mouth = 'smile' | 'flat' | 'frown' | 'open' | 'small';
export type Brow = 'normal' | 'up' | 'down' | 'sad';
/** Item na mão: os da API mais o punho fechado do jokenpô sem item. */
export type ItemKind = HeldItem | 'fist';

export interface Rig {
  /** Corpo inteiro acima do chão (passo alto, pulo) e abaixado (sentado). */
  lift: number;
  /** Quanto o tronco de cima desce (respiração). */
  breath: number;
  torsoTop: number;
  torsoBot: number;
  /** Altura do centro da cabeça. */
  headZ: number;
  /** Cabeça para a frente em relação ao tronco (px no eixo f). */
  headF: number;
  /** Tronco de cima para a frente (px no eixo f). */
  lean: number;
  seated: boolean;
  /** [esquerda do personagem (l > 0 de frente), direita]. */
  legs: [Limb, Limb];
  arms: [Limb, Limb];
  eyes: Eyes;
  mouth: Mouth;
  brow: Brow;
  item: ItemKind;
  /** Onde o item aparece (ponto de empunhadura); null = sem item. */
  itemAt: Joint | null;
  /** Item segurado com as duas mãos. */
  itemTwo: boolean;
}

export interface Ctx {
  look: Look;
  v: View;
  rig: Rig;
  buf: PixelBuf;
  mirror: boolean;
  costume?: Costume;
  /** Deslocamento de tela (antes do espelho) aplicado às peças pintadas agora: inclinação do tronco e da cabeça. */
  dx: number;
  dy: number;
  /** Quadro da animação (para detalhes como o pé batendo). */
  frame: number;
}

/** Inclinação isométrica: o que está mais perto do observador aparece um pouco mais baixo. */
export const TILT = 0.3;

export function proj(v: View, l: number, f: number, z: number): { x: number; y: number; d: number } {
  const d = f * v.c + l * v.s;
  return { x: AX + l * v.c - f * v.s, y: AY - z + TILT * d, d };
}

export const TORSO_TOP = 27;
export const TORSO_BOT = 14;
export const HEAD_Z = 36.5;
/** Queda do corpo ao sentar. */
export const SEAT_DROP = 5;
export const ARM_L = 6.4;
export const BONE_ARM = 5.3;
export const BONE_LEG = 4.85;
export const HIP_L = 2.5;
export const FOOT_L = 3.2;
export const ANKLE_Z = 3;

export const J = (l: number, f: number, z: number): Joint => ({ l, f, z });

/**
 * Cinemática inversa de dois ossos: devolve cotovelo/joelho e a ponta (o alvo é encurtado se não alcançar).
 * `pole` é uma direção (relativa à raiz) para onde a articulação aponta.
 */
export function ik(root: Joint, target: Joint, l1: number, l2: number, pole: Joint): { mid: Joint; end: Joint } {
  let dl = target.l - root.l;
  let df = target.f - root.f;
  let dz = target.z - root.z;
  let d = Math.hypot(dl, df, dz);
  const reach = l1 + l2 - 0.02;
  if (d > reach) {
    const k = reach / d;
    dl *= k;
    df *= k;
    dz *= k;
    d = reach;
  }
  if (d < 0.5) d = 0.5;
  const ul = dl / d;
  const uf = df / d;
  const uz = dz / d;
  const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // componente do polo perpendicular ao eixo raiz -> alvo
  const pd = pole.l * ul + pole.f * uf + pole.z * uz;
  let pl = pole.l - pd * ul;
  let pf = pole.f - pd * uf;
  let pz = pole.z - pd * uz;
  const pn = Math.hypot(pl, pf, pz) || 1;
  pl /= pn;
  pf /= pn;
  pz /= pn;
  return {
    mid: J(root.l + ul * a + pl * h, root.f + uf * a + pf * h, root.z + uz * a + pz * h),
    end: J(root.l + dl, root.f + df, root.z + dz),
  };
}

export function limb(root: Joint, target: Joint, l1: number, l2: number, pole: Joint): Limb {
  const r = ik(root, target, l1, l2, pole);
  return { root, mid: r.mid, end: r.end };
}
