import { useEffect, useState } from 'react';
import type { CheckoutTarget } from '../../../shared/branches';
import { fuzzyFilter } from '../../../shared/fuzzy';
import type { FoundCommit, HistoryFilter } from '../../../shared/history';
import { formatDate, t } from '../../../shared/i18n';
import type { FileChange, RepoData } from '../../../shared/state';
import { invoke } from '../api';
import { OPEN_COMMANDS_EVENT } from '../commands';
import { tx } from '../i18n';
import { Palette, type PaletteItem } from './Palette';

interface FinderProps {
  data: RepoData;
  filter: HistoryFilter;
  onClose(): void;
  onShowCommit(sha: string): void;
  onCheckout(target: CheckoutTarget): void;
  /** A changed file: its diff (or the conflict editor). */
  onOpenChange(change: FileChange): void;
  onFileHistory(path: string): void;
}

const date = (seconds: number) => formatDate(seconds * 1000, { year: 'numeric', month: 'numeric', day: 'numeric' });

// The working tree's file list, per repository, until it is read again on the next open.
const fileCache = new Map<string, { loadedAt: number; paths: string[] }>();

/** Ctrl+P: files, branches, tags and commits, matched fuzzily; "> " switches to commands. */
export function FinderPalette({ data, filter, onClose, onShowCommit, onCheckout, onOpenChange, onFileHistory }: FinderProps) {
  const repo = data.root;
  const [query, setQuery] = useState('');
  const cached = fileCache.get(repo);
  const [files, setFiles] = useState<string[]>(cached?.paths ?? data.changes.map((change) => change.path));
  const [commits, setCommits] = useState<{ text: string; found: FoundCommit[] }>({ text: '', found: [] });

  useEffect(() => {
    if (cached?.loadedAt === data.loadedAt) return;
    let current = true;
    void invoke('repo:files', repo).then(({ paths }) => {
      fileCache.set(repo, { loadedAt: data.loadedAt, paths });
      if (current) setFiles(paths);
    });
    return () => {
      current = false;
    };
  }, [repo, data.loadedAt, cached?.loadedAt]);

  const text = query.trim();
  useEffect(() => {
    if (text.length < 2 || text.startsWith('>')) return;
    let current = true;
    const timer = setTimeout(() => {
      void invoke('history:find', repo, data.historyVersion, filter, text).then(
        (found) => current && setCommits({ text, found }),
        () => current && setCommits({ text, found: [] }),
      );
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [repo, data.historyVersion, filter, text]);

  const onQuery = (next: string) => {
    if (next.startsWith('>')) {
      onClose();
      window.dispatchEvent(new CustomEvent(OPEN_COMMANDS_EVENT, { detail: next.slice(1).trimStart() }));
      return;
    }
    setQuery(next);
  };

  const changes = new Map(data.changes.map((change) => [change.path, change]));
  const fileItems: PaletteItem[] = fuzzyFilter(text, text ? files : data.changes.map((change) => change.path), (path) => path, text ? 20 : 10).map(({ item: path, positions }) => {
    const change = changes.get(path);
    return {
      key: `file:${path}`,
      group: t('Files'),
      icon: change ? 'diff' : 'file',
      label: path,
      positions,
      detail: change ? (change.kind === 'conflicted' ? t('conflict') : t('changed')) : undefined,
      run: ({ shift }) => (change && !shift ? onOpenChange(change) : onFileHistory(path)),
    };
  });
  const refItems: PaletteItem[] = fuzzyFilter(
    text,
    [
      ...data.branches.map((branch) => ({ kind: 'branch' as const, name: branch.name, sha: branch.sha, current: branch.current })),
      ...data.remoteBranches.map((branch) => ({ kind: 'remote' as const, name: branch.name, sha: branch.sha, remote: branch.remote, current: false })),
      ...data.tags.map((tag) => ({ kind: 'tag' as const, name: tag.name, sha: tag.sha, current: false })),
    ],
    (ref) => ref.name,
    text ? 15 : 8,
  ).map(({ item: ref, positions }) => ({
    key: `${ref.kind}:${ref.name}`,
    group: t('Branches and tags'),
    icon: ref.kind === 'tag' ? 'tag' : ref.kind === 'remote' ? 'cloud' : 'git-branch',
    label: ref.name,
    positions,
    detail: ref.current ? t('checked out') : ref.kind === 'tag' ? t('tag') : undefined,
    run: ({ shift }) => {
      if (shift && ref.kind === 'branch' && !ref.current) return onCheckout({ kind: 'branch', name: ref.name });
      if (shift && ref.kind === 'remote') return onCheckout({ kind: 'remote', name: ref.name, remote: (ref as { remote: string }).remote });
      onShowCommit(ref.sha);
    },
  }));
  const commitItems: PaletteItem[] =
    commits.text === text && text.length >= 2
      ? commits.found.map((commit) => ({
          key: `commit:${commit.sha}`,
          group: t('Commits'),
          icon: 'git-commit',
          label: commit.subject,
          positions: commit.positions,
          detail: `${commit.sha.slice(0, 7)} · ${commit.authorName} · ${date(commit.authorTime)}`,
          run: () => onShowCommit(commit.sha),
        }))
      : [];

  return (
    <Palette
      label={t('Go to')}
      placeholder={t('File, branch, tag or commit (type > for commands)')}
      query={query}
      onQuery={onQuery}
      items={[...fileItems, ...refItems, ...commitItems]}
      empty={t('Nothing matches')}
      // Commits for this text are still being looked up.
      busy={text.length >= 2 && commits.text !== text}
      footer={
        <>
          {tx('{enter} show · {shiftEnter} check out the branch, or the file’s history · {greater} commands', {
            enter: <kbd>Enter</kbd>,
            shiftEnter: <kbd>Shift+Enter</kbd>,
            greater: <kbd>&gt;</kbd>,
          })}
        </>
      }
      onClose={onClose}
    />
  );
}
