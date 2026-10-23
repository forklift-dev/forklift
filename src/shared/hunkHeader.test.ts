import { describe, expect, it } from 'vitest';
import { hunkHeader } from './staging';

describe('hunkHeader', () => {
  it('writes git-style ranges', () => {
    expect(hunkHeader({ originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 })).toBe('@@ -2 +2 @@');
    expect(hunkHeader({ originalStartLineNumber: 12, originalEndLineNumber: 14, modifiedStartLineNumber: 11, modifiedEndLineNumber: 0 })).toBe('@@ -12,3 +11,0 @@');
    expect(hunkHeader({ originalStartLineNumber: 18, originalEndLineNumber: 0, modifiedStartLineNumber: 19, modifiedEndLineNumber: 20 })).toBe('@@ -18,0 +19,2 @@');
  });
});
