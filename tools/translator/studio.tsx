import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import locales from '../../src/shared/i18n/locales.json';
import legacy from '../../src/shared/i18n/legacy.json';
import { entryError, exportTranslationCatalog, pluralCategories, validLocaleCode, type TranslationCatalog, type TranslationEntry } from '../../src/shared/i18n/translation-editor';
import logo from '../../build/icon.png?url';

type Column = { code: string; name: string };
type Drafts = Record<string, Record<string, TranslationEntry>>;

const catalogModules = import.meta.glob<TranslationCatalog>('../../src/shared/i18n/catalogs/*.json', { eager: true, import: 'default' });
const catalogs: Record<string, TranslationCatalog> = Object.fromEntries(Object.entries(catalogModules).map(([path, catalog]) => [path.slice(path.lastIndexOf('/') + 1, -5), catalog]));
const source = catalogs.en!;
const ids = Object.keys(source);
const originalKeys = Object.fromEntries(Object.entries(legacy).map(([key, id]) => [id, key]));
const storageKey = 'forklift.translation-studio.v1';
const pageSize = 40;

function stored(): { columns: Column[]; drafts: Drafts } {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as { columns?: Column[]; drafts?: Drafts };
    const columns = Array.isArray(value.columns) ? value.columns.filter((column) => column && validLocaleCode(column.code) && typeof column.name === 'string' && !locales.some((known) => known.code.toLowerCase() === column.code.toLowerCase())) : [];
    const drafts = value.drafts && typeof value.drafts === 'object' ? value.drafts : {};
    return { columns, drafts };
  } catch {
    return { columns: [], drafts: {} };
  }
}

const initial = stored();
const initialDrafts: Drafts = Object.fromEntries([...locales, ...initial.columns].map(({ code }) => [code, { ...(catalogs[code] ?? {}), ...(initial.drafts[code] ?? {}) }]));

function sourceText(entry: TranslationEntry): string {
  return typeof entry === 'string' ? entry : entry.other ?? '';
}

function contextFor(id: string): string | null {
  const key = originalKeys[id] ?? '';
  return /^[a-z][a-z-]*\|/.test(key) ? key.slice(0, key.indexOf('|')) : null;
}

function download(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TranslationStudio() {
  const [customColumns, setCustomColumns] = useState<Column[]>(initial.columns);
  const [drafts, setDrafts] = useState<Drafts>(initialDrafts);
  const [query, setQuery] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [focusLocale, setFocusLocale] = useState('ru');
  const [page, setPage] = useState(0);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [notice, setNotice] = useState('');
  const columns = useMemo(() => [...locales, ...customColumns], [customColumns]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ columns: customColumns, drafts }));
      } catch {
        setNotice('Browser storage is full. Download your JSON to keep your work.');
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [customColumns, drafts]);

  const shownIds = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return ids.filter((id) => {
      if (missingOnly && drafts[focusLocale]?.[id] !== undefined) return false;
      if (!needle) return true;
      const values = [id, originalKeys[id] ?? '', sourceText(source[id]!), ...columns.map(({ code }) => {
        const entry = drafts[code]?.[id];
        return entry === undefined ? '' : typeof entry === 'string' ? entry : Object.values(entry).join(' ');
      })];
      return values.some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [query, missingOnly, focusLocale, drafts, columns]);
  const pageCount = Math.max(1, Math.ceil(shownIds.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleIds = shownIds.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

  const updateEntry = (code: string, id: string, value: TranslationEntry | undefined) => {
    setDrafts((current) => {
      const catalog = { ...(current[code] ?? {}) };
      if (value === undefined) delete catalog[id];
      else catalog[id] = value;
      return { ...current, [code]: catalog };
    });
  };

  const addColumn = (event: FormEvent) => {
    event.preventDefault();
    const code = newCode.trim();
    const name = newName.trim();
    if (!validLocaleCode(code)) return setNotice('Use a supported language code such as fr or pt-BR.');
    if (columns.some((column) => column.code.toLowerCase() === code.toLowerCase())) return setNotice(`${code} is already in the table.`);
    if (!name) return setNotice('Enter the language name as its speakers write it.');
    setCustomColumns((current) => [...current, { code, name }]);
    setDrafts((current) => ({ ...current, [code]: {} }));
    setFocusLocale(code);
    setNewCode('');
    setNewName('');
    setPage(0);
    setNotice(`${name} added. Your draft is saved in this browser.`);
  };

  const importCatalog = async (code: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const value: unknown = JSON.parse(await file.text());
      if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Expected a JSON object');
      const catalog = value as Record<string, TranslationEntry>;
      exportTranslationCatalog(source, catalog, code);
      setDrafts((current) => ({ ...current, [code]: { ...catalog } }));
      setNotice(`${file.name} loaded into ${code}. Review it before exporting.`);
    } catch (error) {
      setNotice(`Could not import ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const exportCatalog = (code: string) => {
    try {
      const json = code === 'en' ? `${JSON.stringify(source, null, 2)}\n` : exportTranslationCatalog(source, drafts[code] ?? {}, code);
      download(`${code}.json`, json);
      setNotice(`${code}.json downloaded. Add it to src/shared/i18n/catalogs/ in your pull request.`);
    } catch (error) {
      setNotice(`Export blocked: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const removeColumn = (code: string) => {
    if (!window.confirm(`Remove ${code} and its saved draft from this browser? Download its JSON first if you need it.`)) return;
    setCustomColumns((current) => current.filter((column) => column.code !== code));
    setDrafts((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
    if (focusLocale === code) setFocusLocale('ru');
    setNotice(`${code} removed from this browser. Download its JSON first if you need it.`);
  };

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <div className="brand"><img src={logo} alt="Forklift" /><span>Forklift <strong>Translation Studio</strong></span></div>
        <a href="https://github.com/forklift-dev/forklift/blob/main/docs/translating.md" target="_blank" rel="noreferrer">Translation guide ↗</a>
      </header>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">COMMUNITY TRANSLATIONS</p>
            <h1>Help Forklift speak your language.</h1>
            <p>Compare the source and existing translations side by side. Add your language, translate what you can, then download a catalog for a pull request.</p>
          </div>
          <div className="intro-stat"><strong>{ids.length.toLocaleString()}</strong><span>messages ready to translate</span></div>
        </section>

        <section className="toolbar" aria-label="Translation tools">
          <label className="search-field"><span>Search messages</span><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search English, ID, or translation…" /></label>
          <label className="filter-field"><span>Focus language</span><select value={focusLocale} onChange={(event) => { setFocusLocale(event.target.value); setPage(0); }}>{columns.filter((column) => column.code !== 'en').map((column) => <option value={column.code} key={column.code}>{column.name}</option>)}</select></label>
          <label className="check-field"><input type="checkbox" checked={missingOnly} onChange={(event) => { setMissingOnly(event.target.checked); setPage(0); }} /> Missing only</label>
          <div className="result-count">{shownIds.length.toLocaleString()} messages</div>
        </section>

        <section className="add-panel" aria-label="Add a language column">
          <div><h2>Add your language</h2><p>A new column starts empty. Untranslated entries fall back to English.</p></div>
          <form onSubmit={addColumn}>
            <label><span>Language code</span><input value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder="e.g. fr or pt-BR" maxLength={20} /></label>
            <label><span>Native name</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Français" maxLength={60} /></label>
            <button type="submit" className="primary-button">+ Add column</button>
          </form>
        </section>

        <div className="table-heading"><div><h2>Translation table</h2><p>English is the source. Edit the other columns, then export their JSON.</p></div><span>Scroll sideways to see more languages →</span></div>
        <div className="table-scroll">
          <div className="translation-grid" role="table" aria-label="Interface translations" style={{ gridTemplateColumns: `340px repeat(${columns.length}, 300px)` }}>
            <div className="source-head" role="columnheader"><strong>Message & context</strong><span>Stable ID · English source</span></div>
            {columns.map((column) => {
              const translated = Object.keys(drafts[column.code] ?? {}).length;
              return <div className="column-head" role="columnheader" key={column.code}>
                <div className="column-title"><strong>{column.name}</strong><code>{column.code}</code></div>
                <span>{column.code === 'en' ? 'Source catalog' : `${translated} / ${ids.length} entries`}</span>
                <div className="column-actions">
                  {column.code !== 'en' && <label className="import-button">Import JSON<input type="file" accept=".json,application/json" onChange={(event) => void importCatalog(column.code, event)} /></label>}
                  <button type="button" onClick={() => exportCatalog(column.code)}>Download JSON</button>
                  {customColumns.some((item) => item.code === column.code) && <button type="button" className="remove-button" onClick={() => removeColumn(column.code)} aria-label={`Remove ${column.name} column`}>×</button>}
                </div>
              </div>;
            })}
            {visibleIds.map((id) => {
              const english = source[id]!;
              const context = contextFor(id);
              return <div className="grid-row" role="row" key={id} style={{ display: 'contents' }}>
                <div className="source-cell" role="cell"><div className="source-meta"><code>{id}</code>{context && <span className="context-tag">{context}</span>}</div><p>{sourceText(english)}</p>{typeof english !== 'string' && <span className="plural-badge">plural · {Object.keys(english).join(', ')}</span>}</div>
                {columns.map((column) => column.code === 'en' ? <div className="english-cell" role="cell" key={column.code}><p>{sourceText(english)}</p>{typeof english !== 'string' && Object.entries(english).filter(([form]) => form !== 'other').map(([form, text]) => <small key={form}><b>{form}</b> {text}</small>)}</div> : <TranslationCell key={column.code} id={id} locale={column.code} sourceEntry={english} entry={drafts[column.code]?.[id]} update={(value) => updateEntry(column.code, id, value)} />)}
              </div>;
            })}
          </div>
        </div>
        {shownIds.length === 0 && <p className="empty-state">No messages match. Try another search or turn off “Missing only”.</p>}
        <div className="pagination"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← Previous</button><span>Page {currentPage + 1} of {pageCount}</span><button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next →</button></div>
      </main>
      <footer>Drafts stay in this browser. Download JSON to share your work. <a href="https://github.com/forklift-dev/forklift" target="_blank" rel="noreferrer">Forklift on GitHub ↗</a></footer>
      {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></div>}
    </div>
  );
}

function TranslationCell({ id, locale, sourceEntry, entry, update }: { id: string; locale: string; sourceEntry: TranslationEntry; entry?: TranslationEntry; update: (entry: TranslationEntry | undefined) => void }) {
  const hasText = entry !== undefined && (typeof entry === 'string' ? Boolean(entry.trim()) : Object.values(entry).some((text) => Boolean(text.trim())));
  const error = hasText ? entryError(sourceEntry, entry!, locale) : null;
  if (typeof sourceEntry === 'string') {
    const value = typeof entry === 'string' ? entry : '';
    return <div className="translation-cell" role="cell"><textarea value={value} onChange={(event) => update(event.target.value || undefined)} aria-label={`${locale} translation for ${id}`} placeholder="Add a translation…" rows={Math.max(2, Math.min(5, Math.ceil(sourceEntry.length / 55)))} />{error ? <small className="cell-error">{error}</small> : !hasText && <small className="fallback-note">English fallback</small>}</div>;
  }
  const values = typeof entry === 'object' && entry !== null ? entry : {};
  return <div className="translation-cell plural-cell" role="cell">{pluralCategories(locale).map((form) => <label key={form}><span>{form}</span><textarea value={values[form] ?? ''} onChange={(event) => { const next = { ...values }; if (event.target.value) next[form] = event.target.value; else delete next[form]; update(Object.keys(next).length ? next : undefined); }} aria-label={`${locale} ${form} form for ${id}`} placeholder={sourceEntry.other ?? 'English fallback'} rows={2} /></label>)}{error ? <small className="cell-error">{error}</small> : !hasText && <small className="fallback-note">English fallback</small>}</div>;
}
