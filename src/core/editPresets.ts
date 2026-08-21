/**
 * core/editPresets.ts
 * Stiluri gata facute: o apasare in loc de zece slidere.
 *
 * E functia cea mai folosita din orice editor de telefon, si nu pentru ca ar fi
 * pentru lenesi: cine are patruzeci de poze dintr-o zi nu le regleaza pe fiecare
 * separat, ci vrea un punct de plecare bun si apoi ajusteaza doua lucruri.
 *
 * Doua reguli care fac diferenta intre un preset folosibil si unul decorativ:
 *
 *  - NU ATING GEOMETRIA SI REPARATIILE. Decuparea, indreptarea, punctele de
 *    control si petele vindecate sunt munca ta pe ACEASTA poza; un stil e
 *    despre cum arata culorile si tonurile. Un preset care sterge o recadrare
 *    facuta cu mana e o pierdere, nu un ajutor.
 *  - SUNT MODERATE. Un stil care sare in ochi de la prima aplicare arata bine
 *    intr-o captura de ecran si prost pe patruzeci de poze la rand. Toate
 *    valorile de mai jos sunt alese ca sa lase loc de reglaj dupa.
 *
 * Fara DOM: date si o functie de compunere.
 */
import { NEUTRAL_ADJUSTMENTS, type EditAdjustments } from './imageAdjust';
import { NEUTRAL_BAND, type HslBands } from './hslBands';

/** Cheile pe care un stil are voie sa le atinga — restul raman ale fotografiei. */
const STYLE_KEYS = [
  'exposure', 'contrast', 'saturation', 'temperature', 'tint',
  'highlights', 'shadows', 'whites', 'blacks', 'clarity', 'vignette',
  // Tine de fisier, nu de look — dar un preset de interior are motiv sa-l ceara,
  // si atunci trebuie sa se si INTOARCA la zero cand alegi alt stil.
  'noiseReduction'
] as const;

export type PresetStyle = Partial<Pick<EditAdjustments, (typeof STYLE_KEYS)[number]>> & { hsl?: HslBands };

export interface EditPreset {
  key: string;
  style: PresetStyle;
}

const band = (o: Partial<typeof NEUTRAL_BAND>) => ({ ...NEUTRAL_BAND, ...o });

export const PRESETS: EditPreset[] = [
  // "Cum ar fi trebuit sa iasa": ce face oricine manual, in aceeasi ordine —
  // putin contrast, umbre ridicate, un strop de textura. Nu schimba culorile.
  { key: 'natural', style: { contrast: 12, shadows: 12, clarity: 10, blacks: -5 } },

  // Portret: tenul castiga din caldura si din umbre deschise, nu din saturatie
  // (aceea il face portocaliu). Claritatea NEGATIVA e deliberata — pe piele,
  // textura accentuata inseamna pori si riduri scoase in evidenta.
  { key: 'portrait', style: {
    temperature: 8, shadows: 16, highlights: -8, clarity: -8, contrast: 6,
    hsl: { orange: band({ saturation: -6, luminance: 8 }), red: band({ saturation: -4 }) }
  } },

  // Peisaj: verdele si albastrul sunt cele doua game care fac o poza de afara
  // sa arate viu; saturatia globala ar fi umflat si tenul din cadru.
  { key: 'landscape', style: {
    contrast: 14, clarity: 18, whites: 8, blacks: -8,
    hsl: { green: band({ saturation: 14, luminance: -6 }), blue: band({ saturation: 16, luminance: -8 }) }
  } },

  // Alb-negru: saturatia la zero, dar cu contrast si capete apasate — altfel
  // iese o poza gri si moarta, nu una alb-negru.
  { key: 'bw', style: { saturation: -100, contrast: 22, blacks: -14, whites: 10, clarity: 12 } },

  // Apus: caldura si portocaliul ridicat, cu highlights strunite ca sa nu ardem
  // exact cerul pentru care s-a facut poza.
  { key: 'sunset', style: {
    temperature: 20, highlights: -14, shadows: 10, contrast: 8,
    hsl: { orange: band({ saturation: 18, luminance: 6 }), magenta: band({ saturation: 10 }) }
  } },

  // Interior seara: becurile dau galben, umbrele se inchid, iar ISO-ul mare
  // lasa zgomot. Se corecteaza toate trei, si nimic altceva.
  { key: 'indoor', style: { temperature: -14, shadows: 22, blacks: -6, noiseReduction: 25, contrast: 6 } }
];

/**
 * Aplica un stil peste ajustarile curente.
 *
 * Cheile de stil se INLOCUIESC (un stil e o stare, nu un adaos peste altul —
 * altfel doua preseturi apasate la rand s-ar aduna intr-o poza arsa), iar tot
 * ce tine de geometrie si de reparatii ramane neatins.
 */
export function applyPreset(current: EditAdjustments, preset: EditPreset): EditAdjustments {
  const next: EditAdjustments = { ...current };
  for (const key of STYLE_KEYS) next[key] = preset.style[key] ?? NEUTRAL_ADJUSTMENTS[key] ?? 0;
  next.hsl = preset.style.hsl ? { ...preset.style.hsl } : undefined;
  return next;
}
