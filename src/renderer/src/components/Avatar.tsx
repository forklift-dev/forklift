import { useEffect, useSyncExternalStore } from 'react';
import { colorIndex, initials, MAX_AVATAR_REQUEST } from '../../../shared/avatars';
import { invoke } from '../api';
import { useAppState } from '../state';

// Gravatar pictures asked from main in batches (the graph renders many rows at once); null: none, use initials.
const pictures = new Map<string, string | null>();
const wanted = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  const batch = [...wanted].slice(0, MAX_AVATAR_REQUEST);
  for (const email of batch) wanted.delete(email);
  if (wanted.size) timer = setTimeout(flush, 30);
  const settle = (found: Record<string, string>) => {
    for (const email of batch) pictures.set(email, found[email] ?? null);
    for (const listener of listeners) listener();
  };
  void invoke('avatars:get', batch).then(settle, () => settle({}));
}

function request(email: string): void {
  if (pictures.has(email) || wanted.has(email)) return;
  wanted.add(email);
  timer ??= setTimeout(flush, 30);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** A round picture of the author: the Gravatar one when that is turned on and exists, else initials in the email's color. */
export function Avatar({ name, email, size = 18 }: { name: string; email: string; size?: number }) {
  const gravatar = useAppState((s) => s.settings.values['ui.gravatar']);
  const picture = useSyncExternalStore(subscribe, () => (gravatar && email ? pictures.get(email) : null));
  useEffect(() => {
    if (picture === undefined) request(email);
  }, [picture, email]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };
  if (picture) return <img className="avatar" src={picture} alt="" style={style} />;
  return (
    <span className={`avatar initials lane-${colorIndex(email || name)}`} style={style} aria-hidden="true">
      {initials(name, email)}
    </span>
  );
}
