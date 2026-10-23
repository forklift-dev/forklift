import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  REPO_SETTING_KEYS,
  SETTING_KEYS,
  settingField,
  SETTINGS_SECTIONS,
  type SettingKey,
  type SettingsSection,
} from '../../../../shared/settings';
import type { RepoData } from '../../../../shared/state';
import { invoke } from '../../api';
import { useAppState } from '../../state';
import { useCommand } from '../../useCommand';
import { useConfirm } from '../ConfirmDialog';
import { GitIdentityEditor } from './GitIdentity';
import { BooleanControl, EnumControl, SettingRow, TextControl, type ControlProps } from './SettingRow';
import { AppToolPicker, GitToolPicker } from './ToolPickers';

const IDENTITY_TERMS = 'commit author identity user name email';

function matches(key: SettingKey, query: string): boolean {
  const field = settingField(key);
  const haystack = `${key} ${field.label} ${field.description ?? ''} ${SETTINGS_SECTIONS[field.section]}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function GitStatus() {
  const gitCli = useAppState((s) => s.app.gitCli);
  if (!gitCli) return <p className="tool-status">Checking git…</p>;
  if (!gitCli.version) return <p className="setting-error">git was not found</p>;
  if (!gitCli.meetsMinimum) return <p className="setting-error">git {gitCli.version} is older than {gitCli.minimumVersion}</p>;
  return <p className="tool-status">Using git {gitCli.version}</p>;
}

interface PreferencesProps {
  repo: RepoData | null;
  onClose(): void;
}

/** Preferences screen: sections on the left, search, and a scope switch for repository overrides. */
export function Preferences({ repo, onClose }: PreferencesProps) {
  const problems = useAppState((s) => s.settings.problems);
  const [scope, setScope] = useState<'global' | 'repository'>('global');
  const [section, setSection] = useState<SettingsSection>('tools');
  const [query, setQuery] = useState('');
  const { confirm, dialog } = useConfirm();
  const repoRoot = scope === 'repository' && repo ? repo.root : null;
  const detected = useCommand('tools:detect', [repo?.root ?? null], { keepPrevious: true });

  const rootRef = useRef<HTMLElement>(null);
  // Keyboard focus starts inside, so Escape reaches this screen first.
  useEffect(() => rootRef.current?.focus(), []);

  const available = repoRoot ? REPO_SETTING_KEYS : SETTING_KEYS;
  const sections = (Object.keys(SETTINGS_SECTIONS) as SettingsSection[]).filter(
    // The Git section always has the commit identity, also per repository.
    (id) => id === 'git' || available.some((key) => settingField(key).section === id),
  );
  const shownSection = sections.includes(section) ? section : sections[0]!;
  const searching = query.trim() !== '';
  const keys = available.filter((key) => (searching ? matches(key, query) : settingField(key).section === shownSection));
  const words = query.trim().toLowerCase().split(/\s+/);
  const showIdentity = searching ? words.every((word) => IDENTITY_TERMS.includes(word)) : shownSection === 'git';

  const render = (key: SettingKey) => (props: ControlProps): ReactNode => {
    const field = settingField(key);
    switch (field.type) {
      case 'boolean':
        return <BooleanControl {...props} />;
      case 'enum':
        return <EnumControl {...props} />;
      case 'integer':
        return <TextControl {...props} />;
      case 'string':
        return <TextControl {...props} browse={field.kind} />;
      case 'appTool':
        return <AppToolPicker {...props} kind={field.tool} detected={detected.data} confirm={confirm} />;
      case 'gitTool':
        return <GitToolPicker {...props} kind={field.tool} detected={detected.data} confirm={confirm} />;
    }
  };

  const rows = (list: SettingKey[]) =>
    list.map((key) => (
      <SettingRow
        // Remount per scope: drafts and pickers belong to the scope they were opened in.
        key={`${repoRoot ?? ''}:${key}`}
        settingKey={key}
        repo={repoRoot}
        render={render(key)}
        extra={key === 'git.executable' ? <GitStatus /> : undefined}
      />
    ));

  return (
    <section
      className="preferences"
      aria-label="Preferences"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(event) => {
        // Handled here and marked, so views hidden underneath (an open diff) ignore it.
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="preferences-header">
        <h1>Preferences</h1>
        <div className="scope-switch" role="tablist" aria-label="Settings scope">
          <button type="button" role="tab" aria-selected={scope === 'global'} onClick={() => setScope('global')}>
            All repositories
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'repository'}
            disabled={!repo}
            title={repo ? `Overrides for ${repo.root}` : 'Open a repository to change its own settings'}
            onClick={() => setScope('repository')}
          >
            {repo ? `This repository (${repo.name})` : 'This repository'}
          </button>
        </div>
        <input
          className="preferences-search"
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close preferences">
          ✕
        </button>
      </header>
      {problems.length > 0 && (
        <div className="settings-problems" role="alert">
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <button type="button" onClick={() => void invoke('settings:dismissProblems')}>
            Dismiss
          </button>
        </div>
      )}
      <div className="preferences-body">
        <nav className="preferences-nav" aria-label="Sections">
          {sections.map((id) => (
            <button
              key={id}
              type="button"
              className={!searching && id === shownSection ? 'active' : undefined}
              aria-current={!searching && id === shownSection ? 'page' : undefined}
              onClick={() => {
                setQuery('');
                setSection(id);
              }}
            >
              {SETTINGS_SECTIONS[id]}
            </button>
          ))}
        </nav>
        <div className="preferences-content">
          {!searching && <h2>{SETTINGS_SECTIONS[shownSection]}</h2>}
          {repoRoot && <p className="scope-note">Settings below apply only to {repo?.root}; anything not set here follows the settings for all repositories.</p>}
          {shownSection === 'tools' && !searching && detected.error && <p className="setting-error">Could not detect installed tools: {detected.error}</p>}
          {rows(keys)}
          {showIdentity && <GitIdentityEditor key={repoRoot ?? 'global'} repo={repoRoot} />}
          {searching && keys.length === 0 && !showIdentity && <p className="empty-note">No settings match “{query}”</p>}
        </div>
      </div>
      {dialog}
    </section>
  );
}
