---
id: T-003
title: "CI: сборка и тесты на 6 платформах"
stage: 0 — Фундамент
status: blocked
depends_on: [T-002]
updated: 2026-10-22
---

# T-003. CI: сборка и тесты на 6 платформах

## Цель

На каждый push проверять typecheck, lint, тесты и сборку дистрибутива на всех целевых
платформах, чтобы поломки нативной сборки находились сразу, а не у пользователя.

## Контекст

Нативные модули (nodegit) нельзя кросс-компилировать — каждая пара ОС/архитектура собирается
на своём раннере. Требования к toolchain — в README.

## Этапы

- [ ] Выбрать CI (предположительно GitHub Actions — **уточнить у владельца**) — выбран GitVerse; черновики workflow готовы, ждут проверки
- [x] Матрица: linux-x64, linux-arm64, macos-arm64, macos-x64, windows-x64, windows-arm64
- [x] Кэш: `~/.npm`, Electron, `node_modules/@axosoft/nodegit/vendor/openssl` (ключ — версия OpenSSL + ОС + arch)
- [x] Шаги: `npm ci` → typecheck → lint → test → `npm run dist`
- [x] Артефакты дистрибутивов; проверка fuses собранного бинарника
- [x] Тест под Linux без дисплея — через `xvfb-run`, если понадобятся UI-тесты

## Критерии готовности

- Зелёный прогон на всех 6 платформах; время прогона и размер кэша зафиксированы в «Нюансах».

## Нюансы

- Наличие arm64-раннеров для Linux и Windows зависит от CI-провайдера и тарифа — проверить.
- macOS x64: раннеры Intel постепенно выводятся из эксплуатации у провайдеров — возможно,
  собирать x64 на arm64 через Rosetta не получится для нативных модулей; проверить отдельно.

- 2026-10-23: решение владельца: CI — **GitVerse** (не GitHub Actions; черновик под GitHub удалён).
- 2026-10-23: что даёт GitVerse по документации ([раннеры](https://gitverse.ru/docs/cicd/docs/runners/cloud-hosted),
  [лимиты](https://gitverse.ru/docs/cicd/docs/limits), [синтаксис](https://gitverse.ru/docs/cicd/docs/workflow/)):
  workflow в `.gitverse/workflows/`, синтаксис в целом как у GitHub Actions (контекст `gitverse.*`,
  `$GITVERSE_OUTPUT`); облачный раннер один — `ubuntu-latest` в Docker (x64), job не дольше 30 минут,
  500 минут в месяц для приватных репозиториев, артефакты — 500 МБ на всё (AppImage ≈ 140 МБ). Windows, macOS
  и arm64 — только локальные раннеры (`act_runner`, метки с `:host` для запуска без Docker).
- 2026-10-23: поэтому два workflow (файлы `.gitverse/workflows/ci.yaml`, `release.yaml`, `scripts/check-fuses.mjs`,
  правка `scripts/rebuild-native.mjs`):
  - `ci.yaml` — на каждый push в облаке: toolchain и библиотеки Electron через apt, `npm ci` (сборка нативных
    модулей; OpenSSL кешируется вне node_modules через `FORKLIFT_OPENSSL_CACHE`), typecheck, lint, test, test:e2e;
  - `release.yaml` — вручную (`workflow_dispatch`), матрица из 6 целей на локальных раннерах с метками
    `linux_x64`, `linux_arm64`, `macos_arm64`, `macos_x64`, `windows_x64`, `windows_arm64`: проверки,
    `npm run dist --<arch>`, проверка fuses, артефакты на 7 дней.
- 2026-10-23: решение владельца: закоммитить как есть, доделать позже. Локальных раннеров на других ОС пока
  нет, поэтому `release.yaml` (только ручной запуск) ждёт их появления; метки в нём — предложение, поправить
  под реальные машины. Задача остаётся `blocked` до первого прогона в GitVerse и появления раннеров.
- 2026-10-23: не проверено: сам запуск в GitVerse. Главный риск — уложится ли облачная job в 30 минут (первая
  сборка компилирует OpenSSL и nodegit; при промахе кеша это может не успеть — тогда сборку переносить на
  локальный раннер). Кеш (`actions/cache`) и `actions/upload-artifact` в документации GitVerse не описаны.
  Локально проверено: `check-fuses.mjs` на `dist/linux-unpacked` (все 8 fuses как в electron-builder.yml), e2e на
  упакованной сборке — 33/33 (2 пропущены: нужен инспектор main), YAML валиден.

## Промт

```text
Сделай задачу docs/tasks/stage-0-foundation/T-003-ci-matrix.md.
Сначала спроси владельца, какой CI использовать, если это не указано в задаче.
Создай workflow с матрицей из 6 платформ (см. задачу), кэшированием npm, Electron и
vendor/openssl nodegit, шагами npm ci, typecheck, lint, test, dist. Требования к toolchain — README.md.
Не коммить и не пушь без разрешения владельца. Отметь чеклист, запиши нюансы, обнови статус.
```
