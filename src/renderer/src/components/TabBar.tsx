import { useState, type DragEvent } from 'react';
import type { TabsState } from '../../../shared/state';

interface TabBarProps {
  tabs: TabsState;
  /** The Repositories screen (opened with "+") is showing instead of a tab. */
  managerOpen: boolean;
  onActivate(id: string): void;
  onClose(id: string): void;
  onMove(id: string, index: number): void;
  onNewTab(): void;
}

const TAB_MIME = 'application/x-forklift-tab';

/** Dropping on the left half of tab `index` puts the dragged tab before it, on the right half after it. */
function dropPosition(event: DragEvent<HTMLElement>, index: number): number {
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left + box.width / 2 ? index : index + 1;
}

/** Open repositories as tabs: click to switch, middle click or × to close, drag to reorder, + for the Repositories screen. */
export function TabBar({ tabs, managerOpen, onActivate, onClose, onMove, onNewTab }: TabBarProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  return (
    <nav className="tab-bar" aria-label="Open repositories">
      <div className="tabs" role="tablist">
        {tabs.tabs.map((tab, index) => {
          const active = !managerOpen && tab.id === tabs.activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`tab${active ? ' active' : ''}${tab.error ? ' has-error' : ''}${dropIndex === index ? ' drop-before' : ''}`}
              title={tab.error ? `${tab.id}\n${tab.error}` : tab.id}
              draggable
              onClick={() => onActivate(tab.id)}
              onAuxClick={(event) => event.button === 1 && onClose(tab.id)}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onActivate(tab.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData(TAB_MIME, tab.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(TAB_MIME)) return;
                event.preventDefault();
                setDropIndex(dropPosition(event, index));
              }}
              onDragLeave={() => setDropIndex(null)}
              onDrop={(event) => {
                const id = event.dataTransfer.getData(TAB_MIME);
                setDropIndex(null);
                if (!id) return;
                event.preventDefault();
                const target = dropPosition(event, index);
                const from = tabs.tabs.findIndex((t) => t.id === id);
                // Removing the dragged tab first shifts later positions left by one.
                onMove(id, from < target ? target - 1 : target);
              }}
              onDragEnd={() => setDropIndex(null)}
            >
              {tab.loading ? (
                <span className="tab-spinner spinner" aria-label="Loading" />
              ) : tab.error ? (
                <span className="codicon codicon-warning tab-icon" aria-label="Unavailable" />
              ) : (
                <span className="codicon codicon-repo tab-icon" aria-hidden="true" />
              )}
              <span className="tab-name">{tab.name}</span>
              <button
                type="button"
                className="tab-close icon-button"
                aria-label={`Close ${tab.name}`}
                title="Close (Ctrl+W)"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <span className="codicon codicon-close" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className={`icon-button new-tab${managerOpen ? ' active' : ''}`}
        aria-label="Open a repository in a new tab"
        title="Repositories (Ctrl+T)"
        onClick={onNewTab}
      >
        <span className="codicon codicon-add" aria-hidden="true" />
      </button>
    </nav>
  );
}
