# Разбор GitKraken Desktop 12.6.1

Дата: 2026-10-22. Объект: `gitkraken/` (Linux x64), Electron 41.10.7.
Инструменты: REA (статический анализ ASAR, Electron fuses, Go build info) и ручной поиск по бандлам.
Бандлы минифицированы, sourcemaps нет; приложение не запускалось — всё ниже статические наблюдения.

## Процессы

| Процесс | Бандл | Что делает |
|---|---|---|
| main | `src/main/static/main.bundle.js` (+~17 чанков) | Redux + redux-saga, ~318 IPC-обработчиков, nodegit, nsfw, автообновление, Sentry |
| главное окно | `entryPoints/main/render.bundle.js` (13 МБ) | React 17, копия состояния, Monaco, xterm; **сам вызывает nodegit и git** |
| requestHandler | скрытый WebContentsView | clone/fetch/push и операции с remote |
| workers | `worker.bundle.js` | поиск (minisearch), разбор конфликтов |
| pty-host | `pty-host.bundle.js` | встроенный терминал (node-pty) |
| CLI | `gitkraken.sh` → `ELECTRON_RUN_AS_NODE=1 … cli.js` | разбор аргументов (yargs), запуск GUI |

## Полезные идеи (взяты в Forklift как идеи, код свой)

- Состояние в main, копия в окне через MessagePort: `REPLICA_READY` → `STATE` → `UPDATE{updateIndex}` → ack;
  ответ на IPC-вызов ждёт ack (`waitForReplicaAck`).
- Таблица IPC-обработчиков `{message, sagaFn, oneWay, preserveSender}` по 39 доменам.
- Обратный вызов main → окно: `invoke-renderer` + `REQUESTABLE_SAGA_IDENTIFIERS` (67 саг).

## Что не повторяем

- `nodeIntegration: true`, `contextIsolation: false` у всех окон.
- Fuses: `RunAsNode` и `NODE_OPTIONS` включены, `OnlyLoadAppFromAsar` и `EnableCookieEncryption` выключены.
- Загрузка через `file://` с `GrantFileProtocolExtraPrivileges`.

## Git-стек и лицензии

| Компонент | Лицензия | Статус в Forklift |
|---|---|---|
| `@axosoft/nodegit` 0.28.0-alpha.38 | MIT, npm (`next`) | используем, собираем сами |
| `nodegit-flow` 2.2.8 | ISC | не подключён (git-flow — по необходимости) |
| `nsfw` 2.3.1 | MIT, N-API | подключён |
| `find-git-repositories` 0.2.2 | MIT, N-API | подключён |
| `@axosoft/node-spawn-server` 0.1.9 | UNLICENSED | не используем, см. ниже |
| `@axosoft/rust-socket-bridge` 0.1.8 | UNLICENSED | не используем (askpass/ssh-мост) |
| встроенный git 2.54.0 | GPLv2, их сборка | не берём; при необходимости — dugite (MIT) |
| `gk` CLI (Go 1.25.7, `gkcli/cmd/installer-proxy`) | проприетарный | не используем |

Готовые бинарники nodegit на S3 Axosoft: есть для `electron-v41.10` и `node-v137` на 6 платформах;
для Electron 45 — нет (404). Готовый OpenSSL 3.0.18 для win32/darwin x64/arm64 — есть.

## node-spawn-server (разобран 2026-10-22)

Отдельный процесс на Rust (~6 МБ, статический), запускающий дочерние процессы по запросу Electron.

- Протокол: msgpack через stdin/stdout. Запрос `{id, executable, args, options{cwd, env}, stdin, streamingMode}`;
  ответы `Spawned{id,pid}`, `Stdout/Stderr{id,chunk}` (при стриминге), `Complete{id,code,duration,stdout,stderr}`.
- Внутри: `std::process::Command`, по 3 потока на процесс, вывод копится в памяти.
- Зачем: git у них запускается из огромного процесса окна, а spawn из него дорогой и блокирует UI.
- Недостатки: нет отмены/kill, таймаутов, лимита вывода; неверный запрос роняет сервер и все операции.
- Запасной вариант у них же — `WorkerSpawnServer` на `child_process.fork` (без стриминга и stdin).

Вывод для Forklift: та же идея через `utilityProcess`, плюс отмена, таймауты, лимиты (T-010).

## Electron fuses GitKraken

`RunAsNode` on, `EnableCookieEncryption` off, `EnableNodeOptionsEnvironmentVariable` on,
`EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` off, `OnlyLoadAppFromAsar` off,
`LoadBrowserProcessSpecificV8Snapshot` off, `GrantFileProtocolExtraPrivileges` on, `WasmTrapHandlers` off.
