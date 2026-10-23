# Архитектура Forklift

Обновлено: 2026-10-23

## Стек

| Слой | Выбор |
|---|---|
| Оболочка | Electron 45 |
| UI | React 19, CSS-переменные (без UI-фреймворка), Monaco 0.57 (diff) |
| Язык | TypeScript 7 (strict) |
| Сборка | Vite 8 + electron-vite 6, упаковка electron-builder 26 |
| Состояние | Redux Toolkit 2 в main-процессе |
| Git | `@axosoft/nodegit` 0.28.0-alpha.38 (libgit2-форк GitKraken), собирается из исходников |
| Файловые события | `nsfw` (GitKraken, MIT) — подключён, ещё не используется |
| Поиск репозиториев | `find-git-repositories` (GitKraken, MIT) — подключён, ещё не используется |
| Запуск процессов | `cross-spawn` 7 в `utilityProcess` (ProcessRunner) |
| Тесты / линт | Vitest 5 (внутри Electron), сквозные наборы `tests/e2e` через CDP, oxlint |

## Процессы

```
main process ─ src/main
  store/          Redux Toolkit: единственный источник правды
  git/service.ts  чтение репозитория через nodegit (+ git/diff.ts: детали коммита, версии файлов)
  git/cli.ts      git CLI поверх ProcessRunner (сеть, хуки, difftool/mergetool)
  history/        история с раскладкой графа: кэш на вкладку и версию, страницы по запросу окна
  external/       внешний редактор, терминал, diff/merge tools (выбор по настройкам, ОС/рабочему столу, git config)
  settings/       settings.json (атомарная запись, миграции), проверка изменений, кнопки Test/git config
  replication.ts  копия состояния (проекция: вкладки + активный репозиторий) в окна через MessagePort
  repos/          вкладки: открытие, сессия и недавние (repositories.json), поиск репозиториев, argv
  ipc/            типизированная таблица команд → ipcMain.handle
  process/       ProcessRunner — клиент utilityProcess, очистка env

utility process ─ src/process-host
  запуск git CLI и внешних программ; отмена, таймауты, убийство дерева процессов

preload ─ src/preload
  contextBridge: window.forklift { invoke, onReplicaMessage, ackReplicaUpdate }

renderer ─ src/renderer
  React 19; read-only копия состояния (useSyncExternalStore); изменения только через invoke()
```

## Ключевые решения

1. **Состояние живёт в main.** Окно получает полный снимок (`STATE`), затем изменения по
   верхнеуровневым срезам (`UPDATE` + `updateIndex`) и подтверждает каждое. Окно видит проекцию
   состояния (`projectState`): все вкладки, но данные только активного репозитория (T-041). Ответ на команду
   приходит только после подтверждения — после `await invoke(...)` окно гарантированно видит новое
   состояние. Идея из GitKraken; реализация своя и проще (без redux-saga).
2. **Типизированный контракт IPC** в `src/shared/ipc.ts`: компилятор ловит пропущенные и лишние
   каналы. Аргументы из окна дополнительно проверяются в рантайме.
3. **Безопасность окна:** `contextIsolation`, `sandbox`, без `nodeIntegration`; рендерер грузится
   по `app://forklift/`, а не `file://`; IPC принимается только от своего top-level фрейма;
   навигация и `window.open` запрещены; разрешения (камера и т.п.) отклоняются.
   В GitKraken всё наоборот (`nodeIntegration: true`, `contextIsolation: false`).
4. **Electron fuses закрыты** при упаковке (`electron-builder.yml`): нет `RunAsNode`,
   `NODE_OPTIONS`, `--inspect`; только `app.asar`; проверка целостности asar; шифрование cookies.
5. **Git-стек — открытые части GitKraken.** nodegit-форк собираем из исходников под актуальный
   Electron (у Axosoft готовые бинарники только под Electron 41, который уже без поддержки).
   OpenSSL линкуется статически на всех ОС. Подробности — T-002.
6. **Проприетарный `node-spawn-server` GitKraken не используем.** Его задачу (не блокировать
   UI при запуске процессов) решает `utilityProcess` + свой протокол с отменой и таймаутами — T-010.
7. **Настройки — одна декларативная схема** (`src/shared/settings.ts`): типы, умолчания, проверка, экран
   Preferences и переопределения по репозиторию выводятся из неё. Файл `userData/settings.json` пишет только main
   (атомарно, только отличия от умолчаний); окно меняет настройки командой `settings:update` — T-050.
8. **Сборка нативных модулей** — `scripts/rebuild-native.mjs` (postinstall). Каждая ОС и
   архитектура собирается на своей машине или CI-раннере; кросс-компиляция не поддерживается.

## Целевые платформы

Актуальные Windows 10/11, macOS (Apple Silicon и Intel), Linux (x64 и arm64; AppImage и deb).
Учитывать везде: пути с пробелами и не-ASCII, `.cmd`-обёртки на Windows, урезанный `PATH`
у GUI-приложений на macOS, окружение AppImage/snap.
