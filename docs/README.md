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
| [T-069](tasks/stage-0-foundation/T-069-github-beta-builds.md) | Бета-сборки на GitHub Actions (Linux, Windows, macOS) | review |
| [T-081](tasks/stage-0-foundation/T-081-packaging.md) | Пакеты: deb/rpm, Flatpak, AUR, Homebrew, winget — отложено | draft |
| [T-082](tasks/stage-0-foundation/T-082-crash-reports.md) | Отчёты о падениях (локально) — отложено | draft |
| [T-083](tasks/stage-0-foundation/T-083-perf-budgets.md) | Замеры производительности в CI — отложено | draft |
| [T-085](tasks/stage-0-foundation/T-085-prebuilt-native-modules.md) | Готовые сборки nodegit и нативных модулей для CI (идея владельца) | draft |

### Этап 1 — Процессы и внешние программы

| ID | Задача | Статус |
|---|---|---|
| [T-010](tasks/stage-1-processes/T-010-process-runner.md) | ProcessRunner на utilityProcess | review |
| [T-011](tasks/stage-1-processes/T-011-shell-env.md) | Окружение login-shell (PATH на macOS/Linux) | review |
| [T-012](tasks/stage-1-processes/T-012-git-cli.md) | Адаптер git CLI поверх ProcessRunner | review |
| [T-013](tasks/stage-1-processes/T-013-editor-terminal.md) | Открытие во внешнем редакторе и терминале | review |
| [T-014](tasks/stage-1-processes/T-014-diff-merge-tools.md) | Внешние diff/merge tools | review |
| [T-076](tasks/stage-1-processes/T-076-difftool-mergetool-mode.md) | Forklift как git difftool и mergetool | in-progress |
| [T-076a](tasks/stage-1-processes/T-076a-git-setup.md) | CLI и безопасная настройка Git для Forklift tools | review |
| [T-076b](tasks/stage-1-processes/T-076b-standalone-diff.md) | Отдельное окно Forklift для git difftool | todo |
| [T-076c](tasks/stage-1-processes/T-076c-standalone-merge.md) | Отдельное окно Forklift для git mergetool | todo |

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
| [T-072](tasks/stage-2-git-core/T-072-three-way-merge.md) | 3-way merge: панель BASE и выбор строк | review |
| [T-077](tasks/stage-2-git-core/T-077-image-and-large-diff.md) | Diff изображений и больших файлов | todo |

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
| [T-073](tasks/stage-3-history/T-073-bisect.md) | Bisect | review |
| [T-078](tasks/stage-3-history/T-078-compare-commits.md) | Сравнение двух коммитов и веток | review |
| [T-080](tasks/stage-3-history/T-080-history-memory-and-graph.md) | История: память и отрисовка графа на сотнях дорожек | review |

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
| [T-079](tasks/stage-4-repositories/T-079-repo-groups.md) | Группы репозиториев (fetch/pull для набора) | todo |

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
| [T-070](tasks/stage-5-settings/T-070-more-themes.md) | Больше тем интерфейса и стилей графа | review |
| [T-071](tasks/stage-5-settings/T-071-status-bar.md) | Строка статуса внизу окна | review |
| [T-074](tasks/stage-5-settings/T-074-i18n.md) | Локализация интерфейса (i18n) | review |
| [T-075](tasks/stage-5-settings/T-075-profile-sync.md) | Хранение профилей и настроек на сервере | draft |
| [T-084](tasks/stage-5-settings/T-084-ai-assist.md) | AI: сообщение коммита, ревью, объяснение конфликта (локально) | todo |
| [T-086](tasks/stage-5-settings/T-086-translation-catalogs.md) | Каталоги переводов и автоматическая проверка | todo |
| [T-087](tasks/stage-5-settings/T-087-more-languages.md) | Подключение новых языков интерфейса | todo |
| [T-088](tasks/stage-5-settings/T-088-community-translations.md) | Процесс переводов от сообщества | todo |
| [T-089](tasks/stage-5-settings/T-089-stable-message-ids.md) | Устойчивые идентификаторы строк интерфейса | todo |
| [T-090](tasks/stage-5-settings/T-090-translation-platform.md) | Платформа совместного перевода (при появлении потребности) | draft |

### Этап 6 — Интеграции с хостингами (после проверки владельцем)

Решение владельца (2026-10-23): отдельным этапом позже; для проверки нужны его аккаунты/токены.
Порядок (решение владельца 2026-10-23): **Forgejo → GitVerse → GitHub → GitLab**; Bitbucket, Azure DevOps и
трекеры задач — дальние планы. T-065 закладывает общий слой интеграций для остальных.

| ID | Задача | Статус |
|---|---|---|
| [T-065](tasks/stage-6-integrations/T-065-forgejo.md) | 1. Forgejo (и Gitea): вход, репозитории, pull requests, issues | review |
| [T-066](tasks/stage-6-integrations/T-066-gitverse.md) | 2. GitVerse: вход, репозитории, pull requests, issues | review |
| [T-060](tasks/stage-6-integrations/T-060-github.md) | 3. GitHub: вход, репозитории, pull requests, issues | review |
| [T-061](tasks/stage-6-integrations/T-061-gitlab.md) | 4. GitLab: вход, репозитории, merge requests, issues | review |

Техдолг:

| ID | Задача | Статус |
|---|---|---|
| [T-067](tasks/stage-6-integrations/T-067-hosting-markdown.md) | Markdown в описаниях и комментариях PR и issues | review |
| [T-068](tasks/stage-6-integrations/T-068-github-oauth.md) | GitHub: вход через браузер (OAuth device flow) | draft |

Дальние планы:

| ID | Задача | Статус |
|---|---|---|
| [T-062](tasks/stage-6-integrations/T-062-bitbucket.md) | Bitbucket: вход, репозитории, pull requests | draft |
| [T-063](tasks/stage-6-integrations/T-063-azure-devops.md) | Azure DevOps: вход, репозитории, pull requests, work items | draft |
| [T-064](tasks/stage-6-integrations/T-064-issue-trackers.md) | Трекеры задач: Jira, Trello | draft |

### Сознательно не делаем

Решение владельца (2026-10-23): облачные функции GitKraken, требующие их сервера, — **исключены**:
Workspaces, Cloud Patches, Launchpad, AI-функции, Team, онбординг-туториал GitKraken, интеграция с `gk` CLI.

Уточнение владельца (2026-10-26): исключены облачные варианты; локальные группы репозиториев (T-079) и AI
без нашего сервера — через CLI-агенты, ключ API пользователя или Ollama (T-084) — делаем.

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
   Исключение (2026-10-26): рутину с чёткими промтами можно отдавать Codex CLI; его дифф проверяется перед коммитом.
9. Регрессия: перед коммитом — полный `test` и `test:e2e`; найденные чужие баги — исправить с тестом и записью в задаче.

### Порядок

Текущий порядок владельца (2026-10-26): сначала его список — **T-074 i18n** (первой: иначе строки остальных задач
пришлось бы выносить повторно) → T-070 темы → T-071 строка статуса → T-072 3-way merge → T-073 bisect; затем
T-078 сравнение коммитов → T-076 difftool/mergetool → T-077 diff изображений → T-079 группы репозиториев →
T-084 локальный AI. T-075 — после обсуждения; T-081…T-083 отложены.

Исходный порядок ночной работы (2026-10-23, выполнен):


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
