import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TaskWorkspace, TaskWorkspaceCreate } from '../../shared/taskWorkspaces';
import { t } from '../../shared/i18n';
import type { WorktreeService } from '../git/worktrees';

type WorkspaceFile = Record<string, TaskWorkspace[]>;

/** User-local labels and notes for Git worktrees. No task commands are executed. */
export class TaskWorkspaceService {
  constructor(private readonly worktrees: WorktreeService, private readonly filePath: string) {}

  async list(root: string): Promise<TaskWorkspace[]> {
    const entries = (await this.read())[resolve(root)] ?? [];
    const availablePaths = new Set((await this.worktrees.list(root)).map((tree) => tree.path));
    return entries.filter((workspace) => availablePaths.has(workspace.path));
  }

  async create(root: string, input: TaskWorkspaceCreate): Promise<TaskWorkspace> {
    const name = input.name.trim();
    const branch = input.branch.trim();
    if (!name || name.length > 120 || /[\0\r\n]/.test(name)) throw new TypeError(t('Enter a task name (up to 120 characters)'));
    if (!branch || branch.length > 255) throw new TypeError(t('Enter a branch name'));
    const path = resolve(input.path);
    const duplicate = (await this.list(root)).some((workspace) => workspace.path === path || workspace.branch === branch);
    if (duplicate) throw new TypeError(t('A task workspace already uses this path or branch'));
    await this.worktrees.add(root, { path, branch: null, newBranch: branch });
    const workspace = { id: randomUUID(), name, branch, path, note: '' };
    const all = await this.read();
    all[resolve(root)] = [...(all[resolve(root)] ?? []), workspace];
    await this.write(all);
    return workspace;
  }

  async updateNote(root: string, id: string, note: string): Promise<void> {
    if (note.length > 20_000 || /\0/.test(note)) throw new TypeError(t('Task notes are limited to 20,000 characters'));
    const all = await this.read();
    const key = resolve(root);
    const items = all[key] ?? [];
    const index = items.findIndex((workspace) => workspace.id === id);
    if (index < 0) throw new TypeError(t('Task workspace not found'));
    items[index] = { ...items[index]!, note };
    all[key] = items;
    await this.write(all);
  }

  private async read(): Promise<WorkspaceFile> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as WorkspaceFile : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  private async write(data: WorkspaceFile): Promise<void> {
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
