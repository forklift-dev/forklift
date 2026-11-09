---
id: T-105
title: "Статический AppImage runtime без внешней зависимости от libfuse"
stage: 0 — Фундамент
status: review
depends_on: [T-069]
updated: 2026-11-09
---

# T-105. Статический AppImage runtime без внешней зависимости от libfuse

## Цель

Перевести Forklift на современный статический AppImage runtime со встроенными `libfuse` и `squashfuse`, чтобы
опубликованная Linux-сборка запускалась на чистой поддерживаемой системе без установки `libfuse`/`libfuse2` и
без специальной команды из терминала. Принцип распространения Forklift — **zero dependency**: готовое приложение
не должно требовать от пользователя ручной установки дополнительных runtime-библиотек.

## Контекст

- Сейчас `electron-builder.yml` выпускает для Linux только AppImage, а `README.ru.md` и `README.md` предлагают
  его как единственный готовый пакет. Используемый runtime динамически загружает `libfuse.so.2` и на чистой
  Linux-системе завершается сообщением `dlopen(): error loading libfuse.so.2`.
- Для сравнения проверен `/home/akryll/Applications/solidcraft.AppImage`: это новый static-PIE AppImage runtime
  (`type2-runtime`, commit `fedfad5`), который включает `libfuse` и `squashfuse` в runtime и запускается без
  отдельно установленной `libfuse2`. Runtime Forklift — динамический (`Version: effcebc`) и содержит явную
  зависимость от `libfuse.so.2`.
- Сборки публикуются задачей T-069 через `.github/workflows/build.yml` и `.gitverse/workflows/release.yaml`.
- Широкая задача по дополнительным форматам пакетов T-081 отложена. В этой задаче сохраняем AppImage и меняем
  его runtime; переход на `.deb`/`.rpm` или требование распаковки при каждом запуске не являются основным решением.

## Этапы

- [x] Воспроизвести отказ текущего AppImage в чистой VM/контейнере без `libfuse.so.2` и записать точную ошибку и
  затронутые версии дистрибутивов.
- [x] Перевести сборку на актуальный static-PIE AppImage type2 runtime, в который статически включены `libfuse` и
  `squashfuse`; выяснить поддерживаемый способ настройки/замены runtime в `electron-builder` и зафиксировать версию.
- [x] Проверить целостность и происхождение загружаемого runtime: закрепить версию и SHA-256, не скачивать
  непроверенный исполняемый файл во время release-сборки.
- [x] Обновить локальную сборку, GitHub/GitVerse workflow и список артефактов релиза.
- [x] Добавить автоматическую проверку формата runtime (`static-pie`, отсутствие `NEEDED libfuse.so.2`) и
  smoke-проверку запуска Linux-артефакта в окружении без `libfuse`/`libfuse2`.
- [x] Обновить раздел скачивания в `README.md` и `README.ru.md`, указав, что AppImage не требует установки
  дополнительных runtime-библиотек.

## Критерии готовности

- Пользователь скачивает AppImage на чистую поддерживаемую систему и запускает Forklift из файлового менеджера
  без установки `libfuse`/`libfuse2`, ручной распаковки и специальных переменных окружения.
- AppImage использует закреплённый static-PIE runtime со встроенными `libfuse` и `squashfuse`; runtime не вызывает
  `dlopen("libfuse.so.2")` и не содержит динамической зависимости от этой библиотеки.
- CI публикует этот артефакт и проверяет хотя бы старт процесса и создание главного окна в окружении без
  `libfuse.so.2`.
- Название, расширение и документация артефакта совпадают в обоих release workflow и README.
- `npm run typecheck`, `npm run lint`, `npm test` и относящаяся к упаковке часть `npm run test:e2e` зелёные.

## Нюансы

- 2026-11-09: дефект обнаружен владельцем при первом запуске Forklift на чистой Linux-системе: потребовалась
  ручная установка `libfuse`.
- 2026-11-09: решение владельца — сохранить AppImage, перейти на новый статический runtime и следовать принципу
  **zero dependency**. SolidCraft подтверждает работоспособность этого подхода на той же системе.
- Под zero dependency здесь понимается отсутствие отдельно устанавливаемых пользовательских runtime-библиотек;
  стандартные возможности ядра Linux и базовой системы не нужно подменять внутри приложения.
- Не считать достаточным исправлением текст с командой установки, `APPIMAGE_EXTRACT_AND_RUN=1`, скрипт ручной
  распаковки или публикацию другого формата вместо исправления основного AppImage.
- Не ломать очистку AppImage-переменных для дочерних процессов в `src/main/process/env.ts` и проверить askpass
  упакованной сборки из T-106 после смены runtime.
- 2026-11-09: `electron-builder` 26.15.3 штатно поддерживает `toolsets.appimage: 1.0.3`; архив
  `appimage-tools-runtime-20251108.tar.gz` закреплён внутри `app-builder-lib` SHA-256
  `84021a78ee214ae6fd33a2d62a92ba25542dd10bc86bf117a9b2d0bba44e7665`. Собранный runtime — static PIE,
  type2-runtime commit `dd6cebe`, размер 944632 байта, строки `libfuse.so.2` в runtime нет.
- 2026-11-09: добавлен `scripts/check-appimage-runtime.mjs`, запускаемый в GitHub и GitVerse после упаковки;
  локальная сборка `Forklift-0.5.1.AppImage`, Electron fuses и packaged E2E `remote`/`push-upstream` прошли.
  Проверка самой сборки на GitHub Actions остаётся частью review.
- 2026-11-09: AppImage дополнительно запущен в чистом контейнере Ubuntu 24.04: установлен только FUSE 3,
  `ldconfig` подтвердил отсутствие `libfuse.so.2`, Chromium debug endpoint главного окна открылся. Linux package
  job GitHub теперь после проверки static runtime запускает packaged E2E `remote` и `push-upstream` под Xvfb.

## Промт

```text
Реализуй задачу docs/tasks/stage-0-foundation/T-105-linux-package-without-libfuse.md. Сначала воспроизведи запуск
текущего AppImage в чистом окружении без libfuse.so.2. Затем переведи сборку на закреплённый современный
static-PIE AppImage type2 runtime со статически включёнными libfuse и squashfuse; ориентир по поведению —
solidcraft.AppImage с type2-runtime commit fedfad5. Проверь источник и SHA-256 runtime. Добавь CI-проверку формата
и packaged smoke-тест без libfuse.so.2, обнови оба release workflow и README. Не заменяй решение инструкцией по
установке зависимости, extract-and-run или другим форматом пакета: zero dependency AppImage — выбранный путь.
После смены runtime проверь packaged askpass из T-106. По итогам обнови чеклист, дату, статус на review и строку
в docs/README.md.
```
