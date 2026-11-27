// Peças da aparência que dá para escolher no editor do personagem: as listas dos estilos, a validação do que chega
// pela API e uma assinatura estável. As paletas e as regras de combinação ficam na arte
// (client/src/art/character/appearance.ts, editorOptions); aqui fica só o formato. Puro: sem Node nem DOM.

export const HAIR_STYLES = [
  'short', 'buzz', 'spiky', 'side_part', 'curly', 'afro', 'bob', 'long', 'ponytail', 'bun', 'pigtails', 'mohawk', 'bald', 'wavy',
] as const;
export const TOP_STYLES = ['tshirt', 'hoodie', 'shirt_tie', 'sweater', 'jacket', 'blouse', 'polo'] as const;
export const ACCESSORIES = ['none', 'glasses', 'sunglasses', 'headphones', 'cap', 'beanie', 'earrings', 'bow'] as const;
export const FACIAL_HAIR = ['none', 'stubble', 'beard', 'mustache', 'goatee'] as const;
export const BOTTOM_STYLES = ['pants', 'shorts', 'skirt'] as const;

/** Peças escolhidas no editor, aplicadas por cima da aparência sorteada pela `seed`. Cores em `#rrggbb`. */
export interface AppearanceParts {
  skin?: string;
  hair?: string;
  hairStyle?: (typeof HAIR_STYLES)[number];
  eyes?: string;
  top?: string;
  topAccent?: string;
  topStyle?: (typeof TOP_STYLES)[number];
  bottom?: string;
  bottomStyle?: (typeof BOTTOM_STYLES)[number];
  shoes?: string;
  accessory?: (typeof ACCESSORIES)[number];
  accessoryColor?: string;
  facialHair?: (typeof FACIAL_HAIR)[number];
}

// Peças do visual por peças (editor de visual): só no escritório. Não sobem ao Habblaud World, que continua com as 13
// de PART_KEYS (cada escolha nova também ajusta a peça antiga mais parecida, ver o editor). Os ids são os mesmos da
// arte (client/src/art/avatar/look.ts; um teste confere).
export const LOOK_BODIES = ['a', 'b'] as const;
export const LOOK_HAIRS = [
  'bald', 'short', 'buzz', 'afro', 'bun', 'mohawk', 'ponytail', 'long', 'curly', 'spiky', 'side_part', 'wavy', 'bob', 'pigtails',
  'bangs', 'braids', 'dreads', 'quiff', 'space_buns', 'undercut', 'long_bangs',
] as const;
export const LOOK_HATS = ['none', 'cap', 'cap_back', 'beanie', 'bucket', 'top', 'straw', 'bow'] as const;
export const LOOK_GLASSES = ['none', 'glasses', 'round', 'shades'] as const;
export const LOOK_TOPS = ['tee', 'polo', 'hoodie', 'jacket', 'suit', 'tank', 'dress', 'shirt_tie', 'sweater', 'blouse'] as const;
export const LOOK_BOTTOMS = ['jeans', 'shorts', 'skirt', 'slacks', 'long_skirt'] as const;
export const LOOK_SHOES = ['sneakers', 'dress', 'boots', 'sandals'] as const;
export const LOOK_EXTRAS = ['none', 'necklace', 'earring', 'headphones', 'backpack', 'scarf'] as const;

/** Peças do visual novo (opcionais): ausente = a peça convertida da aparência antiga. */
export interface LookParts {
  body?: (typeof LOOK_BODIES)[number];
  cut?: (typeof LOOK_HAIRS)[number];
  hat?: (typeof LOOK_HATS)[number];
  hatColor?: string;
  glasses?: (typeof LOOK_GLASSES)[number];
  topCut?: (typeof LOOK_TOPS)[number];
  bottomCut?: (typeof LOOK_BOTTOMS)[number];
  shoesCut?: (typeof LOOK_SHOES)[number];
  extra?: (typeof LOOK_EXTRAS)[number];
  extraColor?: string;
}

export const LOOK_KEYS = ['body', 'cut', 'hat', 'hatColor', 'glasses', 'topCut', 'bottomCut', 'shoesCut', 'extra', 'extraColor'] as const satisfies readonly (keyof LookParts)[];
export type LookKey = (typeof LOOK_KEYS)[number];

const LOOK_VALUES: Partial<Record<LookKey, readonly string[]>> = {
  body: LOOK_BODIES,
  cut: LOOK_HAIRS,
  hat: LOOK_HATS,
  glasses: LOOK_GLASSES,
  topCut: LOOK_TOPS,
  bottomCut: LOOK_BOTTOMS,
  shoesCut: LOOK_SHOES,
  extra: LOOK_EXTRAS,
};

/** Peças de um agente do escritório: as 13 de sempre mais as do visual novo. */
export type AgentParts = AppearanceParts & LookParts;

/**
 * Ordem fixa das peças: a mesma em parseAppearanceParts, partsKey e no editor (changedParts). O timelapse compara
 * por JSON, então a ordem precisa ser estável.
 */
export const PART_KEYS = [
  'skin', 'hair', 'hairStyle', 'eyes', 'top', 'topAccent', 'topStyle', 'bottom', 'bottomStyle', 'shoes', 'accessory',
  'accessoryColor', 'facialHair',
] as const satisfies readonly (keyof AppearanceParts)[];
export type PartKey = (typeof PART_KEYS)[number];

const STYLE_VALUES: Partial<Record<PartKey, readonly string[]>> = {
  hairStyle: HAIR_STYLES,
  topStyle: TOP_STYLES,
  bottomStyle: BOTTOM_STYLES,
  accessory: ACCESSORIES,
  facialHair: FACIAL_HAIR,
};
const COLOR = /^#[0-9a-f]{6}$/i;
// Controle (C0/C1), separadores de linha e parágrafo (U+2028/2029) e marcas de direção do texto (U+200E/200F,
// U+202A–202E, U+2066–2069): dá para disfarçar um nome com elas.
const CONTROL = /[\p{Cc}\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

export const NAME_MAX = 24;

/** Peças válidas na ordem de PART_KEYS (cores em minúsculas), ou null se houver algo fora do formato. */
export function parseAppearanceParts(raw: unknown): AppearanceParts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(src)) if (!(PART_KEYS as readonly string[]).includes(k)) return null;
  const out: Record<string, string> = {};
  for (const k of PART_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') return null;
    const allowed = STYLE_VALUES[k];
    if (allowed ? !allowed.includes(v) : !COLOR.test(v)) return null;
    out[k] = allowed ? v : v.toLowerCase();
  }
  return out as AppearanceParts;
}

/**
 * Peças de um agente do escritório (as 13 de PART_KEYS e as do visual novo, LOOK_KEYS), na ordem das duas listas, ou
 * null se houver algo fora do formato. O personagem do World continua com `parseAppearanceParts`.
 */
export function parseAgentParts(raw: unknown): AgentParts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const old: Record<string, unknown> = {};
  const out: Record<string, string> = {};
  for (const k of Object.keys(src)) {
    if ((PART_KEYS as readonly string[]).includes(k)) old[k] = src[k];
    else if (!(LOOK_KEYS as readonly string[]).includes(k)) return null;
  }
  const base = parseAppearanceParts(old);
  if (!base) return null;
  Object.assign(out, base);
  for (const k of LOOK_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') return null;
    const allowed = LOOK_VALUES[k];
    if (allowed ? !allowed.includes(v) : !COLOR.test(v)) return null;
    out[k] = allowed ? v : v.toLowerCase();
  }
  return out as AgentParts;
}

/** Nome do personagem: NFC, sem espaços sobrando, de 1 a NAME_MAX caracteres e sem caracteres de controle. */
export function parseCharacterName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!name || CONTROL.test(name) || [...name].length > NAME_MAX) return null;
  return name;
}

/** Semente da aparência: inteiro de 32 bits sem sinal. */
export function parseSeed(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 0xffffffff ? raw : null;
}

/** Chave para comparar nomes: "ana" e "Ana" (ou "Júlia" em NFD e em NFC) são o mesmo nome. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLocaleLowerCase('pt-BR');
}

/** Assinatura estável de `parts` (cache de avatares e detecção de mudança). */
export function partsKey(parts: AgentParts | undefined): string {
  if (!parts) return '';
  const base = PART_KEYS.map((k) => parts[k] ?? '').join(',');
  // sem peça nova, a assinatura de sempre
  return LOOK_KEYS.some((k) => parts[k] !== undefined) ? base + ';' + LOOK_KEYS.map((k) => parts[k] ?? '').join(',') : base;
}
