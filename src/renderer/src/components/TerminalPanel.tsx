import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { t } from '../../../shared/i18n';
import type { TerminalEvent } from '../../../shared/terminal';
import { invoke } from '../api';
import { CODE_FONT } from '../monaco/setup';
import { useAppState } from '../state';
import { terminalTheme, THEME_EVENT } from '../theme';

// One subscription for all terminals; events are routed by terminal id.
const listeners = new Map<number, (event: TerminalEvent) => void>();
const early = new Map<number, TerminalEvent[]>();
let subscribed = false;
function onTerminalEvent(id: number, listener: (event: TerminalEvent) => void): () => void {
  if (!subscribed) {
    subscribed = true;
    window.forklift.terminal.onEvent((event) => {
      const target = listeners.get(event.id);
      if (target) target(event);
      // Output can arrive before the view registered (the shell's first prompt).
      else early.set(event.id, [...(early.get(event.id) ?? []), event]);
    });
  }
  listeners.set(id, listener);
  for (const event of early.get(id) ?? []) listener(event);
  early.delete(id);
  return () => listeners.delete(id);
}

/** One xterm.js terminal connected to a shell in the pty host. */
function TerminalView({ repo, visible, onTitle, onExit }: { repo: string; visible: boolean; onTitle(title: string): void; onExit(code: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const values = useAppState((s) => s.settings.values);
  // Read when the terminal starts; font settings apply to new terminals.
  const callbacks = useRef({ onTitle, onExit, values });
  useEffect(() => {
    callbacks.current = { onTitle, onExit, values };
  });
  const fitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const { values: options } = callbacks.current;
    const terminal = new Terminal({
      fontFamily: options['terminal.fontFamily'] || CODE_FONT,
      fontSize: options['terminal.fontSize'],
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    // Links open in the browser (main lets only https:// through).
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri)));
    terminal.open(ref.current!);
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // No WebGL (some VMs and remote desktops): xterm's DOM renderer stays.
    }
    let id: number | null = null;
    let disposed = false;
    let unsubscribe = () => {};
    const resize = () => {
      if (!ref.current?.offsetParent) return;
      fit.fit();
      if (id !== null) void invoke('terminal:resize', id, terminal.cols, terminal.rows).catch(() => {});
    };
    fitRef.current = resize;
    resize();
    void invoke('terminal:create', repo, terminal.cols || 80, terminal.rows || 24).then(
      (created) => {
        if (disposed) return void invoke('terminal:kill', created);
        id = created;
        unsubscribe = onTerminalEvent(created, (event) => {
          if (event.type === 'data') terminal.write(event.data);
          else {
            terminal.write(`\r\n\x1b[2m[${t('process exited with code {code}', { code: event.exitCode })}]\x1b[0m\r\n`);
            callbacks.current.onExit(event.exitCode);
          }
        });
        terminal.onData((data) => window.forklift.terminal.write(created, data));
        resize();
      },
      (error: unknown) => terminal.write(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m\r\n`),
    );
    terminal.onTitleChange((title) => callbacks.current.onTitle(title));
    const repaint = () => (terminal.options.theme = terminalTheme());
    window.addEventListener(THEME_EVENT, repaint);
    const observer = new ResizeObserver(() => resize());
    observer.observe(ref.current!);
    return () => {
      disposed = true;
      window.removeEventListener(THEME_EVENT, repaint);
      observer.disconnect();
      unsubscribe();
      if (id !== null) void invoke('terminal:kill', id).catch(() => {});
      terminal.dispose();
    };
    // A terminal keeps its shell for its whole life.
  }, [repo]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.());
  }, [visible]);

  return <div className="terminal-view" ref={ref} hidden={!visible} data-terminal />;
}

interface TerminalTab {
  key: number;
  title: string;
  exited: boolean;
}

/** The terminals of one repository: tabs, a new one with "+", each in the repository's folder. */
export function TerminalPanel({ repo, visible, onExternal, onHide, onEmpty }: { repo: string; visible: boolean; onExternal(): void; onHide(): void; onEmpty(): void }) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [{ key: 1, title: t('Terminal {number}', { number: 1 }), exited: false }]);
  const [active, setActive] = useState(1);
  const next = useRef(2);

  const add = () => {
    const key = next.current++;
    setTabs((current) => [...current, { key, title: t('Terminal {number}', { number: key }), exited: false }]);
    setActive(key);
  };
  const close = (key: number) => {
    setTabs((current) => {
      const rest = current.filter((tab) => tab.key !== key);
      if (key === active && rest.length) setActive(rest.at(-1)!.key);
      if (!rest.length) {
        onHide();
        // The last terminal closed: the panel goes; opening it again starts a fresh one.
        queueMicrotask(onEmpty);
      }
      return rest;
    });
  };
  const update = (key: number, change: Partial<TerminalTab>) => setTabs((current) => current.map((tab) => (tab.key === key ? { ...tab, ...change } : tab)));

  return (
    <section className="terminal-panel" aria-label={t('Terminal')}>
      <header className="terminal-header">
        <div className="terminal-tabs" role="tablist">
          {tabs.map((tab) => (
            <div key={tab.key} role="tab" aria-selected={tab.key === active} className={`terminal-tab${tab.key === active ? ' active' : ''}${tab.exited ? ' exited' : ''}`} onClick={() => setActive(tab.key)}>
              <span className="codicon codicon-terminal" aria-hidden="true" />
              <span className="terminal-title">{tab.title}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={t('Close {name}', { name: tab.title })}
                onClick={(event) => {
                  event.stopPropagation();
                  close(tab.key);
                }}
              >
                <span className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
          ))}
          <button type="button" className="icon-button" aria-label={t('New terminal')} title={t('New terminal')} onClick={add}>
            <span className="codicon codicon-add" aria-hidden="true" />
          </button>
        </div>
        <div className="terminal-actions">
          <button type="button" className="icon-button" aria-label={t('Open external terminal')} title={t('Open the repository in your terminal app')} onClick={onExternal}>
            <span className="codicon codicon-link-external" aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label={t('Hide terminal')} title={t('Hide (Ctrl+`)')} onClick={onHide}>
            <span className="codicon codicon-chevron-down" aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="terminal-body">
        {tabs.map((tab) => (
          <TerminalView key={tab.key} repo={repo} visible={visible && tab.key === active} onTitle={(title) => update(tab.key, { title })} onExit={() => update(tab.key, { exited: true })} />
        ))}
      </div>
    </section>
  );
}
