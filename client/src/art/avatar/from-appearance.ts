// Ponte entre a aparência de sempre (13 peças, sorteadas pela semente) e o visual por peças (puro). Quem não escolheu
// nada no editor novo ganha a peça mais parecida com a que já tinha: mesmas cores, mesmo tipo de cabelo e de roupa.
import type { AppearanceParts, LookParts } from '../../../../shared/appearance';
import type { Appearance } from '../api';
import type { BottomId, ExtraId, GlassesId, HairId, HatId, Look, ShoesId, TopId } from './look';

const TOP: Record<Appearance['topStyle'], TopId> = {
  tshirt: 'tee', hoodie: 'hoodie', shirt_tie: 'shirt_tie', sweater: 'sweater', jacket: 'jacket', blouse: 'blouse', polo: 'polo',
};
const BOTTOM: Record<NonNullable<Appearance['bottomStyle']>, BottomId> = { pants: 'jeans', shorts: 'shorts', skirt: 'skirt' };

const hatOf = (acc: Appearance['accessory']): HatId => (acc === 'cap' ? 'cap' : acc === 'beanie' ? 'beanie' : acc === 'bow' ? 'bow' : 'none');
const glassesOf = (acc: Appearance['accessory']): GlassesId => (acc === 'glasses' ? 'glasses' : acc === 'sunglasses' ? 'shades' : 'none');
const extraOf = (acc: Appearance['accessory']): ExtraId => (acc === 'headphones' ? 'headphones' : acc === 'earrings' ? 'earring' : 'none');

const looks = new WeakMap<Appearance, Look>();

/** O visual por peças de uma aparência (guardado por objeto: a mesma aparência dá o mesmo visual). */
export function lookFromAppearance(a: Appearance): Look {
  const hit = looks.get(a);
  if (hit) return hit;
  const p: LookParts = a.pieces ?? {};
  const top: TopId = p.topCut ?? TOP[a.topStyle] ?? 'tee';
  const shoes: ShoesId = p.shoesCut ?? (top === 'shirt_tie' || top === 'suit' ? 'dress' : 'sneakers');
  const look: Look = {
    skin: a.skin,
    body: p.body ?? (a.look === 'f' ? 'b' : 'a'),
    hair: (p.cut ?? a.hairStyle) as HairId,
    hairColor: a.hair,
    hat: p.hat ?? hatOf(a.accessory),
    hatColor: p.hatColor ?? a.accessoryColor,
    glasses: p.glasses ?? glassesOf(a.accessory),
    top,
    topColor: a.top,
    bottom: p.bottomCut ?? BOTTOM[a.bottomStyle ?? 'pants'],
    bottomColor: a.bottom,
    shoes,
    shoesColor: a.shoes,
    extra: p.extra ?? extraOf(a.accessory),
    extraColor: p.extraColor ?? a.accessoryColor,
    beard: a.facialHair ?? 'none',
    accent: a.topAccent,
    lanyard: a.lanyard,
  };
  looks.set(a, look);
  return look;
}

const OLD_HAIR: Partial<Record<HairId, NonNullable<AppearanceParts['hairStyle']>>> = {
  bangs: 'short', braids: 'long', dreads: 'long', quiff: 'spiky', space_buns: 'bun', undercut: 'side_part', long_bangs: 'long',
};
const OLD_TOP: Partial<Record<TopId, NonNullable<AppearanceParts['topStyle']>>> = { tee: 'tshirt', suit: 'shirt_tie', tank: 'tshirt', dress: 'blouse' };
const OLD_BOTTOM: Record<BottomId, NonNullable<AppearanceParts['bottomStyle']>> = { jeans: 'pants', slacks: 'pants', shorts: 'shorts', skirt: 'skirt', long_skirt: 'skirt' };

/**
 * As 13 peças de sempre mais parecidas com um visual novo: é o que o Habblaud World recebe (ele não conhece as peças
 * novas). O acessório antigo é um só: chapéu, depois óculos, depois fone/brinco.
 */
export function legacyOfLook(l: Pick<Look, 'hair' | 'hat' | 'glasses' | 'top' | 'bottom' | 'extra'>): Pick<AppearanceParts, 'hairStyle' | 'topStyle' | 'bottomStyle' | 'accessory'> {
  const accessory: NonNullable<AppearanceParts['accessory']> =
    l.hat === 'cap' || l.hat === 'cap_back' || l.hat === 'bucket' || l.hat === 'straw' || l.hat === 'top'
      ? 'cap'
      : l.hat === 'beanie'
        ? 'beanie'
        : l.hat === 'bow'
          ? 'bow'
          : l.glasses === 'shades'
            ? 'sunglasses'
            : l.glasses !== 'none'
              ? 'glasses'
              : l.extra === 'headphones'
                ? 'headphones'
                : l.extra === 'earring'
                  ? 'earrings'
                  : 'none';
  return {
    hairStyle: OLD_HAIR[l.hair] ?? (l.hair as NonNullable<AppearanceParts['hairStyle']>),
    topStyle: OLD_TOP[l.top] ?? (l.top as NonNullable<AppearanceParts['topStyle']>),
    bottomStyle: OLD_BOTTOM[l.bottom],
    accessory,
  };
}
