// Modelo de dados do personagem por peças (puro): ids, rótulos em PT para o editor futuro e uma paleta de pele própria.

export type BodyId = 'a' | 'b';
export type HairId =
  | 'bald' | 'short' | 'buzz' | 'afro' | 'bun' | 'mohawk' | 'ponytail' | 'long' | 'curly'
  | 'spiky' | 'side_part' | 'wavy' | 'bob' | 'pigtails'
  | 'bangs' | 'braids' | 'dreads' | 'quiff' | 'space_buns' | 'undercut' | 'long_bangs';
export type HatId = 'none' | 'cap' | 'cap_back' | 'beanie' | 'bucket' | 'top' | 'straw' | 'bow';
export type GlassesId = 'none' | 'glasses' | 'round' | 'shades';
export type TopId = 'tee' | 'polo' | 'hoodie' | 'jacket' | 'suit' | 'tank' | 'dress' | 'shirt_tie' | 'sweater' | 'blouse';
export type BottomId = 'jeans' | 'shorts' | 'skirt' | 'slacks' | 'long_skirt';
export type ShoesId = 'sneakers' | 'dress' | 'boots' | 'sandals';
export type ExtraId = 'none' | 'necklace' | 'earring' | 'headphones' | 'backpack' | 'scarf';
export type BeardId = 'none' | 'stubble' | 'beard' | 'mustache' | 'goatee';

export interface Look {
  skin: string;
  body: BodyId;
  hair: HairId;
  hairColor: string;
  hat: HatId;
  hatColor: string;
  glasses: GlassesId;
  top: TopId;
  topColor: string;
  bottom: BottomId;
  bottomColor: string;
  shoes: ShoesId;
  shoesColor: string;
  extra: ExtraId;
  extraColor: string;
  beard: BeardId;
  /** Cor secundária: gravata (camisa e terno), forro do capuz, colarinho da polo. */
  accent: string;
  /** Crachá no pescoço (cor do cordão); null = sem crachá. */
  lanyard: string | null;
}

export interface Option<T extends string> {
  id: T;
  label: string;
}

/** 8 tons de pele, do mais claro ao mais escuro. */
export const SKIN_TONES: readonly string[] = ['#fbe3d0', '#f4cfae', '#e6b48c', '#cf9569', '#b27749', '#8d5a35', '#684025', '#46291a'];

export const BODIES: readonly Option<BodyId>[] = [
  { id: 'a', label: 'Reto' },
  { id: 'b', label: 'Cintura marcada' },
];

export const HAIRS: readonly Option<HairId>[] = [
  { id: 'bald', label: 'Careca' },
  { id: 'short', label: 'Curto' },
  { id: 'buzz', label: 'Raspado' },
  { id: 'afro', label: 'Black power' },
  { id: 'bun', label: 'Coque' },
  { id: 'mohawk', label: 'Moicano' },
  { id: 'ponytail', label: 'Rabo de cavalo' },
  { id: 'long', label: 'Longo' },
  { id: 'curly', label: 'Cacheado' },
  { id: 'spiky', label: 'Espetado' },
  { id: 'side_part', label: 'Lateral repartido' },
  { id: 'wavy', label: 'Ondulado' },
  { id: 'bob', label: 'Chanel' },
  { id: 'pigtails', label: 'Maria-chiquinha' },
  { id: 'bangs', label: 'Franja' },
  { id: 'braids', label: 'Tranças' },
  { id: 'dreads', label: 'Dreads' },
  { id: 'quiff', label: 'Topete' },
  { id: 'space_buns', label: 'Coque duplo' },
  { id: 'undercut', label: 'Raspado nas laterais' },
  { id: 'long_bangs', label: 'Longo com franja' },
];

export const HATS: readonly Option<HatId>[] = [
  { id: 'none', label: 'Nenhum' },
  { id: 'cap', label: 'Boné' },
  { id: 'cap_back', label: 'Boné para trás' },
  { id: 'beanie', label: 'Gorro' },
  { id: 'bucket', label: 'Chapéu de balde' },
  { id: 'top', label: 'Cartola' },
  { id: 'straw', label: 'Chapéu de palha' },
  { id: 'bow', label: 'Laço' },
];

export const GLASSES: readonly Option<GlassesId>[] = [
  { id: 'none', label: 'Nenhum' },
  { id: 'glasses', label: 'Óculos' },
  { id: 'round', label: 'Óculos redondos' },
  { id: 'shades', label: 'Óculos escuros' },
];

export const TOPS: readonly Option<TopId>[] = [
  { id: 'tee', label: 'Camiseta' },
  { id: 'polo', label: 'Polo' },
  { id: 'hoodie', label: 'Moletom' },
  { id: 'jacket', label: 'Jaqueta' },
  { id: 'suit', label: 'Terno' },
  { id: 'tank', label: 'Regata' },
  { id: 'dress', label: 'Vestido' },
  { id: 'shirt_tie', label: 'Camisa com gravata' },
  { id: 'sweater', label: 'Suéter' },
  { id: 'blouse', label: 'Blusa' },
];

export const BOTTOMS: readonly Option<BottomId>[] = [
  { id: 'jeans', label: 'Jeans' },
  { id: 'shorts', label: 'Bermuda' },
  { id: 'skirt', label: 'Saia' },
  { id: 'slacks', label: 'Calça social' },
  { id: 'long_skirt', label: 'Saia longa' },
];

export const SHOES: readonly Option<ShoesId>[] = [
  { id: 'sneakers', label: 'Tênis' },
  { id: 'dress', label: 'Sapato' },
  { id: 'boots', label: 'Bota' },
  { id: 'sandals', label: 'Sandália' },
];

export const EXTRAS: readonly Option<ExtraId>[] = [
  { id: 'none', label: 'Nenhum' },
  { id: 'necklace', label: 'Colar' },
  { id: 'earring', label: 'Brinco' },
  { id: 'headphones', label: 'Fone' },
  { id: 'backpack', label: 'Mochila' },
  { id: 'scarf', label: 'Cachecol' },
];

export const BEARDS: readonly Option<BeardId>[] = [
  { id: 'none', label: 'Nenhuma' },
  { id: 'stubble', label: 'Por fazer' },
  { id: 'beard', label: 'Barba' },
  { id: 'mustache', label: 'Bigode' },
  { id: 'goatee', label: 'Cavanhaque' },
];

export const DEFAULT_LOOK: Look = {
  skin: SKIN_TONES[2],
  body: 'a',
  hair: 'short',
  hairColor: '#4a3020',
  hat: 'none',
  hatColor: '#c8453b',
  glasses: 'none',
  top: 'tee',
  topColor: '#3f7fd0',
  bottom: 'jeans',
  bottomColor: '#35466e',
  shoes: 'sneakers',
  shoesColor: '#e8e8ee',
  extra: 'none',
  extraColor: '#e0b030',
  beard: 'none',
  accent: '#b8334a',
  lanyard: null,
};

/** Aplica só os campos informados sobre o look padrão. */
export function makeLook(over: Partial<Look> = {}): Look {
  return { ...DEFAULT_LOOK, ...over };
}
