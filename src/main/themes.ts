import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_THEMES, parseUserTheme, type Theme, type ThemeProblem, type UserThemesState } from '../shared/themes';

const MAX_FILES = 100;
const MAX_SIZE = 256 * 1024;
const STEM = /^[\w .-]{1,100}$/;

/** Reads every `*.jsonc` theme in `folder`; broken files are reported, not fatal. */
export async function readUserThemes(folder: string): Promise<UserThemesState> {
  const themes: Theme[] = [];
  const problems: ThemeProblem[] = [];
  const names = (await readdir(folder).catch(() => [] as string[])).filter((name) => /\.jsonc?$/i.test(name)).sort((a, b) => a.localeCompare(b));
  for (const file of names.slice(0, MAX_FILES)) {
    const stem = file.replace(/\.jsonc?$/i, '');
    try {
      if (!STEM.test(stem)) throw new Error('Use letters, digits, spaces, dots, dashes and underscores in the file name');
      const info = await stat(join(folder, file));
      if (info.size > MAX_SIZE) throw new Error('The file is larger than 256 KB');
      if (themes.some((theme) => theme.id === `user:${stem}`)) throw new Error(`Another file is also named "${stem}"`);
      themes.push(parseUserTheme(stem, await readFile(join(folder, file), 'utf8')));
    } catch (error) {
      problems.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (names.length > MAX_FILES) problems.push({ file: names[MAX_FILES]!, message: `Only the first ${MAX_FILES} theme files are read` });
  return { folder, themes, problems };
}

/** User themes in userData/themes: read at startup and again whenever a file there changes. */
export class ThemeLibrary {
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private current: UserThemesState;

  constructor(
    private readonly folder: string,
    private readonly changed: (state: UserThemesState) => void,
  ) {
    this.current = { folder, themes: [], problems: [] };
  }

  async start(): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    await this.reload();
    try {
      this.watcher = watch(this.folder, () => this.schedule());
      this.watcher.on('error', () => this.stopWatching());
    } catch {
      // Without watching, themes are read at startup only.
    }
  }

  stop(): void {
    this.stopWatching();
    if (this.timer) clearTimeout(this.timer);
  }

  exists(id: string): boolean {
    return BUILTIN_THEMES.some((theme) => theme.id === id) || this.current.themes.some((theme) => theme.id === id);
  }

  async reload(): Promise<void> {
    this.current = await readUserThemes(this.folder);
    this.changed(this.current);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    // Editors save in several steps (temp file, rename): read once they are done.
    this.timer = setTimeout(() => void this.reload(), 150);
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
