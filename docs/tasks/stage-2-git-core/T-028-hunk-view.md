---
id: T-028
title: Hunk View и File View
stage: 2 — Основная работа внутри приложения
status: todo
depends_on: [T-021]
updated: 2026-10-23
---

# T-028. Hunk View и File View

## Цель

Режимы просмотра, как в GitKraken: **Hunk View** — только изменённые фрагменты с заголовками
(`@@ -a,b +c,d @@`) и кнопками Stage/Unstage/Discard у каждого; **File View** — файл целиком с подсветкой
изменённых строк (без второй панели).

## Контекст

- В GitKraken: Diff View / File View / Hunk View / Inline / Split (`strings.json`: FileViewPanel-*).
- Сейчас роль Hunk View выполняет «Collapse unchanged» Monaco; действия над фрагментами — иконки в «желобе» (T-021).

## Этапы

- [ ] Переключатель режима: Split / Inline / Hunk / File (сохраняется в настройках)
- [ ] Hunk: фрагменты из line changes Monaco, заголовки с номерами строк, кнопки действий, контекст 3 строки
- [ ] File: одна панель Monaco, декорации добавленных/изменённых строк, маркеры удалений
- [ ] Выделение строк и действия T-021 работают во всех режимах
- [ ] Сквозной набор в tests/e2e

## Критерии готовности

- Все режимы показывают одинаковые изменения; индексация из любого режима даёт одинаковый результат
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, `npm run test:e2e` — зелёные

## Нюансы

- (дописывать по ходу работы с датой)

## Промт

```text
Реализуй docs/tasks/stage-2-git-core/T-028-hunk-view.md на базе DiffView (T-020/T-021). Следуй правилам из docs/README.md.
```
