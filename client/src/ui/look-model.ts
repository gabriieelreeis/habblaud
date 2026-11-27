// Editor de visual do personagem, parte pura (sem DOM): as abas, as paletas de cores, como uma escolha muda a
// aparência (as peças novas e a peça de sempre mais parecida, para o World e o avatar pequeno) e o que vai para o
// servidor em `parts`. A interface fica em look-fields.ts.
import { LOOK_KEYS, type AgentParts, type LookKey, type LookParts } from '../../../shared/appearance';
import { tr } from '../../../shared/i18n';
import type { Appearance } from '../art/api';
import { lookFromAppearance, legacyOfLook } from '../art/avatar/from-appearance';
import {
  BEARDS, BODIES, BOTTOMS, EXTRAS, GLASSES, HAIRS, HATS, SHOES, SKIN_TONES, TOPS, type Look, type Option,
} from '../art/avatar/look';
import { changedParts } from './character-model';

/** Tudo o que o editor muda: as peças novas e as cores/pelos que continuam nos campos de sempre da aparência. */
export type LookField = LookKey | 'skin' | 'hair' | 'facialHair' | 'top' | 'topAccent' | 'bottom' | 'shoes';

export interface LookRow {
  key: LookField;
  label: string;
  kind: 'style' | 'color';
}

export interface LookTab {
  id: string;
  label: string;
  rows: readonly LookRow[];
}

const style = (key: LookField, label: string): LookRow => ({ key, label, kind: 'style' });
const color = (key: LookField): LookRow => ({ key, label: tr('Cor'), kind: 'color' });

export const LOOK_TABS: readonly LookTab[] = [
  { id: 'body', label: tr('Corpo'), rows: [style('body', tr('Corpo')), { key: 'skin', label: tr('Pele'), kind: 'color' }] },
  { id: 'hair', label: tr('Cabelo'), rows: [style('cut', tr('Corte')), color('hair'), style('facialHair', tr('Barba'))] },
  { id: 'hat', label: tr('Chapéu'), rows: [style('hat', tr('Chapéu')), color('hatColor')] },
  { id: 'glasses', label: tr('Óculos'), rows: [style('glasses', tr('Óculos'))] },
  {
    id: 'top',
    label: tr('Em cima'),
    rows: [style('topCut', tr('Corte')), color('top'), { key: 'topAccent', label: tr('Detalhe'), kind: 'color' }],
  },
  { id: 'bottom', label: tr('Embaixo'), rows: [style('bottomCut', tr('Corte')), color('bottom')] },
  { id: 'shoes', label: tr('Sapatos'), rows: [style('shoesCut', tr('Corte')), color('shoes')] },
  { id: 'extra', label: tr('Acessório'), rows: [style('extra', tr('Acessório')), color('extraColor')] },
];

// ------------------------------------------------------------------ opções de estilo

// Rótulos passados por tr() aqui (a arte guarda só o texto em português, sem tradução).
const LABELS: Readonly<Record<string, string>> = {
  'body:a': tr('Reto'), 'body:b': tr('Cintura marcada'),
  'cut:bald': tr('Careca'), 'cut:short': tr('Curto'), 'cut:buzz': tr('Raspado'), 'cut:afro': tr('Black power'), 'cut:bun': tr('Coque'),
  'cut:mohawk': tr('Moicano'), 'cut:ponytail': tr('Rabo de cavalo'), 'cut:long': tr('Longo'), 'cut:curly': tr('Cacheado'),
  'cut:spiky': tr('Espetado'), 'cut:side_part': tr('Lateral repartido'), 'cut:wavy': tr('Ondulado'), 'cut:bob': tr('Chanel'),
  'cut:pigtails': tr('Maria-chiquinha'), 'cut:bangs': tr('Franja'), 'cut:braids': tr('Tranças'), 'cut:dreads': tr('Dreads'),
  'cut:quiff': tr('Topete'), 'cut:space_buns': tr('Coque duplo'), 'cut:undercut': tr('Raspado nas laterais'), 'cut:long_bangs': tr('Longo com franja'),
  'hat:none': tr('Nenhum'), 'hat:cap': tr('Boné'), 'hat:cap_back': tr('Boné para trás'), 'hat:beanie': tr('Gorro'),
  'hat:bucket': tr('Chapéu de balde'), 'hat:top': tr('Cartola'), 'hat:straw': tr('Chapéu de palha'), 'hat:bow': tr('Laço'),
  'glasses:none': tr('Nenhum'), 'glasses:glasses': tr('Óculos'), 'glasses:round': tr('Óculos redondos'), 'glasses:shades': tr('Óculos escuros'),
  'topCut:tee': tr('Camiseta'), 'topCut:polo': tr('Polo'), 'topCut:hoodie': tr('Moletom'), 'topCut:jacket': tr('Jaqueta'),
  'topCut:suit': tr('Terno'), 'topCut:tank': tr('Regata'), 'topCut:dress': tr('Vestido'), 'topCut:shirt_tie': tr('Camisa com gravata'),
  'topCut:sweater': tr('Suéter'), 'topCut:blouse': tr('Blusa'),
  'bottomCut:jeans': tr('Jeans'), 'bottomCut:shorts': tr('Bermuda'), 'bottomCut:skirt': tr('Saia'), 'bottomCut:slacks': tr('Calça social'),
  'bottomCut:long_skirt': tr('Saia longa'),
  'shoesCut:sneakers': tr('Tênis'), 'shoesCut:dress': tr('Sapato'), 'shoesCut:boots': tr('Bota'), 'shoesCut:sandals': tr('Sandália'),
  'extra:none': tr('Nenhum'), 'extra:necklace': tr('Colar'), 'extra:earring': tr('Brinco'), 'extra:headphones': tr('Fone'),
  'extra:backpack': tr('Mochila'), 'extra:scarf': tr('Cachecol'),
  'facialHair:none': tr('Nenhuma'), 'facialHair:stubble': tr('Por fazer'), 'facialHair:beard': tr('Barba'),
  'facialHair:mustache': tr('Bigode'), 'facialHair:goatee': tr('Cavanhaque'),
};

const STYLE_LISTS: Partial<Record<LookField, readonly Option<string>[]>> = {
  body: BODIES, cut: HAIRS, hat: HATS, glasses: GLASSES, topCut: TOPS, bottomCut: BOTTOMS, shoesCut: SHOES, extra: EXTRAS, facialHair: BEARDS,
};

/** Rótulo (traduzido) de uma opção de estilo; sem tradução cadastrada, o da arte. */
export function optionLabel(key: LookField, id: string): string {
  return LABELS[`${key}:${id}`] ?? STYLE_LISTS[key]?.find((o) => o.id === id)?.label ?? id;
}

/** Opções de estilo de uma linha (vazio para as de cor). */
export function styleOptions(key: LookField): readonly Option<string>[] {
  return STYLE_LISTS[key] ?? [];
}

// ------------------------------------------------------------------ paletas

const HAIR_COLORS: readonly string[] = [
  '#2b2530', '#3f2c22', '#5f3c28', '#87593a', '#b0703c', '#8e3b2b', '#d6ae68', '#ebdcb0', '#8f929b', '#d9dbe0',
  '#e47aa8', '#5b8fe0', '#8f6ad8', '#3fb3a0', '#e0584e', '#f0a24a',
];
const CLOTH_COLORS: readonly string[] = [
  '#262a33', '#3d4352', '#8a96a3', '#f1efe9', '#e3d3b2', '#6e4c38', '#2f4c7d', '#4a86d8', '#5bc0de', '#36b0b0', '#4bab72',
  '#76913f', '#efb54a', '#c9713f', '#e2604f', '#b04a5a', '#e47aa8', '#8d66cf',
];

/** Cores de uma linha de cor para esta aparência; a cor atual entra no fim quando não está na paleta. */
export function paletteFor(key: LookField, a: Appearance): readonly string[] {
  const l = lookFromAppearance(a);
  const base = key === 'skin' ? SKIN_TONES : key === 'hair' ? HAIR_COLORS : CLOTH_COLORS;
  const cur = currentColor(key, l);
  return cur && !base.includes(cur) ? [...base, cur] : base;
}

function currentColor(key: LookField, l: Look): string | undefined {
  switch (key) {
    case 'skin': return l.skin;
    case 'hair': return l.hairColor;
    case 'hatColor': return l.hatColor;
    case 'top': return l.topColor;
    case 'topAccent': return l.accent;
    case 'bottom': return l.bottomColor;
    case 'shoes': return l.shoesColor;
    case 'extraColor': return l.extraColor;
    default: return undefined;
  }
}

/** Valor atual de uma linha (id do estilo ou cor), segundo o visual que a aparência dá. */
export function valueOf(a: Appearance, key: LookField): string {
  const l = lookFromAppearance(a);
  switch (key) {
    case 'body': return l.body;
    case 'cut': return l.hair;
    case 'hat': return l.hat;
    case 'glasses': return l.glasses;
    case 'topCut': return l.top;
    case 'bottomCut': return l.bottom;
    case 'shoesCut': return l.shoes;
    case 'extra': return l.extra;
    case 'facialHair': return l.beard;
    default: return currentColor(key, l) ?? '';
  }
}

/** A linha aparece? Cor do chapéu/acessório só com a peça; detalhe só nas roupas que o usam. */
export function rowShown(r: LookRow, a: Appearance): boolean {
  const l = lookFromAppearance(a);
  if (r.key === 'hatColor') return l.hat !== 'none';
  if (r.key === 'extraColor') return l.extra !== 'none' && l.extra !== 'earring';
  if (r.key === 'topAccent') return ACCENT_TOPS.includes(l.top);
  if (r.key === 'bottom') return l.top !== 'dress';
  if (r.key === 'bottomCut') return l.top !== 'dress';
  return true;
}
const ACCENT_TOPS: readonly string[] = ['hoodie', 'polo', 'blouse', 'shirt_tie', 'suit'];

// ------------------------------------------------------------------ aplicar uma escolha

const PIECE_OF: Record<LookKey, (l: Look) => string> = {
  body: (l) => l.body, cut: (l) => l.hair, hat: (l) => l.hat, hatColor: (l) => l.hatColor, glasses: (l) => l.glasses,
  topCut: (l) => l.top, bottomCut: (l) => l.bottom, shoesCut: (l) => l.shoes, extra: (l) => l.extra, extraColor: (l) => l.extraColor,
};
const isPiece = (k: LookField): k is LookKey => (LOOK_KEYS as readonly string[]).includes(k);

/** As peças novas todas explícitas (o visual atual), para uma troca não mexer no que era só derivado da peça antiga. */
function pinned(a: Appearance): LookParts {
  const l = lookFromAppearance(a);
  const out: Record<string, string> = {};
  for (const k of LOOK_KEYS) out[k] = PIECE_OF[k](l);
  return out as LookParts;
}

/** Aparência nova com uma escolha aplicada; não altera a original. */
export function applyLook(a: Appearance, key: LookField, value: string): Appearance {
  if (!isPiece(key)) {
    const next: Appearance = { ...a, pieces: pinned(a) };
    if (key === 'facialHair') next.facialHair = value as Appearance['facialHair'];
    else next[key] = value;
    return withLegacy(next);
  }
  const pieces = { ...pinned(a), [key]: value } as LookParts;
  return withLegacy({ ...a, pieces });
}

/** Ajusta as peças de sempre mais parecidas com o visual (o World e o avatar pequeno só conhecem essas). */
function withLegacy(a: Appearance): Appearance {
  const l = lookFromAppearance(a);
  const legacy = legacyOfLook(l);
  const accessoryColor = l.hat !== 'none' ? l.hatColor : l.extra !== 'none' ? l.extraColor : a.accessoryColor;
  return { ...a, ...legacy, accessoryColor };
}

// ------------------------------------------------------------------ sorteio

/** Gerador de números em [0, 1) (o `Math.random` ou um determinístico nos testes). */
export type Rng = () => number;

const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

/** Sorteia todas as peças e as cores, sem as combinações que a arte não desenha bem. */
export function randomLook(a: Appearance, rng: Rng = Math.random): Appearance {
  let cur: Appearance = { ...a, pieces: pinned(a) };
  const set = (k: LookField, v: string): void => {
    cur = applyLook(cur, k, v);
  };
  const ids = (k: LookField) => styleOptions(k).map((o) => o.id);
  set('skin', pick(rng, SKIN_TONES));
  set('body', pick(rng, ids('body')));
  const cut = pick(rng, ids('cut'));
  set('cut', cut);
  set('hair', pick(rng, HAIR_COLORS));
  set('facialHair', cur.look === 'm' && rng() < 0.4 ? pick(rng, ids('facialHair')) : 'none');
  // as mesmas combinações que o editor de sempre recusa: boné e gorro sobre cabelo alto, laço sem cabelo
  const tall = ['afro', 'bun', 'mohawk', 'pigtails', 'space_buns'].includes(cut);
  const bare = cut === 'bald' || cut === 'buzz';
  const hats = ids('hat').filter((h) => h !== 'none' && !(tall && (h === 'cap' || h === 'cap_back' || h === 'beanie')) && !(bare && h === 'bow'));
  set('hat', rng() < 0.25 ? pick(rng, hats) : 'none');
  set('hatColor', pick(rng, CLOTH_COLORS));
  set('glasses', rng() < 0.3 ? pick(rng, ids('glasses').filter((g) => g !== 'none')) : 'none');
  const top = pick(rng, ids('topCut'));
  set('topCut', top);
  set('top', pick(rng, CLOTH_COLORS));
  set('topAccent', pick(rng, CLOTH_COLORS));
  // vestido cobre as pernas: sem parte de baixo para combinar
  set('bottomCut', top === 'dress' ? 'jeans' : pick(rng, ids('bottomCut')));
  set('bottom', pick(rng, CLOTH_COLORS));
  const formal = top === 'suit' || top === 'shirt_tie';
  set('shoesCut', formal ? 'dress' : pick(rng, ids('shoesCut').filter((s) => s !== 'dress')));
  set('shoes', pick(rng, CLOTH_COLORS));
  set('extra', rng() < 0.3 ? pick(rng, ids('extra').filter((e) => e !== 'none')) : 'none');
  set('extraColor', pick(rng, CLOTH_COLORS));
  return cur;
}

// ------------------------------------------------------------------ salvar

/** Pares (peça nova, campo do visual) que o servidor guarda só quando diferem do que a aparência de sempre já daria. */
export function editedParts(base: Appearance, edited: Appearance): AgentParts {
  const old = changedParts(base, edited);
  const target = lookFromAppearance(edited);
  // aparência de sempre já com as 13 peças trocadas; as novas entram só onde o visual sem elas não bate
  const restored = (pieces: LookParts): Appearance => ({ ...base, ...old, ...(Object.keys(pieces).length ? { pieces } : { pieces: undefined }) });
  const pieces: Record<string, string> = {};
  // topCut antes de shoesCut: o sapato derivado depende da roupa
  const order: LookKey[] = ['body', 'cut', 'hat', 'hatColor', 'glasses', 'topCut', 'bottomCut', 'shoesCut', 'extra', 'extraColor'];
  for (const k of order) {
    const want = PIECE_OF[k](target);
    if (PIECE_OF[k](lookFromAppearance(restored(pieces as LookParts))) !== want) pieces[k] = want;
  }
  const out: Record<string, string> = { ...old };
  for (const k of LOOK_KEYS) if (pieces[k] !== undefined) out[k] = pieces[k];
  return out as AgentParts;
}
