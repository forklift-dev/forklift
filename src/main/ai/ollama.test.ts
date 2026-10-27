import { describe, expect, it, vi } from 'vitest';
import type { Runner } from '../process/types';
import { askOllama } from './ollama';

const request = { repo: '/repo', task: 'message' as const, model: 'local-model' };
const localModels = { models: [{ name: 'local-model:latest', size: 1_000_000 }] };

describe('local AI assistance', () => {
  it('sends only the staged diff to the loopback Ollama API', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: 'diff --git a/a.ts b/a.ts\n+fixed\n', code: 0 }) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValueOnce(Response.json(localModels)).mockResolvedValueOnce(Response.json({ response: 'Fix handling of a.ts' })) as unknown as typeof fetch;
    expect(await askOllama(runner, 'git', request, send)).toBe('Fix handling of a.ts');
    expect(runner.run).toHaveBeenCalledWith('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--', '.'], expect.objectContaining({ cwd: '/repo' }));
    expect(send).toHaveBeenCalledWith('http://127.0.0.1:11434/api/generate', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(vi.mocked(send).mock.calls[1]![1]!.body as string) as { prompt: string; stream: boolean };
    expect(body.prompt).toContain('+fixed');
    expect(body.stream).toBe(false);
  });

  it('does not contact Ollama when the staged diff is empty', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: '', code: 0 }) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValue(Response.json(localModels)) as unknown as typeof fetch;
    await expect(askOllama(runner, 'git', request, send)).rejects.toThrow('no staged changes');
    expect(send).not.toHaveBeenCalledWith('http://127.0.0.1:11434/api/generate', expect.anything());
  });

  it('includes all three conflict sides and keeps the path as one git argument', async () => {
    const runner = { run: vi.fn().mockResolvedValueOnce({ stdout: 'base', code: 0 }).mockResolvedValueOnce({ stdout: 'ours', code: 0 }).mockResolvedValueOnce({ stdout: 'theirs', code: 0 }) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValueOnce(Response.json(localModels)).mockResolvedValueOnce(Response.json({ response: 'Take the new branch with the fix.' })) as unknown as typeof fetch;
    await askOllama(runner, 'git', { ...request, task: 'conflict', path: 'a file.ts' }, send);
    expect(runner.run).toHaveBeenCalledWith('git', ['show', ':2:a file.ts'], expect.objectContaining({ cwd: '/repo' }));
    const body = JSON.parse(vi.mocked(send).mock.calls[1]![1]!.body as string) as { prompt: string };
    expect(body.prompt).toContain('BASE:\nbase\nOURS:\nours\nTHEIRS:\ntheirs');
  });

  it('refuses a cloud model before reading repository content', async () => {
    const runner = { run: vi.fn() } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValue(Response.json({ models: [{ name: 'remote:cloud', size: 0, remote_host: 'https://ollama.com' }] })) as unknown as typeof fetch;
    await expect(askOllama(runner, 'git', { ...request, model: 'remote:cloud' }, send)).rejects.toThrow('downloaded local');
    expect(runner.run).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
