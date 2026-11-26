// Modelo e esforço na gaveta do agente: o valor atual de cada sessão (e de onde ele veio) e a troca por aqui
// (POST /api/controls; ver server/controls/controls.ts).
// - Claude Code: a troca vira `/effort <nível>` ou `/model <modelo>` na fila de mensagens e vale quando a sessão roda o
//   comando (a saída dele na conversa confirma). Por padrão vale só para a sessão: o escritório devolve ao settings.json
//   o padrão das sessões novas que o comando gravou; a caixinha "Também como padrão das sessões novas" deixa gravado.
// - OpenCode: o modelo e o nível de raciocínio (variant) da sessão, pelo serviço dele; a lista vem do próprio OpenCode.
import { tr } from '../../../shared/i18n';
import { MODEL_SWITCH_LOCK_MS } from '../../../shared/messages';
import type { AgentEffort, AgentInfo, ControlKind, ControlState, ModelOption, Provider } from '../../../shared/types';
import type { UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';
import { formatClock, prettyModel } from './format';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];
/** Apelidos de modelo do Claude Code (`/model <apelido>`); outro id vai pelo "Outro…". */
export const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const;
const OTHER = '__other__';
const MODELS_TTL_MS = 5 * 60_000;
const POLL_LIMIT_MS = 31 * 60_000;

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function effortCommand(level: string): string {
  return `/effort ${level}`;
}

export function modelCommand(model: string): string {
  return `/model ${model}`;
}

/** Onde dá para trocar modelo e esforço pela gaveta. */
export function controlsAvailable(provider: Provider | undefined): boolean {
  const p = provider ?? 'claude';
  return p === 'claude' || p === 'opencode';
}

/** Apelido do Claude Code para um id de modelo ("claude-opus-5-5" -> "opus"). */
export function claudeAlias(model: string | undefined): string | undefined {
  const m = model?.toLowerCase() ?? '';
  return CLAUDE_MODELS.find((a) => new RegExp(`(^|[-/])${a}($|[-\\d\\[])`).test(m));
}

/**
 * Até quando a troca de modelo do Claude Code fica travada: com a conversa em cache ele pede confirmação na tela da
 * sessão, que ninguém vê pelo escritório.
 */
export function modelLockedUntil(a: Pick<AgentInfo, 'provider' | 'replyAt'>, now: number): number | undefined {
  if (a.provider === 'opencode' || a.replyAt === undefined) return undefined;
  const until = a.replyAt + MODEL_SWITCH_LOCK_MS;
  return until > now ? until : undefined;
}

/** De onde veio o esforço mostrado, em palavras. */
export function effortOrigin(e: AgentEffort | undefined, provider: Provider | undefined): string {
  if (!e) return (provider ?? 'claude') === 'opencode' ? tr('padrão do modelo no OpenCode') : tr('padrão do modelo (o settings.json não define)');
  switch (e.source) {
    case 'command':
      return e.at ? tr('confirmado pelo /effort às {0}', [formatClock(e.at, false)]) : tr('confirmado pelo /effort');
    case 'flag':
      return tr('aberta com --effort {0}', [e.level]);
    case 'settings':
      return tr('padrão do settings.json (provável)');
    case 'session':
      return tr('escolhido na sessão do OpenCode');
  }
}

/** Texto do modelo atual: o da última resposta e, se for outro, o escolhido para as próximas. */
export function modelSummary(a: Pick<AgentInfo, 'model' | 'modelChoice' | 'provider'>): string {
  const last = a.model ? tr('última resposta: {0}', [a.provider === 'opencode' ? a.model : prettyModel(a.model)]) : tr('ainda sem resposta nesta sessão');
  const next = a.modelChoice?.label;
  if (!next || next === a.model) return last;
  return tr('{0} · próximas: {1}', [last, next]);
}

/** Linha de situação de uma troca. */
export function controlStatusText(s: ControlState, provider: Provider | undefined): { text: string; tone: 'muted' | 'ok' | 'error' } {
  const what = s.kind === 'effort' ? (provider === 'opencode' ? tr('raciocínio {0}', [s.value]) : tr('esforço {0}', [s.value])) : s.variant ? `${s.value} · ${s.variant}` : s.value;
  const cmd = s.kind === 'effort' ? effortCommand(s.value) : modelCommand(s.value);
  if (s.status === 'failed') return { text: tr('Não deu: {0}', [s.error ?? tr('a sessão não recebeu a troca')]), tone: 'error' };
  if (s.status === 'sending') return { text: provider === 'opencode' ? tr('Trocando para {0}…', [what]) : tr('Enviando {0}…', [cmd]), tone: 'muted' };
  if (s.status === 'waiting') return { text: tr('{0} entregue; vale quando a sessão rodar o comando (ela pode estar no meio de um turno)', [cmd]), tone: 'muted' };
  const done = s.kind === 'model' ? tr('Confirmado: {0} nas próximas respostas.', [what]) : tr('Confirmado: {0}.', [what]);
  switch (s.defaults) {
    case 'pending':
      return { text: tr('{0} Devolvendo o padrão das sessões novas…', [done]), tone: 'ok' };
    case 'restored':
      return { text: tr('{0} O padrão das sessões novas continua o de antes.', [done]), tone: 'ok' };
    case 'saved':
      return { text: tr('{0} Também ficou como padrão das sessões novas.', [done]), tone: 'ok' };
    case 'restore-failed':
      return { text: `${done} ${s.error ?? tr('Não deu para devolver o padrão das sessões novas.')}`, tone: 'error' };
    default:
      return { text: done, tone: 'ok' };
  }
}

/** Modelos agrupados por provedor, na ordem em que o OpenCode os lista. */
export function groupModels(models: readonly ModelOption[]): Map<string, ModelOption[]> {
  const out = new Map<string, ModelOption[]>();
  for (const m of models) {
    const list = out.get(m.provider) ?? [];
    list.push(m);
    out.set(m.provider, list);
  }
  return out;
}

/** O que a troca vai pedir ao servidor numa mudança dos seletores do OpenCode. */
export function openCodeRequest(kind: ControlKind, value: string, current: { model?: string; variant?: string }, models: readonly ModelOption[]): { kind: ControlKind; value: string; variant?: string } | undefined {
  if (kind === 'model') {
    const variants = models.find((m) => m.id === value)?.variants ?? [];
    return current.variant && variants.includes(current.variant) ? { kind, value, variant: current.variant } : { kind, value };
  }
  if (!current.model) return undefined;
  return value ? { kind: 'effort', value } : { kind: 'model', value: current.model };
}

type Local = { state: ControlState } | { error: string };

export class SessionControls {
  readonly el: HTMLElement;
  private modelSel: HTMLSelectElement;
  private modelOther: HTMLElement;
  private modelInput: HTMLInputElement;
  private modelGo: HTMLButtonElement;
  private modelNow: HTMLElement;
  private effortLabel: HTMLElement;
  private effortSel: HTMLSelectElement;
  private effortNow: HTMLElement;
  private defaultRow: HTMLLabelElement;
  private defaultInput: HTMLInputElement;
  private status: HTMLElement;
  private agent: AgentInfo | undefined;
  private ready = false;
  /** Última troca de cada agente. */
  private states = new Map<string, Local>();
  private models: ModelOption[] | null = null;
  private modelsAt = 0;
  private modelsError = '';
  private loadingModels = false;
  /** O que os seletores mostram agora (refeitos só quando muda e nenhum deles está em uso). */
  private shown = '';

  constructor(private ctx: UiContext) {
    this.modelSel = h('select', { class: 'ui-ctl__select', attrs: { 'aria-label': tr('Modelo do agente') }, on: { change: () => void this.onModel() } });
    this.modelInput = h('input', { class: 'ui-ctl__input', type: 'text', attrs: { 'aria-label': tr('Id do modelo'), placeholder: 'claude-sonnet-5-5', autocomplete: 'off', spellcheck: 'false', maxlength: 100 } }) as HTMLInputElement;
    this.modelInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.sendOther();
      }
    });
    this.modelGo = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Trocar'), on: { click: () => void this.sendOther() } });
    this.modelOther = h('div', { class: 'ui-ctl__other', hidden: true }, this.modelInput, this.modelGo);
    this.modelNow = h('p', { class: 'ui-ctl__now' });
    this.effortLabel = h('span', { class: 'ui-ctl__label', text: tr('Esforço') });
    this.effortSel = h('select', { class: 'ui-ctl__select', attrs: { 'aria-label': tr('Esforço do agente') }, on: { change: () => void this.onEffort() } });
    this.effortNow = h('p', { class: 'ui-ctl__now' });
    this.defaultInput = h('input', { type: 'checkbox', class: 'ui-ctl__check' }) as HTMLInputElement;
    this.defaultRow = h('label', { class: 'ui-ctl__default' }, this.defaultInput, h('span', { text: tr('Também como padrão das sessões novas') }));
    setTitle(this.defaultRow, tr('Desmarcada, a troca vale só para esta sessão: o Habblaud devolve ao settings.json o padrão que o Claude Code gravaria.'));
    this.status = h('p', { class: 'ui-ctl__status', role: 'status', hidden: true, attrs: { 'aria-live': 'polite' } });
    this.el = h(
      'div',
      { class: 'ui-ctl' },
      h('div', { class: 'ui-ctl__row' }, h('span', { class: 'ui-ctl__label', text: tr('Modelo') }), h('div', { class: 'ui-ctl__field' }, this.modelSel, this.modelOther, this.modelNow)),
      h('div', { class: 'ui-ctl__row' }, this.effortLabel, h('div', { class: 'ui-ctl__field' }, this.effortSel, this.effortNow)),
      this.defaultRow,
      this.status,
    );
  }

  /** Atualiza para `agent`; `ready` = dá para mandar agora; `why` = o motivo quando não dá. Devolve se aparece. */
  render(agent: AgentInfo | undefined, ready: boolean, why: string): boolean {
    const visible = !!agent && agent.kind === 'main' && controlsAvailable(agent.provider) && !this.ctx.store.replaying;
    if (!visible || !agent) {
      this.agent = undefined;
      return false;
    }
    if (agent.id !== this.agent?.id) setHidden(this.modelOther, true);
    this.agent = agent;
    this.ready = ready;
    const opencode = agent.provider === 'opencode';
    if (opencode) void this.loadModels();
    const local = this.states.get(agent.id);
    const busy = !!local && 'state' in local && (local.state.status === 'sending' || local.state.status === 'waiting');

    setText(this.effortLabel, opencode ? tr('Raciocínio') : tr('Esforço'));
    const lockedUntil = modelLockedUntil(agent, Date.now());
    const lockText = lockedUntil ? tr('troca liberada às {0}: com a conversa em cache, o Claude Code pede confirmação na tela da sessão', [formatClock(lockedUntil, false)]) : '';
    setText(this.modelNow, lockText ? `${modelSummary(agent)}\n${lockText}` : modelSummary(agent));
    const variants = opencode ? this.variantsOf(this.currentModel(agent)) : [];
    const noVariants = opencode && this.models !== null && variants.length === 0;
    setText(this.effortNow, noVariants ? tr('este modelo não tem níveis de raciocínio no OpenCode') : effortOrigin(agent.effort, agent.provider));
    this.renderSelects(agent, local);
    this.modelSel.disabled = !ready || busy || !!lockedUntil || (opencode && !this.models?.length);
    this.effortSel.disabled = !ready || busy || noVariants || (opencode && !this.currentModel(agent));
    this.modelInput.disabled = this.modelGo.disabled = !ready || busy || !!lockedUntil;
    setTitle(this.modelSel, !ready ? why : lockText || (opencode ? tr('Troca o modelo das próximas respostas desta sessão no OpenCode') : tr('Manda /model à sessão')));
    setTitle(this.effortSel, !ready ? why : noVariants ? tr('Este modelo não tem níveis de raciocínio no OpenCode') : opencode ? tr('Nível de raciocínio do modelo nesta sessão') : tr('Manda /effort à sessão'));
    setHidden(this.defaultRow, opencode);
    this.defaultInput.disabled = !ready || busy;

    const line = local ? ('error' in local ? { text: local.error, tone: 'error' as const } : controlStatusText(local.state, agent.provider)) : !ready && why ? { text: why, tone: 'muted' as const } : opencode && this.modelsError ? { text: this.modelsError, tone: 'error' as const } : undefined;
    setText(this.status, line?.text ?? '');
    setHidden(this.status, !line);
    this.status.classList.toggle('is-error', line?.tone === 'error');
    this.status.classList.toggle('is-ok', line?.tone === 'ok');
    return true;
  }

  // ---------------------------------------------------------------- seletores

  private currentModel(a: AgentInfo): string | undefined {
    return a.modelChoice?.label ?? a.model;
  }

  private variantsOf(model: string | undefined): string[] {
    return (model && this.models?.find((m) => m.id === model)?.variants) || [];
  }

  /** Valor pendente (troca a caminho) ou o atual. */
  private pending(local: Local | undefined, kind: ControlKind): ControlState | undefined {
    const s = local && 'state' in local ? local.state : undefined;
    return s && s.kind === kind && (s.status === 'sending' || s.status === 'waiting') ? s : undefined;
  }

  private renderSelects(a: AgentInfo, local: Local | undefined): void {
    const opencode = a.provider === 'opencode';
    const pModel = this.pending(local, 'model');
    const pEffort = this.pending(local, 'effort');
    const model = pModel?.value ?? (opencode ? this.currentModel(a) : claudeAlias(a.modelChoice?.label) ?? claudeAlias(a.model) ?? a.model);
    const effort = pEffort?.value ?? (opencode ? (pModel ? pModel.variant : a.effort?.level) : a.effort?.level) ?? '';
    const key = `${a.id}|${a.provider}|${model}|${effort}|${this.models?.length ?? -1}`;
    const active = document.activeElement;
    if (key === this.shown || active === this.modelSel || active === this.effortSel) return;
    this.shown = key;

    if (opencode) {
      const groups = groupModels(this.models ?? []);
      const known = (this.models ?? []).some((m) => m.id === model);
      this.modelSel.replaceChildren(
        ...(model && !known ? [h('option', { text: model, attrs: { value: model } })] : []),
        ...(!model ? [h('option', { text: this.models ? tr('padrão do agente') : tr('carregando os modelos…'), attrs: { value: '' } })] : []),
        ...[...groups].map(([provider, list]) => {
          const g = h('optgroup', { attrs: { label: provider } });
          g.append(...list.map((m) => h('option', { text: m.name, attrs: { value: m.id } })));
          return g;
        }),
      );
      const variants = this.variantsOf(model);
      this.effortSel.replaceChildren(
        h('option', { text: tr('padrão do modelo'), attrs: { value: '' } }),
        ...(effort && !variants.includes(effort) ? [effort] : []).concat(variants).map((v) => h('option', { text: v, attrs: { value: v } })),
      );
    } else {
      const aliases: string[] = [...CLAUDE_MODELS];
      if (model && !aliases.includes(model)) aliases.unshift(model);
      this.modelSel.replaceChildren(
        ...(!model ? [h('option', { text: tr('ainda sem resposta'), attrs: { value: '' } })] : []),
        ...aliases.map((m) => h('option', { text: (CLAUDE_MODELS as readonly string[]).includes(m) ? m[0].toUpperCase() + m.slice(1) : m, attrs: { value: m } })),
        h('option', { text: tr('Outro (id completo)…'), attrs: { value: OTHER } }),
      );
      const levels: string[] = [...EFFORT_LEVELS];
      if (effort && !levels.includes(effort)) levels.unshift(effort);
      this.effortSel.replaceChildren(...(!effort ? [h('option', { text: tr('padrão do modelo'), attrs: { value: '' } })] : []), ...levels.map((l) => h('option', { text: l, attrs: { value: l } })));
    }
    this.modelSel.value = model ?? '';
    this.effortSel.value = effort;
  }

  // ---------------------------------------------------------------- trocas

  private async onModel(): Promise<void> {
    const a = this.agent;
    const value = this.modelSel.value;
    if (!a || !value) return;
    if (value === OTHER) {
      this.shown = '';
      setHidden(this.modelOther, false);
      this.modelInput.focus();
      return;
    }
    setHidden(this.modelOther, true);
    if (a.provider === 'opencode') {
      const req = openCodeRequest('model', value, { model: this.currentModel(a), variant: a.effort?.level }, this.models ?? []);
      if (req && value !== this.currentModel(a)) await this.send(a, req);
      return;
    }
    await this.send(a, { kind: 'model', value });
  }

  private async sendOther(): Promise<void> {
    const a = this.agent;
    const value = this.modelInput.value.trim();
    if (!a || !value || a.provider === 'opencode') return;
    this.modelInput.value = '';
    setHidden(this.modelOther, true);
    await this.send(a, { kind: 'model', value });
  }

  private async onEffort(): Promise<void> {
    const a = this.agent;
    const value = this.effortSel.value;
    if (!a) return;
    if (a.provider === 'opencode') {
      const req = openCodeRequest('effort', value, { model: this.currentModel(a), variant: a.effort?.level }, this.models ?? []);
      if (req) await this.send(a, req);
      return;
    }
    if (isEffortLevel(value)) await this.send(a, { kind: 'effort', value });
  }

  private async send(a: AgentInfo, req: { kind: ControlKind; value: string; variant?: string }): Promise<void> {
    if (!this.ready) return;
    const agentId = a.id;
    const now = Date.now();
    const draft: ControlState = { id: '', agentId, kind: req.kind, value: req.value, status: 'sending', createdAt: now, updatedAt: now };
    if (req.variant) draft.variant = req.variant;
    this.set(agentId, { state: draft });
    const asDefault = a.provider !== 'opencode' && this.defaultInput.checked;
    const r = await this.ctx.store.sendControl({ agentId, ...req, ...(asDefault ? { asDefault: true } : {}) });
    if ('error' in r) {
      this.set(agentId, { error: tr('Não deu: {0}', [r.error]) });
      return;
    }
    this.set(agentId, { state: r.control });
    this.defaultInput.checked = false;
    this.poll(agentId, r.control.id, Date.now());
  }

  private poll(agentId: string, id: string, since: number): void {
    const step = async () => {
      const cur = this.states.get(agentId);
      if (!cur || !('state' in cur) || cur.state.id !== id) return;
      const s = cur.state;
      if ((s.status === 'confirmed' || s.status === 'failed') && s.defaults !== 'pending') return;
      if (Date.now() - since > POLL_LIMIT_MS) return;
      let next: ControlState | null | undefined;
      try {
        next = await this.ctx.store.controlStatus(id);
      } catch {
        // sem conexão agora: tenta de novo
      }
      if (next === null) return;
      if (next) this.set(agentId, { state: next });
      const elapsed = Date.now() - since;
      setTimeout(() => void step(), elapsed < 30_000 ? 1_000 : 3_000);
    };
    setTimeout(() => void step(), 700);
  }

  private set(agentId: string, local: Local): void {
    this.states.set(agentId, local);
    this.shown = '';
    this.ctx.invalidate();
  }

  private async loadModels(): Promise<void> {
    if (this.loadingModels || (this.models && Date.now() - this.modelsAt < MODELS_TTL_MS) || !this.agent) return;
    this.loadingModels = true;
    const r = await this.ctx.store.controlModels(this.agent.id);
    this.loadingModels = false;
    this.modelsAt = Date.now();
    if ('error' in r) {
      this.modelsError = tr('Lista de modelos indisponível: {0}', [r.error]);
      this.modelsAt -= MODELS_TTL_MS - 30_000;
      this.models ??= [];
    } else {
      this.modelsError = '';
      this.models = r.models;
    }
    this.shown = '';
    this.ctx.invalidate();
  }
}
