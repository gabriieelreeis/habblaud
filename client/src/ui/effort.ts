// Controle de esforço na gaveta do agente: manda `/effort <nível>` pela mesma fila de mensagens do escritório.
// O comando chega à sessão do Claude Code pelo plugin habblaud-mensagens; em outros executáveis a linha aparece
// desativada, porque o nível de esforço é uma opção da sessão do Claude Code.
import { tr } from '../../../shared/i18n';
import type { AgentInfo, Provider } from '../../../shared/types';
import type { UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function effortCommand(level: EffortLevel): string {
  return `/effort ${level}`;
}

export function effortAvailable(provider: Provider | undefined): boolean {
  return (provider ?? 'claude') === 'claude';
}

export class EffortControl {
  readonly el: HTMLElement;
  private select: HTMLSelectElement;
  private status: HTMLElement;
  private agentId = '';
  private busy = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ctx: UiContext) {
    this.select = h('select', {
      class: 'ui-effort__select',
      attrs: { 'aria-label': tr('Esforço do agente') },
      on: { change: () => void this.change() },
    });
    this.select.append(
      h('option', { text: tr('Trocar esforço…'), attrs: { value: '' } }),
      ...EFFORT_LEVELS.map((level) => h('option', { text: level, attrs: { value: level } })),
    );
    this.status = h('span', { class: 'ui-effort__status', hidden: true });
    this.el = h('span', { class: 'ui-effort' }, this.select, this.status);
  }

  render(agent: AgentInfo | undefined, ready: boolean): void {
    const id = agent?.id ?? '';
    if (id !== this.agentId) {
      this.agentId = id;
      this.select.value = '';
      this.clearStatus();
    }
    const can = !!agent && !this.busy && ready && effortAvailable(agent.provider);
    this.select.disabled = !can;
    setTitle(this.select, !agent || effortAvailable(agent.provider) ? tr('Muda o esforço da sessão com /effort') : tr('O esforço só muda em sessões do Claude Code'));
  }

  private async change(): Promise<void> {
    const level = this.select.value;
    if (!isEffortLevel(level) || this.busy || !this.agentId) return;
    const agentId = this.agentId;
    this.busy = true;
    this.select.disabled = true;
    this.say(tr('Enviando {0}…', [effortCommand(level)]));
    const r = await this.ctx.store.sendMessage(agentId, effortCommand(level));
    this.busy = false;
    this.select.value = '';
    if ('error' in r) this.say(r.error, true);
    else this.say(tr('{0} enviado; entra quando a sessão estiver livre', [effortCommand(level)]));
    this.ctx.invalidate();
  }

  private say(text: string, error = false): void {
    if (this.timer) clearTimeout(this.timer);
    setText(this.status, text);
    setHidden(this.status, false);
    this.status.classList.toggle('is-error', error);
    if (!error) this.timer = setTimeout(() => this.clearStatus(), 8_000);
  }

  private clearStatus(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    setText(this.status, '');
    setHidden(this.status, true);
    this.status.classList.remove('is-error');
  }
}
