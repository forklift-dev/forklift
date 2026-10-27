import { describe, expect, it, vi } from 'vitest';
import type { Runner } from '../process/types';
import { askAi } from './assist';

const request = { repo: '/repo', task: 'message' as const, provider: 'ollama' as const, model: 'local-model' };
const localModels = { models: [{ name: 'local-model:latest', size: 1_000_000 }] };

describe('local AI assistance', () => {
  it('sends only the staged diff to the loopback Ollama API', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: 'diff --git a/a.ts b/a.ts\n+fixed\n', code: 0 }) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValueOnce(Response.json(localModels)).mockResolvedValueOnce(Response.json({ response: 'Fix handling of a.ts' })) as unknown as typeof fetch;
    expect(await askAi(runner, 'git', request, send)).toBe('Fix handling of a.ts');
    expect(runner.run).toHaveBeenCalledWith('git', ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--', '.'], expect.objectContaining({ cwd: '/repo' }));
    expect(send).toHaveBeenCalledWith('http://127.0.0.1:11434/api/generate', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(vi.mocked(send).mock.calls[1]![1]!.body as string) as { prompt: string; stream: boolean };
    expect(body.prompt).toContain('+fixed');
    expect(body.stream).toBe(false);
  });

  it('does not contact Ollama when the staged diff is empty', async () => {
    const runner = { run: vi.fn().mockResolvedValue({ stdout: '', code: 0 }) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValue(Response.json(localModels)) as unknown as typeof fetch;
    await expect(askAi(runner, 'git', request, send)).rejects.toThrow('no staged changes');
    expect(send).not.toHaveBeenCalledWith('http://127.0.0.1:11434/api/generate', expect.anything());
  });

  it('includes all three conflict sides and keeps the path as one git argument', async () => {
    const runner = { run: vi.fn().mockResolvedValueOnce({ stdout: 'base', code: 0 }).mockResolvedValueOnce({ stdout: 'ours', code: 0 }).mockResolvedValueOnce({ stdout: 'theirs', code: 0 }) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValueOnce(Response.json(localModels)).mockResolvedValueOnce(Response.json({ response: 'Take the new branch with the fix.' })) as unknown as typeof fetch;
    await askAi(runner, 'git', { ...request, task: 'conflict', path: 'a file.ts' }, send);
    expect(runner.run).toHaveBeenCalledWith('git', ['show', ':2:a file.ts'], expect.objectContaining({ cwd: '/repo' }));
    const body = JSON.parse(vi.mocked(send).mock.calls[1]![1]!.body as string) as { prompt: string };
    expect(body.prompt).toContain('BASE:\nbase\nOURS:\nours\nTHEIRS:\ntheirs');
  });

  it('refuses a cloud model before reading repository content', async () => {
    const runner = { run: vi.fn() } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValue(Response.json({ models: [{ name: 'remote:cloud', size: 0, remote_host: 'https://ollama.com' }] })) as unknown as typeof fetch;
    await expect(askAi(runner, 'git', { ...request, model: 'remote:cloud' }, send)).rejects.toThrow('downloaded local');
    expect(runner.run).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('external AI assistance', () => {
  const diff = { stdout: 'diff --git a/a.ts b/a.ts\n+fixed\n', code: 0, truncated: false };

  it('sends a confirmed request to OpenAI without storing the response', async () => {
    const runner = { run: vi.fn().mockResolvedValue(diff) } as unknown as Pick<Runner, 'run'>;
    const send = vi.fn().mockResolvedValue(Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Fix the bug' }] }] })) as unknown as typeof fetch;
    expect(await askAi(runner, 'git', { ...request, provider: 'openai', model: 'gpt-test', apiKey: 'secret-key' }, send)).toBe('Fix the bug');
    const [url, options] = vi.mocked(send).mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options?.headers).toEqual(expect.objectContaining({ authorization: 'Bearer secret-key' }));
    expect(JSON.parse(options?.body as string)).toEqual(expect.objectContaining({ store: false, model: 'gpt-test' }));
  });

  it.each(['codex', 'claude', 'opencode', 'qwen'] as const)('runs %s without a shell from a temporary directory', async (provider) => {
    const runner = { run: vi.fn().mockResolvedValueOnce(diff).mockResolvedValueOnce({ stdout: 'A useful answer', code: 0, truncated: false }) } as unknown as Pick<Runner, 'run'>;
    expect(await askAi(runner, 'git', { ...request, provider, model: '' })).toBe('A useful answer');
    const [command, args, options] = vi.mocked(runner.run).mock.calls[1]!;
    expect(command).toBe(provider);
    expect(args).not.toContain('/repo');
    expect(options?.cwd).toMatch(/forklift-ai-/);
    expect(options?.cwd).not.toBe('/repo');
    if (provider !== 'opencode') expect(options?.input).toContain('+fixed');
  });
});
