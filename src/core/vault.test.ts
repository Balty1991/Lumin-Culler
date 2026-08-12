import { describe, it, expect, beforeEach } from 'vitest';
import {
  isValidPinFormat, hasVaultPin, setVaultPin, verifyVaultPin, clearVaultPin,
  isVaultUnlockedInSession, setVaultUnlockedInSession
} from './vault';

beforeEach(() => {
  localStorage.clear();
  setVaultUnlockedInSession(false);
});

describe('isValidPinFormat', () => {
  it('accepts 4 to 6 digits', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12ab')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
  });
});

describe('setVaultPin / verifyVaultPin / hasVaultPin', () => {
  it('has no PIN before setup', () => {
    expect(hasVaultPin()).toBe(false);
  });

  it('verifies the correct PIN after setup, rejects wrong ones', async () => {
    await setVaultPin('4242');
    expect(hasVaultPin()).toBe(true);
    expect(await verifyVaultPin('4242')).toBe(true);
    expect(await verifyVaultPin('0000')).toBe(false);
  });

  it('never stores the PIN in plain text', async () => {
    await setVaultPin('135790');
    const raw = localStorage.getItem('lumin-vault-pin-hash');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('135790');
  });

  it('clearVaultPin removes it', async () => {
    await setVaultPin('4242');
    clearVaultPin();
    expect(hasVaultPin()).toBe(false);
    expect(await verifyVaultPin('4242')).toBe(false);
  });
});

describe('vault session unlock (in-memory, not persisted)', () => {
  it('starts locked', () => {
    expect(isVaultUnlockedInSession()).toBe(false);
  });
  it('reflects explicit unlock/lock calls', () => {
    setVaultUnlockedInSession(true);
    expect(isVaultUnlockedInSession()).toBe(true);
    setVaultUnlockedInSession(false);
    expect(isVaultUnlockedInSession()).toBe(false);
  });
});
