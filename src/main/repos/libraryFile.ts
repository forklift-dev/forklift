import { readFile, rename } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { LibraryState, RecentRepo } from '../../shared/state';
import { AtomicFile } from '../atomicFile';
import { MAX_RECENT } from '../store/librarySlice';

/** Open tabs at the last save, restored at startup. */
export interface Session {
  tabs: string[];
  active: string | null;
}

export interface LibraryData {
  session: Session;
  library: LibraryState;
}

const VERSION = 1;
const MAX_TABS = 100;
const EMPTY: LibraryData = { session: { tabs: [], active: null }, library: { recent: [], favorites: [] } };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 && isAbsolute(value);

/** Lenient: anything malformed is dropped, so a hand-edited file never stops the app from starting. */
export function decodeLibrary(text: string): LibraryData {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) return EMPTY;
  const session = isRecord(data['session']) ? data['session'] : {};
  const library = isRecord(data['library']) ? data['library'] : {};
  const tabs = [...new Set((Array.isArray(session['tabs']) ? session['tabs'] : []).filter(isPath))].slice(0, MAX_TABS);
  const recent = (Array.isArray(library['recent']) ? library['recent'] : [])
    .filter((r): r is RecentRepo => isRecord(r) && isPath(r['path']) && typeof r['name'] === 'string' && typeof r['openedAt'] === 'number')
    .map(({ path, name, openedAt }) => ({ path, name, openedAt }))
    .slice(0, MAX_RECENT);
  const favorites = [...new Set((Array.isArray(library['favorites']) ? library['favorites'] : []).filter(isPath))];
  return {
    session: { tabs, active: isPath(session['active']) && tabs.includes(session['active']) ? session['active'] : (tabs[0] ?? null) },
    library: { recent, favorites },
  };
}

export const encodeLibrary = ({ session, library }: LibraryData) => `${JSON.stringify({ version: VERSION, session, library }, null, 2)}\n`;

/** userData/repositories.json: the open tabs, recently opened and favorite repositories. */
export class LibraryFile {
  private readonly file: AtomicFile;

  constructor(readonly path: string) {
    this.file = new AtomicFile(path);
  }

  async load(): Promise<LibraryData> {
    try {
      return decodeLibrary(await readFile(this.path, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[repos] ${this.path} is unreadable; starting without remembered repositories:`, error);
        await rename(this.path, `${this.path}.damaged`).catch(() => {});
      }
      return EMPTY;
    }
  }

  save(data: LibraryData): Promise<void> {
    return this.file.write(encodeLibrary(data));
  }
}
