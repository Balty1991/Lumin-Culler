import { beforeEach, describe, expect, it } from 'vitest';
import { buildErrorReport, clearErrorLog, logError, readErrorLog } from './errorLog';

describe('errorLog', () => {
  beforeEach(() => clearErrorLog());
  it('ține ultimele erori, cele noi la urmă, și le pune în raport', () => {
    for (let i = 0; i < 70; i++) logError('error', `e${i}`);
    const log = readErrorLog();
    expect(log).toHaveLength(60);
    expect(log[59].message).toBe('e69');
    const report = buildErrorReport({ versiune: '3.1.0' });
    expect(report).toContain('versiune: 3.1.0');
    expect(report.indexOf('e69')).toBeLessThan(report.indexOf('e10'));
  });
});
