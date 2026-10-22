---
id: T-010
title: ProcessRunner на utilityProcess
stage: 1 — Процессы и внешние программы
status: review
depends_on: [T-001]
updated: 2026-10-22
---

# T-010. ProcessRunner на utilityProcess

## Цель

Единый сервис запуска внешних процессов (git CLI, редактор, терминал, diff/merge tools), который
работает в отдельном `utilityProcess`, не блокирует main и окно, умеет отмену, таймауты и лимиты
и корректно ведёт себя на Windows, macOS и Linux.

## Контекст

- Аналог в GitKraken — проприетарный `node-spawn-server` (Rust, msgpack через stdio); разбор и его
  недостатки — [research/gitkraken.md](../../research/gitkraken.md#node-spawn-server-разобран-2026-10-22).
  Код оттуда не берём (UNLICENSED), повторяем только идею отдельного процесса.
- Потребители: T-011 (shell env), T-012 (git CLI), T-013 (редактор/терминал), T-014 (diff/merge).

## Дизайн

```
main: src/main/process/runner.ts          utility: src/process-host/
  ProcessRunner (клиент)  ──postMessage──▶  index.ts   — protocol over process.parentPort
  - ленивый старт utilityProcess.fork        spawn.ts   — cross-spawn, буферы, лимиты, таймаут
  - перезапуск при падении, reject pending   kill.ts    — убийство дерева процессов
  - AbortSignal → {type:'cancel', id}
```

Два режима:

| Метод | Для чего | Поведение |
|---|---|---|
| `run(cmd, args, opts)` | git CLI, служебные команды | stdout/stderr (буфер или построчный стрим), `input` в stdin, `timeoutMs`, `maxOutputBytes`, `signal`; результат `{code, signal, stdout, stderr, durationMs, timedOut, truncated}` |
| `launch(cmd, args, opts)` | редактор, терминал, diff/merge | `wait: false` — detached + `unref`, stdio игнорируется, процесс переживает приложение; `wait: true` — ждём выхода, возвращаем `{code}` |

Протокол (структурированный клон, без msgpack) — `src/shared/process.ts`: запросы
`run | launch | cancel | shutdown`, события `started{id,pid} | output{id,stream,chunk} | ran{id,result} |
launched{id,result} | failed{id,error}`.

Семантика `run`: промис разрешается при любом завершении процесса (код ≠ 0, таймаут, обрезка вывода —
флаги в результате); отклоняется при ошибке запуска (`ProcessError`, `code: 'ENOENT'`), отмене через
`AbortSignal` (`AbortError`, как у `fetch`) и падении хоста.

## Этапы

- [x] `src/shared/process.ts`: типы протокола и опций
- [x] `src/process-host/spawn.ts`: запуск через `cross-spawn` 7.x (Windows `.cmd/.bat`, PATHEXT, экранирование)
- [x] `src/process-host/kill.ts`: POSIX — `detached: true` + `process.kill(-pid)`; Windows — `taskkill /pid N /T /F`
- [x] Таймаут (SIGTERM → через 2 с SIGKILL), лимит вывода (обрезка + флаг `truncated` + kill), отмена по id
- [x] `src/process-host/index.ts`: обработка сообщений `process.parentPort`, ни одно исключение не роняет хост
- [x] `src/main/process/runner.ts`: клиент; вход хоста через `import hostPath from '../../process-host?modulePath'` (electron-vite)
- [x] Перезапуск хоста при падении; висящие запросы отклоняются, их деревья процессов убивает main
- [x] Санитизация env (`src/main/process/env.ts`): `ELECTRON_*`, `CHROME_*`, `VSCODE_*`, `NODE_OPTIONS`; восстановление
      `XDG_CURRENT_DESKTOP`; в AppImage — удаление `APPDIR/APPIMAGE/ARGV0/OWD` и путей внутри AppImage из `PATH`, `LD_LIBRARY_PATH` и др.
- [x] Остановка хоста при `app.on('will-quit')`; detached-процессы при этом не убиваются
- [x] Тесты ядра (`src/process-host/spawn.test.ts`, 9) и env (`src/main/process/env.test.ts`, 4)
- [x] Определение версии git через runner при старте (`src/main/git/cliVersion.ts`), показ на стартовом экране — пригодится в T-012
- [x] Сквозная проверка в живом Electron через инспектор main-процесса (14/14) и UI-проверка упакованного AppImage (12/12)
- [ ] Проверка на Windows и macOS (ручная или в CI — T-003)
- [ ] Перенести e2e-скрипты из scratchpad в репозиторий (T-003)

## Критерии готовности

- Тесты зелёные; `npm run typecheck`, `lint` чистые.
- Ручная проверка: `run('git', ['--version'])` из main; отмена долгой команды (`sleep 30` / `timeout 30`)
  убивает и дочерние процессы.
- Код хоста не импортирует `electron` (кроме `process.parentPort`, который есть в utilityProcess).

## Нюансы

- Windows: после CVE-2024-27980 `spawn` `.cmd/.bat` без `shell` бросает `EINVAL`; `cross-spawn`
  решает это экранированием для `cmd.exe`. Не собирать командную строку конкатенацией строк.
- Windows: `detached: true` у консольных программ открывает новое окно консоли — для git
  использовать `windowsHide: true`, для терминала — наоборот.
- POSIX: `detached: true` нужен и для `run` — чтобы своя группа процессов позволяла убить дерево;
  при этом обязательно ждать/убивать детей при выходе хоста.
- `process.parentPort` доступен только внутри utilityProcess; в тестах ядро вызывается напрямую.
- electron-vite 6: суффикс `?modulePath` собирает отдельный бандл и возвращает путь к нему;
  типы — `/// <reference types="electron-vite/node" />`.
- 2026-10-22: **найден и исправлен дефект** — при аварийной смерти хоста команды из его собственных групп
  процессов оставались сиротами (`sleep 30` с родителем init). Теперь main запоминает pid каждой команды
  (событие `started`) и при неожиданном выходе хоста или `dispose()` сам убивает их деревья.
  Отсоединённые программы (`launch` без `wait`) не трогаются.
- Остаётся: при аварийном падении самого main-процесса выполняющиеся команды выживут (их группы никто не
  убьёт). На Linux лечится только нативным `prctl(PR_SET_PDEATHSIG)`; пока принимаем.
- 2026-10-22: SIGKILL после SIGTERM отправляется группе всегда (через 2 с): потомки могут игнорировать SIGTERM
  или пережить лидера группы; сигнал пустой группе безвреден (ESRCH).
- 2026-10-22: в dev-сборках (`!app.isPackaged`) есть `globalThis.forkliftDebug = { store, runner }` для работы через
  `electron . --inspect` — так проверялся runner вживую. В упакованном приложении его нет.
- 2026-10-22: oxlint не разрешает виртуальный модуль `?modulePath` (`import/default`) — подавлено точечно с пояснением.
- Плейсхолдеры в командах внешних программ подставлять поаргументно, никогда через shell-строку
  (защита от инъекций через имена файлов).

## Промт

```text
Реализуй задачу docs/tasks/stage-1-processes/T-010-process-runner.md по разделу «Дизайн».
Перед началом прочитай docs/architecture.md и текущий код src/main (index.ts, ipc/, store/).
Ограничения: TypeScript strict, стиль как в существующем коде (короткие комментарии «почему»),
зависимость cross-spawn 7.x (+ @types/cross-spawn в devDependencies), никакого кода из GitKraken.
Покрой тестами ядро хоста (src/process-host/*.test.ts), тесты запускаются через npm test (внутри Electron).
Проверь npm run typecheck, lint, test, build. Отметь чеклист, запиши нюансы, выставь статус review
и обнови таблицу в docs/README.md.
```
