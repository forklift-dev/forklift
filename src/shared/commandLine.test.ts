import { describe, expect, it } from 'vitest';
import { joinArgs, splitArgs } from './commandLine';

describe('splitArgs', () => {
  it.each([
    ['--goto {file}:{line}', ['--goto', '{file}:{line}']],
    ['  a   b  ', ['a', 'b']],
    ['"a b" \'c d\' e\\ f', ['a b', 'c d', 'e f']],
    ['--title="My File" $LOCAL', ['--title=My File', '$LOCAL']],
    ['"" x', ['', 'x']],
    ['"say \\"hi\\"" \'C:\\path\\x\'', ['say "hi"', 'C:\\path\\x']],
    ['', []],
  ])('%j', (text, args) => {
    expect(splitArgs(text)).toEqual(args);
  });

  it('rejects an unclosed quote', () => {
    expect(() => splitArgs('"abc')).toThrow('Unclosed double quote');
  });

  it.each([[['a', 'b c', '', "it's", 'say "hi"', 'C:\\x', '$MERGED', '{file}:{line}']], [[]]])('round-trips %j', (args) => {
    expect(splitArgs(joinArgs(args))).toEqual(args);
  });
});
