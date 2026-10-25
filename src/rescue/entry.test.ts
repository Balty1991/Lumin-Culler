import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('boot bundle', () => {
  it('does not pull the photographer shell, motion, or the big dictionaries', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main).not.toContain('framer-motion');
    expect(main).not.toContain('state/store');
    expect(main).not.toContain('styles.css');
    expect(main).not.toContain('./App');
    expect(main).not.toContain('i18n');
  });

  it('keeps best-shot, XMP export, and the welcome module on disk', () => {
    expect(existsSync('src/core/bestShot.ts')).toBe(true);
    expect(existsSync('src/core/export/xmpGenerator.ts')).toBe(true);
    expect(existsSync('src/ui/WelcomeOnboarding.tsx')).toBe(true);
  });
});
