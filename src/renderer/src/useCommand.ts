import { useEffect, useState } from 'react';
import type { CommandArgs, CommandName, CommandResult } from '../../shared/ipc';
import { invoke } from './api';

export interface CommandState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

interface Settled<T> {
  key: string;
  data?: T;
  error: string | null;
}

/**
 * Runs a query command whenever its arguments (or `reloadKey`) change; replies to outdated
 * requests are ignored. `channel: null` disables it. With `keepPrevious`, the last result stays
 * visible while a reload is in flight (for views that are remounted when their subject changes).
 */
export function useCommand<K extends CommandName>(
  channel: K | null,
  args: CommandArgs<K>,
  options: { reloadKey?: unknown; keepPrevious?: boolean } = {},
): CommandState<CommandResult<K>> {
  const key = channel === null ? null : JSON.stringify([channel, args, options.reloadKey ?? null]);
  const [settled, setSettled] = useState<Settled<CommandResult<K>> | null>(null);

  useEffect(() => {
    if (key === null) return;
    const [name, requestArgs] = JSON.parse(key) as [K, CommandArgs<K>];
    let current = true;
    invoke(name, ...requestArgs).then(
      (data) => current && setSettled({ key, data, error: null }),
      (error: unknown) => current && setSettled({ key, error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [key]);

  const fresh = settled?.key === key ? settled : null;
  const shown = fresh ?? (options.keepPrevious ? settled : null);
  return { data: shown?.data, error: shown?.error ?? null, loading: key !== null && fresh === null };
}
