/**
 * core/userPresets.ts
 *
 * Presetarile SALVATE DE UTILIZATOR — combinatia lui de slidere, sub numele lui.
 *
 * De ce, pe langa cele sase presetari din editPresets.ts: acelea sunt puncte de
 * plecare scrise de mine, general valabile. Un fotograf care a gasit reteta lui
 * pentru "botez in biserica" nu are ce face cu "Interior" — vrea exact cifrele
 * la care a ajuns, si le vrea si maine, si pe celelalte 400 de cadre.
 *
 * Ce se salveaza: doar STYLE_KEYS (aceleasi ca la stilul invatat si la
 * presetarile de baza) plus gamele de culoare. NU decuparea, nu indreptarea, nu
 * vindecarea, nu masca de bokeh — toate depind de CE E in cadru, iar o
 * recadrare aplicata orbeste peste alta poza taie capete de oameni. Vezi
 * comentariul din editStyle.ts, e aceeasi granita.
 */
import type { EditAdjustments } from './imageAdjust';
import { NEUTRAL_ADJUSTMENTS } from './imageAdjust';
import { STYLE_KEYS_FOR_PRESETS } from './editPresets';

export interface UserPreset {
  id: string;
  name: string;
  createdAt: number;
  style: Partial<EditAdjustments>;
}

/** Cate presetari proprii au voie sa existe. */
export const MAX_USER_PRESETS = 12;
/** Cat de lung poate fi numele — randul de presetari se deruleaza, dar tot are o limita. */
export const MAX_PRESET_NAME = 24;

export function normalizePresetName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_PRESET_NAME);
}

/**
 * Ce se retine dintr-o editare, ca presetare.
 *
 * Se pastreaza doar valorile care CHIAR au fost schimbate. Astfel o presetare
 * salvata dintr-o poza la care omul a atins doar caldura si contrastul nu va
 * reseta, pe alta poza, expunerea reglata acolo cu grija.
 */
export function presetFromAdjustments(name: string, adjustments: EditAdjustments, now = Date.now()): UserPreset {
  const style: Partial<EditAdjustments> = {};
  for (const key of STYLE_KEYS_FOR_PRESETS) {
    const valoare = adjustments[key] ?? 0;
    if (valoare !== (NEUTRAL_ADJUSTMENTS[key] ?? 0)) style[key] = valoare;
  }
  if (adjustments.hsl) style.hsl = copiazaGame(adjustments.hsl);
  return {
    id: `up_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: normalizePresetName(name),
    createdAt: now,
    style
  };
}

/**
 * Presetarea peste ajustarile curente.
 *
 * Spre deosebire de presetarile de baza (applyPreset, care DUCE LA NEUTRU tot
 * ce nu e in presetare), asta scrie doar ce contine si lasa restul in pace —
 * fiindca a fost salvata la fel, doar din ce fusese atins. Cine vrea sa plece
 * de la zero apasa intai Reseteaza.
 */
export function applyUserPreset(current: EditAdjustments, preset: UserPreset): EditAdjustments {
  const next: EditAdjustments = { ...current, ...preset.style };
  if (preset.style.hsl) next.hsl = copiazaGame(preset.style.hsl);
  return next;
}

/**
 * Copie pe DOUA niveluri a gamelor de culoare.
 *
 * `{ ...hsl }` copiaza doar dicionarul; cele opt game raman aceleasi obiecte,
 * deci presetarea salvata si poza deschisa ar fi ajuns sa le imparta. Prima
 * reglare a unei game dupa aplicarea presetarii ar fi rescris presetarea
 * insasi, tacut si permanent. Prins de un test, nu pe telefon.
 */
function copiazaGame(hsl: NonNullable<EditAdjustments['hsl']>): NonNullable<EditAdjustments['hsl']> {
  const out = {} as NonNullable<EditAdjustments['hsl']>;
  for (const [gama, valori] of Object.entries(hsl)) {
    if (valori) out[gama as keyof typeof out] = { ...valori };
  }
  return out;
}

/** Cea mai noua prima: ce tocmai ai salvat e si ce folosesti cel mai probabil acum. */
export function sortPresets(presets: readonly UserPreset[]): UserPreset[] {
  return [...presets].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Adaugarea, cu cele doua reguli care fac lista utilizabila in loc de lunga:
 * un nume care exista deja INLOCUIESTE (altfel "Botez", "Botez 2", "Botez 2
 * final" — exact ce face lumea cand nu poate suprascrie), iar peste plafon
 * cade cea mai veche.
 */
export function addPreset(presets: readonly UserPreset[], preset: UserPreset): UserPreset[] {
  const nume = preset.name.toLocaleLowerCase('ro');
  const fara = presets.filter(p => p.name.toLocaleLowerCase('ro') !== nume);
  return sortPresets([...fara, preset]).slice(0, MAX_USER_PRESETS);
}

export function removePreset(presets: readonly UserPreset[], id: string): UserPreset[] {
  return presets.filter(p => p.id !== id);
}
