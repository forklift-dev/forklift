---
id: T-034
title: "Интерактивный rebase"
stage: 3 — История и операции над коммитами
status: todo
depends_on: [T-033]
updated: 2026-10-23
---

# T-034. Интерактивный rebase

## Цель

Интерактивный rebase в UI: список коммитов с действиями pick/reword/squash/fixup/drop, перетаскивание для изменения порядка, редактирование сообщений.

## Контекст

- В GitKraken: InteractiveRebase 25 строк; GitSequenceEditor в app.asar.unpacked (по `strings.json`); их реализация — ориентир по поведению, код свой.

## Этапы

- [ ] Запуск: «Interactive rebase from here» в графе
- [ ] Свой `GIT_SEQUENCE_EDITOR` (скрипт, получающий план из приложения через IPC-мост, как askpass) или `git rebase -i` с подготовленным todo
- [ ] Reword/squash: редактирование сообщений в окне приложения (свой `GIT_EDITOR`)
- [ ] Конфликты посреди rebase → T-025; продолжить/прервать
- [ ] Тесты: переупорядочивание, squash, fixup, drop, reword, конфликт

## Критерии готовности

- Сценарии проходят тестами; запущенный rebase можно продолжить и после перезапуска приложения
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Нюансы

- GitKraken использует свой `GitSequenceEditor.sh` + `GitSequenceEditorClient.js` (src/js/redux/domain/Rebase) — идею можно повторить своим кодом.

## Промт

```text
Реализуй задачу docs/tasks/stage-3-history/T-034-interactive-rebase.md. Сначала прочитай docs/README.md (правила ночной работы),
docs/architecture.md и задачи из depends_on. Если зависимость не готова — возьми другую задачу.
Следуй существующим паттернам (типизированный IPC, GitCli, ProcessRunner, тесты на временных репозиториях,
сквозной набор через tests/e2e). Решения, требующие владельца, не принимай: статус blocked + вопрос в «Нюансах».
По итогу: чеклист, нюансы с датой, статус review, строка в docs/README.md, коммит.
```
