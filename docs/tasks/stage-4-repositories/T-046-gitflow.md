---
id: T-046
title: "Gitflow"
stage: 4 — Репозитории
status: review
depends_on: [T-023, T-033]
updated: 2026-10-23
---

# T-046. Gitflow

## Цель

Gitflow: инициализация, start/finish для feature/release/hotfix, настройки префиксов — как в GitKraken (у них nodegit-flow).

## Контекст

- В GitKraken: Gitflow 113 строк (по `strings.json`); их реализация — ориентир по поведению, код свой.

## Этапы

- [x] Конфигурация gitflow.* в git config
- [x] start/finish через наши операции веток и merge (без зависимости от git-flow CLI)
- [x] Панель Gitflow в левой панели
- [x] Тесты сценариев

## Критерии готовности

- Полный цикл feature/release/hotfix проходит тестами и через UI
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Нюансы

- nodegit-flow (ISC) можно использовать как справочник поведения.
- 2026-10-23: настройки — в git config репозитория, ключи как у git-flow (`gitflow.branch.master|develop`,
  `gitflow.prefix.feature|release|hotfix|versiontag`), так что git-flow CLI и GitKraken видят ту же настройку.
  Setup создаёт develop из production, если его нет.
- 2026-10-23: start — ветка `<префикс><имя>` от develop (hotfix — от production) и checkout; второй незаконченный
  release/hotfix не начинается. finish (только при чистом дереве): feature → `merge --no-ff` в develop; release и
  hotfix → `merge --no-ff` в production, аннотированный тег `<префикс тега><версия>` (сообщение по умолчанию
  «Release x» / «Hotfix x»), затем тег вливается обратно в develop (как back-merge у git-flow AVH); ветка
  удаляется (`branch -d`), если не выбрано «Keep the branch»; в конце checkout develop.
- 2026-10-23: каждый шаг finish пропускается, если уже сделан (ветка уже в целевой, тег есть): при конфликте
  merge остаётся в репозитории (баннер операции), после разрешения и коммита тот же Finish доделывает остальное.
  Особый случай git-flow «hotfix при открытом release вливается в release, а не в develop» не сделан.
- 2026-10-23: UI — раздел GITFLOW в левой панели («Set up Gitflow…», «+» со Start feature/release/hotfix и
  настройками, открытые ветки с Finish/Check out/Delete) и команды палитры (Set up, Start…, Finish the current…).
- 2026-10-23: проверено: юнит-тесты (`gitflow.test.ts`: setup, полный цикл feature/release/hotfix, keep branch,
  конфликт и повторный finish, отказы) и сквозной набор `gitflow` (8 проверок через UI и палитру).

## Промт

```text
Реализуй задачу docs/tasks/stage-4-repositories/T-046-gitflow.md. Сначала прочитай docs/README.md (правила ночной работы),
docs/architecture.md и задачи из depends_on. Если зависимость не готова — возьми другую задачу.
Следуй существующим паттернам (типизированный IPC, GitCli, ProcessRunner, тесты на временных репозиториях,
сквозной набор через tests/e2e). Решения, требующие владельца, не принимай: статус blocked + вопрос в «Нюансах».
По итогу: чеклист, нюансы с датой, статус review, строка в docs/README.md, коммит.
```
