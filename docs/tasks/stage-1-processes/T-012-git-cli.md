---
id: T-012
title: Адаптер git CLI поверх ProcessRunner
stage: 1 — Процессы и внешние программы
status: review
depends_on: [T-010, T-011]
updated: 2026-10-22
---

# T-012. Адаптер git CLI поверх ProcessRunner

## Цель

Типизированный вызов `git` для операций, где CLI надёжнее libgit2: сеть (fetch/pull/push/clone
с SSH и credential helpers), хуки, `difftool`/`mergetool`, редкие команды.

## Контекст

- Чтение репозитория остаётся на nodegit (`src/main/git/service.ts`) — быстрее и без процессов.
- В GitKraken та же схема: nodegit + встроенный git через spawn-сервер.

## Этапы

- [x] `src/main/git/cli.ts`: класс `GitCli(runner, executable = 'git')`, метод `exec(args, opts)` → ProcessRunner.run
- [x] Окружение: `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `GIT_EDITOR=:`, `LANGUAGE=en_US:en`; `GIT_OPTIONAL_LOCKS=0` при `readOnly`
- [x] `GitCliError` (args, exitCode, stderr, code); сообщение — строка git `fatal:`/`error:`; ENOENT → «git executable … was not found»; `allowedExitCodes`
- [x] Построчный стрим stdout/stderr (`src/main/process/lines.ts`), `\r` — отдельная строка (перерисовка прогресса)
- [x] git из PATH (с окружением login-shell из T-011); путь передаётся в конструктор — настройка в UI позже
- [x] Минимальная версия 2.30.0: проверка при старте, `app.gitCli` в состоянии, предупреждение на стартовом экране
- [x] Тесты на настоящем git (`src/main/git/cli.test.ts`, 13) и разбор строк (`lines.test.ts`, 4); общий тестовый помощник `directRunner` (`src/main/process/testing.ts`)
- [x] Живая проверка `GitCli` через настоящий ProcessRunner/utilityProcess
- [x] Используется в T-014 (difftool/mergetool) — критерий готовности

## Критерии готовности

- `gitCli` используется в T-014 (difftool/mergetool); тесты зелёные.

## Нюансы

- Встроенный git в дистрибутиве (как у GitKraken) пока не планируем; если понадобится —
  `dugite` (MIT, сборки git от GitHub Desktop под все ОС/архитектуры).
- Авторизация (askpass, SSH-ключи, credential manager) — отдельная задача в рамках T-023.
- 2026-10-22: **`LANGUAGE`, а не `LC_ALL=C`**. `LC_ALL=C` даёт английские сообщения, но переводит в C-локаль
  и всё, что git запускает (хуки, фильтры): Python/Perl в C-локали падают на UTF-8. `LANGUAGE=en_US:en`
  меняет только язык сообщений gettext. Если у пользователя локаль `C`, сообщения и так английские.
- 2026-10-22: `GIT_EDITOR=:` по умолчанию — команда, которой понадобился бы редактор (`commit` без `-m`, `merge`
  без `--no-edit`), не зависает, а берёт подготовленное сообщение или прерывается на пустом. Для интерактивных
  сценариев (rebase -i, редактирование сообщения) передавать свой `GIT_EDITOR` через `env`.
- 2026-10-22: тест прогресса: `git clone --progress` из локального пути печатает «Receiving objects» только с
  `--no-local` (иначе используются жёсткие ссылки без транспорта).
- 2026-10-22: `ProcessError` и типы опций вынесены в `src/main/process/types.ts` — модули и тесты, которым нужен
  только контракт `Runner`, не тянут `electron` и виртуальный `?modulePath`.

## Промт

```text
Реализуй задачу docs/tasks/stage-1-processes/T-012-git-cli.md поверх ProcessRunner (T-010)
и shell env (T-011). Тесты — на временных репозиториях, как в src/main/git/service.test.ts.
Обнови чеклист, нюансы, статус и docs/README.md.
```
