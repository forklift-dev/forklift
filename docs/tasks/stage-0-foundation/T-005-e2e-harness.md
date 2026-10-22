---
id: T-005
title: "Сквозные проверки в репозитории"
stage: 0 — Фундамент
status: review
depends_on: [T-001]
updated: 2026-10-23
---

# T-005. Сквозные проверки в репозитории

## Цель

Перенести сквозные проверки (сейчас во временной папке) в репозиторий: общий харнесс запуска Electron с CDP и инспектором, изолированный профиль и HOME, `npm run test:e2e`. Без этого ночная работа не сможет надёжно ловить регрессии.

## Этапы

- [x] `tests/e2e/harness.mjs`: запуск (dev-сборка или `E2E_BINARY`), изолированные `XDG_CONFIG_HOME`/HOME, xvfb + `--ozone-platform=x11`, CDP страницы и инспектор main, сбор ошибок консоли
- [x] Перенести наборы: базовый UI, ProcessRunner, shell env, внешние инструменты, diff/merge tools, встроенный diff, индексация и коммит
- [x] Помощники: создание временных репозиториев, клики мышью по элементу, ввод текста, ожидание условий, нормализация NBSP Monaco
- [x] `npm run test:e2e` (все наборы) и `npm run test:e2e -- <набор>`; скриншоты при падении
- [x] Не трогать запущенный у владельца экземпляр (свой профиль — блокировка единственного экземпляра)

## Критерии готовности

- `npm run test:e2e` проходит целиком на Linux; каждый новый UI-функционал добавляет свой набор
- Юнит/интеграционные тесты, `npm run typecheck`, `lint`, `test`, сквозной набор в `npm run test:e2e` — зелёные

## Как пользоваться (2026-10-23)

```sh
npm run test:e2e                         # сборка (electron-vite build) + все наборы
npm run test:e2e -- staging diff-view    # выбранные наборы
npm run test:e2e -- --no-build smoke     # без пересборки
E2E_BINARY=dist/linux-unpacked/forklift npm run test:e2e   # упакованная сборка (после npm run dist)
E2E_HEADED=1 npm run test:e2e            # окна на текущем дисплее вместо Xvfb
E2E_SCREENSHOTS=1 npm run test:e2e       # сохранить обзорные скриншоты в tests/e2e/artifacts
```

Набор — файл `tests/e2e/suites/<имя>.mjs`: `export default async function ({ check, artifactsDir })` и
необязательный `export const meta = { requiresMain, platforms, allowConsoleProblems }`. Харнесс:
`launchApp({ env, baseEnv, inspect, page })` → `{ page, main, home, logs, close }`; `page`/`main` — `CdpSession`
(`evaluate`, `invoke`, `waitFor`, `click` настоящей мышью, `insertText`, `press`, `text` с заменой NBSP, `screenshot`);
`createRepo()` → `{ root, git, write }`; `tempDir()`, `defer()` — всё временное удаляется после набора.

## Нюансы

- Monaco рендерит пробелы как U+00A0; клики по Monaco — только настоящими событиями мыши (CDP Input).
- 2026-10-23: у каждого запуска свои HOME и `XDG_CONFIG_HOME` во временной папке — блокировка единственного
  экземпляра и профиль Electron не пересекаются с запущенным `npm run dev`, глобальный git config пользователя
  (хуки, подпись) не влияет. `FORKLIFT_SHELL_ENV=off` по умолчанию; набор shell-env включает его сам.
- 2026-10-23: порты CDP и инспектора — свободные случайные (`listen(0)`), наборы можно запускать параллельно
  с другими копиями приложения.
- 2026-10-23: на Linux раннер сам перезапускается под `xvfb-run -a` (окна не появляются на рабочем столе владельца
  и не забирают фокус); без xvfb и без DISPLAY — понятная ошибка.
- 2026-10-23: раннер автоматически добавляет к каждому набору проверку «нет ошибок консоли/CSP» для каждого
  запущенного окна; при падении — скриншоты всех окон набора в `tests/e2e/artifacts/` (в .gitignore) и хвост лога.
- 2026-10-23: упакованная сборка (`E2E_BINARY`) не принимает `--inspect` (fuses) и не выставляет `forkliftDebug`;
  наборы с `requiresMain` (process-runner, shell-env) пропускаются, diff-merge-tools пропускает только проверку выбора
  инструмента. Итог на сборке 2026-10-23: 4/4 + 3 пропущено; в dev — 7/7.
- 2026-10-23: наборы с фальшивыми программами на `sh` (external-tools, diff-merge-tools, process-runner, shell-env)
  помечены `platforms` (Linux/macOS); для Windows их нужно будет дописать вместе с T-003.
- 2026-10-23: проверка выбора diff-инструмента без настроек теперь не зависит от машины (принимает detected/vscode/
  «нет инструмента»): HOME временный, а набор программ на машине CI заранее неизвестен.

## Промт

```text
Реализуй задачу docs/tasks/stage-0-foundation/T-005-e2e-harness.md. Сначала прочитай docs/README.md (правила ночной работы),
docs/architecture.md и задачи из depends_on. Если зависимость не готова — возьми другую задачу.
Следуй существующим паттернам (типизированный IPC, GitCli, ProcessRunner, тесты на временных репозиториях,
сквозной набор через tests/e2e). Решения, требующие владельца, не принимай: статус blocked + вопрос в «Нюансах».
По итогу: чеклист, нюансы с датой, статус review, строка в docs/README.md, коммит.
```
