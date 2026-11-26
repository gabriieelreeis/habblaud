// Pré-geração dos sprites dos personagens presentes, em fatias pequenas nas folgas do quadro: as poses que quase todo
// mundo usa (na abertura, quando alguém entra ou muda de aparência) e as que vêm no plano de cada um (próximos passos
// e a roda de que participa). O que ainda não estiver pronto quando for preciso continua sendo gerado na hora; os
// sprites de quem saiu são esquecidos (memória no celular).
import type { Appearance, CharacterFrameRequest, Dir, HeldItem, Pose } from '../../art/api';
import type { Step } from '../sim/steps';
import type { GatherKind } from '../social/gathering';

export interface WarmCombo {
  pose: Pose;
  held: HeldItem;
  seated: boolean;
}

const combo = (pose: Pose, held: HeldItem = 'none', seated = false): WarmCombo => ({ pose, held, seated });

/** Para todos, em ordem de uso: em pé e andando primeiro, depois a mesa, a espera e as reações. */
export const BASE_COMBOS: readonly WarmCombo[] = [
  combo('stand'),
  combo('walk'),
  combo('sit', 'none', true),
  combo('type', 'none', true),
  combo('raise_hand', 'none', true),
  combo('talk'),
  combo('wait', 'none', true),
  combo('wait', 'popcorn', true),
  combo('run'),
  combo('use'),
  combo('raise_hand'),
  combo('sleep', 'none', true),
  combo('cheer'),
  combo('cheer', 'none', true),
  combo('drink', 'coffee'),
  combo('drink', 'water'),
  combo('read', 'laptop'),
  combo('type', 'laptop', true),
];

/** No celular, só o começo da lista (o resto sai do plano de cada um ou na hora). */
export const MOBILE_BASE = 8;

/** O que cada roda usa: a pose dela e as reações. */
export const GATHER_COMBOS: Readonly<Record<GatherKind, readonly WarmCombo[]>> = {
  tv: [combo('sit', 'none', true), combo('wait', 'popcorn', true), combo('laugh', 'none', true), combo('cheer', 'none', true), combo('sleep', 'none', true)],
  videogame: [combo('game', 'controller', true), combo('sit', 'none', true), combo('cheer', 'none', true), combo('sulk', 'none', true), combo('laugh', 'none', true)],
  arcade: [combo('use'), combo('cheer'), combo('sulk')],
  pingpong: [combo('play', 'paddle'), combo('stand'), combo('cheer'), combo('sulk')],
  kitchen: [combo('sit', 'coffee', true), combo('sit', 'water', true), combo('drink', 'coffee', true), combo('drink', 'water', true), combo('talk', 'coffee', true), combo('laugh', 'none', true)],
  talk: [combo('stand'), combo('talk'), combo('laugh')],
  rps: [combo('rps'), combo('rps', 'rock'), combo('rps', 'paper'), combo('rps', 'scissors'), combo('cheer'), combo('sulk'), combo('laugh')],
  mirror: [combo('groom', 'lipstick'), combo('groom', 'comb'), combo('stand')],
};

/** As poses que um passo do plano vai usar (quem carrega algo anda, para e conversa com ele na mão). */
export function combosOfStep(step: Step | null | undefined, seated: boolean): WarmCombo[] {
  if (!step) return [];
  switch (step.t) {
    case 'go': {
      const held = step.held ?? 'none';
      const out = [combo(step.run ? 'run' : 'walk', held)];
      if (held !== 'none') out.push(combo('stand', held), combo('talk', held));
      return out;
    }
    case 'act':
      return [combo(step.pose, step.held ?? 'none', step.seated ?? seated)];
    case 'until':
      return step.pose ? [combo(step.pose, step.held ?? 'none', seated)] : [];
    case 'enter':
      return [combo('sit', 'none', true)];
    case 'gather':
      return [...GATHER_COMBOS[step.g.kind]];
    default:
      return [];
  }
}

const DIRS: readonly Dir[] = ['down', 'right', 'up', 'left'];

const comboKey = (c: WarmCombo) => `${c.pose}|${c.held}|${c.seated ? 1 : 0}`;

/** O que o aquecedor lê de cada personagem (o `Character` da simulação serve). */
export interface WarmPerson {
  readonly id: string;
  readonly appearance: Appearance;
  readonly pose: Pose;
  readonly held: HeldItem;
  readonly seated: boolean;
  readonly step: Step | null;
  readonly queue: readonly Step[];
  readonly gathering: { readonly kind: GatherKind } | null;
  readonly info: { readonly seed: number };
}

type Costume = CharacterFrameRequest['costume'];

interface Track {
  appearance: Appearance;
  costume: Costume;
  /** Combinações já postas na fila. */
  done: Set<string>;
  /** Próxima combinação da lista base. */
  base: number;
  lastStep: Step | null;
  lastNext: Step | undefined;
  lastGather: GatherKind | null;
  lastPose: string;
}

export interface WarmOptions {
  /** Gera (e guarda no cache da arte) um sprite. */
  make(req: CharacterFrameRequest): void;
  /** Quadros de cada pose. */
  frames(pose: Pose): number;
  /** Pede uma folga: chama `run` com o tempo que dá para usar (ms). */
  schedule(run: (budget: number) => void): void;
  /** Esquece os sprites de quem não está em `keep`. */
  forget?(keep: readonly Appearance[]): void;
  now(): number;
  /** Quantas combinações da lista base cada um recebe. */
  baseCount?: number;
  /** Teto por fatia (ms). */
  sliceMs?: number;
  /** Quanto tempo depois de sair os sprites de alguém são esquecidos (ms). */
  forgetAfterMs?: number;
}

export class SpriteWarmer {
  private tracks = new Map<string, Track>();
  /** Sprites que o plano de alguém vai pedir logo (antes da lista base). */
  private urgent: { id: string; req: CharacterFrameRequest }[] = [];
  /** Sprites da combinação base que está sendo gerada. */
  private batch: { id: string; req: CharacterFrameRequest }[] = [];
  private present = new Set<string>();
  private goneAt = new Map<string, number>();
  private scheduled = false;
  private readonly baseCount: number;
  private readonly sliceMs: number;
  private readonly forgetAfterMs: number;
  /** Sprites gerados pelo aquecedor (para medir). */
  made = 0;

  constructor(private readonly o: WarmOptions) {
    this.baseCount = Math.min(BASE_COMBOS.length, o.baseCount ?? BASE_COMBOS.length);
    this.sliceMs = o.sliceMs ?? 4;
    this.forgetAfterMs = o.forgetAfterMs ?? 20_000;
  }

  /** Chamado a cada quadro com quem está no escritório: registra quem chegou, antecipa o plano, esquece quem saiu. */
  sync(people: Iterable<WarmPerson>, costumeOf: (p: WarmPerson) => Costume): void {
    const now = this.o.now();
    const present = this.present;
    present.clear();
    const appearances: Appearance[] = [];
    for (const p of people) {
      present.add(p.id);
      appearances.push(p.appearance);
      this.goneAt.delete(p.id);
      const costume = costumeOf(p);
      let t = this.tracks.get(p.id);
      if (!t || t.appearance !== p.appearance || t.costume !== costume) {
        t = { appearance: p.appearance, costume, done: new Set(), base: 0, lastStep: null, lastNext: undefined, lastGather: null, lastPose: '' };
        this.tracks.set(p.id, t);
      }
      // a pose de agora: as outras direções e quadros dela
      const pose = `${p.pose}|${p.held}|${p.seated ? 1 : 0}`;
      if (pose !== t.lastPose) {
        t.lastPose = pose;
        this.want(p.id, t, combo(p.pose, p.held, p.seated));
      }
      // o plano: passo atual, o próximo e a roda
      const next = p.queue[0];
      const g = p.gathering?.kind ?? null;
      if (p.step !== t.lastStep || next !== t.lastNext || g !== t.lastGather) {
        t.lastStep = p.step;
        t.lastNext = next;
        t.lastGather = g;
        for (const c of combosOfStep(p.step, p.seated)) this.want(p.id, t, c);
        for (const c of combosOfStep(next, p.seated)) this.want(p.id, t, c);
        if (g) for (const c of GATHER_COMBOS[g]) this.want(p.id, t, c);
      }
    }
    // quem saiu: depois de um tempo, os sprites dele vão embora
    let forget = false;
    for (const id of this.tracks.keys()) {
      if (present.has(id)) continue;
      const since = this.goneAt.get(id);
      if (since === undefined) this.goneAt.set(id, now);
      else if (now - since >= this.forgetAfterMs) {
        this.tracks.delete(id);
        this.goneAt.delete(id);
        forget = true;
      }
    }
    if (forget) this.o.forget?.(appearances);
    if (this.pending()) this.kick();
  }

  /** Há trabalho na fila? */
  pending(): boolean {
    if (this.urgent.length || this.batch.length) return true;
    for (const [id, t] of this.tracks) if (this.present.has(id) && t.base < this.baseCount) return true;
    return false;
  }

  /** Gera até gastar `budget` ms (no máximo uma fatia); devolve quantos sprites saíram. */
  run(budget: number): number {
    const t0 = this.o.now();
    const limit = Math.min(budget, this.sliceMs);
    let n = 0;
    while (this.o.now() - t0 < limit) {
      const job = this.urgent.shift() ?? this.batch.shift() ?? this.nextBase();
      if (!job) break;
      if (!this.present.has(job.id)) continue;
      this.o.make(job.req);
      n++;
    }
    this.made += n;
    return n;
  }

  private kick(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.o.schedule((budget) => {
      this.scheduled = false;
      if (budget >= 1) this.run(budget);
      if (this.pending()) this.kick();
    });
  }

  /** A próxima combinação base de quem está mais atrás (todos ganham em pé e andando antes do resto). */
  private nextBase(): { id: string; req: CharacterFrameRequest } | undefined {
    let best: [string, Track] | null = null;
    for (const [id, t] of this.tracks) {
      if (!this.present.has(id) || t.base >= this.baseCount) continue;
      if (!best || t.base < best[1].base) best = [id, t];
    }
    if (!best) return undefined;
    const [id, t] = best;
    const c = BASE_COMBOS[t.base++];
    const key = comboKey(c);
    if (!t.done.has(key)) {
      t.done.add(key);
      this.expand(id, t, c, this.batch);
    }
    return this.batch.shift() ?? this.nextBase();
  }

  private want(id: string, t: Track, c: WarmCombo): void {
    const key = comboKey(c);
    if (t.done.has(key)) return;
    t.done.add(key);
    this.expand(id, t, c, this.urgent);
  }

  private expand(id: string, t: Track, c: WarmCombo, out: { id: string; req: CharacterFrameRequest }[]): void {
    const n = Math.max(1, this.o.frames(c.pose) || 1);
    for (let frame = 0; frame < n; frame++)
      for (const dir of DIRS) out.push({ id, req: { appearance: t.appearance, dir, pose: c.pose, frame, held: c.held, seated: c.seated, costume: t.costume } });
  }
}

/** Folga do navegador: `requestIdleCallback` quando existe; senão, um intervalo curto com orçamento fixo. */
export function idleScheduler(sliceMs = 4): (run: (budget: number) => void) => void {
  const w = globalThis as typeof globalThis & { requestIdleCallback?: (cb: (d: { didTimeout: boolean; timeRemaining(): number }) => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') {
    const ric = w.requestIdleCallback.bind(w);
    // sem folga por 1 s (tela sempre ocupada): uma fatia curta assim mesmo, para a fila andar
    return (run) => ric((d) => run(d.didTimeout ? Math.min(2, sliceMs) : Math.min(sliceMs, d.timeRemaining())), { timeout: 1000 });
  }
  return (run) => setTimeout(() => run(sliceMs), 50);
}
