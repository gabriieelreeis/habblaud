// Poses do personagem isométrico (puro): cada pose/quadro vira um Rig em 3D. As mesmas juntas servem às duas
// vistas; só a projeção muda (na de costas, o que vai para a frente some atrás do corpo).
import type { CharacterFrameRequest, HeldItem, Pose } from '../api';
import { POSE_FRAMES, isSeated } from '../character/render';
import {
  HEAD_UP,
  HIP_Z,
  J3,
  SEAT_HIP_Z,
  TORSO,
  armDown,
  armTo,
  legSeated,
  legStand,
  type ArmRig,
  type J,
  type Rig,
} from './rig';

const TWO_HANDED: ReadonlySet<HeldItem> = new Set<HeldItem>(['box', 'laptop', 'papers', 'book']);
const GESTURES: ReadonlySet<HeldItem> = new Set<HeldItem>(['rock', 'paper', 'scissors']);
/** Poses que posicionam as mãos por conta própria (o item vai onde a pose manda). */
const OWN_HANDS: ReadonlySet<Pose> = new Set<Pose>(['play', 'drink', 'raise_hand', 'stretch', 'cheer', 'laugh', 'game', 'rps', 'groom', 'sulk', 'wait', 'use', 'type', 'sleep', 'talk']);

export function frameOf(pose: Pose, frame: number): number {
  const n = POSE_FRAMES[pose] ?? 1;
  return ((Math.floor(frame) % n) + n) % n;
}

/** Corpo base (em pé ou sentado), com deslocamentos simples. */
function base(seated: boolean, held: HeldItem): Rig {
  const hip = J3(0, 0, seated ? SEAT_HIP_Z : HIP_Z);
  const chest = J3(0, 0, hip.z + TORSO);
  const head = J3(0.6, 0, chest.z + HEAD_UP);
  return {
    seated,
    hip,
    chest,
    head,
    nod: 0,
    far: { leg: seated ? legSeated(hip, -1) : legStand(hip, -1), arm: armDown(chest, -1) },
    near: { leg: seated ? legSeated(hip, 1) : legStand(hip, 1), arm: armDown(chest, 1) },
    eyes: 'open',
    mouth: 'smile',
    brows: 'normal',
    held,
    itemHand: 'near',
    itemAt: null,
    kernel: null,
    crossed: null,
    slump: 0,
  };
}

/** Sobe/desce o tronco inteiro (quadril, ombros, cabeça) sem mexer nos pés. */
function lift(r: Rig, dz: number, legsToo = false): void {
  r.hip = J3(r.hip.f, r.hip.n, r.hip.z + dz);
  r.chest = J3(r.chest.f, r.chest.n, r.chest.z + dz);
  r.head = J3(r.head.f, r.head.n, r.head.z + dz);
  if (legsToo) {
    for (const s of [r.far, r.near]) {
      s.leg = { ...s.leg, a: up(s.leg.a, dz), b: up(s.leg.b, dz), c: up(s.leg.c, dz) };
    }
  }
}

const up = (p: J, dz: number): J => J3(p.f, p.n, p.z + dz);

/** Inclina o tronco para a frente (lean > 0) levando ombros e cabeça. */
function lean(r: Rig, df: number, headExtra = 0): void {
  r.chest = J3(r.chest.f + df, r.chest.n, r.chest.z - Math.abs(df) * 0.15);
  r.head = J3(r.head.f + df * 1.25 + headExtra, r.head.n, r.head.z - Math.abs(df) * 0.25);
}

/** Refaz os braços pendurados depois de mexer no tronco. */
function relaxArms(r: Rig, swingFar = 0, swingNear = 0): void {
  r.far.arm = armDown(r.chest, -1, swingFar, 0.8, r.slump);
  r.near.arm = armDown(r.chest, 1, swingNear, 0.8, r.slump);
}

function legs(r: Rig, farDf: number, farLift: number, nearDf: number, nearLift: number, farPitch = 0, nearPitch = 0): void {
  r.far.leg = legStand(r.hip, -1, farDf, farLift, farPitch);
  r.near.leg = legStand(r.hip, 1, nearDf, nearLift, nearPitch);
}

/** Mão de perto segurando um item de uma mão diante do corpo (cotovelo dobrado). */
function carry(r: Rig): ArmRig {
  const c = r.chest;
  return armTo(c, 1, J3(c.f + 4.4, c.n + 4.4, c.z - 8), { pole: J3(-1, 0.6, -0.5), shape: 'grip' });
}

/** As duas mãos segurando um item à frente do peito. */
function hold2(r: Rig, df = 5, dz = -7.2, spread = 3): void {
  const c = r.chest;
  r.far.arm = armTo(c, -1, J3(c.f + df, c.n - spread, c.z + dz), { pole: J3(-0.6, -1, -0.6), shape: 'grip' });
  r.near.arm = armTo(c, 1, J3(c.f + df, c.n + spread, c.z + dz), { pole: J3(-0.6, 1, -0.6), shape: 'grip' });
  r.itemHand = 'both';
}

export function makeRig(req: CharacterFrameRequest): Rig {
  const pose = req.pose;
  const f = frameOf(pose, req.frame);
  const seated = isSeated(pose, req.seated);
  const held: HeldItem = req.held ?? 'none';
  const r = base(seated, held);

  switch (pose) {
    case 'stand':
    case 'sit':
      if (f === 1) r.head = up(r.head, -1);
      if (seated) restHands(r);
      break;
    case 'walk':
    case 'run':
      gait(r, f, pose === 'run');
      break;
    case 'type':
      typeRig(r, f);
      break;
    case 'sleep':
      r.eyes = 'closed';
      r.mouth = 'none';
      r.slump = 1;
      r.head = J3(r.head.f + 1.2, 0, r.head.z - (f === 0 ? 1.4 : 2));
      r.nod = 2;
      r.chest = J3(r.chest.f + 0.6, 0, r.chest.z - 0.5);
      restHands(r, true);
      break;
    case 'drink':
      drinkRig(r, f);
      break;
    case 'use': {
      const c = r.chest;
      const p = f === 1 ? 1 : 0;
      r.near.arm = armTo(c, 1, J3(c.f + 8.6 + p, c.n + 3.6, c.z - 2.5 + p * 0.5), { pole: J3(-0.3, 1, -0.8), shape: 'flat' });
      break;
    }
    case 'raise_hand': {
      const c = r.chest;
      const w = f === 1 ? 1 : 0;
      r.near.arm = armTo(c, 1, J3(c.f + 1 + w * 0.5, c.n + 6.4 + w * 0.8, c.z + 11.5 - w), { pole: J3(0, 1, -1), shape: 'open' });
      r.mouth = f === 0 ? 'open' : 'smile';
      r.brows = 'up';
      break;
    }
    case 'talk': {
      const c = r.chest;
      r.mouth = f === 0 ? 'open' : 'smile';
      if (f === 0) r.near.arm = armTo(c, 1, J3(c.f + 5, c.n + 6, c.z - 5), { pole: J3(-1, 0.6, -0.6), shape: 'open' });
      else r.far.arm = armTo(c, -1, J3(c.f + 5, c.n - 6, c.z - 4.6), { pole: J3(-1, -0.6, -0.6), shape: 'open' });
      break;
    }
    case 'stretch': {
      r.eyes = 'closed';
      r.mouth = 'open';
      if (f === 1) lift(r, 1);
      const c = r.chest;
      const hz = c.z + (f === 0 ? 12.6 : 13.6);
      r.far.arm = armTo(c, -1, J3(c.f - 0.4, c.n - 3.4, hz), { pole: J3(0, -1, 0), shape: 'fist' });
      r.near.arm = armTo(c, 1, J3(c.f - 0.4, c.n + 3.4, hz), { pole: J3(0, 1, 0), shape: 'fist' });
      break;
    }
    case 'read':
      if (held === 'none') r.held = 'book';
      r.nod = 1;
      if (f === 1) r.head = up(r.head, -1);
      if (r.held === 'phone') {
        const c = r.chest;
        r.near.arm = armTo(c, 1, J3(c.f + 5.4, c.n + 2.2, c.z - 4.4), { pole: J3(-1, 0.8, -0.6), shape: 'grip' });
      } else hold2(r, 5.6, -5.6, 3);
      break;
    case 'play': {
      r.held = 'paddle';
      const c = r.chest;
      r.near.arm =
        f === 0
          ? armTo(c, 1, J3(c.f - 2.4, c.n + 8, c.z - 4.6), { pole: J3(-1, 1, -0.5), shape: 'grip' })
          : armTo(c, 1, J3(c.f + 7, c.n + 4.4, c.z - 3.2), { pole: J3(-0.5, 1, -0.5), shape: 'grip' });
      r.far.arm = armTo(c, -1, J3(c.f + 3, c.n - 6.6, c.z - 6.6), { pole: J3(-1, -0.6, -0.5), shape: 'open' });
      break;
    }
    case 'wait':
      waitRig(r, f, held);
      break;
    case 'cheer': {
      const jump = f === 1;
      r.mouth = 'open';
      r.brows = 'up';
      if (jump) {
        r.eyes = 'happy';
        if (seated) lift(r, 1);
        else lift(r, 2, true);
      }
      const c = r.chest;
      const hz = c.z + (jump ? 12 : 10.6);
      const out = jump ? 7 : 6.4;
      r.far.arm = armTo(c, -1, J3(c.f + 0.5, c.n - out, hz), { pole: J3(0, -1, -0.4), shape: 'fist' });
      r.near.arm = armTo(c, 1, J3(c.f + 0.5, c.n + out, hz), { pole: J3(0, 1, -0.4), shape: 'fist' });
      break;
    }
    case 'laugh': {
      r.eyes = 'happy';
      r.mouth = f === 0 ? 'wide' : 'open';
      if (f === 0) lift(r, 1);
      else lean(r, 1.2);
      const c = r.chest;
      r.near.arm = armTo(c, 1, J3(c.f + 3.2, c.n + 2, c.z - 8.4), { pole: J3(-0.4, 1, -0.6), shape: 'open' });
      r.far.arm = f === 0 ? armDown(c, -1, 0.5) : armTo(c, -1, J3(c.f + 3, c.n - 5.6, c.z - 11.4), { pole: J3(-1, -0.6, 0), shape: 'flat' });
      break;
    }
    case 'game': {
      r.held = 'controller';
      lean(r, 1.4);
      const c = r.chest;
      const a = f === 0 ? 0.7 : 0;
      const b = f === 0 ? 0 : 0.7;
      r.far.arm = armTo(c, -1, J3(c.f + 5, c.n - 2, c.z - 7.4 + a), { pole: J3(-0.6, -1, -0.6), shape: 'grip' });
      r.near.arm = armTo(c, 1, J3(c.f + 5, c.n + 2, c.z - 7.4 + b), { pole: J3(-0.6, 1, -0.6), shape: 'grip' });
      r.itemHand = 'both';
      break;
    }
    case 'rps':
      rpsRig(r, f, held);
      break;
    case 'groom':
      groomRig(r, f, held);
      break;
    case 'sulk':
      r.eyes = 'half';
      r.mouth = 'frown';
      r.brows = 'sad';
      r.slump = 1.4;
      r.nod = 2;
      r.chest = J3(r.chest.f + 0.4, 0, r.chest.z - 0.6);
      r.head = J3(r.head.f + 0.8, 0, r.head.z - (f === 0 ? 1 : 1.6));
      relaxArms(r, 0.6, 0.6);
      if (seated) restHands(r, true);
      break;
  }

  // Itens: braços para segurar quando a pose não cuida das mãos.
  const h = r.held;
  if (h !== 'none' && !OWN_HANDS.has(pose) && !r.itemAt && !GESTURES.has(h)) {
    if (TWO_HANDED.has(h) || pose === 'read') {
      if (pose !== 'read') hold2(r, 5, -7.6, 3.2);
    } else if (h !== 'paddle' || pose === 'stand' || pose === 'sit') r.near.arm = carry(r);
  }
  if (h === 'paddle' && pose !== 'play' && pose !== 'stand' && pose !== 'walk' && pose !== 'run' && pose !== 'sit') r.held = 'none';
  return r;
}

/** Mãos apoiadas nas coxas (sentado). */
function restHands(r: Rig, lap = false): void {
  const c = r.chest;
  const z = r.hip.z + 1.6;
  r.far.arm = armTo(c, -1, J3(r.hip.f + (lap ? 3.6 : 4.6), -(lap ? 2 : 3.4), z), { pole: J3(-1, -0.8, 0), shape: 'flat', slump: r.slump });
  r.near.arm = armTo(c, 1, J3(r.hip.f + (lap ? 4 : 4.6), lap ? 2.2 : 3.4, z), { pole: J3(-1, 0.8, 0), shape: 'flat', slump: r.slump });
}

/** Andar e correr: 4 quadros (contato, passagem, contato do outro pé, passagem). */
function gait(r: Rig, f: number, run: boolean): void {
  const stride = run ? 4.6 : 3.1;
  const lifted = run ? 3.4 : 2;
  const bob = run ? [0, 2, 0, 2][f] : [0, 1, 0, 1][f];
  lift(r, bob);
  if (run) lean(r, 2.4, 0.4);
  // perto: f0 à frente, f2 atrás
  const nearDf = [stride, 0.6, -stride, 0.8][f];
  const farDf = [-stride, 0.8, stride, 0.6][f];
  const nearLift = f === 3 ? lifted : 0;
  const farLift = f === 1 ? lifted : 0;
  legs(r, farDf, farLift, nearDf, nearLift, f === 0 ? -0.8 : f === 2 ? 0.6 : 0, f === 0 ? 0.6 : f === 2 ? -0.8 : 0);
  if (run) {
    // pé de trás quase só na ponta, joelho da passagem bem alto
    if (f === 1) r.far.leg = legStand(r.hip, -1, 2, lifted, 0);
    if (f === 3) r.near.leg = legStand(r.hip, 1, 2, lifted, 0);
  }
  const swing = (run ? 3.4 : 2.4) * [-1, 0, 1, 0][f];
  const c = r.chest;
  if (run) {
    // braços dobrados em 90°, balançando
    const s = swing;
    r.far.arm = armTo(c, -1, J3(c.f + s + 2, c.n - 6, c.z - 7 + Math.abs(s) * 0.3), { pole: J3(-1, -0.4, -0.6), shape: 'fist' });
    r.near.arm = armTo(c, 1, J3(c.f - s + 2, c.n + 6, c.z - 7 + Math.abs(s) * 0.3), { pole: J3(-1, 0.4, -0.6), shape: 'fist' });
  } else relaxArms(r, -swing, swing);
}

function typeRig(r: Rig, f: number): void {
  lean(r, 0.8);
  const c = r.chest;
  const upA = f % 2 === 0 ? 0.8 : 0;
  const upB = f % 2 === 0 ? 0 : 0.8;
  const shift = f >= 2 ? 0.6 : 0;
  r.far.arm = armTo(c, -1, J3(c.f + 8.8, c.n - 3 + shift, c.z - 5.4 + upA), { pole: J3(-0.6, -1, -0.8), shape: 'flat' });
  r.near.arm = armTo(c, 1, J3(c.f + 8.8, c.n + 3 + shift, c.z - 5.4 + upB), { pole: J3(-0.6, 1, -0.8), shape: 'flat' });
}

function drinkRig(r: Rig, f: number): void {
  if (r.held === 'none') r.held = 'coffee';
  const c = r.chest;
  if (f === 1) {
    r.near.arm = armTo(c, 1, J3(c.f + 4.6, c.n + 1.4, c.z + 3), { pole: J3(-0.4, 1, -0.8), shape: 'grip' });
    r.head = J3(r.head.f - 0.3, 0, r.head.z + 0.4);
    r.eyes = 'closed';
    r.mouth = 'none';
  } else {
    r.near.arm = armTo(c, 1, J3(c.f + 4.4, c.n + 4, c.z - 6), { pole: J3(-1, 0.6, -0.6), shape: 'grip' });
  }
  if (r.seated) restHand(r, -1);
}

function restHand(r: Rig, side: 1 | -1): void {
  const c = r.chest;
  const arm = armTo(c, side, J3(r.hip.f + 4.6, side * 3.4, r.hip.z + 1.6), { pole: J3(-1, side * 0.8, 0), shape: 'flat' });
  if (side === 1) r.near.arm = arm;
  else r.far.arm = arm;
}

function waitRig(r: Rig, f: number, held: HeldItem): void {
  // recostado: tronco e cabeça um pouco para trás
  r.chest = J3(r.chest.f - 0.8, 0, r.chest.z - 0.3);
  r.head = J3(r.head.f - 1, 0, r.head.z - 0.4);
  const c = r.chest;
  const eat = f === 1;
  if (held === 'popcorn') {
    r.itemAt = J3(4.8, 0.4, r.hip.z + 2.6);
    r.far.arm = armTo(c, -1, J3(4.4, -3, r.hip.z + 5), { pole: J3(-1, -0.8, -0.4), shape: 'grip' });
    r.near.arm = eat
      ? armTo(c, 1, J3(c.f + 4.4, c.n + 1.2, c.z + 2.8), { pole: J3(-0.3, 1, -1), shape: 'fist' })
      : armTo(c, 1, J3(5.2, 2.4, r.hip.z + 6.4), { pole: J3(-1, 0.8, -0.4), shape: 'grip' });
    r.mouth = eat ? 'none' : 'chew';
    if (eat) r.kernel = J3(c.f + 5, c.n + 0.6, c.z + 4);
    return;
  }
  if (held !== 'none') {
    restHand(r, -1);
    r.near.arm = carry(r);
    return;
  }
  // braços cruzados, dedos e pé batendo, olhar entediado
  r.eyes = 'half';
  r.mouth = 'none';
  r.brows = 'flat';
  r.crossed = eat ? 1 : 0;
  r.far.arm = armTo(c, -1, J3(c.f + 3.2, c.n + 3.6, c.z - 6.2), { pole: J3(-0.5, -1, -0.6), shape: 'flat' });
  r.near.arm = armTo(c, 1, J3(c.f + 2.8, c.n - 3.6, c.z - 5.2 + (eat ? 0.8 : 0)), { pole: J3(-0.5, 1, -0.6), shape: 'flat' });
  if (eat) r.near.leg = legSeated(r.hip, 1, 1.2);
}

function rpsRig(r: Rig, f: number, held: HeldItem): void {
  const c = r.chest;
  const reveal = GESTURES.has(held);
  if (!reveal) {
    r.held = 'none';
    const upF = f === 0;
    r.mouth = upF ? 'open' : 'smile';
    r.near.arm = armTo(c, 1, J3(c.f + 3.2, c.n + 4.4, c.z + (upF ? 3.4 : -2.4)), { pole: J3(-0.6, 1, -1), shape: 'rock' });
    return;
  }
  r.held = 'none';
  const bob = f === 1 ? -0.8 : 0;
  r.near.arm = armTo(c, 1, J3(c.f + 8.8, c.n + 3.4, c.z - 1.6 + bob), { pole: J3(-0.4, 1, -1), shape: held as 'rock' | 'paper' | 'scissors' });
}

function groomRig(r: Rig, f: number, held: HeldItem): void {
  const c = r.chest;
  if (held === 'comb') {
    r.near.arm = armTo(c, 1, J3(c.f + (f === 0 ? 0.8 : 2), c.n + 5.4, c.z + (f === 0 ? 9.6 : 8.6)), { pole: J3(0, 1, -1), shape: 'grip' });
  } else {
    r.near.arm = armTo(c, 1, J3(c.f + 4.8, c.n + (f === 0 ? 1.4 : 0.6), c.z + 3.6), { pole: J3(-0.4, 1, -1), shape: 'grip' });
    if (held === 'lipstick') r.mouth = 'o';
  }
}
