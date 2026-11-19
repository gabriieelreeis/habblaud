// Barra superior: marca, conexão, contadores, uso por conta e botões de controle.
import { access } from '../net/access';
import { SpawnPanel } from './spawn';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText, setTitle, setVariant } from './dom';
import { formatDuration, formatInt } from './format';
import { FALLBACK_MARK, ICONS, pixelIcon } from './icons';
import { computeCounters, shellLine, shellWaitIn, shellWaitingAgents, waitingAgents, type Counters } from './model';
import { TIMELAPSE_ICONS } from './timelapse';
import { focusPermission, nextPermissionAgent, permissionAgents } from './permission';
import { UsageCards } from './usage';
import { VersionChip } from './version';
import { wordmark } from './widgets';
import { tr } from '../../../shared/i18n';

interface CounterRefs {
  el: HTMLElement;
  value: HTMLElement;
  label: HTMLElement;
}

/** Contadores fixos (o de shells é à parte: só aparece quando há shells rodando). */
const COUNTERS: { key: Exclude<keyof Counters, 'shells'>; singular: string; plural: string; hint: string }[] = [
  { key: 'rooms', singular: tr('sala'), plural: tr('salas'), hint: tr('Salas abertas (uma por projeto)') },
  { key: 'agents', singular: tr('agente'), plural: tr('agentes'), hint: tr('Agentes no escritório (principais e subagentes)') },
  { key: 'working', singular: tr('trabalhando'), plural: tr('trabalhando'), hint: tr('Agentes processando um pedido agora') },
  { key: 'subagents', singular: tr('subagente'), plural: tr('subagentes'), hint: tr('Subagentes em atividade') },
  { key: 'waiting', singular: tr('precisa de você'), plural: tr('precisam de você'), hint: tr('Agentes esperando sua resposta no terminal') },
];
const WAITING_HINT = COUNTERS.find((c) => c.key === 'waiting')!.hint;

/** Três pontinhos em pé (menu "Mais opções" do celular). */
const MORE_ICON = pixelIcon(['...##...', '...##...', '........', '...##...', '...##...', '........', '...##...', '...##...']);

export class TopBar implements UiComponent {
  readonly el: HTMLElement;
  private pill: HTMLElement;
  private pillText: HTMLElement;
  private demoBadge: HTMLElement;
  /** Linha de baixo da marca (conexão, versão, selos): o chip do Habblaud World entra aqui (ui/index.ts). */
  private status: HTMLElement;
  private counters = new Map<keyof Counters, CounterRefs>();
  private shellsBtn: HTMLButtonElement;
  /** Próximo agente do botão de shells (cliques seguidos passam por todos, do que espera há mais tempo). */
  private shellCursor = 0;
  private usage: UsageCards;
  private version: VersionChip;
  private hadOpen = false;
  private sidebarBtn: HTMLButtonElement;
  private feedBtn: HTMLButtonElement;
  private timelapseBtn: HTMLButtonElement;
  readonly settingsBtn: HTMLButtonElement;
  /** Abre a janela do Habblaud World (ao lado de Configurações); a janela decide quando ele aparece. */
  readonly worldBtn: HTMLButtonElement;
  private readonly spawnBtn: HTMLButtonElement;
  private readonly spawnPanel: SpawnPanel;
  /** Grupo dos botões de painéis (feed, Habblaud World, configurações, ajuda); o histórico entra aqui (ui/index.ts). */
  readonly panelGroup: HTMLElement;
  /**
   * Celular (até 600 px): os botões da direita não cabem numa linha, então somem e o "⋮" abre um menu com todos eles,
   * cada um com o nome. Os itens são montados na hora de abrir, a partir dos botões de verdade (que continuam fazendo o
   * trabalho: o item só clica neles), então botões que entram depois (festa, Meu dia, Entregas...) aparecem sozinhos.
   */
  private readonly overviewBtn: HTMLButtonElement;
  private readonly moreBtn: HTMLButtonElement;
  private readonly moreDot: HTMLElement;
  private readonly moreMenu: HTMLElement;

  constructor(private ctx: UiContext) {
    // Marca: usa o logo do projeto se existir; senão, o prédio em pixels.
    const mark = h('span', { class: 'ui-brand__mark' });
    const logo = h('img', { attrs: { src: '/assets/brand/logo-mark.png', srcset: '/assets/brand/logo-mark@4x.png 4x', alt: '', width: 32, height: 32, draggable: 'false' } });
    logo.addEventListener('error', () => {
      mark.innerHTML = FALLBACK_MARK;
    });
    mark.append(logo);

    this.pillText = h('span', { class: 'ui-pill__text' });
    this.pill = h('span', { class: 'ui-pill', role: 'status', attrs: { 'aria-live': 'polite' } }, h('span', { class: 'ui-pill__dot' }), this.pillText);
    this.demoBadge = h('span', { class: 'ui-demo-badge', text: tr('Demonstração'), title: tr('Agentes de demonstração ligados (desligue em Configurações)'), hidden: true });

    const counterWrap = h('div', { class: 'ui-counters', role: 'group', attrs: { 'aria-label': tr('Resumo do escritório') } });
    for (const c of COUNTERS) {
      const value = h('span', { class: 'ui-counter__value', text: '0' });
      const label = h('span', { class: 'ui-counter__label', text: c.plural });
      let el: HTMLElement;
      if (c.key === 'waiting') {
        // Em telas pequenas o rótulo some e fica a mão levantada.
        const icon = h('span', { class: 'ui-counter__icon', attrs: { 'aria-hidden': 'true' } });
        icon.innerHTML = ICONS.hand;
        el = h('button', { class: 'ui-counter ui-counter--waiting', type: 'button', title: tr('{0}. Clique para ir até o primeiro.', [c.hint]), on: { click: () => this.focusFirstWaiting() } }, icon, value, label);
      } else {
        el = h('div', { class: `ui-counter ui-counter--${c.key}`, title: c.hint }, value, label);
      }
      this.counters.set(c.key, { el, value, label });
      counterWrap.append(el);
    }

    // "⏳ N shells": entre os subagentes e o "precisa de você"; some quando não há shells rodando.
    {
      const icon = h('span', { class: 'ui-counter__icon ui-hourglass', attrs: { 'aria-hidden': 'true' } });
      icon.innerHTML = ICONS.hourglass;
      const value = h('span', { class: 'ui-counter__value', text: '0' });
      const label = h('span', { class: 'ui-counter__label', text: 'shells' });
      this.shellsBtn = h(
        'button',
        { class: 'ui-counter ui-counter--shells', type: 'button', hidden: true, on: { click: () => this.focusNextShell() } },
        icon,
        h('span', { class: 'ui-counter__stack' }, value, label),
      );
      this.counters.set('shells', { el: this.shellsBtn, value, label });
      counterWrap.insertBefore(this.shellsBtn, this.counters.get('waiting')!.el);
    }

    this.usage = new UsageCards(ctx);

    this.sidebarBtn = iconButton(ICONS.sidebar, tr('Painel lateral ( [ )'), () => ctx.togglePanel('sidebar'), 'ui-btn-sidebar');
    this.feedBtn = iconButton(ICONS.feed, tr('Feed de atividade ( ] )'), () => ctx.togglePanel('feed'), 'ui-btn-feed');
    this.timelapseBtn = iconButton(TIMELAPSE_ICONS.timelapse, tr('Timelapse: reproduzir o dia (L)'), () => ctx.toggleTimelapse(), 'ui-btn-timelapse');
    // Habblaud World: escondido até a janela dele (ui/world/world-dialog.ts) dizer que há servidor do mundo configurado.
    this.worldBtn = iconButton(ICONS.city, tr('Habblaud World'), () => ctx.toggleWorld(), 'ui-btn-world');
    this.worldBtn.setAttribute('aria-haspopup', 'dialog');
    this.worldBtn.hidden = true;
    this.settingsBtn = iconButton(ICONS.settings, tr('Configurações'), () => ctx.toggleSettings());
    this.settingsBtn.setAttribute('aria-haspopup', 'dialog');
    this.spawnPanel = new SpawnPanel(ctx);
    ctx.root.append(this.spawnPanel.el);
    this.spawnBtn = iconButton(ICONS.newAgent, tr('Novo agente: começa uma sessão do Claude Code no computador'), () => this.spawnPanel.toggle(this.spawnBtn), 'ui-btn-spawn');
    this.spawnBtn.setAttribute('aria-haspopup', 'dialog');
    this.spawnBtn.hidden = true;
    this.version = new VersionChip(ctx, this.settingsBtn);
    this.status = h('div', { class: 'ui-topbar__status' }, this.pill, this.version.el, this.demoBadge);
    this.overviewBtn = iconButton(ICONS.overview, tr('Visão geral (O)'), () => ctx.camera('overview'));
    const viewGroup = h(
      'div',
      { class: 'ui-btn-group', role: 'group', attrs: { 'aria-label': tr('Câmera') } },
      this.overviewBtn,
      iconButton(ICONS.zoomOut, tr('Afastar (−)'), () => ctx.camera('zoomOut')),
      iconButton(ICONS.zoomIn, tr('Aproximar (+)'), () => ctx.camera('zoomIn')),
    );
    const panelGroup = h(
      'div',
      { class: 'ui-btn-group', role: 'group', attrs: { 'aria-label': tr('Painéis') } },
      this.spawnBtn,
      this.timelapseBtn,
      this.feedBtn,
      this.worldBtn,
      this.settingsBtn,
      iconButton(ICONS.help, tr('Ajuda (?)'), () => ctx.openHelp()),
    );
    this.panelGroup = panelGroup;

    this.moreDot = h('span', { class: 'ui-topbar__more-dot', hidden: true, attrs: { 'aria-hidden': 'true' } });
    this.moreBtn = iconButton(MORE_ICON, tr('Mais opções'), () => this.toggleMore(), 'ui-topbar__more');
    this.moreBtn.setAttribute('aria-haspopup', 'menu');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    this.moreBtn.append(this.moreDot);
    this.moreMenu = h('div', { class: 'ui-popover ui-more', role: 'menu', tabIndex: -1, attrs: { popover: 'auto', 'aria-label': tr('Mais opções') } });
    this.moreMenu.addEventListener('toggle', () => setAttr(this.moreBtn, 'aria-expanded', String(this.moreOpen)));
    this.moreMenu.addEventListener('keydown', (e) => this.onMoreKey(e));
    ctx.root.append(this.moreMenu);

    this.el = h(
      'header',
      { class: 'ui-topbar', role: 'banner' },
      h(
        'div',
        { class: 'ui-topbar__left' },
        this.sidebarBtn,
        h(
          'div',
          { class: 'ui-brand' },
          mark,
          h('div', { class: 'ui-brand__text' }, wordmark(), this.status),
        ),
      ),
      counterWrap,
      this.usage.el,
      h('div', { class: 'ui-topbar__right' }, viewGroup, panelGroup, this.moreBtn),
    );
  }

  // ---------------------------------------------------------------- menu "⋮" (celular)

  private get moreOpen(): boolean {
    try {
      return this.moreMenu.matches(':popover-open');
    } catch {
      return this.moreMenu.classList.contains('is-open');
    }
  }

  private hideMore(): void {
    if (typeof this.moreMenu.hidePopover === 'function' && this.moreOpen) this.moreMenu.hidePopover();
    this.moreMenu.classList.remove('is-open');
    setAttr(this.moreBtn, 'aria-expanded', 'false');
  }

  /** Os botões que o menu mostra: Visão geral e os painéis visíveis (os escondidos, ou sem uso aqui, ficam de fora). */
  private moreButtons(): HTMLButtonElement[] {
    const all = [this.overviewBtn, ...Array.from(this.panelGroup.children)];
    return all.filter((b): b is HTMLButtonElement => b instanceof HTMLButtonElement && !b.hidden && getComputedStyle(b).display !== 'none');
  }

  private toggleMore(): void {
    if (this.moreOpen) return this.hideMore();
    const items = this.moreButtons().map((btn) => {
      const icon = h('span', { class: 'ui-more__icon', attrs: { 'aria-hidden': 'true' } });
      icon.innerHTML = btn.innerHTML;
      const label = btn.getAttribute('aria-label') || btn.title || '';
      const item = h(
        'button',
        { class: `ui-more__item${btn.getAttribute('aria-pressed') === 'true' ? ' is-on' : ''}`, type: 'button', role: 'menuitem' },
        icon,
        h('span', { class: 'ui-more__label', text: label }),
      );
      item.addEventListener('click', () => {
        this.hideMore();
        // o botão de verdade faz o trabalho (e abre o painel dele no canto do "⋮": dom.ts, anchorRect)
        btn.click();
      });
      return item;
    });
    this.moreMenu.replaceChildren(...items);
    const r = this.moreBtn.getBoundingClientRect();
    this.moreMenu.style.top = `${Math.round(r.bottom + 8)}px`;
    this.moreMenu.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.moreMenu.showPopover === 'function') this.moreMenu.showPopover();
    else this.moreMenu.classList.add('is-open');
    setAttr(this.moreBtn, 'aria-expanded', 'true');
    (items[0] as HTMLElement | undefined)?.focus({ preventScroll: true });
  }

  /** Setas, Home e End andam pelos itens do menu (Esc fecha: é um popover). */
  private onMoreKey(e: KeyboardEvent): void {
    const items = Array.from(this.moreMenu.querySelectorAll<HTMLElement>('.ui-more__item'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    items[next].focus();
  }

  /** Acrescenta um selo à linha de status da marca, depois da versão (ex.: o chip do Habblaud World). */
  addStatus(el: HTMLElement): void {
    this.status.append(el);
  }

  /** Botão Mundo (troca de cena), ao lado do Timelapse. */
  addSceneButton(btn: HTMLElement): void {
    this.panelGroup.insertBefore(btn, this.timelapseBtn);
  }

  /** Acrescenta um botão de janela própria (ex.: Meu dia) ao começo do grupo de painéis. */
  addPanelButton(btn: HTMLElement): void {
    this.panelGroup.prepend(btn);
  }

  render(): void {
    const { store } = this.ctx;
    const snap = store.snapshot;
    setHidden(this.moreDot, !this.panelGroup.querySelector('[class*="badge"]:not([hidden])'));

    // Conexão.
    const conn = store.connection;
    if (conn === 'open') this.hadOpen = true;
    const label =
      conn === 'open' ? tr('Conectado') : conn === 'mock' ? tr('Simulação') : conn === 'closed' ? tr('Desconectado') : this.hadOpen ? tr('Reconectando…') : tr('Conectando…');
    setText(this.pillText, label);
    setVariant(this.pill, 'is-', conn);
    setTitle(
      this.pill,
      conn === 'mock'
        ? tr('Dados simulados no navegador (?mock=1)')
        : conn === 'open'
          ? tr('Recebendo eventos do servidor em tempo real')
          : tr('Sem conexão com o servidor do Habblaud'),
    );
    setHidden(this.demoBadge, !(conn === 'open' && snap?.meta.demo));

    // Contadores.
    const now = this.ctx.now();
    const c = computeCounters(snap, now);
    for (const def of COUNTERS) {
      const refs = this.counters.get(def.key)!;
      const n = c[def.key];
      setText(refs.value, formatInt(n));
      setText(refs.label, n === 1 ? def.singular : def.plural);
      setAttr(refs.el, 'aria-label', `${formatInt(n)} ${n === 1 ? def.singular : def.plural}`);
    }
    const waiting = this.counters.get('waiting')!.el as HTMLButtonElement;
    waiting.classList.toggle('is-active', c.waiting > 0);
    waiting.disabled = c.waiting === 0;
    // Pedidos que dá para responder por aqui (hook de permissão: permissões e perguntas): a dica diz quantos.
    const answerable = permissionAgents(snap?.agents ?? []).length;
    waiting.classList.toggle('has-answer', answerable > 0);
    setTitle(
      waiting,
      answerable
        ? tr('{0}. {1} para responder por aqui: clique para ir até {2} (P).', [WAITING_HINT, answerable === 1 ? tr('1 pedido (permissão ou pergunta) dá') : tr('{0} pedidos (permissões ou perguntas) dão', [answerable]), answerable === 1 ? tr('ele') : tr('cada um')])
        : tr('{0}. Clique para ir até o primeiro.', [WAITING_HINT]),
    );
    this.renderShells(c.shells, now);

    this.usage.render();
    this.version.render();
    setHidden(this.spawnBtn, !access().spawn || store.mock || store.replaying);

    this.sidebarBtn.setAttribute('aria-pressed', String(this.ctx.isPanelOpen('sidebar')));
    this.feedBtn.setAttribute('aria-pressed', String(this.ctx.isPanelOpen('feed')));
    this.timelapseBtn.setAttribute('aria-pressed', String(this.ctx.isTimelapseOpen()));
    setHidden(this.timelapseBtn, store.mock);
  }

  private renderShells(n: number, now: number): void {
    const refs = this.counters.get('shells')!;
    setHidden(this.shellsBtn, n === 0);
    if (n === 0) {
      this.shellCursor = 0;
      return;
    }
    const all = this.ctx.store.snapshot?.agents ?? [];
    const agents = shellWaitingAgents(all, now);
    setText(refs.value, formatInt(n));
    setText(refs.label, n === 1 ? 'shell' : 'shells');
    const who = agents.length === 1 ? agents[0].name : tr('{0} agentes', [formatInt(agents.length)]);
    setAttr(refs.el, 'aria-label', tr('{0} {1}; {2} esperando. Ir até o próximo.', [formatInt(n), n === 1 ? tr('shell rodando') : tr('shells rodando'), who]));
    // Dica: quem espera o quê, do que espera há mais tempo.
    const lines = agents.slice(0, 6).map((a) => {
      const w = shellWaitIn(a, all, now)!;
      return `${a.name}: ${shellLine(w, now).label} (${formatDuration(now - w.since)})`;
    });
    if (agents.length > 6) lines.push(tr('… e mais {0}', [agents.length - 6]));
    setTitle(refs.el, tr('Shells rodando: {0} terminar.\n{1}\nClique para ir até {2}.', [agents.length === 1 ? tr('o agente espera') : tr('os agentes esperam'), lines.join('\n'), agents.length > 1 ? tr('cada um') : tr('ele')]));
  }

  private focusNextShell(): void {
    const agents = shellWaitingAgents(this.ctx.store.snapshot?.agents ?? [], this.ctx.now());
    if (!agents.length) return;
    // Se o atual já está selecionado, passa para o próximo da fila.
    const sel = this.ctx.selection();
    let i = this.shellCursor % agents.length;
    if (sel?.type === 'agent' && agents[i].id === sel.id) i = (i + 1) % agents.length;
    this.shellCursor = i + 1;
    this.ctx.select({ type: 'agent', id: agents[i].id }, { focus: true });
  }

  private focusFirstWaiting(): void {
    // Quem tem pedido para responder pelo escritório vem antes (cliques seguidos passam por todos).
    const agents = this.ctx.store.snapshot?.agents ?? [];
    const sel = this.ctx.selection();
    const next = nextPermissionAgent(agents, sel?.type === 'agent' ? sel.id : undefined);
    if (next) return focusPermission(this.ctx, next.id);
    const first = waitingAgents(agents)[0];
    if (first) this.ctx.select({ type: 'agent', id: first.id }, { focus: true });
  }
}
