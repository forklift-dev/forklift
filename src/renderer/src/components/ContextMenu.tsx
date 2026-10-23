import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

export type MenuItem =
  | { label: string; onSelect(): void; danger?: boolean; disabled?: boolean }
  | 'separator';

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
}

/** `open(event, items)` shows a context menu at the pointer; `menu` must be rendered somewhere. */
export function useContextMenu(): { open(event: MouseEvent, items: MenuItem[]): void; menu: ReactNode } {
  const [state, setState] = useState<OpenMenu | null>(null);
  const open = useCallback((event: MouseEvent, items: MenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    setState({ x: event.clientX, y: event.clientY, items });
  }, []);
  const close = useCallback(() => setState(null), []);
  return { open, menu: state && <ContextMenu {...state} onClose={close} /> };
}

function ContextMenu({ x, y, items, onClose }: OpenMenu & { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(x, innerWidth - box.width - 4)), top: Math.max(4, Math.min(y, innerHeight - box.height - 4)) });
    ref.current!.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => !ref.current?.contains(event.target as Node) && onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const move = (step: number) => {
    const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={position}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(event.key === 'ArrowDown' ? 1 : -1);
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <div key={index} className="context-menu-separator" role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger-text' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** Copies text with the user's gesture; needs no clipboard permission (the app grants none). */
export function copyText(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}
