// Personagem isométrico por peças (puro, sem DOM): folha fixa de SHEET_W x SHEET_H com a âncora no centro dos pés (ou no
// chão sob o quadril, quando sentado). 8 direções de TELA; só 5 são desenhadas (s, sw, w, nw, n) e ne, e, se são o
// espelho de nw, w, sw — o espelho é feito na composição, antes do sombreamento, então a luz continua de cima/esquerda.
import type { HeldItem, Pose } from '../api';
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';
import { drawArm, drawHood, drawLeg, drawNeck, drawPelvis, drawShoe, drawSkirt, drawTorso, hoodDepth, put } from './body';
import { costumeLayers, extraLayers, glassesLayer, hatLayers, lanyardLayers } from './gear';
import { hairBack, hairFront, type HairLayer, type Stage } from './hair';
import { drawHead } from './head';
import { itemLayer } from './items';
import type { Look } from './look';
import { AX, AY, SHEET_H, SHEET_W, composite, rnd } from './paint';
import { AVATAR_SEAT_HIP_Z, POSE_FRAMES, avatarFrames, isAvatarSeated, makeRig } from './poses';
import { TILT, makeView, proj, type Costume, type Ctx } from './rig';

export { AX as AVATAR_AX, AY as AVATAR_AY, SHEET_H as AVATAR_H, SHEET_W as AVATAR_W };
export { AVATAR_SEAT_HIP_Z, POSE_FRAMES, avatarFrames, isAvatarSeated, type Pose };

export type ScreenDir = 's' | 'sw' | 'w' | 'nw' | 'n' | 'ne' | 'e' | 'se';

export const SCREEN_DIRS: readonly ScreenDir[] = ['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se'];

export interface AvatarRequest {
  pose: Pose;
  frame: number;
  held?: HeldItem;
  seated?: boolean;
  costume?: Costume;
}

/** Ângulo de giro desenhado e se a direção é o espelho de uma desenhada. */
const DIRS: Record<ScreenDir, { phi: number; mirror: boolean }> = {
  s: { phi: 0, mirror: false },
  sw: { phi: 45, mirror: false },
  w: { phi: 90, mirror: false },
  nw: { phi: 135, mirror: false },
  n: { phi: 180, mirror: false },
  ne: { phi: 135, mirror: true },
  e: { phi: 90, mirror: true },
  se: { phi: 45, mirror: true },
};

export function renderAvatar(look: Look, dir: ScreenDir, req: AvatarRequest): BufSprite {
  const d = DIRS[dir];
  const buf = new PixelBuf(SHEET_W, SHEET_H);
  const v = makeView(d.phi);
  const rig = makeRig(req.pose, req.frame, req.seated, req.held);
  const c: Ctx = { look, v, rig, buf, mirror: d.mirror, costume: req.costume, dx: 0, dy: 0, frame: req.frame };

  // inclinação: o tronco de cima e a cabeça se deslocam em tela (antes do espelho); pernas e pelvis ficam
  const shiftOf = (f: number): [number, number] => [rnd(-f * v.s), rnd(TILT * f * v.c)];
  const upper = shiftOf(rig.lean);
  const head = shiftOf(rig.lean + rig.headF);
  const setShift = (s: [number, number]) => {
    c.dx = s[0];
    c.dy = s[1];
  };

  const placed: Record<Stage, HairLayer[]> = { behind: [], mid: [], after: [] };
  const add = (list: HairLayer[]) => {
    for (const p of list) placed[p.stage].push(p);
  };
  // fantasias de chapéu substituem o chapéu do visual
  const hatCostume = req.costume === 'santa' || req.costume === 'witch' || req.costume === 'pumpkin';
  add(hairBack(c));
  if (!hatCostume) add(hatLayers(c));
  add(extraLayers(c));
  add(lanyardLayers(c));
  add(costumeLayers(c));
  const glasses = glassesLayer(c);
  const front = hairFront(c);
  const item = itemLayer(c);
  if (item?.behind) placed.behind.push({ L: item.L, stage: 'behind', body: true });
  const flush = (stage: Stage) => {
    for (const p of placed[stage]) {
      setShift(p.body ? upper : head);
      put(c, p.L);
    }
  };

  const depthOf = (j: { l: number; f: number; z: number }): number => proj(v, j.l, j.f, j.z).d;
  const armDepth = (i: 0 | 1) => (depthOf(rig.arms[i].mid) + depthOf(rig.arms[i].end)) / 2;
  const armBehind = (i: 0 | 1) => armDepth(i) < -1.2;
  const armOverHead = (i: 0 | 1) => !armBehind(i) && rig.arms[i].end.z > rig.headZ - 10 && depthOf(rig.arms[i].end) > 1;
  const byDepth = (a: 0 | 1, b: 0 | 1) => armDepth(a) - armDepth(b);
  const idx = [0, 1] as const;

  // 1) atrás de tudo
  setShift(upper);
  const hoodBehind = look.top === 'hoodie' && hoodDepth(c) < 0;
  if (hoodBehind) drawHood(c);
  flush('behind');

  // 2) braços de trás, pernas (de trás para a frente), quadril, saia, pescoço e tronco
  for (const i of idx.filter(armBehind).sort(byDepth)) drawArm(c, i, false);
  setShift([0, 0]);
  if (!(rig.seated && v.c < -0.2)) {
    // sentado de costas as pernas ficam escondidas pelo assento
    const legs = idx.slice().sort((a, b) => rig.legs[a].root.l * v.s - rig.legs[b].root.l * v.s);
    for (const i of legs) {
      drawLeg(c, i);
      drawShoe(c, i);
    }
  }
  drawPelvis(c);
  setShift(upper);
  drawSkirt(c);
  drawNeck(c);
  drawTorso(c);
  if (look.top === 'hoodie' && !hoodBehind) drawHood(c);
  flush('mid');

  // 3) braços da frente, cabeça e o que vai por cima dela
  for (const i of idx.filter((k) => !armBehind(k) && !armOverHead(k)).sort(byDepth)) drawArm(c, i, true);
  setShift(head);
  drawHead(c);
  if (front) {
    front.inner = true;
    put(c, front);
  }
  flush('after');
  setShift(upper);
  for (const i of idx.filter(armOverHead).sort(byDepth)) drawArm(c, i, true);
  if (item && !item.behind) put(c, item.L);
  if (glasses) {
    setShift(head);
    put(c, glasses);
  }

  buf.outline();
  buf.shadow(AX, AY, 6.5, 2.7, '#1c2034', 0.22);
  return { buf, ax: AX, ay: AY };
}
