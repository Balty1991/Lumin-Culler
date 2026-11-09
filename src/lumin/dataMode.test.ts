import { afterEach, describe, expect, it } from 'vitest';
import { dataMode, deferEnginesPrompt, enginesPromptPending, mayDownloadNow, onWifi, setDataMode, setNativeWifi } from './dataMode';
import { downloadFraction } from './aiModels';

describe('downloadFraction', () => {
  it('nu întoarce NaN când serverul nu spune lungimea', () => {
    expect(downloadFraction(10, -1, 100)).toBe(0.1);
    expect(downloadFraction(undefined, undefined, 0)).toBe(0);
    expect(downloadFraction(50, 0, 200)).toBe(0.25);
  });
});

describe('dataMode / Wi-Fi', () => {
  afterEach(() => {
    localStorage.removeItem('cherrypic.dataMode');
    setNativeWifi(null);
    Object.defineProperty(navigator, 'connection', { configurable: true, value: undefined });
  });

  it('„unknown” din WebView nu înseamnă că nu ai Wi-Fi', () => {
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { type: 'unknown' } });
    expect(onWifi()).toBe(true);
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { type: 'cellular' } });
    expect(onWifi()).toBe(false);
  });

  it('poarta nativă bate estimarea din browser', () => {
    setDataMode('wifi');
    Object.defineProperty(navigator, 'connection', { configurable: true, value: { type: 'cellular' } });
    setNativeWifi(true);
    expect(mayDownloadNow()).toBe(true);
    setNativeWifi(false);
    expect(mayDownloadNow()).toBe(false);
    expect(dataMode()).toBe('wifi');
  });

  it('fereastra de după instalare ține analiza până la o alegere', () => {
    expect(enginesPromptPending()).toBe(true);
    deferEnginesPrompt();
    expect(enginesPromptPending()).toBe(false);
  });
});
