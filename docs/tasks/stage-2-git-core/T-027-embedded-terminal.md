---
id: T-027
title: Встроенный терминал
stage: 2 — Основная работа внутри приложения
status: review
depends_on: [T-010, T-011]
updated: 2026-10-23
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

- [x] `node-pty` 1.1.0 в utilityProcess (pty host), сборка из исходников под Electron — `scripts/rebuild-native.mjs`
- [x] Протокол: создать/записать/изменить размер/закрыть; вывод — пачками (8 мс) из pty host в main и событиями в окно
- [x] xterm.js 6 в окне: вкладки, fit, ссылки, WebGL-рендер (с откатом на DOM), цвета из токенов темы
- [x] Окружение shell из T-011, папка — корень репозитория; настройки Terminal (shell, шрифт, размер)
- [x] Закрытие процессов при закрытии вкладки терминала, вкладки репозитория, окна и приложения

## Нюансы

- `node-pty` — нативный модуль: добавить в `scripts/rebuild-native.mjs` и `electron-builder.yml` (asarUnpack).
- 2026-10-23: shell работает в отдельном utilityProcess (`src/pty-host`), а не в main: падение нативного модуля
  или зависший shell не задевают приложение; если pty host упал — все терминалы получают «exited» и следующий
  терминал запускает новый host.
- 2026-10-23: путь данных: вывод — pty host → main → `webContents.send('terminal:event')` → preload; ввод —
  `ipcRenderer.send('terminal:input')` с проверкой отправителя (`isTrustedSender`), только во вкладку своего окна.
  Отдельный MessagePort не понадобился: пропускной способности IPC хватает (вывод пачками по 8 мс). CSP не менялся.
- 2026-10-23: кнопка Terminal в тулбаре и Ctrl+` показывают/скрывают встроенный терминал; внешний терминал —
  кнопкой в заголовке панели (настройка из T-050 по-прежнему действует). Терминалы живут, пока открыта вкладка
  репозитория (переключение вкладок их не закрывает); высота панели — перетаскиванием, запоминается.
- 2026-10-23: по умолчанию: `$SHELL` (на macOS с `-l`, как в Terminal.app), на Windows — `%COMSPEC%`; переменные
  `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=Forklift`. Windows (ConPTY) не проверен — с T-003.
- 2026-10-23: упаковка: `.node` распаковываются из asar (`**/*.node`), `spawn-helper` (macOS) — тоже; исходники
  node-pty исключены. AppImage — 140 МБ. Сквозной набор `terminal` зелёный и в упакованной сборке.
- 2026-10-23: проверено: сквозной набор `terminal` (10 проверок: папка репозитория, ввод/вывод, второй терминал,
  терминалы по вкладкам, закрытие завершает процесс, Ctrl+`).

## Промт

```text
Реализуй docs/tasks/stage-2-git-core/T-027-embedded-terminal.md: pty в utilityProcess, xterm.js в окне,
связь через MessagePort; CSP не ослаблять.
```
