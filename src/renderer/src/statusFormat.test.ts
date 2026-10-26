import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../shared/i18n';
import { elapsedTime, formatMemory, relativeTime } from './statusFormat';

afterEach(() => setLanguage('en'));

describe('status formatting', () => {
  it('uses compact localized memory units', () => {
    expect(formatMemory(512 * 1024 * 1024)).toBe('512 MB');
    expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
    setLanguage('ru');
    expect(formatMemory(1.5 * 1024 * 1024 * 1024)).toBe('1,5 GB');
  });

  it('shows relative fetch time and compact elapsed process time', () => {
    const now = Date.UTC(2026, 9, 26, 12);
    expect(relativeTime(now - 2 * 60_000, now)).toBe('2 minutes ago');
    expect(elapsedTime(now - 61_000, now)).toBe('1m');
    expect(elapsedTime(now + 1_000, now)).toBe('0s');
  });
});
