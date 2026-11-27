// Poses: cada uma devolve um Rig (articulações em 3D + expressão + item na mão). Os quadros por pose são os mesmos do
// jogo (POSE_FRAMES de character/render.ts) e a regra de "sentado" também.
import type { HeldItem, Pose } from '../api';
import { ANKLE_Z, ARM_L, BONE_ARM, BONE_LEG, FOOT_L, HEAD_Z, HIP_L, J, SEAT_DROP, TORSO_BOT, TORSO_TOP, limb, type Brow, type Eyes, type ItemKind, type Joint, type Mouth, type Rig } from './rig';

export const POSE_FRAMES: Readonly<Record<Pose, number>> = {
  stand: 2, walk: 4, run: 4, sit: 2, type: 4, sleep: 2, drink: 2, use: 2, raise_hand: 2, talk: 2, stretch: 2,
  read: 2, play: 2, wait: 2, cheer: 2, laugh: 2, game: 2, rps: 2, groom: 2, sulk: 2,
};

/** Quadros de cada pose. */
export const avatarFrames = (pose: Pose): number => POSE_FRAMES[pose];

const SEATED_ONLY: ReadonlySet<Pose> = new Set<Pose>(['sit', 'type', 'sleep', 'wait']);
const NEVER_SEATED: ReadonlySet<Pose> = new Set<Pose>(['walk', 'run', 'stretch', 'play', 'groom']);
/** Poses que posicionam mãos e item por conta própria. */
const OWN_HANDS: ReadonlySet<Pose> = new Set<Pose>(['play', 'drink', 'raise_hand', 'stretch', 'cheer', 'laugh', 'game', 'rps', 'groom', 'sulk', 'type', 'sleep', 'use']);
const TWO_HANDED: ReadonlySet<HeldItem> = new Set<HeldItem>(['papers', 'book', 'box', 'laptop']);

/** Mesma regra do jogo: sit/type/sleep/wait sempre sentados; walk/run/stretch/play/groom nunca. */
export function isAvatarSeated(pose: Pose, seated?: boolean): boolean {
  return SEATED_ONLY.has(pose) || (!!seated && !NEVER_SEATED.has(pose));
}

/** Altura da superfície do assento (base do quadril sentado) acima da âncora, em px. */
export const AVATAR_SEAT_HIP_Z = TORSO_BOT - SEAT_DROP - 3;

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

// corrida: voo com a perna de trás levantada, passagem com o joelho alto
const RUN: Step[] = [
  { bob: 1.4, lf: 4.4, ll: 0.8, rf: -4.6, rl: 3.4, al: -3.4, ar: 3.4 },
  { bob: 0, lf: 0.4, ll: 0, rf: 1.8, rl: 4.4, al: -0.6, ar: 0.6 },
  { bob: 1.4, lf: -4.6, ll: 3.4, rf: 4.4, rl: 0.8, al: 3.4, ar: -3.4 },
  { bob: 0, lf: 1.8, ll: 4.4, rf: 0.4, rl: 0, al: 0.6, ar: -0.6 },
];

const sg = (i: 0 | 1): number => (i === 0 ? 1 : -1);

export function makeRig(pose: Pose, frame: number, seatedReq: boolean | undefined, heldReq: HeldItem | undefined): Rig {
  const n = POSE_FRAMES[pose];
  const k = ((Math.floor(frame) % n) + n) % n;
  const k2 = k % 2;
  const seated = isAvatarSeated(pose, seatedReq);
  const held: HeldItem = heldReq ?? 'none';

  // parâmetros do corpo, ajustados por pose
  let bob = 0;
  let breath = k2;
  let lean = 0;
  let headF = 0;
  let headDz = 0;
  let eyes: Eyes = 'open';
  let mouth: Mouth = 'smile';
  let brow: Brow = 'normal';
  let step: Step | null = null;
  let stance = { l: FOOT_L, lf: -0.6, rf: 1.0 };
  let crouch = 0;

  if (pose === 'walk') {
    step = WALK[k];
    bob = step.bob;
    breath = 0;
  } else if (pose === 'run') {
    step = RUN[k];
    bob = step.bob;
    breath = 0;
    lean = 1.4;
    headF = 0.4;
    mouth = 'flat';
    brow = 'down';
  }
  if (pose === 'play') {
    crouch = 1.2;
    stance = { l: 4.2, lf: 0.8, rf: -0.8 };
    lean = 1.2;
    breath = 0;
  }
  if (pose === 'cheer') {
    breath = 0;
    if (!seated) bob = k2 ? 2.4 : 0;
  }
  if (pose === 'stretch') {
    breath = 0;
    bob = k2 * 0.6;
  }

  const lift = bob - crouch - (seated ? SEAT_DROP : 0);
  const bot = TORSO_BOT + lift;
  const hipZ = bot - 1.5;
  const T = TORSO_TOP + lift; // topo do tronco sem respiração
  const handRest = T - 1.4 - 10.6;

  // ---------------------------------------------------------- pernas
  const legPole = J(0, 1, 0.15);
  const legs = [0, 1].map((i) => {
    const s = sg(i as 0 | 1);
    const root = J(s * HIP_L, 0, hipZ);
    if (seated) return { root, mid: J(s * 2.9, 4.8, hipZ + 0.3), end: J(s * 3.3, 6.7, ANKLE_Z) };
    const f = step ? (i === 0 ? step.lf : step.rf) : i === 0 ? stance.lf : stance.rf;
    const z = step ? (i === 0 ? step.ll : step.rl) : 0;
    const l = step ? FOOT_L : stance.l;
    const zUp = pose === 'cheer' || pose === 'stretch' ? bob : 0;
    return limb(root, J(s * l, f, ANKLE_Z + z + zUp), BONE_LEG, BONE_LEG, legPole);
  }) as Rig['legs'];

  // cabeça e tronco de cima dependem da respiração, que algumas poses mudam abaixo: calculados depois
  let hz = 0;
  let armZ = 0;
  const armRoot = (i: 0 | 1): Joint => J(sg(i) * ARM_L, 0, armZ);
  const armPole = (i: 0 | 1): Joint => J(sg(i) * 0.5, -1, -0.45);
  const arms = [null, null] as unknown as Rig['arms'];
  const armTo = (i: 0 | 1, t: Joint, pole?: Joint): void => {
    arms[i] = limb(armRoot(i), t, BONE_ARM, BONE_ARM, pole ?? armPole(i));
  };

  // pose "base" de cada pose pode mexer em breath: resolvemos o esqueleto de cima numa função
  const upper = (): void => {
    hz = HEAD_Z + lift - breath;
    armZ = TORSO_TOP + lift - breath - 1.4;
    for (const i of [0, 1] as const) {
      const s = step ? (i === 0 ? step.al : step.ar) : 0;
      const raise = step && pose === 'walk' ? 0.25 * Math.abs(s) + (s > 0.5 ? 0.3 : 0) : 0;
      armTo(i, J(sg(i) * (ARM_L + 0.3), s, handRest + raise));
    }
  };

  // ajustes que mudam a respiração têm de vir antes de `upper`
  if (pose === 'sulk') breath = 1 + k2;
  upper();

  let item: ItemKind = 'none';
  let itemAt: Joint | null = null;
  let itemTwo = false;
  const carry = (i: 0 | 1, t: Joint, p?: Joint): void => {
    armTo(i, t, p);
    item = held;
    itemAt = arms[i].end;
  };
  const both = (z: number, fwd = 4.8, half = 2.7): void => {
    armTo(0, J(half, fwd, z), J(1, -0.5, -1));
    armTo(1, J(-half, fwd, z), J(-1, -0.5, -1));
    item = held;
    itemTwo = true;
    itemAt = J(0, fwd + 0.4, z);
  };

  switch (pose) {
    case 'stand':
    case 'walk':
      break;
    case 'run':
      // braços dobrados: um para a frente, outro para trás
      for (const i of [0, 1] as const) {
        const s = i === 0 ? step!.al : step!.ar;
        if (Math.abs(s) < 1) armTo(i, J(sg(i) * (ARM_L - 0.6), 1.2, T - 8.6), J(sg(i) * 0.4, -1, -0.2));
        else if (s > 0) armTo(i, J(sg(i) * (ARM_L - 1.2), 3.8, T - 5.4), J(sg(i) * 0.6, -1, -0.5));
        else armTo(i, J(sg(i) * (ARM_L - 0.4), -2.6, T - 7.8), J(sg(i) * 0.5, -0.4, 1));
      }
      break;
    case 'sit':
      for (const i of [0, 1] as const) armTo(i, J(sg(i) * 3.5, 4.2, hipZ + 2.4), J(sg(i) * 0.7, -1, 0.1));
      break;
    case 'type': {
      lean = 0.8;
      headF = 0.5;
      mouth = 'flat';
      const up = [[0.9, -0.4], [0.5, 0.5], [-0.4, 0.9], [-0.1, -0.1]][k];
      for (const i of [0, 1] as const) armTo(i, J(sg(i) * 3.1, 6.6, hipZ + 4.6 + up[i]), J(sg(i) * 0.7, -0.6, -1));
      break;
    }
    case 'sleep':
      lean = 1.1;
      headF = 2.0;
      headDz = -2.2;
      eyes = 'closed';
      mouth = k2 ? 'small' : 'flat';
      for (const i of [0, 1] as const) armTo(i, J(sg(i) * 3.4, 3.6, hipZ + 2), J(sg(i) * 0.7, -1, 0.1));
      break;
    case 'drink':
      lean = 0.4;
      if (k2) {
        carry(0, J(1.7, 6.4, hz - 8.3), J(1, -0.5, -0.4));
        eyes = 'closed';
        mouth = 'small';
        headF = -0.5;
      } else carry(0, J(2.4, 5.0, T - 6.6), J(1, -0.5, -0.6));
      break;
    case 'use':
      lean = 0.9;
      armTo(0, J(ARM_L - 1.6, 8.6 + k2 * 0.9, T - 5.6 - k2 * 0.6), J(0.8, -0.2, -1));
      mouth = 'flat';
      break;
    case 'raise_hand':
      armTo(0, J(ARM_L - 0.4 + (k2 ? 1.6 : -0.8), 0.6, hz + 9.6 + k2 * 0.3), J(1, -0.3, -0.2));
      brow = 'up';
      break;
    case 'talk':
      armTo(0, J(ARM_L - 1.4, 4.4 + k2 * 0.8, T - 6.8 + k2 * 1.8), J(1, -0.5, -0.6));
      armTo(1, J(-(ARM_L - 0.8), 2.6 - k2, T - 9.6 + (k2 ? 0 : 1.4)), J(-1, -0.5, -0.4));
      mouth = k2 ? 'smile' : 'open';
      brow = k2 ? 'normal' : 'up';
      break;
    case 'stretch':
      lean = -0.8;
      headF = -0.4;
      eyes = 'closed';
      mouth = k2 ? 'open' : 'flat';
      for (const i of [0, 1] as const) armTo(i, J(sg(i) * (2.4 + k2 * 1.2), 0.2, hz + 9.2 + k2 * 1.6), J(sg(i) * 1, -0.5, 0));
      break;
    case 'read':
      eyes = 'half';
      headF = 0.7;
      headDz = -0.5;
      mouth = 'flat';
      if (held === 'phone') {
        carry(0, J(2.6, 5.2, T - 5.8 - k2 * 0.3), J(1, -0.5, -0.6));
        armTo(1, J(-(ARM_L - 2), 3.4, T - 9), J(-1, -0.4, -0.5));
      } else both(T - 7.6 + k2 * 0.2, 4.6, 2.5);
      if (!TWO_HANDED.has(held) && held !== 'phone') item = 'none';
      break;
    case 'play':
      armTo(0, J(ARM_L - 0.8 - k2 * 1.4, 5.0 + k2 * 1.8, T - 6.0 - k2 * 2.8), J(0.5, -1, -0.4));
      armTo(1, J(-(ARM_L + 0.8), -1.0, T - 9.6), J(-1, -0.4, -0.4));
      item = held;
      itemAt = arms[0].end;
      brow = 'down';
      break;
    case 'wait':
      mouth = 'flat';
      if (held === 'popcorn') {
        if (k2) {
          carry(0, J(1.7, 6.2, hz - 9.4), J(1, -0.5, -0.4));
          mouth = 'open';
        } else carry(0, J(2.5, 4.8, T - 7.6), J(1, -0.5, -0.6));
        armTo(1, J(-3.4, 4.2, T - 8.2), J(-1, -0.6, -0.5));
      } else {
        // braços cruzados
        armTo(0, J(-2.9, 4.8, T - 6.4), J(0.6, -0.2, -1));
        armTo(1, J(3.8, 4.4, T - 7.6), J(-0.4, -0.2, -1));
      }
      break;
    case 'cheer':
      eyes = 'arc';
      mouth = 'open';
      brow = 'up';
      for (const i of [0, 1] as const) armTo(i, J(sg(i) * (ARM_L + 1.8 + k2 * 0.8), 0.6, hz + 9.2 + k2 * 1.2), J(sg(i) * 1, -0.4, -0.2));
      break;
    case 'laugh':
      eyes = 'arc';
      mouth = 'open';
      brow = 'up';
      headF = -0.6;
      lean = k2 ? -0.5 : 0.3;
      armTo(0, J(1.8, 4.6, T - 9.8), J(1, -0.6, -0.2));
      armTo(1, J(-(ARM_L + 0.6), 0.6, handRest + 0.8), J(-1, -0.5, -0.4));
      break;
    case 'game':
      lean = 1.0;
      headF = 0.9;
      mouth = k2 ? 'small' : 'flat';
      armTo(0, J(2.5, 5.2, T - 7.8 + (k2 ? 0.5 : 0)), J(1, -0.5, -1));
      armTo(1, J(-2.5, 5.2, T - 7.8 + (k2 ? 0 : 0.5)), J(-1, -0.5, -1));
      item = held;
      itemTwo = true;
      itemAt = J(0, 5.6, T - 7.8);
      break;
    case 'rps':
      brow = 'up';
      if (held === 'rock' || held === 'paper' || held === 'scissors') {
        armTo(0, J(ARM_L - 2.6, 7.6, T - 4.6 - k2 * 0.8), J(1, -0.2, -1));
        item = held;
        itemAt = arms[0].end;
      } else {
        // contagem "jo-ken-pô": o punho sobe e desce
        armTo(0, J(ARM_L - 2.2, 4.8, T - (k2 ? 8.2 : 3.4)), J(1, -0.4, -1));
        item = 'fist';
        itemAt = arms[0].end;
      }
      break;
    case 'groom':
      eyes = k2 ? 'half' : 'open';
      if (held === 'lipstick') {
        mouth = 'small';
        carry(0, J(1.4 + k2 * 0.4, 6.6, hz - 8.8 - k2 * 0.9), J(1, -0.4, -0.6));
      } else if (held === 'comb') carry(0, J(6.4 - k2 * 0.4, 1.4, hz + 3.4 + k2 * 2.4), J(1, -0.4, -0.1));
      else armTo(0, J(6.6 - k2 * 0.4, 1.2, hz + 3 + k2 * 2.6), J(1, -0.4, -0.1));
      break;
    case 'sulk':
      lean = 1.0;
      headF = 1.5;
      headDz = -1.4;
      eyes = 'half';
      brow = 'sad';
      mouth = 'frown';
      for (const i of [0, 1] as const) armTo(i, J(sg(i) * (ARM_L - 0.1), 1.6, handRest - breath * 0.4), J(sg(i) * 0.4, -1, -0.3));
      break;
  }

  // itens segurados em poses sem mãos próprias: uma mão (a esquerda do personagem, a que fica na frente da câmera)
  // ou as duas, à altura da cintura
  if (held !== 'none' && item === 'none' && !OWN_HANDS.has(pose) && !(pose === 'read' && TWO_HANDED.has(held))) {
    if (TWO_HANDED.has(held)) both(held === 'box' ? T - 7.4 : held === 'laptop' ? T - 10 : T - 8.4, 4.6, 2.9);
    else if (held === 'phone') carry(0, J(2.6, 5.0, T - 6.2), J(1, -0.5, -0.6));
    else carry(0, J(ARM_L - 1.0, 3.6, T - 8.4), J(1, -0.5, -0.5));
  }

  // pé batendo (wait sentado, sem item)
  if (pose === 'wait' && held !== 'popcorn' && k2) {
    const a = legs[0];
    legs[0] = { root: a.root, mid: J(a.mid.l, a.mid.f, a.mid.z + 0.6), end: J(a.end.l, a.end.f, a.end.z + 1.3) };
  }

  return {
    lift,
    breath,
    torsoTop: TORSO_TOP + lift - breath,
    torsoBot: bot,
    headZ: hz + headDz,
    headF,
    lean,
    seated,
    legs,
    arms,
    eyes,
    mouth,
    brow,
    item,
    itemAt,
    itemTwo,
  };
}
