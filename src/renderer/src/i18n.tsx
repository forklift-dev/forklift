import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { currentLanguage, resolveLanguage, setLanguage, t, type Message, type Params } from '../../shared/i18n';
import { getState, subscribe } from './state';

/**
 * Follows the language setting. Subscribed before any component, so the language is switched before they
 * render again; the app's root re-renders on a change (useLanguage), and with it every component.
 */
export function startLanguage(): void {
  const apply = () => {
    const language = resolveLanguage(getState().settings.values['ui.language'], [navigator.language]);
    if (language === currentLanguage()) return;
    setLanguage(language);
    document.documentElement.lang = language;
  };
  apply();
  document.documentElement.lang = currentLanguage();
  subscribe(apply);
}

/** The current language; the component re-renders when it changes. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, currentLanguage);
}

/**
 * A message with elements in it: `{name}` placeholders are replaced by `parts.name` (text or elements),
 * e.g. tx('Open {link} to continue', { link: <a …>the settings</a> }).
 */
export function tx(message: Message, parts: Readonly<Record<string, ReactNode>>, params?: Params): ReactNode {
  const text = t(message, params);
  const pieces = text.split(/\{(\w+)\}/g);
  return pieces.map((piece, index) => <Fragment key={index}>{index % 2 ? (piece in parts ? parts[piece] : `{${piece}}`) : piece}</Fragment>);
}
