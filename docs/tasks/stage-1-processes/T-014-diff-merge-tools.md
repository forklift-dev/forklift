---
id: T-014
title: Внешние diff/merge tools
stage: 1 — Процессы и внешние программы
status: review
depends_on: [T-012]
updated: 2026-10-22
---

# T-014. Внешние diff/merge tools

## Цель

Открыть изменения файла во внешнем diff-инструменте и разрешить конфликт во внешнем
merge-инструменте, дождавшись его закрытия и обновив состояние репозитория.

## Контекст

У git уже есть встроенная поддержка десятков инструментов (meld, kdiff3, Beyond Compare, VS Code,
vimdiff, opendiff/FileMerge, WinMerge, P4Merge…) и пользовательская настройка `diff.tool`,
`merge.tool`, `difftool.<name>.cmd`. Используем её вместо собственного списка инструментов.

## Этапы

- [x] Diff: `git difftool --no-prompt --tool=<tool> [--cached] -- <path>` через `GitCli` (T-012); `GIT_LITERAL_PATHSPECS=1`
- [x] Merge: `git mergetool --no-prompt --tool=<tool> -- <path>`; после закрытия — `loadRepo` (и при ошибке тоже)
- [x] Выбор: настроенный (`diff.guitool`, `diff.tool`, `merge.guitool`, `merge.tool`) → первый доступный графический из
      `--tool-help` (meld, kdiff3, Beyond Compare… VS Code последним; терминальные исключены) → свой `forklift-vscode` для старого git → ошибка с подсказкой
- [x] IPC `file:externalDiff(path, staged)`, `file:externalMerge(path)`; в UI — кнопки Diff/Merge в строке файла (по наведению)
- [x] UI не блокируется (вызов вне busy-состояния); повторное открытие того же файла отклоняется
- [x] Тесты (16): разбор `--tool-help`, выбор инструмента, нормализация путей; интеграция с git — diff рабочей копии/индекса
      файла `f*.txt` (glob не раскрывается), разрешение конфликта, повторное открытие, машина без инструментов
- [x] Живая проверка через кнопки UI: 9/9; без настроек на машине владельца выбирается встроенный `vscode`
- [ ] Ручная проверка владельцем с настоящим VS Code (Diff и Merge)
- [ ] macOS (opendiff/FileMerge) и Windows (WinMerge, Beyond Compare) — T-003

## Критерии готовности

- На Linux с `meld` работают diff и разрешение конфликта; после закрытия merge-инструмента
  файл пропадает из конфликтных.

## Нюансы

- `mergetool` создаёт `*.orig` (если не `mergetool.keepBackup=false`) — не показывать их как новые файлы
  без согласования с владельцем.
- 2026-10-22: **найден баг из T-001** — конфликтные файлы не показывались в панели изменений: libgit2 помечает
  конфликт только битом `CONFLICTED`, без битов индекса/рабочей копии, и файл выпадал из обеих групп. Исправлено
  в `src/main/git/service.ts`, добавлен тест.
- 2026-10-22: git ≥ 2.4x сам помечает графические инструменты в `--tool-help` («requires a graphical session») и
  имеет встроенный `vscode`; для старых версий — список известных GUI-инструментов и свой `forklift-vscode`.
- 2026-10-22: терминальные инструменты (vimdiff, nvimdiff, emerge) исключены — без терминала они зависнут.
- `.orig`-файлы `mergetool` не скрываем: это настройка пользователя `mergetool.keepBackup`.
- Решение «конфликт разрешён» принимает git (`mergetool.<tool>.trustExitCode`), не мы.

## Промт

```text
Реализуй задачу docs/tasks/stage-1-processes/T-014-diff-merge-tools.md через git CLI-адаптер (T-012)
и ProcessRunner.launch с ожиданием выхода. Тест: временный репозиторий с конфликтом и фиктивным
merge-инструментом (скрипт, который пишет разрешённый файл и выходит с 0), настроенным через
git config. Обнови чеклист, нюансы, статус и docs/README.md.
```
