import { describe, it, expect } from 'vitest';
import {
  presetFromAdjustments, applyUserPreset, addPreset, removePreset,
  normalizePresetName, sortPresets, MAX_USER_PRESETS, MAX_PRESET_NAME, type UserPreset
} from './userPresets';
import { NEUTRAL_ADJUSTMENTS } from './imageAdjust';

/**
 * Presetarile proprii: combinatia de slidere a omului, sub numele lui.
 * Regula centrala pe care o apara testele — se retine si se scrie DOAR ce a
 * fost chiar atins, ca sa nu reseteze pe alta poza reglaje facute cu grija.
 */
const cu = (extra: Partial<typeof NEUTRAL_ADJUSTMENTS>) => ({ ...NEUTRAL_ADJUSTMENTS, ...extra });

describe('ce se retine dintr-o editare', () => {
  it('salveaza doar valorile chiar schimbate', () => {
    const p = presetFromAdjustments('Botez', cu({ temperature: 18, contrast: 12 }));
    expect(p.style).toEqual({ temperature: 18, contrast: 12 });
  });

  it('retine si efectele noi — dezaburire, alb-negru, ton, bob', () => {
    const p = presetFromAdjustments('Film', cu({ dehaze: 30, bw: 100, grade: 40, grain: 12 }));
    expect(p.style.dehaze).toBe(30);
    expect(p.style.bw).toBe(100);
    expect(p.style.grade).toBe(40);
    expect(p.style.grain).toBe(12);
  });

  it('NU retine decuparea sau vindecarea — depind de ce e in cadru', () => {
    // O recadrare aplicata orbeste peste alta poza taie capete de oameni.
    const p = presetFromAdjustments('X', {
      ...NEUTRAL_ADJUSTMENTS, contrast: 10,
      crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      heal: [[{ x: 1, y: 1 }]]
    } as never);
    expect('crop' in p.style).toBe(false);
    expect('heal' in p.style).toBe(false);
  });

  it('curata numele si il taie la limita', () => {
    expect(normalizePresetName('  Botez   in   biserica  ')).toBe('Botez in biserica');
    expect(normalizePresetName('x'.repeat(80)).length).toBe(MAX_PRESET_NAME);
  });
});

describe('aplicarea unei presetari proprii', () => {
  it('scrie ce contine si lasa restul in pace', () => {
    // Spre deosebire de presetarile de baza, care duc la neutru tot ce nu
    // contin: asta a fost salvata la fel, doar din ce fusese atins.
    const preset = presetFromAdjustments('Cald', cu({ temperature: 20 }));
    const rezultat = applyUserPreset(cu({ exposure: 35, temperature: -5 }), preset);
    expect(rezultat.temperature).toBe(20);
    expect(rezultat.exposure).toBe(35);
  });

  it('copiaza gamele de culoare, nu le imparte cu presetarea', () => {
    const preset = presetFromAdjustments('G', { ...NEUTRAL_ADJUSTMENTS, hsl: { red: { hue: 5, saturation: 0, luminance: 0 } } } as never);
    const rezultat = applyUserPreset(NEUTRAL_ADJUSTMENTS, preset);
    (rezultat.hsl as Record<string, { hue: number }>).red.hue = 99;
    expect((preset.style.hsl as Record<string, { hue: number }>).red.hue).toBe(5);
  });
});

describe('lista de presetari', () => {
  const fa = (name: string, t: number): UserPreset => presetFromAdjustments(name, cu({ contrast: t }), t);

  it('cea mai noua sta prima', () => {
    const lista = sortPresets([fa('vechi', 1000), fa('nou', 3000), fa('mijloc', 2000)]);
    expect(lista.map(p => p.name)).toEqual(['nou', 'mijloc', 'vechi']);
  });

  it('acelasi nume INLOCUIESTE, nu se aduna', () => {
    // Altfel apar "Botez", "Botez 2", "Botez 2 final" — ce face oricine cand
    // nu poate suprascrie.
    const lista = addPreset(addPreset([], fa('Botez', 1000)), fa('botez', 2000));
    expect(lista).toHaveLength(1);
    expect(lista[0].createdAt).toBe(2000);
  });

  it('peste plafon cade cea mai veche', () => {
    let lista: UserPreset[] = [];
    for (let i = 0; i < MAX_USER_PRESETS + 4; i++) lista = addPreset(lista, fa(`s${i}`, 1000 + i));
    expect(lista).toHaveLength(MAX_USER_PRESETS);
    expect(lista.some(p => p.name === 's0')).toBe(false);
    expect(lista.some(p => p.name === `s${MAX_USER_PRESETS + 3}`)).toBe(true);
  });

  it('stergerea scoate exact una', () => {
    const a = fa('a', 1000), b = fa('b', 2000);
    expect(removePreset([a, b], a.id).map(p => p.name)).toEqual(['b']);
  });
});
