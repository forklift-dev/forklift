---
id: T-002
title: Сборка nodegit из исходников под Electron 45
stage: 0 — Фундамент
status: done
depends_on: []
updated: 2026-10-22
---

# T-002. Сборка nodegit из исходников под Electron 45

## Цель

`@axosoft/nodegit` (libgit2-форк GitKraken), `nsfw` и `find-git-repositories` надёжно собираются
под установленную версию Electron одной командой на всех целевых ОС, с OpenSSL, слинкованным статически.

## Контекст

- Готовых бинарников nodegit под Electron 45 нет (только `electron-v41.10`, `node-v137`).
- Сборка: `scripts/rebuild-native.mjs` (запускается в `postinstall`, вручную — `npm run rebuild:native`).
- Скрипт: получает OpenSSL заранее → задаёт `npm_config_openssl_dir` и `NODEGIT_OPENSSL_STATIC_LINK=1`
  → `@electron/rebuild` (программный API, `buildFromSource`) → удаляет лишние prebuilt-варианты.

## Этапы

- [x] Проверить лицензии и доступность компонентов (см. research/gitkraken.md)
- [x] Разобрать механизм сборки форка (binding.gyp, acquireOpenSSL.mjs, загрузчик `lib/nodegit.js`)
- [x] Скрипт пересборки с обходом найденных проблем
- [x] Успешная сборка на Linux x64; `nodegit.node` грузится внутри Electron 45 (V8 15.6, ABI 150)
- [x] `ldd nodegit.node` не содержит `libssl`/`libcrypto` (статическая линковка)
- [x] Повторный `npm install` не пересобирает OpenSSL (есть `include/openssl/ssl.h` → шаг пропускается)
- [ ] Проверка на macOS (arm64, x64) и Windows (x64, arm64) — перенесено в T-003

## Критерии готовности

- `npm run rebuild:native` проходит с нуля на Linux x64; `npm test` зелёный.
- Задокументированы требования к toolchain для каждой ОС (README).

## Нюансы

- 2026-10-22: **гонка** — gyp-действие получения OpenSSL не блокирует параллельную компиляцию
  libgit2 (`openssl/des.h: No such file`). Решение: получать OpenSSL до запуска сборки.
- 2026-10-22: **баг форка** — проверка версии OpenSSL (`^OpenSSL (\d\.\d\.\d[a-z]*)`) из `3.0.18`
  получает `3.0.1`, считает OpenSSL устаревшим и пересобирает его при каждом запуске.
  Решение: задавать `npm_config_openssl_dir` — тогда форк пропускает свой acquire-шаг.
  Можно отправить исправление в форк.
- 2026-10-22: на Linux загрузчик форка сначала пробует `nodegit-<arch>-ubuntu-20-ssl-static.node`
  и `nodegit-<arch>-ubuntu-20.node` (их приносит prebuilt под Node при `npm install`);
  под Electron они не грузятся, загрузчик падает обратно на `nodegit.node`. Скрипт их удаляет.
- 2026-10-22: OpenSSL на Linux собирается из исходников (нужен perl), на macOS/Windows скачивается
  с S3 Axosoft (`openssl-3.0.18-<platform>-<arch>.tar.gz` с SHA-256) — есть для всех 4 вариантов.
- 2026-10-22: зависимость форка `nan` указана как GitHub-ссылка (`axosoft/nan#v2.26.2-axosoft.0`) —
  для установки нужен доступ к github.com.
- 2026-10-22: из системных библиотек `nodegit.node` зависит только от Kerberos (`libgssapi_krb5.so.2` и др.) —
  как у GitKraken. Для deb-пакета указать зависимость `libgssapi-krb5-2`; в AppImage — есть почти во всех дистрибутивах.
- 2026-10-22: CLI `electron-rebuild -j max` падает («jobs must be a number»); путь
  `@electron/rebuild/lib/cli.js` закрыт полем `exports` — используем программный API.
- 2026-10-22: **риск сработал — несовместимость с V8 15.6 (Electron 45).** V8 добавил тег к
  `v8::External::New/Value`, сменил сигнатуры setter-колбэков и `SetPrototypeV2`.
  - Форк `nan` Axosoft (`v2.26.2-axosoft.0`) = upstream 2.26.2 + одна правка под Electron 41.
    Заменили на upstream `nan` 2.30.0 через `overrides` в `package.json` (2.28 — External tag,
    2.29 — V8 15.3+).
  - В сгенерированных исходниках nodegit 321 прямой вызов `External::Value()` в 61 файле, ровно
    три текстовых шаблона. `scripts/rebuild-native.mjs` переписывает их на
    `Nan::GetExternalValue(...)` (работает и со старым, и с новым V8). Идемпотентно.
  - Правку стоит предложить в axosoft/nodegit (в шаблоны генератора); когда выйдет версия с
    исправлением — правка в скрипте станет no-op и её можно убрать.
- Риск остаётся: nodegit построен на `nan`; новые версии V8 в будущих Electron могут ломать сборку.
  При каждом обновлении Electron — сначала пересборка и тесты.

## Промт

```text
Доведи до конца задачу docs/tasks/stage-0-foundation/T-002-nodegit-electron-build.md.
1. Запусти npm run rebuild:native и убедись, что сборка проходит (лог сохрани в scratchpad).
2. Проверь загрузку внутри Electron:
   ELECTRON_RUN_AS_NODE=1 npx electron -e "require('@axosoft/nodegit')"
3. Проверь статическую линковку: ldd node_modules/@axosoft/nodegit/build/Release/nodegit.node
   не должен показывать libssl/libcrypto.
4. Запусти npm test — тест src/main/git/service.test.ts должен пройти.
5. Повторно запусти node scripts/rebuild-native.mjs (без --force) и убедись, что OpenSSL не пересобирается.
Новые проблемы запиши в «Нюансы», отметь чеклист, обнови статус и docs/README.md.
```
