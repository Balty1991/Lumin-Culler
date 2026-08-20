import { describe, it, expect, beforeEach } from 'vitest';
import {
  allowanceLevel, shouldShowAllowanceNotice, readDismissedLevel, writeDismissedLevel,
  forgetDismissalIfBelow, exportAllowanceWarning, APPROACHING_RATIO, CRITICAL_RATIO
} from './freeAllowance';

const LIMIT = 150;

describe('cand se anunta plafonul gratuit', () => {
  beforeEach(() => localStorage.clear());

  it('sub 60% din plafon nu se spune nimic', () => {
    expect(allowanceLevel(0, LIMIT)).toBe('none');
    expect(allowanceLevel(89, LIMIT)).toBe('none');
    expect(allowanceLevel(LIMIT * APPROACHING_RATIO - 1, LIMIT)).toBe('none');
  });

  it('pragurile cresc in ordine', () => {
    expect(allowanceLevel(90, LIMIT)).toBe('approaching');
    expect(allowanceLevel(LIMIT * CRITICAL_RATIO, LIMIT)).toBe('critical');
    expect(allowanceLevel(150, LIMIT)).toBe('reached');
    expect(allowanceLevel(400, LIMIT)).toBe('reached');
  });

  it('un plafon inexistent nu produce niciun anunt', () => {
    expect(allowanceLevel(10, 0)).toBe('none');
  });

  it('fara cale reala de plata nu se arata nimic', () => {
    // un plafon anuntat fara posibilitatea de a-l ridica e doar o veste proasta
    expect(shouldShowAllowanceNotice('reached', 'none', false)).toBe(false);
    expect(shouldShowAllowanceNotice('reached', 'none', true)).toBe(true);
  });

  it('un prag respins nu-l ascunde si pe urmatorul', () => {
    expect(shouldShowAllowanceNotice('approaching', 'approaching', true)).toBe(false);
    expect(shouldShowAllowanceNotice('critical', 'approaching', true)).toBe(true);
    expect(shouldShowAllowanceNotice('reached', 'critical', true)).toBe(true);
  });

  it('respingerea se tine minte intre porniri', () => {
    expect(readDismissedLevel()).toBe('none');
    writeDismissedLevel('critical');
    expect(readDismissedLevel()).toBe('critical');
    writeDismissedLevel('none');
    expect(readDismissedLevel()).toBe('none');
  });

  it('o valoare stricata din stocare nu strica nimic', () => {
    localStorage.setItem('lumin-allowance-dismissed', 'orice');
    expect(readDismissedLevel()).toBe('none');
  });

  it('cand fereastra se reinnoieste, respingerea veche se uita', () => {
    // altfel cineva care a respins anuntul luna trecuta n-ar mai fi anuntat niciodata
    expect(forgetDismissalIfBelow('none', 'critical')).toBe('none');
    expect(forgetDismissalIfBelow('approaching', 'critical')).toBe('approaching');
    expect(forgetDismissalIfBelow('reached', 'approaching')).toBe('approaching');
  });
});

describe('ce se spune inainte de export', () => {
  it('cine mai are loc berechet nu e deranjat cu nimic', () => {
    expect(exportAllowanceWarning(10, 0, LIMIT, true)).toBeNull();
    expect(exportAllowanceWarning(40, 20, LIMIT, true)).toBeNull();
  });

  it('cand selectia depaseste ce a mai ramas, se spune cat a mai ramas', () => {
    expect(exportAllowanceWarning(40, 130, LIMIT, true)).toEqual({ kind: 'exceeds', remaining: 20 });
  });

  it('cand exportul asta goleste aproape tot, se spune si asta', () => {
    // 150 - 100 = 50 ramase; dupa un export de 45 mai raman 5, sub 10% din plafon
    expect(exportAllowanceWarning(45, 100, LIMIT, true)).toEqual({ kind: 'tight', remaining: 50 });
  });

  it('abonatii si dispozitivele fara cale de plata nu vad nimic', () => {
    expect(exportAllowanceWarning(200, 140, LIMIT, false)).toBeNull();
  });

  it('o selectie goala nu are ce sa depaseasca', () => {
    expect(exportAllowanceWarning(0, 149, LIMIT, true)).toBeNull();
  });

  it('cand plafonul e deja atins, orice selectie il depaseste', () => {
    expect(exportAllowanceWarning(1, 150, LIMIT, true)).toEqual({ kind: 'exceeds', remaining: 0 });
  });
});
