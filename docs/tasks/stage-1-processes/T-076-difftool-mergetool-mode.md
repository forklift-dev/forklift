---
id: T-076
title: "Forklift как git difftool и mergetool"
stage: 1 — Процессы и внешние программы
status: draft
depends_on: [T-014, T-072]
updated: 2026-10-26
---

# T-076. Forklift как git difftool и mergetool

## Цель

Предложение по итогам сравнения (2026-10-26): запускать Forklift из `git difftool` и `git mergetool` (и из других программ) отдельным окном diff/слияния, с командой `forklift setup` для настройки git. Так делает GitComet (совместимость с аргументами KDiff3/Meld, headless-режим).

## Контекст

- Встроенный diff (T-020) и редактор конфликтов (T-025/T-072); разбор argv — `src/main/repos/argv.ts`.

## Этапы

- [ ] Режимы `forklift difftool --local A --remote B [--path P]` и `forklift mergetool --base --local --remote --merged`
- [ ] Окно только с diff/слиянием, код выхода для git (`trustExitCode`)
- [ ] `forklift setup [--local] [--dry-run]` и `forklift uninstall` с сохранением прежних настроек git
- [ ] Совместимость с аргументами KDiff3/Meld

## Критерии готовности

- `git difftool`/`git mergetool` открывают Forklift и правильно завершаются
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Нюансы

- 2026-10-26: код GitComet (AGPL) не переносить — только интерфейс вызова git.

## Промт

```text
Реализуй задачу docs/tasks/stage-1-processes/T-076-difftool-mergetool-mode.md. Сначала прочитай docs/README.md, docs/design.md и задачи из depends_on.
Решения, требующие владельца, не принимай: статус blocked + вопрос в «Нюансах». По итогу: чеклист, нюансы с датой,
статус review, строка в docs/README.md, коммит.
```
