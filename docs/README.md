# Документация Forklift

| Документ | Что внутри |
|---|---|
| [architecture.md](architecture.md) | Архитектура приложения и принятые решения |
| [design.md](design.md) | Дизайн интерфейса: раскладка по мотивам GitKraken, принципы |
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
| [T-003](tasks/stage-0-foundation/T-003-ci-matrix.md) | CI: сборка и тесты на 6 платформах | blocked |
| [T-004](tasks/stage-0-foundation/T-004-signing-notarization.md) | Подпись и нотаризация дистрибутивов | draft |
| [T-005](tasks/stage-0-foundation/T-005-e2e-harness.md) | Сквозные проверки в репозитории | review |

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
| [T-021](tasks/stage-2-git-core/T-021-stage-commit.md) | Индексация (файлы, фрагменты, строки) и коммит | review |
| [T-022](tasks/stage-2-git-core/T-022-commit-graph.md) | Граф коммитов и виртуализация списка | review |
| [T-023](tasks/stage-2-git-core/T-023-branches.md) | Ветки и теги, переключение с автоматическим stash | review |
| [T-024](tasks/stage-2-git-core/T-024-remote-sync.md) | Fetch, pull (merge и rebase), push; учётные данные в UI | review |
| [T-025](tasks/stage-2-git-core/T-025-conflict-editor.md) | Встроенное разрешение конфликтов | review |
| [T-026](tasks/stage-2-git-core/T-026-file-watching.md) | Слежение за файлами и автообновление | review |
| [T-027](tasks/stage-2-git-core/T-027-embedded-terminal.md) | Встроенный терминал | review |
| [T-028](tasks/stage-2-git-core/T-028-hunk-view.md) | Hunk View и File View | review |

### Этап 3 — История и операции над коммитами

| ID | Задача | Статус |
|---|---|---|
| [T-030](tasks/stage-3-history/T-030-graph-search.md) | Поиск и фильтрация в истории | review |
| [T-031](tasks/stage-3-history/T-031-file-history-blame.md) | История файла и blame | review |
| [T-032](tasks/stage-3-history/T-032-commit-ops.md) | Cherry-pick, revert, reset, checkout коммита | review |
| [T-033](tasks/stage-3-history/T-033-merge-rebase.md) | Merge и rebase веток | review |
| [T-034](tasks/stage-3-history/T-034-interactive-rebase.md) | Интерактивный rebase | review |
| [T-035](tasks/stage-3-history/T-035-stash.md) | Stash | review |
| [T-036](tasks/stage-3-history/T-036-undo-redo.md) | Undo/Redo операций | review |

### Этап 4 — Репозитории

| ID | Задача | Статус |
|---|---|---|
| [T-040](tasks/stage-4-repositories/T-040-clone-init.md) | Clone и init | review |
| [T-041](tasks/stage-4-repositories/T-041-tabs-repos.md) | Вкладки репозиториев, восстановление сессии, недавние и поиск | review |
| [T-042](tasks/stage-4-repositories/T-042-remotes.md) | Удалённые репозитории и auto-fetch | review |
| [T-043](tasks/stage-4-repositories/T-043-submodules.md) | Подмодули | review |
| [T-044](tasks/stage-4-repositories/T-044-worktrees.md) | Worktrees | review |
| [T-045](tasks/stage-4-repositories/T-045-lfs.md) | Git LFS | review |
| [T-046](tasks/stage-4-repositories/T-046-gitflow.md) | Gitflow | review |
| [T-047](tasks/stage-4-repositories/T-047-hooks.md) | Хуки | review |

### Этап 5 — Настройки и удобство

| ID | Задача | Статус |
|---|---|---|
| [T-050](tasks/stage-5-settings/T-050-settings.md) | Настройки: хранилище, окно Preferences, внешние инструменты | review |
| [T-051](tasks/stage-5-settings/T-051-themes.md) | Темы приложения и редактора | review |
| [T-052](tasks/stage-5-settings/T-052-keybindings-palette.md) | Сочетания клавиш, палитра команд, нечёткий поиск | review |
| [T-053](tasks/stage-5-settings/T-053-profiles-keys.md) | Профили, SSH- и GPG-ключи | review |
| [T-054](tasks/stage-5-settings/T-054-notifications-log.md) | Уведомления и журнал операций | review |
| [T-055](tasks/stage-5-settings/T-055-avatars.md) | Аватары авторов | review |
| [T-056](tasks/stage-5-settings/T-056-auto-update.md) | Автообновление | blocked |
| [T-057](tasks/stage-5-settings/T-057-toolbar-redesign.md) | Верхняя панель в стиле GitKraken | review |
| [T-058](tasks/stage-5-settings/T-058-graph-styles.md) | Стили графа коммитов (в т. ч. как в GitKraken) | review |
| [T-059](tasks/stage-5-settings/T-059-resizable-layout.md) | Изменяемая ширина колонок графа и боковых панелей | review |

### Этап 6 — Интеграции с хостингами (после проверки владельцем)

Решение владельца (2026-10-23): отдельным этапом позже; для проверки нужны его аккаунты/токены.
Порядок (решение владельца 2026-10-23): **Forgejo → GitVerse → GitHub → GitLab**; Bitbucket, Azure DevOps и
трекеры задач — дальние планы. T-065 закладывает общий слой интеграций для остальных.

| ID | Задача | Статус |
|---|---|---|
| [T-065](tasks/stage-6-integrations/T-065-forgejo.md) | 1. Forgejo (и Gitea): вход, репозитории, pull requests, issues | review |
| [T-066](tasks/stage-6-integrations/T-066-gitverse.md) | 2. GitVerse: вход, репозитории, pull requests, issues | draft |
| [T-060](tasks/stage-6-integrations/T-060-github.md) | 3. GitHub: вход, репозитории, pull requests, issues | draft |
| [T-061](tasks/stage-6-integrations/T-061-gitlab.md) | 4. GitLab: вход, репозитории, merge requests, issues | draft |

Дальние планы:

| ID | Задача | Статус |
|---|---|---|
| [T-062](tasks/stage-6-integrations/T-062-bitbucket.md) | Bitbucket: вход, репозитории, pull requests | draft |
| [T-063](tasks/stage-6-integrations/T-063-azure-devops.md) | Azure DevOps: вход, репозитории, pull requests, work items | draft |
| [T-064](tasks/stage-6-integrations/T-064-issue-trackers.md) | Трекеры задач: Jira, Trello | draft |

### Сознательно не делаем

Решение владельца (2026-10-23): облачные функции GitKraken, требующие их сервера, — **исключены**:
Workspaces, Cloud Patches, Launchpad, AI-функции, Team, онбординг-туториал GitKraken, интеграция с `gk` CLI.

## Ночная (автономная) работа

Цель (2026-10-23): приложение умеет всё, что умеет GitKraken как git-клиент (без облачных функций).

### Правила

1. Задачи берутся по порядку ниже; если зависимость не готова или задача `blocked` — следующая независимая.
2. Решение, которое должен принять владелец, **не принимается**: статус `blocked`, вопрос в «Нюансах», дальше.
3. Интерфейс — по [design.md](design.md) (ориентир GitKraken, решение владельца 2026-10-23).
4. Каждая задача: тесты (юнит/интеграционные на временных репозиториях), сквозной набор в `tests/e2e`,
   `typecheck` + `lint` + `test` + `test:e2e` зелёные; документация задачи и строка в этом индексе; **коммит**
   (локально, без push).
5. Задача слишком большая — разбить на подзадачи (T-0XXa/b) с отдельными файлами и коммитами.
6. Не трогать запущенный владельцем экземпляр приложения: у сквозных проверок свой профиль и HOME.
7. Не ослаблять безопасность (sandbox, CSP, fuses, проверка аргументов IPC) ради удобства реализации.
8. Работа **последовательная**, без субагентов (решение владельца 2026-10-23: растянуть лимит использования на всю ночь).
9. Регрессия: перед коммитом — полный `test` и `test:e2e`; найденные чужие баги — исправить с тестом и записью в задаче.

### Порядок

1. T-005 сквозные проверки в репозитории
2. **T-050 настройки и выбор внешних инструментов → T-041 вкладки и восстановление сессии** (решение владельца
   2026-10-23: при запуске открывать прежние репозитории; меняет структуру состояния — делать до остальных функций)
3. T-022 граф коммитов → T-026 автообновление → T-023 ветки и теги (автоматический stash)
4. T-035 stash → T-025 разрешение конфликтов → T-032 cherry-pick/revert/reset → T-033 merge и rebase
5. T-024 fetch/pull/push + askpass → T-042 remotes и auto-fetch → T-034 интерактивный rebase → T-036 undo/redo
6. T-030 поиск → T-031 история файла и blame → T-028 Hunk View
7. T-027 встроенный терминал → T-040 clone/init
8. T-051 темы → T-052 клавиши и палитра команд → T-053 профили и ключи → T-054 уведомления и журнал → T-055 аватары
9. T-043 подмодули → T-044 worktrees → T-045 LFS → T-046 Gitflow → T-047 хуки
10. T-003 CI (GitHub Actions; workflow пишется, запуск — после выбора владельцем)
