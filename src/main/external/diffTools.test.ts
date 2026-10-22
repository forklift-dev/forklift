import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitCli } from '../git/cli';
import { directRunner } from '../process/testing';
import { normalizeRepoRelative } from '../repoPaths';
import { chooseTool, DiffToolError, DiffTools, parseToolHelp } from './diffTools';

// Real `git difftool --tool-help` output (git 2.53), trimmed.
const TOOL_HELP = `'git difftool --tool=<tool>' may be set to one of the following:
\t\tvimdiff          Use Vim
\t\tvscode           Use Visual Studio Code (requires a graphical session)

The following tools are valid, but not currently available:
\t\tmeld             Use Meld (requires a graphical session)
`;

describe('parseToolHelp', () => {
  it('reads only the available section', () => {
    expect(parseToolHelp(TOOL_HELP)).toEqual([
      { name: 'vimdiff', description: 'Use Vim' },
      { name: 'vscode', description: 'Use Visual Studio Code (requires a graphical session)' },
    ]);
  });

  it('handles older git without descriptions', () => {
    expect(parseToolHelp("'git difftool --tool=<tool>' may be set to one of the following:\n\t\tmeld\n\t\tvimdiff\n\n")).toEqual([
      { name: 'meld', description: '' },
      { name: 'vimdiff', description: '' },
    ]);
  });
});

describe('chooseTool', () => {
  const tools = (...names: string[]) => names.map((name) => ({ name, description: '' }));

  it('respects the configured tool', () => {
    expect(chooseTool('diff', 'bc', tools('meld'), true)).toEqual({ name: 'bc', configArgs: [], source: 'configured' });
  });

  it('prefers dedicated GUI tools and never picks terminal ones', () => {
    expect(chooseTool('diff', null, tools('vimdiff', 'vscode', 'kdiff3', 'meld'), false)?.name).toBe('meld');
    expect(chooseTool('diff', null, parseToolHelp(TOOL_HELP), false)?.name).toBe('vscode');
    expect(chooseTool('merge', null, tools('vimdiff', 'nvimdiff', 'emerge'), false)).toBeNull();
  });

  it('defines a VS Code tool for git without the built-in one', () => {
    const diff = chooseTool('diff', null, tools('vimdiff'), true);
    expect(diff).toMatchObject({ name: 'forklift-vscode', source: 'vscode' });
    expect(diff?.configArgs).toEqual(['-c', 'difftool.forklift-vscode.cmd=code --wait --diff "$LOCAL" "$REMOTE"']);
    expect(chooseTool('merge', null, [], true)?.configArgs).toContain('mergetool.forklift-vscode.trustExitCode=false');
  });
});

describe('normalizeRepoRelative', () => {
  it('accepts paths inside the repository in git form', () => {
    expect(normalizeRepoRelative('src/./a.ts')).toBe('src/a.ts');
    expect(normalizeRepoRelative('src\\win\\b.ts')).toBe('src/win/b.ts');
  });

  it.each(['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows\\x', '.', ''])('rejects %j', (path) => {
    expect(() => normalizeRepoRelative(path)).toThrow();
  });
});

// Integration: real git with fake tools configured in the repo; they record what git handed them.
describe.skipIf(process.platform === 'win32')('DiffTools with git', () => {
  const env = { GIT_AUTHOR_NAME: 'A', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'A', GIT_COMMITTER_EMAIL: 'a@x', GIT_CONFIG_NOSYSTEM: '1' };
  const runner = directRunner();
  const git = new GitCli(runner);
  const tools = new DiffTools(git, runner);
  let root: string;
  const sh = (...args: string[]) => git.exec(args, { cwd: root, env, allowedExitCodes: [1] });

  beforeEach(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'forklift-difftool-')));
    await sh('init', '--initial-branch=main');
    writeFileSync(join(root, 'f*.txt'), 'base\n'); // a glob character in the name must stay literal
    writeFileSync(join(root, 'other.txt'), 'other\n');
    await sh('add', '.');
    await sh('commit', '-m', 'base');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('shows worktree and staged changes of exactly one file', async () => {
    await sh('config', 'diff.tool', 'fake');
    await sh('config', 'difftool.fake.cmd', `cat "$LOCAL" "$REMOTE" >> "${join(root, '.git', 'diff.out')}"`);

    writeFileSync(join(root, 'f*.txt'), 'staged\n');
    await sh('add', 'f*.txt');
    writeFileSync(join(root, 'f*.txt'), 'worktree\n');
    writeFileSync(join(root, 'other.txt'), 'changed too\n');

    await tools.diff(root, 'f*.txt', false);
    expect(readFileSync(join(root, '.git', 'diff.out'), 'utf8')).toBe('staged\nworktree\n');
    rmSync(join(root, '.git', 'diff.out'));

    await tools.diff(root, 'f*.txt', true);
    expect(readFileSync(join(root, '.git', 'diff.out'), 'utf8')).toBe('base\nstaged\n');
  });

  it('resolves a conflict through the merge tool', async () => {
    await sh('checkout', '-b', 'theirs');
    writeFileSync(join(root, 'f*.txt'), 'theirs\n');
    await sh('commit', '-am', 'theirs');
    await sh('checkout', 'main');
    writeFileSync(join(root, 'f*.txt'), 'ours\n');
    await sh('commit', '-am', 'ours');
    await sh('merge', 'theirs'); // conflicts, exit 1

    await sh('config', 'merge.tool', 'fake');
    await sh('config', 'mergetool.fake.cmd', 'cp "$REMOTE" "$MERGED"');
    await sh('config', 'mergetool.fake.trustExitCode', 'true');
    await sh('config', 'mergetool.keepBackup', 'false');

    await tools.merge(root, 'f*.txt');
    expect(readFileSync(join(root, 'f*.txt'), 'utf8')).toBe('theirs\n');
    const { stdout } = await sh('diff', '--name-only', '--diff-filter=U');
    expect(stdout).toBe('');
  });

  it('refuses to open the same file twice while the tool is open', async () => {
    await sh('config', 'diff.tool', 'slow');
    await sh('config', 'difftool.slow.cmd', 'sleep 1');
    writeFileSync(join(root, 'other.txt'), 'x\n');

    const first = tools.diff(root, 'other.txt', false);
    await expect(tools.diff(root, 'other.txt', false)).rejects.toThrow('already open');
    await first;
  });

  it('explains how to configure a tool when none is usable', async () => {
    // A PATH with git and the coreutils its scripts need, but no diff tools and no VS Code.
    const bin = join(root, '.git', 'bin');
    mkdirSync(bin);
    for (const tool of ['git', 'sh', 'basename', 'dirname', 'sed', 'uname', 'sort', 'ls', 'cat', 'tr', 'grep', 'expr']) {
      const target = execFileSync('sh', ['-c', `command -v ${tool}`]).toString().trim();
      symlinkSync(target, join(bin, tool));
    }
    const bareRunner = directRunner({ PATH: bin, HOME: root });
    const bare = new DiffTools(new GitCli(bareRunner), bareRunner);
    await expect(bare.pickTool(root, 'diff')).rejects.toThrow(DiffToolError);
    await expect(bare.pickTool(root, 'merge')).rejects.toThrow('git config --global merge.tool');
  });
});
