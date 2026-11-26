// Visuais isométricos de uma área: piso projetado, paredes fatiadas por tile (com os itens fixos já pintados) e
// os itens de parede animados, cada um com a caixa do chão usada na ordem de desenho (../iso.ts).
import { TILE, type ArtModule, type FurnitureKind, type Sprite } from '../../art/api';
import { FLOOR_MATRIX, LOW_WALL_H, WALL_H, WALL_T, isoBounds, isoX, isoY, wallSlices, type Box, type IsoRect, type Sortable } from '../iso';
import type { AreaLayout } from '../layout/types';
import type { SeasonalTheme } from '../api';
import type { WorldAssets } from '../assets';
import { seasonalWallStyle } from './seasonal';
import { wallPlan } from './wall-plan';
import { pickWallArt, toWallVis, wallSprites, type FurnVis, type WallVis } from './scene';

export const enum PieceKind {
  Wall,
  Low,
  Furn,
  Front,
  Prop,
}

/** Pedaço desenhável com caixa no chão: fatia de parede, móvel, encosto, prop. */
export interface Piece extends Sortable {
  kind: PieceKind;
  src: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Canto superior esquerdo no plano isométrico. */
  dx: number;
  dy: number;
  areaId: string | null;
  f?: FurnVis;
}

/** Item de parede redesenhado a cada quadro (janela, relógio, TV...), inclinado no plano da parede. */
export interface WallOverlay extends Sortable {
  w: WallVis;
  /** 'face': parede do fundo (inclinado); 'low': sobre a mureta da frente (reto). */
  on: 'face' | 'low';
  /** Âncora do sprite no plano isométrico. */
  ax: number;
  ay: number;
}

export interface IsoAreaVis {
  floor: HTMLCanvasElement;
  /** Canto superior esquerdo do piso projetado. */
  fx: number;
  fy: number;
  walls: Piece[];
  overlays: WallOverlay[];
  /** Paredes do fundo (para a luz da noite). */
  planes: { facing: 'south' | 'east'; at: number; a0: number; a1: number; height: number }[];
}

/** Itens de parede redesenhados a cada quadro. */
export const DYNAMIC_WALL: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['window', 'clock', 'whiteboard', 'tv', 'elevator', 'light_switch', 'sign', 'mirror']);

/** Quanto (px) os itens sobem na parede alta: a arte deles foi feita para a face antiga, de 2 tiles. */
export function wallLift(kind: FurnitureKind): number {
  if (kind === 'sign') return 28;
  if (kind === 'elevator') return 0;
  if (kind === 'light_switch') return 6;
  return 18;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** Projeta um canvas do plano de mundo (canto em `x`, `y`) no chão isométrico. */
export function projectFloor(src: CanvasImageSource, x: number, y: number, w: number, h: number): { c: HTMLCanvasElement; x: number; y: number } {
  const r = isoBounds({ x0: x, y0: y, x1: x + w, y1: y + h });
  const ix = Math.floor(r.x);
  const iy = Math.floor(r.y);
  const [c, ctx] = canvas(r.w + 2, r.h + 2);
  ctx.setTransform(FLOOR_MATRIX[0], FLOOR_MATRIX[1], FLOOR_MATRIX[2], FLOOR_MATRIX[3], -ix, -iy);
  ctx.drawImage(src, x, y, w, h);
  return { c, x: ix, y: iy };
}

/** Matriz que inclina um sprite de parede (frente) no plano da parede: `skew` px para baixo por px para a direita. */
export function shearMatrix(ax: number, ay: number, s: { ax: number; ay: number }, skew = 0.5): [number, number, number, number, number, number] {
  return [1, skew, 0, 1, ax - s.ax, ay - s.ay - skew * s.ax];
}

interface Plane {
  facing: 'south' | 'east';
  /** Coordenada do plano (y para 'south', x para 'east') e o trecho [a0, a1) ao longo dele. */
  at: number;
  a0: number;
  a1: number;
}

/** Fatias de 1 tile de um sprite de parede, cada uma com a sua caixa no chão. */
function slices(sp: Sprite, src: CanvasImageSource, plane: Plane, thick: number, kind: PieceKind, areaId: string, bias = 0): Piece[] {
  return wallSlices(sp.ax, sp.ay, sp.canvas.width, sp.canvas.height, plane, thick, TILE).map((q) => ({
    kind,
    src,
    sx: q.sx0,
    sy: 0,
    sw: q.sx1 - q.sx0,
    sh: sp.canvas.height,
    dx: q.dx,
    dy: q.dy,
    box: q.box,
    rect: q.rect,
    bias,
    areaId,
  }));
}

/** Copia um sprite num canvas próprio (os do cache são compartilhados). */
function own(art: ArtModule, sp: Sprite): [HTMLCanvasElement, CanvasRenderingContext2D] {
  // vai para a camada estática, que lê os pixels: canvas na memória, sem ler de volta a placa de vídeo
  const c = document.createElement('canvas');
  c.width = Math.max(1, sp.canvas.width);
  c.height = Math.max(1, sp.canvas.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  const px = art.spritePixels?.(sp.canvas);
  if (px) ctx.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
  else ctx.drawImage(sp.canvas, 0, 0);
  return [c, ctx];
}

/** Desenha um item fixo (quadro, pôster, prateleira) inclinado no canvas de uma parede voltada para o sul. */
function bakeItem(ctx: CanvasRenderingContext2D, wallSp: Sprite, plane: Plane, item: WallVis, s: Sprite, thick: number): void {
  const X = wallSp.ax + item.cx - plane.a0 - thick;
  const Y = wallSp.ay + (item.cx - plane.a0 + thick) / 2 - wallLift(item.kind);
  ctx.save();
  ctx.setTransform(...shearMatrix(X, Y, s));
  ctx.drawImage(s.canvas, 0, 0);
  ctx.restore();
}

/**
 * Constrói os visuais isométricos de uma área. `floorSrc` é o piso já pintado no plano de mundo (tapetes, tom da sala).
 */
export function buildIsoArea(art: ArtModule, layout: AreaLayout, floorSrc: HTMLCanvasElement, assets: WorldAssets | null, theme: SeasonalTheme): IsoAreaVis {
  const r = layout.rect;
  const px = { x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE };
  // ---- piso: o trecho das faces antigas (2 linhas) vira chão de corredor, na frente da parede
  const [world, wctx] = canvas(px.w, px.h);
  wctx.drawImage(floorSrc, 0, 0);
  wctx.translate(-px.x, -px.y);
  for (const seg of layout.walls) {
    if (seg.kind !== 'face') continue;
    try {
      art.drawFloor(wctx, 'concrete', seg.x, seg.y, seg.w, 2 * TILE, { seed: 501 });
    } catch {
      wctx.fillStyle = '#c9c6c0';
      wctx.fillRect(seg.x, seg.y, seg.w, 2 * TILE);
    }
  }
  const pf = projectFloor(world, px.x, px.y, px.w, px.h);

  // ---- paredes
  const walls: Piece[] = [];
  const overlays: WallOverlay[] = [];
  const planes: IsoAreaVis['planes'] = [];
  const items = layout.wallItems.map((it) => toWallVis(it, layout.id));
  const isoWall = art.isoWall?.bind(art);
  if (!isoWall) return { floor: pf.c, fx: pf.x, fy: pf.y, walls, overlays, planes };
  for (const p of wallPlan(layout)) {
    const plane = p.plane;
    const sp = isoWall(seasonalWallStyle(theme, p.seg.style), p.spec);
    if (p.tall) planes.push({ ...plane, height: WALL_H });
    if (p.seg.kind !== 'face') {
      walls.push(...slices(sp, sp.canvas, plane, p.thick, p.tall ? PieceKind.Wall : PieceKind.Low, layout.id));
      if (p.seg.kind === 'south')
        for (const it of items) {
          if (it.on !== 'south' || it.cx < plane.a0 - 1 || it.cx > plane.a1 + 1) continue;
          overlays.push(overlayFor(art, it, plane, 'low'));
        }
      continue;
    }
    const [c, ctx] = own(art, sp);
    for (const it of items) {
      if (it.on !== 'face' || Math.abs(it.baseY - plane.at) > 1 || it.cx < plane.a0 - 1 || it.cx > plane.a1 + 1) continue;
      if (it.kind === 'door_frame') continue;
      if (DYNAMIC_WALL.has(it.kind)) {
        overlays.push(overlayFor(art, it, plane, 'face'));
        continue;
      }
      const ai = it.kind === 'painting' || it.kind === 'poster' ? pickWallArt(assets, it.kind, it.kind === 'poster' ? 1 : it.variant === 'wide' ? 4 : 2, it.variant, it.seed) : null;
      const img = ai ? (ai.framed ?? (ai.kind === 'poster' ? ai : null)) : null;
      if (img) {
        // arte pronta: topo 28 px acima do rodapé, como na vista de cima
        bakeItem(ctx, sp, plane, it, { canvas: img.img as unknown as HTMLCanvasElement, ax: Math.round(img.w / 2), ay: 28 }, WALL_T);
        continue;
      }
      const ws = wallSprites(art, it.kind, it.variant === 'wide' ? undefined : it.variant, 0, it.seed);
      if (ws) bakeItem(ctx, sp, plane, it, ws.base, WALL_T);
    }
    walls.push(...slices(sp, c, plane, WALL_T, PieceKind.Wall, layout.id));
  }
  return { floor: pf.c, fx: pf.x, fy: pf.y, walls, overlays, planes };
}

/** Item animado de parede: âncora no plano isométrico e caixa no chão (para a ordem de desenho). */
function overlayFor(art: ArtModule, w: WallVis, plane: Plane, on: 'face' | 'low'): WallOverlay {
  const s = wallSprites(art, w.kind, w.variant, 0, w.seed)?.base;
  const half = s ? s.canvas.width / 2 : TILE;
  const box: Box =
    on === 'face'
      ? { x0: w.cx - half, y0: plane.at - WALL_T, x1: w.cx + half, y1: plane.at }
      : { x0: w.cx - 4, y0: plane.at - 4, x1: w.cx + 4, y1: plane.at };
  const lift = on === 'face' ? wallLift(w.kind) : LOW_WALL_H;
  const ax = isoX(w.cx, on === 'face' ? plane.at : plane.at - 2);
  const ay = isoY(w.cx, on === 'face' ? plane.at : plane.at - 2, lift);
  const sw = s ? s.canvas.width : 2 * TILE;
  const sh = s ? s.canvas.height : 2 * TILE;
  const sax = s ? s.ax : TILE;
  const say = s ? s.ay : 2 * TILE;
  const skew = on === 'face' ? 0.5 : 0;
  const rect: IsoRect = { x: ax - sax, y: ay - say - skew * sax, w: sw, h: sh + skew * sw };
  // na parede do fundo, o item fica sempre à frente das fatias da própria parede
  return { w, on, ax, ay, box, rect, bias: on === 'face' ? 100 : 0.5 };
}

