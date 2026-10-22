---
id: T-012
title: Адаптер git CLI поверх ProcessRunner
stage: 1 — Процессы и внешние программы
status: todo
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

- [ ] `src/main/git/cli.ts`: `gitCli(cwd, args, opts)` → ProcessRunner.run
- [ ] Окружение для git: `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` для read-only команд, `LC_ALL=C` для разбираемого вывода
- [ ] Ошибка `GitCliError` с командой, кодом, stderr; понятное сообщение «git не найден» (ENOENT)
- [ ] Построчный стрим stderr для прогресса (`--progress`) — пригодится в T-023
- [ ] Поиск git: системный из PATH (после T-011); настройка пути к git — позже
- [ ] Минимальная версия git (проверить `git --version` при старте, предупредить, если старая)
- [ ] Тесты на временном репозитории

## Критерии готовности

- `gitCli` используется в T-014 (difftool/mergetool); тесты зелёные.

## Нюансы

- Встроенный git в дистрибутиве (как у GitKraken) пока не планируем; если понадобится —
  `dugite` (MIT, сборки git от GitHub Desktop под все ОС/архитектуры).
- Авторизация (askpass, SSH-ключи, credential manager) — отдельная задача в рамках T-023.

## Промт

```text
Реализуй задачу docs/tasks/stage-1-processes/T-012-git-cli.md поверх ProcessRunner (T-010)
и shell env (T-011). Тесты — на временных репозиториях, как в src/main/git/service.test.ts.
Обнови чеклист, нюансы, статус и docs/README.md.
```
