// Esqueleto e projeção: o personagem vive num espaço (l, f, z) — l = lateral (para a direita da tela quando de frente),
// f = para a frente do personagem, z = altura do chão — e `proj` leva um ponto dele para a tela, para um ângulo de giro
// phi (0 = de frente para o observador, 90 = olhando para a esquerda da tela, 180 = de costas).
// Cada pose é uma função (quadro) -> Rig; poses novas (sentar, acenar...) só precisam devolver outro Rig.
import type { PixelBuf } from '../core/pixbuf';
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

export interface LimbRig {
  root: Joint;
  end: Joint;
}

export interface Rig {
  /** Corpo inteiro acima do chão (o passo "alto" da caminhada). */
  lift: number;
  /** Quanto o tronco de cima desce (respiração). */
  breath: number;
  torsoTop: number;
  torsoBot: number;
  /** Altura do centro da cabeça. */
  headZ: number;
  /** [esquerda do personagem (l > 0 de frente), direita]. */
  legs: [LimbRig, LimbRig];
  arms: [LimbRig, LimbRig];
}

export interface Ctx {
  look: Look;
  v: View;
  rig: Rig;
  buf: PixelBuf;
  mirror: boolean;
}

/** Inclinação isométrica: o que está mais perto do observador aparece um pouco mais baixo. */
const TILT = 0.3;

export function proj(v: View, l: number, f: number, z: number): { x: number; y: number; d: number } {
  const d = f * v.c + l * v.s;
  return { x: AX + l * v.c - f * v.s, y: AY - z + TILT * d, d };
}

export const TORSO_TOP = 27;
export const TORSO_BOT = 14;
export const HEAD_Z = 36.5;
const LEG_L = 2.5;
const FOOT_L = 3;
const ARM_L = 6.4;
const ANKLE_Z = 3;

const J = (l: number, f: number, z: number): Joint => ({ l, f, z });

interface Step {
  bob: number;
  lf: number;
  ll: number;
  rf: number;
  rl: number;
  al: number;
  ar: number;
}

// quatro quadros: contato (esquerda à frente), passagem, contato (direita à frente), passagem
const WALK: Step[] = [
  { bob: 0, lf: 3, ll: 0, rf: -3, rl: 0.5, al: -2.6, ar: 2.6 },
  { bob: 1, lf: 0, ll: 0, rf: 0.8, rl: 1.8, al: 0.3, ar: -0.3 },
  { bob: 0, lf: -3, ll: 0.5, rf: 3, rl: 0, al: 2.6, ar: -2.6 },
  { bob: 1, lf: 0.8, ll: 1.8, rf: 0, rl: 0, al: -0.3, ar: 0.3 },
];

function build(lift: number, breath: number, s: Step | null): Rig {
  const top = TORSO_TOP + lift - breath;
  const hipZ = TORSO_BOT - 1.5 + lift;
  const armRoot = top - 1.4;
  const handZ = TORSO_TOP + lift - 1.4 - 10.6;
  const st = s ?? { bob: 0, lf: 0.3, ll: 0, rf: 0.3, rl: 0, al: 0, ar: 0 };
  return {
    lift,
    breath,
    torsoTop: top,
    torsoBot: TORSO_BOT + lift,
    headZ: HEAD_Z + lift - breath,
    legs: [
      { root: J(LEG_L, 0, hipZ), end: J(FOOT_L, st.lf, ANKLE_Z + st.ll) },
      { root: J(-LEG_L, 0, hipZ), end: J(-FOOT_L, st.rf, ANKLE_Z + st.rl) },
    ],
    arms: [
      { root: J(ARM_L, 0, armRoot), end: J(ARM_L + 0.3, st.al, handZ) },
      { root: J(-ARM_L, 0, armRoot), end: J(-ARM_L - 0.3, st.ar, handZ) },
    ],
  };
}

export type Pose = 'stand' | 'walk';

export const POSE_FRAMES: Record<Pose, number> = { stand: 2, walk: 4 };

export function makeRig(pose: Pose, frame: number): Rig {
  const n = POSE_FRAMES[pose];
  const k = ((frame % n) + n) % n;
  if (pose === 'walk') return build(WALK[k].bob, 0, WALK[k]);
  return build(0, k % 2, null);
}
