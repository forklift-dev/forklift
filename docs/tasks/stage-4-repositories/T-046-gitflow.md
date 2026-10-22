---
id: T-046
title: "Gitflow"
stage: 4 — Репозитории
status: todo
depends_on: [T-023, T-033]
updated: 2026-10-23
---

# T-046. Gitflow

## Цель

Gitflow: инициализация, start/finish для feature/release/hotfix, настройки префиксов — как в GitKraken (у них nodegit-flow).

## Контекст

- В GitKraken: Gitflow 113 строк (по `strings.json`); их реализация — ориентир по поведению, код свой.

## Этапы

- [ ] Конфигурация gitflow.* в git config
- [ ] start/finish через наши операции веток и merge (без зависимости от git-flow CLI)
- [ ] Панель Gitflow в левой панели
- [ ] Тесты сценариев

## Критерии готовности

- Полный цикл feature/release/hotfix проходит тестами и через UI
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Нюансы

- nodegit-flow (ISC) можно использовать как справочник поведения.

## Промт

```text
Реализуй задачу docs/tasks/stage-4-repositories/T-046-gitflow.md. Сначала прочитай docs/README.md (правила ночной работы),
docs/architecture.md и задачи из depends_on. Если зависимость не готова — возьми другую задачу.
Следуй существующим паттернам (типизированный IPC, GitCli, ProcessRunner, тесты на временных репозиториях,
сквозной набор через tests/e2e). Решения, требующие владельца, не принимай: статус blocked + вопрос в «Нюансах».
По итогу: чеклист, нюансы с датой, статус review, строка в docs/README.md, коммит.
```
