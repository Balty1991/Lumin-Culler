import { describe, expect, it } from 'vitest';
import { readBoot, readRescueLocale } from './boot';

describe('cleaner boot', () => {
  it('opens on the value proposition until the intro has been seen', () => {
    expect(readBoot('', false)).toEqual({ screen: 'intro1', liveScan: false });
    expect(readBoot('', true)).toEqual({ screen: 'scan', liveScan: true });
  });

  it('holds a requested screen still for screenshots', () => {
    expect(readBoot('?screen=paywall', false)).toEqual({ screen: 'paywall', liveScan: false });
    expect(readBoot('?screen=nope', true)).toEqual({ screen: 'scan', liveScan: true });
  });

  it('speaks Romanian or English', () => {
    expect(readRescueLocale('en', ['ro-RO'])).toBe('en');
    expect(readRescueLocale('pt-BR', ['ro-RO'])).toBe('ro');
    expect(readRescueLocale(null, ['en-US'])).toBe('en');
  });
});
