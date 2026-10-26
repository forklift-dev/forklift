import { useState, type ReactNode } from 'react';
import { joinArgs, splitArgs } from '../../../../shared/commandLine';
import { t, translate } from '../../../../shared/i18n';
import type {
  AppToolSetting,
  CommandLine,
  DetectedTools,
  GitToolKind,
  GitToolSetting,
  ToolKind,
} from '../../../../shared/settings';
import { invoke } from '../../api';
import type { ConfirmOptions } from '../ConfirmDialog';
import { errorText, type ControlProps } from './SettingRow';

const PROGRAM_NAMES: Record<string, string> = {
  code: 'Visual Studio Code',
  cursor: 'Cursor',
  codium: 'VSCodium',
  zed: 'Zed',
  subl: 'Sublime Text',
  'x-terminal-emulator': 'System default (x-terminal-emulator)',
  ptyxis: 'Ptyxis',
  kgx: 'GNOME Console',
  'gnome-terminal': 'GNOME Terminal',
  konsole: 'Konsole',
  'xfce4-terminal': 'Xfce Terminal',
  tilix: 'Tilix',
  kitty: 'kitty',
  alacritty: 'Alacritty',
  wezterm: 'WezTerm',
  foot: 'foot',
  xterm: 'XTerm',
  Terminal: 'Terminal',
  'wt.exe': 'Windows Terminal',
  'cmd.exe': 'Command Prompt',
};

const ARG_HINTS: Record<ToolKind, string> = {
  editor: '--goto {file}:{line}',
  terminal: '--working-directory={dir}',
  diff: '$LOCAL $REMOTE',
  merge: '$LOCAL $BASE $REMOTE -o $MERGED',
};

interface PickerProps extends ControlProps {
  kind: ToolKind;
  detected: DetectedTools | undefined;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

/** Program + arguments editor for a custom command; applies both at once. */
function CustomCommand({
  id,
  kind,
  initial,
  children,
  onApply,
  onCancel,
}: {
  id: string;
  kind: ToolKind;
  initial: CommandLine | null;
  children?: ReactNode;
  onApply(command: CommandLine): Promise<boolean>;
  onCancel?(): void;
}) {
  const [command, setCommand] = useState(initial?.command ?? '');
  const [args, setArgs] = useState(initial ? joinArgs(initial.args) : '');
  const [problem, setProblem] = useState<string | null>(null);

  const apply = async () => {
    setProblem(null);
    if (!command.trim()) return setProblem(t('Choose a program'));
    let parsed: string[];
    try {
      parsed = splitArgs(args);
    } catch (error) {
      return setProblem(errorText(error));
    }
    await onApply({ command: command.trim(), args: parsed });
  };

  const browse = async () => {
    const path = await invoke('settings:browseExecutable');
    if (path) setCommand(path);
  };

  return (
    <div className="custom-command">
      <label>
        {t('Program')}
        <span className="text-control">
          <input id={`${id}-command`} value={command} spellCheck={false} placeholder={t('Name in PATH or full path')} onChange={(e) => setCommand(e.target.value)} />
          <button type="button" onClick={() => void browse()}>
            {t('Browse…')}
          </button>
        </span>
      </label>
      <label>
        {t('Arguments')}
        <input id={`${id}-args`} value={args} spellCheck={false} placeholder={ARG_HINTS[kind]} onChange={(e) => setArgs(e.target.value)} />
      </label>
      {children}
      {problem && (
        <p className="setting-error" role="alert">
          {problem}
        </p>
      )}
      <div className="custom-command-actions">
        <button type="button" className="primary" onClick={() => void apply()}>
          {t('Apply')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t('Cancel')}
          </button>
        )}
      </div>
    </div>
  );
}

/** "Test" button: runs the saved choice on sample files and reports what happened. */
function TestButton({ kind, repo }: { kind: ToolKind; repo: string | null }) {
  const [status, setStatus] = useState<{ text: string; ok: boolean; running: boolean } | null>(null);
  const test = async () => {
    setStatus({ text: kind === 'diff' || kind === 'merge' ? t('Waiting for the tool to be closed…') : t('Starting…'), ok: true, running: true });
    try {
      setStatus({ text: await invoke('tools:test', kind, repo), ok: true, running: false });
    } catch (error) {
      setStatus({ text: errorText(error), ok: false, running: false });
    }
  };
  return (
    <>
      <button type="button" onClick={() => void test()} disabled={status?.running}>
        {t('Test')}
      </button>
      {status && (
        <p className={status.ok ? 'tool-status' : 'setting-error'} role="status">
          {status.text}
        </p>
      )}
    </>
  );
}

const programLabel = (id: string) => translate(PROGRAM_NAMES[id] ?? id);

export function AppToolPicker({ id, kind, value, repo, save, detected }: PickerProps) {
  const setting = value as AppToolSetting;
  const [editing, setEditing] = useState(false);
  const programs = (kind === 'editor' ? detected?.editors : detected?.terminals) ?? [];
  const installed = programs.filter((program) => program.path);
  const automatic = installed[0] ? programLabel(installed[0].id) : kind === 'editor' ? t('the system default application') : t('none found');
  const selected = editing ? 'custom' : setting.mode === 'preset' ? `preset:${setting.id}` : setting.mode;
  // A preset saved on another system (e.g. a synced settings file) that this one does not offer.
  const unknownPreset = detected && setting.mode === 'preset' && !programs.some((program) => program.id === setting.id) ? setting.id : null;

  const choose = (choice: string) => {
    if (choice === 'custom') return setEditing(true);
    setEditing(false);
    void save(choice === 'auto' ? { mode: 'auto' } : { mode: 'preset', id: choice.slice('preset:'.length) });
  };

  return (
    <div className="tool-picker">
      <span className="text-control">
        <select id={id} value={selected} onChange={(event) => choose(event.target.value)}>
          <option value="auto">{t('Automatic ({choice})', { choice: automatic })}</option>
          {programs.map((program) => (
            <option key={program.id} value={`preset:${program.id}`} disabled={!program.path && !(setting.mode === 'preset' && setting.id === program.id)}>
              {program.path ? programLabel(program.id) : t('{name} (not installed)', { name: programLabel(program.id) })}
            </option>
          ))}
          {unknownPreset && <option value={selected}>{t('{name} (not available)', { name: unknownPreset })}</option>}
          <option value="custom">{t('Custom command…')}</option>
        </select>
        {/* Test runs the saved choice, so it waits until a new custom command is applied. */}
        {!editing && <TestButton kind={kind} repo={repo} />}
      </span>
      {(editing || setting.mode === 'custom') && (
        <CustomCommand
          id={id}
          kind={kind}
          initial={setting.mode === 'custom' ? setting : null}
          onApply={async (command) => {
            const ok = await save({ mode: 'custom', ...command });
            if (ok) setEditing(false);
            return ok;
          }}
          onCancel={editing ? () => setEditing(false) : undefined}
        />
      )}
    </div>
  );
}

export function GitToolPicker({ id, kind, value, repo, save, detected, confirm }: PickerProps) {
  const setting = value as GitToolSetting;
  const gitKind = kind as GitToolKind;
  const [editing, setEditing] = useState(false);
  const [trustExitCode, setTrustExitCode] = useState(setting.mode === 'custom' ? setting.trustExitCode : false);
  const [written, setWritten] = useState<string | null>(null);
  const tools = (gitKind === 'diff' ? detected?.diffTools : detected?.mergeTools) ?? [];
  const configured = detected?.gitConfig[gitKind];
  const selected = editing ? 'custom' : setting.mode === 'tool' ? `tool:${setting.name}` : setting.mode;

  const choose = (choice: string) => {
    if (choice === 'custom') return setEditing(true);
    setEditing(false);
    void save(choice === 'git-config' ? { mode: 'git-config' } : { mode: 'tool', name: choice.slice('tool:'.length) });
  };

  const writeToGitConfig = async () => {
    const ok = await confirm({
      title: t('Save the {kind} tool to git config?', { kind: gitKind }),
      detail: repo
        ? t("{kind}.tool will be set in this repository's .git/config. git and other git clients will use it too.", { kind: gitKind })
        : t('{kind}.tool will be set in your global git config (~/.gitconfig). git and other git clients will use it too.', { kind: gitKind }),
      confirmLabel: t('Save to git config'),
    });
    if (!ok) return;
    try {
      await invoke('tools:writeGitConfig', gitKind, repo);
      setWritten(repo ? t('Saved to repository git config') : t('Saved to global git config'));
    } catch (error) {
      setWritten(errorText(error));
    }
  };

  return (
    <div className="tool-picker">
      <span className="text-control">
        <select id={id} value={selected} onChange={(event) => choose(event.target.value)}>
          <option value="git-config">{t('As in git config ({choice})', { choice: configured ?? t('not set; chosen automatically') })}</option>
          {tools.map((tool) => (
            <option key={tool.name} value={`tool:${tool.name}`} title={tool.description}>
              {tool.name}
              {tool.description ? ` — ${tool.description.replace(/^Use /, '')}` : ''}
            </option>
          ))}
          {setting.mode === 'tool' && !tools.some((tool) => tool.name === setting.name) && (
            <option value={selected}>{t('{name} (not available)', { name: setting.name })}</option>
          )}
          <option value="custom">{t('Custom command…')}</option>
        </select>
        {!editing && <TestButton kind={kind} repo={repo} />}
        {setting.mode !== 'git-config' && (
          <button type="button" onClick={() => void writeToGitConfig()}>
            {t('Save to git config…')}
          </button>
        )}
      </span>
      {written && <p className="tool-status">{written}</p>}
      {(editing || setting.mode === 'custom') && (
        <CustomCommand
          id={id}
          kind={kind}
          initial={setting.mode === 'custom' ? setting : null}
          onApply={async (command) => {
            const ok = await save({ mode: 'custom', trustExitCode, ...command });
            if (ok) setEditing(false);
            return ok;
          }}
          onCancel={editing ? () => setEditing(false) : undefined}
        >
          {gitKind === 'merge' && (
            <label className="checkbox-label">
              <input type="checkbox" checked={trustExitCode} onChange={(event) => setTrustExitCode(event.target.checked)} />
              {t("The tool's exit code tells whether the merge succeeded (otherwise git checks whether the file was saved)")}
            </label>
          )}
        </CustomCommand>
      )}
    </div>
  );
}
