// Capture real Forklift windows for the README from a disposable Git history and app profile.
// Run after `npm run build`; on headless Linux: `xvfb-run -a node scripts/capture-readme.mjs`.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRepo, launchApp, projectDir, runCleanups, tempDir } from '../tests/e2e/harness.mjs';

const shots = join(projectDir, 'docs/images');
mkdirSync(shots, { recursive: true });

try {
  const { root, git, write } = createRepo({ dir: join(tempDir('forklift-readme-'), 'atlas') });
  const people = [
    ['Ada', 'ada@example.com'],
    ['Lin', 'lin@example.com'],
    ['Maya', 'maya@example.com'],
  ];
  let author = 0;
  const commit = (subject) => {
    git('add', '.');
    const [name, email] = people[author++ % people.length];
    execFileSync('git', ['commit', '-qm', subject], {
      cwd: root,
      env: {
        ...process.env,
        HOME: root,
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: name,
        GIT_COMMITTER_EMAIL: email,
        GIT_CONFIG_NOSYSTEM: '1',
      },
      stdio: 'pipe',
    });
  };

  write('README.md', '# Atlas\n\nA small app with a growing Git history.\n');
  commit('Start the Atlas workspace');
  write('src/main/repository.ts', 'export const repository = { name: "Atlas" };\n');
  commit('Open local repositories');
  const graphSource = `export interface CommitNode {
  hash: string;
  subject: string;
  parents: string[];
  lane: number;
}

export function layoutGraph(commits: CommitNode[]): CommitNode[] {
  const lanes = new Map<string, number>();
  const next: CommitNode[] = [];

  for (const commit of commits) {
    const lane = lanes.get(commit.hash) ?? lanes.size;
    for (const parent of commit.parents) {
      if (!lanes.has(parent)) lanes.set(parent, lane);
    }
    next.push({ ...commit, lane });
  }

  return next;
}
`;
  write('src/renderer/graph.ts', graphSource);
  commit('Draw the commit graph');
  write('src/renderer/diff.ts', 'export function changedLines() { return [1, 4]; }\n');
  commit('Show side-by-side diffs');
  write('src/main/staging.ts', 'export function stageLine(line: number) { return line; }\n');
  commit('Stage individual lines');
  git('switch', '-qc', 'feature/themes');
  write('src/renderer/themes.ts', 'export const themes = ["Dusk", "Dawn"];\n');
  commit('Add light and dark themes');
  write('src/renderer/contrast.ts', 'export function contrast() { return 4.5; }\n');
  commit('Check theme contrast');
  git('switch', '-q', 'main');
  write('src/main/history.ts', 'export function searchHistory(query: string) { return query; }\n');
  commit('Search commits and files');
  write('src/main/stash.ts', 'export function saveWorktree() { return true; }\n');
  commit('Keep changes safe when switching branches');
  write('src/renderer/conflicts.ts', 'export function resolveConflict() { return "resolved"; }\n');
  commit('Resolve merge conflicts visually');
  git('merge', '--no-ff', '-qm', 'Merge theme controls', 'feature/themes');
  write('src/main/undo.ts', 'export function undoOperation() { return true; }\n');
  commit('Undo Git operations');
  write('src/main/bisect.ts', 'export function bisectStep() { return "good"; }\n');
  commit('Find regressions with bisect');
  git('switch', '-qc', 'feature/worktrees');
  write('src/main/worktrees.ts', 'export function addWorktree() { return "side checkout"; }\n');
  commit('Open worktrees in separate tabs');
  write('src/renderer/terminal.ts', 'export function openTerminal() { return "ready"; }\n');
  commit('Add a built-in terminal');
  git('switch', '-q', 'main');
  write('src/main/remotes.ts', 'export function fetchRemote() { return "updated"; }\n');
  commit('Track remote branches');
  write('src/renderer/palette.ts', 'export function findCommand(query: string) { return query; }\n');
  commit('Find actions from the command palette');
  git('merge', '--no-ff', '-qm', 'Merge worktree workflow', 'feature/worktrees');
  write('src/renderer/release.ts', 'export const release = "0.4.1";\n');
  write('docs/CHANGELOG.md', '# 0.4.1\n\nGraph, diff, bisect, worktrees and themes.\n');
  commit('Prepare the 0.4.1 release');
  git('tag', 'v0.4.1');
  write('src/renderer/graph.ts', graphSource.replace('return next;', 'return next.filter((commit) => commit.subject.length > 0);'));
  write('src/renderer/theme-preview.ts', 'export const preview = "Dawn";\n');

  const { page } = await launchApp({ windowSize: '1440,760' });
  await page.invoke('repo:open', root);
  await page.waitFor(`document.querySelectorAll('.commit-row[data-hash]').length > 12`);
  await page.click(`[...document.querySelectorAll('.commit-row[data-hash]')].find(row => row.querySelector('.subject')?.textContent === 'Prepare the 0.4.1 release')`);
  await page.waitFor(`document.querySelector('.commit-details')?.textContent.includes('Prepare the 0.4.1 release')`);

  for (const [theme, file] of [
    ['forklift-dark', 'overview-dark.png'],
    ['dawn', 'overview-dawn.png'],
    ['fjord', 'overview-fjord.png'],
  ]) {
    await page.invoke('settings:update', { values: { 'ui.theme': theme } });
    await page.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`);
    await page.screenshot(join(shots, file));
    console.log(file);
  }

  await page.click(`document.querySelector('.commit-details .close-details')`);
  await page.waitFor(`!![...document.querySelectorAll('.change-item')].find(item => item.textContent.includes('graph.ts'))`);
  await page.click(`[...document.querySelectorAll('.change-item')].find(item => item.textContent.includes('graph.ts'))`);
  await page.waitFor(`!!document.querySelector('.monaco-diff-editor .editor.modified .view-lines')`);
  await page.invoke('settings:update', { values: { 'ui.theme': 'neon-night' } });
  await page.waitFor(`document.documentElement.dataset.theme === 'neon-night'`);
  await page.screenshot(join(shots, 'diff-neon-night.png'));
  console.log('diff-neon-night.png');
} finally {
  await runCleanups();
}
