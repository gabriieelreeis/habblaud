import { describe, expect, it } from 'vitest';
import { FURNITURE, TILE, type FurnitureKind } from '../../art/api';
import { appearanceFromSeed } from '../../art/character/appearance';
import { renderIsoCharacter } from '../../art/character-iso/render';
import type { BufSprite } from '../../art/core/sprite';
import { renderIsoFurniture } from '../../art/iso/index';
import { renderIsoWall } from '../../art/iso/walls';
import { isoSort, isoX, isoY, wallSlices, type Box } from '../iso';
import { layoutCafe } from '../layout/core';
import { layoutCorridor } from '../layout/corridor';
import { furnitureFacing } from '../layout/facing';
import { layoutProjectRoom } from '../layout/room';
import type { AreaLayout } from '../layout/types';
import { roomTheme } from '../../art/theme';
import { blendOnto, buildGrid, composeLayer, frontMask, markFront, maskBehind, restoreFront, type Composite, type LayerItem } from './compose';
import { wallPlan } from './wall-plan';

const px = (s: BufSprite) => ({ data: s.buf.data, w: s.buf.w, h: s.buf.h });

/** Fatias das muretas (frente e lateral leste das salas), para os testes de oclusão. */
const lowWalls = new Set<LayerItem>();

/** Os mesmos pedaços que o renderizador põe na camada: móveis (base e front) e todas as paredes, em fatias. */
function itemsOf(areas: AreaLayout[]): LayerItem[] {
  const out: LayerItem[] = [];
  for (const a of areas) {
    for (const f of a.furniture) {
      const fp = FURNITURE[f.kind].footprint;
      const box: Box = { x0: f.tx * TILE + (f.dx ?? 0), y0: f.ty * TILE + (f.dy ?? 0), x1: (f.tx + fp.w) * TILE + (f.dx ?? 0), y1: (f.ty + fp.h) * TILE + (f.dy ?? 0) };
      const fs = renderIsoFurniture(f.kind, f.variant, 0, 3, furnitureFacing(a, f));
      for (const [s, bias] of [[fs.base, 0], ...(fs.front ? [[fs.front, 1]] : [])] as [BufSprite, number][]) {
        const dx = Math.round(isoX(box.x0, box.y0) - s.ax);
        const dy = Math.round(isoY(box.x0, box.y0) - s.ay);
        out.push({ box, rect: { x: dx, y: dy, w: s.buf.w, h: s.buf.h }, bias, px: px(s), sx: 0, sy: 0, sw: s.buf.w, sh: s.buf.h, dx, dy });
      }
    }
    for (const w of wallPlan(a)) {
      const sp = renderIsoWall(w.seg.style, w.spec);
      for (const q of wallSlices(sp.ax, sp.ay, sp.buf.w, sp.buf.h, w.plane, w.thick)) {
        const it: LayerItem = { box: q.box, rect: q.rect, bias: 0, px: px(sp), sx: q.sx0, sy: 0, sw: q.sx1 - q.sx0, sh: sp.buf.h, dx: q.dx, dy: q.dy };
        if (!w.tall) lowWalls.add(it);
        out.push(it);
      }
    }
  }
  return out;
}

const scene = (() => {
  const room = (slot: number, seed: number) => layoutProjectRoom({ id: `sala${slot}`, slot, seed }, roomTheme(slot));
  const areas = [layoutCorridor(5), layoutCafe(), room(0, 3), room(1, 5), room(4, 7), room(5, 11)];
  const order = isoSort(itemsOf(areas));
  const comp = composeLayer(order)!;
  return { areas, order, comp, grid: buildGrid(order) };
})();

const person = renderIsoCharacter({ appearance: appearanceFromSeed(42, { look: 'f' }), dir: 'down', pose: 'stand', frame: 0, costume: 'santa' });

/** Desenha alguém em pé em (x, y) (px de mundo) sobre a camada, com a máscara; devolve o quadro e o desenho mascarado. */
function withPerson(c: Composite, x: number, y: number) {
  const ex = Math.round(isoX(x, y) - person.ax);
  const ey = Math.round(isoY(x, y) - person.ay);
  const w = person.buf.w;
  const h = person.buf.h;
  const ent = { box: { x0: x - 4, y0: y - 4, x1: x + 4, y1: y + 4 }, rect: { x: ex, y: ey, w, h }, bias: 0.5 };
  const flags = new Uint8Array(scene.order.length);
  const list: number[] = [];
  const front = markFront(ent, scene.order, scene.grid, flags, list);
  const sprite = new Uint8ClampedArray(person.buf.data);
  // quantos pixels cada item da camada escondeu (o dono do pixel, entre os da frente)
  const byOwner = new Map<number, number>();
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if (!sprite[(j * w + i) * 4 + 3]) continue;
      const lx = ex + i - c.x;
      const ly = ey + j - c.y;
      if (lx < 0 || ly < 0 || lx >= c.w || ly >= c.h) continue;
      const id = c.ids[ly * c.w + lx];
      if (id && flags[id - 1]) byOwner.set(id - 1, (byOwner.get(id - 1) ?? 0) + 1);
    }
  // como o renderizador: desenha a pessoa inteira e devolve os pixels da camada onde o cenário fica na frente
  const frame = new Uint8ClampedArray(c.rgba);
  blendOnto(frame, c, person.buf.data, w, h, ex, ey);
  restoreFront(frame, c, frontMask(ex, ey, w, h, c, flags), ex, ey, w, h);
  // o mesmo que esconder os pixels dela ali
  const hidden = maskBehind(sprite, w, h, ex, ey, c, flags);
  const direct = new Uint8ClampedArray(c.rgba);
  blendOnto(direct, c, sprite, w, h, ex, ey);
  return { frame, direct, sprite, ex, ey, w, h, hidden, front: front.n, byOwner };
}

/** Todos os pontos (px de mundo) de uma faixa de tiles, de 4 em 4 px. */
function points(tx0: number, ty0: number, tw: number, th: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = ty0 * TILE; y < (ty0 + th) * TILE; y += 4) for (let x = tx0 * TILE; x < (tx0 + tw) * TILE; x += 4) out.push([x + 2, y + 2]);
  return out;
}

describe('camada com dono por pixel', () => {
  it('o dono de cada pixel é o último item opaco; sombra e vidro não viram dono', () => {
    const red = { data: new Uint8ClampedArray([255, 0, 0, 255]), w: 1, h: 1 };
    const ghost = { data: new Uint8ClampedArray([0, 0, 255, 60]), w: 1, h: 1 };
    const base = { box: { x0: 0, y0: 0, x1: 1, y1: 1 }, rect: { x: 0, y: 0, w: 1, h: 1 }, sx: 0, sy: 0, sw: 1, sh: 1, dx: 0, dy: 0 };
    const c = composeLayer([{ ...base, px: red }, { ...base, px: ghost }])!;
    expect(c.ids[0]).toBe(1);
    expect(c.rgba[3]).toBe(255);
    expect(c.rgba[2]).toBeGreaterThan(0);
  });

  it('com alguém em qualquer lugar (bebedouro do corredor, copa, sala), o cenário fora do desenho dele fica idêntico', () => {
    const c = scene.comp;
    // corredor (bebedouros e bancos), copa e salas: centenas de posições; confere uma janela de 48 px em volta dele
    const spots = [...points(2 * 16 + 1, 12, 6, 5), ...points(2 * 16 + 1, 9, 8, 3), ...points(16 + 2, 3, 8, 6), ...points(4 * 16 + 1, 3, 6, 6)];
    let checked = 0;
    for (const [x, y] of spots) {
      const r = withPerson(c, x, y);
      // devolver os pixels da camada dá o mesmo quadro que esconder os pixels da pessoa
      if (checked % 10 === 0) {
        let same = 0;
        let total = 0;
        for (let j = Math.max(0, r.ey - c.y); j < Math.min(c.h, r.ey + r.h - c.y); j++)
          for (let i = Math.max(0, r.ex - c.x); i < Math.min(c.w, r.ex + r.w - c.x); i++) {
            const k = (j * c.w + i) * 4;
            total++;
            if (r.frame[k] === r.direct[k] && r.frame[k + 1] === r.direct[k + 1] && r.frame[k + 2] === r.direct[k + 2] && r.frame[k + 3] === r.direct[k + 3]) same++;
          }
        expect(same, `(${x},${y}) devolver a camada = esconder a pessoa`).toBe(total);
      }
      const j0 = Math.max(0, r.ey - 48 - c.y);
      const j1 = Math.min(c.h, r.ey + r.h + 48 - c.y);
      const i0 = Math.max(0, r.ex - 48 - c.x);
      const i1 = Math.min(c.w, r.ex + r.w + 48 - c.x);
      for (let j = j0; j < j1; j++) {
        const ty = j + c.y;
        const insideY = ty >= r.ey && ty < r.ey + r.h;
        for (let i = i0; i < i1; i++) {
          const tx = i + c.x;
          const k = (j * c.w + i) * 4;
          if (r.frame[k] === c.rgba[k] && r.frame[k + 1] === c.rgba[k + 1] && r.frame[k + 2] === c.rgba[k + 2] && r.frame[k + 3] === c.rgba[k + 3]) continue;
          // mudou: só pode ser um pixel visível do próprio personagem
          const inside = insideY && tx >= r.ex && tx < r.ex + r.w;
          expect(inside, `(${x},${y}) mudou o cenário em ${tx},${ty}`).toBe(true);
          const s = ((ty - r.ey) * r.w + (tx - r.ex)) * 4 + 3;
          expect(r.sprite[s], `(${x},${y}) pixel ${tx},${ty}`).toBeGreaterThan(0);
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(400);
    // e o quadro inteiro, em algumas posições: nada muda longe dele
    for (const [x, y] of spots.filter((_, k) => k % 97 === 0)) {
      const r = withPerson(c, x, y);
      let diff = 0;
      for (let k = 0; k < c.rgba.length; k++) if (r.frame[k] !== c.rgba[k]) diff++;
      let opaque = 0;
      for (let k = 3; k < r.sprite.length; k += 4) if (r.sprite[k]) opaque++;
      expect(diff).toBeLessThanOrEqual(opaque * 4);
    }
  }, 120_000);

  it('mureta: quem está no corredor aparece inteiro; dentro da sala, junto dela, some a parte de baixo', () => {
    const c = scene.comp;
    const low = new Set(scene.order.map((it, i) => (lowWalls.has(it) ? i : -1)).filter((i) => i >= 0));
    expect(low.size).toBeGreaterThan(20);
    const byLow = (r: ReturnType<typeof withPerson>) => [...low].reduce((n, i) => n + (r.byOwner.get(i) ?? 0), 0);
    const front = scene.areas.find((a) => a.id === 'sala0')!.walls.find((w) => w.kind === 'south')!;
    let behind = 0;
    for (let x = front.x + 8; x < front.x + front.w - 8; x += 6) {
      // no corredor (a primeira fileira começa no fim do tile da mureta), perto do bebedouro e da porta
      for (const dy of [TILE + 2, TILE + 8, TILE + 18]) expect(byLow(withPerson(c, x, front.y + dy)), `corredor ${x},${front.y + dy}`).toBe(0);
      // dentro da sala, encostado nela: a mureta cobre as pernas (menos no vão da porta)
      if (byLow(withPerson(c, x, front.y - 4)) > 0) behind++;
    }
    expect(behind).toBeGreaterThan(20);
  });

  it('atrás de móvel alto, some só a parte de trás; na frente, aparece inteiro', () => {
    const c = scene.comp;
    const shelves = scene.areas.flatMap((a) => a.furniture.filter((f) => f.kind === 'bookshelf' || f.kind === 'water_cooler' || f.kind === 'plant_tall').map((f) => ({ a, f })));
    let tested = 0;
    const own = (box: { x0: number; y0: number }) => new Set(scene.order.map((it, i) => (it.box.x0 === box.x0 && it.box.y0 === box.y0 ? i : -1)).filter((i) => i >= 0));
    for (const { f } of shelves) {
      const fp = FURNITURE[f.kind as FurnitureKind].footprint;
      const cx = (f.tx + fp.w / 2) * TILE;
      const ids = own({ x0: f.tx * TILE + (f.dx ?? 0), y0: f.ty * TILE + (f.dy ?? 0) });
      const by = (r: ReturnType<typeof withPerson>) => [...ids].reduce((n, i) => n + (r.byOwner.get(i) ?? 0), 0);
      // na frente (ao sul): o móvel não esconde nada dele
      const front = withPerson(c, cx, (f.ty + fp.h) * TILE + 6);
      expect(by(front), `${f.kind} na frente`).toBe(0);
      // logo atrás (ao norte): a parte que o móvel cobre some
      const behind = withPerson(c, cx, f.ty * TILE - 6);
      if (behind.front > 0 && by(behind) > 0) tested++;
    }
    expect(tested).toBeGreaterThan(2);
  });
});
