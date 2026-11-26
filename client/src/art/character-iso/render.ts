// Personagens da visão isométrica (puro): folha fixa de ISO_CHAR_W x ISO_CHAR_H com a âncora no centro dos pés.
// Duas vistas desenhadas a partir do mesmo rig 3D — frente 3/4 ('down', olhando para baixo-esquerda) e costas 3/4
// ('up', para cima-direita) — e as outras duas são o espelho geométrico delas ('right' e 'left'), com a luz
// recalculada na tela (sempre de cima/esquerda).
import type { CharacterFrameRequest } from '../api';
import type { BufSprite } from '../core/sprite';
import { drawArm, drawHand, drawLeg, drawPelvis, drawTorso, type Ctx } from './body';
import { drawCostumeBack, drawCostumeFront, drawCostumeMid, drawHeadwear, drawItem, drawKernel, itemOf } from './extras';
import { drawHairBack, drawHairFront } from './hair';
import { drawEar, drawFace, drawFacialHair, drawHeadSkin, drawNeck, headMask } from './head';
import { Painter } from './paint';
import { palOf } from './pal';
import { makeRig } from './poses';
import { depth, type ArmRig, type J, type View } from './rig';

export const ISO_CHAR_W = 32;
export const ISO_CHAR_H = 52;
export const ISO_CHAR_AX = 16;
export const ISO_CHAR_AY = 47;

export function isoView(dir: CharacterFrameRequest['dir']): View {
  return { back: dir === 'up' || dir === 'left', m: dir === 'right' || dir === 'left' ? -1 : 1 };
}

export function renderIsoCharacter(req: CharacterFrameRequest): BufSprite {
  const v = isoView(req.dir);
  const P = new Painter(ISO_CHAR_W, ISO_CHAR_H, ISO_CHAR_AX, ISO_CHAR_AY, v.m);
  const r = makeRig(req);
  const c: Ctx = { P, v, r, a: req.appearance, p: palOf(req.appearance), costume: req.costume };
  const item = itemOf(c);

  const armD = (arm: ArmRig) => (depth(v, arm.b) + depth(v, arm.c) * 2) / 3;
  const arms = [r.far.arm, r.near.arm];
  // à frente do tronco = fora da caixa do tronco por um lado que dá para a câmera (frente/costas ou lado de perto)
  const fs = v.back ? -1 : 1;
  const front = (q: J) => Math.max(fs * (q.f - r.chest.f) - 1.8, q.n - 5);
  const behind = (arm: ArmRig) => front(arm.c) < 0;
  const raised = (arm: ArmRig) => arm.c.z > r.head.z - 9;
  // braço erguido na frente do rosto/ao lado da cabeça vai por cima dela; erguido acima da cabeça, por trás
  const overHead = (arm: ArmRig) => raised(arm) && depth(v, arm.c) > 1 && !(arm.c.z > r.head.z + 6 && Math.abs(arm.c.n) < 8.5);
  const holds = (arm: ArmRig) => item && (item.hand === 'both' || (item.hand === 'near') === (arm === r.near.arm));

  const armAndItem = (arm: ArmRig, dim = 0) => {
    drawArm(c, arm, { dim });
    drawHand(c, arm, dim);
    // itens pequenos por cima da mão (a mão fica por baixo/atrás, segurando)
    if (item && item.hand !== 'both' && !item.fixed && holds(arm) && !item.drawn) {
      drawItem(c, item);
      item.drawn = true;
    }
  };

  // 1) atrás de tudo
  const hm = headMask(c);
  drawCostumeBack(c);
  drawHairBack(c, hm);
  if (item && item.fixed && r.itemAt && front(r.itemAt) < 0) {
    drawItem(c, item);
    item.drawn = true;
  }
  const backArms = arms.filter(behind).sort((x, y) => armD(x) - armD(y));
  for (const arm of backArms) armAndItem(arm, 0.05);
  if (item?.hand === 'both' && backArms.length === 2 && !item.drawn) {
    drawItem(c, item);
    item.drawn = true;
    for (const arm of backArms) drawHand(c, arm, 0.05);
  }

  // 2) pernas, quadril e tronco (sentado de frente, as coxas vêm por cima do tronco)
  const legs = [r.far.leg, r.near.leg].sort((x, y) => depth(v, x.b) - depth(v, y.b));
  const legsFirst = !(r.seated && !v.back);
  if (legsFirst) for (const l of legs) drawLeg(c, l);
  drawPelvis(c);
  drawTorso(c);
  if (!legsFirst) for (const l of legs) drawLeg(c, l);
  drawCostumeMid(c);

  // 3) braços na frente do tronco (abaixo da cabeça)
  const mid = arms.filter((x) => !behind(x) && !overHead(x)).sort((x, y) => armD(x) - armD(y));
  if (item && item.fixed && !item.drawn) {
    drawItem(c, item);
    item.drawn = true;
  }
  if (item?.hand === 'both' && !item.drawn) {
    // o controle fica por cima das mãos (polegares); caixa, livro e papéis ficam entre elas
    const onTop = item.kind === 'controller';
    for (const arm of mid) drawArm(c, arm);
    if (!onTop) drawItem(c, item);
    for (const arm of mid) drawHand(c, arm);
    if (onTop) drawItem(c, item);
    item.drawn = true;
  } else for (const arm of mid) armAndItem(arm);

  // 4) cabeça
  drawNeck(c);
  const head = drawHeadSkin(c);
  drawFace(c);
  drawFacialHair(c, head);
  const earsCovered = drawHairFront(c, hm);
  if (!earsCovered) drawEar(c);
  drawHeadwear(c);
  drawCostumeFront(c, hm);

  // 5) braços erguidos na frente da cabeça e o item, se ainda faltar
  for (const arm of arms.filter((x) => !behind(x) && overHead(x))) armAndItem(arm);
  if (item && !item.drawn) drawItem(c, item);
  drawKernel(c);

  P.buf.outline();
  if (!r.seated) P.buf.shadow(ISO_CHAR_AX, ISO_CHAR_AY + 0.5, 6, 3, '#1c2034', 0.2);
  return { buf: P.buf, ax: ISO_CHAR_AX, ay: ISO_CHAR_AY };
}
