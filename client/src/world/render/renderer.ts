// Desenho do mundo por frame na visão isométrica (../iso.ts): chão externo -> pisos das áreas -> camada estática
// (paredes, móveis e props, já na ordem de profundidade) -> entidades (personagens, telas, itens de parede animados),
// cada uma seguida do redesenho do que fica na frente dela -> luz/escuridão -> ícones. A passada em espaço de tela
// (texto nítido) fica em overlay.ts. Tudo aqui é desenhado no plano isométrico; a câmera só amplia e desloca.
import { TILE, type ArtModule, type CharacterFrameRequest, type IconName, type ScreenMode, type Sprite } from '../../art/api';
import type { SeasonalTheme, WorldOptions } from '../api';
import type { TvState } from '../../../../shared/presentation';
import type { WorldAssets } from '../assets';
import type { Camera } from '../camera';
import { BUILDING_H, COL_W, CORE_COLS, CORRIDOR_Y } from '../constants';
import { FLOOR_MATRIX, WALL_H, drawsBefore, fromIso, isoBounds, isoSort, isoX, isoY, type Box, type IsoRect, type Sortable } from '../iso';
import { layoutExterior, slotShell, type ExteriorLayout, type SlotShell } from '../layout/exterior';
import { slotAt } from '../layout/geometry';
import type { AreaLayout, ExteriorProp } from '../layout/types';
import { screenModeFor } from '../sim/behavior';
import type { Character } from '../sim/character';
import type { RoomState } from '../sim/room-state';
import { cobwebScale, hourglassIcon, HOURGLASS_FLIP_MS, STORM_LIFT } from '../sim/shell';
import type { Sim } from '../sim/sim';
import { buildAnim, furnitureScale, NO_ANIM, sweepDelay, type BuildAnim } from './anim';
import { daylightModeOf, parseHourParam } from './daylight';
import { layerProps, overlaps, type Rect } from './furn-layer';
import { RoomFxRenderer } from './github-fx';
import { buildIsoArea, PieceKind, projectFloor, shearMatrix, type IsoAreaVis, type Piece, type WallOverlay } from './iso-area';
import { Lighting, type LightPlane } from './lighting';
import { Particles } from './particles';
import { carSprite, propSprite, shadowSprite } from './props';
import { countBadge, fallbackIcon } from './shell-sprites';
import { decorateElevator, drawSeasonalLightsIso, drawSeasonalWindow, seasonalCostume, seasonalFurniture } from './seasonal';
import { buildAreaVis, opaqueBounds, paintShell, toWallVis, wallSprites, type AreaVis, type FurnVis, type WallVis } from './scene';

const enum K {
  Char,
  /** Tela animada de um móvel (monitor, fliperama) ou o vapor da cafeteira. */
  FurnAnim,
  /** Item de parede animado (janela, TV, relógio...). */
  Overlay,
  /** Pedaço de uma área em montagem/desmontagem (fora da camada estática). */
  Piece,
  Prop,
  Car,
}

interface Ent extends Sortable {
  k: K;
  ref: Character | FurnVis | WallOverlay | Piece | ExteriorProp | Car | null;
  area: AreaVis | null;
  alpha: number;
  scale: number;
}

/** Camada estática: paredes, móveis e props das áreas estáveis, pintados uma vez na ordem de profundidade. */
interface StaticLayer {
  c: HTMLCanvasElement;
  x: number;
  y: number;
  rect: Rect;
  items: Piece[];
  /** Índices dos itens por célula GRID x GRID do plano isométrico. */
  grid: Map<number, number[]>;
  /** Áreas que estavam estáveis quando a camada foi pintada (e as fachadas dos lotes vazios). */
  key: string;
  dyn: FurnVis[];
  dynState: number[];
}

interface Car {
  x: number;
  y: number;
  dir: 1 | -1;
  speed: number;
  variant: number;
}

/** Posição da cabeça (no plano isométrico) de cada personagem desenhado neste frame. */
export interface HeadInfo {
  x: number;
  y: number;
  feetY: number;
  visible: boolean;
  /** Retângulo do sprite (plano isométrico) para hit-test. */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  depth: number;
}

const TV_MODES: ScreenMode[] = ['browser', 'idle', 'chat', 'code'];

/** Chave de uma célula da grade (cabe com folga nos limites do plano isométrico do escritório). */
const cellKey = (gx: number, gy: number): number => (gx + 4096) * 8192 + (gy + 4096);
/**
 * Boca do balde de pipoca (px relativos aos pés, na arte 1x) na pose 'wait' sentada, por direção — segue o rig
 * da arte: abraçado no peito de frente, ao lado do quadril de costas, no colo de perfil.
 */
const POPCORN_DX: Readonly<Record<string, number>> = { down: 0, up: -9, left: -5, right: 5 };
const POPCORN_DY: Readonly<Record<string, number>> = { down: 11, up: 8, left: 9, right: 9 };
/** Teia ao lado de um vizinho: no máximo isto (px) para fora do corpo. */
const WEB_MAX_OUT = 10;
/** Tom das bordas da área externa (vinheta) e do gramado além dela. */
const VIGNETTE_ALPHA = 0.2;
const VIGNETTE_EDGE = `rgba(18,40,26,${VIGNETTE_ALPHA})`;
/** Ampliação da arte antiga dos personagens, quando a arte não tem a versão isométrica. */
const CHAR_SCALE = 2;
/** Personagem isométrico / personagem antigo (altura): converte as medidas da arte antiga (pipoca, nuvem). */
const ART_K = 1.5;
/** Meia largura (px de mundo) da caixa de um personagem no chão. */
const CHAR_R = 4;
/** Quanto o personagem da arte antiga (ampliada) sobe sentado, para assentar na altura do assento. */
const SEAT_LIFT = 4;
/** Margem do canvas de rascunho dos itens de parede (contorno da TV nova passa da tela). */
const SCRATCH_M = 3;
/** Ritmo (ms) em que o conteúdo animado de cada item de parede é refeito; 0 = só quando o estado muda. */
const OVERLAY_PERIOD: Partial<Record<string, number>> = { clock: 0, sign: 0, light_switch: 0, elevator: 0, window: 400, whiteboard: 500, tv: 125, mirror: 150 };
/** Lado (px) das células da grade da camada estática (busca do que redesenhar na frente de cada entidade). */
const GRID = 64;

export class Renderer {
  ctx: CanvasRenderingContext2D;
  readonly areas = new Map<string, AreaVis>();
  readonly heads = new Map<string, HeadInfo>();
  /** Tela da TV de cada sala no último quadro (plano isométrico): o clique na TV abre as apresentações. */
  readonly tvRects = new Map<string, { x: number; y: number; w: number; h: number }>();
  exterior: ExteriorLayout;
  shells: SlotShell[] = [];
  shellWindows: WallVis[] = [];
  /** Visuais isométricos das fachadas dos lotes vazios (paredes e janelas). */
  private shellIso = new Map<number, IsoAreaVis>();
  /** Chão externo projetado (grama, calçada, rua, pátios) com os props de trás já pintados. */
  private ground: HTMLCanvasElement | null = null;
  private groundX = 0;
  private groundY = 0;
  /** Props estáticos na frente do prédio (sul e leste), pintados uma vez. */
  private propsFront: HTMLCanvasElement | null = null;
  private propsFrontX = 0;
  private propsFrontY = 0;
  /** Props que estão nas camadas pré-pintadas (os demais seguem na lista de profundidade). */
  private layered = new Set<ExteriorProp>();
  private layer: StaticLayer | null = null;
  private stable: AreaVis[] = [];
  private redrawn: Piece[] = [];
  private cand: number[] = [];
  private seen = new Uint32Array(0);
  private stamp = 0;
  private baseCols = -1;
  private layoutVersion = -1;
  private assetsVersion = 0;
  private builtAssetsVersion = 0;
  cars: Car[] = [];
  /**
   * O último quadro desenhou algo andando (personagem andando/correndo, sala em montagem, partículas, pingue-pongue):
   * o laço fica a 30 qps; sem isso cai para 10 (pacing.ts). Carro não conta: quase sempre há um passando.
   */
  motion = false;
  private nextCarAt = 0;
  private ents: Ent[] = [];
  private pool: Ent[] = [];
  private date = new Date();
  private icons: { x: number; y: number; name: IconName; bounce: number; alpha: number; badge: number }[] = [];
  /** Pipoca, confete e chuva (pool fixo). */
  readonly particles = new Particles();
  /** Festa e alarme das salas (eventos do GitHub). */
  private readonly roomFx = new RoomFxRenderer();
  /** dt do frame atual (s), para as partículas emitidas durante o desenho. */
  private dt = 0;
  private iconCount = 0;
  private elevatorVis: WallVis[] = [];
  private occupiedSlots = new Set<number>();
  /** Hora forçada (?hora=21:30 na URL ou depuração) ou null para a hora local. */
  hourOverride: number | null = parseHourParam(typeof location === 'undefined' ? '' : location.search);
  /** Relógio da hora do dia (céu, iluminação, relógio de parede); o timelapse troca pelo instante reproduzido. */
  clock: () => number = () => Date.now();
  /** Ciclo dia/noite: mapa de luz e brilhos. */
  readonly lighting: Lighting;
  assets: WorldAssets | null = null;
  /** Último fator noturno aplicado (usado pelo overlay). */
  night = 0;
  private clearColor = '#7fae62';
  private grass: CanvasPattern | null = null;
  private theme: SeasonalTheme = 'none';
  /** Retângulo visível no plano isométrico (atualizado por quadro). */
  private view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** O mesmo, no plano de mundo (caixa envolvente), para o que ainda desenha no plano do chão. */
  private worldView = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(
    public canvas: HTMLCanvasElement,
    private readonly art: ArtModule,
    private readonly sim: Sim,
    private readonly camera: Camera,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.exterior = layoutExterior(sim.building.cols);
    this.lighting = new Lighting(art, sim);
  }

  /** Troca o canvas em que o mundo é desenhado (economia de energia: um canvas em 1× fora da tela). */
  setTarget(canvas: HTMLCanvasElement): void {
    if (canvas === this.canvas) return;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  setAssets(a: WorldAssets | null): void {
    this.assets = a;
    this.assetsVersion++;
  }

  // =================================================================== sincronização com a simulação

  /** Mantém caches e visuais coerentes com o prédio atual. */
  sync(theme: SeasonalTheme = 'none'): void {
    const sim = this.sim;
    const themeChanged = theme !== this.theme;
    this.theme = theme;
    const assetsChanged = this.builtAssetsVersion !== this.assetsVersion || themeChanged;
    if (this.baseCols !== sim.building.cols || assetsChanged) this.buildBase();
    if (this.layoutVersion !== sim.layoutVersion || assetsChanged) {
      this.layoutVersion = sim.layoutVersion;
      const want = new Set<string>();
      for (const a of [...sim.building.core, sim.building.corridor]) {
        want.add(a.id);
        const cur = this.areas.get(a.id);
        if (!cur || cur.layout !== a || assetsChanged) this.areas.set(a.id, this.makeArea(a, undefined));
      }
      for (const room of sim.rooms.values()) {
        if (!room.present) continue;
        want.add(room.id);
      }
      for (const id of [...this.areas.keys()]) if (!want.has(id)) this.areas.delete(id);
      this.elevatorVis = this.areas.get('core:recepcao')?.wallItems.filter((w) => w.kind === 'elevator') ?? [];
    }
    // salas: (re)constrói quando surgem, mudam de layout ou de versão (nome/tema)
    this.occupiedSlots.clear();
    for (const room of sim.rooms.values()) {
      if (!room.present) continue;
      this.occupiedSlots.add(room.slot);
      const cur = this.areas.get(room.id);
      if (!cur || cur.layout !== room.layout || cur.version !== room.version || assetsChanged) {
        this.areas.set(room.id, this.makeArea(room.layout, room));
      } else cur.room = room;
    }
    for (const [id, vis] of this.areas) if (vis.room && !vis.room.present) this.areas.delete(id);
    this.builtAssetsVersion = this.assetsVersion;
  }

  private makeArea(layout: AreaLayout, room: RoomState | undefined): AreaVis {
    const vis = buildAreaVis(this.art, layout, room, this.assets, this.theme);
    vis.iso = buildIsoArea(this.art, layout, vis.floor, this.assets, this.theme);
    this.planesVersion++;
    return vis;
  }

  /** Muda quando as paredes do fundo mudam (luz da noite). */
  planesVersion = 0;
  private planesList: LightPlane[] = [];
  private planesAt = -1;

  /** Paredes do fundo das áreas e das fachadas dos lotes vazios, para a luz da noite. */
  wallPlanes(): readonly LightPlane[] {
    const key = this.planesVersion * 1000 + this.occupiedSlots.size;
    if (key === this.planesAt) return this.planesList;
    this.planesAt = key;
    const out: LightPlane[] = [];
    for (const vis of this.areas.values()) if (vis.iso) out.push(...vis.iso.planes);
    for (const [slot, iso] of this.shellIso) if (!this.occupiedSlots.has(slot)) out.push(...iso.planes);
    this.planesList = out;
    return out;
  }

  /** Chão externo (grama, calçada, rua, pátios dos lotes), projetado uma vez, com os props de trás do prédio. */
  private buildBase(): void {
    const cols = this.sim.building.cols;
    this.baseCols = cols;
    this.exterior = layoutExterior(cols);
    const b = this.exterior.bounds;
    const bx = b.x * TILE;
    const by = b.y * TILE;
    const c = document.createElement('canvas');
    c.width = b.w * TILE;
    c.height = b.h * TILE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(-bx, -by);
    paintShell(this.art, ctx, this.exterior.floors, []);
    // faixas da rua
    const ly = this.exterior.streetY + Math.round(this.exterior.streetH / 2) - 1;
    ctx.fillStyle = 'rgba(255,236,170,0.75)';
    for (let x = bx + 4; x < bx + c.width; x += 24) ctx.fillRect(x, ly, 12, 2);
    this.shells = [];
    this.shellWindows = [];
    this.shellIso.clear();
    for (let col = CORE_COLS; col < cols; col++) {
      for (const side of ['north', 'south'] as const) {
        const sh = slotShell(slotAt(col, side), col === cols - 1);
        this.shells.push(sh);
        paintShell(this.art, ctx, sh.floors, []);
        for (const w of sh.windows) this.shellWindows.push(toWallVis(w, `shell:${sh.slot}`));
        const layout: AreaLayout = { id: `shell:${sh.slot}`, kind: 'room', rect: sh.rect, floors: [], rugs: [], walls: sh.walls, wallItems: sh.windows, furniture: [], spots: [], walkable: [] };
        this.shellIso.set(sh.slot, buildIsoArea(this.art, layout, document.createElement('canvas'), this.assets, this.theme));
        this.planesVersion++;
      }
    }
    this.desaturate(ctx, bx, by, c.width, c.height);
    this.makeGrass(c);
    this.finishBase(ctx, cols);
    // projeção no chão isométrico + props de trás do prédio
    const p = projectFloor(c, bx, by, c.width, c.height);
    this.groundX = p.x;
    this.groundY = p.y;
    const split = (p: ExteriorProp) => p.y >= (BUILDING_H + 1) * TILE || p.x >= cols * COL_W * TILE + TILE;
    const layered = (this.layered = layerProps(this.exterior.props, (q) => this.propRect(q)));
    const back = this.exterior.props.filter((q) => layered.has(q) && !split(q));
    const front = this.exterior.props.filter((q) => layered.has(q) && split(q));
    const gctx = p.c.getContext('2d')!;
    gctx.imageSmoothingEnabled = false;
    gctx.translate(-p.x, -p.y);
    for (const q of this.sortProps(back)) this.paintProp(gctx, q);
    this.ground = p.c;
    if (front.length) {
      const rs = front.map((q) => this.propRect(q));
      const x0 = Math.floor(Math.min(...rs.map((r) => r.x)));
      const y0 = Math.floor(Math.min(...rs.map((r) => r.y)));
      const x1 = Math.ceil(Math.max(...rs.map((r) => r.x + r.w)));
      const y1 = Math.ceil(Math.max(...rs.map((r) => r.y + r.h)));
      const fc = document.createElement('canvas');
      fc.width = Math.max(1, x1 - x0);
      fc.height = Math.max(1, y1 - y0);
      const fctx = fc.getContext('2d')!;
      fctx.imageSmoothingEnabled = false;
      fctx.translate(-x0, -y0);
      for (const q of this.sortProps(front)) this.paintProp(fctx, q);
      this.propsFront = fc;
      this.propsFrontX = x0;
      this.propsFrontY = y0;
    } else this.propsFront = null;
    this.layer = null;
  }

  private sortProps(list: ExteriorProp[]): ExteriorProp[] {
    return list.slice().sort((a, z) => a.x + a.y - z.x - z.y);
  }

  /** Retângulo do desenho de um prop no plano isométrico. */
  private propRect(p: ExteriorProp): IsoRect {
    if (p.kind === 'paving') return isoBounds({ x0: p.x, y0: p.y, x1: p.x + 2 * TILE, y1: p.y + 2 * TILE });
    const sp = propSprite(p);
    return { x: isoX(p.x, p.y) - sp.ax, y: isoY(p.x, p.y) - sp.ay, w: sp.canvas.width, h: sp.canvas.height };
  }

  private paintProp(ctx: CanvasRenderingContext2D, p: ExteriorProp, alpha = 1): void {
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (p.kind === 'paving') {
      ctx.save();
      ctx.transform(FLOOR_MATRIX[0], FLOOR_MATRIX[1], FLOOR_MATRIX[2], FLOOR_MATRIX[3], 0, 0);
      ctx.drawImage(this.pavingCanvas(p), p.x, p.y);
      ctx.restore();
    } else {
      const s = propSprite(p);
      ctx.drawImage(s.canvas, Math.round(isoX(p.x, p.y) - s.ax), Math.round(isoY(p.x, p.y) - s.ay));
    }
    if (alpha < 1) ctx.globalAlpha = 1;
  }

  /** Grama de fundo além da área desenhada (amostra espelhada 2x2, sem emendas), já no tom da vinheta. */
  private makeGrass(c: HTMLCanvasElement): void {
    const s = 4 * TILE;
    try {
      const tile = document.createElement('canvas');
      tile.width = 2 * s;
      tile.height = 2 * s;
      const tctx = tile.getContext('2d')!;
      tctx.imageSmoothingEnabled = false;
      for (const [mx, my] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        tctx.setTransform(mx ? -1 : 1, 0, 0, my ? -1 : 1, mx ? 2 * s : 0, my ? 2 * s : 0);
        tctx.drawImage(c, 0, 0, s, s, 0, 0, s, s);
      }
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      const d = tctx.getImageData(0, 0, 2 * s, 2 * s).data;
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        bl += d[i + 2];
      }
      const n = d.length / 4;
      const avg = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(bl / n)})`;
      tctx.globalAlpha = 0.6;
      tctx.fillStyle = avg;
      tctx.fillRect(0, 0, 2 * s, 2 * s);
      tctx.globalAlpha = 1;
      tctx.fillStyle = VIGNETTE_EDGE;
      tctx.fillRect(0, 0, 2 * s, 2 * s);
      this.grass = this.ctx.createPattern(tile, 'repeat');
      const k = VIGNETTE_ALPHA;
      this.clearColor = `rgb(${Math.round((r / n) * (1 - k) + 18 * k)},${Math.round((g / n) * (1 - k) + 40 * k)},${Math.round((bl / n) * (1 - k) + 26 * k)})`;
    } catch {
      this.grass = null;
      this.clearColor = '#6f9a5a';
    }
  }

  /** Grama ~15% menos saturada: o gramado não compete com o escritório. */
  private desaturate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'rgba(128,128,128,0.16)';
      ctx.fillRect(x, y, w, h);
    } catch {
      // navegador sem o modo de mistura: segue sem dessaturar
    }
    ctx.restore();
  }

  /** Acabamento da camada externa: bordas levemente mais escuras (vinheta) e o capacho da entrada. */
  private finishBase(ctx: CanvasRenderingContext2D, cols: number): void {
    const b = this.exterior.bounds;
    const x0 = b.x * TILE;
    const y0 = b.y * TILE;
    const w = b.w * TILE;
    const h = b.h * TILE;
    ctx.save();
    const bwT = cols * COL_W;
    const smooth = (a: number, z: number, v: number) => {
      const t = Math.max(0, Math.min(1, (v - a) / Math.max(1e-6, z - a)));
      return t * t * (3 - 2 * t);
    };
    try {
      const m = document.createElement('canvas');
      m.width = b.w;
      m.height = b.h;
      const mctx = m.getContext('2d')!;
      const img = mctx.createImageData(b.w, b.h);
      for (let ty = 0; ty < b.h; ty++) {
        for (let tx = 0; tx < b.w; tx++) {
          const wx = b.x + tx + 0.5;
          const wy = b.y + ty + 0.5;
          const fx = wx < 0 ? smooth(6, -b.x, -wx) : wx > bwT ? smooth(6, b.x + b.w - bwT, wx - bwT) : 0;
          const fy = wy < 0 ? smooth(5, -b.y, -wy) : wy > BUILDING_H ? smooth(12, b.y + b.h - BUILDING_H, wy - BUILDING_H) : 0;
          const i = (ty * b.w + tx) * 4;
          img.data[i] = 18;
          img.data[i + 1] = 40;
          img.data[i + 2] = 26;
          img.data[i + 3] = Math.round(Math.max(fx, fy) * VIGNETTE_ALPHA * 255);
        }
      }
      mctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(m, x0, y0, w, h);
      ctx.imageSmoothingEnabled = false;
    } catch {
      // sem vinheta
    }
    // capacho diante da fachada de vidro da entrada (oeste do corredor)
    const my = (CORRIDOR_Y + 1.25) * TILE;
    ctx.fillStyle = '#3f4652';
    ctx.fillRect(-1.75 * TILE, my, 1.5 * TILE, 2.5 * TILE);
    ctx.fillStyle = '#596170';
    ctx.fillRect(-1.75 * TILE + 2, my + 2, 1.5 * TILE - 4, 2.5 * TILE - 4);
    ctx.fillStyle = '#4b525f';
    for (let y = my + 4; y < my + 2.5 * TILE - 4; y += 3) ctx.fillRect(-1.75 * TILE + 3, y, 1.5 * TILE - 6, 1);
    ctx.restore();
  }

  // =================================================================== frame

  frame(now: number, dt: number, opts: WorldOptions, sel: { agent: string | null; room: string | null; hover: string | null }): void {
    const { ctx, camera } = this;
    this.motion = false;
    this.date.setTime(this.clock());
    this.dt = dt;
    this.updateCars(now, dt);
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.clearColor;
    ctx.fillRect(0, 0, W, H);
    const { scale, ox, oy } = camera.transform();
    ctx.setTransform(scale, 0, 0, scale, ox, oy);
    const vx0 = -ox / scale;
    const vy0 = -oy / scale;
    const vx1 = vx0 + W / scale;
    const vy1 = vy0 + H / scale;
    const view = this.view;
    view.x0 = vx0;
    view.y0 = vy0;
    view.x1 = vx1;
    view.y1 = vy1;
    this.updateWorldView();
    const visible = (r: IsoRect) => r.x < vx1 && r.x + r.w > vx0 && r.y < vy1 && r.y + r.h > vy0;

    // ---- chão externo
    if (this.grass) {
      ctx.fillStyle = this.grass;
      ctx.fillRect(vx0 - 1, vy0 - 1, vx1 - vx0 + 2, vy1 - vy0 + 2);
    }
    this.blit(this.ground, this.groundX, this.groundY);
    // hora do ciclo dia/noite (preferência ou hora forçada; o relógio de parede acompanha a forçada)
    if (this.hourOverride !== null) {
      const min = Math.round(this.hourOverride * 60);
      this.date.setHours(Math.floor(min / 60) % 24, min % 60);
    }
    const hour = this.lighting.update(now, daylightModeOf(opts), this.hourOverride, this.date);

    // ---- pisos das áreas
    for (const vis of this.areas.values()) {
      const iso = vis.iso;
      if (!iso) continue;
      if (!visible({ x: iso.fx, y: iso.fy, w: iso.floor.width, h: iso.floor.height })) continue;
      const anim = vis.room ? buildAnim(vis.room.phase, vis.room.progress(now)) : NO_ANIM;
      if (anim.mode !== 'none') this.motion = true;
      this.drawFloor(vis, iso, anim);
    }
    // alarme de CI: tom vermelho no piso (por baixo dos móveis e personagens)
    ctx.save();
    ctx.transform(FLOOR_MATRIX[0], FLOOR_MATRIX[1], FLOOR_MATRIX[2], FLOOR_MATRIX[3], 0, 0);
    this.roomFx.drawFloor(ctx, this.sim, now, this.worldView);
    ctx.restore();

    // ---- camada estática
    const layer = this.layerFor(now);
    if (layer) this.blit(layer.c, layer.x, layer.y);

    // ---- entidades
    const ents = this.ents;
    ents.length = 0;
    let used = 0;
    const push = (k: K, box: Box, rect: IsoRect, ref: Ent['ref'], area: AreaVis | null, bias = 0, alpha = 1, scale = 1) => {
      let e = this.pool[used];
      if (!e) this.pool[used] = e = { k, box, rect, ref, area, bias, alpha, scale };
      else {
        e.k = k;
        e.box = box;
        e.rect = rect;
        e.ref = ref;
        e.area = area;
        e.bias = bias;
        e.alpha = alpha;
        e.scale = scale;
      }
      used++;
      ents.push(e);
    };
    for (const vis of this.areas.values()) {
      const iso = vis.iso;
      if (!iso) continue;
      const anim = vis.room ? buildAnim(vis.room.phase, vis.room.progress(now)) : NO_ANIM;
      const inLayer = this.isStable(vis);
      if (!inLayer) {
        if (anim.walls > 0) for (const p of iso.walls) if (visible(p.rect)) push(K.Piece, p.box, p.rect, p, vis, p.bias ?? 0, anim.walls, 1);
        for (const f of vis.furniture) {
          const s = anim.mode === 'none' ? 1 : furnitureScale(anim, f.order);
          if (s <= 0.01) continue;
          for (const p of this.furnPieces(f, vis, now)) if (visible(p.rect)) push(K.Piece, p.box, p.rect, p, vis, p.bias ?? 0, 1, s);
        }
      } else {
        for (const f of vis.furniture) {
          const animated = f.kind === 'desk' || f.kind === 'arcade' || (f.kind === 'coffee_machine' && this.furnState(f, now) === 1);
          if (!animated) continue;
          const r = this.furnRect(f, now);
          if (r && visible(r)) push(K.FurnAnim, f.box, r, f, vis, 0.25);
        }
      }
      if (anim.walls > 0) for (const o of iso.overlays) if (visible(o.rect)) push(K.Overlay, o.box, o.rect, o, vis, o.bias ?? 0, anim.walls);
    }
    // janelas das fachadas dos lotes vazios
    for (const [slot, iso] of this.shellIso) {
      const room = this.roomInSlot(slot);
      if (room && room.phase === 'ready') continue;
      for (const o of iso.overlays) if (visible(o.rect)) push(K.Overlay, o.box, o.rect, o, null, o.bias ?? 0);
    }
    // os agentes e, na visita, o visitante
    for (const ch of this.sim.people()) {
      const head = this.headOf(ch);
      head.visible = false;
      if (ch.inside || ch.alpha <= 0.01 || now < ch.hiddenUntil) continue;
      const x = ch.x + ch.offX;
      const y = ch.y + ch.offY;
      const ix = isoX(x, y);
      const iy = isoY(x, y);
      const rect = { x: ix - 20, y: iy - 56, w: 40, h: 62 };
      if (!visible(rect)) {
        head.x = ix;
        head.y = iy - 40;
        head.feetY = iy;
        continue;
      }
      push(K.Char, { x0: x - CHAR_R, y0: y - CHAR_R, x1: x + CHAR_R, y1: y + CHAR_R }, rect, ch, null, 0.5);
    }
    for (const prop of this.exterior.props) {
      if (this.layered.has(prop)) continue;
      const r = this.propRect(prop);
      if (!visible(r)) continue;
      let alpha = 1;
      if (prop.whenRoom !== undefined) {
        // ex.: cerca viva diante do caminho do jardim — surge junto com a sala
        const room = this.roomInSlot(prop.whenRoom);
        if (!room) continue;
        if (room.phase === 'building' || room.phase === 'dismantling') {
          const pr = room.progress(now);
          alpha = room.phase === 'building' ? Math.min(1, pr * 3) : 1 - Math.min(1, Math.max(0, (pr - 0.75) * 4));
          if (alpha <= 0.02) continue;
        }
      }
      push(K.Prop, this.propBox(prop), r, prop, null, 0, alpha);
    }
    for (const sh of this.shells) {
      const room = this.roomInSlot(sh.slot);
      let alpha = 1;
      if (room) {
        if (room.phase !== 'building' && room.phase !== 'dismantling') continue;
        const pr = room.progress(now);
        alpha = room.phase === 'building' ? 1 - Math.min(1, pr * 3) : Math.min(1, Math.max(0, (pr - 0.75) * 4));
        if (alpha <= 0.02) continue;
      }
      for (const prop of sh.props) {
        const r = this.propRect(prop);
        if (!visible(r)) continue;
        push(K.Prop, this.propBox(prop), r, prop, null, 0, alpha);
      }
    }
    for (const car of this.cars) {
      const r = { x: isoX(car.x, car.y) - 24, y: isoY(car.x, car.y) - 24, w: 48, h: 30 };
      if (visible(r)) push(K.Car, { x0: car.x - 14, y0: car.y - 5, x1: car.x + 14, y1: car.y + 5 }, r, car, null);
    }
    const sorted = isoSort(ents);

    this.iconCount = 0;
    this.tvRects.clear();
    for (const e of sorted) {
      switch (e.k) {
        case K.Piece:
          this.drawPiece(e.ref as Piece, e.alpha, e.scale);
          break;
        case K.FurnAnim:
          this.drawFurnAnim(e.ref as FurnVis, e.area!, now);
          break;
        case K.Overlay:
          this.drawOverlay(e.ref as WallOverlay, e.area, now, hour, e.alpha);
          break;
        case K.Char:
          this.drawCharacter(e.ref as Character, now, sel);
          break;
        case K.Prop:
          this.paintProp(ctx, e.ref as ExteriorProp, e.alpha);
          break;
        case K.Car:
          this.drawCar(e.ref as Car);
          break;
      }
      this.redrawInFront(e, now);
    }
    if (this.propsFront) this.blit(this.propsFront, this.propsFrontX, this.propsFrontY);
    this.drawPingPong(now);
    // ---- espera de shell: teias de aranha, confete/pipoca/chuva (por cima das entidades)
    this.drawCobwebs(now);
    this.drainEffects(now);
    this.roomFx.emit(this.particles, this.sim, now, dt, this.worldView);
    this.particles.update(dt);
    this.particles.draw(ctx, vx0, vy0, vx1, vy1, now);
    if (this.particles.count > 0) this.motion = true;

    // ---- luz: noite, salas apagadas, brilhos
    this.night = this.lighting.night;
    this.drawLighting(now);
    if (this.theme !== 'none') {
      for (const vis of this.areas.values()) {
        if (vis.room && vis.room.phase !== 'ready') continue;
        if (!vis.iso || !visible({ x: vis.iso.fx, y: vis.iso.fy - WALL_H, w: vis.iso.floor.width, h: vis.iso.floor.height })) continue;
        drawSeasonalLightsIso(ctx, this.theme, vis.layout, vis.room ? vis.room.light(now) : 1);
      }
    }
    // giroflex e balão "!" do alarme de CI (brilham também no escuro)
    this.roomFx.drawLights(ctx, this.sim, this.heads, now, this.worldView);

    // ---- ícones sobre as cabeças (por cima da escuridão), no dobro do tamanho, como os personagens
    for (let i = 0; i < this.iconCount; i++) {
      const ic = this.icons[i];
      const s = this.icon(ic.name);
      if (!s) continue;
      ctx.globalAlpha = ic.alpha;
      const k = 1;
      const ix = Math.round(ic.x - s.ax * k);
      const iy = Math.round(ic.y - s.ay * k - ic.bounce * k);
      ctx.drawImage(s.canvas, ix, iy, s.canvas.width * k, s.canvas.height * k);
      if (ic.badge > 1) {
        // "×N": mais de um shell rodando
        const b = countBadge(ic.badge);
        ctx.drawImage(b.canvas, ix + s.canvas.width * k - 1, iy + s.canvas.height * k - b.ay * k + 1, b.canvas.width * k, b.canvas.height * k);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Caixa (plano de mundo) envolvente do que está visível, para quem ainda desenha no plano do chão. */
  private updateWorldView(): void {
    const v = this.view;
    const pts = [fromIso(v.x0, v.y0), fromIso(v.x1, v.y0), fromIso(v.x0, v.y1 + WALL_H), fromIso(v.x1, v.y1 + WALL_H)];
    const w = this.worldView;
    w.x0 = Math.min(...pts.map((p) => p.x));
    w.x1 = Math.max(...pts.map((p) => p.x));
    w.y0 = Math.min(...pts.map((p) => p.y));
    w.y1 = Math.max(...pts.map((p) => p.y));
  }

  /** Desenha a parte visível de um canvas posicionado no plano isométrico. */
  private blit(c: HTMLCanvasElement | null, x: number, y: number): void {
    if (!c) return;
    const v = this.view;
    const sx = Math.max(0, Math.floor(v.x0 - x) - 1);
    const sy = Math.max(0, Math.floor(v.y0 - y) - 1);
    const sw = Math.min(c.width - sx, Math.ceil(v.x1 - v.x0) + 3);
    const sh = Math.min(c.height - sy, Math.ceil(v.y1 - v.y0) + 3);
    if (sw > 0 && sh > 0) this.ctx.drawImage(c, sx, sy, sw, sh, x + sx, y + sy, sw, sh);
  }

  private propBox(p: ExteriorProp): Box {
    if (p.kind === 'paving') return { x0: p.x, y0: p.y, x1: p.x + 2 * TILE, y1: p.y + 2 * TILE };
    const r = p.kind === 'tree' || p.kind === 'pine' ? 8 : 4;
    return { x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r };
  }

  private headOf(ch: Character): HeadInfo {
    let h = this.heads.get(ch.id);
    if (!h) this.heads.set(ch.id, (h = { x: 0, y: 0, feetY: 0, visible: false, bx: 0, by: 0, bw: 0, bh: 0, depth: 0 }));
    return h;
  }

  /** Remove entradas de personagens que já saíram. */
  pruneHeads(): void {
    for (const id of this.heads.keys()) if (!this.sim.person(id)) this.heads.delete(id);
  }

  roomInSlot(slot: number): RoomState | undefined {
    if (!this.occupiedSlots.has(slot)) return undefined;
    for (const r of this.sim.rooms.values()) if (r.slot === slot && r.present) return r;
    return undefined;
  }

  private isStable(vis: AreaVis): boolean {
    const ph = vis.room?.phase;
    return ph !== 'building' && ph !== 'dismantling';
  }

  // =================================================================== áreas

  private drawFloor(vis: AreaVis, iso: IsoAreaVis, anim: BuildAnim): void {
    const { ctx } = this;
    if (anim.floor >= 1) {
      this.blit(iso.floor, iso.fx, iso.fy);
      return;
    }
    if (anim.floor <= 0) return;
    // varredura: tiles surgem em diagonal (e somem na ordem inversa na desmontagem)
    const p = vis.px;
    const w = vis.layout.rect.w;
    const h = vis.layout.rect.h;
    const k = anim.floor * 1.06;
    ctx.save();
    ctx.transform(FLOOR_MATRIX[0], FLOOR_MATRIX[1], FLOOR_MATRIX[2], FLOOR_MATRIX[3], 0, 0);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (sweepDelay(i, j, w, h) > k) continue;
        ctx.drawImage(vis.floor, i * TILE, j * TILE, TILE, TILE, p.x + i * TILE, p.y + j * TILE, TILE, TILE);
      }
    }
    ctx.restore();
  }

  /** Item de parede animado: pintado de frente num canvas próprio e inclinado no plano da parede. */
  private overlayCache = new WeakMap<WallOverlay, { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; key: string; at: number }>();

  /** Sprite de um item de parede na visão isométrica (o elevador alto, quando a arte tem). */
  private wallSprite(kind: WallVis['kind'], variant: string | undefined, state: number, seed: number): Sprite | null {
    const tall = kind === 'elevator' ? this.art.isoWallSprite?.(kind, variant, state, seed) : null;
    return tall ?? wallSprites(this.art, kind, variant, state, seed)?.base ?? null;
  }

  private drawOverlay(o: WallOverlay, vis: AreaVis | null, now: number, hour: number, alpha: number): void {
    const { ctx } = this;
    const w = o.w;
    const variant = w.kind === 'light_switch' ? ((vis?.room ? vis.room.lightOn : true) ? 'on' : 'off') : w.variant;
    const state = w.kind === 'elevator' ? (this.sim.elevators[this.elevatorVis.indexOf(w)]?.state ?? 0) : 0;
    const s = this.wallSprite(w.kind, variant, state, w.seed);
    if (!s) return;
    const M = SCRATCH_M;
    const skew = o.on === 'face' ? 0.5 : 0;
    // TV das apresentações: guarda a tela (no plano isométrico) para o clique
    if (w.kind === 'tv' && vis?.room) {
      const r = s.rects?.tv;
      if (r) {
        const x = o.ax - s.ax + r.x;
        const y = o.ay - s.ay + r.y + skew * (r.x - s.ax);
        this.tvRects.set(vis.room.info.id, { x: x - 1, y: y - 1, w: r.w + 2, h: r.h + skew * r.w + 3 });
      }
    }
    // conteúdo pintado num canvas próprio do item, refeito só quando muda (ou no ritmo da animação dele)
    const cw = s.canvas.width + 2 * M;
    const ch = s.canvas.height + 2 * M;
    let cache = this.overlayCache.get(o);
    if (!cache || cache.c.width !== cw || cache.c.height !== ch) {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      cache = { c, ctx: c.getContext('2d')!, key: '', at: -1e9 };
      this.overlayCache.set(o, cache);
    }
    const key = this.overlayKey(w, vis, variant, state, hour);
    const period = OVERLAY_PERIOD[w.kind] ?? 1000;
    const slow = this.camera.zoom < 1.2 ? 3 : 1;
    if (key !== cache.key || (period > 0 && now - cache.at >= period * slow)) {
      cache.key = key;
      cache.at = now;
      const sc = cache.ctx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, cw, ch);
      sc.imageSmoothingEnabled = false;
      sc.translate(M, M);
      if (w.kind === 'window') this.paintWindow(sc, s, hour, now, w.seed);
      else this.paintWallItem(sc, vis, w, s, now);
      sc.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    if (o.on === 'face') ctx.transform(...shearMatrix(o.ax, o.ay, { ax: s.ax + M, ay: s.ay + M }, skew));
    else {
      // sobre a mureta: o conteúdo opaco centrado logo acima do topo
      const b = opaqueBounds(s.canvas);
      ctx.translate(Math.round(o.ax - (b.x + b.w / 2) - M), Math.round(o.ay - (b.y + b.h) - M));
    }
    ctx.drawImage(cache.c, 0, 0);
    ctx.restore();
  }

  /** O que muda o desenho de um item de parede (além do ritmo da animação dele). */
  private overlayKey(w: WallVis, vis: AreaVis | null, variant: string | undefined, state: number, hour: number): string {
    switch (w.kind) {
      case 'clock':
        return `${this.date.getHours()}:${this.date.getMinutes()}`;
      case 'window':
        return `${Math.round(hour * 12)}|${this.theme}`;
      case 'whiteboard':
        return (vis?.room?.board ?? []).map((b) => b.status[0]).join('');
      case 'tv':
        return vis?.room ? `${vis.room.info.tv?.state ?? 'off'}|${this.sim.tvAudience.roomId === vis.room.info.id}` : 'lounge';
      case 'elevator':
        return `${state}|${this.theme}`;
      default:
        return variant ?? '';
    }
  }

  private paintWallItem(sc: CanvasRenderingContext2D, vis: AreaVis | null, w: WallVis, s: Sprite, now: number): void {
    sc.drawImage(s.canvas, 0, 0);
    const rects = s.rects ?? {};
    switch (w.kind) {
      case 'elevator':
        decorateElevator(sc, this.theme, s.ax, s.ay);
        return;
      case 'clock': {
        const r = rects.face;
        if (r) this.safe(() => this.art.drawClock(sc, r, this.date));
        return;
      }
      case 'whiteboard': {
        const r = rects.board;
        if (r) this.safe(() => this.art.drawBoard(sc, r, vis?.room?.board ?? [], now));
        return;
      }
      case 'tv': {
        const r = rects.tv;
        if (!r) return;
        if (vis?.room) {
          this.safe(() => this.drawRoomTv(sc, r, vis.room!.info.tv?.state ?? 'off', this.sim.tvAudience.roomId === vis.room!.info.id, now, w.seed));
          return;
        }
        // roda na TV do lounge: o programa escolhido (futebol, novela, desenho) ou o videogame
        const live = this.sim.social.tvScreen();
        const mode = live ? live.mode : TV_MODES[Math.floor(now / 9000) % TV_MODES.length];
        const seed = live ? live.seed : w.seed;
        this.safe(() => this.art.drawScreen(sc, r, mode, now, seed));
        return;
      }
      case 'mirror': {
        const r = rects.glass;
        if (r) this.drawReflection(sc, w, r.x, r.y, r.w, r.h);
        return;
      }
      default:
    }
  }

  /** Tela da TV de uma sala (apresentações). */
  private drawRoomTv(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }, state: TvState, watching: boolean, now: number, seed: number): void {
    if (watching) {
      this.art.drawScreen(ctx, r, 'docs', now, seed);
      return;
    }
    if (state === 'preparing') {
      // barras coloridas com chiado por cima, trocando a cada 90 ms
      const bars = ['#d8d8d8', '#d8d23a', '#3ad2d2', '#3ad23a', '#d23ad2', '#d23a3a', '#3a3ad2'];
      const bw = r.w / bars.length;
      bars.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(Math.round(r.x + i * bw), r.y, Math.ceil(bw), r.h);
      });
      let k = (Math.floor(now / 90) * 2654435761 + seed) >>> 0;
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          k = (k * 1103515245 + 12345) >>> 0;
          if ((k >>> 16) % 3 === 0) {
            const g = (k >>> 8) & 0xff;
            ctx.fillStyle = `rgba(${g},${g},${g},0.75)`;
            ctx.fillRect(r.x + x, r.y + y, 1, 1);
          }
        }
      return;
    }
    if (state === 'new') {
      // acesa com o "slide" e um contorno âmbar pulsando: tem apresentação nova
      this.art.drawScreen(ctx, r, 'docs', now, seed);
      const a = 0.45 + 0.45 * Math.sin(now / 260);
      ctx.strokeStyle = `rgba(255,181,71,${a.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x - 1.5, r.y - 1.5, r.w + 3, r.h + 3);
      return;
    }
    this.art.drawScreen(ctx, r, state === 'ready' ? 'standby' : 'off', now, seed);
  }

  private paintWindow(sc: CanvasRenderingContext2D, s: Sprite, hour: number, now: number, seed: number): void {
    let r = s.rects?.glass;
    if (!r) {
      const b = opaqueBounds(s.canvas);
      r = { x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 };
    }
    const g = r;
    this.safe(() => this.art.drawWindowView(sc, g, hour, now, seed));
    drawSeasonalWindow(sc, this.theme, g, now, seed);
    sc.drawImage(s.canvas, 0, 0);
  }

  /** Retângulo (plano isométrico, inclinado por `skew`) da área de texto da placa de uma área, se houver. */
  signRect(vis: AreaVis): { x: number; y: number; w: number; h: number; skew: number } | null {
    const o = vis.iso?.overlays.find((x) => x.w.kind === 'sign');
    if (!o) return null;
    const s = wallSprites(this.art, 'sign', o.w.variant, 0, o.w.seed)?.base;
    if (!s) return null;
    const r =
      s.rects?.sign ??
      (() => {
        const b = opaqueBounds(s.canvas);
        return { x: b.x + 3, y: b.y + 3, w: b.w - 6, h: b.h - 6 };
      })();
    const skew = o.on === 'face' ? 0.5 : 0;
    return { x: o.ax - s.ax + r.x, y: o.ay - s.ay + r.y + skew * (r.x - s.ax), w: r.w, h: r.h, skew };
  }

  /**
   * Retângulo (plano isométrico, caixa envolvente) do quadro (`painting`) da parede de uma área: a cena Visita põe o
   * quadro de carimbos da portaria em cima do da recepção.
   */
  paintingRect(areaId: string): { x: number; y: number; w: number; h: number } | null {
    const vis = this.areas.get(areaId);
    const it = vis?.layout.wallItems.find((x) => x.kind === 'painting');
    if (!vis || !it) return null;
    const w = toWallVis(it, vis.id);
    const s = wallSprites(this.art, 'painting', it.variant === 'wide' ? undefined : it.variant, 0, w.seed)?.base;
    if (!s) return null;
    const b = opaqueBounds(s.canvas);
    const ax = isoX(w.cx, w.baseY);
    const ay = isoY(w.cx, w.baseY, 18);
    const x = ax - s.ax + b.x;
    const y = ay - s.ay + b.y + 0.5 * (b.x - s.ax);
    return { x, y, w: b.w, h: b.h + 0.5 * b.w };
  }

  /** Luminância média da área de texto da placa (para escolher a cor do texto). */
  signIsDark(vis: AreaVis): boolean {
    const o = vis.iso?.overlays.find((x) => x.w.kind === 'sign');
    const s = o ? wallSprites(this.art, 'sign', o.w.variant, 0, o.w.seed) : null;
    if (!s) return false;
    const c = s.base.canvas as HTMLCanvasElement & { __dark?: boolean };
    if (c.__dark !== undefined) return c.__dark;
    let dark = false;
    try {
      const r = s.base.rects?.sign ?? { x: 2, y: 2, w: c.width - 4, h: c.height - 4 };
      const d = c.getContext('2d')!.getImageData(r.x, r.y, Math.max(1, r.w), Math.max(1, r.h)).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        n++;
      }
      dark = n > 0 && sum / n < 120;
    } catch {
      dark = false;
    }
    c.__dark = dark;
    return dark;
  }

  // =================================================================== móveis e camada estática

  private furnState(f: FurnVis, now: number): number {
    if (f.kind === 'coffee_machine') return (this.sim.machineUntil.get(f.id) ?? 0) > now ? 1 : 0;
    if (f.kind === 'toilet_stall') return this.sim.stallBusy.has(f.id) ? 1 : 0;
    return 0;
  }

  private isoSprites(f: FurnVis, state: number) {
    try {
      return this.art.isoFurnitureSprites?.(f.kind, f.variant, state, { seed: f.seed }) ?? null;
    } catch {
      return null;
    }
  }

  /** Base (e encosto/porta, se houver) de um móvel como pedaços com caixa no chão. */
  private furnPieces(f: FurnVis, vis: AreaVis, now: number): Piece[] {
    // enfeite de época no lugar de uma planta (árvore de Natal, abóbora...): sprite de frente, no centro do footprint
    const deco = seasonalFurniture(this.theme, f.kind, vis.layout, f.seed);
    if (deco) {
      const cx = (f.box.x0 + f.box.x1) / 2;
      const cy = (f.box.y0 + f.box.y1) / 2;
      const dx = Math.round(isoX(cx, cy) - deco.ax);
      const dy = Math.round(isoY(cx, cy) - deco.ay);
      const c = deco.canvas;
      return [{ kind: PieceKind.Furn, src: c, sx: 0, sy: 0, sw: c.width, sh: c.height, dx, dy, box: f.box, rect: { x: dx, y: dy, w: c.width, h: c.height }, bias: 0, areaId: vis.id, f }];
    }
    const fs = this.isoSprites(f, this.furnState(f, now));
    if (!fs) return [];
    const ix = isoX(f.box.x0, f.box.y0);
    const iy = isoY(f.box.x0, f.box.y0);
    const out: Piece[] = [];
    const mk = (s: Sprite, kind: PieceKind, bias: number): Piece => {
      const dx = Math.round(ix - s.ax);
      const dy = Math.round(iy - s.ay);
      return { kind, src: s.canvas, sx: 0, sy: 0, sw: s.canvas.width, sh: s.canvas.height, dx, dy, box: f.box, rect: { x: dx, y: dy, w: s.canvas.width, h: s.canvas.height }, bias, areaId: vis.id, f };
    };
    out.push(mk(fs.base, PieceKind.Furn, 0));
    if (fs.front) out.push(mk(fs.front, PieceKind.Front, 1));
    return out;
  }

  /** Retângulo do sprite-base de um móvel no plano isométrico. */
  private furnRect(f: FurnVis, now: number): IsoRect | null {
    const fs = this.isoSprites(f, this.furnState(f, now));
    if (!fs) return null;
    const s = fs.base;
    return { x: Math.round(isoX(f.box.x0, f.box.y0) - s.ax), y: Math.round(isoY(f.box.x0, f.box.y0) - s.ay), w: s.canvas.width, h: s.canvas.height };
  }

  /**
   * Camada única com paredes, móveis e props estáticos de todas as áreas estáveis (e as fachadas dos lotes vazios),
   * na ordem de profundidade. Refeita quando muda o conjunto de áreas ou o estado de um móvel.
   */
  private layerFor(now: number): StaticLayer | null {
    const stable = this.stable;
    stable.length = 0;
    let key = '';
    for (const vis of this.areas.values()) {
      if (!this.isStable(vis) || !vis.iso) continue;
      stable.push(vis);
      key += `${vis.id}@${vis.version}:${this.idOf(vis)}|`;
    }
    for (const sh of this.shells) {
      const room = this.roomInSlot(sh.slot);
      if (!room || room.phase !== 'ready') key += `s${sh.slot}|`;
    }
    let l = this.layer;
    if (l && l.key === key) {
      let same = true;
      for (let i = 0; i < l.dyn.length && same; i++) if (l.dynState[i] !== this.furnState(l.dyn[i], now)) same = false;
      if (same) return l;
    }
    const items: Piece[] = [];
    const dyn: FurnVis[] = [];
    const dynState: number[] = [];
    for (const vis of stable) {
      items.push(...vis.iso!.walls);
      for (const f of vis.furniture) {
        if (f.kind === 'coffee_machine' || f.kind === 'toilet_stall') {
          dyn.push(f);
          dynState.push(this.furnState(f, now));
        }
        items.push(...this.furnPieces(f, vis, now));
      }
    }
    for (const sh of this.shells) {
      const room = this.roomInSlot(sh.slot);
      if (room && room.phase === 'ready') continue;
      const iso = this.shellIso.get(sh.slot);
      if (iso) items.push(...iso.walls);
    }
    if (!items.length) return (this.layer = null);
    const order = isoSort(items);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const it of order) {
      x0 = Math.min(x0, it.dx);
      y0 = Math.min(y0, it.dy);
      x1 = Math.max(x1, it.dx + it.sw);
      y1 = Math.max(y1, it.dy + it.sh);
    }
    x0 = Math.floor(x0);
    y0 = Math.floor(y0);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(x1 - x0));
    c.height = Math.max(1, Math.ceil(y1 - y0));
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;
    for (const it of order) cx.drawImage(it.src, it.sx, it.sy, it.sw, it.sh, Math.round(it.dx - x0), Math.round(it.dy - y0), it.sw, it.sh);
    const grid = new Map<number, number[]>();
    order.forEach((it, i) => {
      for (let gy = Math.floor(it.rect.y / GRID); gy <= Math.floor((it.rect.y + it.rect.h) / GRID); gy++) {
        for (let gx = Math.floor(it.rect.x / GRID); gx <= Math.floor((it.rect.x + it.rect.w) / GRID); gx++) {
          const k = cellKey(gx, gy);
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push(i);
        }
      }
    });
    this.seen = new Uint32Array(order.length);
    l = { c, x: x0, y: y0, rect: { x: x0, y: y0, w: c.width, h: c.height }, items: order, grid, key, dyn, dynState };
    this.layer = l;
    return l;
  }

  private ids = new WeakMap<AreaVis, number>();
  private nextId = 1;
  private idOf(vis: AreaVis): number {
    let n = this.ids.get(vis);
    if (!n) this.ids.set(vis, (n = this.nextId++));
    return n;
  }

  /**
   * Depois de desenhar uma entidade: redesenha os pedaços da camada que ficam na frente dela e cruzam o desenho e, em
   * cascata, os que vêm depois na camada e cruzam algum já escolhido (senão o redesenho cobriria quem está na frente).
   */
  private redrawInFront(e: Ent, now: number): void {
    const l = this.layer;
    if (!l || !overlaps(e.rect, l.rect)) return;
    // candidatos: itens das células em volta do desenho (com folga para a cascata), na ordem da camada
    const cand = this.cand;
    cand.length = 0;
    const stamp = ++this.stamp;
    const seen = this.seen;
    const m = GRID;
    for (let gy = Math.floor((e.rect.y - m) / GRID); gy <= Math.floor((e.rect.y + e.rect.h + m) / GRID); gy++) {
      for (let gx = Math.floor((e.rect.x - m) / GRID); gx <= Math.floor((e.rect.x + e.rect.w + m) / GRID); gx++) {
        const a = l.grid.get(cellKey(gx, gy));
        if (!a) continue;
        for (const i of a) {
          if (seen[i] === stamp) continue;
          seen[i] = stamp;
          cand.push(i);
        }
      }
    }
    if (!cand.length) return;
    cand.sort((a, b) => a - b);
    const out = this.redrawn;
    out.length = 0;
    for (const i of cand) {
      const it = l.items[i];
      let pick = overlaps(it.rect, e.rect) && drawsBefore(e, it);
      for (let k = 0; k < out.length && !pick; k++) pick = overlaps(it.rect, out[k].rect);
      if (pick) out.push(it);
    }
    for (const it of out) {
      this.ctx.drawImage(this.opaqueOnly(it.src as HTMLCanvasElement), it.sx, it.sy, it.sw, it.sh, Math.round(it.dx), Math.round(it.dy), it.sw, it.sh);
      if (it.f && it.kind === PieceKind.Furn) {
        const f = it.f;
        if (f.kind === 'desk' || f.kind === 'arcade') {
          const vis = this.areas.get(f.areaId);
          if (vis) this.drawFurnAnim(f, vis, now);
        }
      }
    }
    void now;
  }

  private opaqueCopies = new WeakMap<object, HTMLCanvasElement>();

  /**
   * Cópia do sprite só com os pixels opacos. O redesenho por cima da camada já pintada duplicaria a mistura dos
   * pixels translúcidos (sombras, vidro); os opacos substituem exatamente o que está lá.
   */
  private opaqueOnly(src: HTMLCanvasElement): HTMLCanvasElement {
    let c = this.opaqueCopies.get(src);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const cx = c.getContext('2d', { willReadFrequently: true })!;
    cx.drawImage(src, 0, 0);
    const img = cx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 255) img.data[i] = 0;
    cx.putImageData(img, 0, 0);
    this.opaqueCopies.set(src, c);
    return c;
  }

  /** Pedaço fora da camada (área em montagem): parede subindo com transparência, móvel crescendo da âncora. */
  private drawPiece(p: Piece, alpha: number, scale: number): void {
    const { ctx } = this;
    if (alpha < 1) ctx.globalAlpha = alpha;
    const rise = p.kind === PieceKind.Wall || p.kind === PieceKind.Low ? Math.round((1 - alpha) * 10) : 0;
    if (scale !== 1 && p.f) {
      const ax = isoX(p.box.x0 + (p.box.x1 - p.box.x0) / 2, p.box.y1);
      const ay = isoY(p.box.x0 + (p.box.x1 - p.box.x0) / 2, p.box.y1);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.scale(scale, scale);
      ctx.translate(-ax, -ay);
      ctx.drawImage(p.src, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.sw, p.sh);
      ctx.restore();
    } else ctx.drawImage(p.src, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy + rise, p.sw, p.sh);
    ctx.globalAlpha = 1;
  }

  /** Partes animadas de um móvel: tela do monitor/fliperama inclinada na face, vapor da cafeteira. */
  private drawFurnAnim(f: FurnVis, area: AreaVis, now: number): void {
    const fs = this.isoSprites(f, this.furnState(f, now));
    if (!fs) return;
    const s = fs.base;
    const dx = Math.round(isoX(f.box.x0, f.box.y0) - s.ax);
    const dy = Math.round(isoY(f.box.x0, f.box.y0) - s.ay);
    if (f.kind === 'coffee_machine') {
      this.drawSteam(isoX((f.box.x0 + f.box.x1) / 2, (f.box.y0 + f.box.y1) / 2), dy + 6, now, f.seed);
      return;
    }
    const screens: ('screen' | 'screen2')[] = f.kind === 'desk' ? ['screen', 'screen2'] : ['screen'];
    for (const name of screens) {
      const r = s.rects?.[name];
      if (!r) continue;
      let mode: ScreenMode | null;
      if (f.kind === 'desk') mode = name === 'screen' ? this.deskScreen(f, area) : this.deskScreen(f, area) === 'off' ? 'off' : null;
      else {
        const seed = this.sim.social.arcadeSeed();
        mode = seed !== null ? 'game' : null;
      }
      if (!mode) continue;
      const seed = f.kind === 'arcade' ? (this.sim.social.arcadeSeed() ?? f.seed) : f.seed;
      this.drawSkewedScreen(`${f.id}:${name}`, dx + r.x, dy + r.y, r.w, r.h, r.skew ?? 0, mode, now, seed);
    }
  }

  private screenCache = new Map<string, { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D; mode: ScreenMode; at: number }>();

  /**
   * Conteúdo de tela desenhado de frente num canvas próprio (refeito ~7 vezes por segundo, ou já quando o modo muda)
   * e inclinado para a face do móvel.
   */
  private drawSkewedScreen(id: string, x: number, y: number, w: number, h: number, skew: number, mode: ScreenMode, now: number, seed: number): void {
    if (w <= 0 || h <= 0) return;
    let e = this.screenCache.get(id);
    if (!e || e.c.width !== w || e.c.height !== h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      e = { c, ctx: c.getContext('2d')!, mode, at: -1e9 };
      this.screenCache.set(id, e);
    }
    const period = (mode === 'off' || mode === 'standby' ? 1000 : 140) * (this.camera.zoom < 1.2 ? 3 : 1);
    if (e.mode !== mode || now - e.at >= period + (seed % 40)) {
      e.mode = mode;
      e.at = now;
      const sc = e.ctx;
      sc.setTransform(1, 0, 0, 1, 0, 0);
      sc.clearRect(0, 0, w, h);
      sc.imageSmoothingEnabled = false;
      this.safe(() => this.art.drawScreen(sc, { x: 0, y: 0, w, h }, mode, now, seed));
    }
    const { ctx } = this;
    ctx.save();
    ctx.transform(1, skew, 0, 1, x, y);
    ctx.drawImage(e.c, 0, 0);
    ctx.restore();
  }

  /** Tela do monitor: segue a atividade de quem senta ali. */
  deskScreen(f: FurnVis, area: AreaVis): ScreenMode {
    const room = area.room;
    if (room && room.light(this.sim.now) < 0.3) return 'off';
    const owner = f.seatSpot ? this.sim.spots.ownerOf(f.seatSpot) : undefined;
    const ch = owner ? this.sim.chars.get(owner) : undefined;
    if (!ch || ch.leaving) return 'off';
    const seated = ch.atSpot === f.seatSpot;
    if (ch.mode === 'wait') return 'alert';
    if (!seated) return 'idle';
    if (ch.mode === 'work') return screenModeFor(ch.info.activity?.kind);
    // esperando um shell: terminal com a barra de progresso andando (o "filme" da pipoca)
    if (ch.mode === 'shell') return 'progress';
    return 'idle';
  }

  private drawSteam(x: number, y: number, now: number, seed: number): void {
    const { ctx } = this;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) {
      const ph = ((now / 900 + i / 3 + (seed % 7) / 7) % 1 + 1) % 1;
      ctx.globalAlpha = 0.75 * (1 - ph);
      const sx = Math.round(x - 1 + Math.sin(ph * 6 + i * 2) * 1.5 + (i - 1));
      const sy = Math.round(y - ph * 12);
      ctx.fillRect(sx, sy, 1, 2);
    }
    ctx.globalAlpha = 1;
  }

  // =================================================================== personagens

  private charSpriteIso(req: CharacterFrameRequest, animT: number): { s: Sprite; k: number } {
    const { art } = this;
    const count = Math.max(1, art.poseFrameCount(req.pose) || 1);
    const dur = Math.max(30, art.poseFrameDuration(req.pose) || 500);
    req.frame = Math.floor(animT / dur) % count;
    if (art.isoCharacterSprite) return { s: art.isoCharacterSprite(req), k: 1 };
    return { s: art.characterSprite(req), k: CHAR_SCALE };
  }

  private drawCharacter(ch: Character, now: number, sel: { agent: string | null; hover: string | null }): void {
    const { ctx } = this;
    const head = this.headOf(ch);
    const wx = ch.x + ch.offX;
    const wy = ch.y + ch.offY;
    const x = Math.round(isoX(wx, wy));
    const y = Math.round(isoY(wx, wy));
    if (ch.pose === 'walk' || ch.pose === 'run') this.motion = true;
    ctx.globalAlpha = ch.alpha;
    // anéis no chão (seleção, hover, alerta)
    if (ch.mode === 'wait') this.drawAlertRing(x, y, now);
    if (sel.agent === ch.id) this.drawRing(x, y, '#7fe3ff', now, true);
    else if (sel.hover === ch.id) this.drawRing(x, y, '#ffffff', now, false);
    if (!ch.seated) {
      const sh = shadowSprite();
      ctx.drawImage(sh.canvas, x - sh.ax * 1.5, y - sh.ay * 1.5, sh.canvas.width * 1.5, sh.canvas.height * 1.5);
    }
    const req: CharacterFrameRequest = this.req;
    req.appearance = ch.appearance;
    req.dir = ch.dir;
    req.pose = ch.pose;
    req.held = ch.held;
    req.seated = ch.seated;
    req.costume = seasonalCostume(this.theme, ch.info.seed);
    let got: { s: Sprite; k: number } | null = null;
    try {
      got = this.charSpriteIso(req, ch.animT);
    } catch {
      got = null;
    }
    if (!got && (req.pose === 'wait' || req.held === 'popcorn')) {
      // arte ainda sem a pose de espera/pipoca: sentado parado
      req.pose = req.pose === 'wait' ? 'sit' : req.pose;
      req.held = 'none';
      try {
        got = this.charSpriteIso(req, ch.animT);
      } catch {
        got = null;
      }
    }
    const lift = ch.seated && got && got.k !== 1 ? SEAT_LIFT : 0;
    if (got) {
      const { s, k } = got;
      const sx = x - s.ax * k;
      const sy = y - lift - s.ay * k;
      ctx.drawImage(s.canvas, sx, sy, s.canvas.width * k, s.canvas.height * k);
      const b = opaqueBounds(s.canvas);
      head.bx = sx + b.x * k;
      head.by = sy + b.y * k;
      head.bw = b.w * k;
      head.bh = b.h * k;
      head.y = sy + b.y * k;
    } else {
      head.bx = x - 8;
      head.by = y - 40;
      head.bw = 16;
      head.bh = 40;
      head.y = y - 40;
    }
    ctx.globalAlpha = 1;
    head.x = x;
    head.feetY = y;
    head.visible = true;
    head.depth = wx + wy;
    // ícone sobre a cabeça (desenhado depois da luz)
    let name: IconName | null = ch.mode === 'wait' ? 'alert' : ch.icon;
    const shell = ch.mode === 'shell' && ch.shellSince > 0 && !ch.leaving;
    let badge = 0;
    if (shell && (!name || name === 'zzz')) {
      // ampulheta virando (com "×N" quando há mais de um shell)
      name = hourglassIcon(now);
      badge = ch.shellCount;
    }
    if (name) {
      const bounce =
        name === 'alert'
          ? Math.round(Math.abs(Math.sin(now / 180)) * 4)
          : name === 'zzz'
            ? Math.round(Math.sin(now / 500) * 1.5)
            : name === 'hourglass' || name === 'hourglass_flip'
              ? now % HOURGLASS_FLIP_MS < 110 ? 1 : 0
              : Math.round(Math.max(0, 1 - (now - ch.iconAt) / 250) * 4);
      const lift2 = name === 'storm' ? Math.round(STORM_LIFT * ART_K) : 0;
      this.pushIcon(x, head.y - 2 - lift2, name, bounce, ch.alpha, badge);
      // chuva: pingos caem da nuvem até a cabeça
      if (name === 'storm' && Math.random() < this.dt * 24) this.particles.rain(x - 6 + Math.floor(Math.random() * 13), head.y - 6 - lift2, lift2 + 2);
    }
    if (shell && ch.shellStage === 'nap' && ch.pose === 'sleep') {
      // cochilando: "zzz" flutuando acima e à direita da ampulheta (o selo "×N" fica embaixo)
      this.pushIcon(x + 12, head.y - 15, 'zzz', Math.round(Math.sin(now / 500) * 1.5), ch.alpha, 0);
    }
    // pipoca pulando do balde de vez em quando
    if (shell && ch.pose === 'wait' && ch.held === 'popcorn' && got && now >= ch.popcornAt) {
      ch.popcornAt = now + 450 + Math.random() * 1200;
      const px = x - 2 + (POPCORN_DX[ch.dir] ?? 0) * ART_K;
      const py = y - lift - 2 - (POPCORN_DY[ch.dir] ?? 10) * ART_K;
      this.particles.popcorn(px, py);
      if (Math.random() < 0.3) this.particles.popcorn(px, py);
    }
  }

  private pushIcon(x: number, y: number, name: IconName, bounce: number, alpha: number, badge: number): void {
    if (this.iconCount >= 256) return;
    let ic = this.icons[this.iconCount];
    if (!ic) this.icons[this.iconCount] = ic = { x: 0, y: 0, name, bounce: 0, alpha: 1, badge: 0 };
    ic.x = x;
    ic.y = y;
    ic.name = name;
    ic.bounce = bounce;
    ic.alpha = alpha;
    ic.badge = badge;
    this.iconCount++;
  }

  /**
   * Teia de aranha no canto do personagem que espera um shell há mais de 10 min (escala inteira:
   * 2x, depois 4x com 20 min). Cochilando, fica coberto: uma teia de cada lado. A teia vai para o
   * lado sem vizinho; com vizinhos dos dois lados, cobre mais o próprio personagem (não invade a
   * mesa ao lado).
   */
  private drawCobwebs(now: number): void {
    // visita: nenhum tempo veio do mundo, então nada de teia
    if (this.sim.visit) return;
    const { ctx } = this;
    for (const ch of this.sim.chars.values()) {
      if (ch.mode !== 'shell' || !ch.shellSince || ch.leaving || !ch.seated || ch.atSpot !== ch.homeSpot) continue;
      const scale = cobwebScale(now - ch.shellSince);
      if (!scale) continue;
      const head = this.heads.get(ch.id);
      if (!head || !head.visible) continue;
      const web = this.icon('cobweb');
      if (!web) return;
      let left = (ch.info.seed & 1) === 0;
      const busyL = this.neighborAt(head, -1);
      const busyR = this.neighborAt(head, 1);
      if (left ? busyL && !busyR : busyR && !busyL) left = !left;
      ctx.globalAlpha = ch.alpha;
      this.drawWeb(web, head, left, scale, left ? busyL : busyR);
      if (ch.shellStage === 'nap') this.drawWeb(web, head, !left, 1, left ? busyR : busyL);
    }
    ctx.globalAlpha = 1;
  }

  /** Alguém visível logo ao lado (mesma fileira, até ~2 mesas) no lado `side` (-1 esquerda, 1 direita)? */
  private neighborAt(head: HeadInfo, side: -1 | 1): boolean {
    for (const h of this.heads.values()) {
      if (h === head || !h.visible || Math.abs(h.feetY - head.feetY) > 20) continue;
      const dx = (h.x - head.x) * side;
      if (dx > 0 && dx < 4.4 * TILE) return true;
    }
    return false;
  }

  /**
   * Uma teia presa no ombro (o canto da teia, em cima, fica para fora do corpo; espelhada do lado
   * direito). Com vizinho do lado, no máximo WEB_MAX_OUT px para fora: o resto cobre o personagem.
   */
  private drawWeb(web: Sprite, head: HeadInfo, left: boolean, scale: number, crowded: boolean): void {
    const { ctx } = this;
    const w = web.canvas.width * scale;
    const h = web.canvas.height * scale;
    const out = crowded ? Math.min(w - 3 * scale, WEB_MAX_OUT) : w - 3 * scale;
    const y = Math.round(head.by + 4);
    if (left) {
      ctx.drawImage(web.canvas, Math.round(head.bx - out), y, w, h);
      return;
    }
    const x = Math.round(head.bx + head.bw + out - w);
    ctx.save();
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(web.canvas, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * Efeitos pedidos pela simulação: confete (shell concluído) sobre quem comemora, moedinhas voando de
   * quem perdeu a aposta para quem ganhou e o brilho de quem se arrumou no espelho.
   */
  private drainEffects(now: number): void {
    const fx = this.sim.effects;
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      const head = this.heads.get(e.charId);
      if (!head || !head.visible || now - e.at > 1500) continue;
      if (e.kind === 'confetti') this.particles.confetti(head.x, head.y - 4);
      else if (e.kind === 'sparkle') this.particles.sparkle(head.x, head.y + 8);
      else if (e.kind === 'coins') {
        const to = this.heads.get(e.toId);
        if (to && to.visible) this.particles.coins(head.x, head.y + 4, to.x, to.y + 4);
      }
    }
    fx.length = 0;
  }

  private reflectReq: CharacterFrameRequest = {
    appearance: undefined as unknown as CharacterFrameRequest['appearance'],
    dir: 'down',
    pose: 'stand',
    frame: 0,
    held: 'none',
    seated: false,
  };

  /**
   * Reflexo no espelho do banheiro: quem está em pé diante da pia, virado para o espelho, aparece de
   * frente no vidro (rosto centrado, meio transparente, com o véu azulado do vidro por cima).
   */
  private drawReflection(ctx: CanvasRenderingContext2D, w: WallVis, gx: number, gy: number, gw: number, gh: number): void {
    for (const ch of this.sim.chars.values()) {
      if (ch.inside || ch.alpha < 0.5 || ch.dir !== 'up' || ch.seated) continue;
      if (Math.abs(ch.x - w.cx) > 5) continue;
      const dy = ch.y - w.baseY;
      if (dy < 14 || dy > 30) continue;
      const req = this.reflectReq;
      req.appearance = ch.appearance;
      req.pose = ch.pose === 'groom' ? 'groom' : 'stand';
      req.held = ch.pose === 'groom' ? ch.held : 'none';
      req.seated = false;
      req.costume = seasonalCostume(this.theme, ch.info.seed);
      let s: Sprite;
      try {
        const count = Math.max(1, this.art.poseFrameCount(req.pose) || 1);
        const dur = Math.max(30, this.art.poseFrameDuration(req.pose) || 500);
        req.frame = Math.floor(ch.animT / dur) % count;
        s = this.art.characterSprite(req);
      } catch {
        return;
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(gx, gy, gw, gh);
      ctx.clip();
      ctx.globalAlpha = 0.8 * ch.alpha;
      ctx.drawImage(s.canvas, Math.round(gx + gw / 2 - s.ax), Math.round(gy - 6));
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#cfe6f2';
      ctx.fillRect(gx, gy, gw, gh);
      ctx.restore();
      return;
    }
  }

  private req: CharacterFrameRequest = {
    appearance: undefined as unknown as CharacterFrameRequest['appearance'],
    dir: 'down',
    pose: 'stand',
    frame: 0,
    held: 'none',
    seated: false,
  };

  private drawRing(x: number, y: number, color: string, now: number, pulse: boolean): void {
    const { ctx } = this;
    const k = pulse ? 1 + Math.sin(now / 220) * 0.08 : 1;
    ctx.save();
    ctx.globalAlpha *= pulse ? 0.95 : 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y, 11 * k, 5.5 * k, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawAlertRing(x: number, y: number, now: number): void {
    const { ctx } = this;
    const ph = (now % 1100) / 1100;
    ctx.save();
    ctx.strokeStyle = '#ffb11f';
    ctx.lineWidth = 2;
    ctx.globalAlpha *= 0.9 * (1 - ph);
    ctx.beginPath();
    ctx.ellipse(x, y, 8 + ph * 16, 4 + ph * 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private pavings = new Map<string, HTMLCanvasElement>();

  /** Trecho de calçada (2x2 tiles) com o mesmo desenho da calçada vizinha (coordenadas de mundo). */
  private pavingCanvas(prop: ExteriorProp): HTMLCanvasElement {
    const key = `${prop.x},${prop.y}`;
    let c = this.pavings.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 2 * TILE;
    c.height = 2 * TILE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(-prop.x, -prop.y);
    this.safe(() => this.art.drawFloor(ctx, 'sidewalk', prop.x, prop.y, 2 * TILE, 2 * TILE, { seed: prop.seed }));
    this.pavings.set(key, c);
    return c;
  }

  private drawCar(car: Car): void {
    const s = this.art.isoCarSprite?.(car.variant, car.dir) ?? carSprite(car.variant, car.dir < 0);
    this.ctx.drawImage(s.canvas, Math.round(isoX(car.x, car.y) - s.ax), Math.round(isoY(car.x, car.y) - s.ay));
  }

  private updateCars(now: number, dt: number): void {
    const b = this.exterior.bounds;
    const x0 = b.x * TILE - 40;
    const x1 = (b.x + b.w) * TILE + 40;
    if (now >= this.nextCarAt) {
      this.nextCarAt = now + 4000 + Math.random() * 9000;
      const lane = this.exterior.lanes[Math.floor(Math.random() * this.exterior.lanes.length)];
      if (lane) this.cars.push({ x: lane.dir > 0 ? x0 : x1, y: lane.y, dir: lane.dir, speed: 38 + Math.random() * 30, variant: Math.floor(Math.random() * 6) });
    }
    for (const c of this.cars) c.x += c.dir * c.speed * Math.min(dt, 0.1);
    if (this.cars.length) this.cars = this.cars.filter((c) => c.x >= x0 - 10 && c.x <= x1 + 10);
  }

  private drawPingPong(now: number): void {
    const { ctx } = this;
    for (const g of this.sim.social.gatherings) {
      if (g.kind !== 'pingpong' || g.phase !== 'run') continue;
      let a: Character | undefined;
      let b: Character | undefined;
      for (const m of g.members) {
        if (m.role !== 'player' || m.left) continue;
        if (!a) a = this.sim.chars.get(m.id);
        else b = this.sim.chars.get(m.id);
      }
      if (!a || !b) continue;
      this.motion = true;
      const left = a.x < b.x ? a : b;
      const right = a.x < b.x ? b : a;
      const period = 1100;
      const ph = ((now - g.startAt) % (period * 2)) / period;
      const u = ph < 1 ? ph : 2 - ph;
      const wx = left.x + 9 + (right.x - left.x - 18) * u;
      const wy = (left.y + right.y) / 2;
      const arc = Math.sin(Math.PI * ((u * 2) % 1)) * 10;
      const x = isoX(wx, wy);
      const y = isoY(wx, wy, 19);
      ctx.fillStyle = 'rgba(30,40,60,0.35)';
      ctx.fillRect(Math.round(x) - 1, Math.round(y) + 1, 3, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x) - 1, Math.round(y - arc) - 2, 3, 3);
    }
  }

  private icon(name: IconName): Sprite | null {
    try {
      const s = this.art.iconSprite(name);
      if (s && s.canvas.width > 0) return s;
    } catch {
      // arte ainda sem este ícone
    }
    return fallbackIcon(name);
  }

  // =================================================================== luz

  /**
   * Luz: o mapa do ciclo dia/noite (exterior, interiores e halos; nada de dia), projetado no chão, a sombra das
   * salas com a luz apagada (o volume inteiro da sala) e os brilhos.
   */
  private drawLighting(now: number): void {
    const { ctx } = this;
    this.lighting.drawAmbientIso(ctx, this, this.view, now, this.dt);
    const n = this.night;
    // salas com a luz apagada (e a transição de acender/apagar): escurece o piso, as paredes e o que está dentro
    for (const vis of this.areas.values()) {
      const room = vis.room;
      if (!room || !vis.layout.shade) continue;
      const light = room.light(now);
      const strength = (room.phase === 'building' ? 0.5 : 0.74) + 0.1 * n;
      const cover = room.phase === 'building' || room.phase === 'dismantling' ? buildAnim(room.phase, room.progress(now)).floor : 1;
      const dark = (1 - light) * strength * cover;
      if (dark <= 0.01) continue;
      const s = vis.layout.shade;
      const x0 = s.x;
      const y0 = s.y;
      const x1 = s.x + s.w;
      const y1 = s.y + s.h;
      ctx.fillStyle = `rgba(8,12,36,${dark})`;
      ctx.beginPath();
      ctx.moveTo(isoX(x0, y1), isoY(x0, y1));
      ctx.lineTo(isoX(x0, y1), isoY(x0, y1, WALL_H));
      ctx.lineTo(isoX(x0, y0), isoY(x0, y0, WALL_H));
      ctx.lineTo(isoX(x1, y0), isoY(x1, y0, WALL_H));
      ctx.lineTo(isoX(x1, y0), isoY(x1, y0));
      ctx.lineTo(isoX(x1, y1), isoY(x1, y1));
      ctx.closePath();
      ctx.fill();
    }
    ctx.save();
    ctx.transform(FLOOR_MATRIX[0], FLOOR_MATRIX[1], FLOOR_MATRIX[2], FLOOR_MATRIX[3], 0, 0);
    this.lighting.drawGlows(ctx, this, this.worldView, now);
    ctx.restore();
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // arte incompleta (stub) não pode derrubar o mundo
    }
  }
}

