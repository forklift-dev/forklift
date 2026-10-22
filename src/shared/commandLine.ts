// Arguments of a custom tool command are edited as one line of text in Preferences and stored as a list.

/**
 * Splits text into arguments: whitespace separates them, "double" or 'single' quotes group them,
 * and a backslash escapes the next character outside single quotes. No variables or globs are expanded.
 */
export function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current = '';
  let inArg = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < text.length && /["\\]/.test(text[i + 1]!)) current += text[++i];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inArg = true;
    } else if (char === '\\' && i + 1 < text.length) {
      current += text[++i];
      inArg = true;
    } else if (/\s/.test(char)) {
      if (inArg) args.push(current);
      current = '';
      inArg = false;
    } else {
      current += char;
      inArg = true;
    }
  }
  if (quote) throw new SyntaxError(`Unclosed ${quote === '"' ? 'double' : 'single'} quote`);
  if (inArg) args.push(current);
  return args;
}

/** Inverse of splitArgs: quotes only arguments that need it. */
export function joinArgs(args: readonly string[]): string {
  return args
    .map((arg) => {
      if (arg !== '' && !/[\s"'\\]/.test(arg)) return arg;
      if (!arg.includes("'")) return `'${arg}'`;
      return `"${arg.replace(/["\\]/g, '\\$&')}"`;
    })
    .join(' ');
}
