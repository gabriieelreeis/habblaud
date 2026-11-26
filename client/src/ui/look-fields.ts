// Editor de visual do personagem (gaveta do agente): prévia grande que gira pelas 8 direções e abas por tipo de peça,
// cada uma com a grade de opções (miniatura de cada uma) e as cores em bolinhas. Mesma forma pública do
// AppearanceFields (preview, groups, value, set, onChange); quem usa guarda o nome, salva e decide o que mandar.
// As regras (abas, paletas, o que cada escolha muda) estão em look-model.ts.
import { SCREEN_DIRS, type ScreenDir } from '../art/avatar/render';
import { avatarCanvas2, poseFrameCount, poseFrameDuration, AVATAR_H, AVATAR_W } from '../art';
import type { Appearance } from '../art/api';
import { tr } from '../../../shared/i18n';
import { h, prefersReducedMotion } from './dom';
import { LOOK_TABS, applyLook, optionLabel, paletteFor, randomLook, rowShown, styleOptions, valueOf, type LookField, type LookRow } from './look-model';

/** Pixels de tela por pixel do personagem na prévia grande e nas miniaturas. */
const PREVIEW_SCALE = 3;
const THUMB_SCALE = 2;
/** A prévia mostra da linha 2 em diante da folha (o resto é espaço vazio acima do chapéu mais alto). */
const PREVIEW_TOP = 2;
/** A cada quantos ms o giro automático avança uma direção, e quanto tempo sem mexer antes de recomeçar. */
const SPIN_MS = 2600;
const IDLE_MS = 5000;

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}
// Recortes da folha (de frente): cabeça, tronco, pernas, pés e corpo todo.
const HEAD: Crop = { x: 8, y: 4, w: 24, h: 30 };
const TORSO: Crop = { x: 8, y: 30, w: 24, h: 24 };
const LEGS: Crop = { x: 8, y: 44, w: 24, h: 18 };
const FEET: Crop = { x: 8, y: 50, w: 24, h: 12 };
const FULL: Crop = { x: 4, y: 4, w: 32, h: 58 };
const CROP_OF: Partial<Record<LookField, Crop>> = {
  body: FULL, cut: HEAD, facialHair: HEAD, hat: HEAD, glasses: HEAD, topCut: TORSO, bottomCut: LEGS, shoesCut: FEET, extra: FULL,
};

const later = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fn);
  else setTimeout(fn, 0);
};

let uid = 0;

export class LookFields {
  /** Prévia: personagem girando (canvas), botões de girar e "Aleatório". */
  readonly preview: HTMLElement;
  /** Abas e opções da aba escolhida. */
  readonly groups: HTMLElement;
  private draft: Appearance | null = null;
  private tab = 0;
  private view = 0;
  private frame = 0;
  private lastTouch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSpin = 0;
  /** Cada redesenho das opções invalida as miniaturas que ainda esperavam na fila. */
  private generation = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly tabs: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly id = ++uid;

  constructor(private readonly onChange: (a: Appearance) => void = () => {}) {
    this.canvas = h('canvas', { class: 'ui-look__canvas', role: 'img', attrs: { 'aria-label': tr('Prévia do personagem') } });
    const spin = (step: number) => () => {
      this.turn(step);
    };
    const rotL = h('button', { class: 'ui-icon-btn ui-look__turn', type: 'button', text: '⟲', title: tr('Girar para a esquerda'), attrs: { 'aria-label': tr('Girar para a esquerda') }, on: { click: spin(-1) } });
    const rotR = h('button', { class: 'ui-icon-btn ui-look__turn', type: 'button', text: '⟳', title: tr('Girar para a direita'), attrs: { 'aria-label': tr('Girar para a direita') }, on: { click: spin(1) } });
    const random = h('button', { class: 'ui-btn ui-btn--sm ui-look__random', type: 'button', text: tr('Aleatório'), title: tr('Sortear todas as peças e cores'), on: { click: () => this.randomize() } });
    this.preview = h('div', { class: 'ui-look__stage' }, h('div', { class: 'ui-look__turner' }, rotL, this.canvas, rotR), random);
    this.tabs = h('div', { class: 'ui-look__tabs', role: 'tablist', attrs: { 'aria-label': tr('Peças do personagem') } });
    this.panel = h('div', { class: 'ui-look__panel', role: 'tabpanel' });
    this.groups = h('div', { class: 'ui-char__groups ui-look' }, this.tabs, this.panel);
    this.tabs.addEventListener('keydown', (ev) => this.onTabKey(ev));
  }

  /** Aparência em edição (null antes do primeiro `set`). */
  get value(): Appearance | null {
    return this.draft;
  }

  /** Troca a aparência inteira (começo da edição, "Sortear") e redesenha. */
  set(a: Appearance): void {
    this.draft = a;
    this.paint();
    this.startSpin();
  }

  // ------------------------------------------------------------------ escolhas

  private pick(key: LookField, value: string): void {
    if (!this.draft) return;
    this.draft = applyLook(this.draft, key, value);
    this.touch();
    this.paint(key);
    this.onChange(this.draft);
  }

  private randomize(): void {
    if (!this.draft) return;
    this.draft = randomLook(this.draft);
    this.touch();
    this.paint();
    this.onChange(this.draft);
  }

  private turn(step: number): void {
    this.touch();
    this.view = (this.view + step + SCREEN_DIRS.length) % SCREEN_DIRS.length;
    this.drawPreview();
  }

  private touch(): void {
    this.lastTouch = Date.now();
    this.startSpin();
  }

  // ------------------------------------------------------------------ desenho

  /** Redesenha prévia, abas e opções; `focusKey` devolve o foco ao item escolhido daquela linha. */
  paint(focusKey?: LookField): void {
    const a = this.draft;
    if (!a) return;
    this.drawPreview();
    this.paintTabs();
    this.paintPanel(a, focusKey);
  }

  private paintTabs(): void {
    this.tabs.replaceChildren(
      ...LOOK_TABS.map((t, i) =>
        h('button', {
          class: 'ui-look__tab',
          type: 'button',
          role: 'tab',
          text: t.label,
          tabIndex: i === this.tab ? 0 : -1,
          attrs: { id: this.tabId(i), 'aria-selected': String(i === this.tab), 'aria-controls': this.panelId },
          on: { click: () => this.selectTab(i, false) },
        }),
      ),
    );
  }

  private get panelId(): string {
    return `ui-look-panel-${this.id}`;
  }

  private tabId(i: number): string {
    return `ui-look-tab-${this.id}-${i}`;
  }

  private selectTab(i: number, focus: boolean): void {
    this.tab = i;
    this.touch();
    this.paintTabs();
    if (focus) (this.tabs.children[i] as HTMLElement | undefined)?.focus();
    if (this.draft) this.paintPanel(this.draft);
  }

  /** Setas e Home/End trocam de aba (padrão de tablist, com a aba escolhida ao receber o foco). */
  private onTabKey(ev: KeyboardEvent): void {
    const n = LOOK_TABS.length;
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (step) this.selectTab((this.tab + step + n) % n, true);
    else if (ev.key === 'Home') this.selectTab(0, true);
    else if (ev.key === 'End') this.selectTab(n - 1, true);
    else return;
    ev.preventDefault();
  }

  private paintPanel(a: Appearance, focusKey?: LookField): void {
    const gen = ++this.generation;
    const tab = LOOK_TABS[this.tab];
    this.panel.setAttribute('id', this.panelId);
    this.panel.setAttribute('aria-labelledby', this.tabId(this.tab));
    const jobs: (() => void)[] = [];
    this.panel.replaceChildren(...tab.rows.filter((r) => rowShown(r, a)).map((r) => this.row(tab.label, r, a, jobs)));
    // miniaturas aos poucos: uma grade de 21 cortes de cabelo não pode travar o clique
    const run = () => {
      if (gen !== this.generation) return;
      for (const job of jobs.splice(0, 6)) job();
      if (jobs.length) later(run);
    };
    if (jobs.length) later(run);
    if (focusKey) this.panel.querySelector<HTMLElement>(`[data-key="${focusKey}"] [aria-pressed="true"], [data-key="${focusKey}"] [aria-checked="true"]`)?.focus();
  }

  private row(group: string, r: LookRow, a: Appearance, jobs: (() => void)[]): HTMLElement {
    const current = valueOf(a, r.key);
    const label = h('span', { class: 'ui-look__row-label', text: r.label });
    if (r.kind === 'color') {
      const colors = paletteFor(r.key, a);
      const buttons = colors.map((c) =>
        h('button', {
          class: 'ui-char__swatch ui-look__swatch',
          type: 'button',
          role: 'radio',
          tabIndex: c === current ? 0 : -1,
          style: `--swatch: ${c}`,
          title: c,
          attrs: { 'aria-checked': String(c === current), 'aria-label': `${r.label} ${c}` },
          on: { click: () => this.pick(r.key, c) },
        }),
      );
      if (buttons.length && !buttons.some((b) => b.tabIndex === 0)) buttons[0].tabIndex = 0;
      const list = h('div', { class: 'ui-look__colors', role: 'radiogroup', attrs: { 'aria-label': `${group}: ${r.label}`, 'data-key': r.key } }, ...buttons);
      list.addEventListener('keydown', (ev) => this.onRadioKey(ev, buttons, r.key, colors));
      return h('div', { class: 'ui-look__row' }, label, list);
    }
    const options = styleOptions(r.key);
    const crop = CROP_OF[r.key] ?? FULL;
    const buttons = options.map((o) => {
      const thumb = h('canvas', { class: 'ui-look__thumb', attrs: { 'aria-hidden': 'true' } });
      thumb.width = crop.w * THUMB_SCALE;
      thumb.height = crop.h * THUMB_SCALE;
      jobs.push(() => this.drawThumb(thumb, a, r.key, o.id, crop));
      const text = optionLabel(r.key, o.id);
      return h(
        'button',
        {
          class: 'ui-look__opt',
          type: 'button',
          title: text,
          attrs: { 'aria-pressed': String(o.id === current), 'aria-label': text },
          on: { click: () => this.pick(r.key, o.id) },
        },
        thumb,
        h('span', { class: 'ui-look__opt-name', text }),
      );
    });
    const grid = h('div', { class: 'ui-look__grid', role: 'group', attrs: { 'aria-label': `${group}: ${r.label}`, 'data-key': r.key } }, ...buttons);
    grid.addEventListener('keydown', (ev) => this.onGridKey(ev, buttons));
    return h('div', { class: 'ui-look__row' }, label, grid);
  }

  /** Setas mudam a cor dentro da linha (padrão de radiogroup). */
  private onRadioKey(ev: KeyboardEvent, buttons: HTMLButtonElement[], key: LookField, values: readonly string[]): void {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const n = buttons.length;
    const from = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    this.pick(key, values[(from + step + n) % n]);
  }

  /** Setas só movem o foco entre as opções da grade (escolher é Enter ou Espaço, como em qualquer botão). */
  private onGridKey(ev: KeyboardEvent, buttons: HTMLButtonElement[]): void {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) return;
    ev.preventDefault();
    buttons[(from + step + buttons.length) % buttons.length].focus();
  }

  /** A opção aplicada à aparência atual, de frente, recortada na parte do corpo que ela muda. */
  private drawThumb(canvas: HTMLCanvasElement, a: Appearance, key: LookField, id: string, c: Crop): void {
    try {
      const g = canvas.getContext('2d');
      if (!g) return;
      const sheet = avatarCanvas2(applyLook(a, key, id), 's', 'stand', 0);
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(sheet, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
    } catch (err) {
      console.warn('[ui] falha ao desenhar a miniatura', err);
    }
  }

  // ------------------------------------------------------------------ prévia animada

  private drawPreview(): void {
    const a = this.draft;
    if (!a) return;
    try {
      const c = this.canvas;
      const w = AVATAR_W * PREVIEW_SCALE;
      const hgt = (AVATAR_H - PREVIEW_TOP) * PREVIEW_SCALE;
      if (c.width !== w) c.width = w;
      if (c.height !== hgt) c.height = hgt;
      const g = c.getContext('2d');
      if (!g) return;
      const view: ScreenDir = SCREEN_DIRS[this.view];
      const pose = prefersReducedMotion() ? 'stand' : 'walk';
      const sheet = avatarCanvas2(a, view, pose, this.frame % poseFrameCount(pose));
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, w, hgt);
      g.drawImage(sheet, 0, PREVIEW_TOP, AVATAR_W, AVATAR_H - PREVIEW_TOP, 0, 0, w, hgt);
    } catch (err) {
      // A arte ainda pode estar em construção: o editor continua utilizável sem a prévia.
      console.warn('[ui] falha ao desenhar a prévia do personagem', err);
    }
  }

  /** Anda no lugar e, sem ninguém mexer, gira devagar; para sozinho quando o editor some da tela. */
  private startSpin(): void {
    if (this.timer || !this.canvas.isConnected || typeof setInterval !== 'function' || prefersReducedMotion()) return;
    this.lastSpin = Date.now();
    this.timer = setInterval(() => {
      if (!this.canvas.isConnected || this.canvas.offsetParent === null) {
        this.stopSpin();
        return;
      }
      if (typeof document !== 'undefined' && document.hidden) return;
      this.frame++;
      const now = Date.now();
      if (now - this.lastTouch > IDLE_MS && now - this.lastSpin >= SPIN_MS) {
        this.lastSpin = now;
        this.view = (this.view + 1) % SCREEN_DIRS.length;
      }
      this.drawPreview();
    }, poseFrameDuration('walk'));
  }

  private stopSpin(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
