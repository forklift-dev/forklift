# Документация Forklift

| Документ | Что внутри |
|---|---|
| [architecture.md](architecture.md) | Архитектура приложения и принятые решения |
| [research/gitkraken.md](research/gitkraken.md) | Что мы узнали, разбирая GitKraken Desktop 12.6.1 |
| [tasks/](tasks/) | Задачи по этапам, по файлу на задачу |

## Как устроены задачи

Каждая задача — отдельный файл `tasks/<этап>/T-NNN-<slug>.md` по шаблону [tasks/_template.md](tasks/_template.md):
метаданные (статус, зависимости), цель, этапы-чеклист, критерии готовности, нюансы и **промт** —
самодостаточное задание, которое можно отдать агенту (Claude Code) как есть.

### Статусы

| Статус | Значение |
|---|---|
| `draft` | Идея, не согласована. Перед работой — обсудить и перевести в `todo` или `dropped` |
| `todo` | Согласована, можно брать |
| `in-progress` | В работе |
| `review` | Сделано, ждёт проверки (запуск, ревью, решение владельца) |
| `done` | Проверено и принято |
| `blocked` | Ждёт другую задачу или внешнее решение (указать в «Нюансах») |
| `dropped` | Решили не делать (причину оставить в файле) |

При смене статуса обновлять поле `updated` и таблицу ниже. Нюансы, обнаруженные в работе, дописывать
в задачу сразу — это главная ценность этих файлов.

## Этапы и задачи

### Этап 0 — Фундамент

| ID | Задача | Статус |
|---|---|---|
| [T-001](tasks/stage-0-foundation/T-001-project-skeleton.md) | Каркас приложения | review |
| [T-002](tasks/stage-0-foundation/T-002-nodegit-electron-build.md) | Сборка nodegit из исходников под Electron 45 | done |
| [T-003](tasks/stage-0-foundation/T-003-ci-matrix.md) | CI: сборка и тесты на 6 платформах | todo |
| [T-004](tasks/stage-0-foundation/T-004-signing-notarization.md) | Подпись и нотаризация дистрибутивов | draft |

### Этап 1 — Процессы и внешние программы

| ID | Задача | Статус |
|---|---|---|
| [T-010](tasks/stage-1-processes/T-010-process-runner.md) | ProcessRunner на utilityProcess | review |
| [T-011](tasks/stage-1-processes/T-011-shell-env.md) | Окружение login-shell (PATH на macOS/Linux) | review |
| [T-012](tasks/stage-1-processes/T-012-git-cli.md) | Адаптер git CLI поверх ProcessRunner | review |
| [T-013](tasks/stage-1-processes/T-013-editor-terminal.md) | Открытие во внешнем редакторе и терминале | review |
| [T-014](tasks/stage-1-processes/T-014-diff-merge-tools.md) | Внешние diff/merge tools | review |

### Этап 2 — Основная работа внутри приложения

Решения владельца (2026-10-22): основные сценарии — внутри приложения, внешние программы (этап 1) — для
совместимости и настройки; встроенный терминал нужен; pull — merge и rebase; при переключении ветки — автоматический stash.

| ID | Задача | Статус |
|---|---|---|
| [T-020](tasks/stage-2-git-core/T-020-built-in-diff.md) | Детали коммита и встроенный diff | review |
| [T-021](tasks/stage-2-git-core/T-021-stage-commit.md) | Индексация (файлы, фрагменты, строки) и коммит | todo |
| [T-022](tasks/stage-2-git-core/T-022-commit-graph.md) | Граф коммитов и виртуализация списка | todo |
| [T-023](tasks/stage-2-git-core/T-023-branches.md) | Ветки и теги, переключение с автоматическим stash | todo |
| [T-024](tasks/stage-2-git-core/T-024-remote-sync.md) | Fetch, pull (merge и rebase), push; учётные данные в UI | todo |
| [T-025](tasks/stage-2-git-core/T-025-conflict-editor.md) | Встроенное разрешение конфликтов | todo |
| [T-026](tasks/stage-2-git-core/T-026-file-watching.md) | Слежение за файлами и автообновление | todo |
| [T-027](tasks/stage-2-git-core/T-027-embedded-terminal.md) | Встроенный терминал | todo |
