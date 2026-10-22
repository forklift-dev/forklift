---
id: T-001
title: Каркас приложения
stage: 0 — Фундамент
status: review
depends_on: []
updated: 2026-10-22
---

# T-001. Каркас приложения

## Цель

Рабочий скелет desktop-приложения на актуальном стеке, который открывает git-репозиторий и
показывает коммиты, текущую ветку и изменения. Основа для всех следующих задач.

## Контекст

Архитектура и решения — [architecture.md](../../architecture.md). Идеи взяты из разбора GitKraken
([research/gitkraken.md](../../research/gitkraken.md)), код написан с нуля.

## Этапы

- [x] Стек: Electron 45, React 19, TS 7, Vite 8 + electron-vite 6, RTK 2, Vitest 5, oxlint, electron-builder 26
- [x] Общие контракты: `src/shared/state.ts`, `ipc.ts`, `bridge.ts`
- [x] Main: стор (RTK, `loadRepo` с защитой от устаревших ответов), репликация, реестр IPC, протокол `app://`, безопасное окно
- [x] Preload: узкий API через `contextBridge`, порт репликации не выходит в страницу
- [x] Renderer: копия состояния через `useSyncExternalStore`, тулбар, список коммитов, панель изменений
- [x] Git-сервис на nodegit + тест на временном репозитории (`src/main/git/service.test.ts`)
- [x] `npm run typecheck`, `npm run lint`, `npm run build` проходят
- [x] `npm test` проходит (4 теста git-сервиса, внутри Electron)
- [x] Сквозная проверка собранного приложения через CDP (11/11): загрузка по `app://`, нет `require`/`process` в странице,
      `repo:open` → nodegit → репликация → React, отказ неизвестной команде и неверному аргументу
- [ ] Ручная проверка владельцем: `npm run dev`, открыть репозиторий, Refresh, Close
- [x] `npm run dist` собирает AppImage (138 МБ); fuses в бинарнике совпадают с `electron-builder.yml` (REA `inspect_electron_fuses`)
- [x] Сквозная проверка упакованного приложения (`dist/linux-unpacked/forklift`): 11/11
- [ ] deb-пакет: нужны `homepage` и email мейнтейнера в `package.json` — **данные владельца**
- [ ] Иконка приложения (сейчас стандартная иконка Electron)

## Критерии готовности

- Все проверки выше зелёные на Linux x64.
- В собранном приложении: окно открывается, репозиторий читается, fuses соответствуют `electron-builder.yml`.

## Нюансы

- 2026-10-22: Electron 45 скачивает бинарник лениво — при первом запуске, а не в postinstall.
- 2026-10-22: npm 11 предупреждает о install-скриптах без `allowScripts`; разрешения для трёх
  нативных модулей зафиксированы в `package.json` (с версиями — при обновлении переподтвердить).
- 2026-10-22: ключи `runtime/target/disturl` в `.npmrc` npm 11 считает неизвестными и скоро
  перестанет поддерживать — поэтому пересборка через `@electron/rebuild`, а не через `.npmrc`.
- 2026-10-22: правило oxlint `react-in-jsx-scope` отключено — устарело для нового JSX-трансформа.
- 2026-10-22: при запуске под `xvfb-run` Electron всё равно выбирает Wayland, если сессия Wayland —
  для headless-проверок передавать `--ozone-platform=x11`.
- 2026-10-22: первый AppImage весил 305 МБ — electron-builder упаковал исходники libgit2/OpenSSL и объектные файлы
  из пакета nodegit (`vendor/` ≈ 500 МБ). Исключения — в `files` в `electron-builder.yml`; в рантайме нужны только
  `lib/` и `build/Release/nodegit.node` (так же упаковывает GitKraken).
- 2026-10-22: на Linux проверка целостности ASAR (fuse) не применяется Electron'ом — работает только на macOS/Windows.
- Рендерер не минифицирован (по умолчанию electron-vite); не критично, можно включить `build.minify`.

## Промт

```text
Проверь каркас Forklift (задача docs/tasks/stage-0-foundation/T-001-project-skeleton.md).
1. Выполни npm run typecheck, npm run lint, npm test, npm run build — все должны пройти.
2. Запусти npm run dev, открой любой git-репозиторий через «Open…», проверь Refresh и Close,
   посмотри логи main-процесса на ошибки.
3. Выполни npm run dist и проверь fuses собранного бинарника (REA inspect_electron_fuses):
   они должны совпадать с electron-builder.yml.
Найденные проблемы исправь или запиши в «Нюансы». Отметь пункты чеклиста; если всё ок —
статус done, обнови updated и таблицу в docs/README.md.
```
