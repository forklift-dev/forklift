import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DetectedTools, GitIdentity, GitToolKind, ToolKind } from '../../shared/settings';
import { CUSTOM_TOOL, gitToolCommand, type DiffTools } from '../external/diffTools';
import type { ExternalTools } from '../external/tools';
import { GitCliError, type GitCli } from '../git/cli';
import type { SettingsService } from './service';

const SAMPLE = ['Forklift test file', '', 'If you can read this, the editor works.', 'The cursor should be on line 3.', ''].join('\n');
// Throwaway commits in test repositories: no user hooks, signing or identity needed.
const TEST_COMMIT_CONFIG = ['-c', 'user.name=Forklift', '-c', 'user.email=forklift@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=.git/no-hooks'];

const MAX_IDENTITY_LENGTH = 256;

function parseIdentityField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_IDENTITY_LENGTH || /[\0\r\n]/.test(value)) {
    throw new TypeError(`${name} must be a single line of at most ${MAX_IDENTITY_LENGTH} characters`);
  }
  if (name === 'email' && /[<>]/.test(value)) throw new TypeError('email must not contain < or >');
  return value.trim();
}

/** Preferences actions around external tools and git config: detection, "Test" buttons, writing config. */
export class ToolActions {
  constructor(
    private readonly git: GitCli,
    private readonly tools: ExternalTools,
    private readonly diffTools: DiffTools,
    private readonly settings: SettingsService,
  ) {}

  async detect(root: string | null): Promise<DetectedTools> {
    const cwd = root ?? homedir();
    const [programs, diffTools, mergeTools, diff, merge] = await Promise.all([
      this.tools.detect(),
      this.diffTools.available(cwd, 'diff'),
      this.diffTools.available(cwd, 'merge'),
      this.diffTools.configured(cwd, 'diff'),
      this.diffTools.configured(cwd, 'merge'),
    ]);
    return { ...programs, diffTools, mergeTools, gitConfig: { diff, merge } };
  }

  /** Runs the tool chosen for `kind` (as effective for `root`) on sample files; resolves with what happened. */
  async test(kind: ToolKind, root: string | null): Promise<string> {
    const settings = this.settings.effective(root);
    if (kind === 'editor' || kind === 'terminal') {
      const dir = join(tmpdir(), 'forklift-tool-test');
      await mkdir(dir, { recursive: true });
      if (kind === 'terminal') return `Opened ${await this.tools.openTerminal(dir, settings['tools.terminal'])} in ${dir}`;
      const file = join(dir, 'example.txt');
      await writeFile(file, SAMPLE);
      return `Opened ${file} with ${await this.tools.openInEditor(file, 3, dir, settings['tools.editor'])}`;
    }

    const dir = await mkdtemp(join(tmpdir(), 'forklift-tool-test-'));
    try {
      const run = (...args: string[]) => this.git.exec(args, { cwd: dir, allowedExitCodes: [1] });
      await run('init', '-q', '--initial-branch=main');
      await writeFile(join(dir, 'example.txt'), 'line 1\nline 2\nline 3\n');
      await run('add', '.');
      await run(...TEST_COMMIT_CONFIG, 'commit', '-qm', 'base');
      if (kind === 'diff') {
        await writeFile(join(dir, 'example.txt'), 'line 1\nline two (changed)\nline 3\n');
        const tool = await this.diffTools.diff(dir, 'example.txt', false, settings['tools.diff']);
        return `${tool.name} showed a sample change and was closed`;
      }
      await run('checkout', '-qb', 'theirs');
      await writeFile(join(dir, 'example.txt'), 'line 1\nline 2 from their branch\nline 3\n');
      await run(...TEST_COMMIT_CONFIG, 'commit', '-qam', 'theirs');
      await run('checkout', '-q', 'main');
      await writeFile(join(dir, 'example.txt'), 'line 1\nline 2 from our branch\nline 3\n');
      await run(...TEST_COMMIT_CONFIG, 'commit', '-qam', 'ours');
      await run(...TEST_COMMIT_CONFIG, 'merge', '-q', 'theirs');
      const tool = await this.diffTools.merge(dir, 'example.txt', settings['tools.merge']).catch((error: unknown) => {
        // git reports a merge left unresolved as a failed mergetool run; for a test that is a fine outcome.
        if (error instanceof GitCliError && error.exitCode !== null) return null;
        throw error;
      });
      const { stdout } = await run('diff', '--name-only', '--diff-filter=U');
      const resolved = stdout.trim() === '';
      return `${tool?.name ?? 'The merge tool'} opened a sample conflict and was closed (${resolved ? 'resolved' : 'left unresolved'})`;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Writes the diff/merge tool chosen in Preferences to git config, so git itself and other clients use it:
   * the repository's own config for `root`, the global one for null.
   */
  async writeGitConfig(kind: GitToolKind, root: string | null): Promise<void> {
    const setting = this.settings.effective(root)[kind === 'diff' ? 'tools.diff' : 'tools.merge'];
    if (setting.mode === 'git-config') throw new Error('The tool already comes from git config; there is nothing to write');
    const set = (key: string, value: string) => this.config(root, [key, value]);
    if (setting.mode === 'tool') return set(`${kind}.tool`, setting.name);
    await set(`${kind}tool.${CUSTOM_TOOL}.cmd`, gitToolCommand(setting.command, setting.args));
    if (kind === 'merge') await set(`mergetool.${CUSTOM_TOOL}.trustExitCode`, String(setting.trustExitCode));
    await set(`${kind}.tool`, CUSTOM_TOOL);
  }

  /** Identity in the repository's own config (`root`) or the global one (null). */
  async identity(root: string | null): Promise<GitIdentity> {
    const get = async (key: string) => {
      const { stdout } = await this.git.exec(['config', scopeFlag(root), '--get', key], { cwd: root ?? homedir(), readOnly: true, allowedExitCodes: [1] });
      return stdout.trim();
    };
    return { name: await get('user.name'), email: await get('user.email') };
  }

  /** Empty values remove the key (in repository scope that means "inherit the global identity"). */
  async setIdentity(root: string | null, identity: unknown): Promise<void> {
    if (typeof identity !== 'object' || identity === null) throw new TypeError('identity must be an object');
    const { name, email } = identity as Record<string, unknown>;
    const values = { 'user.name': parseIdentityField(name, 'name'), 'user.email': parseIdentityField(email, 'email') };
    for (const [key, value] of Object.entries(values)) {
      // Exit code 5: unsetting a key that is not set.
      if (value) await this.config(root, [key, value]);
      else await this.git.exec(['config', scopeFlag(root), '--unset', key], { cwd: root ?? homedir(), allowedExitCodes: [5] });
    }
  }

  private async config(root: string | null, args: string[]): Promise<void> {
    await this.git.exec(['config', scopeFlag(root), ...args], { cwd: root ?? homedir() });
  }
}

const scopeFlag = (root: string | null) => (root ? '--local' : '--global');
