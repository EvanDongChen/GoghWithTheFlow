// How the seasons recolour the country: blossom in spring, rust and gold in autumn, snow in winter.
// Summer is the painting as it always was.
import { mix, palette, type RGB } from '../core/color';
import type { Season, TreeKind } from '../world/world';

const BLOSSOM = palette({
  dark: ['#3a3a52', '#40405a', '#32324a'],
  mid: ['#d8a8b8', '#e6b8c4', '#c898b0', '#dcb0c8'],
  light: ['#f6e4ea', '#fbeef0', '#f0d0dc', '#fff5f2'],
});
const AUTUMN = palette({
  dark: ['#3a2418', '#4a2c1a', '#33200f'],
  mid: ['#b8601e', '#c87424', '#a84e1c', '#9c5a22'],
  light: ['#e8b040', '#f0c458', '#d8902c', '#e4a238'],
});
const SNOW = palette({
  light: ['#e2ebf2', '#d2deea', '#eef3f6', '#c6d4e4'],
});

export interface TreePalettes { dark: RGB[]; mid: RGB[]; light: RGB[]; }

/** The palettes a tree is painted with in this season; trees that keep their needles are left alone. */
export function treeSeason(season: Season, kind: TreeKind, base: TreePalettes): TreePalettes {
  if (season === 'summer' || kind === 'pine' || kind === 'iris' || kind === 'sunflower') return base;
  if (season === 'spring') {
    // Orchard trees break into blossom; poplars only brighten.
    return kind === 'poplar' ? { ...base, light: base.light.map((c) => mix(c, [200, 230, 150], 0.35)) } : BLOSSOM;
  }
  if (season === 'autumn') return AUTUMN;
  // Winter: bare, dark crowns dusted with snow along the top.
  return { dark: base.dark, mid: base.mid.map((c) => mix(c, [226, 234, 242], 0.3)), light: SNOW.light };
}

/** Tint a ground or hill colour for the season; `amt` scales the effect (hills take less than fields). */
export function groundSeason(season: Season, c: RGB, amt = 1): RGB {
  switch (season) {
    case 'winter': return mix(c, [226, 232, 242], 0.5 * amt);
    case 'autumn': return mix(c, [190, 108, 44], 0.2 * amt);
    case 'spring': return mix(c, [150, 196, 116], 0.14 * amt);
    default: return c;
  }
}
