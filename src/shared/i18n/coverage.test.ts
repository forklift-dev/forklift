import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../keybindings';
import { SETTING_FIELDS, SETTINGS_SECTIONS } from '../settings';
import { BUILTIN_THEMES } from '../themes';
import { RU } from './strings';
import { LANGUAGE_REGISTRY, messageId } from './index';

/** Shown by their own name in every language. */
const LANGUAGE_NAMES = new Set(LANGUAGE_REGISTRY.map(({ name }) => name));

/** Text from schemas, shown through translate(): each needs a translation as much as a t() message does. */
function schemaTexts(): string[] {
  const texts: string[] = [...Object.values(SETTINGS_SECTIONS)];
  for (const field of Object.values(SETTING_FIELDS)) {
    texts.push(field.label);
    if ('description' in field && field.description) texts.push(field.description);
    if (field.type === 'enum') texts.push(...field.options.map((option) => option.label).filter((label) => !LANGUAGE_NAMES.has(label)));
  }
  for (const command of COMMANDS) texts.push(command.title, command.category);
  texts.push(...BUILTIN_THEMES.map((theme) => theme.name));
  return [...new Set(texts)];
}

describe('schema texts', () => {
  it('all have a Russian translation', () => {
    const missing = schemaTexts().filter((text) => {
      const id = messageId(text);
      return id === undefined || !(id in RU);
    });
    expect(missing).toEqual([]);
  });
});
