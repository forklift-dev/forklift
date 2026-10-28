# Translate Forklift

Forklift accepts interface translations through pull requests. You can improve an existing language or start a new one by editing JSON files; application code is not needed. The [Russian guide](translating.ru.md) covers the same steps.

## Choose a string

For a visual editor, run `npm ci` and `npm run translations:dev`, then open the local URL printed by Vite. The table shows English and existing translations side by side. Search by text or message ID, select a focus language, and use **Missing only** to find gaps. Add a language code and native name to create a column. Edits are saved in this browser; use **Download JSON** in that column to get a catalog. You can also import an existing catalog. The editor checks placeholders and plural forms before export. Keep a downloaded copy of your work, since browser storage is local to that browser and origin.

For a new language, place the downloaded `xx.json` in `src/shared/i18n/catalogs/` and add its code and native name to [`locales.json`](../src/shared/i18n/locales.json). Run `npm run i18n:check` before sending a pull request. The editor is also available as a static build with `npm run translations:build` (`dist/translator/`).

The English source is [`src/shared/i18n/catalogs/en.json`](../src/shared/i18n/catalogs/en.json). Find the text among its **values**, copy the `msg.…` ID beside it, then find that ID in the target catalog under `src/shared/i18n/catalogs/`. Change the **value**, never the ID. For example:

```json
"msg.19766ed6ccb2f4a3": "Abbrechen"
```

The [legacy key map](../src/shared/i18n/legacy.json) preserves context such as `action|Edit` and plain `Edit`; these have different IDs even when the visible English word is the same. If the meaning is unclear, mention the ID and screen in the PR so a maintainer can help. A wording change keeps its ID; a change of meaning needs a new ID.

## Edit or add a language

For an existing language, edit its catalog. Keep keys sorted alphabetically. English and Russian catalogs are complete; a new language may be partial. Missing messages display in English.

For a new language, add `{ "code": "xx", "name": "Native name" }` to [`locales.json`](../src/shared/i18n/locales.json), then create `src/shared/i18n/catalogs/xx.json`. Use a valid locale code such as `de` or `pt-BR`. The name is shown in the language selector as written. You may begin with a few translated keys; the partial German catalog is an example. The app discovers the new catalog automatically. Right-to-left layouts need a separate layout review before a language can be considered ready.

Keep these rules while translating:

- Preserve every `{placeholder}` exactly, including its spelling and braces. You may move it within the sentence. For example, `{name}` must stay `{name}`.
- For plural entries, translate the forms your language needs. `Intl.PluralRules` chooses among `zero`, `one`, `two`, `few`, `many`, and `other`; a missing form falls back to English. Check the categories for your language with `node -e "console.log(new Intl.PluralRules('xx').resolvedOptions().pluralCategories)"`, replacing `xx` with your code. Keep `{count}` in every form you provide.
- Leave product names, Git commands, paths, branch names, config keys, and code unchanged. Git's own output is outside the interface catalog. Follow the terminology already used in your language; see the [Russian glossary](i18n.md) as an example of a language-specific style guide.
- Translate a whole sentence naturally. Avoid concatenating fragments or changing punctuation only to match English word order.

## Check and preview

You can edit JSON in GitHub and let CI check your PR. For a local check, use the [build prerequisites](../README.md#build-from-source), then run:

```bash
npm ci
npm run i18n:check
npm run dev
```

`i18n:check` reports the catalog and ID for invalid JSON, duplicate or unknown IDs, missing English or Russian entries, changed placeholders, and invalid plural forms. Its coverage line counts entries and incomplete plural entries in each additional language. Run `npm run i18n:sync` only when adding a new English source string in application code; it is not needed for translation-only work.

In the running app, open Preferences with the gear or Ctrl+, and choose the language under **UI → Language**. Switch between your language and English without restarting. Check the screens you translated, especially dialogs, narrow windows, long labels, tooltips, and the language selector. For a new locale, also try the **System** option with that system language. A screenshot helps reviewers inspect layout.

## Send a pull request

Create a branch or fork, commit the catalog and optional `locales.json` change, and open a pull request to this repository. In the description include:

- Language code and whether it is new or an update.
- Which screens or groups of strings you translated, and any terminology that needs discussion.
- Result of `npm run i18n:check` or a note that CI will run it; screenshots for long or unusual text.

Maintainers review wording and context, confirm placeholders and plural forms, check CI, and inspect the affected screens for clipping and accessibility. They may ask for a native speaker to review wording. The translation can remain partial; reviewers will note the English fallback coverage. README and other documentation are separate Markdown files: propose changes to [`README.md`](../README.md), [`README.ru.md`](../README.ru.md), or `docs/` in a separate PR or clearly separate commit. Interface catalog changes do not translate those files automatically.

Reviewer checklist:

- [ ] The PR identifies its language, scope, and any terminology questions.
- [ ] `i18n:check` in CI passes; placeholders and plural forms match the source.
- [ ] Affected screens, long labels, and the language selector remain readable and accessible.
