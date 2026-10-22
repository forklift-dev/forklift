/**
 * Splits streamed text into lines. `\r` counts as a line end too: git and most CLI tools redraw
 * progress ("Receiving objects:  45%") by returning the carriage, and each redraw is an update.
 */
export function createLineSplitter(onLine: (line: string) => void): { push(text: string): void; flush(): void } {
  let pending = '';
  return {
    push(text) {
      pending += text;
      // A trailing \r may be the first half of a \r\n split across chunks: keep it for the next push.
      const held = pending.endsWith('\r') ? '\r' : '';
      const parts = pending.slice(0, pending.length - held.length).split(/\r\n|\r|\n/);
      pending = (parts.pop() ?? '') + held;
      for (const line of parts) onLine(line);
    },
    flush() {
      const line = pending.replace(/\r$/, '');
      pending = '';
      if (line) onLine(line);
    },
  };
}
