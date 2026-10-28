import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  REPO_SETTING_KEYS,
  SETTING_KEYS,
  settingField,
  SETTINGS_SECTIONS,
  type SettingKey,
  type SettingsSection,
} from '../../../../shared/settings';
import { t, translate } from '../../../../shared/i18n';
import type { RepoData } from '../../../../shared/state';
import { invoke } from '../../api';
import { useAppState } from '../../state';
import { useCommand } from '../../useCommand';
import { useConfirm } from '../ConfirmDialog';
import { AccountsEditor } from './Accounts';
import { AiKeyEditor } from './AiKey';
import { GitIdentityEditor } from './GitIdentity';
import { BooleanControl, EnumControl, SettingRow, TextControl, type ControlProps } from './SettingRow';
import { KeybindingsEditor } from './KeybindingsEditor';
import { GraphStylePicker } from './GraphStylePicker';
import { ProfilesEditor } from './Profiles';
import { ThemePicker, UserThemesNote } from './ThemePicker';
import { AppToolPicker, GitToolPicker } from './ToolPickers';

const IDENTITY_TERMS = 'commit author identity user name email';

function matches(key: SettingKey, query: string): boolean {
  const field = settingField(key);
  const optionTexts = field.type === 'enum' ? field.options.flatMap((option) => [option.label, translate(option.label)]) : [];
  const source = [key, field.label, field.description ?? '', SETTINGS_SECTIONS[field.section], ...optionTexts];
  const haystack = [...source, ...source.map((text) => translate(text))].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function matchesIdentity(query: string): boolean {
  const translated = [t('Commit author'), t('Name'), t('Email')].join(' ').toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => IDENTITY_TERMS.includes(word) || translated.includes(word));
}

function GitStatus() {
  const gitCli = useAppState((s) => s.app.gitCli);
  if (!gitCli) return <p className="tool-status">{t('Checking git…')}</p>;
  if (!gitCli.version) return <p className="setting-error">{t('git was not found')}</p>;
  if (!gitCli.meetsMinimum) return <p className="setting-error">{t('git {version} is older than {minimumVersion}', { version: gitCli.version, minimumVersion: gitCli.minimumVersion })}</p>;
  return <p className="tool-status">{t('Using git {version}', { version: gitCli.version })}</p>;
}

interface PreferencesProps {
  repo: RepoData | null;
  /** Section shown first. */
  section?: SettingsSection;
  onClose(): void;
}

/** Preferences screen: sections on the left, search, and a scope switch for repository overrides. */
export function Preferences({ repo, section: initialSection = 'general', onClose }: PreferencesProps) {
  const problems = useAppState((s) => s.settings.problems);
  const aiProvider = useAppState((s) => s.settings.values['ai.provider']);
  const [scope, setScope] = useState<'global' | 'repository'>('global');
  const [section, setSection] = useState<SettingsSection>(initialSection);
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
  const keys = available.filter((key) => {
    if (key === 'ai.model' && aiProvider !== 'ollama') return false;
    if (key === 'ai.openaiModel' && aiProvider !== 'openai') return false;
    return searching ? matches(key, query) : settingField(key).section === shownSection;
  });
  const aiKeySearchText = [t('OpenAI API key'), t('Encrypted with the system keychain. Used only after confirming a request; OpenAI may charge for tokens.'), 'OpenAI API key'].join(' ').toLowerCase();
  const showAiKey = !repoRoot && aiProvider === 'openai' && (searching
    ? query.trim().toLowerCase().split(/\s+/).every((word) => aiKeySearchText.includes(word))
    : shownSection === 'integrations');
  const showIdentity = searching ? matchesIdentity(query.trim()) : shownSection === 'git';

  const render = (key: SettingKey) => (props: ControlProps): ReactNode => {
    const field = settingField(key);
    switch (field.type) {
      case 'boolean':
        return <BooleanControl {...props} />;
      case 'enum':
        return key === 'ui.graphStyle' ? <GraphStylePicker {...props} /> : <EnumControl {...props} />;
      case 'integer':
        return <TextControl {...props} />;
      case 'string':
        if (field.kind === 'theme' || field.kind === 'editorTheme') return <ThemePicker {...props} />;
        return <TextControl {...props} browse={field.kind} />;
      case 'appTool':
        return <AppToolPicker {...props} kind={field.tool} detected={detected.data} confirm={confirm} />;
      case 'gitTool':
        return <GitToolPicker {...props} kind={field.tool} detected={detected.data} confirm={confirm} />;
      case 'keybindings':
        return <KeybindingsEditor {...props} />;
      case 'profiles':
        return <ProfilesEditor {...props} />;
      case 'accounts':
        return <AccountsEditor {...(props as ControlProps<'integrations.accounts'>)} />;
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
        extra={key === 'git.executable' ? <GitStatus /> : key === 'ui.theme' ? <UserThemesNote /> : undefined}
      />
    ));

  return (
    <section
      className="preferences"
      aria-label={t('msg.66962f72a0888373')}
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
        <h1>{t('msg.66962f72a0888373')}</h1>
        <div className="scope-switch" role="tablist" aria-label={t('Settings scope')}>
          <button type="button" role="tab" aria-selected={scope === 'global'} onClick={() => setScope('global')}>
            {t('All repositories')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'repository'}
            disabled={!repo}
            title={repo ? t('Overrides for {path}', { path: repo.root }) : t('Open a repository to change its own settings')}
            onClick={() => setScope('repository')}
          >
            {repo ? t('This repository ({name})', { name: repo.name }) : t('This repository')}
          </button>
        </div>
        <input
          className="preferences-search"
          type="search"
          placeholder={t('msg.255b076dd8285543')}
          aria-label={t('msg.255b076dd8285543')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" onClick={onClose} title={t('Close (Esc)')} aria-label={t('Close preferences')}>
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
            {t('Dismiss')}
          </button>
        </div>
      )}
      <div className="preferences-body">
        <nav className="preferences-nav" aria-label={t('Sections')}>
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
              {translate(SETTINGS_SECTIONS[id])}
            </button>
          ))}
        </nav>
        <div className="preferences-content">
          {!searching && <h2>{translate(SETTINGS_SECTIONS[shownSection])}</h2>}
          {repoRoot && <p className="scope-note">{t('Settings below apply only to {path}; anything not set here follows the settings for all repositories.', { path: repo?.root ?? '' })}</p>}
          {shownSection === 'tools' && !searching && detected.error && <p className="setting-error">{t('Could not detect installed tools: {error}', { error: detected.error })}</p>}
          {rows(keys)}
          {showAiKey && <AiKeyEditor />}
          {showIdentity && <GitIdentityEditor key={repoRoot ?? 'global'} repo={repoRoot} />}
          {searching && keys.length === 0 && !showIdentity && !showAiKey && <p className="empty-note">{t('No settings match “{query}”', { query })}</p>}
        </div>
      </div>
      {dialog}
    </section>
  );
}
