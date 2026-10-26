import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../../../shared/i18n';

export interface PaletteItem {
  key: string;
  label: string;
  /** Matched characters of `label`, highlighted. */
  positions?: number[];
  /** Shown after the label, dimmed (a path, a date). */
  detail?: string;
  /** Right-aligned, e.g. the shortcut. */
  hint?: string;
  icon?: string;
  /** Heading above the first item of each group. */
  group?: string;
  run(modifiers: { shift: boolean }): void;
}

interface PaletteProps {
  label: string;
  placeholder: string;
  query: string;
  onQuery(query: string): void;
  items: PaletteItem[];
  /** Shown when nothing matches. */
  empty: string;
  footer?: ReactNode;
  busy?: boolean;
  onClose(): void;
}

function Highlighted({ text, positions }: { text: string; positions?: number[] }) {
  if (!positions?.length) return <>{text}</>;
  const marked = new Set(positions);
  const parts: ReactNode[] = [];
  let run = '';
  let inMark = false;
  const flush = (index: number) => {
    if (run) parts.push(inMark ? <mark key={index}>{run}</mark> : run);
    run = '';
  };
  for (let i = 0; i < text.length; i++) {
    if (marked.has(i) !== inMark) {
      flush(i);
      inMark = !inMark;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{parts}</>;
}

/** A filter box over a list, at the top of the window: arrows move, Enter runs, Esc closes. */
export function Palette({ label, placeholder, query, onQuery, items, empty, footer, busy, onClose }: PaletteProps) {
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => inputRef.current?.focus(), []);
  // The active item stays in view as the arrows move it.
  useLayoutEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  });

  const choose = (item: PaletteItem | undefined, shift: boolean) => {
    if (!item) return;
    onClose();
    item.run({ shift });
  };

  return (
    <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label={label} onMouseDown={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          spellCheck={false}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          value={query}
          onChange={(event) => {
            setActive(0);
            onQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            else if (event.key === 'ArrowDown') setActive((current + 1) % Math.max(1, items.length));
            else if (event.key === 'ArrowUp') setActive((current - 1 + items.length) % Math.max(1, items.length));
            else if (event.key === 'PageDown') setActive(Math.min(items.length - 1, current + 10));
            else if (event.key === 'PageUp') setActive(Math.max(0, current - 10));
            else if (event.key === 'Enter') choose(items[current], event.shiftKey);
            else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {items.map((item, index) => (
            <li key={item.key} role="presentation">
              {item.group && (index === 0 || items[index - 1]!.group !== item.group) && <div className="palette-group">{item.group}</div>}
              <div
                role="option"
                aria-selected={index === current}
                className={`palette-item${index === current ? ' active' : ''}`}
                onMouseMove={() => index !== current && setActive(index)}
                onClick={(event) => choose(item, event.shiftKey)}
              >
                {item.icon && <span className={`codicon codicon-${item.icon}`} aria-hidden="true" />}
                <span className="palette-label">
                  <Highlighted text={item.label} positions={item.positions} />
                </span>
                {item.detail && <span className="palette-detail">{item.detail}</span>}
                {item.hint && <kbd className="palette-hint">{item.hint}</kbd>}
              </div>
            </li>
          ))}
          {items.length === 0 && <li className="palette-empty">{busy ? t('Searching…') : empty}</li>}
        </ul>
        {footer && <div className="palette-footer">{footer}</div>}
      </div>
    </div>
  );
}
