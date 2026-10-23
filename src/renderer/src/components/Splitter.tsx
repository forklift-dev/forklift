import type { KeyboardEvent, PointerEvent } from 'react';

interface SplitterProps {
  label: string;
  /** The size it changes, in px. */
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  /** Double click: back to the default. */
  onReset(): void;
  /** 1: dragging right makes it bigger (a panel on the left); -1: dragging left does. */
  direction: 1 | -1;
  className?: string;
  /** `col-resizer` for column borders in a header. */
  kind?: 'splitter' | 'col-resizer';
}

/** A draggable border (also with the keyboard: arrows, Shift for big steps, Home/End). */
export function Splitter({ label, value, min, max, onChange, onReset, direction, className = '', kind = 'splitter' }: SplitterProps) {
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    const move = (e: globalThis.PointerEvent) => onChange(value + direction * (e.clientX - start));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16;
    if (event.key === 'ArrowLeft') onChange(value - direction * step);
    else if (event.key === 'ArrowRight') onChange(value + direction * step);
    else if (event.key === 'Home') onChange(direction === 1 ? min : max);
    else if (event.key === 'End') onChange(direction === 1 ? max : min);
    else if (event.key === 'Enter') onReset();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <div
      className={`${kind} ${className}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} (double-click: default width)`}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
