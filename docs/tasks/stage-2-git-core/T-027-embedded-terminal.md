---
id: T-027
title: Встроенный терминал
stage: 2 — Основная работа внутри приложения
status: todo
depends_on: [T-010, T-011]
updated: 2026-10-22
---

# T-027. Встроенный терминал

## Цель

Панель терминала внутри приложения (вкладки, папка открытого репозитория, shell пользователя),
как в GitKraken. Решение владельца (2026-10-22): встроенный терминал нужен.

## Контекст

- GitKraken: xterm.js (+ addon-fit, addon-web-links, addon-webgl) в окне и отдельный `pty-host` с
  `node-pty`; сообщения `INIT_PTY`, `FIT_TERMINAL`, `WRITE_DATA`, `TERMINATE_PTY`, слежение за дочерними
  процессами (`get-cwd-of-process`, `@vscode/windows-process-tree`).
- У нас: окно в sandbox — pty живёт в utilityProcess (как ProcessRunner), данные идут через MessagePort.

## Этапы

- [ ] `node-pty` в utilityProcess (сборка под Electron — как nsfw в T-002)
- [ ] Протокол: создать/записать/изменить размер/закрыть; поток вывода через MessagePort
- [ ] xterm.js в окне: вкладки, fit, ссылки, WebGL-рендер, тема
- [ ] Окружение shell из T-011, папка — корень репозитория
- [ ] Закрытие процессов при закрытии вкладки/приложения

## Нюансы

- `node-pty` — нативный модуль: добавить в `scripts/rebuild-native.mjs` и `electron-builder.yml` (asarUnpack).

## Промт

```text
Реализуй docs/tasks/stage-2-git-core/T-027-embedded-terminal.md: pty в utilityProcess, xterm.js в окне,
связь через MessagePort; CSP не ослаблять.
```
