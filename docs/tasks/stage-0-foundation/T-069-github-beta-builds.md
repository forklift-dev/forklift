---
id: T-069
title: "Бета-сборки на GitHub Actions (Linux, Windows, macOS)"
stage: 0 — Фундамент
status: review
depends_on: [T-003]
updated: 2026-10-23
---

# T-069. Бета-сборки на GitHub Actions (Linux, Windows, macOS)

## Цель

Решение владельца (2026-10-23): попробовать GitHub Actions, чтобы собрать бета-версию на нужных ОС — у GitVerse
облачный раннер только ubuntu x64 и не укладывает сборку нативных модулей в 30 минут (T-003), а своих раннеров на
других ОС нет. GitVerse остаётся основным хостингом кода.

## Контекст

- T-003: `.gitverse/workflows/ci.yaml` (вручную) и `release.yaml` (свои раннеры); сборка — `npm run dist`,
  нативные модули — `scripts/rebuild-native.mjs`, проверка fuses — `scripts/check-fuses.mjs`, Windows — по образцу
  `scripts/build-windows.ps1`.
- Подписи и нотаризации пока нет (T-004): бета без подписи.

## Этапы

- [x] Workflow `.github/workflows/build.yml`: проверки на Linux, затем пакеты (Linux x64, Windows x64, macOS arm64), артефакты, черновик
      пре-релиза по тегу `v*`
- [ ] Репозиторий на GitHub (решение владельца: публичный или приватный, чей аккаунт) и первый запуск
- [ ] Поправить по итогам первого запуска (метки раннеров, toolchain Windows/arm64)

## Критерии готовности

- Запуск вручную даёт пакеты для Linux x64 (AppImage), Windows x64 (NSIS + zip) и macOS на Apple silicon
  (dmg + zip); они запускаются на соответствующих ОС

## Нюансы

- 2026-10-23: `build.yml`:
  - запуск — вручную (Actions → Build → Run workflow; галочка «e2e») или push тега `v*`
    (например `v0.1.0-beta.1`): тогда ещё и черновик пре-релиза со всеми пакетами (публикуется руками);
  - `check` (ubuntu-22.04): typecheck, lint, юнит-тесты, e2e — по галочке и для тегов; пакеты собираются только
    после зелёных проверок;
  - `package` — матрица: `ubuntu-22.04` (x64; старый glibc — AppImage запустится на большем числе дистрибутивов),
    `windows-2022` (x64), `macos-15` (Apple silicon); установка
    `npm ci --ignore-scripts` + загрузка Electron + `rebuild-native.mjs` (как в `build-windows.ps1`), проверка
    загрузки нативных модулей в Electron, `npm run dist`, проверка fuses, артефакты на 14 дней;
  - Windows: доустанавливает Spectre-библиотеки Visual Studio, если их нет в образе; OpenSSL nodegit кешируется
    (`actions/cache`, на GitHub работает);
  - без подписи: `CSC_IDENTITY_AUTO_DISCOVERY=false`; macOS — открыть правым кликом → Open, Windows — SmartScreen
    «Подробнее → Выполнить в любом случае».
- 2026-10-23: проверено локально: YAML, план матрицы (с arm64 и без), actionlint 1.7.7 — без замечаний. Сам запуск
  не проверен: нужен репозиторий на GitHub.
- 2026-10-24: решение владельца: пока нужны только Linux x64, macOS arm64 и Windows x64. ARM-раннеры дают только
  arm64-пакеты (нативные модули собираются под процессор раннера), поэтому arm64 Linux/Windows и Intel macOS убраны
  из матрицы вместе с галочкой «arm64»; вернуть — добавить строки `ubuntu-22.04-arm`, `windows-11-arm`,
  `macos-15-intel`. Без Intel-сборки macOS-пакет не запустится на маках с процессором Intel.
- **Вопросы владельцу:** (1) репозиторий на GitHub — публичный или приватный? У публичных Actions бесплатны (и
  arm64-раннеры тоже); у приватных — 2000 минут в месяц, причём минута Windows считается за 2, macOS — за 10:
  один прогон ≈ 30–40 мин на цель, т. е. macOS (одна цель) съест ~300–400 «минут», Windows ~60–80, Linux ~30–40,
  плюс проверки ~20–30. (2) Аккаунт и разрешение на push в GitHub.
