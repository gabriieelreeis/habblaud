import { describe, expect, it } from 'vitest';
import type { Appearance, CharacterFrameRequest, HeldItem, Pose } from '../../art/api';
import type { Step } from '../sim/steps';
import type { GatherKind } from '../social/gathering';
import { BASE_COMBOS, SpriteWarmer, combosOfStep, type WarmPerson } from './sprite-warm';

const FOUR = new Set<Pose>(['walk', 'run', 'type']);
const frames = (p: Pose) => (FOUR.has(p) ? 4 : 2);

/** A mesma aparência para o mesmo id (como no personagem da simulação). */
const looks = new Map<string, Appearance>();
const look = (id: string) => looks.get(id) ?? (looks.set(id, { id } as unknown as Appearance), looks.get(id)!);

function person(id: string, o: Partial<{ pose: Pose; held: HeldItem; seated: boolean; step: Step | null; queue: Step[]; gather: GatherKind; seed: number }> = {}) {
  return {
    id,
    appearance: look(id),
    pose: o.pose ?? 'stand',
    held: o.held ?? 'none',
    seated: o.seated ?? false,
    step: o.step ?? null,
    queue: o.queue ?? [],
    gathering: o.gather ? { kind: o.gather } : null,
    info: { seed: o.seed ?? 1 },
  } satisfies WarmPerson;
}

/** Aquecedor com relógio falso: cada sprite gerado gasta `cost` ms; as folgas ficam numa fila. */
function rig(o: { cost?: number; baseCount?: number; forgetAfterMs?: number } = {}) {
  let clock = 0;
  const made: string[] = [];
  const idle: ((budget: number) => void)[] = [];
  const forgot: string[][] = [];
  const w = new SpriteWarmer({
    make: (r: CharacterFrameRequest) => {
      clock += o.cost ?? 1;
      made.push(`${(r.appearance as unknown as { id: string }).id}|${r.pose}|${r.held}|${r.seated ? 1 : 0}|${r.dir}|${r.frame}|${r.costume ?? '-'}`);
    },
    frames,
    schedule: (run) => idle.push(run),
    forget: (keep) => forgot.push(keep.map((a) => (a as unknown as { id: string }).id)),
    now: () => clock,
    baseCount: o.baseCount,
    forgetAfterMs: o.forgetAfterMs,
  });
  const drain = (budget = 4, max = 10_000) => {
    for (let i = 0; i < max && idle.length; i++) idle.shift()!(budget);
  };
  return { w, made, idle, forgot, drain, tick: (ms: number) => (clock += ms) };
}

const noCostume = () => undefined;

describe('aquecedor de sprites de personagem', () => {
  it('na abertura, todo mundo ganha em pé e andando antes do resto da lista', () => {
    const r = rig();
    r.w.sync([person('a'), person('b')], noCostume);
    r.drain();
    const lastWalk = Math.max(...r.made.map((m, i) => (m.split('|')[1] === 'walk' ? i : -1)));
    const firstSit = r.made.findIndex((m) => m.split('|')[1] === 'sit');
    expect(lastWalk).toBeGreaterThan(0);
    expect(lastWalk).toBeLessThan(firstSit);
    // a lista base inteira, nas 4 direções e em todos os quadros, para os dois
    const perPerson = BASE_COMBOS.reduce((n, c) => n + 4 * frames(c.pose), 0);
    expect(r.made.filter((m) => m.startsWith('a|')).length).toBe(perPerson);
    expect(r.made.filter((m) => m.startsWith('b|')).length).toBe(perPerson);
    expect(new Set(r.made).size).toBe(r.made.length);
    expect(r.w.pending()).toBe(false);
  });

  it('cada folga gasta no máximo a fatia (passa de um sprite, no máximo)', () => {
    const r = rig({ cost: 1.5 });
    r.w.sync([person('a')], noCostume);
    expect(r.idle.length).toBe(1);
    r.idle.shift()!(50);
    expect(r.made.length).toBe(3);
    // folga curta demais: não gera nada e pede outra
    r.idle.shift()!(0.5);
    expect(r.made.length).toBe(3);
    expect(r.idle.length).toBe(1);
  });

  it('o que vem no plano (próximo passo, roda) passa na frente da lista base', () => {
    const r = rig();
    const queue: Step[] = [{ t: 'act', pose: 'game', held: 'controller', seated: true, ms: 1000 }];
    r.w.sync([person('a', { queue })], noCostume);
    r.drain(4, 3);
    const kinds = r.made.map((m) => m.split('|').slice(1, 4).join('|'));
    // primeiro a pose de agora (em pé, 2 quadros x 4 direções), depois o videogame
    expect(kinds.slice(0, 8).every((k) => k === 'stand|none|0')).toBe(true);
    expect(kinds.slice(8, 16).every((k) => k === 'game|controller|1')).toBe(true);
  });

  it('na roda de pedra-papel-tesoura, os gestos ficam prontos antes de aparecer', () => {
    const r = rig();
    r.w.sync([person('a', { gather: 'rps' })], noCostume);
    r.drain();
    for (const held of ['rock', 'paper', 'scissors']) expect(r.made.some((m) => m.includes(`|rps|${held}|`))).toBe(true);
  });

  it('pose nova de alguém: as outras direções e quadros dela vêm na hora seguinte', () => {
    const r = rig({ baseCount: 1 });
    r.w.sync([person('a')], noCostume);
    r.drain();
    const before = r.made.length;
    r.w.sync([person('a', { pose: 'stretch' })], noCostume);
    r.drain();
    expect(r.made.slice(before).filter((m) => m.includes('|stretch|')).length).toBe(8);
  });

  it('fantasia ou aparência nova gera tudo de novo', () => {
    const r = rig({ baseCount: 2 });
    r.w.sync([person('a')], noCostume);
    r.drain();
    const n = r.made.length;
    r.w.sync([person('a')], noCostume);
    r.drain();
    expect(r.made.length).toBe(n);
    r.w.sync([person('a')], () => 'santa');
    r.drain();
    expect(r.made.length).toBe(2 * n);
    expect(r.made.slice(n).every((m) => m.endsWith('|santa'))).toBe(true);
    r.w.sync([{ ...person('a'), appearance: { id: 'a' } as unknown as Appearance }], () => 'santa');
    r.drain();
    expect(r.made.length).toBe(3 * n);
  });

  it('quem sai: os sprites dele são esquecidos depois de um tempo, e a fila dele não roda', () => {
    const r = rig({ forgetAfterMs: 1000 });
    const a = person('a');
    const b = person('b');
    r.w.sync([a, b], noCostume);
    r.drain(4, 2);
    r.w.sync([b], noCostume);
    r.drain();
    expect(r.made.filter((m) => m.startsWith('a|')).length).toBeLessThan(10);
    expect(r.forgot).toEqual([]);
    r.tick(1000);
    r.w.sync([b], noCostume);
    expect(r.forgot).toEqual([['b']]);
  });

  it('sem trabalho, não pede mais folga', () => {
    const r = rig({ baseCount: 1 });
    r.w.sync([person('a')], noCostume);
    r.drain();
    expect(r.idle.length).toBe(0);
    r.w.sync([person('a')], noCostume);
    expect(r.idle.length).toBe(0);
  });

  it('poses de cada passo do plano', () => {
    expect(combosOfStep({ t: 'go', tx: 1, ty: 1, held: 'box' }, false)).toEqual([
      { pose: 'walk', held: 'box', seated: false },
      { pose: 'stand', held: 'box', seated: false },
      { pose: 'talk', held: 'box', seated: false },
    ]);
    expect(combosOfStep({ t: 'go', tx: 1, ty: 1, run: true }, false)).toEqual([{ pose: 'run', held: 'none', seated: false }]);
    expect(combosOfStep({ t: 'enter', spot: 's' }, false)).toEqual([{ pose: 'sit', held: 'none', seated: true }]);
    expect(combosOfStep({ t: 'act', pose: 'drink', held: 'coffee', ms: 1 }, true)).toEqual([{ pose: 'drink', held: 'coffee', seated: true }]);
    expect(combosOfStep({ t: 'exit' }, true)).toEqual([]);
    expect(combosOfStep(null, false)).toEqual([]);
  });
});
