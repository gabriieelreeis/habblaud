// Rig paramétrico do personagem isométrico (puro): juntas em 3D no referencial do próprio personagem e a
// projeção para as duas vistas 3/4 desenhadas (frente e costas; as outras duas são o espelho delas).
//
// Referencial: f = para a frente (px de mundo, na direção do olhar), n = para o lado PERTO da câmera (px),
// z = para cima (px de tela). A âncora (0, 0, 0) é o chão entre os pés (em pé) ou sob o quadril (sentado).
// Na vista de frente (dir 'down', olhando para baixo-esquerda) o lado perto é o esquerdo do personagem; na de
// costas (dir 'up', olhando para cima-direita), o direito. Nas duas ele fica à DIREITA da tela, antes do espelho.
import type { HeldItem } from '../api';
import type { V2 } from './paint';

export interface J {
  f: number;
  n: number;
  z: number;
}

export const J3 = (f: number, n: number, z: number): J => ({ f, n, z });

export interface View {
  /** Vista de costas (dir 'up'/'left'). */
  back: boolean;
  /** 1 = como desenhado, -1 = espelhado ('right'/'left'). */
  m: 1 | -1;
}

/** Projeção: f anda na diagonal 2:1 do piso; n quase na horizontal (ombros pouco inclinados). */
const CF = 1;
const SF = 0.5;
const CN = 1;
const SN = 0.22;

/** Ponto 3D -> tela local (antes do espelho), y para baixo. */
export function proj(v: View, p: J): V2 {
  const s = v.back ? -1 : 1;
  return [-s * CF * p.f + CN * p.n, -p.z + s * SF * p.f + SN * p.n];
}

/** Profundidade (maior = mais perto da câmera). */
export function depth(v: View, p: J): number {
  return (v.back ? -p.f : p.f) + p.n;
}

export const add = (a: J, b: J): J => ({ f: a.f + b.f, n: a.n + b.n, z: a.z + b.z });
export const lerp = (a: J, b: J, t: number): J => ({ f: a.f + (b.f - a.f) * t, n: a.n + (b.n - a.n) * t, z: a.z + (b.z - a.z) * t });

/** Dois segmentos (coxa/canela, braço/antebraço) com a junta do meio dobrando para `pole`. */
export function ik(a: J, c: J, l1: number, l2: number, pole: J): J {
  const dx = c.f - a.f;
  const dy = c.n - a.n;
  const dz = c.z - a.z;
  const d = Math.hypot(dx, dy, dz) || 1e-6;
  if (d >= l1 + l2 - 1e-3) return lerp(a, c, l1 / (l1 + l2));
  // distância ao longo do eixo e altura do triângulo
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  // componente do polo perpendicular ao eixo
  let px = pole.f;
  let py = pole.n;
  let pz = pole.z;
  const k = px * ux + py * uy + pz * uz;
  px -= k * ux;
  py -= k * uy;
  pz -= k * uz;
  const pl = Math.hypot(px, py, pz) || 1;
  return { f: a.f + ux * x + (px / pl) * h, n: a.n + uy * x + (py / pl) * h, z: a.z + uz * x + (pz / pl) * h };
}

export type HandShape = 'open' | 'fist' | 'grip' | 'flat' | 'rock' | 'paper' | 'scissors';

export interface Limb {
  /** Raiz (quadril/ombro), meio (joelho/cotovelo) e ponta (tornozelo/punho). */
  a: J;
  b: J;
  c: J;
}

export interface LegRig extends Limb {
  /** Inclinação do pé: 0 apoiado, > 0 ponta para cima (calcanhar no chão), < 0 na ponta dos pés. */
  pitch: number;
}

export interface ArmRig extends Limb {
  hand: HandShape;
}

export type Eyes = 'open' | 'closed' | 'half' | 'happy' | 'wide';
export type Mouth = 'smile' | 'none' | 'open' | 'wide' | 'frown' | 'o' | 'chew';
export type Brows = 'normal' | 'up' | 'sad' | 'flat';

export interface Rig {
  seated: boolean;
  /** Centro do quadril (altura da articulação). */
  hip: J;
  /** Centro da linha dos ombros (o f dele inclina o tronco). */
  chest: J;
  /** Centro da cabeça. */
  head: J;
  /** Olhar para baixo: o rosto desce `nod` px dentro da cabeça. */
  nod: number;
  far: { leg: LegRig; arm: ArmRig };
  near: { leg: LegRig; arm: ArmRig };
  eyes: Eyes;
  mouth: Mouth;
  brows: Brows;
  held: HeldItem;
  /** Onde fica o item: na mão de perto (padrão), na de longe, entre as duas ou num ponto fixo. */
  itemHand: 'near' | 'far' | 'both';
  itemAt: J | null;
  /** Ponto de pipoca entre os dedos (pose wait). */
  kernel: J | null;
  /** Braços cruzados (pose wait sem item): 1 = dedos batendo para cima. */
  crossed: 0 | 1 | null;
  /** Ombros caídos (px). */
  slump: number;
}

// ------------------------------------------------------------ medidas
// Corpo inteiro (~40 px em pé, cabeça ~1/4 da altura): pernas ~45%, tronco ~25%.

export const HIP_Z = 18;
export const SEAT_HIP_Z = 11.5;
export const HIP_N = 1.9;
export const THIGH = 8.4;
export const SHIN = 8;
export const ANKLE_Z = 1.5;
/** Ombro acima do quadril. */
export const TORSO = 10;
export const SHOULDER_N = 5.2;
export const UPPER_ARM = 6.2;
export const FOREARM = 6;
/** Centro da cabeça acima da linha dos ombros. */
export const HEAD_UP = 6.2;

/** Raiz do braço a partir do centro dos ombros. */
export function shoulderOf(chest: J, side: 1 | -1, slump = 0): J {
  return { f: chest.f, n: chest.n + side * SHOULDER_N, z: chest.z - 1.2 - slump };
}

/** Braço com IK: cotovelo para trás/fora por padrão. */
export function armTo(chest: J, side: 1 | -1, hand: J, opts: { pole?: J; shape?: HandShape; slump?: number } = {}): ArmRig {
  const a = shoulderOf(chest, side, opts.slump ?? 0);
  const pole = opts.pole ?? J3(-1, side * 0.7, -0.4);
  return { a, b: ik(a, hand, UPPER_ARM, FOREARM, pole), c: hand, hand: opts.shape ?? 'open' };
}

/** Braço pendurado ao lado do corpo, com `swing` (f) para frente/trás. */
export function armDown(chest: J, side: 1 | -1, swing = 0, out = 0.8, slump = 0): ArmRig {
  const a = shoulderOf(chest, side, slump);
  const hand = J3(a.f + swing, a.n + side * out, a.z - (UPPER_ARM + FOREARM) + Math.abs(swing) * 0.3);
  return armTo(chest, side, hand, { pole: J3(-1, side * 0.3, 0), slump });
}

/** Perna com o pé em `foot` (tornozelo) e joelho dobrando para a frente. */
export function legTo(hip: J, side: 1 | -1, ankle: J, pitch = 0): LegRig {
  const a = J3(hip.f, hip.n + side * HIP_N, hip.z);
  return { a, b: ik(a, ankle, THIGH, SHIN, J3(1, 0, 0.15)), c: ankle, pitch };
}

/** Perna em pé com o pé deslocado (df para a frente, lift para cima). */
export function legStand(hip: J, side: 1 | -1, df = 0, lift = 0, pitch = 0): LegRig {
  return legTo(hip, side, J3(hip.f + df, hip.n + side * (HIP_N + 0.2), ANKLE_Z + lift), pitch);
}

/** Pernas sentadas: coxas para a frente na altura do assento e canelas descendo até o chão. */
export function legSeated(hip: J, side: 1 | -1, tap = 0): LegRig {
  const a = J3(hip.f, hip.n + side * HIP_N, hip.z);
  const knee = J3(hip.f + 6.8, a.n + side * 0.2, hip.z - 0.4);
  const ankle = J3(hip.f + 7.6, a.n + side * 0.3, ANKLE_Z + tap);
  return { a, b: knee, c: ankle, pitch: tap > 0 ? 0.6 : 0 };
}
