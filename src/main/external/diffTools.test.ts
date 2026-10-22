import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitCli } from '../git/cli';
import { directRunner } from '../process/testing';
import { normalizeRepoRelative } from '../repoPaths';
import { chooseTool, DiffToolError, DiffTools, gitToolCommand, parseToolHelp } from './diffTools';

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

describe.skipIf(process.platform === 'win32')('gitToolCommand', () => {
  // git evaluates the command with sh, the variables set to the temporary files.
  const evaluate = (cmd: string) =>
    execFileSync('sh', ['-c', 'eval "$CMD"'], { env: { CMD: cmd, LOCAL: '/tmp/a b', REMOTE: '/tmp/$x' } }).toString().split('\n').slice(0, -1);

  it('quotes arguments and keeps only the tool variables live', () => {
    const args = ['--left=$LOCAL', '$REMOTE', '$(touch pwned)', '`id`', 'a"b\\c', '$HOME', '$LOCALX', "it's"];
    expect(evaluate(gitToolCommand('printf', ['%s\\n', ...args]))).toEqual(['--left=/tmp/a b', '/tmp/$x', '$(touch pwned)', '`id`', 'a"b\\c', '$HOME', '$LOCALX', "it's"]);
    expect(gitToolCommand('/opt/My Tool/bin/tool', ['$MERGED'])).toBe('"/opt/My Tool/bin/tool" "$MERGED"');
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

  it('runs a custom command from settings with the files git prepares', async () => {
    const out = join(root, '.git', 'custom.out');
    const script = join(root, '.git', 'my diff');
    writeFileSync(script, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${out}"\ncat "$2" >> "${out}"\n`, { mode: 0o755 });
    writeFileSync(join(root, 'other.txt'), 'changed\n');

    const tool = await tools.diff(root, 'other.txt', false, { mode: 'custom', command: script, args: ['--title=a b', '$REMOTE', '$(id)'], trustExitCode: false });
    expect(tool).toMatchObject({ name: 'forklift-custom', source: 'settings' });
    const lines = readFileSync(out, 'utf8').split('\n');
    expect(lines[0]).toBe('--title=a b');
    expect(lines[1]).toMatch(/other\.txt$/);
    expect(lines[2]).toBe('$(id)');
    expect(lines[3]).toBe('changed');
  });

  it('merges with a custom command; trustExitCode decides on failure', async () => {
    await sh('checkout', '-b', 'theirs');
    writeFileSync(join(root, 'other.txt'), 'theirs\n');
    await sh('commit', '-am', 'theirs');
    await sh('checkout', 'main');
    writeFileSync(join(root, 'other.txt'), 'ours\n');
    await sh('commit', '-am', 'ours');
    await sh('merge', 'theirs');
    await sh('config', 'mergetool.keepBackup', 'false');

    await expect(tools.merge(root, 'other.txt', { mode: 'custom', command: 'false', args: [], trustExitCode: true })).rejects.toThrow();
    expect((await sh('diff', '--name-only', '--diff-filter=U')).stdout.trim()).toBe('other.txt');
    await tools.merge(root, 'other.txt', { mode: 'custom', command: 'cp', args: ['$REMOTE', '$MERGED'], trustExitCode: true });
    expect(readFileSync(join(root, 'other.txt'), 'utf8')).toBe('theirs\n');
    expect((await sh('diff', '--name-only', '--diff-filter=U')).stdout.trim()).toBe('');
  });

  it('uses a git tool named in settings over git config, and checks custom commands exist', async () => {
    await sh('config', 'diff.tool', 'fake');
    expect(await tools.pickTool(root, 'diff', { mode: 'tool', name: 'meld' })).toEqual({ name: 'meld', configArgs: [], source: 'settings' });
    expect((await tools.pickTool(root, 'diff')).name).toBe('fake');
    await expect(tools.pickTool(root, 'merge', { mode: 'custom', command: 'no-such-tool', args: [], trustExitCode: false })).rejects.toThrow(/Merge tool command "no-such-tool" was not found/);
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
